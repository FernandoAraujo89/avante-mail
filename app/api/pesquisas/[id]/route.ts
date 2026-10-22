import { NextRequest, NextResponse } from "next/server";

import {
  atualizarPesquisa,
  carregarPesquisa,
  excluirPesquisa,
} from "@/lib/pesquisas";
import { parseWhatsApp } from "@/lib/pesquisas/parse-whatsapp";
import {
  ehStatus,
  parseMensagens,
  parsePesquisa,
  transicaoDeStatus,
} from "@/lib/pesquisas/perguntas";
import { errorMessage, UUID_REGEX } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function naoEncontrada() {
  return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const pesquisa = UUID_REGEX.test(id) ? await carregarPesquisa(id) : null;
    if (!pesquisa) return naoEncontrada();
    return NextResponse.json(pesquisa);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** Nome e textos (quando vêm) e/ou a situação (ativar, encerrar, reabrir). */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const atual = UUID_REGEX.test(id) ? await carregarPesquisa(id) : null;
    if (!atual) return naoEncontrada();

    const body = await request.json().catch(() => ({}));
    const patch: Parameters<typeof atualizarPesquisa>[1] = {};

    if (body.name !== undefined || body.intro !== undefined || body.thanks !== undefined) {
      const parsed = parsePesquisa({
        name: body.name ?? atual.name,
        intro: body.intro ?? atual.intro,
        thanks: body.thanks ?? atual.thanks,
      });
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      Object.assign(patch, parsed.dados);
    }

    if (body.emailSubject !== undefined || body.emailBody !== undefined) {
      const parsed = parseMensagens({
        emailSubject: body.emailSubject ?? atual.emailSubject,
        emailBody: body.emailBody ?? atual.emailBody,
      });
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      Object.assign(patch, parsed.dados);
    }

    if (body.whatsappTemplateId !== undefined || body.whatsappVariables !== undefined) {
      const parsed = parseWhatsApp({
        whatsappTemplateId: body.whatsappTemplateId ?? atual.whatsappTemplateId,
        whatsappVariables: body.whatsappVariables ?? atual.whatsappVariables,
      });
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      Object.assign(patch, parsed.dados);
    }

    if (body.status !== undefined) {
      if (!ehStatus(body.status)) {
        return NextResponse.json({ error: "Situação inválida." }, { status: 400 });
      }
      const transicao = transicaoDeStatus(atual.status, body.status, atual.questionCount);
      if (!transicao.ok) {
        return NextResponse.json({ error: transicao.error }, { status: 400 });
      }
      patch.status = body.status;
    }

    if (Object.keys(patch).length > 0) await atualizarPesquisa(id, patch);
    return NextResponse.json(await carregarPesquisa(id));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!UUID_REGEX.test(id)) return naoEncontrada();
    const resultado = await excluirPesquisa(id);
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
