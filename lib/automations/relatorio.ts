import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import {
  automationRuns,
  automationRunSteps,
  automations,
  automationSteps,
  automationVersions,
  campaignSends,
  contacts,
  getDb,
  whatsappTemplates,
  type AutomationRunStatus,
  type AutomationStepType,
} from "@/lib/db";
import {
  sesPricePerEmailUsd,
  usdToBrlRate,
  whatsAppPriceUsd,
} from "@/lib/pricing";

// Relatório da automação (docs/plano-automacoes.md, fase 5).
//
// Duas perguntas diferentes, respondidas por caminhos diferentes:
//  - "onde estão os contatos AGORA?" → automation_runs.current_step_id;
//  - "o que já aconteceu?" → automation_run_steps (log por passo) e
//    campaign_sends (entrega, abertura, clique, resposta e custo).

export interface ResumoDaAutomacao {
  entraram: number;
  noFluxo: number;
  concluidos: number;
  parados: number;
  falhos: number;
}

export interface EnviosDoPasso {
  total: number;
  enviados: number;
  entregues: number;
  abertos: number;
  cliques: number;
  respostas: number;
  falhas: number;
}

export interface MetricaDoPasso {
  stepId: string;
  parentId: string | null;
  branch: string;
  position: number;
  /** Profundidade na árvore — o relatório indenta os ramos por ela. */
  nivel: number;
  type: AutomationStepType;
  config: Record<string, unknown> | null;
  /** Contatos parados NESTE passo agora (aguardando ou prestes a executar). */
  agora: number;
  /** Percursos que já executaram este passo. */
  passaram: number;
  /** Só para passos de envio. */
  envios: EnviosDoPasso | null;
  custoUsd: number;
}

export interface RelatorioDaAutomacao {
  versao: number;
  resumo: ResumoDaAutomacao;
  passos: MetricaDoPasso[];
  custoUsd: number;
  custoBrl: number;
  /** Percursos que entraram por versões anteriores — ficam fora do por-passo. */
  percursosDeOutrasVersoes: number;
}

/**
 * Ordena os passos como o contato os percorre: a coluna principal e, ao
 * chegar num Se/Então, primeiro o lado "Sim" inteiro, depois o "Não".
 * Ordenar por `position` cru misturaria os ramos com o tronco — cada grupo
 * começa do zero — e o relatório ficaria ilegível.
 */
function ordenarComoOFluxo(passos: MetricaDoPasso[]): MetricaDoPasso[] {
  const saida: MetricaDoPasso[] = [];

  const visitar = (parentId: string | null, branch: string, nivel: number) => {
    const irmaos = passos
      .filter((p) => p.parentId === parentId && p.branch === branch)
      .sort((a, b) => a.position - b.position);

    for (const passo of irmaos) {
      saida.push({ ...passo, nivel });
      if (passo.type === "if_else") {
        visitar(passo.stepId, "yes", nivel + 1);
        visitar(passo.stepId, "no", nivel + 1);
      }
    }
  };

  visitar(null, "main", 0);

  // Passo órfão (versão editada por API, por exemplo) não pode sumir do
  // relatório só por não estar pendurado na árvore.
  const vistos = new Set(saida.map((p) => p.stepId));
  return [...saida, ...passos.filter((p) => !vistos.has(p.stepId))];
}

/**
 * Relatório da automação. As métricas POR PASSO valem para a versão corrente:
 * editar uma automação em uso cria uma versão nova, com passos novos, e o
 * percurso de quem entrou antes aponta para os passos da versão dele.
 */
export async function relatorioDaAutomacao(
  automationId: string
): Promise<RelatorioDaAutomacao | null> {
  const db = getDb();

  const [automacao] = await db
    .select({ currentVersionId: automations.currentVersionId })
    .from(automations)
    .where(eq(automations.id, automationId));
  if (!automacao) return null;

  const versionId = automacao.currentVersionId;

  const [versao] = versionId
    ? await db
        .select({ version: automationVersions.version })
        .from(automationVersions)
        .where(eq(automationVersions.id, versionId))
    : [];

  // ─── Resumo ────────────────────────────────────────────────────
  const [resumoLinha] = await db
    .select({
      entraram: sql<number>`count(*)`.mapWith(Number),
      noFluxo:
        sql<number>`count(*) filter (where ${automationRuns.status} in ('running','waiting'))`.mapWith(
          Number
        ),
      concluidos:
        sql<number>`count(*) filter (where ${automationRuns.status} = 'done')`.mapWith(
          Number
        ),
      parados:
        sql<number>`count(*) filter (where ${automationRuns.status} = 'stopped')`.mapWith(
          Number
        ),
      falhos:
        sql<number>`count(*) filter (where ${automationRuns.status} = 'failed')`.mapWith(
          Number
        ),
      deOutrasVersoes: versionId
        ? sql<number>`count(*) filter (where ${automationRuns.versionId} <> ${versionId})`.mapWith(
            Number
          )
        : sql<number>`0`.mapWith(Number),
    })
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId));

  const resumo: ResumoDaAutomacao = {
    entraram: resumoLinha?.entraram ?? 0,
    noFluxo: resumoLinha?.noFluxo ?? 0,
    concluidos: resumoLinha?.concluidos ?? 0,
    parados: resumoLinha?.parados ?? 0,
    falhos: resumoLinha?.falhos ?? 0,
  };

  if (!versionId) {
    return {
      versao: versao?.version ?? 1,
      resumo,
      passos: [],
      custoUsd: 0,
      custoBrl: 0,
      percursosDeOutrasVersoes: resumoLinha?.deOutrasVersoes ?? 0,
    };
  }

  // ─── Passos da versão corrente ─────────────────────────────────
  const passos = await db
    .select()
    .from(automationSteps)
    .where(eq(automationSteps.versionId, versionId))
    .orderBy(asc(automationSteps.position));

  // Onde os contatos estão AGORA.
  const agora = await db
    .select({
      stepId: automationRuns.currentStepId,
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.automationId, automationId),
        inArray(automationRuns.status, ["running", "waiting"]),
        isNotNull(automationRuns.currentStepId)
      )
    )
    .groupBy(automationRuns.currentStepId);

  // Quem já executou cada passo (um percurso conta uma vez por passo).
  const passaram = await db
    .select({
      stepId: automationRunSteps.stepId,
      total: sql<number>`count(distinct ${automationRunSteps.runId})`.mapWith(
        Number
      ),
    })
    .from(automationRunSteps)
    .innerJoin(
      automationRuns,
      eq(automationRuns.id, automationRunSteps.runId)
    )
    .where(eq(automationRuns.automationId, automationId))
    .groupBy(automationRunSteps.stepId);

  // Entrega, leitura e custo vêm de campaign_sends — a mesma tabela das
  // campanhas, que é justamente o motivo de a fase 2 ter reaproveitado ela.
  const envios = await db
    .select({
      stepId: campaignSends.automationStepId,
      channel: campaignSends.channel,
      total: sql<number>`count(*)`.mapWith(Number),
      enviados:
        sql<number>`count(*) filter (where ${campaignSends.sentAt} is not null)`.mapWith(
          Number
        ),
      entregues:
        sql<number>`count(*) filter (where ${campaignSends.deliveredAt} is not null)`.mapWith(
          Number
        ),
      abertos:
        sql<number>`count(*) filter (where ${campaignSends.openedAt} is not null or ${campaignSends.readAt} is not null)`.mapWith(
          Number
        ),
      cliques:
        sql<number>`count(*) filter (where ${campaignSends.clickedAt} is not null)`.mapWith(
          Number
        ),
      respostas:
        sql<number>`count(*) filter (where ${campaignSends.repliedAt} is not null)`.mapWith(
          Number
        ),
      falhas:
        sql<number>`count(*) filter (where ${campaignSends.status} = 'failed')`.mapWith(
          Number
        ),
    })
    .from(campaignSends)
    .innerJoin(
      automationRuns,
      eq(automationRuns.id, campaignSends.automationRunId)
    )
    .where(eq(automationRuns.automationId, automationId))
    .groupBy(campaignSends.automationStepId, campaignSends.channel);

  // Categoria do modelo define a tarifa do WhatsApp (marketing × utilidade).
  const idsDeModelos = passos
    .map((p) => String(p.config?.whatsappTemplateId ?? ""))
    .filter(Boolean);
  const categorias =
    idsDeModelos.length > 0
      ? await db
          .select({
            id: whatsappTemplates.id,
            category: whatsappTemplates.category,
          })
          .from(whatsappTemplates)
          .where(inArray(whatsappTemplates.id, idsDeModelos))
      : [];

  const porAgora = new Map(agora.map((a) => [a.stepId, a.total]));
  const porPassaram = new Map(passaram.map((p) => [p.stepId, p.total]));
  const porEnvio = new Map(envios.map((e) => [e.stepId, e]));
  const porCategoria = new Map(categorias.map((c) => [c.id, c.category]));

  let custoUsd = 0;

  const metricas: MetricaDoPasso[] = passos.map((passo) => {
    const envio = porEnvio.get(passo.id);
    const ehEnvio =
      passo.type === "send_email" || passo.type === "send_whatsapp";

    let custoDoPasso = 0;
    if (envio) {
      custoDoPasso =
        passo.type === "send_whatsapp"
          ? // Meta cobra por mensagem ENTREGUE; SES, por e-mail aceito.
            envio.entregues *
            whatsAppPriceUsd(
              porCategoria.get(String(passo.config?.whatsappTemplateId ?? ""))
            )
          : envio.enviados * sesPricePerEmailUsd();
      custoUsd += custoDoPasso;
    }

    return {
      stepId: passo.id,
      parentId: passo.parentId,
      branch: passo.branch,
      position: passo.position,
      nivel: 0,
      type: passo.type,
      config: passo.config,
      agora: porAgora.get(passo.id) ?? 0,
      passaram: porPassaram.get(passo.id) ?? 0,
      envios: ehEnvio
        ? {
            total: envio?.total ?? 0,
            enviados: envio?.enviados ?? 0,
            entregues: envio?.entregues ?? 0,
            abertos: envio?.abertos ?? 0,
            cliques: envio?.cliques ?? 0,
            respostas: envio?.respostas ?? 0,
            falhas: envio?.falhas ?? 0,
          }
        : null,
      custoUsd: custoDoPasso,
    };
  });

  return {
    versao: versao?.version ?? 1,
    resumo,
    passos: ordenarComoOFluxo(metricas),
    custoUsd,
    custoBrl: custoUsd * usdToBrlRate(),
    percursosDeOutrasVersoes: resumoLinha?.deOutrasVersoes ?? 0,
  };
}

export interface ContatoNoFluxo {
  runId: string;
  contactId: string;
  nome: string;
  email: string;
  telefone: string | null;
  status: AutomationRunStatus;
  currentStepId: string | null;
  passosExecutados: number;
  motivo: string | null;
  entrouEm: Date;
  terminouEm: Date | null;
}

/** Quem passou (ou está passando) pela automação, do mais recente ao mais antigo. */
export async function contatosDaAutomacao(
  automationId: string,
  limite = 300
): Promise<ContatoNoFluxo[]> {
  const db = getDb();
  const linhas = await db
    .select({
      runId: automationRuns.id,
      contactId: contacts.id,
      nome: contacts.name,
      email: contacts.email,
      telefone: contacts.phone,
      status: automationRuns.status,
      currentStepId: automationRuns.currentStepId,
      passosExecutados: automationRuns.stepsExecuted,
      motivo: automationRuns.stoppedReason,
      entrouEm: automationRuns.enteredAt,
      terminouEm: automationRuns.finishedAt,
    })
    .from(automationRuns)
    .innerJoin(contacts, eq(contacts.id, automationRuns.contactId))
    .where(eq(automationRuns.automationId, automationId))
    .orderBy(desc(automationRuns.enteredAt))
    .limit(limite);

  return linhas;
}
