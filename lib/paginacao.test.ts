import { describe, expect, it } from "vitest";

import {
  botoesDePagina,
  gravarPreferencia,
  LINHAS_PADRAO,
  lerLinhas,
  lerPagina,
  lerPreferencias,
  paginaDoItem,
  recortar,
  valorDoCookie,
} from "./paginacao";

// Página e tamanho chegam da URL e de cookie — entrada que qualquer um edita.
// Estes testes travam os jeitos conhecidos de a lista aparecer vazia, cortada
// ou com um tamanho que a tela não oferece.

describe("lerLinhas", () => {
  it("aceita só as opções da tela", () => {
    expect(lerLinhas("20")).toBe(20);
    expect(lerLinhas(50)).toBe(50);
    expect(lerLinhas("200")).toBe(200);
    expect(lerLinhas("30")).toBeNull();
    expect(lerLinhas("100000")).toBeNull();
  });

  it("recusa vazio, lixo e lista de valores da URL", () => {
    expect(lerLinhas("")).toBeNull();
    expect(lerLinhas("abc")).toBeNull();
    expect(lerLinhas(undefined)).toBeNull();
    expect(lerLinhas(["50", "100"])).toBeNull();
  });
});

describe("lerPagina", () => {
  it("usa o número pedido", () => {
    expect(lerPagina("3")).toBe(3);
  });

  it("qualquer coisa fora de um inteiro positivo vira a primeira página", () => {
    expect(lerPagina(undefined)).toBe(1);
    expect(lerPagina("")).toBe(1);
    expect(lerPagina("0")).toBe(1);
    expect(lerPagina("-2")).toBe(1);
    expect(lerPagina("2.5")).toBe(1);
    expect(lerPagina("dois")).toBe(1);
    expect(lerPagina("99999999999999999999")).toBe(1);
  });
});

describe("recortar", () => {
  it("fatia a página do meio", () => {
    expect(recortar(45, 2, 20)).toEqual({
      pagina: 2,
      totalPaginas: 3,
      inicio: 20,
      fim: 40,
    });
  });

  it("a última página vem só com o que sobra", () => {
    expect(recortar(45, 3, 20)).toMatchObject({ inicio: 40, fim: 45 });
  });

  it("página além do fim volta para a última que existe", () => {
    // Excluir o último contato da última página não pode deixar a tela vazia.
    expect(recortar(40, 3, 20)).toMatchObject({ pagina: 2, inicio: 20, fim: 40 });
  });

  it("lista vazia tem uma página, sem itens", () => {
    expect(recortar(0, 5, 20)).toEqual({
      pagina: 1,
      totalPaginas: 1,
      inicio: 0,
      fim: 0,
    });
  });
});

describe("paginaDoItem", () => {
  it("trocar o tamanho mantém à vista o primeiro item que se via", () => {
    // Via do 41º ao 60º (índice 40) com 20 por página; com 50, o 41º está na 1ª.
    expect(paginaDoItem(40, 50)).toBe(1);
    expect(paginaDoItem(40, 20)).toBe(3);
    expect(paginaDoItem(250, 100)).toBe(3);
    expect(paginaDoItem(0, 200)).toBe(1);
  });
});

describe("botoesDePagina", () => {
  it("até 7 páginas mostra todas", () => {
    expect(botoesDePagina(1, 1)).toEqual([1]);
    expect(botoesDePagina(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("no começo, reticências só antes da última", () => {
    expect(botoesDePagina(2, 77)).toEqual([1, 2, 3, 4, 5, "reticencias-fim", 77]);
  });

  it("no meio, a atual com as vizinhas entre reticências", () => {
    expect(botoesDePagina(40, 77)).toEqual([
      1,
      "reticencias-inicio",
      39,
      40,
      41,
      "reticencias-fim",
      77,
    ]);
  });

  it("no fim, reticências só depois da primeira", () => {
    expect(botoesDePagina(76, 77)).toEqual([
      1,
      "reticencias-inicio",
      73,
      74,
      75,
      76,
      77,
    ]);
  });

  it("passando de 7 páginas são sempre 7 posições", () => {
    for (let pagina = 1; pagina <= 30; pagina++) {
      expect(botoesDePagina(pagina, 30)).toHaveLength(7);
    }
  });
});

describe("valorDoCookie", () => {
  it("acha o cookie pelo nome exato", () => {
    const cabecalho =
      "avante_session=abc; linhas-por-pagina=contatos:50|leads:100; x=1";
    expect(valorDoCookie(cabecalho, "linhas-por-pagina")).toBe(
      "contatos:50|leads:100"
    );
    expect(valorDoCookie(cabecalho, "linhas")).toBeUndefined();
    expect(valorDoCookie("", "linhas-por-pagina")).toBeUndefined();
  });
});

describe("preferências no cookie", () => {
  it("lê cada lista e ignora o que não é uma opção da tela", () => {
    expect(lerPreferencias("contatos:50|leads:100|campanhas:33|:20|x")).toEqual({
      contatos: 50,
      leads: 100,
    });
    expect(lerPreferencias(undefined)).toEqual({});
  });

  it("lê o valor mesmo codificado", () => {
    expect(lerPreferencias("contatos%3A50%7Cleads%3A200")).toEqual({
      contatos: 50,
      leads: 200,
    });
  });

  it("grava sem perder a escolha das outras listas", () => {
    expect(gravarPreferencia("contatos:50", "leads", 100)).toBe(
      "contatos:50|leads:100"
    );
    expect(gravarPreferencia("contatos:50|leads:100", "contatos", 200)).toBe(
      "contatos:200|leads:100"
    );
  });

  it("voltar ao padrão tira a lista do cookie", () => {
    expect(gravarPreferencia("contatos:50|leads:100", "leads", LINHAS_PADRAO)).toBe(
      "contatos:50"
    );
    expect(gravarPreferencia("contatos:50", "contatos", LINHAS_PADRAO)).toBe("");
  });
});
