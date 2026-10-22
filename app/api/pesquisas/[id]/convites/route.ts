import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getBaseUrl } from "@/lib/base-url";
import { contacts, getDb } from "@/lib/db";
import { contatoEhLead } from "@/lib/escopo-parceiros";
import { carregarPesquisa } from "@/lib/pesquisas";
import { linkDoConvite } from "@/lib/pesquisas/convites";
import { criarConvite } from "@/lib/pesquisas/resposta-publica";
import { sessionUserFromRequest } from "@/lib/session";
import { ehViolacaoDeUnico, errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Convida UM parceiro e devolve o link dele. A parte 4 do plano traz o
// convite por lista e o envio por e-mail/WhatsApp; este é o degrau mínimo.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const pesquisa = UUID_REGEX.test(id) ? await carregarPesquisa(id) : null;
    if (!pesquisa) {
      return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    }
    if (pesquisa.status !== "active") {
      return NextResponse.json(
        { error: "Ative a pesquisa antes de convidar parceiros." },
        { status: 400 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as { contactId?: unknown };
    const contactId = typeof body.contactId === "string" ? body.contactId : "";
    const db = getDb();
    const [contato] = UUID_REGEX.test(contactId)
      ? await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId))
      : [];
    // Pesquisa é com parceiro; lead não entra (mesmo escopo das telas).
    if (!contato || (await contatoEhLead(db, contactId))) {
      return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
    }

    const user = await sessionUserFromRequest(request);
    try {
      const convite = await criarConvite({
        surveyId: id,
        contactId,
        autor: user ? { id: user.id, name: user.name } : null,
      });
      return NextResponse.json(
        { id: convite.id, link: linkDoConvite(getBaseUrl(), convite.token) },
        { status: 201 }
      );
    } catch (error) {
      // Índice único parcial: já há convite aberto deste parceiro.
      if (ehViolacaoDeUnico(error, "survey_invites_aberto_idx")) {
        return NextResponse.json(
          { error: "Este parceiro já tem um convite em aberto para esta pesquisa." },
          { status: 409 }
        );
      }
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
