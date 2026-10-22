import { NextResponse } from "next/server";

import { getBaseUrl } from "@/lib/base-url";
import { GOOGLE_OAUTH_COOKIE, googleConfigurado, iniciarLogin } from "@/lib/auth/google";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Rota PÚBLICA: manda o navegador ao Google, guardando estado + PKCE num
// cookie assinado de 10 minutos.
export async function GET() {
  try {
    if (!googleConfigurado()) {
      return NextResponse.redirect(`${getBaseUrl()}/login?erro=google`);
    }
    const { url, cookie } = await iniciarLogin();
    const response = NextResponse.redirect(url);
    response.cookies.set(GOOGLE_OAUTH_COOKIE, cookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/google",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
