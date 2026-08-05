import { createHash, timingSafeEqual } from "crypto";
import { and, eq, gt, or } from "drizzle-orm";

import {
  contactLists,
  contacts,
  getDb,
  lists,
  webhookDeliveries,
  webhookSources,
  type LeadStage,
  type NewContact,
} from "@/lib/db";
import { ESTAGIO_INICIAL } from "@/components/leads/estagios";
import { emitContactEvent, emitListDiff, emitTagDiff } from "@/lib/events";
import { resolveListaDeLeads } from "@/lib/leads";
import { firstValidPhone } from "@/lib/phone";
import { EMAIL_REGEX, normalizeTags } from "@/lib/utils";

// Recebimento de leads de fora (docs/plano-webhooks-leads.md, fase A).
//
// O payload vem de plataforma de terceiro, com formato que muda sem aviso —
// por isso NADA é gravado direto: tudo passa por mapeamento declarado na
// origem, validação e normalização. O corpo cru fica em webhook_deliveries,
// que é o que permite reprocessar quando o mapeamento estava errado.

/** Teto do corpo. Lead é um punhado de campos; acima disso é abuso ou engano. */
export const TAMANHO_MAXIMO_BYTES = 64 * 1024;

/** Janela em que um corpo idêntico da mesma origem é considerado repetição. */
export const JANELA_REPETICAO_MS = 5 * 60_000;

export type AcaoDaEntrega =
  | "criado"
  | "atualizado"
  | "ignorado"
  | "rejeitado"
  | "erro";

export interface ResultadoDaEntrada {
  httpStatus: number;
  corpo: Record<string, unknown>;
  acao: AcaoDaEntrega;
  contactId?: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Comparação de hashes em tempo constante. */
export function tokenConfere(token: string, hashGuardado: string): boolean {
  const recebido = Buffer.from(hashToken(token));
  const esperado = Buffer.from(hashGuardado);
  return (
    recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
  );
}

/** Token do cabeçalho: aceita "Bearer x" e o valor cru. */
export function tokenDoCabecalho(header: string | null): string | null {
  if (!header) return null;
  const limpo = header.trim();
  if (/^bearer /i.test(limpo)) return limpo.slice(7).trim() || null;
  return limpo || null;
}

/**
 * Valor de um caminho com ponto dentro do payload: "data.contato.email".
 * Devolve undefined em qualquer tropeço — payload de terceiro não é confiável.
 */
export function valorDoCaminho(objeto: unknown, caminho: string): unknown {
  if (!caminho) return undefined;
  let atual: unknown = objeto;
  for (const parte of caminho.split(".")) {
    if (atual === null || typeof atual !== "object") return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

function texto(valor: unknown): string | null {
  if (typeof valor === "string") {
    const limpo = valor.trim();
    return limpo || null;
  }
  if (typeof valor === "number" || typeof valor === "boolean") {
    return String(valor);
  }
  return null;
}

export interface CamposExtraidos {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  externalId: string | null;
  sourceChannel: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingPage: string | null;
  referrer: string | null;
  tags: string[];
}

const CAMPOS_DE_TEXTO = [
  "name",
  "email",
  "phone",
  "company",
  "externalId",
  "sourceChannel",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
  "landingPage",
  "referrer",
] as const;

/** Aplica o mapeamento da origem sobre o payload. */
export function extrairCampos(
  payload: unknown,
  mapping: Record<string, string> | null
): CamposExtraidos {
  const mapa = mapping ?? {};
  const saida = Object.fromEntries(
    CAMPOS_DE_TEXTO.map((campo) => [
      campo,
      mapa[campo] ? texto(valorDoCaminho(payload, mapa[campo])) : null,
    ])
  ) as Record<(typeof CAMPOS_DE_TEXTO)[number], string | null>;

  const tagsCruas = mapa.tags
    ? valorDoCaminho(payload, mapa.tags)
    : undefined;

  return { ...saida, tags: normalizeTags(tagsCruas) };
}

/**
 * Processa uma entrega já autenticada. Recebe o payload já lido para a rota
 * poder calcular o hash e medir o tamanho antes de chegar aqui.
 */
export async function processarEntrada(args: {
  sourceId: string;
  slug: string;
  payload: unknown;
  payloadHash: string;
}): Promise<ResultadoDaEntrada> {
  const db = getDb();

  const [origem] = await db
    .select()
    .from(webhookSources)
    .where(eq(webhookSources.id, args.sourceId));

  if (!origem) {
    return {
      httpStatus: 404,
      corpo: { ok: false, erro: "Origem não encontrada." },
      acao: "rejeitado",
    };
  }

  // Repetição: mesmo corpo, mesma origem, poucos minutos. Contém cenário em
  // laço e re-execução manual, que no Make é comum.
  const [repetida] = await db
    .select({ id: webhookDeliveries.id, contactId: webhookDeliveries.contactId })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.sourceId, origem.id),
        eq(webhookDeliveries.payloadHash, args.payloadHash),
        gt(
          webhookDeliveries.createdAt,
          new Date(Date.now() - JANELA_REPETICAO_MS)
        )
      )
    )
    .limit(1);

  if (repetida) {
    await registrar(origem.id, args, "ignorado", {
      motivo: "entrega repetida",
    });
    return {
      httpStatus: 200,
      corpo: { ok: true, acao: "ignorado", motivo: "entrega repetida" },
      acao: "ignorado",
      contactId: repetida.contactId ?? undefined,
    };
  }

  const campos = extrairCampos(args.payload, origem.mapping);
  const padroes = (origem.defaults ?? {}) as Record<string, unknown>;

  const email = campos.email?.toLowerCase() ?? null;
  const telefone = campos.phone ? firstValidPhone(campos.phone) : null;

  // Precisa de ao menos uma identidade utilizável.
  if (!email && !telefone) {
    const erro = "Sem e-mail nem telefone válidos no payload.";
    await registrar(origem.id, args, "rejeitado", { erro });
    return {
      httpStatus: 422,
      corpo: { ok: false, erro },
      acao: "rejeitado",
    };
  }
  if (email && !EMAIL_REGEX.test(email)) {
    const erro = "E-mail inválido.";
    await registrar(origem.id, args, "rejeitado", { erro, valor: email });
    return {
      httpStatus: 422,
      corpo: { ok: false, erro, campo: origem.mapping?.email ?? "email" },
      acao: "rejeitado",
    };
  }

  // Identidade: e-mail OU telefone já existentes viram atualização — é a
  // defesa que impede lead repetido de virar contato duplicado.
  const condicoes = [
    email ? eq(contacts.email, email) : undefined,
    telefone ? eq(contacts.phone, telefone) : undefined,
  ].filter(Boolean);
  const [existente] = await db
    .select()
    .from(contacts)
    .where(condicoes.length > 1 ? or(...condicoes) : condicoes[0])
    .limit(1);

  const tags = [...new Set([...normalizeTags(padroes.tags), ...campos.tags])];
  const listId = typeof padroes.listId === "string" ? padroes.listId : null;
  const stage = (
    typeof padroes.stage === "string" ? padroes.stage : ESTAGIO_INICIAL
  ) as LeadStage;
  // O padrão do sistema é LIBERAR: o lead entra apto a receber, e a origem
  // bloqueia quando for o caso (`"consentimento": false` nos defaults) — por
  // exemplo uma lista comprada ou um formulário sem aviso de comunicação.
  const consentimento = padroes.consentimento !== false;

  let contactId: string;
  let acao: AcaoDaEntrega;

  if (existente) {
    acao = "atualizado";
    contactId = existente.id;

    const tagsDepois = [...new Set([...(existente.tags ?? []), ...tags])];
    await db
      .update(contacts)
      .set({
        // Só completa o que falta: dado vindo de fora não sobrescreve o que
        // já foi conferido aqui dentro.
        name: existente.name || campos.name || existente.name,
        company: existente.company ?? campos.company,
        phone: existente.phone ?? telefone,
        tags: tagsDepois,
      })
      .where(eq(contacts.id, existente.id));

    await emitTagDiff(existente.id, existente.tags, tagsDepois);
  } else {
    acao = "criado";
    const novo: NewContact = {
      name: campos.name || email || telefone || "Sem nome",
      // O e-mail é obrigatório na tabela; sem ele, gera um marcador estável
      // a partir do telefone, para o contato existir e poder ser completado.
      email: email ?? `${telefone?.replace(/\D/g, "")}@sem-email.local`,
      phone: telefone,
      company: campos.company,
      tags,
      subscribed: consentimento,
      whatsappSubscribed: consentimento && telefone !== null,
      whatsappOptInAt: consentimento && telefone ? new Date() : null,
      stage,
      sourceChannel: campos.sourceChannel ?? campos.utmSource,
      utmSource: campos.utmSource,
      utmMedium: campos.utmMedium,
      utmCampaign: campos.utmCampaign,
      utmContent: campos.utmContent,
      utmTerm: campos.utmTerm,
      landingPage: campos.landingPage,
      referrer: campos.referrer,
      sourceDetail: origem.name,
      acquiredAt: new Date(),
    };

    const [criado] = await db.insert(contacts).values(novo).returning();
    contactId = criado.id;

    await emitContactEvent("contact_created", contactId, {
      origem: origem.slug,
      canal: novo.sourceChannel ?? null,
    });
    await emitTagDiff(contactId, [], tags);
  }

  // TRAVA 1: lead entra SÓ na lista de leads. O `listId` vem do defaults da
  // origem, que é dado editável — um id trocado à mão despejaria leads na lista
  // de parceiros, e daí em diante toda campanha de parceiro os alcançaria.
  const destino = await destinoDoLead(listId);

  if (destino.listId) {
    const inserido = await db
      .insert(contactLists)
      .values({ contactId, listId: destino.listId })
      .onConflictDoNothing()
      .returning({ contactId: contactLists.contactId });
    if (inserido.length > 0) {
      await emitListDiff(contactId, [], [destino.listId]);
    }
  }

  await db
    .update(webhookSources)
    .set({ lastSeenAt: new Date() })
    .where(eq(webhookSources.id, origem.id));

  const resultado = {
    acao,
    tags,
    stage,
    consentimento,
    listId: destino.listId,
    // Fica registrado o que a origem PEDIU e não foi feito: sem isto, uma
    // origem mal configurada só apareceria como leads sumidos da lista.
    ...(destino.recusada ? { listaRecusada: destino.recusada } : {}),
  };
  await registrar(origem.id, args, acao, resultado, contactId);

  return {
    httpStatus: 200,
    corpo: { ok: true, acao, contactId, tags },
    acao,
    contactId,
  };
}

/**
 * TRAVA 1 (docs/plano-webhooks-leads.md, seção 5): o único destino possível de
 * um lead é uma lista marcada como de leads.
 *
 * A lista pedida pela origem só vale se for de leads; qualquer outra é
 * RECUSADA e o lead cai na lista de leads do sistema. Recusar em vez de
 * obedecer é a escolha certa aqui: a lista errada não some, ela vira público de
 * campanha de parceiro no dia seguinte.
 *
 * Sem nenhuma lista de leads cadastrada, o lead entra sem lista — perder o
 * lead seria pior, e o estágio (`stage`) já o identifica na gestão.
 */
async function destinoDoLead(
  pedida: string | null
): Promise<{ listId: string | null; recusada: string | null }> {
  const db = getDb();

  if (pedida) {
    const [lista] = await db
      .select({ id: lists.id, kind: lists.kind })
      .from(lists)
      .where(eq(lists.id, pedida))
      .limit(1);
    if (lista?.kind === "leads") return { listId: lista.id, recusada: null };
  }

  const padrao = await resolveListaDeLeads();
  return {
    listId: padrao?.id ?? null,
    recusada: pedida && pedida !== padrao?.id ? pedida : null,
  };
}

async function registrar(
  sourceId: string,
  args: { payload: unknown; payloadHash: string },
  status: AcaoDaEntrega,
  resultado: Record<string, unknown>,
  contactId?: string
): Promise<void> {
  try {
    await getDb().insert(webhookDeliveries).values({
      sourceId,
      payloadHash: args.payloadHash,
      payload: args.payload as never,
      status,
      contactId: contactId ?? null,
      resultado,
      erro: typeof resultado.erro === "string" ? resultado.erro : null,
    });
  } catch (error) {
    // Registrar é secundário: não pode derrubar o recebimento do lead.
    console.error("[webhook/entrada] falhou ao registrar entrega:", error);
  }
}
