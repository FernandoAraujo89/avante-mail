// Login pelo Google Workspace (OpenID Connect) — a parte que fala com o
// Google e com o banco. Sem dependência nova: `fetch` para trocar o código e
// `jose` (já usado na sessão) para validar o ID token pelas chaves públicas.
// Regras puras e mensagens em ./google-regras.ts.
import { createHash, randomBytes } from "crypto";
import { eq, or } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

import { getBaseUrl } from "@/lib/base-url";
import { getDb, users, type User } from "@/lib/db";

import {
  aceitaConta,
  dominioPermitido,
  lerConta,
  montarUrlDeAutorizacao,
  type MotivoDeRecusa,
} from "./google-regras";

/** Cookie com o estado e o verificador PKCE entre a ida e a volta ao Google. */
export const GOOGLE_OAUTH_COOKIE = "avante_google_oauth";
const ESTADO_MAX_AGE_SECONDS = 10 * 60;

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function googleConfigurado(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function segredo(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET não definido no .env.local.");
  return new TextEncoder().encode(s);
}

function redirectUri(): string {
  return `${getBaseUrl()}/api/auth/google/callback`;
}

/** A URL para onde mandar o navegador e o valor do cookie de estado. */
export async function iniciarLogin(): Promise<{ url: string; cookie: string }> {
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const cookie = await new SignJWT({ purpose: "google-oauth", state, verifier })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ESTADO_MAX_AGE_SECONDS}s`)
    .sign(segredo());

  return {
    url: montarUrlDeAutorizacao({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      redirectUri: redirectUri(),
      state,
      codeChallenge: challenge,
      dominio: dominioPermitido(process.env.GOOGLE_ALLOWED_DOMAIN),
    }),
    cookie,
  };
}

export type ResultadoDoLogin =
  | { ok: true; user: User }
  | { ok: false; erro: MotivoDeRecusa | "sem-cadastro" | "google" | "expirou" };

async function lerEstado(cookie: string | undefined): Promise<{ state: string; verifier: string } | null> {
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, segredo());
    if (payload.purpose !== "google-oauth") return null;
    return typeof payload.state === "string" && typeof payload.verifier === "string"
      ? { state: payload.state, verifier: payload.verifier }
      : null;
  } catch {
    return null;
  }
}

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

/**
 * A volta do Google: confere o estado, troca o código pelo ID token, valida
 * o token e acha o usuário já cadastrado. Conta do Workspace sem cadastro
 * NÃO entra (decisão 6 do plano) — o administrador cadastra com o perfil.
 */
export async function concluirLogin(args: {
  code: string | null;
  state: string | null;
  cookie: string | undefined;
}): Promise<ResultadoDoLogin> {
  const estado = await lerEstado(args.cookie);
  if (!estado) return { ok: false, erro: "expirou" };
  if (!args.code || !args.state || args.state !== estado.state) {
    return { ok: false, erro: "google" };
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: args.code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: estado.verifier,
    }),
    cache: "no-store",
  });
  const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !tokens.id_token) {
    console.error("[LOGIN-GOOGLE] Troca do código falhou:", tokens.error ?? res.status);
    return { ok: false, erro: "google" };
  }

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: process.env.GOOGLE_CLIENT_ID!,
    }));
  } catch (error) {
    console.error("[LOGIN-GOOGLE] ID token inválido:", error);
    return { ok: false, erro: "google" };
  }

  const conta = lerConta(payload);
  if (!conta) return { ok: false, erro: "google" };
  const aceite = aceitaConta(conta, dominioPermitido(process.env.GOOGLE_ALLOWED_DOMAIN));
  if (!aceite.ok) return { ok: false, erro: aceite.motivo };

  // Pelo id da conta (quem já entrou) ou pelo e-mail (primeira vez).
  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(users.googleSub, conta.sub), eq(users.email, conta.email)))
    .limit(1);
  if (!user) return { ok: false, erro: "sem-cadastro" };

  await db
    .update(users)
    .set({ googleSub: user.googleSub ?? conta.sub, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));
  return { ok: true, user };
}
