import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { EnderecoInvalido, lerEnderecosDoCorpo } from "@/lib/contatos/corpo";
import {
  definirEnderecos,
  EnderecoDeOutroContato,
  listarEnderecos,
  type EmailEntrada,
  type TelefoneEntrada,
} from "@/lib/contatos/enderecos";
import { contactLists, contacts, getDb } from "@/lib/db";
import {
  contatoEhLead,
  listasRestritas,
  veSoParceiros,
} from "@/lib/escopo-parceiros";
import { emitContactEvent, emitListDiff, emitTagDiff } from "@/lib/events";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage, normalizeIds, normalizeTags } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function naoEncontrado() {
  return NextResponse.json(
    { error: "Contato não encontrado." },
    { status: 404 }
  );
}

/** Lead fica invisível para quem vê só parceiros: responde como inexistente. */
async function foraDoAlcance(
  request: NextRequest,
  db: ReturnType<typeof getDb>,
  id: string
): Promise<boolean> {
  return (
    veSoParceiros(await sessionUserFromRequest(request)) &&
    (await contatoEhLead(db, id))
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    if (await foraDoAlcance(request, db, id)) return naoEncontrado();

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id));

    if (!contact) {
      return NextResponse.json(
        { error: "Contato não encontrado." },
        { status: 404 }
      );
    }

    const memberships = await db
      .select({ listId: contactLists.listId })
      .from(contactLists)
      .where(eq(contactLists.contactId, id));
    let listIds = memberships.map((m) => m.listId);
    if (veSoParceiros(await sessionUserFromRequest(request))) {
      const restritas = await listasRestritas(db, listIds);
      listIds = listIds.filter((l) => !restritas.includes(l));
    }

    return NextResponse.json({
      ...contact,
      listIds,
      ...(await listarEnderecos(db, id)),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const body = await request.json();
    if (await foraDoAlcance(request, db, id)) return naoEncontrado();
    const soParceiros = veSoParceiros(await sessionUserFromRequest(request));

    // O estado atual guia as transições de consentimento de WhatsApp e SMS.
    const [existing] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id));
    if (!existing) {
      return NextResponse.json(
        { error: "Contato não encontrado." },
        { status: 404 }
      );
    }

    // Vários e-mails e telefones (listas completas) ou, no formato antigo,
    // um de cada — que então troca só o principal e deixa os outros.
    let enderecos;
    try {
      enderecos = lerEnderecosDoCorpo(body);
    } catch (error) {
      if (error instanceof EnderecoInvalido) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    const mudaEnderecos =
      enderecos.emails !== undefined || enderecos.phones !== undefined;

    const updates: Partial<typeof contacts.$inferInsert> = {};

    if (typeof body.name === "string") {
      if (!body.name.trim()) {
        return NextResponse.json(
          { error: "O nome não pode ficar vazio." },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }
    if ("company" in body) {
      updates.company =
        typeof body.company === "string" && body.company.trim()
          ? body.company.trim()
          : null;
    }
    if ("tags" in body) {
      updates.tags = normalizeTags(body.tags);
    }

    const changesLists = "listIds" in body;

    // As listas atuais precisam ser lidas ANTES da troca — sem elas não dá
    // para saber em quais o contato entrou e de quais saiu.
    const listasAntes = changesLists
      ? (
          await db
            .select({ listId: contactLists.listId })
            .from(contactLists)
            .where(eq(contactLists.contactId, id))
        ).map((l) => l.listId)
      : [];

    if (Object.keys(updates).length === 0 && !changesLists && !mudaEnderecos) {
      return NextResponse.json(
        { error: "Nenhum campo para atualizar." },
        { status: 400 }
      );
    }

    if (Object.keys(updates).length > 0) {
      await db.update(contacts).set(updates).where(eq(contacts.id, id));
    }

    // Endereços e consentimento: pelo módulo, que mantém o resumo do contato.
    let canais: Awaited<ReturnType<typeof definirEnderecos>> | null = null;
    if (mudaEnderecos) {
      const desejado: { emails?: EmailEntrada[]; phones?: TelefoneEntrada[] } =
        {
          emails: enderecos.emails,
          phones: enderecos.phones,
        };
      if (enderecos.legado) {
        const atuais = await listarEnderecos(db, id);
        if (enderecos.emails) {
          const principal = enderecos.emails[0];
          desejado.emails = [
            ...enderecos.emails,
            ...atuais.emails
              .filter((e) => !e.principal && e.email !== principal?.email)
              .map((e) => ({ email: e.email })),
          ];
        }
        if (enderecos.phones) {
          const pedido = enderecos.phones[0];
          const atualPrincipal =
            atuais.phones.find((p) => p.principal) ?? atuais.phones[0] ?? null;
          // Sem telefone no pedido, as caixas de consentimento valem para o
          // principal que já existe.
          const principal = pedido?.phone
            ? pedido
            : pedido && atualPrincipal
              ? { ...pedido, phone: atualPrincipal.phone }
              : null;
          desejado.phones = [
            ...(principal ? [principal] : []),
            ...atuais.phones
              .filter(
                (p) => p !== atualPrincipal && p.phone !== principal?.phone
              )
              .map((p) => ({ phone: p.phone })),
          ];
        }
      }
      try {
        canais = await definirEnderecos(db, id, desejado);
      } catch (error) {
        if (error instanceof EnderecoDeOutroContato) {
          return NextResponse.json({ error: error.message }, { status: 409 });
        }
        throw error;
      }
    }

    // Substitui as associações de lista pelo conjunto informado.
    let listasDepois = listasAntes;
    if (changesLists) {
      let listIds = normalizeIds(body.listIds);
      if (soParceiros) {
        if ((await listasRestritas(db, listIds)).length > 0) {
          return NextResponse.json(
            { error: "Essa lista não está disponível para o seu perfil." },
            { status: 403 }
          );
        }
        // As listas que ele não vê continuam como estavam.
        listIds = [
          ...new Set([...listIds, ...(await listasRestritas(db, listasAntes))]),
        ];
      }
      await db.delete(contactLists).where(eq(contactLists.contactId, id));
      if (listIds.length > 0) {
        await db
          .insert(contactLists)
          .values(listIds.map((listId) => ({ contactId: id, listId })))
          .onConflictDoNothing();
      }
      listasDepois = listIds;
    }

    // Registra o que MUDOU — é disso que os gatilhos das automações vivem.
    if ("tags" in updates) {
      await emitTagDiff(id, existing.tags, updates.tags);
    }
    if (changesLists) {
      await emitListDiff(id, listasAntes, listasDepois);
    }
    // Saiu de um canal = ficou SEM endereço aceitando aquele canal.
    if (canais) {
      const { antes, depois } = canais;
      if (antes.subscribed && !depois.subscribed) {
        await emitContactEvent("email_unsubscribed", id);
      }
      if (antes.whatsappSubscribed && !depois.whatsappSubscribed) {
        await emitContactEvent("whatsapp_unsubscribed", id);
      }
      if (antes.smsSubscribed && !depois.smsSubscribed) {
        await emitContactEvent("sms_unsubscribed", id);
      }
    }

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id));
    return NextResponse.json({
      ...contact,
      ...(await listarEnderecos(db, id)),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    if (await foraDoAlcance(request, db, id)) return naoEncontrado();

    const [deleted] = await db
      .delete(contacts)
      .where(eq(contacts.id, id))
      .returning({ id: contacts.id });

    if (!deleted) {
      return NextResponse.json(
        { error: "Contato não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
