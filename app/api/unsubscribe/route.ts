import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { campaignSends, contacts, getDb } from "@/lib/db";
import { emitContactEvent } from "@/lib/events";
import { verifyUnsubscribeToken } from "@/lib/jwt";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // Dois caminhos chegam aqui:
    // 1. A página de descadastro faz fetch com JSON { token }.
    // 2. O provedor (Gmail/Yahoo) faz o POST one-click (RFC 8058) com o token
    //    na query e body form "List-Unsubscribe=One-Click" (não é JSON).
    const queryToken = request.nextUrl.searchParams.get("token");
    let bodyToken = "";
    if (!queryToken) {
      try {
        const body = await request.json();
        bodyToken = typeof body.token === "string" ? body.token : "";
      } catch {
        // POST one-click sem JSON: o token vem só da query.
      }
    }
    const token = queryToken ?? bodyToken;

    if (!token) {
      return NextResponse.json(
        { error: "Token de descadastro ausente." },
        { status: 400 }
      );
    }

    const payload = await verifyUnsubscribeToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Link de descadastro inválido ou expirado." },
        { status: 400 }
      );
    }

    const db = getDb();
    // O estado ANTES da baixa: o RETURNING do update traria o valor novo, e
    // aí não daria para saber se o contato já estava fora — o link costuma ser
    // aberto mais de uma vez, e isso não pode virar evento repetido.
    const [antes] = await db
      .select({ subscribed: contacts.subscribed })
      .from(contacts)
      .where(eq(contacts.id, payload.contactId));

    const [updated] = await db
      .update(contacts)
      .set({ subscribed: false })
      .where(eq(contacts.id, payload.contactId))
      .returning({ email: contacts.email });

    if (!updated) {
      return NextResponse.json(
        { error: "Contato não encontrado." },
        { status: 404 }
      );
    }

    if (antes?.subscribed) {
      await emitContactEvent("email_unsubscribed", payload.contactId, {
        sendId: payload.sendId ?? null,
      });
    }

    // Atribui o descadastro à campanha que originou o clique.
    // isNull evita sobrescrever a data caso o link seja aberto novamente.
    if (payload.sendId) {
      await db
        .update(campaignSends)
        .set({ unsubscribedAt: new Date() })
        .where(
          and(
            eq(campaignSends.id, payload.sendId),
            isNull(campaignSends.unsubscribedAt)
          )
        );
    }

    return NextResponse.json({ ok: true, email: updated.email });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
