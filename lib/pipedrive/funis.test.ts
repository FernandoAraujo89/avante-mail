import { describe, expect, it } from "vitest";

import { chavesDoCrm, crmAtivo, lerIdsDosFunis } from "./funis";

describe("lerIdsDosFunis", () => {
  it("lê a lista gravada pela migração, como texto", () => {
    expect(lerIdsDosFunis("[8,14]")).toEqual(["8", "14"]);
  });

  it("aceita id como texto, UUID do Hub, e ignora repetido", () => {
    expect(lerIdsDosFunis('["8", 14, 14]')).toEqual(["8", "14"]);
    expect(lerIdsDosFunis('["6f1c-a", "6f1c-a", " 9b2d "]')).toEqual(["6f1c-a", "9b2d"]);
  });

  it("sem lista válida, devolve null — e valem os funis por nome", () => {
    for (const valor of [null, "", "abc", "[]", '{"id":8}', "[0,-1,1.5]", '["0", ""]']) {
      expect(lerIdsDosFunis(valor), String(valor)).toBeNull();
    }
  });
});

describe("CRM ativo e suas chaves", () => {
  it("com NRG_HUB_API_TOKEN é o Hub; senão, o Pipedrive", () => {
    expect(crmAtivo({ NRG_HUB_API_TOKEN: "hub_x" } as unknown as NodeJS.ProcessEnv)).toBe("nrg");
    expect(crmAtivo({ PIPEDRIVE_API_TOKEN: "pd" } as unknown as NodeJS.ProcessEnv)).toBe("pipedrive");
    expect(crmAtivo({} as unknown as NodeJS.ProcessEnv)).toBe("pipedrive");
  });

  it("cada CRM guarda a própria configuração em app_settings", () => {
    expect(chavesDoCrm("pipedrive").funis).toBe("pipedrive_funis");
    expect(chavesDoCrm("nrg").funis).toBe("nrg_funis");
    expect(chavesDoCrm("nrg").desde).toBe("nrg_sync_desde");
  });
});
