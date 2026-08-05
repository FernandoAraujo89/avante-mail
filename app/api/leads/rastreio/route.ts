import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, eq, gte } from "drizzle-orm";

import { contactEvents, getDb, siteEventRules, SITE_MATCH_TYPES } from "@/lib/db";
import { getBaseUrl } from "@/lib/email";
import {
  lerCargasDoScript,
  lerRecusas,
  lerUltimaVisita,
} from "@/lib/track/recusas";
import { normalizarPath, origensPermitidas, slugEvento } from "@/lib/track/site";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico e configuração do rastreio de site.
 *
 * Esta tela existe por um motivo operacional: o script roda no site de outra
 * equipe, e o modo de falha mais provável da fase não é um defeito de código —
 * é o rastreio nunca chegar (tag não colada, banner que não chama o
 * consentimento, domínio fora da allowlist). Sem "última visita recebida" e o
 * porquê das recusas, "não aparece nada" é indistinguível de "está tudo certo
 * e ninguém visitou".
 */
export async function GET() {
  try {
    const db = getDb();
    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [regras, ultimaVisita, recusas, visitasNaSemana, cargas] = await Promise.all([
      db
        .select()
        .from(siteEventRules)
        .orderBy(asc(siteEventRules.evento), asc(siteEventRules.valor)),
      lerUltimaVisita(),
      lerRecusas(),
      db
        .select({ total: count() })
        .from(contactEvents)
        .where(
          and(
            eq(contactEvents.type, "site_visited"),
            gte(contactEvents.createdAt, seteDiasAtras)
          )
        ),
      lerCargasDoScript(),
    ]);

    const origens = origensPermitidas();

    return NextResponse.json({
      // A tag pronta para colar, com a fila para comandos chamados antes de o
      // script (async) carregar.
      tag: [
        `<script>window.av=window.av||function(){(window.av.q=window.av.q||[]).push(arguments)};</script>`,
        `<script async src="${getBaseUrl()}/api/track/site.js"></script>`,
      ].join("\n"),
      origens,
      // Sem origem configurada o rastreio é inerte de propósito — e a tela
      // precisa dizer isso, senão parece defeito.
      ativo: origens.length > 0,
      regras,
      ultimaVisita,
      recusas,
      visitasNaSemana: visitasNaSemana[0]?.total ?? 0,
      // Quantas vezes o script foi baixado pelo site. É o que separa "a tag não
      // está lá" de "a tag está lá e calada".
      cargas,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** Cadastra uma página que vira evento nomeado. */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const evento = slugEvento(body.evento);
    if (!evento) {
      return NextResponse.json(
        {
          error:
            "Nome do evento inválido — use letras minúsculas, números e hífen (ex.: precos).",
        },
        { status: 400 }
      );
    }

    const matchType = String(body.matchType ?? "");
    if (!SITE_MATCH_TYPES.includes(matchType as (typeof SITE_MATCH_TYPES)[number])) {
      return NextResponse.json(
        { error: "Tipo de casamento inválido." },
        { status: 400 }
      );
    }

    // Passa pela MESMA normalização que o endpoint aplica no caminho recebido.
    // Se as duas divergirem, a regra simplesmente nunca casa — e ninguém
    // descobre por quê.
    const valor = normalizarPath(body.valor);
    if (!valor) {
      return NextResponse.json(
        { error: "Informe o caminho da página (ex.: /planos)." },
        { status: 400 }
      );
    }

    const [existente] = await db
      .select({ id: siteEventRules.id })
      .from(siteEventRules)
      .where(eq(siteEventRules.valor, valor));
    if (existente) {
      return NextResponse.json(
        { error: `Já existe uma regra para o caminho ${valor}.` },
        { status: 409 }
      );
    }

    const [criada] = await db
      .insert(siteEventRules)
      .values({
        evento,
        matchType: matchType as (typeof SITE_MATCH_TYPES)[number],
        valor,
        description:
          typeof body.description === "string" && body.description.trim()
            ? body.description.trim()
            : null,
      })
      .returning();

    return NextResponse.json({ regra: criada }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
