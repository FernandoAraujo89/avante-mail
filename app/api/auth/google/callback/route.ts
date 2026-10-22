import { NextRequest, NextResponse } from "next/server";

import { getBaseUrl } from "@/lib/base-url";
import { concluirLogin, GOOGLE_OAUTH_COOKIE } from "@/lib/auth/google";
import { paginaInicial } from "@/lib/perfis";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSessionToken } from "@/lib/session";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Rota PÚBLICA: a volta do Google. Entrando, a sessão é a mesma do login por
// senha (cookie JWT com o perfil do banco).
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const resultado = await concluirLogin({
      code: params.get("code"),
      state: params.get("state"),
      cookie: request.cookies.get(GOOGLE_OAUTH_COOKIE)?.value,
    });

    const base = getBaseUrl();
    const response = NextResponse.redirect(
      resultado.ok ? `${base}${paginaInicial(resultado.user.role)}` : `${base}/login?erro=${resultado.erro}`
    );
    response.cookies.set(GOOGLE_OAUTH_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });

    if (resultado.ok) {
      const { user } = resultado;
      const token = await signSessionToken({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
      response.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
    }
    return response;
  } catch (error) {
    console.error("[LOGIN-GOOGLE]", errorMessage(error));
    return NextResponse.redirect(`${getBaseUrl()}/login?erro=google`);
  }
}
