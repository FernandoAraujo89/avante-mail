import { createHash, timingSafeEqual } from "crypto";
import { and, eq, gt } from "drizzle-orm";

import {
  contactLists,
  contacts,
  getDb,
  lists,
  webhookDeliveries,
  webhookSources,
  type NewContact,
} from "@/lib/db";
import { fonteDe, fonteDoUtm } from "@/lib/leads/fonte";
import { aplicarMudancaDoLead } from "@/lib/leads/mudanca";
import { emitContactEvent, emitListDiff, emitTagDiff } from "@/lib/events";
import { resolveListaDeLeads } from "@/lib/leads";
import {
  ETAPA_DE_ENTRADA,
  resolverEtapa,
} from "@/lib/leads/etapas";
import { resolverQualificacao } from "@/lib/leads/qualificacoes";
import {
  costurarVisitante,
  type ResultadoDaCostura,
} from "@/lib/track/costura";
import { visitanteSeguro } from "@/lib/track/site";
import {
  adicionarEnderecos,
  contatosPorEnderecos,
} from "@/lib/contatos/enderecos";
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
  /** Qualificação do playbook do SDR, como o agente a mandou. */
  qualification: string | null;
  /** Etapa do funil do Pipedrive — slug ou rótulo por extenso. */
  stage: string | null;
  /**
   * Identidade anônima do navegador (campo oculto `av_visitante` do
   * formulário, preenchido pelo script do site). É o que permite COSTURAR as
   * visitas de antes do formulário na linha do tempo do lead.
   */
  visitorId: string | null;
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
  "qualification",
  "stage",
  "visitorId",
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
  // defesa que impede lead repetido de virar contato duplicado. Procura em
  // TODOS os endereços do contato, não só no principal.
  const donos = await contatosPorEnderecos(db, {
    emails: email ? [email] : [],
    phones: telefone ? [telefone] : [],
  });
  const idExistente =
    (email ? donos.porEmail.get(email) : undefined) ??
    (telefone ? donos.porTelefone.get(telefone) : undefined) ??
    null;
  const [existente] = idExistente
    ? await db.select().from(contacts).where(eq(contacts.id, idExistente))
    : [];

  const tags = [...new Set([...normalizeTags(padroes.tags), ...campos.tags])];
  const listId = typeof padroes.listId === "string" ? padroes.listId : null;
  // O padrão do sistema é LIBERAR: o lead entra apto a receber, e a origem
  // bloqueia quando for o caso (`"consentimento": false` nos defaults) — por
  // exemplo uma lista comprada ou um formulário sem aviso de comunicação.
  const consentimento = padroes.consentimento !== false;

  // O que a entrega PEDIU e não foi feito. Vai para o log: uma qualificação
  // escrita errada precisa aparecer em algum lugar, senão o operador só vê um
  // lead que "não recebeu a trilha certa" e não tem como descobrir por quê.
  const recusas: Record<string, string> = {};

  // ── Qualificação e etapa: é o AGENTE que manda ───────────────────────────
  //
  // Ao contrário de nome e empresa (que só completam lacunas), estes dois
  // SOBRESCREVEM: eles são o motivo do webhook existir. O agente qualifica o
  // lead e acompanha o funil no Pipedrive; o que ele diz é mais recente do que
  // qualquer coisa daqui.
  const qualificacaoPedida =
    campos.qualification ??
    (typeof padroes.qualification === "string" ? padroes.qualification : null);
  const qualificacao = qualificacaoPedida
    ? (await resolverQualificacao(qualificacaoPedida))?.slug ?? null
    : null;
  if (qualificacaoPedida && !qualificacao) {
    recusas.qualificacao = qualificacaoPedida;
  }

  const etapaPedida =
    campos.stage ??
    (typeof padroes.stage === "string" ? padroes.stage : null);
  const etapa = etapaPedida ? await resolverEtapa(etapaPedida) : null;
  if (etapaPedida && !etapa) recusas.etapa = etapaPedida;

  let contactId: string;
  let acao: AcaoDaEntrega;
  // A etapa que a entrega REALMENTE aplicou. Não é `etapa?.slug`: numa criação
  // sem etapa no payload o lead vai para a etapa de entrada, e o log dizendo
  // "null" mandaria quem investiga procurar um problema que não existe.
  let etapaAplicada: string | null = null;
  let percursosEncerrados = 0;
  let convertidoPara: string | null = null;

  // ── A COSTURA do rastreio (fase E.2) ─────────────────────────────────
  // O formulário trouxe a identidade anônima do navegador: as visitas de
  // ANTES deste momento viram linha do tempo do lead — com a data original,
  // para o score decair certo. Roda assim que o contato existe e ANTES dos
  // eventos da entrega (fase 1.5): o primeiro toque do site preenche a
  // origem que o formulário não trouxe, e o evento de criação nasce sabendo.
  // Em try próprio: uma falha aqui não pode derrubar a entrega do lead.
  let visitasCosturadas = 0;
  const visitanteDoSite = visitanteSeguro(campos.visitorId);
  async function costurar(id: string): Promise<ResultadoDaCostura | null> {
    if (!visitanteDoSite) return null;
    try {
      const resultado = await costurarVisitante(visitanteDoSite, id);
      visitasCosturadas = resultado.eventos;
      return resultado;
    } catch (error) {
      console.error("[webhook/entrada] costura do rastreio falhou:", error);
      return null;
    }
  }

  if (existente) {
    acao = "atualizado";
    contactId = existente.id;

    // TRAVA: contato que NÃO é lead não vira lead por webhook.
    //
    // Um parceiro que aparece num payload do agente teria o `stage` preenchido
    // e, com isso, sairia calado de toda campanha de parceiro (é `stage` que
    // define quem é lead — ver lib/leads.ts). Recusar e registrar é a mesma
    // escolha da trava 1: o erro precisa aparecer, não sumir.
    const ehLead = existente.stage !== null;
    if (!ehLead && (qualificacao || etapa)) {
      recusas.naoEhLead =
        "contato já existe como parceiro/cliente; etapa e qualificação não foram aplicadas";
    }

    const tagsDepois = [...new Set([...(existente.tags ?? []), ...tags])];

    await db
      .update(contacts)
      .set({
        // Só completa o que falta: dado vindo de fora não sobrescreve o que
        // já foi conferido aqui dentro.
        name: existente.name || campos.name || existente.name,
        company: existente.company ?? campos.company,
        tags: tagsDepois,
      })
      .where(eq(contacts.id, existente.id));

    // E-mail ou telefone que o contato ainda não tinha entra como mais um
    // endereço dele (o que ele já tem fica como está). Pertencendo a OUTRO
    // contato, não é movido — e o mapa acima já teria casado com ele.
    await adicionarEnderecos(db, existente.id, {
      emails: email ? [{ email, subscribed: consentimento }] : [],
      phones: telefone ? [{ phone: telefone, whatsapp: consentimento }] : [],
    });

    // Lead que já existia sem origem ganha a do primeiro toque; o evento de
    // criação, que é passado, não é reescrito.
    await costurar(existente.id);

    await emitTagDiff(existente.id, existente.tags, tagsDepois);

    // Qualificação e etapa passam pela regra ÚNICA (lib/leads/mudanca.ts) — a
    // mesma da sincronização com o Pipedrive: encerramento antes do evento,
    // conversão em parceiro depois da chegada, e não tocar em quem não é lead.
    const aplicado = await aplicarMudancaDoLead(existente, {
      qualificacao,
      etapa,
      origem: `webhook:${origem.slug}`,
    });
    if (aplicado.mudouEtapa && etapa) etapaAplicada = etapa.slug;
    percursosEncerrados = aplicado.percursosEncerrados;
    if (aplicado.convertidoPara) convertidoPara = aplicado.convertidoPara;
    if (aplicado.conversaoRecusada) {
      recusas.conversao = aplicado.conversaoRecusada;
    }
  } else {
    acao = "criado";
    const novo: NewContact = {
      name: campos.name || email || telefone || "Sem nome",
      // E-mail, telefone e consentimento entram pelo módulo de endereços,
      // logo depois do insert — é ele que preenche o resumo do contato.
      company: campos.company,
      tags,
      // Sem etapa no payload, o lead entra na etapa de entrada: ele existe e
      // ainda não andou no funil do Pipedrive.
      stage: etapa?.slug ?? ETAPA_DE_ENTRADA,
      stageChangedAt: new Date(),
      qualification: qualificacao,
      qualifiedAt: qualificacao ? new Date() : null,
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
    etapaAplicada = novo.stage ?? null;
    await adicionarEnderecos(db, criado.id, {
      emails: email ? [{ email, subscribed: consentimento }] : [],
      phones: telefone ? [{ phone: telefone, whatsapp: consentimento }] : [],
    });

    // A costura vem ANTES do evento de criação: se o formulário não disse de
    // onde a pessoa veio, a primeira visita costurada pode dizer — e o
    // evento precisa nascer já com a resposta, porque é ele que a regra
    // "entrou como lead pelo Instagram" pontua.
    const costura = await costurar(contactId);

    await emitContactEvent("contact_created", contactId, {
      origem: origem.slug,
      // O canal cru da origem ou, na falta dele, o que a costura preencheu.
      // Continua texto livre de propósito: uma automação pode estar casando
      // com ele.
      canal: novo.sourceChannel ?? costura?.preenchido?.sourceChannel ?? null,
      // A rede normalizada (fase E.3): "Instagram", "ig" e "l.instagram.com"
      // viram `instagram`, que é o que a regra de pontuação compara. A UTM
      // vem primeiro: o canal pode dizer "site" quando a UTM diz de qual
      // rede a pessoa saiu. Por último, o primeiro toque do site.
      fonte:
        fonteDoUtm(campos.utmSource) ??
        fonteDe(campos.sourceChannel, campos.referrer) ??
        costura?.primeiroToque?.fonte ??
        null,
    });
    await emitTagDiff(contactId, [], tags);

    if (qualificacao) {
      await emitContactEvent("lead_qualified", contactId, {
        de: null,
        qualificacao,
      });
    }
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
    stage: etapaAplicada,
    qualificacao,
    consentimento,
    ...(percursosEncerrados > 0 ? { percursosEncerrados } : {}),
    ...(convertidoPara ? { convertidoPara } : {}),
    ...(visitasCosturadas > 0 ? { visitasCosturadas } : {}),
    ...(Object.keys(recusas).length > 0 ? { recusas } : {}),
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
