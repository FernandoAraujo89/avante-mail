import { NextRequest, NextResponse } from "next/server";
import { eq, isNull, sql } from "drizzle-orm";
import Papa from "papaparse";

import {
  decidir,
  indexar,
  indiceVazio,
  type Decisao,
  type LinhaDoArquivo,
} from "@/lib/contatos/casamento";
import {
  adicionarEnderecos,
  listarEnderecosDeVarios,
} from "@/lib/contatos/enderecos";
import { contactLists, contacts, getDb, lists } from "@/lib/db";
import { listaEhRestrita, veSoParceiros } from "@/lib/escopo-parceiros";
import { emitContactEvents, emitTagDiff } from "@/lib/events";
import { allValidPhones } from "@/lib/phone";
import { sessionUserFromRequest } from "@/lib/session";
import { errorMessage, normalizeTags, parseEmailList } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Importa E atualiza (06/10/2026): a linha que casa com um contato da base
// acrescenta a ele os e-mails e telefones que ele ainda não tinha; a que não
// casa com ninguém vira contato novo. A regra de casamento é a de
// lib/contatos/casamento.ts. O e-mail deixou de ser obrigatório — a planilha
// do Sucesso do cliente traz nome e telefone.

type ImportField =
  "name" | "email" | "company" | "tags" | "phone" | "whatsappOptIn";
type ColumnMapping = Partial<Record<ImportField, string>>;

// Valores aceitos como "sim" na coluna de consentimento dos canais de telefone.
const TRUTHY = new Set([
  "sim",
  "s",
  "yes",
  "y",
  "true",
  "1",
  "x",
  "verdadeiro",
]);

/** Até quantas pendências voltam na resposta (o resto vira só número). */
const MAX_PENDENCIAS = 500;

interface Pendencia {
  linha: number;
  nome: string;
  valores: string;
  motivo: string;
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const csv = typeof body.csv === "string" ? body.csv : "";
    const mapping: ColumnMapping =
      body.mapping && typeof body.mapping === "object" ? body.mapping : {};
    const listId =
      typeof body.listId === "string" && body.listId ? body.listId : null;

    if (!csv.trim()) {
      return NextResponse.json(
        { error: "Nenhum conteúdo CSV recebido." },
        { status: 400 }
      );
    }
    if (!mapping.name) {
      return NextResponse.json(
        { error: "Mapeie a coluna de nome." },
        { status: 400 }
      );
    }
    if (!mapping.email && !mapping.phone) {
      return NextResponse.json(
        { error: "Mapeie a coluna de e-mail, a de telefone ou as duas." },
        { status: 400 }
      );
    }

    const soParceiros = veSoParceiros(await sessionUserFromRequest(request));

    // Se for importar para uma lista, ela precisa existir — e, para quem vê
    // só parceiros, não pode ser a de leads.
    if (listId && soParceiros && (await listaEhRestrita(db, listId))) {
      return NextResponse.json(
        { error: "Lista de destino não encontrada." },
        { status: 404 }
      );
    }
    if (listId) {
      const [list] = await db
        .select({ id: lists.id })
        .from(lists)
        .where(eq(lists.id, listId));
      if (!list) {
        return NextResponse.json(
          { error: "Lista de destino não encontrada." },
          { status: 404 }
        );
      }
    }

    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
    });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return NextResponse.json(
        { error: `CSV inválido: ${parsed.errors[0].message}` },
        { status: 400 }
      );
    }

    // ── 1. As linhas, já limpas ─────────────────────────────────────────
    const total = parsed.data.length;
    let telefonesInvalidos = 0;
    const pendencias: Pendencia[] = [];
    let pendenciasOmitidas = 0;
    const pendente = (p: Pendencia) => {
      if (pendencias.length < MAX_PENDENCIAS) pendencias.push(p);
      else pendenciasOmitidas++;
    };

    type Linha = LinhaDoArquivo & {
      empresa: string | null;
      tags: string[];
      consentimentoTelefone: boolean;
    };
    const linhas: Linha[] = [];

    parsed.data.forEach((row, indice) => {
      const numero = indice + 2; // a linha 1 é o cabeçalho
      const nome = (row[mapping.name as string] ?? "").trim();
      const emailCru = mapping.email ? (row[mapping.email] ?? "").trim() : "";
      const telefoneCru = mapping.phone
        ? (row[mapping.phone] ?? "").trim()
        : "";
      const emails = parseEmailList(emailCru);
      // Célula com vários números ("91 9...-..., (91) 9...-...") são vários
      // telefones do mesmo contato; qualquer formato com DDD vira E.164.
      const telefones = allValidPhones(telefoneCru);
      if (telefoneCru && telefones.length === 0) telefonesInvalidos++;

      if (!nome) {
        pendente({
          linha: numero,
          nome,
          valores: [emailCru, telefoneCru].filter(Boolean).join(" · "),
          motivo: "sem nome",
        });
        return;
      }
      if (emails.length === 0 && telefones.length === 0) {
        pendente({
          linha: numero,
          nome,
          valores: [emailCru, telefoneCru].filter(Boolean).join(" · "),
          motivo:
            emailCru || telefoneCru
              ? "e-mail e telefone inválidos"
              : "sem e-mail nem telefone",
        });
        return;
      }

      // Opt-in dos canais de telefone: quem tem telefone válido entra com
      // consentimento. Se a planilha trouxer uma coluna de consentimento, ela
      // é que manda — inclusive para negar (só "sim/true/1..." mantém o
      // opt-in), que é como se registra quem não autorizou (LGPD). A coluna
      // é UMA só e vale para WhatsApp e SMS: quem a preencheu autorizou o
      // contato PELO TELEFONE, não por um canal técnico.
      const consentimentoTelefone =
        !mapping.whatsappOptIn ||
        TRUTHY.has((row[mapping.whatsappOptIn] ?? "").trim().toLowerCase());

      linhas.push({
        linha: numero,
        nome,
        emails,
        telefones,
        empresa: mapping.company
          ? (row[mapping.company] ?? "").trim() || null
          : null,
        tags: mapping.tags ? normalizeTags(row[mapping.tags]) : [],
        consentimentoTelefone,
      });
    });

    // ── 2. O índice da base ─────────────────────────────────────────────
    // A base é pequena (milhares): cabe inteira na memória, e casar em
    // memória evita três consultas por linha. Quem vê só parceiros não
    // enxerga lead: para ele, lead nem está no índice. Para o admin, lead
    // casa por e-mail/telefone (para não duplicar), mas nunca pelo nome —
    // a planilha é de parceiros.
    const base = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        company: contacts.company,
        tags: contacts.tags,
        lead: sql<boolean>`${contacts.stage} is not null`,
      })
      .from(contacts)
      .where(soParceiros ? isNull(contacts.stage) : undefined);
    const enderecosDaBase = await listarEnderecosDeVarios(
      db,
      base.map((c) => c.id)
    );
    const indice = indiceVazio();
    const dados = new Map(base.map((c) => [c.id, c]));
    for (const c of base) {
      const e = enderecosDaBase.get(c.id);
      indexar(indice, {
        id: c.id,
        nome: c.name,
        emails: (e?.emails ?? []).map((x) => x.email),
        telefones: (e?.phones ?? []).map((x) => x.phone),
        porNome: !c.lead,
      });
    }

    // ── 3. Linha a linha ────────────────────────────────────────────────
    let criados = 0;
    let atualizados = 0;
    let semMudanca = 0;
    let emailsAdicionados = 0;
    let telefonesAdicionados = 0;
    let addedToList = 0;
    const eventos: Parameters<typeof emitContactEvents>[0] = [];

    const descrever = (l: Linha) => [...l.emails, ...l.telefones].join(" · ");

    async function entrarNaLista(contactId: string) {
      if (!listId) return;
      const added = await db
        .insert(contactLists)
        .values({ contactId, listId })
        .onConflictDoNothing()
        .returning({ contactId: contactLists.contactId });
      if (added.length > 0) {
        addedToList++;
        eventos.push({
          type: "list_subscribed",
          contactId,
          payload: { listId },
        });
      }
    }

    for (const linha of linhas) {
      const decisao: Decisao = decidir(linha, indice);

      if (decisao.tipo === "ambiguo") {
        pendente({
          linha: linha.linha,
          nome: linha.nome,
          valores: descrever(linha),
          motivo: `${decisao.candidatos.length} contatos com este nome — abra um deles e acrescente à mão`,
        });
        continue;
      }
      if (decisao.tipo === "conflito") {
        pendente({
          linha: linha.linha,
          nome: linha.nome,
          valores: descrever(linha),
          motivo: "o e-mail é de um contato e o telefone é de outro",
        });
        continue;
      }

      const entrada = {
        emails: linha.emails.map((email) => ({ email })),
        phones: linha.telefones.map((phone) => ({
          phone,
          whatsapp: linha.consentimentoTelefone,
          sms: linha.consentimentoTelefone,
        })),
      };

      if (decisao.tipo === "criar") {
        const [novo] = await db
          .insert(contacts)
          .values({
            name: linha.nome,
            company: linha.empresa,
            tags: linha.tags,
          })
          .returning({ id: contacts.id });
        const r = await adicionarEnderecos(db, novo.id, entrada);
        if (
          r.emailsAdicionados.length === 0 &&
          r.telefonesAdicionados.length === 0
        ) {
          // Todos os endereços pertencem a contatos que este perfil não vê
          // (um lead, por exemplo). Sem endereço o contato não serve para
          // nada: desfaz e deixa para uma pessoa.
          await db.delete(contacts).where(eq(contacts.id, novo.id));
          pendente({
            linha: linha.linha,
            nome: linha.nome,
            valores: descrever(linha),
            motivo: "e-mail/telefone já pertencem a outro contato",
          });
          continue;
        }
        criados++;
        emailsAdicionados += r.emailsAdicionados.length;
        telefonesAdicionados += r.telefonesAdicionados.length;
        indexar(indice, {
          id: novo.id,
          nome: linha.nome,
          emails: r.emailsAdicionados,
          telefones: r.telefonesAdicionados,
          porNome: true,
        });
        dados.set(novo.id, {
          id: novo.id,
          name: linha.nome,
          company: linha.empresa,
          tags: linha.tags,
          lead: false,
        });
        eventos.push({ type: "contact_created", contactId: novo.id });
        for (const tag of linha.tags) {
          eventos.push({
            type: "tag_added",
            contactId: novo.id,
            payload: { tag },
          });
        }
        await entrarNaLista(novo.id);
        continue;
      }

      // atualizar: acrescenta o que falta; o que o contato já tem fica.
      const contato = dados.get(decisao.contactId);
      const r = await adicionarEnderecos(db, decisao.contactId, entrada);
      let mudou =
        r.emailsAdicionados.length > 0 || r.telefonesAdicionados.length > 0;
      emailsAdicionados += r.emailsAdicionados.length;
      telefonesAdicionados += r.telefonesAdicionados.length;
      indexar(indice, {
        id: decisao.contactId,
        nome: contato?.name ?? linha.nome,
        emails: r.emailsAdicionados,
        telefones: r.telefonesAdicionados,
        porNome: false,
      });

      // Empresa só completa lacuna; tags somam.
      const patch: Partial<typeof contacts.$inferInsert> = {};
      if (contato && !contato.company && linha.empresa) {
        patch.company = linha.empresa;
        contato.company = linha.empresa;
      }
      const tagsAntes = contato?.tags ?? [];
      const tagsDepois = [...new Set([...tagsAntes, ...linha.tags])];
      if (tagsDepois.length !== tagsAntes.length) {
        patch.tags = tagsDepois;
        if (contato) contato.tags = tagsDepois;
      }
      if (Object.keys(patch).length > 0) {
        await db
          .update(contacts)
          .set(patch)
          .where(eq(contacts.id, decisao.contactId));
        if (patch.tags)
          await emitTagDiff(decisao.contactId, tagsAntes, tagsDepois);
        mudou = true;
      }

      const naLista = addedToList;
      await entrarNaLista(decisao.contactId);
      if (addedToList > naLista) mudou = true;

      if (mudou) atualizados++;
      else semMudanca++;
    }

    await emitContactEvents(eventos);
    // Na ordem da planilha, para quem for conferir linha a linha.
    pendencias.sort((a, b) => a.linha - b.linha);

    return NextResponse.json({
      total,
      criados,
      atualizados,
      semMudanca,
      emailsAdicionados,
      telefonesAdicionados,
      telefonesInvalidos,
      addedToList,
      pendencias,
      pendenciasOmitidas,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
