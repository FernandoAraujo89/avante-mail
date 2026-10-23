import { describe, expect, it } from "vitest";

import { fillVariables } from "@/lib/whatsapp/types";

import { linkDaPrevia, PARCEIRO_DE_EXEMPLO, valoresDeExemplo } from "./previa";

describe("pré-visualização do convite", () => {
  it("monta o link da prévia com e sem base", () => {
    expect(linkDaPrevia("abc")).toBe("/pesquisa/previa/abc");
    expect(linkDaPrevia("abc", "https://campanhas.exemplo/")).toBe("https://campanhas.exemplo/pesquisa/previa/abc");
  });

  it("preenche as variáveis do modelo com o parceiro de exemplo e deixa o que falta como {{n}}", () => {
    const valores = valoresDeExemplo({
      "1": { source: "name" },
      "2": { source: "company" },
      "3": { source: "static", value: "  Fase 2 " },
      "4": { source: "static", value: "" },
    });
    expect(valores).toEqual({ "1": PARCEIRO_DE_EXEMPLO.name, "2": PARCEIRO_DE_EXEMPLO.company, "3": "Fase 2" });
    expect(fillVariables("Olá {{1}} da {{2}} — {{3}} {{4}} {{5}}", valores)).toBe(
      "Olá Nome do parceiro da Empresa do parceiro — Fase 2 {{4}} {{5}}"
    );
  });

  it("parceiro sem empresa vira 'sua empresa', como no e-mail", () => {
    expect(valoresDeExemplo({ "1": { source: "company" } }, { name: "Ana", company: null })).toEqual({ "1": "sua empresa" });
  });
});
