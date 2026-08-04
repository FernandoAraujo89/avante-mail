import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { contacts, getDb, webhookDeliveries } from "@/lib/db";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * O que chegou nesta origem, cru. É o que responde "esse lead entrou?" sem
 * depender do histórico do Make — e o que mostra POR QUE um payload foi
 * rejeitado, que é a pergunta de quem está configurando o mapeamento.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();

    const entregas = await db
      .select({
        id: webhookDeliveries.id,
        status: webhookDeliveries.status,
        payload: webhookDeliveries.payload,
        resultado: webhookDeliveries.resultado,
        erro: webhookDeliveries.erro,
        createdAt: webhookDeliveries.createdAt,
        contactId: webhookDeliveries.contactId,
        contactName: contacts.name,
      })
      .from(webhookDeliveries)
      .leftJoin(contacts, eq(contacts.id, webhookDeliveries.contactId))
      .where(eq(webhookDeliveries.sourceId, id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);

    return NextResponse.json({ entregas });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
