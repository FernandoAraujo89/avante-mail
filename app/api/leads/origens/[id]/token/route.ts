import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, webhookSources } from "@/lib/db";
import { getBaseUrl } from "@/lib/email";
import { gerarToken } from "@/lib/webhooks/origens-token";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Gera um token novo para a origem. O anterior para de valer na hora — é o que
 * se quer de uma revogação, mas significa que o cenário do Make fica fora do ar
 * até alguém colar o token novo lá. A tela avisa antes.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [origem] = await db
      .select({ slug: webhookSources.slug })
      .from(webhookSources)
      .where(eq(webhookSources.id, id));

    if (!origem) {
      return NextResponse.json(
        { error: "Origem não encontrada." },
        { status: 404 }
      );
    }

    const { token, tokenHash } = gerarToken();
    await db
      .update(webhookSources)
      .set({ tokenHash })
      .where(eq(webhookSources.id, id));

    return NextResponse.json({
      token,
      url: `${getBaseUrl()}/api/webhooks/entrada/${origem.slug}`,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
