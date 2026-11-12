import { describe, expect, it } from "vitest";

import { normalizeTags } from "@/lib/utils";
import { ehTagDePerda, mesmasTags, tagDoMotivo, tagsComAPerda } from "./tags-de-perda";

describe("tagDoMotivo", () => {
  it("prefixa e põe em minúsculas, como toda tag do sistema", () => {
    expect(tagDoMotivo("Não consegui contato")).toBe("perda: não consegui contato");
  });

  it("sem motivo, sem tag", () => {
    expect(tagDoMotivo(null)).toBeNull();
    expect(tagDoMotivo("")).toBeNull();
    expect(tagDoMotivo("   ")).toBeNull();
    expect(tagDoMotivo(" . ")).toBeNull();
  });

  it("troca vírgula por hífen — a ficha do contato separa tags por vírgula", () => {
    const tag = tagDoMotivo("Seguiu todo o fluxo de contato, não tive um retorno");
    expect(tag).toBe("perda: seguiu todo o fluxo de contato - não tive um retorno");
    // Sobrevive a uma ida e volta pela edição do contato (join + split).
    expect(normalizeTags([tag].join(", "))).toEqual([tag]);
  });

  it("ponto final e espaços a mais não criam uma tag diferente", () => {
    expect(tagDoMotivo("Seguiu todo o fluxo de contato, não tive um retorno.")).toBe(
      tagDoMotivo("  Seguiu todo o fluxo de contato,  não tive um retorno ")
    );
  });

  it("mantém hífen do meio e parênteses do fim", () => {
    expect(tagDoMotivo("Seguiu todo o fluxo de follow-up - IA SDR")).toBe(
      "perda: seguiu todo o fluxo de follow-up - ia sdr"
    );
    expect(tagDoMotivo("Não tem integrações (e-commerce)")).toBe(
      "perda: não tem integrações (e-commerce)"
    );
  });

  it("corta motivo longo (texto livre) em 80 caracteres", () => {
    const tag = tagDoMotivo("Lead tem experiência ".repeat(10))!;
    expect(tag.length).toBeLessThanOrEqual(80);
    expect(tag.startsWith("perda: lead tem experiência")).toBe(true);
    expect(tag).toBe(tag.trimEnd());
  });
});

describe("tagsComAPerda", () => {
  it("põe a tag do motivo e preserva as outras", () => {
    expect(tagsComAPerda(["vip", "meta"], "Preço")).toEqual(["vip", "meta", "perda: preço"]);
    expect(tagsComAPerda(null, "Preço")).toEqual(["perda: preço"]);
  });

  it("motivo trocado troca a tag — no máximo uma tag de perda", () => {
    expect(tagsComAPerda(["perda: preço", "vip"], "Sem perfil")).toEqual([
      "vip",
      "perda: sem perfil",
    ]);
  });

  it("sem motivo (lead reaberto ou que comprou) tira a tag de perda", () => {
    expect(tagsComAPerda(["vip", "perda: preço"], null)).toEqual(["vip"]);
  });

  it("já com a tag certa, devolve as mesmas tags na mesma ordem", () => {
    const tags = ["perda: preço", "vip"];
    expect(tagsComAPerda(tags, "Preço")).toEqual(tags);
  });

  it("limpa tag de perda duplicada ou antiga deixando só a atual", () => {
    expect(tagsComAPerda(["perda: preço", "perda: sem perfil", "vip"], "Preço")).toEqual([
      "perda: preço",
      "vip",
    ]);
  });

  it("não confunde tag comum que só lembra a palavra", () => {
    expect(ehTagDePerda("perdao")).toBe(false);
    expect(ehTagDePerda("perda:sem-espaco")).toBe(false);
    expect(tagsComAPerda(["perdao"], null)).toEqual(["perdao"]);
  });
});

describe("mesmasTags", () => {
  it("compara conjunto, não ordem", () => {
    expect(mesmasTags(["a", "b"], ["b", "a"])).toBe(true);
    expect(mesmasTags(["a"], ["a", "b"])).toBe(false);
    expect(mesmasTags(null, [])).toBe(true);
  });
});
