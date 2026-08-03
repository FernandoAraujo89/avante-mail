import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import {
  AUTOMATION_STEP_TYPES,
  AUTOMATION_TRIGGER_TYPES,
  automations,
  automationSteps,
  automationTriggers,
  automationVersions,
  getDb,
  type AutomationStepType,
  type AutomationTriggerType,
} from "@/lib/db";
import { validarFluxo } from "@/lib/automations/validacao";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface PassoRecebido {
  id: string;
  parentId: string | null;
  branch: string;
  position: number;
  type: AutomationStepType;
  config: Record<string, unknown> | null;
}

/**
 * Salva o fluxo (gatilhos + passos).
 *
 * Automação em uso ganha uma VERSÃO NOVA em vez de ter a atual reescrita:
 * quem já está no meio do caminho termina pela versão em que entrou. Sem isso,
 * mexer no fluxo enquanto centenas de pessoas o percorrem entrega o passo 5 de
 * um fluxo que não existe mais. Rascunho é reescrito no lugar — ninguém dentro.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
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

    // ─── Payload ────────────────────────────────────────────────
    const gatilhos = (Array.isArray(body.triggers) ? body.triggers : []).map(
      (t: Record<string, unknown>) => ({
        type: String(t?.type) as AutomationTriggerType,
        config: (t?.config ?? null) as Record<string, unknown> | null,
      })
    );
    for (const g of gatilhos) {
      if (!AUTOMATION_TRIGGER_TYPES.includes(g.type)) {
        return NextResponse.json(
          { error: `Gatilho desconhecido: ${g.type}.` },
          { status: 400 }
        );
      }
    }

    const passos: PassoRecebido[] = (
      Array.isArray(body.steps) ? body.steps : []
    ).map((p: Record<string, unknown>) => ({
      id: String(p?.id ?? ""),
      parentId: p?.parentId ? String(p.parentId) : null,
      branch: String(p?.branch ?? "main"),
      position: Number(p?.position ?? 0),
      type: String(p?.type) as AutomationStepType,
      config: (p?.config ?? null) as Record<string, unknown> | null,
    }));

    const idsRecebidos = new Set(passos.map((p) => p.id));
    for (const p of passos) {
      if (!p.id) {
        return NextResponse.json(
          { error: "Passo sem identificador no envio." },
          { status: 400 }
        );
      }
      if (!AUTOMATION_STEP_TYPES.includes(p.type)) {
        return NextResponse.json(
          { error: `Tipo de passo desconhecido: ${p.type}.` },
          { status: 400 }
        );
      }
      if (!["main", "yes", "no"].includes(p.branch)) {
        return NextResponse.json(
          { error: `Ramo desconhecido: ${p.branch}.` },
          { status: 400 }
        );
      }
      if (p.parentId && !idsRecebidos.has(p.parentId)) {
        return NextResponse.json(
          { error: "Há um passo apontando para outro que não foi enviado." },
          { status: 400 }
        );
      }
    }

    // ─── Versão de destino ──────────────────────────────────────
    let versionId = automacao.currentVersionId;
    const emUso = automacao.status !== "draft";

    if (emUso || !versionId) {
      const [ultima] = await db
        .select({ version: automationVersions.version })
        .from(automationVersions)
        .where(eq(automationVersions.automationId, id))
        .orderBy(desc(automationVersions.version))
        .limit(1);

      const [nova] = await db
        .insert(automationVersions)
        .values({ automationId: id, version: (ultima?.version ?? 0) + 1 })
        .returning({ id: automationVersions.id });
      versionId = nova.id;
    } else {
      // Rascunho: reescreve no lugar. Os logs de percurso guardam o step_id
      // sem chave estrangeira justamente para sobreviver a isto.
      await db
        .delete(automationTriggers)
        .where(eq(automationTriggers.versionId, versionId));
      await db
        .delete(automationSteps)
        .where(eq(automationSteps.versionId, versionId));
    }

    // ─── Grava ──────────────────────────────────────────────────
    if (gatilhos.length > 0) {
      await db.insert(automationTriggers).values(
        gatilhos.map((g: { type: AutomationTriggerType; config: Record<string, unknown> | null }) => ({
          versionId: versionId as string,
          type: g.type,
          config: g.config,
        }))
      );
    }

    // O id do cliente é temporário; o banco gera o definitivo e o parentId é
    // reescrito pelo mapa — assim a árvore chega inteira do outro lado.
    const mapa = new Map(passos.map((p) => [p.id, crypto.randomUUID()]));

    // Posição normalizada por grupo (pai + ramo): a tela manda a ordem, o
    // banco guarda 0..n sem buracos.
    const ordenados = [...passos].sort((a, b) => a.position - b.position);
    const contadores = new Map<string, number>();

    const paraGravar = ordenados.map((p) => {
      const grupo = `${p.parentId ?? "raiz"}/${p.branch}`;
      const position = contadores.get(grupo) ?? 0;
      contadores.set(grupo, position + 1);
      return {
        id: mapa.get(p.id) as string,
        versionId: versionId as string,
        parentId: p.parentId ? (mapa.get(p.parentId) as string) : null,
        branch: p.branch,
        position,
        type: p.type,
        config: p.config,
      };
    });

    if (paraGravar.length > 0) {
      await db.insert(automationSteps).values(paraGravar);
    }

    const updates: Partial<typeof automations.$inferInsert> = {
      currentVersionId: versionId,
      updatedAt: new Date(),
    };
    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (typeof body.description === "string") {
      updates.description = body.description.trim() || null;
    }
    await db.update(automations).set(updates).where(eq(automations.id, id));

    const salvos = paraGravar.map((p) => ({
      id: p.id,
      parentId: p.parentId,
      branch: p.branch,
      position: p.position,
      type: p.type,
      config: p.config,
    }));

    return NextResponse.json({
      versionId,
      versionCreated: emUso,
      triggers: gatilhos,
      steps: salvos,
      problems: validarFluxo(gatilhos, salvos),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
