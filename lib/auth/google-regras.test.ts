import { describe, expect, it } from "vitest";

import {
  aceitaConta,
  dominioPermitido,
  lerConta,
  montarUrlDeAutorizacao,
} from "./google-regras";

describe("login Google — regras", () => {
  it("domínio permitido vem da env, com padrão", () => {
    expect(dominioPermitido(undefined)).toBe("avantejuntos.com.br");
    expect(dominioPermitido(" @Outro.com ")).toBe("outro.com");
  });

  it("lê a conta do ID token", () => {
    expect(lerConta({ sub: "1", email: "A@X.com", email_verified: true, hd: "X.com", name: "A" })).toEqual({
      sub: "1",
      email: "a@x.com",
      emailVerified: true,
      hd: "x.com",
      name: "A",
    });
    expect(lerConta({ email: "a@x.com" })).toBeNull();
  });

  it("só conta verificada do domínio entra", () => {
    const base = { sub: "1", email: "ana@avantejuntos.com.br", emailVerified: true, hd: "avantejuntos.com.br", name: null };
    expect(aceitaConta(base, "avantejuntos.com.br")).toEqual({ ok: true });
    expect(aceitaConta({ ...base, emailVerified: false }, "avantejuntos.com.br")).toEqual({ ok: false, motivo: "nao-verificado" });
    expect(aceitaConta({ ...base, hd: null }, "avantejuntos.com.br")).toEqual({ ok: false, motivo: "fora-do-dominio" });
    expect(aceitaConta({ ...base, email: "ana@gmail.com" }, "avantejuntos.com.br")).toEqual({ ok: false, motivo: "fora-do-dominio" });
  });

  it("monta a URL de autorização com PKCE e o domínio", () => {
    const url = new URL(
      montarUrlDeAutorizacao({ clientId: "cid", redirectUri: "https://x/cb", state: "s", codeChallenge: "c", dominio: "avantejuntos.com.br" })
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("hd")).toBe("avantejuntos.com.br");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });
});
