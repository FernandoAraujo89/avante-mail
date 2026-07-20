import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";

import { getDb, users } from "@/lib/db";
import { hashPassword } from "@/lib/passwords";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const body = await request.json();

    const updates: Partial<typeof users.$inferInsert> = {};

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (typeof body.password === "string" && body.password) {
      if (body.password.length < 8) {
        return NextResponse.json(
          { error: "A senha precisa ter pelo menos 8 caracteres." },
          { status: 400 }
        );
      }
      updates.passwordHash = hashPassword(body.password);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo para atualizar." },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning({ id: users.id, name: users.name, email: users.email });

    if (!updated) {
      return NextResponse.json(
        { error: "Usuário não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    // Ninguém exclui a si mesmo (evita trancar-se fora do sistema).
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySessionToken(token) : null;
    if (session?.id === id) {
      return NextResponse.json(
        { error: "Você não pode excluir o seu próprio usuário." },
        { status: 400 }
      );
    }

    const db = getDb();

    // Sempre precisa sobrar pelo menos um usuário.
    const [{ total }] = await db.select({ total: count() }).from(users);
    if (total <= 1) {
      return NextResponse.json(
        { error: "É necessário manter ao menos um usuário no sistema." },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (!deleted) {
      return NextResponse.json(
        { error: "Usuário não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
