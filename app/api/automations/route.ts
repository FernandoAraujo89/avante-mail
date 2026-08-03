import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray, sql } from "drizzle-orm";

import {
  automationRuns,
  automations,
  automationSteps,
  automationTriggers,
  automationVersions,
  getDb,
} from "@/lib/db";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Lista as automações com o resumo que a tela mostra. */
export async function GET() {
  try {
    const db = getDb();

    const rows = await db
      .select({
        id: automations.id,
        name: automations.name,
        description: automations.description,
        status: automations.status,
        currentVersionId: automations.currentVersionId,
        createdAt: automations.createdAt,
        updatedAt: automations.updatedAt,
      })
      .from(automations)
      .orderBy(desc(automations.updatedAt));

    if (rows.length === 0) return NextResponse.json([]);

    const versoes = rows.map((r) => r.currentVersionId).filter(Boolean) as string[];

    const gatilhos = versoes.length
      ? await db
          .select({
            versionId: automationTriggers.versionId,
            type: automationTriggers.type,
            config: automationTriggers.config,
          })
          .from(automationTriggers)
          .where(inArray(automationTriggers.versionId, versoes))
      : [];

    const passos = versoes.length
      ? await db
          .select({
            versionId: automationSteps.versionId,
            total: sql<number>`count(*)`.mapWith(Number),
          })
          .from(automationSteps)
          .where(inArray(automationSteps.versionId, versoes))
          .groupBy(automationSteps.versionId)
      : [];

    // Contatos no fluxo: total já percorrido e quantos estão dentro agora.
    const percursos = await db
      .select({
        automationId: automationRuns.automationId,
        total: sql<number>`count(*)`.mapWith(Number),
        ativos: sql<number>`count(*) filter (where ${automationRuns.status} in ('running','waiting'))`.mapWith(
          Number
        ),
      })
      .from(automationRuns)
      .groupBy(automationRuns.automationId);

    const porVersao = new Map(passos.map((p) => [p.versionId, p.total]));
    const porAutomacao = new Map(percursos.map((p) => [p.automationId, p]));

    return NextResponse.json(
      rows.map((r) => ({
        ...r,
        triggers: gatilhos
          .filter((g) => g.versionId === r.currentVersionId)
          .map(({ type, config }) => ({ type, config })),
        stepCount: r.currentVersionId
          ? (porVersao.get(r.currentVersionId) ?? 0)
          : 0,
        runCount: porAutomacao.get(r.id)?.total ?? 0,
        activeRunCount: porAutomacao.get(r.id)?.ativos ?? 0,
      }))
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** Cria a automação já com a versão 1 — sem versão não há onde pendurar passos. */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const autor = await sessionUserFromRequest(request);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "O nome da automação é obrigatório." },
        { status: 400 }
      );
    }

    const [criada] = await db
      .insert(automations)
      .values({
        name,
        description:
          typeof body.description === "string" && body.description.trim()
            ? body.description.trim()
            : null,
        status: "draft",
        createdByUserId: autor?.id ?? null,
      })
      .returning();

    const [versao] = await db
      .insert(automationVersions)
      .values({ automationId: criada.id, version: 1 })
      .returning({ id: automationVersions.id });

    await db
      .update(automations)
      .set({ currentVersionId: versao.id })
      .where(eq(automations.id, criada.id));

    return NextResponse.json(
      { ...criada, currentVersionId: versao.id },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
