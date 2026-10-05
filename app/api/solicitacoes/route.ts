import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, inArray, isNull } from "drizzle-orm";

import {
  CAMPAIGN_REQUEST_CHANNELS,
  campaignRequests,
  getDb,
  lists,
  type CampaignRequestChannel,
} from "@/lib/db";
import { sessionUserFromRequest } from "@/lib/session";
import { avisarAdmins, carregarSolicitacoes } from "@/lib/solicitacoes";
import { errorMessage, normalizeIds, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Só o número de pendentes: é o que o menu dos admins consulta.
    if (request.nextUrl.searchParams.get("contagem") === "pendentes") {
      const [{ pendentes }] = await getDb()
        .select({ pendentes: count() })
        .from(campaignRequests)
        .where(eq(campaignRequests.status, "pendente"));
      return NextResponse.json({ pendentes });
    }
    return NextResponse.json(await carregarSolicitacoes());
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await sessionUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    const body = await request.json();

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const briefing =
      typeof body.briefing === "string" ? body.briefing.trim() : "";
    const channels: CampaignRequestChannel[] = Array.isArray(body.channels)
      ? CAMPAIGN_REQUEST_CHANNELS.filter((c) => body.channels.includes(c))
      : [];
    const listIds = normalizeIds(body.listIds).filter((v) =>
      UUID_REGEX.test(v)
    );

    let desiredAt: Date | null = null;
    if (typeof body.desiredAt === "string" && body.desiredAt) {
      desiredAt = new Date(body.desiredAt);
      if (Number.isNaN(desiredAt.getTime())) {
        return NextResponse.json(
          { error: "Data desejada inválida." },
          { status: 400 }
        );
      }
    }

    if (!title) {
      return NextResponse.json(
        { error: "Dê um título ao pedido." },
        { status: 400 }
      );
    }
    if (channels.length === 0) {
      return NextResponse.json(
        { error: "Escolha o canal: e-mail, WhatsApp ou os dois." },
        { status: 400 }
      );
    }
    if (listIds.length === 0) {
      return NextResponse.json(
        { error: "Escolha pelo menos uma lista." },
        { status: 400 }
      );
    }
    if (!briefing) {
      return NextResponse.json(
        { error: "Conte o que a campanha precisa comunicar." },
        { status: 400 }
      );
    }

    const db = getDb();
    // Só listas de parceiros: a de leads não recebe campanha.
    const validas = await db
      .select({ id: lists.id })
      .from(lists)
      .where(and(inArray(lists.id, listIds), isNull(lists.kind)));
    if (validas.length !== listIds.length) {
      return NextResponse.json(
        {
          error:
            "Uma das listas escolhidas não existe ou não pode receber campanha.",
        },
        { status: 400 }
      );
    }

    const [criada] = await db
      .insert(campaignRequests)
      .values({
        title,
        channels,
        listIds,
        briefing,
        desiredAt,
        requestedBy: user.id,
      })
      .returning({ id: campaignRequests.id });

    const [dto] = await carregarSolicitacoes(criada.id);
    await avisarAdmins(dto);
    return NextResponse.json(dto, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
