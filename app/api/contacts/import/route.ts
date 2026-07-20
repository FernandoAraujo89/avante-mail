import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";

import { contacts, getDb, type NewContact } from "@/lib/db";
import { EMAIL_REGEX, errorMessage, normalizeTags } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ImportField = "name" | "email" | "company" | "segment" | "tags";
type ColumnMapping = Partial<Record<ImportField, string>>;

const CHUNK_SIZE = 500;

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const csv = typeof body.csv === "string" ? body.csv : "";
    const mapping: ColumnMapping =
      body.mapping && typeof body.mapping === "object" ? body.mapping : {};

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

      // Duplicatas dentro do próprio arquivo: mantém a primeira ocorrência.
      if (!byEmail.has(email)) {
        byEmail.set(email, {
          name,
          email,
          company: mapping.company
            ? (row[mapping.company] ?? "").trim() || null
            : null,
          segment: mapping.segment
            ? (row[mapping.segment] ?? "").trim() || null
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

    return NextResponse.json({
      total,
      imported,
      duplicated: rows.length - imported + (total - invalid - rows.length),
      invalid,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
