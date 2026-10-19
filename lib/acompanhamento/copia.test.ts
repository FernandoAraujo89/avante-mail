import { describe, expect, it } from "vitest";

import {
  assuntoDaCopia,
  corpoComVariaveis,
  faixaDeAcompanhamento,
  htmlDaCopiaWhatsApp,
  inserirFaixa,
  lerEmailsDeAcompanhamento,
  quemRecebeCopia,
} from "./copia";

// A cópia de acompanhamento: a lista que a tela salva, quem recebe de fato e
// o HTML que chega aos líderes.

describe("lerEmailsDeAcompanhamento", () => {
  it("aceita um por linha, vírgula ou ponto e vírgula, e normaliza", () => {
    expect(
      lerEmailsDeAcompanhamento(
        " Fernando@Avantejuntos.com.br\nrh@avantejuntos.com.br, rh@avantejuntos.com.br;karina@avantejuntos.com.br "
      )
    ).toEqual({
      emails: [
        "fernando@avantejuntos.com.br",
        "rh@avantejuntos.com.br",
        "karina@avantejuntos.com.br",
      ],
      invalidos: [],
    });
  });

  it("aponta o que não é e-mail, em vez de descartar calado", () => {
    expect(
      lerEmailsDeAcompanhamento("raul@avantejuntos.com.br\nthiago@avantejuntos")
    ).toEqual({
      emails: ["raul@avantejuntos.com.br"],
      invalidos: ["thiago@avantejuntos"],
    });
  });

  it("lê também o array guardado em app_settings", () => {
    expect(lerEmailsDeAcompanhamento(["a@x.com", "A@x.com"]).emails).toEqual([
      "a@x.com",
    ]);
    expect(lerEmailsDeAcompanhamento(null).emails).toEqual([]);
  });
});

describe("quemRecebeCopia", () => {
  it("tira quem já é destinatário real da campanha de e-mail", () => {
    expect(
      quemRecebeCopia(
        ["fernando@avantejuntos.com.br", "rh@avantejuntos.com.br"],
        ["RH@avantejuntos.com.br", "parceiro@loja.com.br"]
      )
    ).toEqual(["fernando@avantejuntos.com.br"]);
  });

  it("no WhatsApp e no SMS todos recebem", () => {
    expect(quemRecebeCopia(["a@x.com", "b@x.com"])).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
  });
});

const resumo = {
  canal: "email" as const,
  nomeDaCampanha: "Convite <live>",
  mensagens: 1234,
  contatos: 1200,
  quando: "19/10/2026, 14:00",
  autor: "Fernando Araújo",
  listas: "Parceiros WHITE LABEL",
  relatorioUrl: "https://campanhas.avantetools.com.br/campaigns/abc/report",
};

describe("faixaDeAcompanhamento", () => {
  it("diz de que campanha é, para quantos, quando e quem — escapado", () => {
    const faixa = faixaDeAcompanhamento(resumo);
    expect(faixa).toContain("Cópia de acompanhamento");
    expect(faixa).toContain("Convite &lt;live&gt;");
    expect(faixa).toContain("1.234 e-mails para 1.200 contatos");
    expect(faixa).toContain("por Fernando Araújo");
    expect(faixa).toContain("/campaigns/abc/report");
    expect(faixa).not.toContain("<live>");
  });

  it("conta no singular quando é um só", () => {
    const faixa = faixaDeAcompanhamento({
      ...resumo,
      canal: "whatsapp",
      mensagens: 1,
      contatos: 1,
    });
    expect(faixa).toContain("1 mensagem para 1 contato");
  });
});

describe("inserirFaixa", () => {
  it("põe a faixa logo depois da abertura do corpo", () => {
    expect(
      inserirFaixa('<html><body style="x"><p>oi</p></body></html>', "[F]")
    ).toBe('<html><body style="x">[F]<p>oi</p></body></html>');
  });

  it("sem <body>, põe no começo", () => {
    expect(inserirFaixa("<p>oi</p>", "[F]")).toBe("[F]<p>oi</p>");
  });
});

describe("cópia de WhatsApp", () => {
  it("o que muda por contato vira colchete; o fixo vai como está", () => {
    expect(
      corpoComVariaveis("Olá {{1}}! Condição para a {{2}} até {{3}}.", {
        "1": { source: "name" },
        "2": { source: "company" },
        "3": { source: "static", value: "sexta" },
      })
    ).toBe(
      "Olá [nome do contato]! Condição para a [empresa do contato] até sexta."
    );
  });

  it("desenha cabeçalho, corpo, rodapé e botões, escapando o texto", () => {
    const html = htmlDaCopiaWhatsApp(
      "[F]",
      {
        name: "promo_julho",
        category: "MARKETING",
        headerType: "image",
        headerText: null,
        headerMediaUrl: "https://campanhas.avantetools.com.br/uploads/a.png",
        headerMediaFilename: null,
        bodyText: "",
        footerText: "Responda SAIR",
        buttons: [{ type: "QUICK_REPLY", text: "Quero <saber>" }],
      },
      "Linha 1\nLinha 2"
    );
    expect(html).toContain("[F]");
    expect(html).toContain(
      'src="https://campanhas.avantetools.com.br/uploads/a.png"'
    );
    expect(html).toContain("Linha 1<br />Linha 2");
    expect(html).toContain("Responda SAIR");
    expect(html).toContain("Quero &lt;saber&gt;");
    expect(html).toContain("promo_julho");
  });
});

describe("assuntoDaCopia", () => {
  it("e-mail leva o assunto; WhatsApp e SMS, o nome da campanha", () => {
    const c = { name: "Live 22/10", subject: "Você está convidado" };
    expect(assuntoDaCopia("email", c)).toBe("[Cópia] Você está convidado");
    expect(assuntoDaCopia("whatsapp", c)).toBe("[Cópia · WhatsApp] Live 22/10");
    expect(assuntoDaCopia("sms", c)).toBe("[Cópia · SMS] Live 22/10");
  });
});
