import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// dns e fetch são o mundo lá fora: aqui eles são combinados, para o teste
// valer o comportamento do módulo e não a saúde da internet.
vi.mock("dns/promises", () => ({
  default: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
}));

import {
  internalizarImagensDoDesign,
  internalizarImagensDoHtml,
} from "./uploads-externas";
import type { EmailDesign } from "./email-builder/types";

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function resposta(bytes: Uint8Array, tipo = "image/png", status = 200) {
  // O corpo vai como ArrayBuffer: Uint8Array não é um BodyInit válido para o
  // TypeScript, e o teste precisa compilar junto com o resto do projeto.
  return new Response(bytes.buffer as ArrayBuffer, {
    status,
    headers: { "content-type": tipo },
  });
}

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "uploads-teste-"));
  process.env.UPLOADS_DIR = dir;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("imagens externas de um HTML", () => {
  it("baixa a imagem de fora e aponta o e-mail para o servidor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta(PNG)));

    const { html, relatorio } = await internalizarImagensDoHtml(
      '<img src="https://exemplo.com/logo.png" alt="Avante">'
    );

    expect(relatorio.baixadas).toBe(1);
    expect(relatorio.falhas).toEqual([]);
    expect(html).toMatch(/src="\/uploads\/externa-[0-9a-f]{16}\.png"/);
    expect(await fs.readdir(dir)).toHaveLength(1);
  });

  it("não toca no que já é servido por nós", async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    const original = '<img src="/uploads/arquivo.png">';
    const { html, relatorio } = await internalizarImagensDoHtml(original);

    expect(html).toBe(original);
    expect(relatorio.baixadas).toBe(0);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("baixa uma vez só a mesma arte usada em dois lugares", async () => {
    const fetchFalso = vi.fn(async () => resposta(PNG));
    vi.stubGlobal("fetch", fetchFalso);

    const { html } = await internalizarImagensDoHtml(
      '<img src="https://exemplo.com/a.png"><img src="https://exemplo.com/a.png">'
    );

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(html.match(/\/uploads\//g)).toHaveLength(2);
    expect(await fs.readdir(dir)).toHaveLength(1);
  });

  it("guarda um arquivo só quando duas URLs trazem o mesmo conteúdo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta(PNG)));

    await internalizarImagensDoHtml('<img src="https://um.com/a.png">');
    await internalizarImagensDoHtml('<img src="https://outro.com/b.png">');

    expect(await fs.readdir(dir)).toHaveLength(1);
  });

  it("deixa o endereço como está e explica quando a imagem não vem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resposta(PNG, "image/png", 404))
    );

    const original = '<img src="https://exemplo.com/sumiu.png">';
    const { html, relatorio } = await internalizarImagensDoHtml(original);

    expect(html).toBe(original);
    expect(relatorio.baixadas).toBe(0);
    expect(relatorio.falhas).toEqual([
      { url: "https://exemplo.com/sumiu.png", motivo: "resposta 404" },
    ]);
  });

  it("recusa o que não é imagem aceita", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resposta(PNG, "text/html"))
    );

    const { html, relatorio } = await internalizarImagensDoHtml(
      '<img src="https://exemplo.com/pagina.html">'
    );

    expect(html).toContain("https://exemplo.com/pagina.html");
    expect(relatorio.falhas[0].motivo).toContain("tipo não suportado");
  });

  it("não busca endereço da rede interna", async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    const { relatorio } = await internalizarImagensDoHtml(
      '<img src="http://169.254.169.254/latest/meta-data/">'
    );

    expect(fetchFalso).not.toHaveBeenCalled();
    expect(relatorio.falhas[0].motivo).toBe("endereço da rede interna");
  });
});

describe("imagens externas de um design", () => {
  it("cobre bloco de imagem, ícone social, texto e HTML próprio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta(PNG)));

    const design: EmailDesign = {
      version: 1,
      settings: {
        bodyBackground: "#fff",
        contentBackground: "#fff",
        fontFamily: "Arial",
        textColor: "#000",
        linkColor: "#00f",
      },
      rows: [
        {
          id: "r1",
          attrs: { backgroundColor: "", padding: "0px" },
          columns: [
            {
              id: "c1",
              widthPct: 100,
              blocks: [
                {
                  id: "b1",
                  type: "image",
                  src: "https://exemplo.com/banner.png",
                  alt: "Banner",
                  href: "",
                  attrs: {
                    width: null,
                    align: "center",
                    borderRadius: 0,
                    padding: "0px",
                  },
                },
                {
                  id: "b2",
                  type: "text",
                  html: '<img src="https://exemplo.com/assinatura.png">',
                  attrs: {
                    fontSize: 14,
                    color: "",
                    align: "left",
                    padding: "0px",
                  },
                },
                {
                  id: "b3",
                  type: "social",
                  items: [
                    {
                      label: "YouTube",
                      iconSrc: "https://exemplo.com/yt.png",
                      href: "https://youtube.com",
                    },
                  ],
                  attrs: { iconSize: 24, align: "center", padding: "0px" },
                },
              ],
            },
          ],
        },
        {
          id: "r2",
          customHtml: '<td><img src="https://exemplo.com/rodape.png"></td>',
          attrs: { backgroundColor: "", padding: "0px" },
          columns: [],
        },
      ],
    };

    const { design: saida, relatorio } =
      await internalizarImagensDoDesign(design);

    const blocos = saida.rows[0].columns[0].blocks;
    expect(blocos[0].type === "image" && blocos[0].src).toMatch(/^\/uploads\//);
    expect(blocos[1].type === "text" && blocos[1].html).toContain("/uploads/");
    expect(blocos[2].type === "social" && blocos[2].items[0].iconSrc).toMatch(
      /^\/uploads\//
    );
    expect(saida.rows[1].customHtml).toContain("/uploads/");
    // Conteúdo idêntico nas quatro: um arquivo, quatro apontamentos.
    expect(relatorio.baixadas).toBe(4);
    expect(await fs.readdir(dir)).toHaveLength(1);
  });
});
