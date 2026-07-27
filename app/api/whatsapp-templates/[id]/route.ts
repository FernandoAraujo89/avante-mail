import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";

import { getDb, whatsappTemplates } from "@/lib/db";
import { errorMessage } from "@/lib/utils";
import { deleteTemplateByName, WhatsAppApiError } from "@/lib/whatsapp/client";
import { parseTemplateInput } from "@/lib/whatsapp/template-input";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Estados em que o conteúdo ainda pode ser alterado localmente. Depois de
// aprovado/pausado, edite criando um novo modelo (mantém o histórico íntegro).
const EDITABLE_STATUSES = new Set(["draft", "rejected"]);

export async function GET(_request: NextRequest, context: RouteContext) {
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
    return NextResponse.json(template);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    if (!EDITABLE_STATUSES.has(template.status)) {
      return NextResponse.json(
        { error: "Só rascunhos e modelos rejeitados podem ser editados." },
        { status: 409 }
      );
    }

    const parsed = parseTemplateInput(await request.json());
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // Depois que o modelo já existe na Meta, o nome não pode mudar — a Meta
    // identifica o template pelo nome e a edição é feita sobre o mesmo id.
    if (template.metaTemplateId && parsed.data.name !== template.name) {
      return NextResponse.json(
        { error: "O nome não pode ser alterado após o envio à Meta." },
        { status: 400 }
      );
    }

    const duplicate = await db
      .select({ id: whatsappTemplates.id })
      .from(whatsappTemplates)
      .where(
        and(
          eq(whatsappTemplates.name, parsed.data.name),
          ne(whatsappTemplates.id, id)
        )
      );
    if (duplicate.length > 0) {
      return NextResponse.json(
        { error: "Já existe um modelo com este nome." },
        { status: 409 }
      );
    }

    const [updated] = await db
      .update(whatsappTemplates)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(whatsappTemplates.id, id))
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

    // Se já foi enviado à Meta, exclui lá primeiro (código 100 = já não
    // existe na Meta, então só remove o registro local).
    if (template.metaTemplateId) {
      try {
        await deleteTemplateByName(template.name);
      } catch (error) {
        if (!(error instanceof WhatsAppApiError && error.code === 100)) {
          return NextResponse.json(
            { error: `Não foi possível excluir na Meta: ${errorMessage(error)}` },
            { status: 502 }
          );
        }
      }
    }

    await db.delete(whatsappTemplates).where(eq(whatsappTemplates.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
