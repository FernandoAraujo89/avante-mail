import { beforeAll, describe, expect, it } from "vitest";

import { buildSendComponents, type SendTemplate } from "./variables";

// O que estes testes protegem: o cabeçalho de imagem/PDF só chega ao contato se
// o payload do envio levar o componente "header" com o link do arquivo. Se ele
// faltar (ou vier com caminho relativo), a Cloud API recusa a mensagem inteira
// — o modelo aprovado promete um arquivo que o envio não entrega.

const CONTATO = { name: "Fernando", company: "Avante" };

const BASE: SendTemplate = {
  bodyText: "Olá {{1}}, novidade para a {{2}}.",
  variableExamples: { "1": "Parceiro", "2": "sua empresa" },
  headerType: "none",
  headerMediaUrl: null,
  headerMediaFilename: null,
};

beforeAll(() => {
  process.env.NEXT_PUBLIC_BASE_URL = "https://campanhas.exemplo.com.br";
});

describe("buildSendComponents", () => {
  it("manda a imagem do cabeçalho com link absoluto", () => {
    const components = buildSendComponents({
      template: {
        ...BASE,
        headerType: "image",
        headerMediaUrl: "/uploads/promo-a1b2c3.png",
      },
      variables: { "1": { source: "name" }, "2": { source: "company" } },
      contact: CONTATO,
    });

    expect(components[0]).toEqual({
      type: "header",
      parameters: [
        {
          type: "image",
          image: {
            link: "https://campanhas.exemplo.com.br/uploads/promo-a1b2c3.png",
          },
        },
      ],
    });
  });

  it("manda o PDF com o nome que aparece no card da conversa", () => {
    const [header] = buildSendComponents({
      template: {
        ...BASE,
        headerType: "document",
        headerMediaUrl: "/uploads/proposta-a1b2c3.pdf",
        headerMediaFilename: "Proposta Avante.pdf",
      },
      variables: null,
      contact: CONTATO,
    });

    expect(header).toEqual({
      type: "header",
      parameters: [
        {
          type: "document",
          document: {
            link: "https://campanhas.exemplo.com.br/uploads/proposta-a1b2c3.pdf",
            filename: "Proposta Avante.pdf",
          },
        },
      ],
    });
  });

  it("preserva URL absoluta (arquivo hospedado fora)", () => {
    const [header] = buildSendComponents({
      template: {
        ...BASE,
        headerType: "image",
        headerMediaUrl: "https://cdn.exemplo.com/banner.jpg",
      },
      variables: null,
      contact: CONTATO,
    });

    expect(header).toMatchObject({
      parameters: [{ image: { link: "https://cdn.exemplo.com/banner.jpg" } }],
    });
  });

  it("resolve as variáveis do corpo depois do cabeçalho", () => {
    const components = buildSendComponents({
      template: {
        ...BASE,
        headerType: "image",
        headerMediaUrl: "/uploads/promo-a1b2c3.png",
      },
      variables: { "1": { source: "name" }, "2": { source: "company" } },
      contact: CONTATO,
    });

    // A ordem importa: a Meta casa os componentes pela posição declarada.
    expect(components.map((c) => c.type)).toEqual(["header", "body"]);
    expect(components[1].parameters).toEqual([
      { type: "text", text: "Fernando" },
      { type: "text", text: "Avante" },
    ]);
  });

  it("não inventa cabeçalho para modelo de texto", () => {
    const components = buildSendComponents({
      template: { ...BASE, headerType: "text" },
      variables: { "1": { source: "name" }, "2": { source: "company" } },
      contact: CONTATO,
    });

    expect(components.map((c) => c.type)).toEqual(["body"]);
  });

  it("não manda nada quando o modelo não tem mídia nem variáveis", () => {
    expect(
      buildSendComponents({
        template: { ...BASE, bodyText: "Texto fixo, sem variáveis." },
        variables: null,
        contact: CONTATO,
      })
    ).toEqual([]);
  });

  it("omite o cabeçalho quando a mídia sumiu do modelo", () => {
    // Barrado antes do disparo por missingHeaderMedia; aqui só garantimos que
    // não vai um componente vazio (que a Meta recusaria com outro erro).
    const components = buildSendComponents({
      template: { ...BASE, headerType: "document", headerMediaUrl: null },
      variables: null,
      contact: CONTATO,
    });

    expect(components.map((c) => c.type)).toEqual(["body"]);
  });
});
