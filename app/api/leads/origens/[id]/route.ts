import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, webhookSources } from "@/lib/db";
import {
  limparDefaults,
  limparMapeamento,
  semTokenHash,
  type DefaultsDaOrigem,
} from "@/lib/webhooks/origens";
import { errorMessage, normalizeTags } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Edição da origem. O SLUG não é editável de propósito: ele já está colado no
 * cenário do Make do outro lado, e trocá-lo aqui derrubaria a integração em
 * silêncio — quem quiser outro endereço cria uma origem nova e desliga esta.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const body = await request.json().catch(() => ({}));

    const [origem] = await db
      .select()
      .from(webhookSources)
      .where(eq(webhookSources.id, id));
    if (!origem) {
      return NextResponse.json(
        { error: "Origem não encontrada." },
        { status: 404 }
      );
    }

    const updates: Partial<typeof webhookSources.$inferInsert> = {};

    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return NextResponse.json(
          { error: "O nome da origem é obrigatório." },
          { status: 400 }
        );
      }
      updates.name = name;
    }
    if ("active" in body) updates.active = body.active === true;
    if ("mapping" in body) updates.mapping = limparMapeamento(body.mapping);
    if ("defaults" in body) {
      const enviados = (body.defaults ?? {}) as { tags?: unknown };
      const anteriores = (origem.defaults ?? {}) as DefaultsDaOrigem;
      updates.defaults = limparDefaults(
        body.defaults,
        normalizeTags("tags" in enviados ? enviados.tags : anteriores.tags)
      );
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ origem: semTokenHash(origem) });
    }

    const [atualizada] = await db
      .update(webhookSources)
      .set(updates)
      .where(eq(webhookSources.id, id))
      .returning();

    return NextResponse.json({ origem: semTokenHash(atualizada) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    // As entregas caem junto (cascade). Os LEADS já criados ficam: eles são
    // contatos, e apagar a origem não pode apagar quem entrou por ela.
    const apagadas = await db
      .delete(webhookSources)
      .where(eq(webhookSources.id, id))
      .returning({ id: webhookSources.id });

    if (apagadas.length === 0) {
      return NextResponse.json(
        { error: "Origem não encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
