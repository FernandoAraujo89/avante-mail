import { getSetting, setSetting } from "@/lib/settings";

/**
 * A base legal do rastreio de site (LGPD, art. 7º).
 *
 * É configuração, e não um valor fixo no código, por três motivos: a decisão é
 * do negócio e não do desenvolvedor; ela muda sem deploy; e fica VISÍVEL na
 * tela, em vez de escondida num arquivo que ninguém abre. Quem responder por
 * isso um dia consegue ver o que está valendo sem pedir para ninguém.
 *
 *  "consentimento"      — o script fica inerte até o site chamar
 *                         av('consentimento', true). É o padrão.
 *  "legitimo_interesse" — o script coleta desde o carregamento. Escolhido em
 *                         05/08/2026, alinhado ao que o site já faz com GA,
 *                         Meta Pixel e Clarity.
 *
 * O QUE NÃO MUDA COM O MODO — e é o que sustenta o legítimo interesse:
 *  - GPC e Do Not Track continuam bloqueando de forma dura;
 *  - av('consentimento', false) continua funcionando e o "não" é persistido;
 *  - o descadastro do e-mail revoga o rastreio na hora (o endpoint consulta a
 *    supressão), então o direito de oposição já existe em todo rodapé de
 *    e-mail que a Avante manda;
 *  - só LEAD identificado é rastreado, nunca parceiro nem visitante anônimo.
 */

export const CHAVE_BASE_LEGAL = "rastreio_base_legal";

export const BASES_LEGAIS = ["consentimento", "legitimo_interesse"] as const;
export type BaseLegal = (typeof BASES_LEGAIS)[number];

/** Padrão: consentimento. Quem quiser o outro precisa dizer explicitamente. */
export async function lerBaseLegal(): Promise<BaseLegal> {
  const valor = await getSetting(CHAVE_BASE_LEGAL);
  return valor === "legitimo_interesse" ? "legitimo_interesse" : "consentimento";
}

export async function gravarBaseLegal(valor: BaseLegal): Promise<void> {
  await setSetting(CHAVE_BASE_LEGAL, valor);
}
