import { NextRequest, NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";

import {
  AUTOMATION_STATUSES,
  automationRuns,
  automations,
  automationSteps,
  automationTriggers,
  automationVersions,
  getDb,
  type AutomationStatus,
} from "@/lib/db";
import { contarAutomacoesAtivas } from "@/lib/automations/engine";
import { tetoDeAtivas, validarFluxo } from "@/lib/automations/validacao";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** A automação com a versão corrente inteira — é o que a tela edita. */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [automacao] = await db
      .select()
      .from(automations)
      .where(eq(automations.id, id));

    if (!automacao) {
      return NextResponse.json(
        { error: "Automação não encontrada." },
        { status: 404 }
      );
    }

    const versionId = automacao.currentVersionId;

    const [versao] = versionId
      ? await db
          .select()
          .from(automationVersions)
          .where(eq(automationVersions.id, versionId))
      : [];

    const triggers = versionId
      ? await db
          .select({
            id: automationTriggers.id,
            type: automationTriggers.type,
            config: automationTriggers.config,
          })
          .from(automationTriggers)
          .where(eq(automationTriggers.versionId, versionId))
      : [];

    const steps = versionId
      ? await db
          .select({
            id: automationSteps.id,
            parentId: automationSteps.parentId,
            branch: automationSteps.branch,
            position: automationSteps.position,
            type: automationSteps.type,
            config: automationSteps.config,
          })
          .from(automationSteps)
          .where(eq(automationSteps.versionId, versionId))
          .orderBy(asc(automationSteps.position))
      : [];

    const [percursos] = await db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        ativos: sql<number>`count(*) filter (where ${automationRuns.status} in ('running','waiting'))`.mapWith(
          Number
        ),
      })
      .from(automationRuns)
      .where(eq(automationRuns.automationId, id));

    return NextResponse.json({
      ...automacao,
      version: versao?.version ?? 1,
      triggers,
      steps,
      problems: validarFluxo(triggers, steps),
      runCount: percursos?.total ?? 0,
      activeRunCount: percursos?.ativos ?? 0,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** Nome, descrição e status. Ativar é o que tem regra. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const body = await request.json();

    const [automacao] = await db
      .select()
      .from(automations)
      .where(eq(automations.id, id));
    if (!automacao) {
      return NextResponse.json(
        { error: "Automação não encontrada." },
        { status: 404 }
      );
    }

    const updates: Partial<typeof automations.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json(
          { error: "O nome da automação é obrigatório." },
          { status: 400 }
        );
      }
      updates.name = name;
    }
    if (typeof body.description === "string") {
      updates.description = body.description.trim() || null;
    }

    if (typeof body.status === "string") {
      const status = body.status as AutomationStatus;
      if (!AUTOMATION_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: `Status inválido: ${body.status}.` },
          { status: 400 }
        );
      }

      if (status === "active" && automacao.status !== "active") {
        const versionId = automacao.currentVersionId;
        const triggers = versionId
          ? await db
              .select({
                type: automationTriggers.type,
                config: automationTriggers.config,
              })
              .from(automationTriggers)
              .where(eq(automationTriggers.versionId, versionId))
          : [];
        const steps = versionId
          ? await db
              .select({
                id: automationSteps.id,
                parentId: automationSteps.parentId,
                branch: automationSteps.branch,
                position: automationSteps.position,
                type: automationSteps.type,
                config: automationSteps.config,
              })
              .from(automationSteps)
              .where(eq(automationSteps.versionId, versionId))
          : [];

        // Rascunho com problema pode ser SALVO, mas não ligado: automação erra
        // em silêncio e em escala, então a hora de barrar é a de ativar.
        const problemas = validarFluxo(triggers, steps);
        if (problemas.length > 0) {
          return NextResponse.json(
            {
              error:
                "Resolva os problemas do fluxo antes de ativar: " +
                problemas.map((p) => p.mensagem).join(" "),
              problems: problemas,
            },
            { status: 400 }
          );
        }

        const teto = await tetoDeAtivas();
        const ativas = await contarAutomacoesAtivas();
        if (ativas >= teto) {
          return NextResponse.json(
            {
              error: `Já há ${ativas} automações ativas (teto: ${teto}). Pause uma antes de ativar esta.`,
            },
            { status: 409 }
          );
        }
      }

      updates.status = status;
    }

    const [atualizada] = await db
      .update(automations)
      .set(updates)
      .where(eq(automations.id, id))
      .returning();

    return NextResponse.json(atualizada);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [removida] = await db
      .delete(automations)
      .where(eq(automations.id, id))
      .returning({ id: automations.id });

    if (!removida) {
      return NextResponse.json(
        { error: "Automação não encontrada." },
        { status: 404 }
      );
    }
    // Os percursos vão junto (cascade); os ENVIOS ficam, com
    // automation_run_id nulo — histórico de custo não se apaga.
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
