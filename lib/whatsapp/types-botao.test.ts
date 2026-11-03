import { describe, expect, it } from "vitest";

import {
  dynamicUrlButtonIndex,
  isDynamicUrl,
  trackedLinkMetaUrl,
  trackedUrlButtonIndex,
} from "./types";

describe("botão de link dinâmico", () => {
  it("só {{1}} no fim conta", () => {
    expect(isDynamicUrl("https://x.com/pesquisa/{{1}}")).toBe(true);
    expect(isDynamicUrl("https://x.com/pesquisa/{{1}} ")).toBe(true);
    expect(isDynamicUrl("https://x.com/{{1}}/pesquisa")).toBe(false);
    expect(isDynamicUrl("https://x.com/pesquisa")).toBe(false);
  });

  it("acha o índice do botão dinâmico entre os botões", () => {
    expect(
      dynamicUrlButtonIndex([
        { type: "QUICK_REPLY", text: "Sim" },
        { type: "URL", text: "Site", url: "https://x.com" },
        { type: "URL", text: "Responder", url: "https://x.com/p/{{1}}" },
      ])
    ).toBe(2);
    expect(dynamicUrlButtonIndex([{ type: "URL", text: "Site", url: "https://x.com" }])).toBeNull();
    expect(dynamicUrlButtonIndex(null)).toBeNull();
  });
});

describe("botão de link rastreado", () => {
  it("acha o botão rastreado, e o dinâmico continua sendo outro", () => {
    const botoes = [
      { type: "URL" as const, text: "Site", url: "https://avante.com/news", tracked: true },
      { type: "URL" as const, text: "Responder", url: "https://x.com/p/{{1}}" },
    ];
    expect(trackedUrlButtonIndex(botoes)).toBe(0);
    expect(dynamicUrlButtonIndex(botoes)).toBe(1);
    expect(trackedUrlButtonIndex([{ type: "URL", text: "Site", url: "https://x.com" }])).toBeNull();
    expect(trackedUrlButtonIndex(null)).toBeNull();
  });

  it("na Meta o botão rastreado vira o link da plataforma com o fim variável", () => {
    expect(trackedLinkMetaUrl("https://campanhas.avantetools.com.br/")).toBe(
      "https://campanhas.avantetools.com.br/api/track/l/{{1}}"
    );
  });
});
