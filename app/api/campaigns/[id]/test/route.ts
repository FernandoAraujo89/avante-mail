import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  campaigns,
  getDb,
  templates,
  whatsappTemplates,
  type Campaign,
} from "@/lib/db";
import { buildEmailHtml, buildTestVariables } from "@/lib/email";
import { normalizePhone, phoneToWaId } from "@/lib/phone";
import { sendEmail } from "@/lib/ses";
import { sendSms } from "@/lib/sms/client";
import { isSmsEnabled } from "@/lib/sms/config";
import { sanitizeGsm7 } from "@/lib/sms/gsm7";
import { MOTIVO_LABEL, parseBrazilianMobile } from "@/lib/sms/phone";
import { EMAIL_REGEX, errorMessage } from "@/lib/utils";
import {
  isWhatsAppConfigured,
  sendTemplateMessage,
} from "@/lib/whatsapp/client";
import { buildBodyComponents } from "@/lib/whatsapp/variables";

export const dynamic = "force-dynamic";

const MAX_TEST_RECIPIENTS = 3;

type RouteContext = { params: Promise<{ id: string }> };

// Teste do canal WhatsApp: envia o modelo real (custo normal por mensagem)
// para até 3 telefones, usando o mapeamento da campanha com um contato de
// exemplo no lugar dos dados reais.
async function sendWhatsAppTest(
  db: ReturnType<typeof getDb>,
  campaign: Campaign,
  body: Record<string, unknown>
) {
  if (!isWhatsAppConfigured()) {
    return NextResponse.json(
      {
        error:
          "Canal WhatsApp ainda não configurado — preencha as envs WHATSAPP_* (Fase 0 do plano).",
      },
      { status: 400 }
    );
  }

  const raw: string[] = Array.isArray(body.phones)
    ? body.phones.map((p: unknown) => String(p))
    : typeof body.phones === "string"
      ? body.phones.split(",")
      : [];
  const trimmed = [...new Set(raw.map((p) => p.trim()).filter(Boolean))];

  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "Informe ao menos um telefone de teste." },
      { status: 400 }
    );
  }
  if (trimmed.length > MAX_TEST_RECIPIENTS) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_TEST_RECIPIENTS} telefones de teste.` },
      { status: 400 }
    );
  }
  const phones: string[] = [];
  for (const value of trimmed) {
    const phone = normalizePhone(value);
    if (!phone) {
      return NextResponse.json(
        { error: `Telefone inválido: ${value} (use DDD, ex.: 48 99999-9999).` },
        { status: 400 }
      );
    }
    phones.push(phone);
  }

  if (!campaign.whatsappTemplateId) {
    return NextResponse.json(
      { error: "Escolha o modelo de WhatsApp antes de enviar o teste." },
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

  const components = buildBodyComponents({
    bodyText: template.bodyText,
    variables: campaign.whatsappVariables,
    examples: template.variableExamples,
    contact: { name: "Parceiro Teste", company: "Empresa Exemplo" },
  });

  const results = await Promise.allSettled(
    phones.map((phone) =>
      sendTemplateMessage({
        to: phoneToWaId(phone),
        templateName: template.name,
        language: template.language,
        components,
      })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results
    .map((r, i) => ({ r, phone: phones[i] }))
    .filter((x) => x.r.status === "rejected")
    .map((x) => x.phone);

  if (sent === 0) {
    const [first] = results;
    const reason =
      first.status === "rejected" ? errorMessage(first.reason) : "";
    return NextResponse.json(
      {
        error: `Falha ao enviar o teste para: ${failed.join(", ")}${
          reason ? ` — ${reason}` : ""
        }`,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ sent, failed, recipients: phones });
}

// Teste do canal SMS: manda a mensagem real (cobrada normalmente, por
// segmento) para até 3 celulares. Vale mais aqui do que nos outros canais —
// a transliteração para GSM-7 e a quebra em segmentos só aparecem de verdade
// no aparelho, e o disparo real não tem volta.
async function sendSmsTest(campaign: Campaign, body: Record<string, unknown>) {
  if (!isSmsEnabled()) {
    return NextResponse.json(
      {
        error:
          "Canal SMS ainda não configurado — defina TWILIO_SMS_ENABLED=true e as envs TWILIO_* no servidor.",
      },
      { status: 400 }
    );
  }

  const raw: string[] = Array.isArray(body.phones)
    ? body.phones.map((p: unknown) => String(p))
    : typeof body.phones === "string"
      ? body.phones.split(",")
      : [];
  const trimmed = [...new Set(raw.map((p) => p.trim()).filter(Boolean))];

  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "Informe ao menos um celular de teste." },
      { status: 400 }
    );
  }
  if (trimmed.length > MAX_TEST_RECIPIENTS) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_TEST_RECIPIENTS} celulares de teste.` },
      { status: 400 }
    );
  }

  // parseBrazilianMobile, e não normalizePhone: fixo não recebe SMS, e o erro
  // da Twilio (21614) só apareceria depois de a mensagem já ter sido cobrada.
  const phones: string[] = [];
  for (const value of trimmed) {
    const resultado = parseBrazilianMobile(value);
    if (!resultado.ok) {
      return NextResponse.json(
        { error: `${value}: ${MOTIVO_LABEL[resultado.motivo]}` },
        { status: 400 }
      );
    }
    phones.push(resultado.e164);
  }

  const texto = campaign.smsBody?.trim();
  if (!texto) {
    return NextResponse.json(
      { error: "Escreva o texto do SMS antes de enviar o teste." },
      { status: 400 }
    );
  }
  const sanitizado = sanitizeGsm7(texto);
  if (!sanitizado.ok) {
    const problemas = [...sanitizado.emojis, ...sanitizado.foraDoGsm7];
    return NextResponse.json(
      { error: `O SMS não aceita ${problemas.join(" ")}.` },
      { status: 400 }
    );
  }

  const results = await Promise.allSettled(
    phones.map((phone) => sendSms({ to: phone, body: sanitizado.texto }))
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results
    .map((r, i) => ({ r, phone: phones[i] }))
    .filter((x) => x.r.status === "rejected")
    .map((x) => x.phone);

  if (sent === 0) {
    const [first] = results;
    const reason =
      first.status === "rejected" ? errorMessage(first.reason) : "";
    return NextResponse.json(
      {
        error: `Falha ao enviar o teste para: ${failed.join(", ")}${
          reason ? ` — ${reason}` : ""
        }`,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ sent, failed, recipients: phones });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const body = await request.json().catch(() => ({}));

    // O canal WhatsApp usa telefones; o de e-mail segue o fluxo abaixo.
    const [target] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, id));
    if (!target) {
      return NextResponse.json(
        { error: "Campanha não encontrada." },
        { status: 404 }
      );
    }
    if (target.channel === "whatsapp") {
      return await sendWhatsAppTest(db, target, body);
    }
    if (target.channel === "sms") {
      return await sendSmsTest(target, body);
    }

    // Aceita string ("a@x.com, b@y.com") ou array de e-mails.
    const raw: string[] = Array.isArray(body.emails)
      ? body.emails.map((e: unknown) => String(e))
      : typeof body.emails === "string"
        ? body.emails.split(",")
        : [];

    const emails = [
      ...new Set(raw.map((e) => e.trim().toLowerCase()).filter(Boolean)),
    ];

    if (emails.length === 0) {
      return NextResponse.json(
        { error: "Informe ao menos um e-mail de teste." },
        { status: 400 }
      );
    }
    if (emails.length > MAX_TEST_RECIPIENTS) {
      return NextResponse.json(
        { error: `Máximo de ${MAX_TEST_RECIPIENTS} e-mails de teste.` },
        { status: 400 }
      );
    }
    const invalid = emails.filter((e) => !EMAIL_REGEX.test(e));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `E-mail(s) inválido(s): ${invalid.join(", ")}` },
        { status: 400 }
      );
    }

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
    // E-mail próprio da campanha; fallback no template de origem (legado).
    let mjmlContent = campaign.mjmlContent;
    if (!mjmlContent) {
      if (!campaign.templateId) {
        return NextResponse.json(
          { error: "Monte o e-mail da campanha antes de enviar o teste." },
          { status: 400 }
        );
      }
      const [template] = await db
        .select({ mjmlContent: templates.mjmlContent })
        .from(templates)
        .where(eq(templates.id, campaign.templateId));

      if (!template) {
        return NextResponse.json(
          { error: "Esta campanha não tem e-mail montado e o template de origem não existe mais." },
          { status: 400 }
        );
      }
      mjmlContent = template.mjmlContent;
    }

    if (!process.env.SES_FROM_EMAIL) {
      return NextResponse.json(
        { error: "Envio não configurado (SES_FROM_EMAIL)." },
        { status: 500 }
      );
    }

    // Monta o HTML uma vez (sem rastreamento) e reutiliza para todos.
    const variables = buildTestVariables(campaign);
    const { html } = await buildEmailHtml(mjmlContent, variables);

    const results = await Promise.allSettled(
      emails.map((to) =>
        sendEmail({
          to,
          subject: `[TESTE] ${campaign.subject}`,
          html,
        })
      )
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results
      .map((r, i) => ({ r, email: emails[i] }))
      .filter((x) => x.r.status === "rejected")
      .map((x) => x.email);

    if (sent === 0) {
      return NextResponse.json(
        { error: `Falha ao enviar o teste para: ${failed.join(", ")}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ sent, failed, recipients: emails });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
