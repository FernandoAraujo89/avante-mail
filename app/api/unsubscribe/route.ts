import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { optOutEmail, optOutEmailsDoContato } from "@/lib/contatos/enderecos";
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
    const [contato] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, payload.contactId));
    if (!contato) {
      return NextResponse.json(
        { error: "Contato não encontrado." },
        { status: 404 }
      );
    }

    // Sai o E-MAIL que recebeu a mensagem — do token ou do envio. Só os links
    // de antes dos endereços múltiplos, que não dizem qual foi, tiram todos.
    // Supressão de verdade: a pessoa pediu para sair. Quando não sobra e-mail
    // aceitando, a automação em curso para (ver lib/automations/engine.ts).
    let email = payload.email ?? null;
    if (!email && payload.sendId) {
      const [envio] = await db
        .select({ address: campaignSends.address })
        .from(campaignSends)
        .where(eq(campaignSends.id, payload.sendId));
      email = envio?.address ?? null;
    }
    const resultado = email
      ? await optOutEmail(db, email)
      : await optOutEmailsDoContato(db, payload.contactId);

    // O link costuma ser aberto mais de uma vez: só a primeira saída do canal
    // vira evento.
    if (resultado?.contatoSaiu) {
      await emitContactEvent("email_unsubscribed", payload.contactId, {
        sendId: payload.sendId ?? null,
        email,
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

    return NextResponse.json({ ok: true, email });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
