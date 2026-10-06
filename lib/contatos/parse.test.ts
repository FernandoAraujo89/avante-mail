import { describe, expect, it } from "vitest";

import { allValidPhones } from "@/lib/phone";
import { parseEmailList } from "@/lib/utils";

// A célula da planilha com "vários" dentro: antes o sistema guardava um
// telefone por contato e ficava com o primeiro; agora todos são do contato.

describe("allValidPhones", () => {
  it("devolve todos os números válidos da célula, em E.164 e sem repetir", () => {
    expect(allValidPhones("91 98121-9276, (91) 98704-2212")).toEqual([
      "+5591981219276",
      "+5591987042212",
    ]);
    expect(allValidPhones("19 99676 0536 / 19-99676-0536")).toEqual([
      "+5519996760536",
    ]);
  });

  it("pula o que não é telefone e devolve vazio quando nada presta", () => {
    expect(allValidPhones("abc, 123")).toEqual([]);
    expect(allValidPhones("")).toEqual([]);
    expect(allValidPhones(null)).toEqual([]);
  });
});

describe("parseEmailList", () => {
  it("separa por vírgula, ponto e vírgula ou espaço, e normaliza", () => {
    expect(parseEmailList(" Ana@X.com; bruno@y.com ana@x.com ")).toEqual([
      "ana@x.com",
      "bruno@y.com",
    ]);
  });

  it("ignora o que não é e-mail", () => {
    expect(parseEmailList("sem-arroba, @x.com, c@d.e")).toEqual(["c@d.e"]);
  });
});
