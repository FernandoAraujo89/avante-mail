import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, users } from "@/lib/db";
import { verifyPassword } from "@/lib/passwords";
import { clientIp, rateLimitAllow } from "@/lib/rate-limit";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSessionToken,
} from "@/lib/session";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "Informe e-mail e senha." },
        { status: 400 }
      );
    }

    // Contém força bruta: 10 tentativas por 5 minutos por IP+e-mail.
    const allowed = await rateLimitAllow(
      `login:${clientIp(request)}:${email}`,
      10,
      5 * 60
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas. Aguarde alguns minutos e tente de novo." },
        { status: 429 }
      );
    }

    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.email, email));

    // Mensagem única para e-mail inexistente e senha errada.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { error: "E-mail ou senha incorretos." },
        { status: 401 }
      );
    }

    const token = await signSessionToken({
      id: user.id,
      name: user.name,
      email: user.email,
    });

    const response = NextResponse.json({
      ok: true,
      user: { id: user.id, name: user.name, email: user.email },
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
