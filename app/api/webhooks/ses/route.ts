import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import MessageValidator from "sns-validator";

import { campaignSends, contacts, getDb, type BounceType } from "@/lib/db";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Recebe as notificações de devolução e reclamação do Amazon SES,
 * entregues via Amazon SNS. O SES publica no tópico SNS e o SNS faz POST
 * aqui com um de três tipos (header x-amz-sns-message-type):
 *  - SubscriptionConfirmation: primeira mão, confirma a inscrição do endpoint;
 *  - Notification: o evento de fato (Bounce/Complaint/Delivery/...);
 *  - UnsubscribeConfirmation: quando o tópico é desinscrito.
 *
 * Segurança: a assinatura da mensagem é verificada criptograficamente
 * (sns-validator baixa o certificado de SigningCertURL — restrito a hosts
 * *.amazonaws.com pela própria lib — e confere a assinatura RSA). Sem isso,
 * qualquer um que soubesse o ARN do tópico (não é segredo) poderia forjar
 * bounce/reclamação pra qualquer contato, ou apontar SubscribeURL pra uma
 * URL arbitrária (SSRF). O ARN esperado é conferido como camada extra.
 */

interface SnsMessage {
  Type?: string;
  TopicArn?: string;
  SubscribeURL?: string;
  Message?: string;
  [key: string]: unknown;
}

const validator = new MessageValidator();

function validateSignature(message: SnsMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    validator.validate(message, (err) => (err ? reject(err) : resolve()));
  });
}

// Só aceita mensagens do tópico esperado (quando SES_SNS_TOPIC_ARN está
// definido) — camada extra além da assinatura.
function topicAllowed(topicArn: string | undefined): boolean {
  const expected = process.env.SES_SNS_TOPIC_ARN;
  if (!expected) return true; // sem restrição em dev/local
  return topicArn === expected;
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.text();
    const envelope = JSON.parse(payload) as SnsMessage;

    try {
      await validateSignature(envelope);
    } catch (error) {
      return NextResponse.json(
        { error: `Assinatura SNS inválida: ${errorMessage(error)}` },
        { status: 401 }
      );
    }

    const snsType =
      request.headers.get("x-amz-sns-message-type") ?? envelope.Type ?? "";

    if (!topicAllowed(envelope.TopicArn)) {
      return NextResponse.json(
        { error: "Tópico SNS não autorizado." },
        { status: 401 }
      );
    }

    // Confirmação de inscrição: a assinatura já garante que a SubscribeURL
    // veio do SNS de verdade, então é seguro acessá-la.
    if (snsType === "SubscriptionConfirmation" && envelope.SubscribeURL) {
      await fetch(envelope.SubscribeURL);
      return NextResponse.json({ ok: true, confirmed: true });
    }

    if (snsType !== "Notification" || !envelope.Message) {
      return NextResponse.json({ ok: true, ignored: snsType || "sem tipo" });
    }

    // O evento do SES vem serializado dentro de Message.
    const event = JSON.parse(envelope.Message) as {
      notificationType?: string;
      eventType?: string;
      mail?: { messageId?: string };
      bounce?: { bounceType?: string };
      complaint?: Record<string, unknown>;
    };

    // Notificações por identidade usam notificationType; conjuntos de
    // configuração usam eventType. Aceitamos os dois.
    const kind = event.notificationType ?? event.eventType ?? "";
    const messageId = event.mail?.messageId;
    if (!messageId) {
      return NextResponse.json({ ok: true, ignored: "sem messageId" });
    }

    const db = getDb();
    const [send] = await db
      .select()
      .from(campaignSends)
      .where(eq(campaignSends.providerMessageId, messageId));

    if (!send) {
      // Evento de um e-mail que não é do sistema — reconhece e ignora.
      return NextResponse.json({ ok: true, ignored: "envio não encontrado" });
    }

    switch (kind) {
      case "Bounce": {
        // Permanent = hard; Transient/Undetermined = soft.
        const raw = String(event.bounce?.bounceType ?? "").toLowerCase();
        const bounceType: BounceType = raw.includes("permanent")
          ? "hard"
          : "soft";

        await db
          .update(campaignSends)
          .set({
            status: "bounced",
            bouncedAt: send.bouncedAt ?? new Date(),
            bounceType,
          })
          .where(eq(campaignSends.id, send.id));

        // Bounce definitivo: suprime o contato para preservar a reputação de
        // envio. Bounce transitório (soft) não suprime — pode ser passageiro.
        if (bounceType === "hard") {
          // Endereço morto: suprime. Automação em curso também para — seguir
          // mandando para um endereço que devolve queima a reputação.
          await db
            .update(contacts)
            .set({ subscribed: false, emailOptOutAt: new Date() })
            .where(eq(contacts.id, send.contactId));
        }
        break;
      }

      case "Complaint":
        await db
          .update(campaignSends)
          .set({ complainedAt: send.complainedAt ?? new Date() })
          .where(eq(campaignSends.id, send.id));

        // Reclamação de spam: suprime imediatamente, sem exceção.
        await db
          .update(contacts)
          .set({ subscribed: false, emailOptOutAt: new Date() })
          .where(eq(contacts.id, send.contactId));
        break;

      // Delivery / Send / Open / Click: a entrega é inferida do envio e o
      // engajamento vem do nosso próprio tracking (pixel + redirect). Ignora.
      default:
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
