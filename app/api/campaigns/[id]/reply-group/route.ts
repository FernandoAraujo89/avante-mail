import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { campaigns, campaignSends, getDb } from "@/lib/db";
import { errorMessage, UUID_REGEX } from "@/lib/utils";
import {
  isReplyGroup,
  replyGroupLabel,
  replyGroupOf,
  replyGroupSentence,
} from "@/lib/whatsapp/replies";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Os contatos de um grupo de resposta da campanha (?resposta=resposta:botao:…)
 * — a base da "Nova campanha para este grupo" do relatório.
 *
 * O grupo é resolvido aqui, e não levado da tela na URL: os ids de mil
 * contatos não cabem num link (o nginx recusa a requisição), e resolvido no
 * servidor o link continua valendo depois de recarregar a página. A regra do
 * grupo é a mesma função do filtro da tabela, então a campanha nova vai para
 * quem a tabela mostrou.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const group = request.nextUrl.searchParams.get("resposta") ?? "";
    if (!isReplyGroup(group)) {
      return NextResponse.json(
        { error: "Grupo de resposta inválido." },
        { status: 400 }
      );
    }

    const db = getDb();
    const [campaign] = UUID_REGEX.test(id)
      ? await db
          .select({
            id: campaigns.id,
            name: campaigns.name,
            channel: campaigns.channel,
            lists: campaigns.lists,
            tagsFilter: campaigns.tagsFilter,
          })
          .from(campaigns)
          .where(eq(campaigns.id, id))
      : [];
    if (!campaign) {
      return NextResponse.json(
        { error: "Campanha não encontrada." },
        { status: 404 }
      );
    }

    const sends = await db
      .select({
        contactId: campaignSends.contactId,
        status: campaignSends.status,
        deliveredAt: campaignSends.deliveredAt,
        repliedAt: campaignSends.repliedAt,
        replyButton: campaignSends.replyButton,
      })
      .from(campaignSends)
      .where(eq(campaignSends.campaignId, id));

    return NextResponse.json({
      campaign,
      label: replyGroupLabel(group),
      sentence: replyGroupSentence(group),
      contactIds: sends
        .filter((send) => replyGroupOf(send) === group)
        .map((send) => send.contactId),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
