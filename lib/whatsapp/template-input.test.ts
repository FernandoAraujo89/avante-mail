import { describe, expect, it } from "vitest";

describe("botão de link dinâmico no modelo", () => {
  it("aceita {{1}} só no fim da URL e guarda o exemplo", async () => {
    const { parseTemplateInput } = await import("./template-input");
    const base = { name: "pesquisa_convite", category: "UTILITY", bodyText: "Oi {{1}}, responda a pesquisa.", variableExamples: { "1": "Ana" } };
    const ok = parseTemplateInput({
      ...base,
      buttons: [{ type: "URL", text: "Responder", url: "https://x.com/pesquisa/{{1}}", example: "abc123" }],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.buttons?.[0]).toEqual({ type: "URL", text: "Responder", url: "https://x.com/pesquisa/{{1}}", example: "abc123" });
    }
    const errado = parseTemplateInput({
      ...base,
      buttons: [{ type: "URL", text: "Responder", url: "https://x.com/{{1}}/pesquisa" }],
    });
    expect(errado.ok).toBe(false);
  });
});

describe("botão de link rastreado no modelo", () => {
  const base = { name: "avante_news", category: "MARKETING", bodyText: "Saiu a edição nova." };

  it("guarda a marca de rastreio, e só nela", async () => {
    const { parseTemplateInput } = await import("./template-input");
    const ok = parseTemplateInput({
      ...base,
      buttons: [
        { type: "URL", text: "Ler", url: "https://avante.com/news", tracked: true },
        { type: "URL", text: "Site", url: "https://avante.com", tracked: false },
      ],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.buttons).toEqual([
        { type: "URL", text: "Ler", url: "https://avante.com/news", tracked: true },
        { type: "URL", text: "Site", url: "https://avante.com" },
      ]);
    }
  });

  it("rastreado não pode ser dinâmico, e só um por modelo", async () => {
    const { parseTemplateInput } = await import("./template-input");
    const dinamico = parseTemplateInput({
      ...base,
      buttons: [{ type: "URL", text: "Ler", url: "https://avante.com/{{1}}", tracked: true }],
    });
    expect(dinamico.ok).toBe(false);
    const dois = parseTemplateInput({
      ...base,
      buttons: [
        { type: "URL", text: "Ler", url: "https://avante.com/news", tracked: true },
        { type: "URL", text: "Site", url: "https://avante.com", tracked: true },
      ],
    });
    expect(dois.ok).toBe(false);
  });
});
