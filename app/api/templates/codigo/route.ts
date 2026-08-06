import { NextRequest, NextResponse } from "next/server";

import {
  compileDesignToMjml,
  isValidDesign,
} from "@/lib/email-builder/compile";
import { recortarEntreMarcadores } from "@/lib/email-builder/codigo";
import { compileEmailContent } from "@/lib/mjml";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * O HTML que um pedaço do e-mail gera hoje — o ponto de partida para editar.
 *
 * Compila no SERVIDOR, e não no navegador, porque é o mesmo `mjml2html` do
 * envio: gerar o código de um jeito aqui e de outro na hora de mandar faria a
 * tela mostrar um HTML que nunca chega a ninguém.
 *
 * `alvo.tipo`:
 *   - "documento": o e-mail inteiro, com o `<style>` do cabeçalho;
 *   - "linha": a tabela da estrutura;
 *   - "bloco": o `<td>` do bloco.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { design, alvo } = body;

    if (!isValidDesign(design)) {
      return NextResponse.json(
        { error: "Design inválido." },
        { status: 400 }
      );
    }

    const tipo = alvo?.tipo;
    if (tipo !== "documento" && tipo !== "linha" && tipo !== "bloco") {
      return NextResponse.json(
        { error: "Informe o que deve ser mostrado: documento, linha ou bloco." },
        { status: 400 }
      );
    }
    if (tipo !== "documento" && typeof alvo?.id !== "string") {
      return NextResponse.json(
        { error: "Informe qual linha ou bloco." },
        { status: 400 }
      );
    }

    if (tipo === "documento") {
      const { html, errors } = await compileEmailContent(
        compileDesignToMjml(design)
      );
      return NextResponse.json({ html, errors });
    }

    const mjml = compileDesignToMjml(design, { tipo, id: alvo.id });
    const { html, errors } = await compileEmailContent(mjml);
    const trecho = recortarEntreMarcadores(html, tipo === "bloco");

    if (trecho === null) {
      return NextResponse.json(
        {
          error:
            "Não foi possível recortar este pedaço. Ele pode ter sido removido do e-mail — feche e abra o código de novo.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ html: trecho, errors });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
