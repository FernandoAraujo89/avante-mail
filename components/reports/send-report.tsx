import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCheck,
  DollarSign,
  MailOpen,
  MailWarning,
  MessageCircle,
  MessageSquareReply,
  MousePointerClick,
  Send,
  ShieldAlert,
  Users,
} from "lucide-react";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { RefreshButton } from "@/components/reports/refresh-button";
import { ResendButton } from "@/components/reports/resend-button";
import { SendsTable } from "@/components/reports/sends-table";
import { WhatsAppReplies } from "@/components/reports/whatsapp-replies";
import { CampaignStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  campaigns,
  campaignSends,
  contacts,
  getDb,
  lists as listsTable,
  users,
  whatsappMessages,
  whatsappTemplates,
  type CampaignKind,
} from "@/lib/db";
import {
  formatBrl,
  formatDateTime,
  formatPercent,
  formatUsd,
  listsLabel,
} from "@/lib/format";
import { campaignSenderLabel } from "@/lib/campaign-author";
import { campaignCost } from "@/lib/pricing";
import { conversationIdsByContact } from "@/lib/whatsapp/conversations";
import {
  isResendableErrorCode,
  isRestrictionErrorCode,
} from "@/lib/whatsapp/errors";
import { messagePreview } from "@/lib/whatsapp/inbound";
import type { WhatsAppButton } from "@/lib/whatsapp/types";

/**
 * Relatório de um disparo (campanha ou edição do Avante News). É o mesmo
 * conjunto de métricas — o que muda é a navegação e o vocabulário da tela.
 */
export async function SendReport({
  id,
  kind,
  backHref,
  backLabel,
}: {
  id: string;
  /** Garante que a rota de campanhas não abra uma edição do News e vice-versa. */
  kind: CampaignKind;
  backHref: string;
  backLabel: string;
}) {
  const db = getDb();

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id));

  if (!campaign || campaign.kind !== kind) notFound();

  const [autor] = campaign.sentByUserId
    ? await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, campaign.sentByUserId))
    : [];
  const quemEnviou = campaignSenderLabel(campaign, autor?.name);

  const campaignListNames =
    campaign.lists && campaign.lists.length > 0
      ? (
          await db
            .select({ name: listsTable.name })
            .from(listsTable)
            .where(inArray(listsTable.id, campaign.lists))
        ).map((l) => l.name)
      : [];

  const sends = await db
    .select({
      id: campaignSends.id,
      status: campaignSends.status,
      sentAt: campaignSends.sentAt,
      openedAt: campaignSends.openedAt,
      clickedAt: campaignSends.clickedAt,
      deliveredAt: campaignSends.deliveredAt,
      readAt: campaignSends.readAt,
      repliedAt: campaignSends.repliedAt,
      replyButton: campaignSends.replyButton,
      replyButtonAt: campaignSends.replyButtonAt,
      errorCode: campaignSends.errorCode,
      errorMessage: campaignSends.errorMessage,
      bounceType: campaignSends.bounceType,
      complainedAt: campaignSends.complainedAt,
      // Segmentos cobrados de cada SMS: é o que a Twilio fatura, e vem do
      // envio porque o texto da campanha pode ter mudado desde o disparo.
      smsSegments: campaignSends.smsSegments,
      // O que a Twilio cobrou de fato — manda no custo quando existe.
      smsSegmentsBilled: campaignSends.smsSegmentsBilled,
      // O id vai junto para a linha levar à ficha do contato.
      contactId: campaignSends.contactId,
      contactName: contacts.name,
      contactEmail: contacts.email,
      contactPhone: contacts.phone,
      contactCompany: contacts.company,
    })
    .from(campaignSends)
    .innerJoin(contacts, eq(campaignSends.contactId, contacts.id))
    .where(eq(campaignSends.campaignId, id))
    .orderBy(asc(contacts.name));

  const isWhatsApp = campaign.channel === "whatsapp";
  const isSms = campaign.channel === "sms";
  const isNews = campaign.kind === "news";
  // Envios reenviáveis, separados por gravidade: a Meta segurar a mensagem de
  // UM contato por frequência (131049) não tem gravidade nenhuma; o NÚMERO ser
  // restringido (131048) interrompeu a campanha inteira e pede ação antes de
  // reenviar. O mesmo botão serve aos dois — o texto é que não pode ser igual.
  const heldByMeta = sends.filter(
    (s) =>
      s.status === "failed" &&
      isResendableErrorCode(s.errorCode) &&
      !isRestrictionErrorCode(s.errorCode)
  ).length;
  const restricted = sends.filter(
    (s) => s.status === "failed" && isRestrictionErrorCode(s.errorCode)
  ).length;
  const resendable = heldByMeta + restricted;
  const pending = sends.filter((s) => s.status === "pending").length;
  const failed = sends.filter((s) => s.status === "failed").length;

  // Categoria do modelo define a tarifa do WhatsApp (marketing × utility); os
  // botões são a base da apuração das respostas.
  let whatsappCategory: string | null = null;
  let whatsappButtons: WhatsAppButton[] | null = null;
  if (isWhatsApp && campaign.whatsappTemplateId) {
    const [tpl] = await db
      .select({
        category: whatsappTemplates.category,
        buttons: whatsappTemplates.buttons,
      })
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.id, campaign.whatsappTemplateId));
    whatsappCategory = tpl?.category ?? null;
    whatsappButtons = tpl?.buttons ?? null;
  }

  const header = (
    <div className="mb-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
        <Link href={backHref}>
          <ArrowLeft />
          {backLabel}
        </Link>
      </Button>
      <PageHeader
        title={campaign.name}
        description={`${
          isWhatsApp
            ? "Campanha de WhatsApp"
            : isSms
              ? "Campanha de SMS"
              : `Assunto: ${campaign.subject}`
        } · ${listsLabel(campaignListNames)}${
          campaign.sentAt
            ? ` · Concluída em ${formatDateTime(campaign.sentAt)}`
            : ""
        }${quemEnviou ? ` · Enviada por ${quemEnviou}` : ""}`}
      >
        <div className="flex items-center gap-2">
          {isNews ? <Badge variant="info">Avante News</Badge> : null}
          {isWhatsApp ? <Badge variant="info">WhatsApp</Badge> : null}
          {isSms ? <Badge variant="info">SMS</Badge> : null}
          <CampaignStatusBadge status={campaign.status} />
          <RefreshButton autoRefresh={campaign.status === "sending"} />
        </div>
      </PageHeader>
    </div>
  );

  if (isWhatsApp) {
    // O que cada contato escreveu em resposta a este envio (a última mensagem
    // que não é toque de botão nem reação) e o atalho para a conversa dele.
    const writtenReplies = await db
      .selectDistinctOn([whatsappMessages.campaignSendId], {
        sendId: whatsappMessages.campaignSendId,
        type: whatsappMessages.type,
        body: whatsappMessages.body,
      })
      .from(whatsappMessages)
      .innerJoin(campaignSends, eq(campaignSends.id, whatsappMessages.campaignSendId))
      .where(
        and(
          eq(campaignSends.campaignId, id),
          eq(whatsappMessages.direction, "inbound"),
          notInArray(whatsappMessages.type, ["button", "interactive", "reaction"])
        )
      )
      .orderBy(whatsappMessages.campaignSendId, desc(whatsappMessages.createdAt));
    const replyTextBySend = new Map(
      writtenReplies.map((r) => [r.sendId, messagePreview(r)])
    );
    const conversationByContact = await conversationIdsByContact(
      sends.filter((s) => s.repliedAt !== null).map((s) => s.contactId)
    );
    const sendsWithReplies = sends.map((s) => ({
      ...s,
      replyText: replyTextBySend.get(s.id) ?? null,
      conversationId: conversationByContact.get(s.contactId) ?? null,
    }));

    const sent = sends.filter((s) =>
      ["sent", "delivered", "read"].includes(s.status)
    ).length;
    const delivered = sends.filter(
      (s) => s.deliveredAt !== null || s.status === "read"
    ).length;
    const read = sends.filter((s) => s.readAt !== null).length;
    const replied = sends.filter((s) => s.repliedAt !== null).length;
    const frequencyCapped = sends.filter(
      (s) => s.errorCode === "131049"
    ).length;
    // Meta cobra por mensagem ENTREGUE, na tarifa da categoria do modelo.
    const cost = campaignCost({
      channel: "whatsapp",
      chargeable: delivered,
      whatsappCategory,
    });
    // Tarifa de uma mensagem, para avisar o custo antes de reenviar.
    const unitCost = campaignCost({
      channel: "whatsapp",
      chargeable: 1,
      whatsappCategory,
    });

    return (
      <>
        {header}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Destinatários"
            value={String(sends.length)}
            hint={pending > 0 ? `${pending} na fila` : "Fila concluída"}
            icon={Users}
          />
          <MetricCard label="Enviadas" value={String(sent)} icon={Send} />
          <MetricCard
            label="Entregues"
            value={String(delivered)}
            hint={`Taxa: ${formatPercent(delivered, sent)}`}
            icon={CheckCheck}
          />
          <MetricCard
            label="Lidas"
            value={String(read)}
            hint={`Taxa: ${formatPercent(read, delivered)}`}
            icon={MessageCircle}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Respostas"
            value={String(replied)}
            hint={
              replied > 0 ? "Contatos que responderam" : "Nenhuma resposta ainda"
            }
            icon={MessageSquareReply}
          />
          <MetricCard
            label="Limite do destinatário"
            value={String(frequencyCapped)}
            hint={
              frequencyCapped > 0
                ? "Meta limitou o marketing (erro 131049) — não é falha técnica"
                : "Nenhum bloqueio por frequência"
            }
            icon={ShieldAlert}
          />
          <MetricCard
            label="Falhas de envio"
            value={String(failed)}
            hint="Total de envios que falharam (inclui o limite ao lado)"
            icon={AlertTriangle}
          />
          <MetricCard
            label="Custo (Meta)"
            value={formatUsd(cost.usd)}
            hint={`≈ ${formatBrl(cost.brl)} · ${delivered} entregue(s)`}
            icon={DollarSign}
          />
        </div>

        {resendable > 0 ? (
          <div
            className={`mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
              restricted > 0
                ? "border-destructive/40 bg-destructive/10"
                : "border-border bg-accent/50"
            }`}
          >
            <p className="text-sm">
              {restricted > 0 ? (
                <>
                  <span className="font-medium">
                    {restricted === 1
                      ? "1 contato não recebeu"
                      : `${restricted} contatos não receberam`}
                  </span>{" "}
                  porque a Meta restringiu o número durante o disparo e o
                  restante da campanha foi interrompido para proteger a
                  qualidade. Não houve cobrança. Confira a qualidade do número
                  no Gerenciador do WhatsApp Business e só reenvie depois que
                  ela normalizar.
                </>
              ) : (
                <>
                  <span className="font-medium">
                    {heldByMeta === 1
                      ? "1 contato não recebeu"
                      : `${heldByMeta} contatos não receberam`}
                  </span>{" "}
                  porque a Meta segurou a mensagem por limite de frequência.
                  Não é falha técnica e não houve cobrança — dá para reenviar
                  só para eles quando o limite liberar.
                </>
              )}
            </p>
            <ResendButton
              endpoint={`/api/campaigns/${campaign.id}/resend`}
              count={resendable}
              costHint={`${formatUsd(unitCost.usd)} (≈ ${formatBrl(
                unitCost.brl
              )}) por mensagem entregue`}
            />
          </div>
        ) : null}

        <WhatsAppReplies
          sends={sendsWithReplies}
          templateButtons={whatsappButtons}
          nomeDoDisparo={campaign.name}
        />
      </>
    );
  }

  // ─── Canal SMS ──────────────────────────────────────────────────────
  // Nenhuma métrica de e-mail cabe aqui: SMS não tem abertura, não tem
  // clique rastreado, não devolve e não tem denúncia de spam. O que existe é
  // saiu / chegou na operadora / a pessoa respondeu — e quanto custou.
  if (isSms) {
    const chargeableSends = sends.filter((s) => s.sentAt !== null);
    const segments = chargeableSends.reduce(
      (soma, s) => soma + (s.smsSegmentsBilled ?? s.smsSegments ?? 1),
      0
    );
    const delivered = sends.filter((s) => s.deliveredAt !== null).length;
    const replied = sends.filter((s) => s.repliedAt !== null).length;
    // 21610 = pediu para sair; 21614 = número inválido ou fixo. Nos dois casos
    // o contato já saiu do canal — é higiene da base, não erro técnico.
    const optedOut = sends.filter(
      (s) => s.errorCode === "21610" || s.errorCode === "21614"
    ).length;
    // Quanto NÓS contamos no envio. Se divergir do que a Twilio cobrou, algo
    // reescreveu a mensagem depois da nossa contagem — tipicamente Link
    // Shortening ou Smart Encoding ligados no console. Vale avisar: sem isso,
    // a diferença só apareceria na fatura, meses depois.
    const segmentsCounted = chargeableSends.reduce(
      (soma, s) => soma + (s.smsSegments ?? 1),
      0
    );
    const temDivergencia =
      chargeableSends.some((s) => s.smsSegmentsBilled !== null) &&
      segmentsCounted !== segments;

    const cost = campaignCost({
      channel: "sms",
      chargeable: chargeableSends.length,
      smsSegments: segments,
    });

    return (
      <>
        {header}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Destinatários"
            value={String(sends.length)}
            hint={pending > 0 ? `${pending} na fila` : "Fila concluída"}
            icon={Users}
          />
          <MetricCard
            label="Enviados"
            value={String(chargeableSends.length)}
            hint={
              temDivergencia
                ? `${segments} segmento(s) cobrado(s) — contamos ${segmentsCounted}`
                : `${segments} segmento(s) cobrado(s)`
            }
            icon={Send}
          />
          <MetricCard
            label="Entregues"
            value={String(delivered)}
            hint={
              delivered > 0
                ? `Taxa: ${formatPercent(delivered, chargeableSends.length)}`
                : "Nem toda operadora confirma a entrega"
            }
            icon={CheckCheck}
          />
          <MetricCard
            label="Respostas"
            value={String(replied)}
            hint={
              replied > 0 ? "Contatos que responderam" : "Nenhuma resposta ainda"
            }
            icon={MessageSquareReply}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Saíram do canal"
            value={String(optedOut)}
            hint={
              optedOut > 0
                ? "Pediram PARAR ou o número não recebe SMS — já descadastrados"
                : "Ninguém saiu nesta campanha"
            }
            icon={ShieldAlert}
          />
          <MetricCard
            label="Falhas de envio"
            value={String(failed)}
            hint="Total de envios que falharam (inclui os que saíram do canal)"
            icon={AlertTriangle}
          />
          <MetricCard
            label="Custo (Twilio)"
            value={formatUsd(cost.usd)}
            hint={`≈ ${formatBrl(cost.brl)} · ${segments} segmento(s) em ${chargeableSends.length} envio(s)`}
            icon={DollarSign}
          />
        </div>

        <Card className="mt-6">
          <SendsTable
            sends={sends}
            channel="sms"
            nomeDoDisparo={campaign.name}
            vazio="Nenhum envio registrado para esta campanha."
          />
        </Card>
      </>
    );
  }

  // ─── Canal de e-mail ────────────────────────────────────────────────
  const sent = sends.filter((s) =>
    ["sent", "opened", "clicked"].includes(s.status)
  ).length;
  const opened = sends.filter((s) => s.openedAt !== null).length;
  const clicked = sends.filter((s) => s.clickedAt !== null).length;
  const bouncedHard = sends.filter((s) => s.bounceType === "hard").length;
  const bouncedSoft = sends.filter((s) => s.bounceType === "soft").length;
  const bounced = bouncedHard + bouncedSoft;
  const complained = sends.filter((s) => s.complainedAt !== null).length;
  // SES cobra por e-mail aceito (todo envio com sentAt, inclusive devolvidos).
  const chargeable = sends.filter((s) => s.sentAt !== null).length;
  const cost = campaignCost({ channel: "email", chargeable });

  return (
    <>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Destinatários"
          value={String(sends.length)}
          hint={pending > 0 ? `${pending} pendentes` : "Fila concluída"}
          icon={Users}
        />
        <MetricCard label="Enviados" value={String(sent)} icon={Send} />
        <MetricCard
          label="Abertos"
          value={String(opened)}
          hint={`Taxa: ${formatPercent(opened, sent)}`}
          icon={MailOpen}
        />
        <MetricCard
          label="Clicados"
          value={String(clicked)}
          hint={`Taxa: ${formatPercent(clicked, sent)}`}
          icon={MousePointerClick}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Devolvidos"
          value={String(bounced)}
          hint={
            bounced > 0
              ? `${bouncedHard} endereço(s) inválido(s) · ${bouncedSoft} temporário(s)`
              : "Nenhuma devolução"
          }
          icon={MailWarning}
        />
        <MetricCard
          label="Marcados como spam"
          value={String(complained)}
          hint={
            complained > 0
              ? "Contatos suprimidos automaticamente"
              : "Nenhuma reclamação"
          }
          icon={ShieldAlert}
        />
        <MetricCard
          label="Falhas de envio"
          value={String(failed)}
          hint="Erro técnico (não é devolução nem spam)"
          icon={AlertTriangle}
        />
        <MetricCard
          label="Custo (SES)"
          value={formatUsd(cost.usd)}
          hint={`≈ ${formatBrl(cost.brl)} · ${cost.chargeable} e-mail(s)`}
          icon={DollarSign}
        />
      </div>

      <Card className="mt-6">
        <SendsTable
          sends={sends}
          channel="email"
          nomeDoDisparo={campaign.name}
          vazio={
            isNews
              ? "Nenhum envio registrado para esta edição."
              : "Nenhum envio registrado para esta campanha."
          }
        />
      </Card>
    </>
  );
}
