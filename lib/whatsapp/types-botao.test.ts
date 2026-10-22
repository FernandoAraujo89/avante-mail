import { describe, expect, it } from "vitest";

import { dynamicUrlButtonIndex, isDynamicUrl } from "./types";

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
