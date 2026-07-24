import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, passwordResetTokens, users } from "@/lib/db";
import { getBaseUrl } from "@/lib/email";
import { clientIp, rateLimitAllow } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/ses";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOKEN_TTL_MINUTES = 60;

/**
 * "Esqueci minha senha" — SEMPRE responde { ok: true }, exista o e-mail ou
 * não, para não permitir enumeração de contas. O token cru vai só no link
 * do e-mail; no banco fica apenas o SHA-256 (vazamento de banco não expõe
 * links válidos). Validade de 1h, uso único.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return NextResponse.json(
        { error: "Informe o e-mail." },
        { status: 400 }
      );
    }

    // Limites: 3 pedidos/15min por e-mail e 10/15min por IP (spam/abuso).
    const ip = clientIp(request);
    const [emailOk, ipOk] = await Promise.all([
      rateLimitAllow(`forgot:email:${email}`, 3, 15 * 60),
      rateLimitAllow(`forgot:ip:${ip}`, 10, 15 * 60),
    ]);
    if (!emailOk || !ipOk) {
      return NextResponse.json(
        { error: "Muitas solicitações. Aguarde alguns minutos." },
        { status: 429 }
      );
    }

    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.email, email));

    if (user) {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");

      // Um pedido novo invalida os links pendentes anteriores.
      await db
        .delete(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.usedAt)
          )
        );

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
      });

      const resetUrl = `${getBaseUrl()}/reset-password?token=${token}`;

      try {
        await sendEmail({
          to: user.email,
          subject: "Redefinição de senha — Avante Mail",
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#282E3F;">
              <h2 style="color:#1D50DC;">Redefinição de senha</h2>
              <p>Olá, ${user.name}.</p>
              <p>Recebemos um pedido para redefinir a sua senha do <strong>Avante Mail</strong>.
              Clique no botão abaixo para escolher uma senha nova. O link vale por
              <strong>${TOKEN_TTL_MINUTES} minutos</strong> e só pode ser usado uma vez.</p>
              <p style="text-align:center;margin:32px 0;">
                <a href="${resetUrl}"
                   style="background:#1D50DC;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:bold;display:inline-block;">
                  Redefinir senha
                </a>
              </p>
              <p style="font-size:12px;color:#8A98A5;">Se você não pediu a redefinição,
              ignore este e-mail — a sua senha continua a mesma.</p>
            </div>`,
        });
      } catch (sendError) {
        // Loga, mas não muda a resposta: a resposta não pode revelar se o
        // e-mail existe nem se o envio funcionou.
        console.error(
          "[FORGOT-PASSWORD] Falha ao enviar e-mail:",
          errorMessage(sendError)
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
