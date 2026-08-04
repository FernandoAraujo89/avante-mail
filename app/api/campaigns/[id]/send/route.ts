import { NextRequest, NextResponse } from "next/server";
import {
  and,
  arrayOverlaps,
  eq,
  inArray,
  isNotNull,
  type SQL,
} from "drizzle-orm";

import {
  campaigns,
  campaignSends,
  contactLists,
  contacts,
  getDb,
  templates,
  whatsappTemplates,
  type Campaign,
} from "@/lib/db";
import { naoEhLead } from "@/lib/leads";
import { getEmailQueue, getWhatsAppQueue } from "@/lib/queue";
import { sessionUserFromRequest } from "@/lib/session";
import { resolveNewsList, resolveTeamList } from "@/lib/settings";
import { errorMessage } from "@/lib/utils";
import { isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { missingVariableSources } from "@/lib/whatsapp/variables";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Disparo do canal WhatsApp: valida modelo aprovado + mapeamento de
// variáveis, seleciona contatos com telefone e consentimento, cria os
// registros de envio e enfileira em "whatsapp-sends".
async function dispatchWhatsApp(
  db: ReturnType<typeof getDb>,
  campaign: Campaign
) {
  if (!isWhatsAppConfigured()) {
    return NextResponse.json(
      {
        error:
          "Canal WhatsApp ainda não configurado — preencha as envs WHATSAPP_* no servidor (Fase 0 do plano).",
      },
      { status: 400 }
    );
  }

  if (!campaign.whatsappTemplateId) {
    return NextResponse.json(
      { error: "Escolha o modelo de WhatsApp da campanha antes de disparar." },
      { status: 400 }
    );
  }
  const [template] = await db
    .select()
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.id, campaign.whatsappTemplateId));
  if (!template) {
    return NextResponse.json(
      { error: "O modelo desta campanha não existe mais." },
      { status: 400 }
    );
  }
  if (template.status !== "approved") {
    return NextResponse.json(
      {
        error: `O modelo "${template.name}" ainda não está aprovado pela Meta (status atual: ${template.status}).`,
      },
      { status: 400 }
    );
  }

  const missing = missingVariableSources(
    template.bodyText,
    campaign.whatsappVariables
  );
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Defina o valor das variáveis ${missing
          .map((n) => `{{${n}}}`)
          .join(", ")} antes de disparar.`,
      },
      { status: 400 }
    );
  }

  // Contatos elegíveis: consentimento de WhatsApp + telefone + listas + tags.
  const conditions: SQL[] = [
    eq(contacts.whatsappSubscribed, true),
    isNotNull(contacts.phone),
  ];
  // TRAVA 2 (docs/plano-webhooks-leads.md, seção 5): lead fora, a menos que a
  // campanha diga o contrário. É aqui — e não no seletor — que a trava vale:
  // a escolha manual de destinatários e a campanha duplicada passam por este
  // mesmo caminho.
  if (!campaign.includeLeads) conditions.push(naoEhLead());
  if (campaign.lists && campaign.lists.length > 0) {
    conditions.push(
      inArray(
        contacts.id,
        db
          .select({ id: contactLists.contactId })
          .from(contactLists)
          .where(inArray(contactLists.listId, campaign.lists))
      )
    );
  }
  if (campaign.tagsFilter && campaign.tagsFilter.length > 0) {
    conditions.push(arrayOverlaps(contacts.tags, campaign.tagsFilter));
  }
  // Escolha manual do passo "Destinatários": só restringe, nunca amplia — as
  // condições de elegibilidade acima continuam valendo.
  if (campaign.recipientIds) {
    if (campaign.recipientIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "Nenhum destinatário selecionado — escolha ao menos um contato no passo Destinatários.",
        },
        { status: 400 }
      );
    }
    conditions.push(inArray(contacts.id, campaign.recipientIds));
  }

  const eligible = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(...conditions));

  if (eligible.length === 0) {
    return NextResponse.json(
      {
        error: campaign.includeLeads
          ? "Nenhum destinatário elegível — só contatos com telefone e consentimento de WhatsApp recebem."
          : "Nenhum destinatário elegível — só contatos com telefone e consentimento de WhatsApp recebem, e os leads estão fora deste envio (marque “Incluir leads” no passo Destinatários para incluí-los).",
      },
      { status: 400 }
    );
  }

  const sends = await db
    .insert(campaignSends)
    .values(
      eligible.map((contact) => ({
        campaignId: campaign.id,
        channel: "whatsapp" as const,
        contactId: contact.id,
      }))
    )
    .returning({ id: campaignSends.id, contactId: campaignSends.contactId });

  const delay = campaign.scheduledAt
    ? Math.max(campaign.scheduledAt.getTime() - Date.now(), 0)
    : 0;

  const queue = getWhatsAppQueue();
  await queue.addBulk(
    sends.map((send) => ({
      name: "send-whatsapp",
      data: {
        sendId: send.id,
        campaignId: campaign.id,
        contactId: send.contactId,
      },
      opts: {
        delay,
        attempts: 3,
        backoff: { type: "exponential" as const, delay: 3000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    }))
  );

  await db
    .update(campaigns)
    .set({ status: delay > 0 ? "scheduled" : "sending" })
    .where(eq(campaigns.id, campaign.id));

  return NextResponse.json({ queued: sends.length, scheduled: delay > 0 });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const autor = await sessionUserFromRequest(request);

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, id));

    if (!campaign) {
      return NextResponse.json(
        { error: "Campanha não encontrada." },
        { status: 404 }
      );
    }
    if (campaign.status === "sending" || campaign.status === "sent") {
      return NextResponse.json(
        { error: "Esta campanha já foi disparada." },
        { status: 409 }
      );
    }

    // Quem disparou fica registrado antes de enfileirar: se algo falhar
    // depois, o registro de autoria já existe. O nome é copiado agora para
    // sobreviver à remoção da conta.
    if (autor) {
      await db
        .update(campaigns)
        .set({ sentByUserId: autor.id, sentByName: autor.name })
        .where(eq(campaigns.id, campaign.id));
    }

    if (campaign.channel === "whatsapp") {
      return await dispatchWhatsApp(db, campaign);
    }
    // O e-mail vem do design próprio da campanha (mjmlContent). Campanhas
    // antigas ainda podem depender do template de origem (fallback).
    if (!campaign.mjmlContent) {
      if (!campaign.templateId) {
        return NextResponse.json(
          { error: "Monte o e-mail da campanha antes de disparar." },
          { status: 400 }
        );
      }
      const [template] = await db
        .select({ id: templates.id })
        .from(templates)
        .where(eq(templates.id, campaign.templateId));

      if (!template) {
        return NextResponse.json(
          { error: "Esta campanha não tem e-mail montado e o template de origem não existe mais." },
          { status: 400 }
        );
      }
    }

    // O Avante News vai sempre para a lista de parceiros White Label Ativos,
    // resolvida no momento do disparo (não no rascunho) — se a configuração
    // mudou desde a criação, vale a lista atual.
    let targetLists = campaign.lists;
    if (campaign.kind === "news") {
      const audience = await resolveNewsList();
      if (!audience) {
        return NextResponse.json(
          {
            error:
              "Defina a lista de parceiros White Label Ativos antes de enviar o Avante News.",
          },
          { status: 400 }
        );
      }
      targetLists = [audience.id];

      // Opção da edição: manda também para os colaboradores. Se a lista sumiu
      // depois que a opção foi marcada, falha em vez de enviar calado para
      // menos gente do que o usuário pediu.
      if (campaign.newsIncludeTeam) {
        const team = await resolveTeamList();
        if (!team) {
          return NextResponse.json(
            {
              error:
                "Esta edição inclui os colaboradores, mas não há lista de colaboradores definida. Escolha a lista em Avante News ou desmarque a opção.",
            },
            { status: 400 }
          );
        }
        targetLists = [audience.id, team.id];
      }

      await db
        .update(campaigns)
        .set({ lists: targetLists })
        .where(eq(campaigns.id, campaign.id));
    }

    // 1. Contatos elegíveis: inscritos + listas + tags.
    const conditions: SQL[] = [eq(contacts.subscribed, true)];
    // TRAVA 2: lead não recebe campanha de parceiro sem alguém ter dito que
    // sim. Vale também para o Avante News, que nunca teve lead como público.
    if (!campaign.includeLeads) conditions.push(naoEhLead());
    if (targetLists && targetLists.length > 0) {
      conditions.push(
        inArray(
          contacts.id,
          db
            .select({ id: contactLists.contactId })
            .from(contactLists)
            .where(inArray(contactLists.listId, targetLists))
        )
      );
    }
    if (campaign.tagsFilter && campaign.tagsFilter.length > 0) {
      conditions.push(arrayOverlaps(contacts.tags, campaign.tagsFilter));
    }
    // Escolha manual do passo "Destinatários": só restringe, nunca amplia — as
    // condições de elegibilidade acima continuam valendo.
    if (campaign.recipientIds) {
      if (campaign.recipientIds.length === 0) {
        return NextResponse.json(
          {
            error:
              "Nenhum destinatário selecionado — escolha ao menos um contato no passo Destinatários.",
          },
          { status: 400 }
        );
      }
      conditions.push(inArray(contacts.id, campaign.recipientIds));
    }

    const eligible = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(...conditions));

    if (eligible.length === 0) {
      return NextResponse.json(
        {
          error: campaign.includeLeads
            ? "Nenhum destinatário elegível para os filtros da campanha."
            : "Nenhum destinatário elegível para os filtros da campanha — os leads estão fora deste envio (marque “Incluir leads” no passo Destinatários para incluí-los).",
        },
        { status: 400 }
      );
    }

    // 2. Um registro de envio por contato.
    const sends = await db
      .insert(campaignSends)
      .values(
        eligible.map((contact) => ({
          campaignId: campaign.id,
          channel: "email" as const,
          contactId: contact.id,
        }))
      )
      .returning({
        id: campaignSends.id,
        contactId: campaignSends.contactId,
      });

    // 3. Enfileira no Redis. Agendamentos futuros viram jobs com delay.
    const delay = campaign.scheduledAt
      ? Math.max(campaign.scheduledAt.getTime() - Date.now(), 0)
      : 0;

    const queue = getEmailQueue();
    await queue.addBulk(
      sends.map((send) => ({
        name: "send-email",
        data: {
          sendId: send.id,
          campaignId: campaign.id,
          contactId: send.contactId,
        },
        opts: {
          delay,
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 3000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      }))
    );

    // 4. Atualiza o status da campanha.
    await db
      .update(campaigns)
      .set({ status: delay > 0 ? "scheduled" : "sending" })
      .where(eq(campaigns.id, campaign.id));

    // 5. Resultado.
    return NextResponse.json({
      queued: sends.length,
      scheduled: delay > 0,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
