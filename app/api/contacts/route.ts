import { NextRequest, NextResponse } from "next/server";
import {
  and,
  arrayContains,
  arrayOverlaps,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  type SQL,
} from "drizzle-orm";

import {
  contactLists,
  contacts,
  getDb,
  lists,
} from "@/lib/db";
import { emitContactEvent, emitListDiff, emitTagDiff } from "@/lib/events";
import { ehLead, naoEhLead } from "@/lib/leads";
import { normalizePhone } from "@/lib/phone";
import {
  EMAIL_REGEX,
  errorMessage,
  normalizeIds,
  normalizeTags,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const params = request.nextUrl.searchParams;

    const search = params.get("search")?.trim();
    const tag = params.get("tag")?.trim();
    const tags = params
      .get("tags")
      ?.split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const subscribed = params.get("subscribed");
    const countOnly = params.get("count") === "true";
    // Estágio do funil: um dos LEAD_STAGES, "lead" (qualquer estágio) ou
    // "contato" (sem estágio — parceiro/contato comum).
    const stage = params.get("stage")?.trim();
    // Recorte de lead para o SELETOR de destinatários (trava 2). O padrão
    // continua "todos" para não mudar o comportamento de quem já chama esta
    // rota — quem exclui é quem vai disparar.
    const leads = params.get("leads");

    // Filtro por lista: listId (uma) e/ou lists (várias, separadas por vírgula).
    const listFilterIds = [
      ...new Set([
        ...(params.get("listId") ? [params.get("listId") as string] : []),
        ...normalizeIds(params.get("lists")),
      ]),
    ];

    const conditions: SQL[] = [];

    if (search) {
      const term = `%${search}%`;
      const searchCondition = or(
        ilike(contacts.name, term),
        ilike(contacts.email, term),
        ilike(contacts.company, term)
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    if (tag) {
      conditions.push(arrayContains(contacts.tags, [tag]));
    }
    if (tags && tags.length > 0) {
      conditions.push(arrayOverlaps(contacts.tags, tags));
    }
    if (subscribed === "true") conditions.push(eq(contacts.subscribed, true));
    if (subscribed === "false") conditions.push(eq(contacts.subscribed, false));
    // Elegível para WhatsApp: telefone cadastrado + consentimento do canal.
    if (params.get("whatsappEligible") === "true") {
      conditions.push(
        eq(contacts.whatsappSubscribed, true),
        isNotNull(contacts.phone)
      );
    }
    if (stage === "lead") conditions.push(ehLead());
    else if (stage === "contato") conditions.push(naoEhLead());
    else if (stage) {
      // Sem lista fechada para validar: as etapas vêm da tabela e mudam com o
      // funil do comercial. Uma etapa que não existe simplesmente não casa com
      // ninguém — que é a resposta certa para um filtro obsoleto.
      conditions.push(eq(contacts.stage, stage));
    }
    if (listFilterIds.length > 0) {
      conditions.push(
        inArray(
          contacts.id,
          db
            .select({ id: contactLists.contactId })
            .from(contactLists)
            .where(inArray(contactLists.listId, listFilterIds))
        )
      );
    }

    // `leads=exclude` vem do seletor de destinatários: é a MESMA conta que o
    // envio faz, para a contagem da tela não prometer um público diferente do
    // que sai.
    if (leads === "exclude") conditions.push(naoEhLead());

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    if (countOnly) {
      const [row] = await db
        .select({ count: count() })
        .from(contacts)
        .where(where);
      return NextResponse.json({ count: row.count });
    }

    const data = await db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(desc(contacts.createdAt));

    // Anexa as listas de cada contato (para exibir como badges).
    const ids = data.map((c) => c.id);
    const byContact = new Map<string, { id: string; name: string }[]>();
    if (ids.length > 0) {
      const membership = await db
        .select({
          contactId: contactLists.contactId,
          listId: lists.id,
          listName: lists.name,
        })
        .from(contactLists)
        .innerJoin(lists, eq(lists.id, contactLists.listId))
        .where(inArray(contactLists.contactId, ids));
      for (const m of membership) {
        const arr = byContact.get(m.contactId) ?? [];
        arr.push({ id: m.listId, name: m.listName });
        byContact.set(m.contactId, arr);
      }
    }

    return NextResponse.json(
      data.map((c) => ({ ...c, lists: byContact.get(c.id) ?? [] }))
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json().catch(() => ({}));
    const ids = normalizeIds(body.ids);

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Nenhum contato selecionado." },
        { status: 400 }
      );
    }

    const deleted = await db
      .delete(contacts)
      .where(inArray(contacts.id, ids))
      .returning({ id: contacts.id });

    return NextResponse.json({ deleted: deleted.length });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const company =
      typeof body.company === "string" && body.company.trim()
        ? body.company.trim()
        : null;
    const tags = normalizeTags(body.tags);
    const listIds = normalizeIds(body.listIds);

    if (!name) {
      return NextResponse.json(
        { error: "O nome é obrigatório." },
        { status: 400 }
      );
    }
    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { error: "Informe um e-mail válido." },
        { status: 400 }
      );
    }

    // Telefone é opcional; quando informado, é validado e guardado em E.164.
    const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : "";
    let phone: string | null = null;
    if (phoneRaw) {
      phone = normalizePhone(phoneRaw);
      if (!phone) {
        return NextResponse.json(
          { error: "Informe um telefone válido com DDD (ex.: 48 99999-9999)." },
          { status: 400 }
        );
      }
    }

    const existing = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, email));

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Já existe um contato com este e-mail." },
        { status: 409 }
      );
    }

    if (phone) {
      const samePhone = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.phone, phone));
      if (samePhone.length > 0) {
        return NextResponse.json(
          { error: "Já existe um contato com este telefone." },
          { status: 409 }
        );
      }
    }

    // Opt-in de WhatsApp só com telefone; registra a data (prova LGPD).
    // O padrão é "sim": só um `false` explícito (a pessoa desmarcou a opção)
    // tira o consentimento.
    const whatsappSubscribed =
      body.whatsappSubscribed !== false && phone !== null;

    const [created] = await db
      .insert(contacts)
      .values({
        name,
        email,
        phone,
        company,
        tags,
        subscribed: body.subscribed !== false,
        whatsappSubscribed,
        whatsappOptInAt: whatsappSubscribed ? new Date() : null,
      })
      .returning();

    if (listIds.length > 0) {
      await db
        .insert(contactLists)
        .values(listIds.map((listId) => ({ contactId: created.id, listId })))
        .onConflictDoNothing();
    }

    // Contato novo já nasce com tags e listas: tudo isso é entrada válida
    // para uma automação.
    await emitContactEvent("contact_created", created.id);
    await emitTagDiff(created.id, [], tags);
    await emitListDiff(created.id, [], listIds);

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
