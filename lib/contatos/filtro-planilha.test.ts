import { describe, expect, it } from "vitest";

import { filtrarContatos, lerPlanilha } from "./filtro-planilha";

// A planilha que chega do comercial tem nome, e-mail, telefone, CNPJ, cidade…
// O filtro precisa achar o contato por qualquer identidade — e NÃO pode casar
// um CNPJ como telefone nem uma cidade como nome.

const contatos = [
  {
    id: "ana",
    name: "Ana Souza",
    emails: ["ana@x.com"],
    phones: ["+5548999990001"],
  },
  {
    id: "bruno",
    name: "Bruno Lima",
    emails: ["bruno@x.com", "b@y.com"],
    phones: [],
  },
  {
    id: "carlos1",
    name: "Carlos Silva",
    emails: ["c1@x.com"],
    phones: ["+5531995650622"],
  },
  { id: "carlos2", name: "Carlos Silva", emails: ["c2@x.com"], phones: [] },
  { id: "dora", name: "Dora Reis", emails: [], phones: ["+5511988887777"] },
];

describe("lerPlanilha", () => {
  it("lista colada sem cabeçalho: cada célula com cara de telefone conta", () => {
    const p = lerPlanilha("31 99565-0622\n(11) 98888-7777\nabc");
    expect(p.comCabecalho).toBe(false);
    expect(p.linhas.map((l) => l.telefones)).toEqual([
      ["31995650622"],
      ["11988887777"],
    ]);
  });

  it("reconhece o cabeçalho e lê nome, e-mail e só as colunas de telefone", () => {
    const p = lerPlanilha(
      "Nome,CNPJ,Telefone,E-mail,Cidade\nAna Souza,12.345.678/0001-90,48 99999-0001,ANA@X.com,Florianópolis"
    );
    expect(p.comCabecalho).toBe(true);
    expect(p.semColunaDeNome).toBe(false);
    expect(p.linhas).toHaveLength(1);
    expect(p.linhas[0].nome).toBe("Ana Souza");
    expect(p.linhas[0].emails).toEqual(["ana@x.com"]);
    // O CNPJ tem 14 dígitos, mas não é coluna de telefone: fica de fora.
    expect(p.linhas[0].telefones).toEqual(["48999990001"]);
  });

  it("cabeçalho sem coluna de nome: avisa, e nomes não entram", () => {
    const p = lerPlanilha("Empresa,Telefone\nAvante,48 99999-0001");
    expect(p.comCabecalho).toBe(true);
    expect(p.semColunaDeNome).toBe(true);
    expect(p.linhas[0].nome).toBeNull();
  });

  it("segundo e-mail na mesma célula também conta", () => {
    const p = lerPlanilha("nome,email\nBruno,bruno@x.com; b@y.com");
    expect(p.linhas[0].emails).toEqual(["bruno@x.com", "b@y.com"]);
  });
});

describe("filtrarContatos", () => {
  it("casa por e-mail, telefone ou nome — e diz por qual", () => {
    const p = lerPlanilha(
      "nome,email,telefone\nOutro,ana@x.com,\nX,,5531995650622\nDora Reis,,\nNinguem,ninguem@x.com,11 90000-0000"
    );
    const { ids, resultado } = filtrarContatos(p, contatos);
    expect(ids.sort()).toEqual(["ana", "carlos1", "dora"]);
    expect(resultado).toMatchObject({
      total: 4,
      encontradas: 3,
      porEmail: 1,
      porTelefone: 1,
      porNome: 1,
      contatos: 3,
      naoEncontradas: ["Ninguem · ninguem@x.com · 11 90000-0000"],
    });
  });

  it("telefone casa de trás para frente (sem o 9, com DDI)", () => {
    const p = lerPlanilha("55 31 9565-0622");
    expect(filtrarContatos(p, contatos).ids).toEqual(["carlos1"]);
  });

  it("nome repetido na base seleciona todos e avisa", () => {
    const p = lerPlanilha("nome\nCarlos  Silva");
    const { ids, resultado } = filtrarContatos(p, contatos);
    expect(ids.sort()).toEqual(["carlos1", "carlos2"]);
    expect(resultado.nomesAmbiguos).toEqual(["Carlos  Silva"]);
  });

  it("e-mail secundário do contato também identifica", () => {
    const p = lerPlanilha("b@y.com");
    expect(filtrarContatos(p, contatos).ids).toEqual(["bruno"]);
  });

  it("sem cabeçalho, texto solto não vira nome", () => {
    const p = lerPlanilha("Ana Souza");
    expect(p.linhas).toHaveLength(0);
    expect(filtrarContatos(p, contatos).ids).toEqual([]);
  });
});
