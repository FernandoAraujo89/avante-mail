import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getDb, leadScoreRules } from "@/lib/db";
import {
  CHAVE_FAIXA_AQUECIDO,
  CHAVE_FAIXA_MORNO,
  CHAVE_FAIXA_QUENTE,
  CHAVE_MEIA_VIDA,
  lerConfiguracao,
  recalcularTodos,
} from "@/lib/leads/score";
import { setSetting } from "@/lib/settings";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const [regras, config] = await Promise.all([
      db
        .select()
        .from(leadScoreRules)
        // Segundo critério: sem ele, as duas regras de `site_event` sairiam em
        // ordem imprevisível e a tela embaralharia a cada carga.
        .orderBy(asc(leadScoreRules.eventType), asc(leadScoreRules.points)),
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
    const aquecido = Number(config.faixaAquecido);
    const quente = Number(config.faixaQuente);

    if (!Number.isFinite(meiaVida) || meiaVida < 1) {
      return NextResponse.json(
        { error: "A meia-vida precisa ser de ao menos 1 dia." },
        { status: 400 }
      );
    }
    if (
      !Number.isFinite(morno) ||
      !Number.isFinite(aquecido) ||
      !Number.isFinite(quente)
    ) {
      return NextResponse.json(
        { error: "Informe os limites das faixas." },
        { status: 400 }
      );
    }
    // Cortes fora de ordem fariam uma faixa virar intervalo VAZIO: o modelo
    // pareceria funcionar e nenhum lead jamais entraria naquela faixa. Pior
    // ainda com quatro faixas, onde a do meio some sem sintoma nenhum.
    if (!(morno < aquecido && aquecido < quente)) {
      return NextResponse.json(
        {
          error:
            "Os limites precisam subir: morno < aquecido < quente. Do jeito que estão, uma das faixas nunca teria nenhum lead.",
        },
        { status: 400 }
      );
    }

    // Atualiza por ID, não por event_type.
    //
    // Desde a fase E o mesmo tipo tem VÁRIAS regras (uma por evento nomeado),
    // então "a regra do tipo X" deixou de identificar uma linha. O
    // `onConflictDoUpdate` por event_type que existia aqui quebraria no
    // instante em que o UNIQUE caiu — o Postgres exige um índice único que
    // case com a inferência do ON CONFLICT.
    //
    // As regras são criadas pela migração, nunca pela tela: aqui só se edita
    // peso e liga/desliga. Uma linha que não existe é ignorada em silêncio.
    const regras = Array.isArray(body.regras) ? body.regras : [];
    for (const regra of regras) {
      const id = typeof regra.id === "string" ? regra.id : "";
      if (!id) continue;
      const points = Number(regra.points);
      if (!Number.isFinite(points)) continue;

      await db
        .update(leadScoreRules)
        .set({
          points: Math.round(points),
          active: regra.active !== false,
          updatedAt: new Date(),
        })
        .where(eq(leadScoreRules.id, id));
    }

    await Promise.all([
      setSetting(CHAVE_MEIA_VIDA, String(Math.round(meiaVida))),
      setSetting(CHAVE_FAIXA_MORNO, String(Math.round(morno))),
      setSetting(CHAVE_FAIXA_AQUECIDO, String(Math.round(aquecido))),
      setSetting(CHAVE_FAIXA_QUENTE, String(Math.round(quente))),
    ]);

    const recalculados = await recalcularTodos();

    const [novasRegras, novaConfig] = await Promise.all([
      db
        .select()
        .from(leadScoreRules)
        .orderBy(asc(leadScoreRules.eventType), asc(leadScoreRules.points)),
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
