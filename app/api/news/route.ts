import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { campaigns, getDb, templates } from "@/lib/db";
import { compileDesignToMjml, isValidDesign } from "@/lib/email-builder/compile";
import { resolveNewsList } from "@/lib/settings";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Edições do Avante News (campanhas com kind = "news"). */
export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select({ campaign: campaigns, templateName: templates.name })
      .from(campaigns)
      .leftJoin(templates, eq(campaigns.templateId, templates.id))
      .where(eq(campaigns.kind, "news"))
      .orderBy(desc(campaigns.createdAt));

    return NextResponse.json(
      rows.map((row) => ({ ...row.campaign, templateName: row.templateName }))
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";

    if (!name || !subject) {
      return NextResponse.json(
        { error: "Nome da edição e assunto são obrigatórios." },
        { status: 400 }
      );
    }

    // Destinatários do Avante News não são escolhidos por edição: é sempre a
    // lista de parceiros White Label Ativos.
    const audience = await resolveNewsList();
    if (!audience) {
      return NextResponse.json(
        {
          error:
            "Defina a lista de parceiros White Label Ativos antes de criar uma edição do Avante News.",
        },
        { status: 400 }
      );
    }

    const scheduledAt =
      typeof body.scheduledAt === "string" && body.scheduledAt
        ? new Date(body.scheduledAt)
        : null;

    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json(
        { error: "Data de agendamento inválida." },
        { status: 400 }
      );
    }

    // O e-mail da edição sai de um modelo salvo e pode ser editado à vontade
    // antes do envio — o design é a fonte da verdade, o MJML é compilado aqui.
    let design = null;
    let mjmlContent: string | null = null;
    if (body.design !== undefined && body.design !== null) {
      if (!isValidDesign(body.design)) {
        return NextResponse.json(
          { error: "Design do e-mail inválido." },
          { status: 400 }
        );
      }
      design = body.design;
      mjmlContent = compileDesignToMjml(body.design);
    }

    const [created] = await db
      .insert(campaigns)
      .values({
        name,
        subject,
        kind: "news",
        channel: "email",
        preheader:
          typeof body.preheader === "string" && body.preheader.trim()
            ? body.preheader.trim()
            : null,
        templateId:
          typeof body.templateId === "string" && body.templateId
            ? body.templateId
            : null,
        lists: [audience.id],
        // A lista de colaboradores entra no disparo (resolvida lá), não aqui.
        newsIncludeTeam: body.newsIncludeTeam === true,
        tagsFilter: null,
        design,
        mjmlContent,
        editorType: "builder",
        scheduledAt,
        status: "draft",
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
