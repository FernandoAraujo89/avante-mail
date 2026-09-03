import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";

import { getDb, templates } from "@/lib/db";
import { compileDesignToMjml, isValidDesign } from "@/lib/email-builder/compile";
import {
  internalizarImagensDoDesign,
  internalizarImagensDoHtml,
  type RelatorioImagens,
} from "@/lib/uploads-externas";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const data = await db
      .select()
      .from(templates)
      .orderBy(desc(templates.createdAt));
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const category =
      typeof body.category === "string" && body.category ? body.category : null;

    if (!name) {
      return NextResponse.json(
        { error: "O nome do template é obrigatório." },
        { status: 400 }
      );
    }

    // Template do Criador de email: o design é a fonte da verdade
    // e o MJML é gerado no servidor.
    let mjmlContent =
      typeof body.mjmlContent === "string" ? body.mjmlContent : "";
    let design = null;
    let editorType: "builder" | "code" = "code";

    // Imagem de outro domínio vira imagem nossa antes de o template existir:
    // o e-mail não pode depender de um site que amanhã sai do ar.
    let imagens: RelatorioImagens = { baixadas: 0, falhas: [] };

    if (body.design !== undefined && body.design !== null) {
      if (!isValidDesign(body.design)) {
        return NextResponse.json(
          { error: "Design do template inválido." },
          { status: 400 }
        );
      }
      const internalizado = await internalizarImagensDoDesign(body.design);
      design = internalizado.design;
      imagens = internalizado.relatorio;
      editorType = "builder";
      mjmlContent = compileDesignToMjml(design);
    } else if (mjmlContent.trim()) {
      const internalizado = await internalizarImagensDoHtml(mjmlContent);
      mjmlContent = internalizado.html;
      imagens = internalizado.relatorio;
    }

    if (!mjmlContent.trim()) {
      return NextResponse.json(
        { error: "O conteúdo do template é obrigatório." },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(templates)
      .values({ name, category, mjmlContent, design, editorType })
      .returning();

    return NextResponse.json({ ...created, imagens }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
