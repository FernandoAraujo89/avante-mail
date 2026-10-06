import { describe, expect, it } from "vitest";

import { chaveDeNome, decidir, indexar, indiceVazio } from "./casamento";

// A planilha do Sucesso do cliente traz nome e telefone, às vezes e-mail. O
// que estes testes protegem é a ordem das regras e os dois casos em que o
// sistema NÃO pode decidir sozinho: nome repetido e endereços de contatos
// diferentes na mesma linha.

function base() {
  const indice = indiceVazio();
  indexar(indice, {
    id: "ana",
    nome: "Ana Souza",
    emails: ["ana@x.com"],
    telefones: ["+5548999990001"],
    porNome: true,
  });
  indexar(indice, {
    id: "bruno",
    nome: "Bruno Lima",
    emails: ["bruno@x.com"],
    telefones: [],
    porNome: true,
  });
  // Dois "Carlos Silva": o nome sozinho não identifica.
  indexar(indice, {
    id: "carlos1",
    nome: "Carlos Silva",
    emails: ["c1@x.com"],
    telefones: [],
    porNome: true,
  });
  indexar(indice, {
    id: "carlos2",
    nome: "Carlos  Silva ",
    emails: ["c2@x.com"],
    telefones: [],
    porNome: true,
  });
  // Lead: casa por e-mail/telefone, nunca pelo nome.
  indexar(indice, {
    id: "lead",
    nome: "Dora Reis",
    emails: ["dora@x.com"],
    telefones: ["+5548999990009"],
    porNome: false,
  });
  return indice;
}

describe("chaveDeNome", () => {
  it("ignora acento, caixa e espaço a mais — e só isso", () => {
    expect(chaveDeNome("  José   da Silva ")).toBe("jose da silva");
    expect(chaveDeNome("JOSÉ DA SILVA")).toBe("jose da silva");
    expect(chaveDeNome("José da Silva Jr")).not.toBe("jose da silva");
  });
});

describe("decidir", () => {
  it("e-mail cadastrado vence tudo, mesmo com nome diferente", () => {
    expect(
      decidir(
        {
          linha: 2,
          nome: "Outro Nome",
          emails: ["ana@x.com"],
          telefones: ["+5548999990002"],
        },
        base()
      )
    ).toEqual({ tipo: "atualizar", contactId: "ana", por: "email" });
  });

  it("telefone cadastrado identifica o contato", () => {
    expect(
      decidir(
        { linha: 2, nome: "Ana S.", emails: [], telefones: ["+5548999990001"] },
        base()
      )
    ).toEqual({ tipo: "atualizar", contactId: "ana", por: "telefone" });
  });

  it("telefone novo + nome único → acrescenta ao contato daquele nome", () => {
    expect(
      decidir(
        {
          linha: 2,
          nome: "bruno lima",
          emails: [],
          telefones: ["+5548999990003"],
        },
        base()
      )
    ).toEqual({ tipo: "atualizar", contactId: "bruno", por: "nome" });
  });

  it("nome repetido na base fica pendente, não chuta", () => {
    expect(
      decidir(
        {
          linha: 2,
          nome: "Carlos Silva",
          emails: [],
          telefones: ["+5548999990004"],
        },
        base()
      )
    ).toEqual({ tipo: "ambiguo", candidatos: ["carlos1", "carlos2"] });
  });

  it("lead não é casado pelo nome — só por endereço", () => {
    expect(
      decidir(
        {
          linha: 2,
          nome: "Dora Reis",
          emails: [],
          telefones: ["+5548999990005"],
        },
        base()
      )
    ).toEqual({ tipo: "criar" });
    expect(
      decidir(
        {
          linha: 2,
          nome: "Dora Reis",
          emails: [],
          telefones: ["+5548999990009"],
        },
        base()
      )
    ).toEqual({ tipo: "atualizar", contactId: "lead", por: "telefone" });
  });

  it("e-mail de um contato e telefone de outro na mesma linha → conflito", () => {
    expect(
      decidir(
        {
          linha: 2,
          nome: "Ana Souza",
          emails: ["bruno@x.com"],
          telefones: ["+5548999990001"],
        },
        base()
      )
    ).toEqual({ tipo: "conflito", contactIds: ["bruno", "ana"] });
  });

  it("ninguém conhece → criar", () => {
    expect(
      decidir(
        {
          linha: 2,
          nome: "Novo Parceiro",
          emails: ["novo@x.com"],
          telefones: [],
        },
        base()
      )
    ).toEqual({ tipo: "criar" });
  });

  it("a segunda linha do mesmo nome acha o contato que a primeira criou", () => {
    const indice = base();
    expect(
      decidir(
        {
          linha: 2,
          nome: "Eva Melo",
          emails: [],
          telefones: ["+5548999990006"],
        },
        indice
      )
    ).toEqual({ tipo: "criar" });
    indexar(indice, {
      id: "eva",
      nome: "Eva Melo",
      emails: [],
      telefones: ["+5548999990006"],
      porNome: true,
    });
    expect(
      decidir(
        {
          linha: 3,
          nome: "Eva Melo",
          emails: [],
          telefones: ["+5548999990007"],
        },
        indice
      )
    ).toEqual({
      tipo: "atualizar",
      contactId: "eva",
      por: "nome",
    });
  });
});
