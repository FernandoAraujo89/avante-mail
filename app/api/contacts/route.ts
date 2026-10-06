import { NextRequest, NextResponse } from "next/server";
import {
  and,
  arrayContains,
  arrayOverlaps,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
} from "drizzle-orm";

import { EnderecoInvalido, lerEnderecosDoCorpo } from "@/lib/contatos/corpo";
import {
  contatosPorEnderecos,
  definirEnderecos,
  listarEnderecos,
  listarEnderecosDeVarios,
} from "@/lib/contatos/enderecos";
import {
  contactEmails,
  contactLists,
  contactPhones,
  contacts,
  getDb,
  lists,
} from "@/lib/db";
import { listasRestritas, veSoParceiros } from "@/lib/escopo-parceiros";
import { emitContactEvent, emitListDiff, emitTagDiff } from "@/lib/events";
import { ehLead, naoEhLead } from "@/lib/leads";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage, normalizeIds, normalizeTags } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const params = request.nextUrl.searchParams;
    const soParceiros = veSoParceiros(await sessionUserFromRequest(request));

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
      // Também pelos e-mails e telefones secundários: quem procura um número
      // precisa achar o contato, não importa qual dos números seja.
      const digitos = search.replace(/\D/g, "");
      const searchCondition = or(
        ilike(contacts.name, term),
        ilike(contacts.email, term),
        ilike(contacts.company, term),
        exists(
          db
            .select({ um: contactEmails.id })
            .from(contactEmails)
            .where(
              and(
                eq(contactEmails.contactId, contacts.id),
                ilike(contactEmails.email, term)
              )
            )
        ),
        ...(digitos.length >= 4
          ? [
              exists(
                db
                  .select({ um: contactPhones.id })
                  .from(contactPhones)
                  .where(
                    and(
                      eq(contactPhones.contactId, contacts.id),
                      ilike(contactPhones.phone, `%${digitos}%`)
                    )
                  )
              ),
            ]
          : [])
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
    // Elegível para SMS: mesma conta do disparo (consentimento próprio do canal
    // + telefone), para a contagem da tela não prometer um público maior do que
    // o que sai. Consentimento separado do de WhatsApp: sair de um canal não
    // tira a pessoa do outro.
    if (params.get("smsEligible") === "true") {
      conditions.push(
        eq(contacts.smsSubscribed, true),
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
    // Sucesso do cliente: lead não existe para ele, qualquer que seja o filtro.
    if (soParceiros) conditions.push(naoEhLead());

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
        .where(
          soParceiros
            ? and(inArray(contactLists.contactId, ids), isNull(lists.kind))
            : inArray(contactLists.contactId, ids)
        );
      for (const m of membership) {
        const arr = byContact.get(m.contactId) ?? [];
        arr.push({ id: m.listId, name: m.listName });
        byContact.set(m.contactId, arr);
      }
    }

    // Todos os endereços, não só o principal: a lista mostra "+2" e o
    // seletor de destinatários conta por endereço.
    const enderecos = await listarEnderecosDeVarios(db, ids);

    return NextResponse.json(
      data.map((c) => ({
        ...c,
        lists: byContact.get(c.id) ?? [],
        emails: (enderecos.get(c.id)?.emails ?? []).map((e) => e.email),
        phones: (enderecos.get(c.id)?.phones ?? []).map((p) => p.phone),
      }))
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

    const soParceiros = veSoParceiros(await sessionUserFromRequest(request));
    const deleted = await db
      .delete(contacts)
      .where(
        soParceiros
          ? and(inArray(contacts.id, ids), naoEhLead())
          : inArray(contacts.id, ids)
      )
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
    const company =
      typeof body.company === "string" && body.company.trim()
        ? body.company.trim()
        : null;
    const tags = normalizeTags(body.tags);
    const listIds = normalizeIds(body.listIds);

    // Vários e-mails e vários telefones; ou um de cada, no formato antigo.
    let enderecos;
    try {
      enderecos = lerEnderecosDoCorpo(body);
    } catch (error) {
      if (error instanceof EnderecoInvalido) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    const emails = enderecos.emails ?? [];
    // No formato antigo sem telefone sobra só a caixa de consentimento.
    const phones = (enderecos.phones ?? []).filter((p) => p.phone);

    if (
      veSoParceiros(await sessionUserFromRequest(request)) &&
      (await listasRestritas(db, listIds)).length > 0
    ) {
      return NextResponse.json(
        { error: "Essa lista não está disponível para o seu perfil." },
        { status: 403 }
      );
    }

    if (!name) {
      return NextResponse.json(
        { error: "O nome é obrigatório." },
        { status: 400 }
      );
    }
    // E-mail deixou de ser obrigatório: contato só com telefone existe. Mas
    // sem endereço nenhum não há para onde mandar nada.
    if (emails.length === 0 && phones.length === 0) {
      return NextResponse.json(
        { error: "Informe pelo menos um e-mail ou um telefone." },
        { status: 400 }
      );
    }

    const donos = await contatosPorEnderecos(db, {
      emails: emails.map((e) => e.email),
      phones: phones.map((p) => p.phone),
    });
    if (donos.porEmail.size > 0) {
      return NextResponse.json(
        { error: "Já existe um contato com este e-mail." },
        { status: 409 }
      );
    }
    if (donos.porTelefone.size > 0) {
      return NextResponse.json(
        { error: "Já existe um contato com este telefone." },
        { status: 409 }
      );
    }

    const [created] = await db
      .insert(contacts)
      .values({ name, company, tags })
      .returning({ id: contacts.id });

    // Os endereços (e o resumo deles no contato) são do módulo de endereços.
    await definirEnderecos(db, created.id, { emails, phones });

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

    const [contato] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, created.id));
    return NextResponse.json(
      { ...contato, ...(await listarEnderecos(db, created.id)) },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
