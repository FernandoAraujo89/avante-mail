import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { campaignSends, contacts, getDb, type BounceType } from "@/lib/db";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Verifica a assinatura Svix usada pelo Resend.
 * Retorna true se válida OU se nenhum segredo estiver configurado (modo dev).
 */
function verifySignature(
  secret: string | undefined,
  headers: Headers,
  payload: string
): boolean {
  if (!secret) return true; // sem segredo: aceita (útil em dev/local)

  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  // O segredo tem o prefixo "whsec_" seguido do valor em base64.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${payload}`;
  const expected = createHmac("sha256", key)
    .update(signedContent)
    .digest("base64");

  // O header traz uma lista "v1,<assinatura> v1,<assinatura>...".
  return signatureHeader.split(" ").some((entry) => {
    const candidate = entry.split(",")[1] ?? entry;
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

function resolveBounceType(data: Record<string, unknown>): BounceType {
  // Resend/SES: "Permanent" = hard; "Transient"/"Undetermined" = soft.
  const raw = String(
    (data.type as string) ??
      ((data.bounce as Record<string, unknown>)?.type as string) ??
      ""
  ).toLowerCase();
  return raw.includes("permanent") || raw.includes("hard") ? "hard" : "soft";
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.text();

    if (
      !verifySignature(
        process.env.RESEND_WEBHOOK_SECRET,
        request.headers,
        payload
      )
    ) {
      return NextResponse.json(
        { error: "Assinatura inválida." },
        { status: 401 }
      );
    }

    const event = JSON.parse(payload) as {
      type?: string;
      data?: { email_id?: string; [key: string]: unknown };
    };

    const type = event.type ?? "";
    const emailId = event.data?.email_id;
    if (!emailId) {
      return NextResponse.json({ ok: true, ignored: "sem email_id" });
    }

    const db = getDb();
    const [send] = await db
      .select()
      .from(campaignSends)
      .where(eq(campaignSends.resendId, emailId));

    if (!send) {
      // Evento de um e-mail que não é do sistema — reconhece e ignora.
      return NextResponse.json({ ok: true, ignored: "envio não encontrado" });
    }

    switch (type) {
      case "email.bounced": {
        const bounceType = resolveBounceType(event.data ?? {});
        await db
          .update(campaignSends)
          .set({
            status: "bounced",
            bouncedAt: send.bouncedAt ?? new Date(),
            bounceType,
          })
          .where(eq(campaignSends.id, send.id));

        // Bounce definitivo (endereço não existe/não aceita mais e-mails):
        // suprime o contato para não continuar sendo alvo de campanhas e
        // prejudicar a reputação de envio. Bounce transitório (soft) não
        // suprime — pode ser algo passageiro (caixa cheia, servidor fora).
        if (bounceType === "hard") {
          await db
            .update(contacts)
            .set({ subscribed: false })
            .where(eq(contacts.id, send.contactId));
        }
        break;
      }

      case "email.complained":
        await db
          .update(campaignSends)
          .set({ complainedAt: send.complainedAt ?? new Date() })
          .where(eq(campaignSends.id, send.id));

        // Reclamação de spam: suprime imediatamente, sem exceção — é o
        // pedido mais forte possível de não receber mais e-mails.
        await db
          .update(contacts)
          .set({ subscribed: false })
          .where(eq(contacts.id, send.contactId));
        break;

      // email.delivered / email.sent / email.opened / email.clicked:
      // a entrega já é inferida do envio e o engajamento vem do nosso
      // próprio tracking (pixel + redirect). Apenas reconhecemos.
      default:
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
