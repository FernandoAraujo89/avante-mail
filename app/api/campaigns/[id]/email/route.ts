import { NextRequest, NextResponse } from "next/server";

import { campanhaPorId, htmlDoEmailDaCampanha } from "@/lib/reenvio";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function pagina(mensagem: string, status: number) {
  return new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /></head><body style="margin:0;padding:48px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#6B7686;text-align:center;">${mensagem}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// O e-mail da campanha como HTML, para o quadro da tela "E-mail enviado" e
// para a impressão (?impressao=1 acrescenta a faixa com os dados do disparo e
// prepara o documento para o papel). Sem rastreio: ver não conta abertura.
//
// Devolve um DOCUMENTO, e não JSON, porque é carregado direto num iframe. O
// e-mail pode ter sido escrito em HTML livre, então o documento sai proibido
// de rodar script — ele é servido no mesmo endereço do sistema, com a sessão
// de quem está logado.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const campanha = await campanhaPorId(id);
    if (!campanha) return pagina("Campanha não encontrada.", 404);
    if (campanha.channel !== "email") {
      return pagina("Esta campanha não é de e-mail.", 400);
    }

    const impressao = request.nextUrl.searchParams.get("impressao") === "1";
    const html = await htmlDoEmailDaCampanha(
      campanha,
      impressao ? "impressao" : "tela"
    );
    if (!html) return pagina("Esta campanha não tem e-mail montado.", 404);

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "script-src 'none'; object-src 'none'",
        "X-Frame-Options": "SAMEORIGIN",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[campaigns/email]", errorMessage(error));
    return pagina("Não foi possível montar o e-mail desta campanha.", 500);
  }
}
