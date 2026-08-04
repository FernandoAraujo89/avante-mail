import { NextRequest, NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";

import { getDb, webhookDeliveries, webhookSources } from "@/lib/db";
import { getBaseUrl } from "@/lib/email";
import { gerarToken } from "@/lib/webhooks/origens-token";
import {
  limparDefaults,
  limparMapeamento,
  MAPEAMENTO_PADRAO,
  normalizarSlug,
  semTokenHash,
  slugValido,
} from "@/lib/webhooks/origens";
import { errorMessage, normalizeTags } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Cadastro de origens de webhook pela tela — antes era só por script. */
export async function GET() {
  try {
    const db = getDb();

    const origens = await db
      .select({
        id: webhookSources.id,
        name: webhookSources.name,
        slug: webhookSources.slug,
        mapping: webhookSources.mapping,
        defaults: webhookSources.defaults,
        active: webhookSources.active,
        createdAt: webhookSources.createdAt,
        lastSeenAt: webhookSources.lastSeenAt,
        entregas: sql<number>`count(${webhookDeliveries.id})`.mapWith(Number),
      })
      .from(webhookSources)
      .leftJoin(
        webhookDeliveries,
        eq(webhookDeliveries.sourceId, webhookSources.id)
      )
      .groupBy(webhookSources.id)
      .orderBy(asc(webhookSources.name));

    return NextResponse.json({ origens, baseUrl: getBaseUrl() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "Dê um nome à origem (ex.: “Make — formulário do site”)." },
        { status: 400 }
      );
    }

    // O slug pode vir do usuário ou ser deduzido do nome; nos dois casos passa
    // pela mesma normalização, porque ele vira URL pública.
    const slug = normalizarSlug(
      typeof body.slug === "string" && body.slug.trim() ? body.slug : name
    );
    if (!slugValido(slug)) {
      return NextResponse.json(
        {
          error:
            "Endereço inválido — use ao menos 2 caracteres entre letras, números e hífen.",
        },
        { status: 400 }
      );
    }

    const [existente] = await db
      .select({ id: webhookSources.id })
      .from(webhookSources)
      .where(eq(webhookSources.slug, slug));
    if (existente) {
      return NextResponse.json(
        { error: `Já existe uma origem no endereço “${slug}”.` },
        { status: 409 }
      );
    }

    const { token, tokenHash } = gerarToken();
    const mapping = limparMapeamento(body.mapping);

    const [criada] = await db
      .insert(webhookSources)
      .values({
        name,
        slug,
        tokenHash,
        // Sem mapeamento declarado, o padrão do Make serve de ponto de partida
        // — origem nova sem mapa nenhum rejeitaria todo lead que chegasse.
        mapping:
          Object.keys(mapping).length > 0 ? mapping : MAPEAMENTO_PADRAO,
        defaults: limparDefaults(
          body.defaults,
          normalizeTags(
            (body.defaults as { tags?: unknown } | undefined)?.tags ?? ["lead"]
          )
        ),
        active: body.active !== false,
      })
      .returning();

    // O token cru aparece SÓ aqui: o banco guarda o hash, e a tela avisa que
    // não dá para vê-lo de novo.
    return NextResponse.json(
      {
        origem: semTokenHash(criada),
        token,
        url: `${getBaseUrl()}/api/webhooks/entrada/${slug}`,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
