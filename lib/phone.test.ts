import { describe, expect, it } from "vitest";

import {
  METADADOS_TELEFONE,
  firstValidPhone,
  formatPhone,
  normalizePhone,
} from "./phone";

// O Vitest carrega a biblioteca do jeito certo mesmo pela entrada padrão; o
// que quebrava era o tsx dos workers. A garantia de lá está em
// scripts/testar-sync-funis.ts, que roda sob tsx. Aqui fica o comportamento.

describe("tabela de números", () => {
  it("chega desembrulhada, com os países", () => {
    expect(METADADOS_TELEFONE).toHaveProperty("countries");
    expect(METADADOS_TELEFONE).not.toHaveProperty("default");
  });
});

describe("normalizePhone", () => {
  it("põe o DDI do Brasil em quem veio sem", () => {
    expect(normalizePhone("(37) 99947-2264")).toBe("+5537999472264");
    expect(normalizePhone("37999472264")).toBe("+5537999472264");
    expect(normalizePhone("+55 37 99947 2264")).toBe("+5537999472264");
  });

  it("recusa o que não é telefone", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone(42)).toBeNull();
  });
});

describe("firstValidPhone", () => {
  it("pega o primeiro válido de um campo com vários", () => {
    expect(firstValidPhone("abc / 37 99947-2264, 31 3241-0000")).toBe(
      "+5537999472264"
    );
  });
});

describe("formatPhone", () => {
  it("formata para leitura", () => {
    expect(formatPhone("+5537999472264")).toBe("+55 37 99947 2264");
    expect(formatPhone(null)).toBe("");
  });
});
