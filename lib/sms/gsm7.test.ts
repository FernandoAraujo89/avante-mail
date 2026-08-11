import { describe, expect, it } from "vitest";

import { countSms, estimateSmsCostUsd, sanitizeGsm7 } from "./gsm7";
import { SMS_BRAZIL_PRICE_PER_SEGMENT_USD } from "./types";

describe("sanitizeGsm7 — transliteração", () => {
  it("remove os acentos do português", () => {
    const r = sanitizeGsm7("Promoção de inscrição até amanhã, não perca!");
    expect(r.texto).toBe("Promocao de inscricao ate amanha, nao perca!");
    expect(r.ok).toBe(true);
  });

  it("cobre as vogais acentuadas e o ç maiúsculo", () => {
    expect(sanitizeGsm7("ÁÀÂÃÉÊÍÓÔÕÚÜÇ áàâãéêíóôõúüç").texto).toBe(
      "AAAAEEIOOOUUC aaaaeeiooouuc"
    );
  });

  it("normaliza aspas e travessões colados do Word", () => {
    // Estes são os campeões de mensagem que vira UCS-2 sem ninguém entender.
    const r = sanitizeGsm7("Ele disse “sim” — e o resto…");
    expect(r.texto).toBe('Ele disse "sim" - e o resto...');
    expect(r.ok).toBe(true);
  });

  it("troca espaço não separável por espaço comum", () => {
    const r = sanitizeGsm7("R$ 10,00");
    expect(r.texto).toBe("R$ 10,00");
    expect(r.ok).toBe(true);
  });

  it("apaga caracteres de largura zero", () => {
    const r = sanitizeGsm7("PA​RAR");
    expect(r.texto).toBe("PARAR");
  });

  it("deixa passar texto que já é GSM-7", () => {
    const texto = "Responda PARAR para nao receber";
    expect(sanitizeGsm7(texto).texto).toBe(texto);
  });
});

describe("sanitizeGsm7 — bloqueios", () => {
  it("denuncia emoji em vez de apagar em silêncio", () => {
    const r = sanitizeGsm7("Oferta 🔥 imperdível");
    expect(r.emojis).toEqual(["🔥"]);
    expect(r.ok).toBe(false);
    // O texto sai sem o emoji, mas o envio fica bloqueado até a pessoa decidir.
    expect(r.texto).toBe("Oferta  imperdivel");
  });

  it("não repete o mesmo emoji na denúncia", () => {
    expect(sanitizeGsm7("🔥🔥🔥 promo 🎁").emojis).toEqual(["🔥", "🎁"]);
  });

  it("relata caractere fora do GSM-7 que não é emoji", () => {
    const r = sanitizeGsm7("preço 中");
    expect(r.emojis).toEqual([]);
    expect(r.foraDoGsm7).toEqual(["中"]);
    expect(r.ok).toBe(false);
  });

  it("aceita entrada vazia sem quebrar", () => {
    expect(sanitizeGsm7("")).toEqual({
      texto: "",
      emojis: [],
      foraDoGsm7: [],
      ok: true,
    });
  });
});

describe("countSms — segmentos em GSM-7", () => {
  it("160 caracteres cabem em um segmento", () => {
    const r = countSms("a".repeat(160));
    expect(r).toMatchObject({ segmentos: 1, unidades: 160, encoding: "gsm7" });
    expect(r.restante).toBe(0);
  });

  it("161 caracteres passam a contar 153 por segmento", () => {
    // O cabeçalho de concatenação come 7 septetos de cada parte.
    expect(countSms("a".repeat(161))).toMatchObject({
      segmentos: 2,
      limiteDoSegmento: 153,
    });
  });

  it("306 caracteres ainda são 2 segmentos; 307 viram 3", () => {
    expect(countSms("a".repeat(306)).segmentos).toBe(2);
    expect(countSms("a".repeat(307)).segmentos).toBe(3);
  });

  it("caractere da tabela de extensão custa 2 septetos", () => {
    expect(countSms("€").unidades).toBe(2);
    expect(countSms("[x]").unidades).toBe(5);
    // 80 colchetes = 160 septetos = ainda 1 segmento, no limite.
    expect(countSms("[".repeat(80)).segmentos).toBe(1);
    expect(countSms("[".repeat(81)).segmentos).toBe(2);
  });

  it("texto vazio não tem segmento", () => {
    expect(countSms("")).toMatchObject({ segmentos: 0, unidades: 0 });
  });
});

describe("countSms — quando cai para UCS-2", () => {
  it("um único emoji derruba a mensagem inteira para 70 por segmento", () => {
    // Este é o teste que justifica o sanitizador existir.
    const texto = "a".repeat(150);
    expect(countSms(texto).segmentos).toBe(1);
    expect(countSms(`${texto}🔥`)).toMatchObject({
      encoding: "ucs2",
      segmentos: 3,
    });
  });

  it("emoji fora do BMP conta 2 unidades UTF-16", () => {
    expect(countSms("🔥")).toMatchObject({
      caracteres: 1,
      unidades: 2,
      encoding: "ucs2",
      segmentos: 1,
    });
  });

  it("70 unidades cabem em um segmento UCS-2; 71 viram dois", () => {
    expect(countSms(`中${"a".repeat(69)}`).segmentos).toBe(1);
    expect(countSms(`中${"a".repeat(70)}`).segmentos).toBe(2);
  });
});

describe("estimateSmsCostUsd", () => {
  it("multiplica segmentos por destinatários", () => {
    expect(estimateSmsCostUsd(2, 1000)).toBeCloseTo(
      2 * 1000 * SMS_BRAZIL_PRICE_PER_SEGMENT_USD,
      6
    );
  });

  it("um segmento para um destinatário é a tarifa cheia", () => {
    expect(estimateSmsCostUsd(1)).toBeCloseTo(0.0599, 6);
  });

  it("aceita preço diferente do padrão", () => {
    expect(estimateSmsCostUsd(3, 10, 0.05)).toBeCloseTo(1.5, 6);
  });

  it("não cobra por nada", () => {
    expect(estimateSmsCostUsd(0, 1000)).toBe(0);
    expect(estimateSmsCostUsd(2, 0)).toBe(0);
  });
});
