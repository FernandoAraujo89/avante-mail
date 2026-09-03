import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, templates } from "@/lib/db";
import { compileEmailContent } from "@/lib/mjml";
import { internalizarImagensDoHtml } from "@/lib/uploads-externas";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Prepara um template escrito em código para ser aberto no criador visual.
 *
 * Duas coisas acontecem aqui, e as duas precisam do servidor:
 *
 * 1. O MJML é compilado pelo MESMO caminho do envio — abrir no criador um HTML
 *    gerado de outro jeito mostraria um e-mail que nunca chega a ninguém. As
 *    variáveis ({{corpo}}, {{nome_parceiro}}) ficam como estão: substituí-las
 *    aqui gravaria os dados de exemplo dentro do modelo.
 *
 * 2. As imagens hospedadas em outros domínios são baixadas para o banco de
 *    imagens. Imagem de fora é entrega em risco: se o site de origem sair do
 *    ar ou barrar hotlink, o e-mail já enviado quebra na caixa de entrada.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    let fonte = typeof body.mjmlContent === "string" ? body.mjmlContent : "";

    if (!fonte && typeof body.templateId === "string" && body.templateId) {
      const db = getDb();
      const [template] = await db
        .select({ mjmlContent: templates.mjmlContent })
        .from(templates)
        .where(eq(templates.id, body.templateId));
      if (!template) {
        return NextResponse.json(
          { error: "Template não encontrado." },
          { status: 404 }
        );
      }
      fonte = template.mjmlContent;
    }

    if (!fonte.trim()) {
      return NextResponse.json(
        { error: "Envie o conteúdo do template para abrir no criador." },
        { status: 400 }
      );
    }

    const { html, errors } = await compileEmailContent(fonte);
    const internalizado = await internalizarImagensDoHtml(html);

    return NextResponse.json({
      html: internalizado.html,
      errors,
      imagens: internalizado.relatorio,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
