// Cópia de acompanhamento das campanhas — a parte que lê o banco e enfileira.
// As regras e o HTML moram em ./copia.ts (puro, testado sem banco).
import { count, countDistinct, eq, inArray } from "drizzle-orm";

import { getBaseUrl } from "@/lib/base-url";
import {
  campaigns,
  campaignSends,
  getDb,
  lists,
  templates,
  whatsappTemplates,
} from "@/lib/db";
import { buildEmailHtml, buildTestVariables } from "@/lib/email";
import { formatDateTime, listsLabel } from "@/lib/format";
import { getEmailQueue } from "@/lib/queue";
import { getSetting, setSetting } from "@/lib/settings";
import { countSms, sanitizeGsm7 } from "@/lib/sms/gsm7";

import {
  assuntoDaCopia,
  CHAVE_ACOMPANHAMENTO,
  corpoComVariaveis,
  faixaDeAcompanhamento,
  htmlDaCopiaSms,
  htmlDaCopiaWhatsApp,
  inserirFaixa,
  JOB_DA_COPIA,
  lerEmailsDeAcompanhamento,
  quemRecebeCopia,
  type CanalDaCopia,
} from "./copia";

export * from "./copia";

/** Os e-mails que recebem a cópia de toda campanha. */
export async function lerLideres(): Promise<string[]> {
  const cru = await getSetting(CHAVE_ACOMPANHAMENTO);
  if (!cru) return [];
  try {
    return lerEmailsDeAcompanhamento(JSON.parse(cru)).emails;
  } catch {
    return [];
  }
}

export async function salvarLideres(emails: string[]): Promise<void> {
  await setSetting(
    CHAVE_ACOMPANHAMENTO,
    emails.length > 0 ? JSON.stringify(emails) : null
  );
}

/**
 * Enfileira uma cópia por líder, para sair junto com a campanha (o mesmo
 * atraso do agendamento). Um job por e-mail — e não um e-mail para todos — para
 * o limitador do worker espaçá-los como espaça o resto. O jobId fixo impede a
 * mesma cópia duas vezes.
 */
export async function agendarCopias(args: {
  campaignId: string;
  delay: number;
  /** Só no e-mail: quem já recebe a campanha não recebe a cópia. */
  enderecosDaCampanha?: string[];
}): Promise<number> {
  const destinatarios = quemRecebeCopia(
    await lerLideres(),
    args.enderecosDaCampanha
  );
  if (destinatarios.length === 0) return 0;
  await getEmailQueue().addBulk(
    destinatarios.map((email) => ({
      name: JOB_DA_COPIA,
      data: { tipo: "copia" as const, campaignId: args.campaignId, email },
      opts: {
        jobId: `copia__${args.campaignId}__${email}`,
        delay: args.delay,
        attempts: 3,
        backoff: { type: "exponential" as const, delay: 3000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    }))
  );
  return destinatarios.length;
}

function urlAbsoluta(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("/") ? `${getBaseUrl()}${url}` : url;
}

/**
 * Monta a cópia de uma campanha na hora de enviar (o conteúdo pode ter mudado
 * desde o agendamento, como muda para os destinatários). Nula quando a
 * campanha sumiu ou voltou a rascunho: não há o que acompanhar.
 */
export async function montarCopia(
  campaignId: string
): Promise<{ assunto: string; html: string } | null> {
  const db = getDb();
  const [campanha] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  if (!campanha || campanha.status === "draft") return null;

  const [[totais], nomesDasListas] = await Promise.all([
    db
      .select({
        mensagens: count(),
        contatos: countDistinct(campaignSends.contactId),
      })
      .from(campaignSends)
      .where(eq(campaignSends.campaignId, campaignId)),
    campanha.lists && campanha.lists.length > 0
      ? db
          .select({ name: lists.name })
          .from(lists)
          .where(inArray(lists.id, campanha.lists))
      : Promise.resolve([]),
  ]);

  const canal: CanalDaCopia =
    campanha.channel === "whatsapp" || campanha.channel === "sms"
      ? campanha.channel
      : "email";
  const faixa = faixaDeAcompanhamento({
    canal,
    nomeDaCampanha: campanha.name,
    mensagens: totais?.mensagens ?? 0,
    contatos: totais?.contatos ?? 0,
    quando: formatDateTime(new Date()),
    autor: campanha.sentByName,
    listas: listsLabel(nomesDasListas.map((l) => l.name)),
    relatorioUrl: `${getBaseUrl()}/campaigns/${campanha.id}/report`,
  });
  const assunto = assuntoDaCopia(canal, campanha);

  if (canal === "whatsapp") {
    const [modelo] = campanha.whatsappTemplateId
      ? await db
          .select()
          .from(whatsappTemplates)
          .where(eq(whatsappTemplates.id, campanha.whatsappTemplateId))
      : [];
    if (!modelo) return null;
    return {
      assunto,
      html: htmlDaCopiaWhatsApp(
        faixa,
        { ...modelo, headerMediaUrl: urlAbsoluta(modelo.headerMediaUrl) },
        corpoComVariaveis(modelo.bodyText, campanha.whatsappVariables)
      ),
    };
  }

  if (canal === "sms") {
    // O texto como sai: o worker translitera para GSM-7 na hora do envio.
    const texto = sanitizeGsm7(campanha.smsBody?.trim() ?? "").texto;
    return {
      assunto,
      html: htmlDaCopiaSms(faixa, texto, countSms(texto).segmentos),
    };
  }

  // E-mail: o mesmo que os destinatários recebem, sem rastreio (sem sendId)
  // e com o nome do parceiro no lugar onde ele entraria.
  let mjml = campanha.mjmlContent;
  if (!mjml && campanha.templateId) {
    const [modelo] = await db
      .select({ mjmlContent: templates.mjmlContent })
      .from(templates)
      .where(eq(templates.id, campanha.templateId));
    mjml = modelo?.mjmlContent ?? null;
  }
  if (!mjml) return null;
  const { html } = await buildEmailHtml(mjml, {
    ...buildTestVariables(campanha),
    nome_parceiro: "[nome do parceiro]",
  });
  return { assunto, html: inserirFaixa(html, faixa) };
}
