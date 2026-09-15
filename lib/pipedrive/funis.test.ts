import { describe, expect, it } from "vitest";

import { lerIdsDosFunis } from "./funis";

describe("lerIdsDosFunis", () => {
  it("lê a lista gravada pela migração", () => {
    expect(lerIdsDosFunis("[8,14]")).toEqual([8, 14]);
  });

  it("aceita id como texto e ignora repetido", () => {
    expect(lerIdsDosFunis('["8", 14, 14]')).toEqual([8, 14]);
  });

  it("sem lista válida, devolve null — e vale o funil do env", () => {
    for (const valor of [null, "", "abc", "[]", '{"id":8}', "[0,-1,1.5]"]) {
      expect(lerIdsDosFunis(valor), String(valor)).toBeNull();
    }
  });
});
