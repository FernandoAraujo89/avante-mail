// Sessão por cookie assinado (JWT). Este módulo roda também no Edge
// (middleware), então só pode usar `jose` — nada de node:crypto.
import { jwtVerify, SignJWT } from "jose";

import { ehPerfil, type Perfil } from "@/lib/perfis";

export const SESSION_COOKIE = "avante_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 dias

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Perfil;
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET não definido no .env.local.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    purpose: "session",
    name: user.name,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Usuário da sessão a partir do cookie da requisição. O parâmetro é tipado
 * estruturalmente para este módulo continuar servindo ao middleware (Edge).
 */
export async function sessionUserFromRequest(request: {
  cookies: { get(name: string): { value: string } | undefined };
}): Promise<SessionUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function verifySessionToken(
  token: string
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== "session" || !payload.sub) return null;
    // Sessão de antes dos perfis: não diz quem a pessoa é, então não vale —
    // tratá-la como admin daria acesso total a quem entrou antes de ganhar
    // um perfil restrito. Custa um login a mais, uma vez.
    if (!ehPerfil(payload.role)) return null;
    return {
      id: payload.sub,
      name: typeof payload.name === "string" ? payload.name : "",
      email: typeof payload.email === "string" ? payload.email : "",
      role: payload.role,
    };
  } catch {
    return null;
  }
}
