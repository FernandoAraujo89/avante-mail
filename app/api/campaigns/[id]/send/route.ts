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
import { getEmailQueue, getSmsQueue, getWhatsAppQueue } from "@/lib/queue";
import { sessionUserFromRequest } from "@/lib/session";
import { isSmsEnabled } from "@/lib/sms/config";
import { countSms, sanitizeGsm7 } from "@/lib/sms/gsm7";
import { resolveNewsList, resolveTeamList } from "@/lib/settings";
import { errorMessage } from "@/lib/utils";
import { isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { missingVariableSources } from "@/lib/whatsapp/variables";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Enfileira os jobs; se a fila recusar, APAGA os envios recém-criados.
 *
 * Sem isso a campanha ficaria presa: os registros de envio já estariam
 * gravados, nenhum job existiria para processá-los, e a segunda tentativa
 * bateria no índice único (campanha, contato) — ou seja, ninguém receberia e
 * não haveria como corrigir pela interface. Desfazer devolve a campanha ao
 * estado de antes, disparável de novo assim que o Redis voltar.
 *
 * Apagar por campanha é seguro porque só se dispara a partir de rascunho: as
 * únicas linhas existentes são as desta tentativa.
 */
async function enfileirarOuDesfazer(
  db: ReturnType<typeof getDb>,
  campaignId: string,
  enfileirar: () => Promise<unknown>
): Promise<void> {
  try {
    await enfileirar();
  } catch (error) {
    await db
      .delete(campaignSends)
      .where(eq(campaignSends.campaignId, campaignId));
    throw error;
  }
}

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
  // TRAVA 2 (docs/plano-webhooks-leads.md, seção 5): campanha é de parceiro,
  // cliente e colaborador — lead NUNCA entra, sem exceção nem opção. É aqui, e
  // não no seletor, que a regra vale: a escolha manual de destinatários e a
  // campanha duplicada passam por este mesmo caminho.
  conditions.push(naoEhLead());
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
        error:
          "Nenhum destinatário elegível — só contatos com telefone e consentimento de WhatsApp recebem. Leads não entram em campanha: eles são trabalhados em Leads e por automação.",
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
  await enfileirarOuDesfazer(db, campaign.id, () =>
    queue.addBulk(
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
    )
  );

  await db
    .update(campaigns)
    .set({ status: delay > 0 ? "scheduled" : "sending" })
    .where(eq(campaigns.id, campaign.id));

  return NextResponse.json({ queued: sends.length, scheduled: delay > 0 });
}

// Disparo do canal SMS: valida o canal ligado e o texto (não vazio e inteiro
// dentro do GSM-7), seleciona contatos com telefone e consentimento de SMS,
// cria os registros de envio e enfileira em "sms-sends".
async function dispatchSms(db: ReturnType<typeof getDb>, campaign: Campaign) {
  if (!isSmsEnabled()) {
    return NextResponse.json(
      {
        error:
          "Canal SMS ainda não configurado — defina TWILIO_SMS_ENABLED=true e as envs TWILIO_* no servidor.",
      },
      { status: 400 }
    );
  }

  const texto = campaign.smsBody?.trim();
  if (!texto) {
    return NextResponse.json(
      { error: "Escreva o texto do SMS antes de disparar." },
      { status: 400 }
    );
  }

  // A mesma transliteração que o worker fará. Barrar aqui é o que evita
  // descobrir o emoji uma mensagem por vez, com a fila já andando.
  const sanitizado = sanitizeGsm7(texto);
  if (sanitizado.emojis.length > 0) {
    return NextResponse.json(
      {
        error: `Emoji não cabe em SMS: remova ${sanitizado.emojis.join(" ")} do texto. Um único emoji triplica o custo da campanha inteira.`,
      },
      { status: 400 }
    );
  }
  if (sanitizado.foraDoGsm7.length > 0) {
    return NextResponse.json(
      {
        error: `O texto tem caracteres que o SMS não aceita: ${sanitizado.foraDoGsm7.join(" ")}`,
      },
      { status: 400 }
    );
  }

  // Contatos elegíveis: consentimento de SMS + telefone + listas + tags.
  const conditions: SQL[] = [
    eq(contacts.smsSubscribed, true),
    isNotNull(contacts.phone),
  ];
  // TRAVA 2 (docs/plano-webhooks-leads.md, seção 5): campanha é de parceiro,
  // cliente e colaborador — lead NUNCA entra, sem exceção nem opção.
  conditions.push(naoEhLead());
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
  // Escolha manual do passo "Destinatários": só restringe, nunca amplia.
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
        error:
          "Nenhum destinatário elegível — só contatos com telefone e consentimento de SMS recebem. Leads não entram em campanha: eles são trabalhados em Leads e por automação.",
      },
      { status: 400 }
    );
  }

  const sends = await db
    .insert(campaignSends)
    .values(
      eligible.map((contact) => ({
        campaignId: campaign.id,
        channel: "sms" as const,
        contactId: contact.id,
      }))
    )
    .returning({ id: campaignSends.id, contactId: campaignSends.contactId });

  const delay = campaign.scheduledAt
    ? Math.max(campaign.scheduledAt.getTime() - Date.now(), 0)
    : 0;

  const queue = getSmsQueue();
  await enfileirarOuDesfazer(db, campaign.id, () =>
    queue.addBulk(
      sends.map((send) => ({
        name: "send-sms",
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
    )
  );

  await db
    .update(campaigns)
    .set({ status: delay > 0 ? "scheduled" : "sending" })
    .where(eq(campaigns.id, campaign.id));

  return NextResponse.json({
    queued: sends.length,
    scheduled: delay > 0,
    segments: countSms(sanitizado.texto).segmentos,
  });
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
    // Só rascunho dispara. "scheduled" fica de fora de propósito: a campanha
    // agendada JÁ tem a fila inteira criada, com os jobs esperando a hora —
    // disparar de novo duplicava tudo, e cada contato recebia (e era cobrado)
    // duas vezes. Para mudar a hora, edite a campanha; para cancelar, ela
    // precisa voltar a rascunho.
    if (campaign.status !== "draft") {
      const explicacao =
        campaign.status === "scheduled"
          ? "Esta campanha já está agendada — os envios já estão na fila."
          : "Esta campanha já foi disparada.";
      return NextResponse.json({ error: explicacao }, { status: 409 });
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
    if (campaign.channel === "sms") {
      return await dispatchSms(db, campaign);
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
    // TRAVA 2: lead não recebe campanha. Vale igual para o Avante News, que
    // nunca teve lead como público.
    conditions.push(naoEhLead());
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
          error:
            "Nenhum destinatário elegível para os filtros da campanha. Leads não entram em campanha: eles são trabalhados em Leads e por automação.",
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
    await enfileirarOuDesfazer(db, campaign.id, () =>
      queue.addBulk(
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
      )
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
    // 23505 = violação de unicidade. Aqui só pode ser o índice
    // (campaign_id, contact_id): duas requisições de disparo correndo juntas
    // (clique duplo, aba repetida). A segunda perde a corrida e o INSERT
    // inteiro é recusado pelo Postgres — nenhuma linha parcial, ninguém
    // recebe duas vezes. Vira 409 porque é conflito, não falha do servidor.
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "23505"
    ) {
      return NextResponse.json(
        { error: "Esta campanha já está sendo disparada." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
