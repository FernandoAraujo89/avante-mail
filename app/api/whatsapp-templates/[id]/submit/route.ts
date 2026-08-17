import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, whatsappTemplates } from "@/lib/db";
import { readUpload } from "@/lib/uploads";
import { errorMessage } from "@/lib/utils";
import {
  buildTemplateComponents,
  createTemplate,
  mapMetaTemplateStatus,
  updateTemplate,
  uploadHeaderSample,
  WhatsAppApiError,
} from "@/lib/whatsapp/client";
import { missingExamples } from "@/lib/whatsapp/template-input";
import { isMediaHeader } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Envia o modelo para análise da Meta: cria o template na WABA (primeiro
// envio) ou edita o existente (reenvio após rejeição).
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [template] = await db
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.id, id));
    if (!template) {
      return NextResponse.json(
        { error: "Modelo não encontrado." },
        { status: 404 }
      );
    }
    if (template.status !== "draft" && template.status !== "rejected") {
      return NextResponse.json(
        { error: "Este modelo já foi enviado para análise." },
        { status: 409 }
      );
    }

    const missing = missingExamples(template);
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Preencha um exemplo para cada variável antes de enviar (faltando: ${missing
            .map((n) => `{{${n}}}`)
            .join(", ")}). A Meta usa os exemplos na análise.`,
        },
        { status: 400 }
      );
    }

    // Cabeçalho de imagem/PDF: a análise exige uma AMOSTRA do arquivo. Sobe
    // uma vez por arquivo (o handle fica guardado para reenvios do modelo).
    let headerMediaHandle = template.headerMediaHandle;
    if (isMediaHeader(template.headerType)) {
      const mediaUrl = template.headerMediaUrl?.trim();
      if (!mediaUrl) {
        return NextResponse.json(
          {
            error:
              "Envie o arquivo do cabeçalho antes de mandar o modelo para análise.",
          },
          { status: 400 }
        );
      }
      if (!headerMediaHandle) {
        let file: Awaited<ReturnType<typeof readUpload>>;
        try {
          file = await readUpload(mediaUrl);
        } catch {
          return NextResponse.json(
            {
              error:
                "O arquivo do cabeçalho não está mais no servidor — envie o arquivo novamente.",
            },
            { status: 400 }
          );
        }
        const sample = await uploadHeaderSample({
          bytes: file.bytes,
          mimeType: file.mimeType,
        });
        headerMediaHandle = sample.handle;
      }
    }

    const components = buildTemplateComponents({
      ...template,
      headerMediaHandle,
    });

    let metaTemplateId = template.metaTemplateId;
    let status: "pending" | ReturnType<typeof mapMetaTemplateStatus> = "pending";

    if (metaTemplateId) {
      await updateTemplate(metaTemplateId, {
        category: template.category,
        components,
      });
    } else {
      const created = await createTemplate({
        name: template.name,
        language: template.language,
        category: template.category,
        components,
      });
      metaTemplateId = created.id;
      status = mapMetaTemplateStatus(created.status);
    }

    const [updated] = await db
      .update(whatsappTemplates)
      .set({
        metaTemplateId,
        headerMediaHandle,
        status,
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(whatsappTemplates.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof WhatsAppApiError) {
      return NextResponse.json(
        {
          error: `Meta recusou o envio: ${error.message}${
            error.details ? ` — ${error.details}` : ""
          }`,
          code: error.code,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
