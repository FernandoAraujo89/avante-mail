import { and, eq, isNotNull } from "drizzle-orm";

import { campaignSends, contactLists, getDb, type Contact } from "@/lib/db";

// Condições do passo Se/Então (docs/plano-automacoes.md, fase 3).
//
// O config do passo:
//
//   {
//     "match": "all" | "any",              // padrão: "all"
//     "conditions": [
//       { "type": "has_tag", "tag": "vip" },
//       { "type": "email_opened", "stepId": "<passo de envio>", "negate": true }
//     ]
//   }
//
// As condições de abertura/clique/resposta olham os envios DESTE percurso
// (campaign_sends.automation_run_id) — é o que permite "mandou o e-mail,
// esperou 2 dias, abriu?". Com `stepId`, olham um passo específico; sem ele,
// qualquer envio do percurso.

export const AUTOMATION_CONDITION_TYPES = [
  "has_tag",
  "in_list",
  "email_opened",
  "email_clicked",
  "whatsapp_replied",
  "whatsapp_subscribed",
  "field_equals",
] as const;
export type AutomationConditionType =
  (typeof AUTOMATION_CONDITION_TYPES)[number];

export interface AutomationCondition {
  type: AutomationConditionType;
  /** Inverte o resultado desta condição ("não tem a tag", "não abriu"). */
  negate?: boolean;
  tag?: string;
  listId?: string;
  /** Passo de envio a observar; ausente = qualquer envio do percurso. */
  stepId?: string;
  field?: "name" | "email" | "company" | "phone";
  value?: string;
}

export interface CondicoesDoPasso {
  match: "all" | "any";
  conditions: AutomationCondition[];
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Lê e valida o config de um Se/Então. Lança com mensagem clara — sem condição
 * válida o passo não tem resposta possível, e adivinhar um lado mandaria
 * mensagem para o grupo errado.
 */
export function lerCondicoes(
  config: Record<string, unknown> | null
): CondicoesDoPasso {
  const c = config ?? {};
  const bruto = Array.isArray(c.conditions) ? c.conditions : [];
  if (bruto.length === 0) {
    throw new Error("passo Se/Então sem condição configurada");
  }

  const match = c.match === "any" ? "any" : "all";
  const conditions = bruto.map((item, i) => {
    const cond = (item ?? {}) as Record<string, unknown>;
    const type = texto(cond.type) as AutomationConditionType;
    if (!AUTOMATION_CONDITION_TYPES.includes(type)) {
      throw new Error(
        `condição ${i + 1} do Se/Então tem tipo desconhecido: "${cond.type}"`
      );
    }
    if (type === "has_tag" && !texto(cond.tag)) {
      throw new Error(`condição ${i + 1} do Se/Então sem tag`);
    }
    if (type === "in_list" && !texto(cond.listId)) {
      throw new Error(`condição ${i + 1} do Se/Então sem lista`);
    }
    if (type === "field_equals" && !texto(cond.field)) {
      throw new Error(`condição ${i + 1} do Se/Então sem campo`);
    }
    return {
      type,
      negate: cond.negate === true,
      tag: texto(cond.tag).toLowerCase() || undefined,
      listId: texto(cond.listId) || undefined,
      stepId: texto(cond.stepId) || undefined,
      field: (texto(cond.field) || undefined) as
        | AutomationCondition["field"]
        | undefined,
      value: typeof cond.value === "string" ? cond.value : undefined,
    } satisfies AutomationCondition;
  });

  return { match, conditions };
}

/** Existe envio deste percurso com a marca (abertura/clique/resposta)? */
async function envioMarcado(
  runId: string,
  stepId: string | undefined,
  coluna:
    | typeof campaignSends.openedAt
    | typeof campaignSends.clickedAt
    | typeof campaignSends.repliedAt
): Promise<boolean> {
  const filtros = [eq(campaignSends.automationRunId, runId), isNotNull(coluna)];
  if (stepId) filtros.push(eq(campaignSends.automationStepId, stepId));

  const [linha] = await getDb()
    .select({ id: campaignSends.id })
    .from(campaignSends)
    .where(and(...filtros))
    .limit(1);
  return Boolean(linha);
}

async function avaliarUma(
  cond: AutomationCondition,
  contato: Contact,
  runId: string
): Promise<boolean> {
  switch (cond.type) {
    case "has_tag":
      return (contato.tags ?? []).includes(cond.tag ?? "");

    case "in_list": {
      const [linha] = await getDb()
        .select({ listId: contactLists.listId })
        .from(contactLists)
        .where(
          and(
            eq(contactLists.contactId, contato.id),
            eq(contactLists.listId, cond.listId ?? "")
          )
        );
      return Boolean(linha);
    }

    case "email_opened":
      return envioMarcado(runId, cond.stepId, campaignSends.openedAt);

    case "email_clicked":
      return envioMarcado(runId, cond.stepId, campaignSends.clickedAt);

    case "whatsapp_replied":
      return envioMarcado(runId, cond.stepId, campaignSends.repliedAt);

    case "whatsapp_subscribed":
      return contato.whatsappSubscribed && Boolean(contato.phone);

    case "field_equals": {
      const atual = texto(contato[cond.field ?? "name"]).toLowerCase();
      return atual === texto(cond.value).toLowerCase();
    }
  }
}

/** Resultado do Se/Então: qual ramo o contato segue e por quê. */
export interface ResultadoDaCondicao {
  ramo: "yes" | "no";
  match: "all" | "any";
  detalhes: { type: string; negate: boolean; resultado: boolean }[];
}

export async function avaliarCondicoes(args: {
  config: Record<string, unknown> | null;
  contato: Contact;
  runId: string;
}): Promise<ResultadoDaCondicao> {
  const { match, conditions } = lerCondicoes(args.config);

  const detalhes: ResultadoDaCondicao["detalhes"] = [];
  for (const cond of conditions) {
    const bruto = await avaliarUma(cond, args.contato, args.runId);
    const resultado = cond.negate ? !bruto : bruto;
    detalhes.push({ type: cond.type, negate: Boolean(cond.negate), resultado });
  }

  const passou =
    match === "any"
      ? detalhes.some((d) => d.resultado)
      : detalhes.every((d) => d.resultado);

  return { ramo: passou ? "yes" : "no", match, detalhes };
}
