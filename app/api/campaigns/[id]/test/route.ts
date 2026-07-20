import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { campaigns, getDb, templates } from "@/lib/db";
import { buildEmailHtml, buildTestVariables } from "@/lib/email";
import { sendEmail } from "@/lib/ses";
import { EMAIL_REGEX, errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MAX_TEST_RECIPIENTS = 3;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const body = await request.json().catch(() => ({}));

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
