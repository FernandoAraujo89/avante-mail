import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";

import { contacts, getDb, leadStages } from "@/lib/db";
import { listarEtapas, slugDaEtapa } from "@/lib/leads/etapas";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * As etapas do funil do Pipedrive, espelhadas aqui.
 *
 * Cadastro pela tela porque o funil é do comercial: cada etapa nova lá viraria
 * um deploy nosso se a lista morasse no código, e até o deploy sair o webhook
 * do agente chegaria com uma etapa que o sistema recusa.
 */
export async function GET() {
  try {
    const etapas = await listarEtapas(true);

    // Quantos leads em cada etapa — é o que impede apagar uma etapa cheia sem
    // perceber, e o que mostra se o agente está mesmo mandando as mudanças.
    const db = getDb();
    const porEtapa = await db
      .select({ stage: contacts.stage, total: count() })
      .from(contacts)
      .groupBy(contacts.stage);

    return NextResponse.json({
      etapas,
      uso: Object.fromEntries(
        porEtapa.filter((r) => r.stage).map((r) => [r.stage as string, r.total])
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
        { error: "Dê um nome à etapa — o mesmo que ela tem no Pipedrive." },
        { status: 400 }
      );
    }

    // O slug sai do rótulo, e não de um campo separado: é ele que o webhook
    // manda, e pedir os dois seria pedir para o operador manter duas coisas em
    // sincronia. `resolverEtapa` casa pelas duas formas de qualquer jeito.
    const slug =
      typeof body.slug === "string" && body.slug.trim()
        ? slugDaEtapa(body.slug)
        : slugDaEtapa(label);
    if (!slug) {
      return NextResponse.json(
        { error: "O nome precisa ter ao menos uma letra ou número." },
        { status: 400 }
      );
    }

    const [existente] = await db
      .select({ id: leadStages.id })
      .from(leadStages)
      .where(eq(leadStages.slug, slug));
    if (existente) {
      return NextResponse.json(
        { error: `Já existe uma etapa com o identificador "${slug}".` },
        { status: 409 }
      );
    }

    const [criada] = await db
      .insert(leadStages)
      .values({
        slug,
        label,
        position: Number.isFinite(Number(body.position))
          ? Math.round(Number(body.position))
          : 0,
        stopsNurturing: body.stopsNurturing === true,
      })
      .returning();

    return NextResponse.json({ etapa: criada });
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
      return NextResponse.json({ error: "Etapa não informada." }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.label === "string" && body.label.trim()) {
      patch.label = body.label.trim();
    }
    if (Number.isFinite(Number(body.position))) {
      patch.position = Math.round(Number(body.position));
    }
    if (typeof body.stopsNurturing === "boolean") {
      patch.stopsNurturing = body.stopsNurturing;
    }
    if (typeof body.active === "boolean") patch.active = body.active;

    // O slug NÃO se edita: é o que o webhook do agente manda. Trocá-lo faria
    // toda entrega seguinte cair na recusa, e o sintoma ("o lead parou de
    // andar") não apontaria para cá.
    await db.update(leadStages).set(patch).where(eq(leadStages.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!id) {
      return NextResponse.json({ error: "Etapa não informada." }, { status: 400 });
    }

    const [etapa] = await db
      .select()
      .from(leadStages)
      .where(eq(leadStages.id, id));
    if (!etapa) {
      return NextResponse.json({ ok: true, jaNaoExistia: true });
    }

    // Apagar uma etapa com leads dentro deixaria contatos apontando para um
    // slug que não existe: eles sumiriam de toda contagem do funil sem erro
    // nenhum. Desativar mantém o histórico legível e tira das escolhas.
    const [{ total }] = await db
      .select({ total: count() })
      .from(contacts)
      .where(eq(contacts.stage, etapa.slug));

    if (total > 0) {
      await db
        .update(leadStages)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(leadStages.id, id));
      return NextResponse.json({ ok: true, desativada: true, leads: total });
    }

    await db.delete(leadStages).where(eq(leadStages.id, id));
    return NextResponse.json({ ok: true, apagada: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
