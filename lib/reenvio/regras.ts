// O e-mail de uma campanha já disparada: ver na tela, imprimir (salvar em PDF)
// e reenviar para endereços digitados à mão (16/11/2026).
//
// Campanha enviada não é mais editável (PUT /api/campaigns/[id] recusa), então
// o conteúdo guardado É o que saiu — dá para remontar o e-mail a qualquer
// momento, sem ter guardado uma cópia do HTML na hora do disparo.
//
// Este arquivo é PURO (sem banco, sem envio): lê a lista digitada e prepara o
// HTML para a tela e para a impressão. O que consulta o banco e manda o
// e-mail mora em ./index.ts.
import { escaparHtml, inserirFaixa } from "@/lib/acompanhamento/copia";
import { EMAIL_REGEX } from "@/lib/utils";

/**
 * Teto de endereços por reenvio. É reenvio AVULSO: sai na própria requisição,
 * um por vez, sem passar pela fila. Para mais gente do que isso o caminho é
 * duplicar a campanha e escolher os destinatários — aí há fila, limite do SES
 * e relatório.
 */
export const MAX_REENVIO = 10;

/** Onde o nome de quem recebe entra no e-mail. */
const VARIAVEL_DO_NOME = /\{\{\s*nome_parceiro\s*\}\}/;

/** O nome que a tela e a impressão mostram no lugar do de cada destinatário. */
export const NOME_GENERICO = "[nome do parceiro]";

export interface DestinatarioDigitado {
  email: string;
  /** Vai na saudação quando o endereço não é de um contato da base. */
  nome: string | null;
}

function limparNome(nome: unknown): string | null {
  if (typeof nome !== "string") return null;
  const limpo = nome.trim().replace(/^["']+|["']+$/g, "").trim();
  return limpo || null;
}

/**
 * Lê os destinatários como a pessoa os escreve: um por linha ou separados por
 * vírgula ou ponto e vírgula; aceita também "Nome <email>", como os programas
 * de e-mail copiam. A API recebe a mesma coisa já separada ({ email, nome }).
 * Devolve os válidos (minúsculos, sem repetição, na ordem em que vieram) e o
 * que não é e-mail, para a tela apontar em vez de descartar calado.
 */
export function lerDestinatarios(entrada: unknown): {
  destinatarios: DestinatarioDigitado[];
  invalidos: string[];
} {
  const crus: { email: string; nome: string | null }[] = [];
  if (Array.isArray(entrada)) {
    for (const item of entrada) {
      if (typeof item === "string") {
        crus.push({ email: item, nome: null });
      } else if (item && typeof item === "object") {
        const { email, nome } = item as { email?: unknown; nome?: unknown };
        crus.push({ email: String(email ?? ""), nome: limparNome(nome) });
      }
    }
  } else if (typeof entrada === "string") {
    for (const pedaco of entrada.split(/[\n\r,;]+/)) {
      const comNome = pedaco.match(/^(.*)<([^<>]*)>\s*$/);
      if (comNome) {
        crus.push({ email: comNome[2], nome: limparNome(comNome[1]) });
        continue;
      }
      // Sem "<>", espaço separa endereços ("a@x.com b@x.com").
      for (const solto of pedaco.split(/\s+/)) {
        crus.push({ email: solto, nome: null });
      }
    }
  }

  const destinatarios: DestinatarioDigitado[] = [];
  const invalidos: string[] = [];
  for (const cru of crus) {
    const escrito = cru.email.trim();
    if (!escrito) continue;
    const email = escrito.toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      if (!invalidos.includes(escrito)) invalidos.push(escrito);
      continue;
    }
    const repetido = destinatarios.find((d) => d.email === email);
    if (repetido) {
      // O mesmo endereço duas vezes: fica um só, com o nome de quem trouxe.
      repetido.nome ??= cru.nome;
      continue;
    }
    destinatarios.push({ email, nome: cru.nome });
  }
  return { destinatarios, invalidos };
}

/**
 * O e-mail chama o destinatário pelo nome? Se chama, quem não está na base
 * precisa de um nome digitado — sem ele a saudação sairia "Olá, !".
 */
export function usaNomeDoParceiro(mjml: string): boolean {
  return VARIAVEL_DO_NOME.test(mjml);
}

/** Põe um trecho dentro do <head> (ou no começo, se o HTML não tiver um). */
export function inserirNoHead(html: string, trecho: string): string {
  const abertura = html.match(/<head[^>]*>/i);
  if (!abertura || abertura.index === undefined) return trecho + html;
  const fim = abertura.index + abertura[0].length;
  return html.slice(0, fim) + trecho + html.slice(fim);
}

/**
 * O HTML do e-mail para ser VISTO dentro do sistema:
 *  - as imagens hospedadas aqui voltam a ter caminho relativo (/uploads/…),
 *    para abrirem em qualquer endereço em que o sistema esteja rodando;
 *  - os links abrem em outra aba, como num programa de e-mail, em vez de
 *    navegar dentro do quadro da prévia.
 */
export function paraVer(html: string, baseUrl: string): string {
  const local = html.split(`="${baseUrl}/uploads/`).join('="/uploads/');
  return inserirNoHead(local, '<base target="_blank" />');
}

export interface RegistroDoEnvio {
  /** "campanha" ou "edição do Avante News" — muda só o vocabulário. */
  tipo: "campaign" | "news";
  nomeDaCampanha: string;
  assunto: string;
  preCabecalho: string | null;
  /** "19/10/2026, 14:00" — já no fuso de Brasília. Nulo: ainda não saiu. */
  enviadaEm: string | null;
  autor: string | null;
  listas: string;
  /** Envios criados (um por endereço). */
  destinatarios: number;
}

const numero = new Intl.NumberFormat("pt-BR");

/**
 * A faixa no topo da versão impressa: o PDF sai do sistema e vai parar numa
 * pasta ou num anexo, então precisa dizer sozinho de que campanha é, com que
 * assunto saiu, quando, por quem e para quantos.
 */
export function faixaDeRegistro(registro: RegistroDoEnvio): string {
  const oQue = registro.tipo === "news" ? "Edição do Avante News" : "Campanha";
  const linhas = [
    `<strong style="color:#1D50DC;">${oQue}</strong> &ldquo;<strong>${escaparHtml(registro.nomeDaCampanha)}</strong>&rdquo;`,
    `Assunto: <strong>${escaparHtml(registro.assunto)}</strong>`,
  ];
  if (registro.preCabecalho?.trim()) {
    linhas.push(`Pré-cabeçalho: ${escaparHtml(registro.preCabecalho.trim())}`);
  }
  const envio = registro.enviadaEm
    ? `Enviada em ${escaparHtml(registro.enviadaEm)}${registro.autor ? ` por ${escaparHtml(registro.autor)}` : ""}`
    : "Ainda não enviada";
  const paraQuantos =
    registro.destinatarios > 0
      ? ` · ${numero.format(registro.destinatarios)} destinatário${registro.destinatarios === 1 ? "" : "s"}`
      : "";
  linhas.push(`${envio}${paraQuantos}`);
  linhas.push(`Listas: ${escaparHtml(registro.listas)}`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF3FF;border-bottom:1px solid #C9D7FB;">
<tr><td align="center" style="padding:14px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#282E3F;text-align:left;">
${linhas.join("<br />\n")}<br />
<span style="font-size:12px;color:#6B7686;">Onde o e-mail traz ${escaparHtml(NOME_GENERICO)}, cada destinatário recebeu o próprio nome.</span>
</td></tr>
</table>
</td></tr>
</table>`;
}

// Fundo e cor de botão fazem parte do e-mail: sem o print-color-adjust o
// navegador os tira para economizar tinta e o PDF sai irreconhecível.
const ESTILO_DE_IMPRESSAO = `<style>
@page { size: A4; margin: 12mm; }
html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
img { break-inside: avoid; page-break-inside: avoid; }
</style>`;

/**
 * O HTML do e-mail para IMPRIMIR (é pela impressão do navegador que se salva
 * o PDF): a faixa de registro no topo, as cores preservadas e o título que
 * vira o nome sugerido para o arquivo.
 *
 * O MJML põe o desenho de computador (colunas lado a lado) dentro de
 * "@media only screen and (min-width:480px)". Na impressão a mídia é "print",
 * a regra não vale e o e-mail sairia empilhado como no celular — por isso a
 * troca para "all": a folha A4 tem bem mais de 480px.
 */
export function paraImprimir(
  html: string,
  registro: RegistroDoEnvio,
  baseUrl: string
): string {
  const comFaixa = inserirFaixa(
    paraVer(html, baseUrl),
    faixaDeRegistro(registro)
  );
  const semTitulo = comFaixa.replace(/<title>[\s\S]*?<\/title>/i, "");
  const paraPapel = semTitulo.replace(/@media only screen and/g, "@media all and");
  return inserirNoHead(
    paraPapel,
    `<title>${escaparHtml(registro.nomeDaCampanha)} — e-mail enviado</title>${ESTILO_DE_IMPRESSAO}`
  );
}

/** Por que um endereço digitado recebe, ou não, o reenvio. */
export type SituacaoDoEndereco =
  /** É de um contato da base e aceita e-mail. */
  | "contato"
  /** Não é de ninguém da base: recebe, sem link de descadastro assinado. */
  | "fora_da_base"
  /** É de um contato, mas pediu para sair, devolveu ou marcou como spam. */
  | "descadastrado";

export interface EnderecoConferido {
  email: string;
  situacao: SituacaoDoEndereco;
  /** O nome que vai na saudação: o do contato, ou o digitado. */
  nome: string | null;
  contactId: string | null;
  /** Fora da base, sem nome, num e-mail que chama pelo nome. */
  faltaNome: boolean;
}

/**
 * Cruza os endereços digitados com o que a base sabe deles. `daBase` traz só
 * os endereços que pertencem a um contato.
 */
export function conferir(
  digitados: DestinatarioDigitado[],
  daBase: Map<string, { contactId: string; nome: string; aceita: boolean }>,
  emailUsaNome: boolean
): EnderecoConferido[] {
  return digitados.map((d) => {
    const contato = daBase.get(d.email);
    if (contato) {
      return {
        email: d.email,
        situacao: contato.aceita ? "contato" : "descadastrado",
        nome: contato.nome,
        contactId: contato.contactId,
        faltaNome: false,
      };
    }
    return {
      email: d.email,
      situacao: "fora_da_base",
      nome: d.nome,
      contactId: null,
      faltaNome: emailUsaNome && !d.nome,
    };
  });
}
