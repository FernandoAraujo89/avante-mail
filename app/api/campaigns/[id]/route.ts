import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { campaigns, getDb, templates, whatsappTemplates } from "@/lib/db";
import { compileDesignToMjml, isValidDesign } from "@/lib/email-builder/compile";
import { errorMessage, normalizeIds, normalizeTags } from "@/lib/utils";
import { parseVariableMap } from "@/lib/whatsapp/template-input";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [row] = await db
      .select({ campaign: campaigns, templateName: templates.name })
      .from(campaigns)
      .leftJoin(templates, eq(campaigns.templateId, templates.id))
      .where(eq(campaigns.id, id));

    if (!row) {
      return NextResponse.json(
        { error: "Campanha não encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ...row.campaign,
      templateName: row.templateName,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [existing] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, id));

    if (!existing) {
      return NextResponse.json(
        { error: "Campanha não encontrada." },
        { status: 404 }
      );
    }
    if (existing.status === "sending" || existing.status === "sent") {
      return NextResponse.json(
        { error: "Campanhas em envio ou já enviadas não podem ser editadas." },
        { status: 409 }
      );
    }

    const body = await request.json();
    const updates: Partial<typeof campaigns.$inferInsert> = {};

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (typeof body.subject === "string" && body.subject.trim()) {
      updates.subject = body.subject.trim();
    }
    if ("preheader" in body) {
      updates.preheader =
        typeof body.preheader === "string" && body.preheader.trim()
          ? body.preheader.trim()
          : null;
    }
    if ("body" in body) {
      updates.body =
        typeof body.body === "string" && body.body ? body.body : null;
    }
    if ("ctaText" in body) {
      updates.ctaText =
        typeof body.ctaText === "string" && body.ctaText.trim()
          ? body.ctaText.trim()
          : null;
    }
    if ("ctaUrl" in body) {
      updates.ctaUrl =
        typeof body.ctaUrl === "string" && body.ctaUrl.trim()
          ? body.ctaUrl.trim()
          : null;
    }
    if ("templateId" in body) {
      updates.templateId =
        typeof body.templateId === "string" && body.templateId
          ? body.templateId
          : null;
    }
    if ("design" in body) {
      if (body.design === null) {
        updates.design = null;
        updates.mjmlContent = null;
      } else if (isValidDesign(body.design)) {
        updates.design = body.design;
        updates.mjmlContent = compileDesignToMjml(body.design);
        updates.editorType = "builder";
      } else {
        return NextResponse.json(
          { error: "Design do e-mail inválido." },
          { status: 400 }
        );
      }
    }
    if ("lists" in body) {
      const ids = normalizeIds(body.lists);
      updates.lists = ids.length > 0 ? ids : null;
    }
    if ("tagsFilter" in body) {
      updates.tagsFilter = normalizeTags(body.tagsFilter);
    }
    if ("scheduledAt" in body) {
      if (typeof body.scheduledAt === "string" && body.scheduledAt) {
        const date = new Date(body.scheduledAt);
        if (Number.isNaN(date.getTime())) {
          return NextResponse.json(
            { error: "Data de agendamento inválida." },
            { status: 400 }
          );
        }
        updates.scheduledAt = date;
      } else {
        updates.scheduledAt = null;
      }
    }

    // Canal: só muda enquanto rascunho (agendada já tem jobs na fila do
    // canal original).
    if ("channel" in body && existing.status === "draft") {
      updates.channel = body.channel === "whatsapp" ? "whatsapp" : "email";
    }
    if ("whatsappTemplateId" in body) {
      if (
        typeof body.whatsappTemplateId === "string" &&
        body.whatsappTemplateId
      ) {
        const [template] = await db
          .select({ id: whatsappTemplates.id })
          .from(whatsappTemplates)
          .where(eq(whatsappTemplates.id, body.whatsappTemplateId));
        if (!template) {
          return NextResponse.json(
            { error: "Modelo de WhatsApp não encontrado." },
            { status: 400 }
          );
        }
        updates.whatsappTemplateId = template.id;
      } else {
        updates.whatsappTemplateId = null;
      }
    }
    if ("whatsappVariables" in body) {
      updates.whatsappVariables = parseVariableMap(body.whatsappVariables);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo para atualizar." },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(campaigns)
      .set(updates)
      .where(eq(campaigns.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [existing] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, id));

    if (!existing) {
      return NextResponse.json(
        { error: "Campanha não encontrada." },
        { status: 404 }
      );
    }
    if (existing.status === "sending") {
      return NextResponse.json(
        {
          error:
            "Esta campanha está em envio. Aguarde a fila terminar para excluí-la.",
        },
        { status: 409 }
      );
    }

    // campaign_sends caem junto (FK com onDelete: cascade) —
    // o histórico e as métricas desta campanha são apagados.
    await db.delete(campaigns).where(eq(campaigns.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
