/**
 * Cadastro de origens de webhook pela tela (docs/plano-webhooks-leads.md).
 *
 * A fase A cadastrava origem por script; quem opera o marketing não abre
 * terminal. Aqui ficam as regras compartilhadas entre a API e a tela, para as
 * duas não divergirem no que é um slug válido ou no que vai no mapeamento.
 *
 * Este arquivo é PURO de propósito — nada de banco, nada de `crypto`. Ele é
 * importado pela tela, e um import de servidor aqui arrastaria o driver do
 * Postgres para o pacote do navegador (o build quebra em `dns`). A geração de
 * token, que precisa de `crypto`, mora em `origens-token.ts`.
 */

import { ESTAGIO_INICIAL } from "@/components/leads/estagios";

/** Campos que o mapeamento sabe preencher, na ordem em que a tela os mostra. */
export const CAMPOS_MAPEAVEIS = [
  { campo: "name", rotulo: "Nome", exemplo: "nome" },
  { campo: "email", rotulo: "E-mail", exemplo: "email" },
  { campo: "phone", rotulo: "Telefone", exemplo: "telefone" },
  { campo: "company", rotulo: "Empresa", exemplo: "empresa" },
  { campo: "tags", rotulo: "Tags", exemplo: "tags" },
  {
    campo: "externalId",
    rotulo: "Id externo",
    exemplo: "id",
  },
  { campo: "sourceChannel", rotulo: "Canal de origem", exemplo: "canal" },
  { campo: "utmSource", rotulo: "utm_source", exemplo: "utm_source" },
  { campo: "utmMedium", rotulo: "utm_medium", exemplo: "utm_medium" },
  { campo: "utmCampaign", rotulo: "utm_campaign", exemplo: "utm_campaign" },
  { campo: "utmContent", rotulo: "utm_content", exemplo: "utm_content" },
  { campo: "utmTerm", rotulo: "utm_term", exemplo: "utm_term" },
  { campo: "landingPage", rotulo: "Página de entrada", exemplo: "pagina" },
  { campo: "referrer", rotulo: "Referrer", exemplo: "referrer" },
] as const;

export type CampoMapeavel = (typeof CAMPOS_MAPEAVEIS)[number]["campo"];

const CAMPOS_VALIDOS = new Set<string>(CAMPOS_MAPEAVEIS.map((c) => c.campo));

/** Mapeamento inicial no formato que o Make costuma mandar. */
export const MAPEAMENTO_PADRAO: Record<string, string> = Object.fromEntries(
  CAMPOS_MAPEAVEIS.map((c) => [c.campo, c.exemplo])
);

/** Corpo de exemplo mostrado na tela, coerente com o mapeamento padrão. */
export const PAYLOAD_DE_EXEMPLO = {
  nome: "Maria Silva",
  email: "maria@empresa.com.br",
  telefone: "31 99999-8888",
  empresa: "Empresa Exemplo",
  utm_source: "instagram",
  utm_medium: "social",
  utm_campaign: "lancamento-agosto",
  pagina: "https://avantejuntos.com.br/planos",
};

/**
 * Slug: vira URL pública, então só minúsculas, números e hífen. Sem isso um
 * nome com acento ou barra geraria uma URL que o Make não consegue chamar.
 */
export function normalizarSlug(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function slugValido(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,47}$/.test(slug);
}

/** Só os campos conhecidos, e só com caminho não vazio. */
export function limparMapeamento(valor: unknown): Record<string, string> {
  if (!valor || typeof valor !== "object") return {};
  const limpo: Record<string, string> = {};
  for (const [campo, caminho] of Object.entries(
    valor as Record<string, unknown>
  )) {
    if (!CAMPOS_VALIDOS.has(campo)) continue;
    if (typeof caminho !== "string") continue;
    const cru = caminho.trim();
    if (cru) limpo[campo] = cru;
  }
  return limpo;
}

/**
 * A origem sem o hash do token. A tela não tem o que fazer com ele, e o que não
 * trafega não aparece em log de navegador nem em histórico de requisição.
 */
export function semTokenHash<T extends { tokenHash?: string }>(
  origem: T
): Omit<T, "tokenHash"> {
  const copia = { ...origem };
  delete copia.tokenHash;
  return copia;
}

export interface DefaultsDaOrigem {
  tags: string[];
  stage: string;
  consentimento: boolean;
  // A coluna é jsonb livre e já guarda defaults antigos (o `listId` da fase A,
  // por exemplo). O índice mantém o tipo compatível com o que o banco aceita
  // sem obrigar um cast a cada gravação.
  [chave: string]: unknown;
}

/**
 * `listId` NÃO faz parte disto de propósito: desde a trava 1 (fase B) o destino
 * é sempre a lista de leads, então expor a escolha na tela seria oferecer uma
 * opção que o sistema ignora.
 */
export function limparDefaults(
  valor: unknown,
  tagsNormalizadas: string[]
): DefaultsDaOrigem {
  const bruto = (valor ?? {}) as Record<string, unknown>;
  return {
    tags: tagsNormalizadas,
    stage: typeof bruto.stage === "string" ? bruto.stage : ESTAGIO_INICIAL,
    // Padrão do sistema é LIBERAR; a origem bloqueia quando for lista comprada
    // ou formulário sem aviso de comunicação.
    consentimento: bruto.consentimento !== false,
  };
}
