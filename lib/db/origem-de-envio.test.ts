import { describe, expect, it } from "vitest";

import { expressaoDeOrigem } from "./origem-de-envio";

describe("expressaoDeOrigem", () => {
  it("usa só as colunas que existem, na ordem fixa", () => {
    expect(expressaoDeOrigem(["automation_run_id", "campaign_id"])).toBe(
      "campaign_id IS NOT NULL OR automation_run_id IS NOT NULL"
    );
  });

  it("inclui passo e convite de pesquisa quando as colunas já existem", () => {
    expect(
      expressaoDeOrigem(["campaign_id", "automation_run_id", "automation_step_id", "survey_invite_id", "outra"])
    ).toBe(
      "campaign_id IS NOT NULL OR automation_run_id IS NOT NULL OR automation_step_id IS NOT NULL OR survey_invite_id IS NOT NULL"
    );
  });

  it("recusa tabela sem coluna de origem", () => {
    expect(() => expressaoDeOrigem(["id"])).toThrow(/migração base/);
  });
});
