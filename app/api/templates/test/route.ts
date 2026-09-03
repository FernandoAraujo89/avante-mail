import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, templates } from "@/lib/db";
import { buildEmailHtml, getBaseUrl } from "@/lib/email";
import { compileDesignToMjml, isValidDesign } from "@/lib/email-builder/compile";
import { SAMPLE_VARIABLES } from "@/lib/render";
import { sendEmail } from "@/lib/ses";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MAX_TEST_RECIPIENTS = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Envia o template para caixas de teste SEM passar por uma campanha.
 *
 * Validar o modelo era só possível criando uma campanha de mentira: o único
 * teste que existia era o do wizard, e ele exige campanha salva. Aqui o
 * conteúdo vem do que está na tela — design do criador OU código — então dá
 * para conferir a aparência no meio da criação e da edição, antes de salvar.
 *
 * Nada é gravado: sem envio registrado, sem rastreio de abertura e sem link de
 * descadastro assinado (o rodapé aponta para a página comum). O objetivo é ver
 * o e-mail chegar, não medir o teste.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

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

    // Ordem de preferência: o que está na tela (design ou código) e, só se
    // nada vier, o template salvo — assim o teste vale para alterações ainda
    // não salvas, que é justamente quando se quer conferir.
    let mjmlContent = "";
    let nome = typeof body.name === "string" ? body.name.trim() : "";

    if (body.design !== undefined && body.design !== null) {
      if (!isValidDesign(body.design)) {
        return NextResponse.json(
          { error: "Design do template inválido." },
          { status: 400 }
        );
      }
      mjmlContent = compileDesignToMjml(body.design);
    } else if (typeof body.mjmlContent === "string" && body.mjmlContent.trim()) {
      mjmlContent = body.mjmlContent;
    } else if (typeof body.templateId === "string" && body.templateId) {
      const db = getDb();
      const [template] = await db
        .select()
        .from(templates)
        .where(eq(templates.id, body.templateId));
      if (!template) {
        return NextResponse.json(
          { error: "Template não encontrado." },
          { status: 404 }
        );
      }
      mjmlContent = template.mjmlContent;
      nome = nome || template.name;
    }

    if (!mjmlContent.trim()) {
      return NextResponse.json(
        { error: "Monte o e-mail antes de enviar o teste." },
        { status: 400 }
      );
    }

    if (!process.env.SES_FROM_EMAIL) {
      return NextResponse.json(
        { error: "Envio não configurado (SES_FROM_EMAIL)." },
        { status: 500 }
      );
    }

    // Mesmas variáveis do preview da tela: o e-mail que chega é o e-mail que
    // se estava vendo.
    const { html } = await buildEmailHtml(mjmlContent, {
      ...SAMPLE_VARIABLES,
      unsubscribe_url: `${getBaseUrl()}/unsubscribe`,
    });

    const assunto = `[TESTE] ${nome || "Template sem nome"}`;

    const results = await Promise.allSettled(
      emails.map((to) => sendEmail({ to, subject: assunto, html }))
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
