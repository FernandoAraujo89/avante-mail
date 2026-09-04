import { describe, expect, it } from "vitest";

import { ehHostProprio, primeiroToque } from "./primeiro-toque";

const NOSSOS = ["avantejuntos.com.br", "www.avantejuntos.com.br"];

function visita(
  dia: number,
  payload: Record<string, unknown>,
  type = "site_visited"
) {
  return { type, payload: { sessao: `s${dia}`, path: "/", ...payload }, createdAt: new Date(2026, 8, dia) };
}

describe("ehHostProprio", () => {
  it("casa o host exato, o apex sem www e os subdomínios", () => {
    expect(ehHostProprio("www.avantejuntos.com.br", NOSSOS)).toBe(true);
    expect(ehHostProprio("avantejuntos.com.br", NOSSOS)).toBe(true);
    expect(ehHostProprio("blog.avantejuntos.com.br", NOSSOS)).toBe(true);
    expect(ehHostProprio("BLOG.AVANTEJUNTOS.COM.BR", NOSSOS)).toBe(true);
  });

  it("não cai em sufixo enganoso nem em lista vazia", () => {
    expect(ehHostProprio("notavantejuntos.com.br", NOSSOS)).toBe(false);
    expect(ehHostProprio("avantejuntos.com.br.evil.com", NOSSOS)).toBe(false);
    expect(ehHostProprio("avantejuntos.com.br", [])).toBe(false);
    expect(ehHostProprio("x.com", ["www."])).toBe(false);
  });
});

describe("primeiroToque", () => {
  it("sem visita com pista, nulo", () => {
    expect(primeiroToque([], NOSSOS)).toBeNull();
    expect(primeiroToque([visita(1, {})], NOSSOS)).toBeNull();
    expect(
      primeiroToque([visita(1, { refHost: "www.avantejuntos.com.br" })], NOSSOS)
    ).toBeNull();
  });

  it("pula a visita direta e pega a primeira com pista", () => {
    const toque = primeiroToque(
      [
        visita(1, {}),
        visita(2, { refHost: "l.instagram.com", fonte: "instagram", path: "/produtos" }),
        visita(3, { refHost: "www.google.com", fonte: "google" }),
      ],
      NOSSOS
    );
    expect(toque).toMatchObject({
      fonte: "instagram",
      refHost: "l.instagram.com",
      utm: null,
      path: "/produtos",
    });
    expect(toque?.quando).toEqual(new Date(2026, 8, 2));
  });

  it("ordena por data, não pela ordem do array", () => {
    const toque = primeiroToque(
      [
        visita(9, { refHost: "www.google.com", fonte: "google" }),
        visita(2, { utm: { source: "ig", medium: "bio" }, fonte: "instagram" }),
      ],
      NOSSOS
    );
    expect(toque?.fonte).toBe("instagram");
    expect(toque?.utm).toEqual({ source: "ig", medium: "bio" });
  });

  it("o referrer nosso não é pista, mas a UTM da mesma visita é", () => {
    const toque = primeiroToque(
      [visita(1, { refHost: "blog.avantejuntos.com.br", utm: { source: "newsletter" } })],
      NOSSOS
    );
    expect(toque).toMatchObject({ refHost: null, fonte: null, utm: { source: "newsletter" } });
  });

  it("visita de antes da fase E.3, sem fonte gravada, deriva do referrer", () => {
    const toque = primeiroToque([visita(1, { refHost: "lm.facebook.com" })], NOSSOS);
    expect(toque?.fonte).toBe("facebook");
  });

  it("referrer de fora sem rede conhecida vale como pista, sem fonte", () => {
    const toque = primeiroToque([visita(1, { refHost: "linktr.ee" })], NOSSOS);
    expect(toque).toMatchObject({ refHost: "linktr.ee", fonte: null });
  });

  it("fonte gravada vence o recálculo, e lixo no campo é ignorado", () => {
    expect(
      primeiroToque([visita(1, { refHost: "www.google.com", fonte: "instagram" })], NOSSOS)
        ?.fonte
    ).toBe("instagram");
    expect(
      primeiroToque([visita(1, { refHost: "www.google.com", fonte: "marte" })], NOSSOS)?.fonte
    ).toBe("google");
  });

  it("ignora evento nomeado e UTM malformada", () => {
    expect(
      primeiroToque([visita(1, { refHost: "l.instagram.com" }, "site_event")], NOSSOS)
    ).toBeNull();
    expect(primeiroToque([visita(1, { utm: "ig" })], NOSSOS)).toBeNull();
    expect(primeiroToque([visita(1, { utm: { source: "" } })], NOSSOS)).toBeNull();
  });
});
