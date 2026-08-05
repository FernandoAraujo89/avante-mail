import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { corpoDoScript } from "@/lib/track/script";
import { marcarScriptServido } from "@/lib/track/recusas";

export const dynamic = "force-dynamic";

/**
 * Serve o script de rastreio em /api/track/site.js.
 *
 * O diretório se chama literalmente `site.js` para o caminho terminar em `.js`
 * — a tag no site fica com cara de script, e o prefixo público `/api/track/`
 * do middleware já cobre a rota (nenhuma edição no middleware).
 *
 * Cache de 1 hora, e NÃO `immutable`: a tag colada no site é eterna e não
 * temos como pedir para o time do site trocar nada. Precisamos poder corrigir
 * um defeito e ver a correção chegar sozinha em no máximo uma hora.
 */
export async function GET(request: NextRequest) {
  const corpo = corpoDoScript();
  const etag = `"${createHash("sha1").update(corpo).digest("base64url")}"`;

  // Registra que a tag está viva, inclusive no 304 — o 304 É a prova de que
  // o navegador pediu o script, só já tinha a cópia. Sem esta contagem, "não
  // chega visita" não distingue "a tag não foi colada" de "a tag está lá e
  // ninguém chamou o consentimento", que são problemas de donos diferentes.
  await marcarScriptServido();

  // 304 quando nada mudou: o site institucional carrega isto em toda página.
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "public, max-age=3600" },
    });
  }

  return new NextResponse(corpo, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      ETag: etag,
      // O script é público por natureza (qualquer um pode lê-lo); dizer isso
      // explicitamente evita que um proxy o trate como conteúdo de sessão.
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
