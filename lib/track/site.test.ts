import { describe, expect, it } from "vitest";

import { MAX_UTM, utmSegura } from "./site";

describe("utmSegura", () => {
  it("guarda só as cinco chaves conhecidas", () => {
    expect(
      utmSegura({
        source: "ig",
        medium: "bio",
        campaign: "setembro",
        content: "post-1",
        term: "x",
        fbclid: "abc",
        av: "token",
      })
    ).toEqual({
      source: "ig",
      medium: "bio",
      campaign: "setembro",
      content: "post-1",
      term: "x",
    });
  });

  it("sanea cada valor e descarta o vazio", () => {
    expect(utmSegura({ source: "  ig  ", medium: "   " })).toEqual({
      source: "ig",
    });
    expect(utmSegura({ source: "a".repeat(500) })?.source).toHaveLength(MAX_UTM);
  });

  it("valor que não é texto é ignorado", () => {
    expect(utmSegura({ source: 1, medium: { x: 1 }, campaign: null })).toBeNull();
  });

  it("sem UTM nenhuma, nulo — nunca um objeto vazio", () => {
    expect(utmSegura({})).toBeNull();
    expect(utmSegura(undefined)).toBeNull();
    expect(utmSegura(null)).toBeNull();
    expect(utmSegura("ig")).toBeNull();
    expect(utmSegura(["ig"])).toBeNull();
  });
});
