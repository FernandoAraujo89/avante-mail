import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import Papa from "papaparse";

import { contactLists, contacts, getDb, lists, type NewContact } from "@/lib/db";
import { EMAIL_REGEX, errorMessage, normalizeTags } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ImportField = "name" | "email" | "company" | "tags";
type ColumnMapping = Partial<Record<ImportField, string>>;

const CHUNK_SIZE = 500;

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
    if (!mapping.name || !mapping.email) {
      return NextResponse.json(
        { error: "Mapeie ao menos as colunas de nome e e-mail." },
        { status: 400 }
      );
    }

    // Se for importar para uma lista, ela precisa existir.
    if (listId) {
      const [list] = await db
        .select({ id: lists.id })
        .from(lists)
        .where(inArray(lists.id, [listId]));
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

    const total = parsed.data.length;
    let invalid = 0;
    const byEmail = new Map<string, NewContact>();

    for (const row of parsed.data) {
      const name = (row[mapping.name] ?? "").trim();
      const email = (row[mapping.email] ?? "").trim().toLowerCase();

      if (!name || !EMAIL_REGEX.test(email)) {
        invalid++;
        continue;
      }

      if (!byEmail.has(email)) {
        byEmail.set(email, {
          name,
          email,
          company: mapping.company
            ? (row[mapping.company] ?? "").trim() || null
            : null,
          tags: mapping.tags ? normalizeTags(row[mapping.tags]) : [],
        });
      }
    }

    const rows = Array.from(byEmail.values());
    let imported = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const inserted = await db
        .insert(contacts)
        .values(chunk)
        .onConflictDoNothing({ target: contacts.email })
        .returning({ id: contacts.id });
      imported += inserted.length;
    }

    // Associa à lista TODOS os contatos do arquivo (novos + já existentes).
    let addedToList = 0;
    if (listId && rows.length > 0) {
      const emails = rows.map((r) => r.email);
      const matched: { id: string }[] = [];
      for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
        const chunk = emails.slice(i, i + CHUNK_SIZE);
        const found = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(inArray(contacts.email, chunk));
        matched.push(...found);
      }
      for (let i = 0; i < matched.length; i += CHUNK_SIZE) {
        const chunk = matched.slice(i, i + CHUNK_SIZE);
        const added = await db
          .insert(contactLists)
          .values(chunk.map((c) => ({ contactId: c.id, listId })))
          .onConflictDoNothing()
          .returning({ contactId: contactLists.contactId });
        addedToList += added.length;
      }
    }

    return NextResponse.json({
      total,
      imported,
      duplicated: rows.length - imported + (total - invalid - rows.length),
      invalid,
      addedToList,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
