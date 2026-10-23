import type { WhatsAppVariableMap } from "@/lib/whatsapp/types";

// A pré-visualização da Expansão: o convite (e-mail e WhatsApp) e a pesquisa
// como o parceiro recebe, com um parceiro de EXEMPLO no lugar do nome real.
// Puro — a página /pesquisa/previa/[id] e o construtor usam o mesmo exemplo,
// para o e-mail da prévia e a página da prévia falarem da mesma pessoa.

/** Nome e empresa genéricos, para ficar claro que é amostra. */
export const PARCEIRO_DE_EXEMPLO = {
  name: "Nome do parceiro",
  company: "Empresa do parceiro",
} as const;

/** O link da pré-visualização da pesquisa: a página real, sem convite. */
export function linkDaPrevia(surveyId: string, baseUrl = ""): string {
  return `${baseUrl.replace(/\/$/, "")}/pesquisa/previa/${surveyId}`;
}

/**
 * Os valores das variáveis {{n}} do modelo de WhatsApp para o parceiro de
 * exemplo. Variável sem fonte escolhida (ou texto fixo vazio) fica como
 * "{{n}}" na prévia — é o que falta configurar.
 */
export function valoresDeExemplo(
  variaveis: WhatsAppVariableMap,
  parceiro: { name: string; company: string | null } = PARCEIRO_DE_EXEMPLO
): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const [n, fonte] of Object.entries(variaveis)) {
    if (fonte.source === "name") valores[n] = parceiro.name;
    else if (fonte.source === "company") valores[n] = parceiro.company ?? "sua empresa";
    else if (fonte.value.trim()) valores[n] = fonte.value.trim();
  }
  return valores;
}
