import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import {
  campaigns,
  getDb,
  parseCampaignChannel,
  templates,
  whatsappTemplates,
} from "@/lib/db";
import { compileDesignToMjml, isValidDesign } from "@/lib/email-builder/compile";
import { errorMessage, normalizeIds, normalizeTags } from "@/lib/utils";
import { parseVariableMap } from "@/lib/whatsapp/template-input";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    // Só campanhas: as edições do Avante News têm tela e relatório próprios.
    const rows = await db
      .select({
        campaign: campaigns,
        templateName: templates.name,
      })
      .from(campaigns)
      .leftJoin(templates, eq(campaigns.templateId, templates.id))
      .where(eq(campaigns.kind, "campaign"))
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
    const channel = parseCampaignChannel(body.channel);

    if (channel === "email" && (!name || !subject)) {
      return NextResponse.json(
        { error: "Nome e assunto são obrigatórios." },
        { status: 400 }
      );
    }
    if (channel !== "email" && !name) {
      // WhatsApp e SMS não têm assunto — só o nome interno da campanha.
      return NextResponse.json(
        { error: "O nome da campanha é obrigatório." },
        { status: 400 }
      );
    }

    // Campos do canal WhatsApp: modelo (validado se informado) e mapa de
    // variáveis. O modelo pode ficar pendente no rascunho.
    let whatsappTemplateId: string | null = null;
    if (
      channel === "whatsapp" &&
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
      whatsappTemplateId = template.id;
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

    // E-mail próprio da campanha (editado no Criador): o design é a fonte da
    // verdade e o MJML é compilado no servidor, como nos templates.
    let design = null;
    let mjmlContent: string | null = null;
    let editorType: "builder" | "code" = "builder";
    if (body.design !== undefined && body.design !== null) {
      if (!isValidDesign(body.design)) {
        return NextResponse.json(
          { error: "Design do e-mail inválido." },
          { status: 400 }
        );
      }
      design = body.design;
      mjmlContent = compileDesignToMjml(body.design);
      editorType = "builder";
    }

    const [created] = await db
      .insert(campaigns)
      .values({
        name,
        // subject é NOT NULL no schema; no WhatsApp e no SMS não existe
        // assunto, então o nome da campanha preenche a coluna (não aparece na
        // mensagem).
        subject: channel === "email" ? subject : name,
        channel,
        whatsappTemplateId,
        whatsappVariables:
          channel === "whatsapp"
            ? parseVariableMap(body.whatsappVariables)
            : null,
        smsBody:
          channel === "sms" && typeof body.smsBody === "string" && body.smsBody.trim()
            ? body.smsBody
            : null,
        preheader:
          typeof body.preheader === "string" && body.preheader.trim()
            ? body.preheader.trim()
            : null,
        body: typeof body.body === "string" && body.body ? body.body : null,
        ctaText:
          typeof body.ctaText === "string" && body.ctaText.trim()
            ? body.ctaText.trim()
            : null,
        ctaUrl:
          typeof body.ctaUrl === "string" && body.ctaUrl.trim()
            ? body.ctaUrl.trim()
            : null,
        templateId:
          typeof body.templateId === "string" && body.templateId
            ? body.templateId
            : null,
        lists: (() => {
          const ids = normalizeIds(body.lists);
          return ids.length > 0 ? ids : null;
        })(),
        tagsFilter: normalizeTags(body.tagsFilter),
        // Ausente = todos os elegíveis; array (mesmo vazio) = escolha manual.
        recipientIds: Array.isArray(body.recipientIds)
          ? normalizeIds(body.recipientIds)
          : null,
        design,
        mjmlContent,
        editorType,
        scheduledAt,
        status: "draft",
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
