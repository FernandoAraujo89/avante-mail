import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { contacts, getDb } from "@/lib/db";
import { calcularConta, lerConfiguracao, lerRegras } from "@/lib/leads/score";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A conta ABERTA: por que este lead tem os pontos que tem.
 *
 * Um número sem explicação não muda comportamento de vendedor nenhum — ou ele
 * confia cegamente, ou ignora. Mostrar de onde vem cada ponto, e quanto o tempo
 * já corroeu, é o que faz o modelo ser discutido em vez de aceito.
 */
export async function GET(request: NextRequest, context: RouteContext) {
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

    const [regras, config] = await Promise.all([
      lerRegras(),
      lerConfiguracao(),
    ]);
    const conta = await calcularConta(id, regras, config, new Date());

    return NextResponse.json({ ...conta, config });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
