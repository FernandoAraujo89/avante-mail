import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";

import { getDb, leadScoreRules, type ContactEventType } from "@/lib/db";
import {
  CHAVE_FAIXA_MORNO,
  CHAVE_FAIXA_QUENTE,
  CHAVE_MEIA_VIDA,
  lerConfiguracao,
  recalcularTodos,
  REGRAS_PADRAO,
} from "@/lib/leads/score";
import { setSetting } from "@/lib/settings";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Tipos de evento que aceitam regra — os que o sistema realmente captura. */
const EVENTOS_PONTUAVEIS = new Set<string>(
  REGRAS_PADRAO.map((r) => r.eventType)
);

export async function GET() {
  try {
    const db = getDb();
    const [regras, config] = await Promise.all([
      db.select().from(leadScoreRules).orderBy(asc(leadScoreRules.eventType)),
      lerConfiguracao(),
    ]);
    return NextResponse.json({ regras, config });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * Salva o modelo e RECALCULA todo mundo na hora.
 *
 * O recálculo é o ponto: a pontuação é derivada, então mudar um peso vale para
 * o histórico inteiro. Sem recalcular aqui, a tela mostraria a regra nova e os
 * números velhos até a passagem da madrugada — e ninguém confiaria no número.
 */
export async function PUT(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const config = body.config ?? {};
    const meiaVida = Number(config.meiaVidaDias);
    const morno = Number(config.faixaMorno);
    const quente = Number(config.faixaQuente);

    if (!Number.isFinite(meiaVida) || meiaVida < 1) {
      return NextResponse.json(
        { error: "A meia-vida precisa ser de ao menos 1 dia." },
        { status: 400 }
      );
    }
    if (!Number.isFinite(morno) || !Number.isFinite(quente)) {
      return NextResponse.json(
        { error: "Informe os limites das faixas." },
        { status: 400 }
      );
    }
    // Faixas invertidas fariam "quente" ser um intervalo vazio — o modelo
    // pareceria funcionar e nenhum lead nunca esquentaria.
    if (quente <= morno) {
      return NextResponse.json(
        { error: "O limite de “quente” precisa ser maior que o de “morno”." },
        { status: 400 }
      );
    }

    const regras = Array.isArray(body.regras) ? body.regras : [];
    for (const regra of regras) {
      const eventType = String(regra.eventType ?? "");
      if (!EVENTOS_PONTUAVEIS.has(eventType)) continue;
      const points = Number(regra.points);
      if (!Number.isFinite(points)) continue;

      await db
        .insert(leadScoreRules)
        .values({
          eventType: eventType as ContactEventType,
          points: Math.round(points),
          active: regra.active !== false,
          description:
            typeof regra.description === "string" ? regra.description : null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: leadScoreRules.eventType,
          set: {
            points: Math.round(points),
            active: regra.active !== false,
            updatedAt: new Date(),
          },
        });
    }

    await Promise.all([
      setSetting(CHAVE_MEIA_VIDA, String(Math.round(meiaVida))),
      setSetting(CHAVE_FAIXA_MORNO, String(Math.round(morno))),
      setSetting(CHAVE_FAIXA_QUENTE, String(Math.round(quente))),
    ]);

    const recalculados = await recalcularTodos();

    const [novasRegras, novaConfig] = await Promise.all([
      db.select().from(leadScoreRules).orderBy(asc(leadScoreRules.eventType)),
      lerConfiguracao(),
    ]);

    return NextResponse.json({
      regras: novasRegras,
      config: novaConfig,
      recalculados,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
