import { afterEach, describe, expect, it } from "vitest";

import { isTrustedMediaUrl } from "./client";

// O download da mídia recebida leva o token da Meta no cabeçalho. Um endereço
// fora da Meta receberia o token junto — é isto que a trava impede.

describe("isTrustedMediaUrl", () => {
  afterEach(() => {
    delete process.env.WHATSAPP_GRAPH_BASE_URL;
  });

  it("aceita o endereço de mídia da Meta", () => {
    expect(
      isTrustedMediaUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1")
    ).toBe(true);
  });

  it("recusa outro domínio, inclusive o que só termina parecido", () => {
    expect(isTrustedMediaUrl("https://exemplo.com/arquivo")).toBe(false);
    expect(isTrustedMediaUrl("https://malicioso-fbsbx.com/arquivo")).toBe(false);
  });

  it("recusa http sem TLS e texto que não é endereço", () => {
    expect(isTrustedMediaUrl("http://lookaside.fbsbx.com/x")).toBe(false);
    expect(isTrustedMediaUrl("não é url")).toBe(false);
  });

  it("com a Graph API falsa de teste, só aceita a origem dela", () => {
    process.env.WHATSAPP_GRAPH_BASE_URL = "http://127.0.0.1:4599";
    expect(isTrustedMediaUrl("http://127.0.0.1:4599/media-file/img_1")).toBe(true);
    expect(isTrustedMediaUrl("https://lookaside.fbsbx.com/x")).toBe(false);
  });
});
