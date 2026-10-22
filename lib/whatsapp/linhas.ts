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
