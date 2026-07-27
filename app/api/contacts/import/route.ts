import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import Papa from "papaparse";

import { contactLists, contacts, getDb, lists, type NewContact } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { EMAIL_REGEX, errorMessage, normalizeTags } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ImportField =
  | "name"
  | "email"
  | "company"
  | "tags"
  | "phone"
  | "whatsappOptIn";
type ColumnMapping = Partial<Record<ImportField, string>>;

const CHUNK_SIZE = 500;

// Valores aceitos como "sim" na coluna de consentimento de WhatsApp.
const TRUTHY = new Set(["sim", "s", "yes", "y", "true", "1", "x", "verdadeiro"]);

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
    let phoneInvalid = 0;
    const byEmail = new Map<string, NewContact>();
    const seenPhones = new Set<string>();

    for (const row of parsed.data) {
      const name = (row[mapping.name] ?? "").trim();
      const email = (row[mapping.email] ?? "").trim().toLowerCase();

      if (!name || !EMAIL_REGEX.test(email)) {
        invalid++;
        continue;
      }

      if (!byEmail.has(email)) {
        // Telefone inválido não descarta a linha — o contato entra sem ele.
        let phone: string | null = null;
        if (mapping.phone) {
          const rawPhone = (row[mapping.phone] ?? "").trim();
          if (rawPhone) {
            phone = normalizePhone(rawPhone);
            if (!phone) phoneInvalid++;
          }
        }
        // Telefone repetido dentro do arquivo fica só na primeira linha
        // (coluna única no banco).
        if (phone) {
          if (seenPhones.has(phone)) phone = null;
          else seenPhones.add(phone);
        }

        // Opt-in de WhatsApp só com telefone válido e coluna explícita de
        // consentimento marcada como "sim" (LGPD).
        const whatsappOptIn =
          phone !== null &&
          Boolean(mapping.whatsappOptIn) &&
          TRUTHY.has(
            (row[mapping.whatsappOptIn as string] ?? "").trim().toLowerCase()
          );

        byEmail.set(email, {
          name,
          email,
          phone,
          company: mapping.company
            ? (row[mapping.company] ?? "").trim() || null
            : null,
          tags: mapping.tags ? normalizeTags(row[mapping.tags]) : [],
          whatsappSubscribed: whatsappOptIn,
          whatsappOptInAt: whatsappOptIn ? new Date() : null,
        });
      }
    }

    const rows = Array.from(byEmail.values());

    // Telefones já usados por contatos da base violariam a coluna única e
    // abortariam o INSERT do lote — importa esses contatos sem o telefone.
    const phones = rows
      .map((r) => r.phone)
      .filter((p): p is string => Boolean(p));
    if (phones.length > 0) {
      const inUse = new Set<string>();
      for (let i = 0; i < phones.length; i += CHUNK_SIZE) {
        const chunk = phones.slice(i, i + CHUNK_SIZE);
        const found = await db
          .select({ phone: contacts.phone })
          .from(contacts)
          .where(inArray(contacts.phone, chunk));
        for (const f of found) {
          if (f.phone) inUse.add(f.phone);
        }
      }
      for (const r of rows) {
        if (r.phone && inUse.has(r.phone)) {
          r.phone = null;
          r.whatsappSubscribed = false;
          r.whatsappOptInAt = null;
        }
      }
    }

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
      phoneInvalid,
      addedToList,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
