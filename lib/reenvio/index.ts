// O e-mail de uma campanha já disparada — a parte que lê o banco e envia.
// As regras e o HTML moram em ./regras.ts (puro, testado sem banco).
import { and, count, desc, eq, inArray } from "drizzle-orm";

import { getBaseUrl } from "@/lib/base-url";
import { campaignSenderLabel } from "@/lib/campaign-author";
import {
  campaignResends,
  campaigns,
  campaignSends,
  contactEmails,
  contacts,
  getDb,
  lists,
  templates,
  users,
  type Campaign,
} from "@/lib/db";
import {
  buildCampaignVariables,
  buildEmailHtml,
  buildGuestVariables,
  buildTestVariables,
} from "@/lib/email";
import { formatDateTime, listsLabel } from "@/lib/format";
import { sendEmail } from "@/lib/ses";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

import {
  conferir,
  NOME_GENERICO,
  paraImprimir,
  paraVer,
  usaNomeDoParceiro,
  type DestinatarioDigitado,
  type EnderecoConferido,
  type RegistroDoEnvio,
} from "./regras";

export * from "./regras";

/**
 * O MJML que a campanha manda: o próprio (design editado no Criador) ou, nas
 * campanhas antigas sem e-mail próprio, o do modelo de origem. Nulo quando
 * não há nenhum dos dois — não há e-mail para mostrar.
 */
export async function mjmlDaCampanha(campaign: Campaign): Promise<string | null> {
  if (campaign.mjmlContent) return campaign.mjmlContent;
  if (!campaign.templateId) return null;
  const [modelo] = await getDb()
    .select({ mjmlContent: templates.mjmlContent })
    .from(templates)
    .where(eq(templates.id, campaign.templateId));
  return modelo?.mjmlContent ?? null;
}

/** Só campanha de e-mail que já saiu (ou está saindo) tem o que reenviar. */
export function podeReenviar(campaign: Campaign): boolean {
  return (
    campaign.channel === "email" &&
    (campaign.status === "sent" || campaign.status === "sending")
  );
}

/** Os dados do disparo que acompanham o e-mail na tela e na impressão. */
export async function registroDoEnvio(
  campaign: Campaign
): Promise<RegistroDoEnvio> {
  const db = getDb();
  const [[totais], nomesDasListas, [autor]] = await Promise.all([
    db
      .select({ envios: count() })
      .from(campaignSends)
      .where(eq(campaignSends.campaignId, campaign.id)),
    campaign.lists && campaign.lists.length > 0
      ? db
          .select({ name: lists.name })
          .from(lists)
          .where(inArray(lists.id, campaign.lists))
      : Promise.resolve([]),
    campaign.sentByUserId
      ? db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, campaign.sentByUserId))
      : Promise.resolve([]),
  ]);
  return {
    tipo: campaign.kind === "news" ? "news" : "campaign",
    nomeDaCampanha: campaign.name,
    assunto: campaign.subject,
    preCabecalho: campaign.preheader,
    enviadaEm: campaign.sentAt ? formatDateTime(campaign.sentAt) : null,
    autor: campaignSenderLabel(campaign, autor?.name),
    listas: listsLabel(nomesDasListas.map((l) => l.name)),
    destinatarios: totais?.envios ?? 0,
  };
}

/**
 * O HTML do e-mail da campanha para ver na tela ou imprimir: o mesmo que os
 * destinatários receberam, sem rastreio (abrir aqui não conta abertura) e com
 * um nome genérico onde entraria o de cada um. Nulo se a campanha não tem
 * e-mail montado.
 */
export async function htmlDoEmailDaCampanha(
  campaign: Campaign,
  modo: "tela" | "impressao"
): Promise<string | null> {
  const mjml = await mjmlDaCampanha(campaign);
  if (!mjml) return null;
  const { html } = await buildEmailHtml(mjml, {
    ...buildTestVariables(campaign),
    nome_parceiro: NOME_GENERICO,
  });
  const baseUrl = getBaseUrl();
  return modo === "impressao"
    ? paraImprimir(html, await registroDoEnvio(campaign), baseUrl)
    : paraVer(html, baseUrl);
}

/** O que a base sabe de cada endereço digitado (só os que são de um contato). */
async function contatosDosEnderecos(
  emails: string[]
): Promise<
  Map<string, { contato: { id: string; name: string }; aceita: boolean }>
> {
  if (emails.length === 0) return new Map();
  const linhas = await getDb()
    .select({
      email: contactEmails.email,
      aceita: contactEmails.subscribed,
      contato: { id: contacts.id, name: contacts.name },
    })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .where(inArray(contactEmails.email, emails));
  return new Map(
    linhas.map((l) => [l.email, { contato: l.contato, aceita: l.aceita }])
  );
}

/**
 * Confere os endereços antes de reenviar: quem é contato (e vai com o próprio
 * nome e descadastro), quem está fora da base e quem não pode receber.
 */
export async function conferirDestinatarios(
  campaign: Campaign,
  digitados: DestinatarioDigitado[]
): Promise<{ enderecos: EnderecoConferido[]; emailUsaNome: boolean }> {
  const mjml = await mjmlDaCampanha(campaign);
  const emailUsaNome = mjml ? usaNomeDoParceiro(mjml) : false;
  const daBase = await contatosDosEnderecos(digitados.map((d) => d.email));
  const enderecos = conferir(
    digitados,
    new Map(
      [...daBase].map(([email, { contato, aceita }]) => [
        email,
        { contactId: contato.id, nome: contato.name, aceita },
      ])
    ),
    emailUsaNome
  );
  return { enderecos, emailUsaNome };
}

export interface ResultadoDoReenvio {
  enviados: string[];
  falhas: { email: string; motivo: string }[];
  /** Descadastrados: ficam de fora, como em qualquer disparo. */
  bloqueados: string[];
}

/**
 * Reenvia o e-mail da campanha para os endereços digitados. Sai na hora, um
 * por vez (são no máximo MAX_REENVIO), com o assunto original e sem rastreio:
 * não mexe nas métricas do disparo. Cada tentativa fica em campaign_resends.
 *
 * Quem é contato recebe como recebeu no disparo — o próprio nome e o link de
 * descadastro assinado (atribuído ao envio original, quando houve um). Quem
 * pediu para sair não recebe: reenvio à mão não passa por cima do descadastro.
 */
export async function reenviarEmailDaCampanha(args: {
  campaign: Campaign;
  destinatarios: DestinatarioDigitado[];
  autor: { id: string; name: string } | null;
}): Promise<ResultadoDoReenvio> {
  const { campaign, destinatarios, autor } = args;
  const db = getDb();

  const mjml = await mjmlDaCampanha(campaign);
  if (!mjml) throw new Error("Esta campanha não tem e-mail montado.");

  const daBase = await contatosDosEnderecos(destinatarios.map((d) => d.email));

  // O envio original de cada contato, para o descadastro continuar sendo
  // atribuído a esta campanha. Envio de antes dos endereços múltiplos não tem
  // endereço gravado: vale o do contato.
  const idsDosContatos = [...daBase.values()].map((c) => c.contato.id);
  const originais =
    idsDosContatos.length > 0
      ? await db
          .select({
            id: campaignSends.id,
            contactId: campaignSends.contactId,
            address: campaignSends.address,
          })
          .from(campaignSends)
          .where(
            and(
              eq(campaignSends.campaignId, campaign.id),
              inArray(campaignSends.contactId, idsDosContatos)
            )
          )
      : [];

  const resultado: ResultadoDoReenvio = {
    enviados: [],
    falhas: [],
    bloqueados: [],
  };

  for (const destinatario of destinatarios) {
    const conhecido = daBase.get(destinatario.email);
    if (conhecido && !conhecido.aceita) {
      resultado.bloqueados.push(destinatario.email);
      continue;
    }

    const nome = conhecido ? conhecido.contato.name : destinatario.nome;
    let messageId: string | null = null;
    let erro: string | null = null;
    try {
      let headers: Record<string, string> | undefined;
      let variaveis;
      if (conhecido) {
        const original =
          originais.find(
            (o) =>
              o.contactId === conhecido.contato.id &&
              o.address === destinatario.email
          ) ??
          originais.find(
            (o) => o.contactId === conhecido.contato.id && o.address === null
          );
        variaveis = await buildCampaignVariables(
          campaign,
          conhecido.contato,
          original?.id,
          destinatario.email
        );
        // Descadastro em um clique (RFC 8058), como no disparo.
        headers = {
          "List-Unsubscribe": `<${variaveis.list_unsubscribe_url}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        };
      } else {
        variaveis = buildGuestVariables(campaign, nome);
      }
      // Sem sendId: o reenvio não leva pixel nem link rastreado.
      const { html } = await buildEmailHtml(mjml, variaveis);
      const envio = await sendEmail({
        to: destinatario.email,
        subject: campaign.subject,
        html,
        headers,
      });
      messageId = envio.messageId || null;
      resultado.enviados.push(destinatario.email);
    } catch (error) {
      erro = errorMessage(error);
      resultado.falhas.push({ email: destinatario.email, motivo: erro });
    }

    // O registro não pode derrubar o reenvio dos próximos: o e-mail deste já
    // saiu (ou já falhou), e o que falta gravar vai para o log.
    try {
      await db.insert(campaignResends).values({
        campaignId: campaign.id,
        email: destinatario.email,
        contactId: conhecido?.contato.id ?? null,
        name: nome,
        status: erro ? "failed" : "sent",
        errorMessage: erro,
        providerMessageId: messageId,
        sentByUserId: autor?.id ?? null,
        sentByName: autor?.name ?? null,
      });
    } catch (error) {
      console.error(
        `[reenvio] ${destinatario.email} não foi registrado:`,
        errorMessage(error)
      );
    }
  }

  return resultado;
}

/** Os reenvios avulsos de uma campanha, do mais recente para o mais antigo. */
export async function reenviosDaCampanha(campaignId: string) {
  return getDb()
    .select({
      id: campaignResends.id,
      email: campaignResends.email,
      name: campaignResends.name,
      contactId: campaignResends.contactId,
      status: campaignResends.status,
      errorMessage: campaignResends.errorMessage,
      sentByName: campaignResends.sentByName,
      createdAt: campaignResends.createdAt,
    })
    .from(campaignResends)
    .where(eq(campaignResends.campaignId, campaignId))
    .orderBy(desc(campaignResends.createdAt));
}

/** A campanha pelo id, ou nula (id que não é uuid inclusive). */
export async function campanhaPorId(id: string): Promise<Campaign | null> {
  if (!UUID_REGEX.test(id)) return null;
  const [campanha] = await getDb()
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id));
  return campanha ?? null;
}
