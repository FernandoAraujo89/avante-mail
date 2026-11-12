import type { Perfil } from "@/lib/perfis";

// As LINHAS de WhatsApp: cada uma é um número da mesma WABA, com propósito
// próprio (docs/plano-expansao.md, parte 5). "comunicados" é o número de
// sempre (campanhas); "expansao" é o "Avante Expansão", para pesquisa e
// conversa 1:1 com parceiros. Modelos são da WABA: servem às duas.
//
// Puro no que a tela usa (rótulos, linhas de cada perfil); o id do número
// vem do ambiente e só é lido no servidor.

export const LINHAS = ["comunicados", "expansao"] as const;
export type Linha = (typeof LINHAS)[number];

export const LINHA_PADRAO: Linha = "comunicados";

export const LINHA_LABEL: Record<Linha, string> = {
  comunicados: "Avante Comunicados",
  expansao: "Avante Expansão",
};

export const LINHA_DESCRICAO: Record<Linha, string> = {
  comunicados: "O número das campanhas. Quem responde aqui ouve que não é atendimento.",
  expansao: "O número da Expansão: pesquisas e conversa com os parceiros.",
};

export function ehLinha(valor: unknown): valor is Linha {
  return typeof valor === "string" && (LINHAS as readonly string[]).includes(valor);
}

const ENV_DA_LINHA: Record<Linha, string> = {
  comunicados: "WHATSAPP_PHONE_NUMBER_ID",
  expansao: "WHATSAPP_EXPANSAO_PHONE_NUMBER_ID",
};

/** Nome da variável de ambiente com o id do número da linha. */
export function envDaLinha(linha: Linha): string {
  return ENV_DA_LINHA[linha];
}

/** O phone_number_id da linha, ou null se o número ainda não foi configurado. */
export function phoneNumberIdDaLinha(linha: Linha): string | null {
  return process.env[ENV_DA_LINHA[linha]] || null;
}

export function linhaConfigurada(linha: Linha): boolean {
  return phoneNumberIdDaLinha(linha) !== null;
}

/**
 * De que linha veio o evento do webhook (metadata.phone_number_id). Null
 * quando o id não é de nenhuma linha conhecida — quem chama decide o que
 * fazer (hoje: trata como comunicados e avisa no log).
 */
export function linhaDoPhoneNumberId(phoneNumberId: string | null | undefined): Linha | null {
  if (!phoneNumberId) return null;
  for (const linha of LINHAS) {
    if (phoneNumberIdDaLinha(linha) === phoneNumberId) return linha;
  }
  return null;
}

/** As linhas que o perfil alcança na caixa de conversas. */
export function linhasDoPerfil(perfil: Perfil): Linha[] {
  if (perfil === "admin") return [...LINHAS];
  if (perfil === "expansao") return ["expansao"];
  return [];
}

/** A linha escolhida ou, sem escolha válida, todas as do perfil. */
export function linhasPedidas(perfil: Perfil, pedida: unknown): Linha[] {
  const minhas = linhasDoPerfil(perfil);
  return ehLinha(pedida) && minhas.includes(pedida) ? [pedida] : minhas;
}

// ─── Números que não são linhas do Campanhas ──────────────────────────
//
// O app da Meta do Campanhas recebe os eventos de TODA conta de WhatsApp
// (WABA) inscrita nele — inclusive de números que outros sistemas usam, como
// os do NRG Hub, na mesma empresa da Meta. Até 12/11/2026 essas mensagens
// caíam na linha de comunicados: a conversa se misturava à das campanhas e a
// resposta automática saía pelo número errado (a Meta recusava, erro 131047).
// Agora cada número desses tem as conversas dele, numa caixa à parte, e o
// Campanhas não fala sozinho por ele.

/** A caixa "outros números" da tela de conversas. */
export const CAIXA_OUTROS = "outros" as const;
/** O que a caixa de conversas filtra: uma linha nossa ou os outros números. */
export type Caixa = Linha | typeof CAIXA_OUTROS;
export const CAIXAS: readonly Caixa[] = [...LINHAS, CAIXA_OUTROS];

export const CAIXA_LABEL: Record<Caixa, string> = {
  ...LINHA_LABEL,
  outros: "Outros números",
};

const PREFIXO_OUTRO_NUMERO = `${CAIXA_OUTROS}:` as const;

/**
 * O número de uma conversa (coluna `line`): uma linha nossa ou, para número
 * de outro sistema, `outros:<phone_number_id>`. Guardar o id na própria linha
 * mantém a conversa única por (número, telefone) sem trocar o índice que já
 * existe — cada número de fora é uma "linha" a mais.
 */
export type LinhaDaConversa = Linha | `${typeof CAIXA_OUTROS}:${string}`;

export function ehCaixa(valor: unknown): valor is Caixa {
  return typeof valor === "string" && (CAIXAS as readonly string[]).includes(valor);
}

export function linhaDeOutroNumero(phoneNumberId: string): LinhaDaConversa {
  return `${PREFIXO_OUTRO_NUMERO}${phoneNumberId}`;
}

/** O phone_number_id de uma conversa de outro número; null nas linhas nossas. */
export function outroNumeroDaLinha(linha: string): string | null {
  return linha.startsWith(PREFIXO_OUTRO_NUMERO)
    ? linha.slice(PREFIXO_OUTRO_NUMERO.length) || null
    : null;
}

/** Em que caixa da tela a conversa aparece. */
export function caixaDaLinha(linha: string): Caixa {
  return ehLinha(linha) ? linha : CAIXA_OUTROS;
}

/** O id que a Meta dá a um número é só dígitos; o resto não é número da Meta. */
const PHONE_NUMBER_ID = /^\d+$/;

/**
 * Onde gravar a conversa de um evento do webhook, pelo número que o recebeu
 * (metadata.phone_number_id): a linha desse número; número que não é linha
 * nossa vira `outros:<id>`. Vale o padrão de antes (comunicados) quando não dá
 * para saber de quem é o número: evento sem id (o teste do painel da Meta), id
 * fora do formato, ou servidor sem a linha de comunicados configurada.
 */
export function linhaDaConversaDoEvento(
  phoneNumberId: string | null | undefined
): LinhaDaConversa {
  const linha = linhaDoPhoneNumberId(phoneNumberId);
  if (linha) return linha;
  if (phoneNumberId && PHONE_NUMBER_ID.test(phoneNumberId) && linhaConfigurada(LINHA_PADRAO)) {
    return linhaDeOutroNumero(phoneNumberId);
  }
  return LINHA_PADRAO;
}

/**
 * As caixas que o perfil alcança na tela de conversas. Os outros números são
 * só do administrador — eram dele antes, quando caíam em comunicados.
 */
export function caixasDoPerfil(perfil: Perfil): Caixa[] {
  if (perfil === "admin") return [...CAIXAS];
  return linhasDoPerfil(perfil);
}

/** A caixa escolhida ou, sem escolha válida, todas as do perfil. */
export function caixasPedidas(perfil: Perfil, pedida: unknown): Caixa[] {
  const minhas = caixasDoPerfil(perfil);
  return ehCaixa(pedida) && minhas.includes(pedida) ? [pedida] : minhas;
}
