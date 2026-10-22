import { describe, expect, it } from "vitest";

import {
  assuntoDaMensagem,
  corpoPadrao,
  htmlDaMensagem,
  preencherVariaveis,
} from "./mensagens";

describe("preencherVariaveis", () => {
  it("troca nome, empresa e pesquisa, com e sem espaços", () => {
    expect(
      preencherVariaveis("Oi {{nome}} da {{ empresa }}: {{pesquisa}}", {
        nome: "Ana",
        empresa: "Loja X",
        pesquisa: "NPS",
      })
    ).toBe("Oi Ana da Loja X: NPS");
  });

  it("empresa vazia vira 'sua empresa' e nome vazio vira 'parceiro'", () => {
    expect(
      preencherVariaveis("{{nome}} / {{empresa}}", { nome: " ", empresa: null, pesquisa: "x" })
    ).toBe("parceiro / sua empresa");
  });

  it("o texto padrão só usa variáveis conhecidas", () => {
    const sobras = preencherVariaveis(corpoPadrao(), { nome: "A", empresa: "B", pesquisa: "C" });
    expect(sobras).not.toMatch(/\{\{/);
  });
});

describe("mensagem", () => {
  it("lembrete ganha prefixo no assunto e aviso no corpo", () => {
    expect(assuntoDaMensagem("Pesquisa", "reminder")).toBe("Lembrete: Pesquisa");
    expect(assuntoDaMensagem("Pesquisa", "invite")).toBe("Pesquisa");
    const html = htmlDaMensagem({
      corpo: "Oi",
      link: "https://x/pesquisa/t",
      tipo: "reminder",
      nomeDaPesquisa: "NPS",
    });
    expect(html).toContain("ainda não concluiu");
    expect(html).toContain('href="https://x/pesquisa/t"');
  });

  it("escapa HTML do texto e separa parágrafos", () => {
    const html = htmlDaMensagem({
      corpo: "<b>x</b>\n\nsegundo\nlinha",
      link: "https://x/p",
      tipo: "invite",
      nomeDaPesquisa: "N",
    });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("segundo<br>linha");
    expect(html).not.toContain("ainda não concluiu");
  });
});
