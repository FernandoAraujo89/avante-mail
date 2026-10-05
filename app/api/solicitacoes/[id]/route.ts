import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  CAMPAIGN_REQUEST_STATUSES,
  campaignRequests,
  getDb,
  type CampaignRequestStatus,
} from "@/lib/db";
import { sessionUserFromRequest } from "@/lib/session";
import { carregarSolicitacoes } from "@/lib/solicitacoes";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function naoEncontrada() {
  return NextResponse.json(
    { error: "Solicitação não encontrada." },
    { status: 404 }
  );
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!UUID_REGEX.test(id)) return naoEncontrada();
    const [dto] = await carregarSolicitacoes(id);
    return dto ? NextResponse.json(dto) : naoEncontrada();
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** Andamento do pedido: só o marketing (admin) mexe. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await sessionUserFromRequest(request);
    if (user?.role !== "admin") {
      return NextResponse.json(
        { error: "Só administradores atendem solicitações." },
        { status: 403 }
      );
    }
    const { id } = await context.params;
    if (!UUID_REGEX.test(id)) return naoEncontrada();
    const body = await request.json();

    const updates: Partial<typeof campaignRequests.$inferInsert> = {
      handledBy: user.id,
      updatedAt: new Date(),
    };
    if (body.status !== undefined) {
      if (!CAMPAIGN_REQUEST_STATUSES.includes(body.status)) {
        return NextResponse.json(
          { error: "Situação inválida." },
          { status: 400 }
        );
      }
      updates.status = body.status as CampaignRequestStatus;
    }
    if (body.responseNote !== undefined) {
      updates.responseNote =
        typeof body.responseNote === "string" && body.responseNote.trim()
          ? body.responseNote.trim()
          : null;
    }
    if (body.campaignId !== undefined) {
      if (body.campaignId !== null && !UUID_REGEX.test(body.campaignId)) {
        return NextResponse.json(
          { error: "Campanha inválida." },
          { status: 400 }
        );
      }
      updates.campaignId = body.campaignId;
    }

    const [atualizada] = await getDb()
      .update(campaignRequests)
      .set(updates)
      .where(eq(campaignRequests.id, id))
      .returning({ id: campaignRequests.id });
    if (!atualizada) return naoEncontrada();

    const [dto] = await carregarSolicitacoes(id);
    return NextResponse.json(dto);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** Cancelar: quem pediu, enquanto ninguém começou; ou um admin, sempre. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await sessionUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    const { id } = await context.params;
    if (!UUID_REGEX.test(id)) return naoEncontrada();
    const db = getDb();
    const [atual] = await db
      .select({
        status: campaignRequests.status,
        requestedBy: campaignRequests.requestedBy,
      })
      .from(campaignRequests)
      .where(eq(campaignRequests.id, id));
    if (!atual) return naoEncontrada();

    const podeCancelar =
      user.role === "admin" ||
      (atual.requestedBy === user.id && atual.status === "pendente");
    if (!podeCancelar) {
      return NextResponse.json(
        {
          error:
            "Só dá para cancelar o próprio pedido enquanto ele está pendente.",
        },
        { status: 403 }
      );
    }

    await db.delete(campaignRequests).where(eq(campaignRequests.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
