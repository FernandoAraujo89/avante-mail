import { describe, expect, it } from "vitest";

import { modeloTemLinkDinamico, prontidaoDoWhatsApp } from "./whatsapp";

const modelo = (status: "approved" | "pending", url: string) => ({
  name: "pesquisa_convite",
  status,
  buttons: [{ type: "URL" as const, text: "Responder", url }],
});

describe("prontidaoDoWhatsApp", () => {
  it("exige modelo aprovado, com link dinâmico, e a linha configurada", () => {
    expect(prontidaoDoWhatsApp(null, true).pronto).toBe(false);
    expect(prontidaoDoWhatsApp(modelo("pending", "https://x/p/{{1}}"), true).motivo).toMatch(/aprovado/);
    expect(prontidaoDoWhatsApp(modelo("approved", "https://x/p"), true).motivo).toMatch(/\{\{1\}\}/);
    expect(prontidaoDoWhatsApp(modelo("approved", "https://x/p/{{1}}"), false).motivo).toMatch(/Expansão/);
    expect(prontidaoDoWhatsApp(modelo("approved", "https://x/p/{{1}}"), true)).toEqual({ pronto: true, motivo: null });
  });

  it("reconhece o botão dinâmico", () => {
    expect(modeloTemLinkDinamico([{ type: "QUICK_REPLY", text: "Sim" }])).toBe(false);
    expect(modeloTemLinkDinamico(modelo("approved", "https://x/p/{{1}}").buttons)).toBe(true);
    expect(modeloTemLinkDinamico(null)).toBe(false);
  });
});
