import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { mensagemSemSql } from "./utils";

describe("mensagemSemSql", () => {
  it("troca o SQL do Drizzle pelo motivo do banco", () => {
    const doBanco = new Error(
      'bind message supplies 6464 parameters, but prepared statement "" requires 72000'
    );
    const erro = new DrizzleQueryError(
      'insert into "campaign_sends" ("id", "campaign_id") values (default, $1)',
      ["x"],
      doBanco
    );
    expect(mensagemSemSql(erro)).toBe(doBanco.message);
  });

  it("erro comum sai como está", () => {
    expect(mensagemSemSql(new Error("Redis fora do ar"))).toBe("Redis fora do ar");
    expect(mensagemSemSql("texto")).toBe("texto");
  });

  it("Failed query sem causa mantém a mensagem original", () => {
    const erro = new Error("Failed query: select 1");
    expect(mensagemSemSql(erro)).toBe("Failed query: select 1");
  });
});
