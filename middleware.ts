import { NextRequest, NextResponse } from "next/server";

import { paginaInicial, rotaPermitida } from "@/lib/perfis";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Rotas acessíveis sem login: página de login, endpoints usados pelos
// e-mails (tracking, descadastro, webhook, imagens) e healthcheck.
const PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/health",
  "/unsubscribe",
  "/api/unsubscribe",
  "/api/track/",
  "/api/webhooks/",
  "/uploads/",
  "/fonts/",
  "/icon.svg",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
  if (isPublic) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySessionToken(token) : null;

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Perfil: o que não é dele não abre, nem pela API. Tela vira redirecionamento
  // para o início do perfil; API responde 403.
  if (!rotaPermitida(user.role, pathname, request.method)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Seu perfil não tem acesso a esta área." },
        { status: 403 }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = paginaInicial(user.role);
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Tudo, exceto assets internos do Next.
  matcher: ["/((?!_next|favicon.ico).*)"],
};
