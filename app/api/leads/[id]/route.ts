import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { contacts, getDb } from "@/lib/db";
import { converterLeadEmParceiro } from "@/lib/leads/mudanca";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A ação da ficha do lead: converter em parceiro.
 *
 * A ETAPA do funil NÃO se muda aqui de propósito. Ela espelha o Pipedrive e
 * chega pelo webhook do agente; um controle manual seria uma segunda fonte da
 * verdade sobre o mesmo fato, e as duas divergiriam no primeiro dia em que
 * alguém mexesse só de um lado. Etapa errada se corrige no Pipedrive, e o
 * agente reenvia.
 *
 * Converter mexe em `contacts.stage`, que é o que define quem é lead — e por
 * tabela quem entra ou não em campanha (a trava 2 da fase B). Por isso fica
 * nesta rota, e não solta no PATCH genérico de contato.
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
    // A mecânica (sair do funil, trocar de lista, eventos) vive em
    // lib/leads/mudanca.ts — a MESMA que a etapa com conversão automática usa.
    if (body.converter === true) {
      const destinoId =
        typeof body.listId === "string" && body.listId ? body.listId : null;
      if (!destinoId) {
        return NextResponse.json(
          { error: "Escolha a lista de destino da conversão." },
          { status: 400 }
        );
      }

      const conversao = await converterLeadEmParceiro(lead, destinoId, "ficha");
      if ("erro" in conversao) {
        return NextResponse.json({ error: conversao.erro }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        convertido: true,
        lista: conversao.listaNome,
        // O consentimento NÃO é concedido pela conversão: quem nunca aceitou
        // continua sem aceitar, e a tela precisa poder avisar isso.
        subscribed: lead.subscribed,
      });
    }

    return NextResponse.json(
      {
        error:
          "A etapa do funil vem do Pipedrive pela sincronização e não se altera por aqui.",
      },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * Excluir o lead — de vez, com a ficha e o histórico.
 *
 * A rota é de LEAD e recusa quem não é (`stage` nulo), como a PATCH acima. Um
 * id de parceiro que chegasse aqui apagaria da base de campanha um contato que
 * a área de Leads nem deveria enxergar; parceiro se exclui em /contacts, onde
 * quem clica está vendo o público das campanhas.
 *
 * A exclusão é REAL, não um arquivamento: o pedido de apagar dado pessoal é o
 * motivo mais provável de alguém usar isto, e um lead "excluído" que continua
 * na tabela não atende esse pedido. O banco leva junto (cascata) eventos,
 * listas, percursos de automação e envios; a entrega de webhook que o criou
 * sobrevive com `contact_id` nulo, para o log de recebimento não abrir buraco.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const [lead] = await db
      .select({ id: contacts.id, stage: contacts.stage })
      .from(contacts)
      .where(eq(contacts.id, id));

    if (!lead) {
      return NextResponse.json(
        { error: "Lead não encontrado." },
        { status: 404 }
      );
    }
    if (!lead.stage) {
      return NextResponse.json(
        {
          error:
            "Este contato não é um lead — exclua pela área de Contatos, onde dá para ver o que ele recebe de campanha.",
        },
        { status: 400 }
      );
    }

    await db.delete(contacts).where(eq(contacts.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
