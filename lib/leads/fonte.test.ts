import { describe, expect, it } from "vitest";

import { fonteDe, fonteDoReferrer, fonteDoUtm, rotuloDaFonte } from "./fonte";

describe("fonteDoUtm", () => {
  it("reconhece as grafias comuns do Instagram e do Facebook", () => {
    for (const v of ["instagram", "Instagram", "IG", "insta", "instagram_bio", "ig-stories"]) {
      expect(fonteDoUtm(v), v).toBe("instagram");
    }
    for (const v of ["facebook", "FB", "fb_ads", "Facebook Ads", "messenger", "msg"]) {
      expect(fonteDoUtm(v), v).toBe("facebook");
    }
  });

  it("aceita o que o Meta Ads manda em {{site_source_name}}", () => {
    expect(fonteDoUtm("ig")).toBe("instagram");
    expect(fonteDoUtm("fb")).toBe("facebook");
    expect(fonteDoUtm("msg")).toBe("facebook");
    // Audience Network não é uma rede que a pessoa "visita": fica sem fonte.
    expect(fonteDoUtm("an")).toBeNull();
  });

  it("aceita um domínio escrito no utm_source", () => {
    expect(fonteDoUtm("l.instagram.com")).toBe("instagram");
    expect(fonteDoUtm("lm.facebook.com")).toBe("facebook");
  });

  it("apelidos curtos só valem como valor inteiro", () => {
    expect(fonteDoUtm("li")).toBe("linkedin");
    expect(fonteDoUtm("wa")).toBe("whatsapp");
    expect(fonteDoUtm("li-post")).toBeNull();
    expect(fonteDoUtm("wa-campanha")).toBeNull();
  });

  it("reconhece as outras redes e o nome colado em outra palavra", () => {
    expect(fonteDoUtm("tiktok")).toBe("tiktok");
    expect(fonteDoUtm("LinkedIn")).toBe("linkedin");
    expect(fonteDoUtm("yt")).toBe("youtube");
    expect(fonteDoUtm("google")).toBe("google");
    expect(fonteDoUtm("adwords")).toBe("google");
    expect(fonteDoUtm("WhatsApp")).toBe("whatsapp");
    expect(fonteDoUtm("instagramstories")).toBe("instagram");
    expect(fonteDoUtm("facebookads")).toBe("facebook");
    // Sigla colada em outra palavra é ambígua demais: não é reconhecida.
    expect(fonteDoUtm("IGShopping")).toBeNull();
  });

  it("canal escrito à mão que não é rede fica sem fonte", () => {
    for (const v of ["site", "Indicação", "newsletter", "", "   ", "e-mail"]) {
      expect(fonteDoUtm(v), JSON.stringify(v)).toBeNull();
    }
    expect(fonteDoUtm(null)).toBeNull();
    expect(fonteDoUtm(undefined)).toBeNull();
  });
});

describe("fonteDoReferrer", () => {
  it("casa o host por sufixo de domínio", () => {
    expect(fonteDoReferrer("l.instagram.com")).toBe("instagram");
    expect(fonteDoReferrer("www.instagram.com")).toBe("instagram");
    expect(fonteDoReferrer("l.facebook.com")).toBe("facebook");
    expect(fonteDoReferrer("lm.facebook.com")).toBe("facebook");
    expect(fonteDoReferrer("m.facebook.com")).toBe("facebook");
    expect(fonteDoReferrer("www.tiktok.com")).toBe("tiktok");
    expect(fonteDoReferrer("lnkd.in")).toBe("linkedin");
    expect(fonteDoReferrer("youtu.be")).toBe("youtube");
    expect(fonteDoReferrer("wa.me")).toBe("whatsapp");
  });

  it("não cai em sufixo enganoso", () => {
    expect(fonteDoReferrer("notinstagram.com")).toBeNull();
    expect(fonteDoReferrer("facebook.com.evil.com")).toBeNull();
  });

  it("aceita a URL inteira, com porta, caminho e query", () => {
    expect(fonteDoReferrer("https://l.instagram.com/?u=x")).toBe("instagram");
    expect(fonteDoReferrer("https://www.facebook.com:443/page")).toBe("facebook");
    expect(fonteDoReferrer("HTTPS://WWW.INSTAGRAM.COM/")).toBe("instagram");
  });

  it("o Google varia o TLD por país", () => {
    expect(fonteDoReferrer("www.google.com")).toBe("google");
    expect(fonteDoReferrer("www.google.com.br")).toBe("google");
    expect(fonteDoReferrer("google.pt")).toBe("google");
    expect(fonteDoReferrer("googleusercontent.com")).toBeNull();
  });

  it("nosso próprio site e lixo ficam sem fonte", () => {
    expect(fonteDoReferrer("avantejuntos.com.br")).toBeNull();
    expect(fonteDoReferrer("")).toBeNull();
    expect(fonteDoReferrer(null)).toBeNull();
    expect(fonteDoReferrer("javascript://x")).toBeNull();
  });
});

describe("fonteDe", () => {
  it("a UTM vence o referrer", () => {
    expect(fonteDe("facebook", "l.instagram.com")).toBe("facebook");
  });

  it("sem UTM, o referrer responde", () => {
    expect(fonteDe(null, "l.instagram.com")).toBe("instagram");
    expect(fonteDe("site", "l.instagram.com")).toBe("instagram");
  });

  it("sem pista nenhuma, nulo", () => {
    expect(fonteDe(null, null)).toBeNull();
    expect(fonteDe("newsletter", "avantejuntos.com.br")).toBeNull();
  });
});

describe("rotuloDaFonte", () => {
  it("traduz a chave para o nome da rede", () => {
    expect(rotuloDaFonte("instagram")).toBe("Instagram");
    expect(rotuloDaFonte("linkedin")).toBe("LinkedIn");
    expect(rotuloDaFonte("desconhecida")).toBe("desconhecida");
  });
});
