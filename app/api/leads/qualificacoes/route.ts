import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";

import {
  contacts,
  getDb,
  leadQualifications,
  leadScoreRules,
  type LeadScoreRule,
} from "@/lib/db";
import { listarQualificacoes } from "@/lib/leads/qualificacoes";
import { slugDaEtapa } from "@/lib/leads/etapas";
import { recalcularTodos } from "@/lib/leads/score";
import { VARIANTES_DE_QUALIFICACAO } from "@/components/leads/qualificacoes";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * As qualificações do lead — espelho do campo "Lead qualificado" do Pipedrive.
 *
 * Cadastro pela tela pelo mesmo motivo das etapas: o campo é do comercial, e
 * cada opção nova lá viraria um deploy nosso se a lista morasse no código —
 * até o deploy sair, o webhook do agente chegaria com uma qualificação que o
 * sistema recusa. Foi exatamente o que aconteceu com "Promissor: Baixo
 * potencial", "Não" e "Não identificado".
 *
 * Os PONTOS de cada qualificação continuam sendo regras de `lead_score_rules`
 * (event_type `lead_qualified`, condition por slug) — esta rota as edita por
 * conveniência, mas o mecanismo é o mesmo da tela de pontuação.
 */

function regraDaQualificacao(
  regras: LeadScoreRule[],
  slug: string
): LeadScoreRule | null {
  return (
    regras.find(
      (r) =>
        r.eventType === "lead_qualified" &&
        (r.condition as Record<string, unknown> | null)?.qualificacao === slug
    ) ?? null
  );
}

export async function GET() {
  try {
    const db = getDb();
    const [qualificacoes, porQualificacao, regras] = await Promise.all([
      listarQualificacoes(true),
      // Quantos leads em cada qualificação — é o que impede apagar uma cheia
      // sem perceber, e o que mostra se o agente está mesmo mandando.
      db
        .select({ qualificacao: contacts.qualification, total: count() })
        .from(contacts)
        .groupBy(contacts.qualification),
      db
        .select()
        .from(leadScoreRules)
        .where(eq(leadScoreRules.eventType, "lead_qualified")),
    ]);

    return NextResponse.json({
      qualificacoes,
      uso: Object.fromEntries(
        porQualificacao
          .filter((r) => r.qualificacao)
          .map((r) => [r.qualificacao as string, r.total])
      ),
      pontos: Object.fromEntries(
        qualificacoes
          .map((q) => [q.slug, regraDaQualificacao(regras, q.slug)?.points])
          .filter(([, pontos]) => pontos !== undefined)
      ),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json().catch(() => ({}));

    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) {
      return NextResponse.json(
        {
          error:
            "Dê um nome à qualificação — o mesmo da opção no Pipedrive.",
        },
        { status: 400 }
      );
    }

    // O slug sai do rótulo, como nas etapas: é ele que o webhook resolve, e
    // pedir os dois seria pedir para o operador manter duas coisas em
    // sincronia. `resolverQualificacao` casa pelas duas formas de todo jeito.
    const slug = slugDaEtapa(label);
    if (!slug) {
      return NextResponse.json(
        { error: "O nome precisa ter ao menos uma letra ou número." },
        { status: 400 }
      );
    }

    // A colisão se checa por slug E por rótulo normalizado: as qualificações
    // antigas guardam slug curto ("experiente") com rótulo do Pipedrive ("Sim:
    // Experiente"), e recriar o rótulo geraria uma SOMBRA ("sim-experiente")
    // que o webhook passaria a preferir — dois registros para a mesma opção,
    // cada lead caindo num deles conforme a forma que o agente mandou.
    const todas = await listarQualificacoes(true);
    const conflito = todas.find(
      (q) => slugDaEtapa(q.slug) === slug || slugDaEtapa(q.label) === slug
    );
    if (conflito) {
      return NextResponse.json(
        {
          error: `Essa opção já existe como "${conflito.label}" (identificador "${conflito.slug}").`,
        },
        { status: 409 }
      );
    }

    const [criada] = await db
      .insert(leadQualifications)
      .values({
        slug,
        label,
        position: Number.isFinite(Number(body.position))
          ? Math.round(Number(body.position))
          : 0,
      })
      .returning();

    // Pontos junto da criação: a regra nasce aqui porque uma qualificação
    // que pontua é o caso comum, e mandar o operador a outra tela para dar
    // peso ao que acabou de criar é perder o peso no caminho.
    const pontos = Number(body.pontos);
    if (body.pontos !== undefined && body.pontos !== "" && Number.isFinite(pontos)) {
      await db.insert(leadScoreRules).values({
        eventType: "lead_qualified",
        condition: { qualificacao: slug },
        points: Math.round(pontos),
        description: `Qualificado como ${label}`,
      });
      // Sem recálculo: qualificação recém-criada não tem evento no histórico.
    }

    return NextResponse.json({ qualificacao: criada });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json(
        { error: "Qualificação não informada." },
        { status: 400 }
      );
    }

    const [atual] = await db
      .select()
      .from(leadQualifications)
      .where(eq(leadQualifications.id, id));
    if (!atual) {
      return NextResponse.json(
        { error: "Qualificação não encontrada." },
        { status: 404 }
      );
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.label === "string" && body.label.trim()) {
      patch.label = body.label.trim();
    }
    if (Number.isFinite(Number(body.position))) {
      patch.position = Math.round(Number(body.position));
    }
    if (typeof body.active === "boolean") patch.active = body.active;
    if (
      typeof body.variant === "string" &&
      VARIANTES_DE_QUALIFICACAO.some((v) => v.valor === body.variant)
    ) {
      patch.variant = body.variant;
    }
    // Textos do playbook: string vazia LIMPA o campo (vira null) — sem isso,
    // apagar um texto errado seria impossível pela tela.
    for (const campo of ["potential", "quemSao", "perfil", "motivacoes", "dores"]) {
      if (typeof body[campo] === "string") {
        patch[campo] = body[campo].trim() || null;
      }
    }

    // O slug NÃO se edita, pela mesma razão das etapas: é o que o webhook do
    // agente resolve e o que `contacts.qualification` guarda. Trocá-lo faria
    // as entregas seguintes caírem na recusa e órfãos na base.
    await db
      .update(leadQualifications)
      .set(patch)
      .where(eq(leadQualifications.id, id));

    // Pontos: edita (ou cria) a regra de pontuação desta qualificação. O
    // recálculo imediato é a mesma decisão de /api/leads/pontuacao — a
    // pontuação é derivada, então o peso novo vale para o histórico inteiro,
    // e sem recalcular a tela mostraria a regra nova com números velhos.
    let recalculados: number | undefined;
    const pontos = Number(body.pontos);
    if (body.pontos !== undefined && body.pontos !== "" && Number.isFinite(pontos)) {
      const arredondado = Math.round(pontos);
      const regras = await db
        .select()
        .from(leadScoreRules)
        .where(eq(leadScoreRules.eventType, "lead_qualified"));
      const daQualificacao = regraDaQualificacao(regras, atual.slug);

      if (daQualificacao && daQualificacao.points !== arredondado) {
        await db
          .update(leadScoreRules)
          .set({ points: arredondado, updatedAt: new Date() })
          .where(eq(leadScoreRules.id, daQualificacao.id));
        recalculados = await recalcularTodos();
      } else if (!daQualificacao) {
        await db.insert(leadScoreRules).values({
          eventType: "lead_qualified",
          condition: { qualificacao: atual.slug },
          points: arredondado,
          description: `Qualificado como ${(patch.label as string) ?? atual.label}`,
        });
        recalculados = await recalcularTodos();
      }
    }

    return NextResponse.json({ ok: true, ...(recalculados !== undefined ? { recalculados } : {}) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!id) {
      return NextResponse.json(
        { error: "Qualificação não informada." },
        { status: 400 }
      );
    }

    const [qualificacao] = await db
      .select()
      .from(leadQualifications)
      .where(eq(leadQualifications.id, id));
    if (!qualificacao) {
      return NextResponse.json({ ok: true, jaNaoExistia: true });
    }

    // Apagar uma qualificação com leads dentro deixaria contatos apontando
    // para um slug que não existe: eles virariam "sem qualificação" em toda
    // contagem, sem erro nenhum. Desativar mantém o histórico legível.
    const [{ total }] = await db
      .select({ total: count() })
      .from(contacts)
      .where(eq(contacts.qualification, qualificacao.slug));

    if (total > 0) {
      await db
        .update(leadQualifications)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(leadQualifications.id, id));
      return NextResponse.json({ ok: true, desativada: true, leads: total });
    }

    await db.delete(leadQualifications).where(eq(leadQualifications.id, id));

    // A regra de pontuação vai junto: sem a qualificação, ela viraria uma
    // linha órfã na tela de pontuação, descrevendo algo que não existe. O
    // recálculo cobre o caso raro de eventos antigos que ainda pontuavam.
    const regras = await db
      .select()
      .from(leadScoreRules)
      .where(eq(leadScoreRules.eventType, "lead_qualified"));
    const regra = regraDaQualificacao(regras, qualificacao.slug);
    if (regra) {
      await db.delete(leadScoreRules).where(eq(leadScoreRules.id, regra.id));
      await recalcularTodos();
    }

    return NextResponse.json({ ok: true, apagada: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
