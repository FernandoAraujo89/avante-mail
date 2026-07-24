import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, passwordResetTokens, users } from "@/lib/db";
import { hashPassword } from "@/lib/passwords";
import { clientIp, rateLimitAllow } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Conclui o "Esqueci minha senha": valida o token (único, com prazo) e troca a senha. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!token) {
      return NextResponse.json(
        { error: "Link de redefinição inválido." },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "A senha precisa ter pelo menos 8 caracteres." },
        { status: 400 }
      );
    }

    // Contém tentativas de adivinhar tokens por força bruta.
    const allowed = await rateLimitAllow(
      `reset:ip:${clientIp(request)}`,
      10,
      15 * 60
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas. Aguarde alguns minutos." },
        { status: 429 }
      );
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const db = getDb();

    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash));

    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        { error: "Link de redefinição inválido ou expirado. Peça um novo." },
        { status: 400 }
      );
    }

    await db
      .update(users)
      .set({ passwordHash: hashPassword(password) })
      .where(eq(users.id, row.userId));

    // Marca como usado e derruba qualquer outro link pendente do usuário.
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
    await db
      .delete(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, row.userId),
          isNull(passwordResetTokens.usedAt)
        )
      );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
