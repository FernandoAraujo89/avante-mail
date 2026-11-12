import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { contacts, getDb } from "@/lib/db";
import { ehLead } from "@/lib/leads";
import { ETAPA_DE_PERDA } from "@/lib/leads/etapas";
import { PREFIXO_DA_TAG_DE_PERDA, tagDoMotivo } from "@/lib/leads/tags-de-perda";
import {
  aplicarTagsDePerda,
  desligarTagsDePerda,
  ligarTagsDePerda,
  tagsDePerdaLigadasEm,
} from "@/lib/leads/tags-de-perda-aplicar";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Motivos de perda dos leads e as tags de remarketing
 * (lib/leads/tags-de-perda-aplicar.ts explica o interruptor).
 */
export async function GET() {
  try {
    return NextResponse.json(await resumo());
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

async function resumo() {
  const db = getDb();
  const [porMotivo, [semMotivo], [comTag], ligadoEm] = await Promise.all([
    db
      .select({ motivo: contacts.crmMotivoPerda, total: count() })
      .from(contacts)
      .where(and(ehLead(), isNotNull(contacts.crmMotivoPerda)))
      .groupBy(contacts.crmMotivoPerda)
      .orderBy(desc(count())),
    db
      .select({ total: count() })
      .from(contacts)
      .where(and(ehLead(), eq(contacts.stage, ETAPA_DE_PERDA), isNull(contacts.crmMotivoPerda))),
    db
      .select({ total: count() })
      .from(contacts)
      .where(
        and(
          ehLead(),
          sql`exists (select 1 from unnest(${contacts.tags}) as t where t like ${PREFIXO_DA_TAG_DE_PERDA + "%"})`
        )
      ),
    tagsDePerdaLigadasEm(),
  ]);

  // Dois motivos que só diferem por ponto final ou vírgula dão a MESMA tag:
  // a tela mostra a tag uma vez, com os motivos e a soma dos leads.
  const porTag = new Map<string, { tag: string; motivos: string[]; total: number }>();
  for (const r of porMotivo) {
    const tag = tagDoMotivo(r.motivo);
    if (!tag) continue;
    const item = porTag.get(tag) ?? { tag, motivos: [], total: 0 };
    item.motivos.push(r.motivo as string);
    item.total += r.total;
    porTag.set(tag, item);
  }

  return {
    ligadoEm,
    tags: [...porTag.values()].sort((a, b) => b.total - a.total),
    leadsComMotivo: porMotivo.reduce((soma, r) => soma + r.total, 0),
    perdidosSemMotivo: semMotivo?.total ?? 0,
    leadsComTag: comTag?.total ?? 0,
  };
}

/**
 * Liga ou desliga. Ligar marca na hora TODOS os leads perdidos com motivo —
 * é o que faz as automações já ativas receberem quem foi perdido antes.
 * Desligar só para de manter: as tags aplicadas ficam.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.ligado !== "boolean") {
      return NextResponse.json({ error: "Diga se é para ligar ou desligar." }, { status: 400 });
    }

    let alterados = 0;
    if (body.ligado) {
      // Liga ANTES de marcar: quem for perdido enquanto a marcação roda já
      // recebe a tag pela sincronização. Ligar de novo só repete a marcação
      // (grava quem estiver diferente) — serve para completar uma que falhou.
      await ligarTagsDePerda();
      ({ alterados } = await aplicarTagsDePerda());
    } else {
      await desligarTagsDePerda();
    }

    return NextResponse.json({ ...(await resumo()), alterados });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
