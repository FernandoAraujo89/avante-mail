import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, webhookSources } from "@/lib/db";
import { clientIp, rateLimitAllow } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/utils";
import {
  processarEntrada,
  TAMANHO_MAXIMO_BYTES,
  tokenConfere,
  tokenDoCabecalho,
} from "@/lib/webhooks/entrada";

export const dynamic = "force-dynamic";

// Entrada de leads vindos de fora — Make, formulários, anúncios.
// docs/plano-webhooks-leads.md, fase A.
//
// Rota pública (o middleware libera /api/webhooks/), então a porta de entrada
// é o token da origem. Um slug e um token por origem: dá para revogar uma sem
// derrubar as outras, e para saber de onde cada lead veio sem adivinhar.

type RouteContext = { params: Promise<{ slug: string }> };

/** Chamado pelo Make (ou qualquer plataforma) para entregar um lead. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { slug } = await context.params;

    // Limite por origem + IP antes de qualquer trabalho: endpoint público não
    // pode virar porta de enxurrada.
    const permitido = await rateLimitAllow(
      `webhook-entrada:${slug}:${clientIp(request)}`,
      120,
      60
    );
    if (!permitido) {
      return NextResponse.json(
        { ok: false, erro: "Muitas chamadas. Tente em instantes." },
        { status: 429 }
      );
    }

    const db = getDb();
    const [origem] = await db
      .select({
        id: webhookSources.id,
        tokenHash: webhookSources.tokenHash,
      })
      .from(webhookSources)
      .where(
        and(eq(webhookSources.slug, slug), eq(webhookSources.active, true))
      );

    // Origem inexistente e token errado respondem igual, de propósito: quem
    // sonda não descobre quais slugs existem.
    const token = tokenDoCabecalho(request.headers.get("authorization"));
    if (!origem || !token || !tokenConfere(token, origem.tokenHash)) {
      return NextResponse.json(
        { ok: false, erro: "Origem ou token inválido." },
        { status: 401 }
      );
    }

    // Corpo cru: o hash da repetição e o teto de tamanho precisam dele antes
    // de virar objeto.
    const cru = await request.text();
    if (Buffer.byteLength(cru, "utf8") > TAMANHO_MAXIMO_BYTES) {
      return NextResponse.json(
        { ok: false, erro: "Corpo grande demais." },
        { status: 413 }
      );
    }

    let payload: unknown;
    try {
      payload = cru ? JSON.parse(cru) : {};
    } catch {
      return NextResponse.json(
        { ok: false, erro: "Corpo não é um JSON válido." },
        { status: 400 }
      );
    }

    const payloadHash = createHash("sha256").update(cru).digest("hex");
    const resultado = await processarEntrada({
      sourceId: origem.id,
      slug,
      payload,
      payloadHash,
    });

    return NextResponse.json(resultado.corpo, { status: resultado.httpStatus });
  } catch (error) {
    console.error("[webhook/entrada]", error);
    return NextResponse.json(
      { ok: false, erro: errorMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * Teste de configuração: o Make (e o navegador) conseguem conferir se o slug
 * e o token estão certos sem criar lead nenhum.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  const db = getDb();
  const [origem] = await db
    .select({
      id: webhookSources.id,
      name: webhookSources.name,
      tokenHash: webhookSources.tokenHash,
    })
    .from(webhookSources)
    .where(and(eq(webhookSources.slug, slug), eq(webhookSources.active, true)));

  const token = tokenDoCabecalho(request.headers.get("authorization"));
  if (!origem || !token || !tokenConfere(token, origem.tokenHash)) {
    return NextResponse.json(
      { ok: false, erro: "Origem ou token inválido." },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    origem: origem.name,
    pronto: "Envie um POST com o JSON do lead.",
  });
}
