import { describe, expect, it } from "vitest";

import { csvFilename, toCsv } from "./csv";

// O arquivo é aberto por quem não programa, no Excel em português. Cada um
// destes testes trava um jeito conhecido de o arquivo chegar quebrado do outro
// lado: tudo numa coluna só, acento virando símbolo, ou a planilha tratando o
// nome de uma empresa como fórmula.

describe("toCsv", () => {
  it("começa com BOM, separa por ponto e vírgula e termina a linha com CRLF", () => {
    const csv = toCsv(["Nome", "Status"], [["Fernando", "Entregue"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toBe("\uFEFFNome;Status\r\nFernando;Entregue\r\n");
  });

  it("põe entre aspas a célula que contém o separador", () => {
    const csv = toCsv(["Motivo"], [["Não recebe; confira o telefone"]]);
    expect(csv).toContain('"Não recebe; confira o telefone"');
  });

  it("dobra as aspas de dentro da célula", () => {
    const csv = toCsv(["Empresa"], [['Padaria "Bom Pão"']]);
    expect(csv).toContain('"Padaria ""Bom Pão"""');
  });

  it("mantém quebra de linha dentro da célula, entre aspas", () => {
    const csv = toCsv(["Obs"], [["linha 1\nlinha 2"]]);
    expect(csv).toContain('"linha 1\nlinha 2"');
  });

  it("neutraliza célula que a planilha executaria como fórmula", () => {
    // Nome de empresa começando com = ou - é raro, mas basta um para o Excel
    // mostrar #NOME? no lugar do dado (ou pior, executar algo).
    const csv = toCsv(["Nome"], [["=SOMA(A1:A9)"], ["-Bar do Zé"], ["@ncora"]]);
    expect(csv).toContain("'=SOMA(A1:A9)");
    expect(csv).toContain("'-Bar do Zé");
    expect(csv).toContain("'@ncora");
  });

  it("protege telefone internacional sem estragar a leitura", () => {
    // O "+" cai na mesma regra: vira texto e o número não é convertido.
    const csv = toCsv(["Telefone"], [["+55 31 99576 8114"]]);
    expect(csv).toContain("+55 31 99576 8114");
  });

  it("preserva espaço nas pontas usando aspas", () => {
    expect(toCsv(["A"], [[" com espaço "]])).toContain('" com espaço "');
  });

  it("exporta cabeçalho sozinho quando não há linhas", () => {
    expect(toCsv(["Nome", "Status"], [])).toBe("\uFEFFNome;Status\r\n");
  });
});

describe("csvFilename", () => {
  it("junta os pedaços em um nome de arquivo sem acento nem espaço", () => {
    expect(csvFilename("Novidades no SEUPDV", "Número não recebe")).toBe(
      "novidades-no-seupdv-numero-nao-recebe.csv"
    );
  });

  it("ignora pedaços vazios", () => {
    expect(csvFilename("Campanha", "", null, undefined)).toBe("campanha.csv");
  });

  it("tem nome de reserva quando não sobra nada legível", () => {
    expect(csvFilename("!!!", "***")).toBe("exportacao.csv");
  });
});
