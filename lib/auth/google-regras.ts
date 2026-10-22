// Login pelo Google Workspace — as regras puras (docs/plano-expansao.md,
// parte 7): que conta vale, a URL de autorização e as mensagens de erro.
// Quem fala com o Google é ./google.ts.

export const DOMINIO_PADRAO = "avantejuntos.com.br";

/** O domínio do Workspace que pode entrar (GOOGLE_ALLOWED_DOMAIN). */
export function dominioPermitido(env: string | null | undefined): string {
  const d = (env ?? "").trim().toLowerCase().replace(/^@/, "");
  return d || DOMINIO_PADRAO;
}

export interface ContaGoogle {
  sub: string;
  email: string;
  emailVerified: boolean;
  /** O domínio do Workspace (claim `hd`); ausente em conta pessoal. */
  hd: string | null;
  name: string | null;
}

/** O que o ID token do Google precisa ter para virar uma conta. */
export function lerConta(payload: Record<string, unknown>): ContaGoogle | null {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!sub || !email) return null;
  return {
    sub,
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    hd: typeof payload.hd === "string" ? payload.hd.toLowerCase() : null,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

export type MotivoDeRecusa = "nao-verificado" | "fora-do-dominio";

/**
 * Conta do Workspace da Avante, verificada. O `hd` é a garantia da Google de
 * que a conta é do domínio; o sufixo do e-mail é a segunda trava.
 */
export function aceitaConta(
  conta: ContaGoogle,
  dominio: string
): { ok: true } | { ok: false; motivo: MotivoDeRecusa } {
  if (!conta.emailVerified) return { ok: false, motivo: "nao-verificado" };
  if (conta.hd !== dominio || !conta.email.endsWith(`@${dominio}`)) {
    return { ok: false, motivo: "fora-do-dominio" };
  }
  return { ok: true };
}

export function montarUrlDeAutorizacao(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  dominio: string;
}): string {
  const p = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
    // Só mostra contas do Workspace na escolha (a validação de verdade é o hd).
    hd: args.dominio,
    prompt: "select_account",
    access_type: "online",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** O que a tela de login mostra para cada `?erro=` do retorno do Google. */
export const ERROS_DE_LOGIN: Record<string, string> = {
  "sem-cadastro":
    "Sua conta Google é da Avante, mas ainda não tem acesso aqui. Peça ao administrador para cadastrar você com o perfil certo.",
  "fora-do-dominio": "Entre com a sua conta Google da Avante (@avantejuntos.com.br).",
  "nao-verificado": "A Google não confirmou o e-mail desta conta.",
  google: "Não foi possível entrar com o Google. Tente de novo.",
  expirou: "A tentativa de entrar expirou. Tente de novo.",
};
