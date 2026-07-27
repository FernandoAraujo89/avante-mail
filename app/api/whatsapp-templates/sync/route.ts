import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  getDb,
  whatsappTemplates,
  type NewWhatsAppTemplate,
} from "@/lib/db";
import { errorMessage } from "@/lib/utils";
import {
  fetchAllTemplates,
  mapMetaTemplateStatus,
  WhatsAppApiError,
  type MetaTemplate,
} from "@/lib/whatsapp/client";
import type {
  WhatsAppButton,
  WhatsAppTemplateCategory,
  WhatsAppVariableExamples,
} from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

// Converte um template lido da Meta para o formato local (melhor esforço:
// só cabeçalho de texto e botões QUICK_REPLY/URL são representáveis).
function fromMetaTemplate(t: MetaTemplate): NewWhatsAppTemplate | null {
  const body = t.components?.find((c) => c.type === "BODY");
  if (!body?.text) return null;

  const header = t.components?.find((c) => c.type === "HEADER");
  const footer = t.components?.find((c) => c.type === "FOOTER");
  const buttonsComp = t.components?.find((c) => c.type === "BUTTONS");

  const buttons: WhatsAppButton[] = [];
  for (const b of buttonsComp?.buttons ?? []) {
    if (b.type === "QUICK_REPLY" && b.text) {
      buttons.push({ type: "QUICK_REPLY", text: b.text });
    } else if (b.type === "URL" && b.text && b.url) {
      buttons.push({ type: "URL", text: b.text, url: b.url });
    }
  }

  let variableExamples: WhatsAppVariableExamples | null = null;
  const exampleRow = body.example?.body_text?.[0];
  if (exampleRow && exampleRow.length > 0) {
    variableExamples = Object.fromEntries(
      exampleRow.map((value, index) => [String(index + 1), value])
    );
  }

  return {
    name: t.name,
    language: t.language,
    category: t.category as WhatsAppTemplateCategory,
    status: mapMetaTemplateStatus(t.status),
    metaTemplateId: t.id,
    headerType: header?.format === "TEXT" && header.text ? "text" : "none",
    headerText: header?.format === "TEXT" ? (header.text ?? null) : null,
    bodyText: body.text,
    footerText: footer?.text ?? null,
    buttons: buttons.length > 0 ? buttons : null,
    variableExamples,
    qualityScore: t.quality_score?.score ?? null,
    rejectionReason: t.rejected_reason ?? null,
  };
}

// Sincroniza status/qualidade com a Meta e importa templates criados por fora
// (ex.: direto no Gerenciador do WhatsApp). Rascunhos locais não são tocados.
export async function POST() {
  try {
    const db = getDb();
    const metaTemplates = await fetchAllTemplates();
    const local = await db.select().from(whatsappTemplates);

    const metaByKey = new Map<string, MetaTemplate>();
    for (const t of metaTemplates) {
      metaByKey.set(`${t.name}|${t.language}`, t);
    }
    const localNames = new Set(local.map((t) => t.name));

    let updated = 0;
    let missing = 0;

    for (const row of local) {
      if (row.status === "draft") continue;
      const meta =
        metaByKey.get(`${row.name}|${row.language}`) ??
        metaTemplates.find((t) => t.name === row.name);
      if (!meta) {
        missing++;
        continue;
      }
      await db
        .update(whatsappTemplates)
        .set({
          status: mapMetaTemplateStatus(meta.status),
          category: meta.category as WhatsAppTemplateCategory,
          metaTemplateId: meta.id,
          qualityScore: meta.quality_score?.score ?? null,
          rejectionReason: meta.rejected_reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(whatsappTemplates.id, row.id));
      updated++;
    }

    let imported = 0;
    for (const meta of metaTemplates) {
      if (localNames.has(meta.name)) continue;
      const row = fromMetaTemplate(meta);
      if (!row) continue; // sem corpo de texto — não representável no editor
      await db.insert(whatsappTemplates).values(row).onConflictDoNothing();
      localNames.add(meta.name);
      imported++;
    }

    return NextResponse.json({ updated, imported, missing });
  } catch (error) {
    if (error instanceof WhatsAppApiError) {
      return NextResponse.json(
        { error: `Falha ao consultar a Meta: ${error.message}` },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
