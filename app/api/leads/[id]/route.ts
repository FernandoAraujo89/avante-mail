import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import {
  contactLists,
  contacts,
  getDb,
  LEAD_STAGES,
  lists,
  type LeadStage,
} from "@/lib/db";
import { emitContactEvent, emitListDiff } from "@/lib/events";
import { idsDasListasDeLeads } from "@/lib/leads";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Ações da ficha do lead: mudar de estágio e converter em parceiro.
 *
 * As duas mexem em `contacts.stage`, que é o que define quem é lead — e por
 * tabela quem entra ou não em campanha (a trava 2 da fase B). Por isso ficam
 * nesta rota, e não soltas no PATCH genérico de contato.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const body = await request.json().catch(() => ({}));

    const [lead] = await db.select().from(contacts).where(eq(contacts.id, id));
    if (!lead) {
      return NextResponse.json(
        { error: "Lead não encontrado." },
        { status: 404 }
      );
    }
    if (!lead.stage) {
      return NextResponse.json(
        { error: "Este contato não é um lead." },
        { status: 400 }
      );
    }

    // ── Converter em parceiro ────────────────────────────────────────────
    if (body.converter === true) {
      const destinoId =
        typeof body.listId === "string" && body.listId ? body.listId : null;
      if (!destinoId) {
        return NextResponse.json(
          { error: "Escolha a lista de destino da conversão." },
          { status: 400 }
        );
      }

      const [destino] = await db
        .select({ id: lists.id, kind: lists.kind, name: lists.name })
        .from(lists)
        .where(eq(lists.id, destinoId));

      if (!destino) {
        return NextResponse.json(
          { error: "Lista de destino não encontrada." },
          { status: 400 }
        );
      }
      // Converter para dentro da própria lista de leads não converteria nada —
      // o contato sairia do funil e continuaria no balcão de leads.
      if (destino.kind === "leads") {
        return NextResponse.json(
          {
            error:
              "Escolha uma lista de parceiros, clientes ou colaboradores — converter para a própria lista de leads não muda nada.",
          },
          { status: 400 }
        );
      }

      const idsDeLeads = await idsDasListasDeLeads();

      // Estágio nulo = deixou de ser lead. É esta linha que devolve o contato
      // ao público das campanhas, então ela vem junto com a troca de lista:
      // sair do funil sem entrar numa lista deixaria o contato no limbo.
      await db
        .update(contacts)
        .set({ stage: null })
        .where(eq(contacts.id, id));

      await db
        .insert(contactLists)
        .values({ contactId: id, listId: destino.id })
        .onConflictDoNothing();

      if (idsDeLeads.length > 0) {
        await db
          .delete(contactLists)
          .where(
            and(
              eq(contactLists.contactId, id),
              inArray(contactLists.listId, idsDeLeads)
            )
          );
      }

      await emitListDiff(id, idsDeLeads, [destino.id]);
      await emitContactEvent("lead_stage_changed", id, {
        de: lead.stage,
        para: null,
        acao: "convertido em parceiro",
        listId: destino.id,
      });

      return NextResponse.json({
        ok: true,
        convertido: true,
        lista: destino.name,
        // O consentimento NÃO é concedido pela conversão: quem nunca aceitou
        // continua sem aceitar, e a tela precisa poder avisar isso.
        subscribed: lead.subscribed,
      });
    }

    // ── Mudar de estágio ─────────────────────────────────────────────────
    const stage = typeof body.stage === "string" ? body.stage : "";
    if (!LEAD_STAGES.includes(stage as LeadStage)) {
      return NextResponse.json(
        { error: "Estágio inválido." },
        { status: 400 }
      );
    }
    if (stage === lead.stage) {
      return NextResponse.json({ ok: true, stage, semMudanca: true });
    }

    await db
      .update(contacts)
      .set({ stage: stage as LeadStage })
      .where(eq(contacts.id, id));

    await emitContactEvent("lead_stage_changed", id, {
      de: lead.stage,
      para: stage,
    });

    return NextResponse.json({ ok: true, stage });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
