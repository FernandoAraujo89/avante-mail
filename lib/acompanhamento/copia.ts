// Cópia de acompanhamento das campanhas (19/10/2026): os líderes da Avante
// recebem, por e-mail, uma cópia de TODA campanha disparada — e-mail, WhatsApp
// e SMS — no momento em que ela sai.
//
// É cópia, não destinatário: não entra em campaign_sends, então não aparece no
// relatório, não conta abertura, clique, custo nem descadastro, e não leva
// rastreio. Quem já é destinatário real da campanha de e-mail (está numa das
// listas) não recebe a cópia: receberia o mesmo e-mail duas vezes.
//
// Este arquivo é PURO (sem banco, sem fila): monta a lista, o assunto e o
// HTML. A parte que lê o banco e enfileira mora em ./index.ts.
import { EMAIL_REGEX } from "@/lib/utils";

/** Onde a lista mora em app_settings (JSON: array de e-mails). */
export const CHAVE_ACOMPANHAMENTO = "copia_acompanhamento_emails";

/** Nome do job na fila de e-mail — o worker separa a cópia do envio comum. */
export const JOB_DA_COPIA = "copia-acompanhamento";

export type CanalDaCopia = "email" | "whatsapp" | "sms";

/**
 * Lê a lista como o usuário a escreve: um por linha, ou separados por vírgula,
 * ponto e vírgula ou espaço. Devolve os válidos (minúsculos, sem repetição, na
 * ordem em que vieram) e o que não é e-mail, para a tela apontar.
 */
export function lerEmailsDeAcompanhamento(entrada: unknown): {
  emails: string[];
  invalidos: string[];
} {
  const pedacos = Array.isArray(entrada)
    ? entrada.map((item) => String(item ?? ""))
    : typeof entrada === "string"
      ? entrada.split(/[\s,;]+/)
      : [];
  const emails: string[] = [];
  const invalidos: string[] = [];
  for (const pedaco of pedacos) {
    const limpo = pedaco.trim().toLowerCase();
    if (!limpo) continue;
    if (!EMAIL_REGEX.test(limpo)) {
      if (!invalidos.includes(pedaco.trim())) invalidos.push(pedaco.trim());
      continue;
    }
    if (!emails.includes(limpo)) emails.push(limpo);
  }
  return { emails, invalidos };
}

/**
 * Quem recebe a cópia: os líderes que NÃO são destinatários reais da campanha.
 * `enderecosDaCampanha` só faz sentido no e-mail (no WhatsApp e no SMS o líder
 * nunca recebe a mesma coisa por outro caminho).
 */
export function quemRecebeCopia(
  lideres: string[],
  enderecosDaCampanha: string[] = []
): string[] {
  const jaRecebem = new Set(enderecosDaCampanha.map((e) => e.toLowerCase()));
  return lideres.filter((e) => !jaRecebem.has(e.toLowerCase()));
}

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Texto do usuário em HTML: escapado, com as quebras de linha preservadas. */
function comQuebras(texto: string): string {
  return escaparHtml(texto).replace(/\r?\n/g, "<br />");
}

const numero = new Intl.NumberFormat("pt-BR");

const ROTULO_DO_CANAL: Record<CanalDaCopia, string> = {
  email: "e-mail",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

export function assuntoDaCopia(
  canal: CanalDaCopia,
  campanha: { name: string; subject: string }
): string {
  return canal === "email"
    ? `[Cópia] ${campanha.subject}`
    : `[Cópia · ${ROTULO_DO_CANAL[canal]}] ${campanha.name}`;
}

export interface ResumoDaCopia {
  canal: CanalDaCopia;
  nomeDaCampanha: string;
  /** Envios criados (um por endereço). */
  mensagens: number;
  /** Contatos distintos. */
  contatos: number;
  /** "19/10/2026 14:00" — já formatado no fuso de Brasília. */
  quando: string;
  autor: string | null;
  listas: string;
  relatorioUrl: string;
}

/** A faixa no topo da cópia: de que campanha é, para quantos, quando, quem. */
export function faixaDeAcompanhamento(resumo: ResumoDaCopia): string {
  const unidade =
    resumo.canal === "email"
      ? resumo.mensagens === 1
        ? "e-mail"
        : "e-mails"
      : resumo.canal === "sms"
        ? "SMS"
        : resumo.mensagens === 1
          ? "mensagem"
          : "mensagens";
  const contatos = `${numero.format(resumo.contatos)} contato${resumo.contatos === 1 ? "" : "s"}`;
  const autor = resumo.autor ? ` · por ${escaparHtml(resumo.autor)}` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF3FF;border-bottom:1px solid #C9D7FB;">
<tr><td align="center" style="padding:14px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#282E3F;text-align:left;">
<strong style="color:#1D50DC;">Cópia de acompanhamento</strong> · campanha de ${ROTULO_DO_CANAL[resumo.canal]} &ldquo;<strong>${escaparHtml(resumo.nomeDaCampanha)}</strong>&rdquo;<br />
${numero.format(resumo.mensagens)} ${unidade} para ${contatos} · saiu em ${escaparHtml(resumo.quando)}${autor}<br />
Listas: ${escaparHtml(resumo.listas)} · <a href="${escaparHtml(resumo.relatorioUrl)}" style="color:#1D50DC;">ver relatório</a><br />
<span style="font-size:12px;color:#6B7686;">Você recebe esta cópia por estar na lista de acompanhamento das campanhas. Ela não conta no relatório.</span>
</td></tr>
</table>
</td></tr>
</table>`;
}

/** Põe a faixa no começo do corpo do e-mail da campanha. */
export function inserirFaixa(html: string, faixa: string): string {
  const abertura = html.match(/<body[^>]*>/i);
  if (!abertura || abertura.index === undefined) return faixa + html;
  const fim = abertura.index + abertura[0].length;
  return html.slice(0, fim) + faixa + html.slice(fim);
}

/** Documento HTML simples em volta de um conteúdo (WhatsApp e SMS). */
function documento(faixa: string, conteudo: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#F4F6FA;">
${faixa}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 16px;">
${conteudo}
</td></tr></table>
</body></html>`;
}

export interface ModeloParaCopia {
  name: string;
  category: string;
  headerType: string;
  headerText: string | null;
  /** Já absoluta (https://…). */
  headerMediaUrl: string | null;
  headerMediaFilename: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: { type: string; text: string; url?: string }[] | null;
}

/**
 * O texto do modelo com as variáveis como o líder precisa lê-las: o que muda
 * por contato fica entre colchetes; o texto fixo, como vai.
 */
export function corpoComVariaveis(
  bodyText: string,
  variaveis: Record<string, { source: string; value?: string }> | null
): string {
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (cru, n: string) => {
    const fonte = variaveis?.[n];
    if (fonte?.source === "name") return "[nome do contato]";
    if (fonte?.source === "company") return "[empresa do contato]";
    if (fonte?.source === "static") return fonte.value ?? cru;
    return cru;
  });
}

/** A mensagem de WhatsApp desenhada como um balão, mais o nome do modelo. */
export function htmlDaCopiaWhatsApp(
  faixa: string,
  modelo: ModeloParaCopia,
  corpo: string
): string {
  let cabecalho = "";
  if (modelo.headerType === "text" && modelo.headerText) {
    cabecalho = `<p style="margin:0 0 8px;font-weight:bold;">${escaparHtml(modelo.headerText)}</p>`;
  } else if (modelo.headerType === "image" && modelo.headerMediaUrl) {
    cabecalho = `<img src="${escaparHtml(modelo.headerMediaUrl)}" alt="Imagem do cabeçalho" width="380" style="display:block;width:100%;max-width:380px;height:auto;border-radius:6px;margin:0 0 10px;" />`;
  } else if (modelo.headerType === "video" && modelo.headerMediaUrl) {
    cabecalho = `<p style="margin:0 0 10px;"><a href="${escaparHtml(modelo.headerMediaUrl)}" style="color:#1D50DC;">&#9654; Vídeo do cabeçalho</a></p>`;
  } else if (modelo.headerType === "document" && modelo.headerMediaUrl) {
    cabecalho = `<p style="margin:0 0 10px;"><a href="${escaparHtml(modelo.headerMediaUrl)}" style="color:#1D50DC;">&#128196; ${escaparHtml(modelo.headerMediaFilename ?? "Documento do cabeçalho")}</a></p>`;
  }
  const rodape = modelo.footerText
    ? `<p style="margin:10px 0 0;font-size:12px;color:#6B7686;">${escaparHtml(modelo.footerText)}</p>`
    : "";
  const botoes = (modelo.buttons ?? [])
    .map(
      (b) =>
        `<tr><td style="background:#FFFFFF;border-radius:8px;padding:10px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1D50DC;">${escaparHtml(b.text)}${b.type === "URL" && b.url ? `<br /><span style="font-size:11px;color:#6B7686;">${escaparHtml(b.url)}</span>` : ""}</td></tr><tr><td style="height:4px;line-height:4px;font-size:4px;">&nbsp;</td></tr>`
    )
    .join("");
  const conteudo = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:420px;background:#E5DDD5;border-radius:12px;">
<tr><td style="padding:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="background:#FFFFFF;border-radius:8px;padding:12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#111B21;">
${cabecalho}${comQuebras(corpo)}${rodape}
</td></tr>
<tr><td style="height:6px;line-height:6px;font-size:6px;">&nbsp;</td></tr>
${botoes}
</table>
</td></tr>
</table>
<p style="max-width:420px;margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6B7686;text-align:left;">Modelo ${escaparHtml(modelo.name)} (${escaparHtml(modelo.category.toLowerCase())}). O que está entre colchetes muda por contato.</p>`;
  return documento(faixa, conteudo);
}

/** O SMS como sai, num balão, com a contagem de segmentos. */
export function htmlDaCopiaSms(
  faixa: string,
  texto: string,
  segmentos: number
): string {
  const conteudo = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:420px;">
<tr><td style="background:#E9E9EB;border-radius:16px;padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#111111;">${comQuebras(texto)}</td></tr>
</table>
<p style="max-width:420px;margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6B7686;text-align:left;">${segmentos} segmento${segmentos === 1 ? "" : "s"} por mensagem.</p>`;
  return documento(faixa, conteudo);
}
