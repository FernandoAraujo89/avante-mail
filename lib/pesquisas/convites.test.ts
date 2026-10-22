import { describe, expect, it } from "vitest";

import {
  aceitaResposta,
  estadoAoAbrir,
  estadoAoResponder,
  gerarToken,
  hashDoToken,
  linkDoConvite,
  tokenBemFormado,
} from "./convites";

describe("token do convite", () => {
  it("gera 43 caracteres base64url e o hash bate", () => {
    const { token, hash } = gerarToken();
    expect(tokenBemFormado(token)).toBe(true);
    expect(hash).toBe(hashDoToken(token));
    expect(hash).toHaveLength(64);
    expect(gerarToken().token).not.toBe(token);
  });

  it("rejeita o que não é token", () => {
    expect(tokenBemFormado("abc")).toBe(false);
    expect(tokenBemFormado("a".repeat(43) + "=")).toBe(false);
    expect(tokenBemFormado(42)).toBe(false);
  });

  it("monta o link sem barra dupla", () => {
    expect(linkDoConvite("https://x.com/", "t".repeat(43))).toBe(
      `https://x.com/pesquisa/${"t".repeat(43)}`
    );
  });
});

describe("estados do convite", () => {
  it("abrir e responder avançam só o que está atrás", () => {
    expect(estadoAoAbrir("pending")).toBe("opened");
    expect(estadoAoAbrir("in_progress")).toBe("in_progress");
    expect(estadoAoAbrir("completed")).toBe("completed");
    expect(estadoAoResponder("pending")).toBe("in_progress");
    expect(estadoAoResponder("opened")).toBe("in_progress");
    expect(estadoAoResponder("in_progress")).toBe("in_progress");
  });

  it("concluído e encerrado não recebem resposta", () => {
    expect(aceitaResposta("opened")).toBe(true);
    expect(aceitaResposta("completed")).toBe(false);
    expect(aceitaResposta("closed")).toBe(false);
  });
});
