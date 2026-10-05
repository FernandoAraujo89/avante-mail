import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, ne } from "drizzle-orm";

import { getDb, users } from "@/lib/db";
import { hashPassword } from "@/lib/passwords";
import { ehPerfil } from "@/lib/perfis";
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
    if (body.role !== undefined) {
      if (!ehPerfil(body.role)) {
        return NextResponse.json(
          { error: "Perfil inválido." },
          { status: 400 }
        );
      }
      // Quem rebaixa a si mesmo perde a tela de usuários e não tem volta.
      const token = request.cookies.get(SESSION_COOKIE)?.value;
      const session = token ? await verifySessionToken(token) : null;
      if (session?.id === id && body.role !== "admin") {
        return NextResponse.json(
          {
            error: "Você não pode tirar o seu próprio acesso de administrador.",
          },
          { status: 400 }
        );
      }
      updates.role = body.role;
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
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      });

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

    // Sempre precisa sobrar pelo menos um administrador.
    const [{ outrosAdmins }] = await db
      .select({ outrosAdmins: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), ne(users.id, id)));
    if (outrosAdmins === 0) {
      return NextResponse.json(
        { error: "É necessário manter ao menos um administrador no sistema." },
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
