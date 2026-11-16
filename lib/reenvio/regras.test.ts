import { describe, expect, it } from "vitest";

import {
  conferir,
  faixaDeRegistro,
  lerDestinatarios,
  paraImprimir,
  paraVer,
  usaNomeDoParceiro,
} from "./regras";

// O e-mail de uma campanha já disparada: a lista que a tela manda, o que cada
// endereço é para a base e o HTML que vai para a tela e para o papel.

describe("lerDestinatarios", () => {
  it("aceita um por linha, vírgula, ponto e vírgula ou espaço, e normaliza", () => {
    expect(
      lerDestinatarios(
        " Parceiro@Loja.com.br\nrh@avantejuntos.com.br, rh@avantejuntos.com.br; a@x.com b@x.com "
      )
    ).toEqual({
      destinatarios: [
        { email: "parceiro@loja.com.br", nome: null },
        { email: "rh@avantejuntos.com.br", nome: null },
        { email: "a@x.com", nome: null },
        { email: "b@x.com", nome: null },
      ],
      invalidos: [],
    });
  });

  it('lê "Nome <email>", como os programas de e-mail copiam', () => {
    expect(
      lerDestinatarios('"Maria Silva" <Maria@Loja.com.br>\nJoão <joao@x.com>')
        .destinatarios
    ).toEqual([
      { email: "maria@loja.com.br", nome: "Maria Silva" },
      { email: "joao@x.com", nome: "João" },
    ]);
  });

  it("aponta o que não é e-mail, em vez de descartar calado", () => {
    expect(lerDestinatarios("a@x.com\nfulano@empresa\nsem arroba")).toEqual({
      destinatarios: [{ email: "a@x.com", nome: null }],
      invalidos: ["fulano@empresa", "sem", "arroba"],
    });
  });

  it("lê o que a tela devolve depois da conferência ({ email, nome })", () => {
    expect(
      lerDestinatarios([
        { email: "A@x.com", nome: "  Ana  " },
        { email: "a@x.com", nome: "Outra" },
        { email: "b@x.com", nome: "" },
        "c@x.com",
      ]).destinatarios
    ).toEqual([
      { email: "a@x.com", nome: "Ana" },
      { email: "b@x.com", nome: null },
      { email: "c@x.com", nome: null },
    ]);
    expect(lerDestinatarios(null).destinatarios).toEqual([]);
  });
});

describe("usaNomeDoParceiro", () => {
  it("reconhece a variável com ou sem espaços", () => {
    expect(usaNomeDoParceiro("<p>Olá, {{nome_parceiro}}!</p>")).toBe(true);
    expect(usaNomeDoParceiro("<p>Olá, {{ nome_parceiro }}!</p>")).toBe(true);
    expect(usaNomeDoParceiro("<p>Olá! {{unsubscribe_url}}</p>")).toBe(false);
  });
});

describe("conferir", () => {
  const daBase = new Map([
    ["ana@loja.com.br", { contactId: "c1", nome: "Ana Souza", aceita: true }],
    ["saiu@loja.com.br", { contactId: "c2", nome: "Beto Lima", aceita: false }],
  ]);

  it("contato vai com o nome da base, mesmo que outro tenha sido digitado", () => {
    expect(
      conferir([{ email: "ana@loja.com.br", nome: "Aninha" }], daBase, true)
    ).toEqual([
      {
        email: "ana@loja.com.br",
        situacao: "contato",
        nome: "Ana Souza",
        contactId: "c1",
        faltaNome: false,
      },
    ]);
  });

  it("quem pediu para sair fica marcado como descadastrado", () => {
    const [saiu] = conferir(
      [{ email: "saiu@loja.com.br", nome: null }],
      daBase,
      true
    );
    expect(saiu.situacao).toBe("descadastrado");
    expect(saiu.contactId).toBe("c2");
  });

  it("fora da base só precisa de nome quando o e-mail chama pelo nome", () => {
    const fora = [
      { email: "novo@x.com", nome: null },
      { email: "outro@x.com", nome: "Carla" },
    ];
    expect(conferir(fora, daBase, true).map((e) => e.faltaNome)).toEqual([
      true,
      false,
    ]);
    expect(conferir(fora, daBase, false).map((e) => e.faltaNome)).toEqual([
      false,
      false,
    ]);
    expect(conferir(fora, daBase, true)[0].situacao).toBe("fora_da_base");
  });
});

const BASE = "https://campanhas.avantetools.com.br";
const HTML = `<!doctype html><html><head><title>Antigo</title><style>@media only screen and (min-width:480px) { .mj-column-per-50 { width:50% !important; } }</style></head><body style="x"><img src="${BASE}/uploads/a.png" /><a href="https://avantejuntos.com.br">Site</a></body></html>`;

describe("paraVer", () => {
  it("devolve as imagens do sistema ao caminho relativo e abre links em outra aba", () => {
    const html = paraVer(HTML, BASE);
    expect(html).toContain('<img src="/uploads/a.png" />');
    expect(html).toContain('<head><base target="_blank" />');
    // Link para fora continua como está.
    expect(html).toContain('href="https://avantejuntos.com.br"');
  });

  it("sem <head>, põe o base no começo", () => {
    expect(paraVer("<p>oi</p>", BASE)).toBe('<base target="_blank" /><p>oi</p>');
  });
});

const registro = {
  tipo: "campaign" as const,
  nomeDaCampanha: "Convite <live>",
  assunto: "Você está convidado",
  preCabecalho: "Dia 22, às 19h",
  enviadaEm: "19/10/2026, 14:00",
  autor: "Fernando Araújo",
  listas: "Parceiros WHITE LABEL",
  destinatarios: 1234,
};

describe("faixaDeRegistro", () => {
  it("diz de que campanha é, o assunto, quando, quem e para quantos — escapado", () => {
    const faixa = faixaDeRegistro(registro);
    expect(faixa).toContain("Campanha");
    expect(faixa).toContain("Convite &lt;live&gt;");
    expect(faixa).not.toContain("<live>");
    expect(faixa).toContain("Assunto: <strong>Você está convidado</strong>");
    expect(faixa).toContain("Pré-cabeçalho: Dia 22, às 19h");
    expect(faixa).toContain(
      "Enviada em 19/10/2026, 14:00 por Fernando Araújo · 1.234 destinatários"
    );
    expect(faixa).toContain("Listas: Parceiros WHITE LABEL");
  });

  it("edição do News, um destinatário só, sem pré-cabeçalho nem autor", () => {
    const faixa = faixaDeRegistro({
      ...registro,
      tipo: "news",
      preCabecalho: " ",
      autor: null,
      destinatarios: 1,
    });
    expect(faixa).toContain("Edição do Avante News");
    expect(faixa).not.toContain("Pré-cabeçalho");
    expect(faixa).toContain("Enviada em 19/10/2026, 14:00 · 1 destinatário<");
  });

  it("campanha que ainda não saiu não inventa data", () => {
    const faixa = faixaDeRegistro({
      ...registro,
      enviadaEm: null,
      destinatarios: 0,
    });
    expect(faixa).toContain("Ainda não enviada<br />");
  });
});

describe("paraImprimir", () => {
  const html = paraImprimir(HTML, registro, BASE);

  it("põe a faixa logo depois da abertura do corpo", () => {
    expect(html).toMatch(/<body style="x"><table role="presentation"/);
    expect(html).toContain("Você está convidado");
  });

  it("troca o título pelo da campanha (vira o nome do PDF)", () => {
    expect(html).toContain(
      "<title>Convite &lt;live&gt; — e-mail enviado</title>"
    );
    expect(html).not.toContain("<title>Antigo</title>");
  });

  it("mantém cores e o desenho de computador no papel", () => {
    expect(html).toContain("print-color-adjust: exact");
    expect(html).toContain("@media all and (min-width:480px)");
    expect(html).not.toContain("only screen");
  });

  it("mantém o que a versão de tela já faz", () => {
    expect(html).toContain('src="/uploads/a.png"');
    expect(html).toContain('<base target="_blank" />');
  });
});
