// Importação de um e-mail em HTML/MJML para o modelo do Criador (WYSIWYG).
//
// Um template escrito como código só podia ser editado como código. Aqui ele
// vira um documento do Criador DE VERDADE: cada seção do e-mail é lida e
// remontada como estrutura, colunas e blocos do modelo (texto, imagem, botão,
// divisor, espaço, redes sociais), com os atributos que os controles da barra
// lateral editam — tamanho de fonte, cor, alinhamento, espaçamento, raio.
//
// A leitura é feita sobre o HTML COMPILADO (o servidor compila o MJML pelo
// mesmo caminho do envio), porque é ele que descreve o e-mail que chega de
// fato na caixa de entrada.
//
// Nem todo HTML cabe no modelo, e forçar seria pior que não converter: o que
// não é reconhecido desce um degrau de cada vez — a seção que não tem a
// assinatura do MJML passa pela leitura genérica (lib/email-builder/
// blocos-do-html.ts, que lê o HTML renderizado), a que nem assim vira blocos
// fica como estrutura com HTML próprio (ainda editável no canvas, ainda
// movível) e, se nem isso der, o e-mail inteiro fica como HTML do documento.
// Nenhum caminho perde conteúdo.
//
// Roda só no navegador (o HTML é renderizado num iframe invisível para ser
// lido), como o resto do criador.

import {
  amostrarTipografia,
  aplicarTipografia,
  comDocumentoRenderizado,
  converterElementosEmLinhas,
  criarPalco,
  fundoDaPagina,
} from "./blocos-do-html";
import { limparHtmlDoUsuario } from "./codigo";
import { createColumn, createRow, uid } from "./ops";
import { DEFAULT_SETTINGS, ENTRELINHA_PADRAO } from "./presets";
import type {
  Block,
  Column,
  DesignSettings,
  EmailDesign,
  Row,
  SocialItem,
} from "./types";

// ─── Leitura de estilo ───────────────────────────────────────────

/**
 * Lê uma propriedade do ATRIBUTO style, sem passar pelo CSSOM — que normaliza
 * cor para rgb() enquanto o modelo (e o seletor de cor do painel) fala hex.
 */
function propriedadeDoStyle(style: string, prop: string): string | null {
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
  return m ? m[1].trim() : null;
}

function estilo(el: Element | null | undefined, prop: string): string | null {
  return el ? propriedadeDoStyle(el.getAttribute("style") ?? "", prop) : null;
}

/**
 * Medida em pixels de um valor inteiro do estilo.
 *
 * Aceita com e sem unidade porque o gerador escreve as duas formas — `24px`,
 * mas `height:0` — e recusa porcentagem: `width:100%` não é medida em pixels,
 * e lê-la como 100 daria uma imagem de cem pixels de largura.
 */
function pixels(valor: string | null | undefined): number | null {
  const v = valor?.trim();
  if (!v || v.includes("%")) return null;
  const m = v.match(/^(-?\d+(?:\.\d+)?)(?:px)?$/i);
  return m ? parseFloat(m[1]) : null;
}

/** Medida em pixels dentro de um valor composto (ex.: `solid 1px #DDD`). */
function pixelsNaFrase(valor: string | null | undefined): number | null {
  const m = valor?.match(/(-?\d+(?:\.\d+)?)px/i);
  return m ? parseFloat(m[1]) : null;
}

/** Espaçamento CSS (1 a 4 valores, em px) → [topo, direita, baixo, esquerda]. */
function lerEspacamento(valor: string | null | undefined): number[] | null {
  const partes = valor?.trim().split(/\s+/) ?? [];
  if (partes.length === 0 || partes.length > 4) return null;
  const n = partes.map((parte) => pixels(parte));
  if (n.some((v) => v === null)) return null;
  const [a, b = a, c = a, d = b] = n as number[];
  return [a, b, c, d];
}

function escreverEspacamento(lados: number[]): string {
  return lados.map((v) => `${v}px`).join(" ");
}

function ehHex(cor: string | null | undefined): cor is string {
  return Boolean(cor && /^#[0-9a-f]{3,8}$/i.test(cor.trim()));
}

type Alinhamento = "left" | "center" | "right";

function alinhamento(valor: string | null | undefined): Alinhamento | null {
  const v = valor?.trim().toLowerCase();
  return v === "left" || v === "center" || v === "right" ? v : null;
}

/** Alinhamento de um `<td>`: atributo align, senão text-align. */
function alinhamentoDoTd(td: Element): Alinhamento {
  return (
    alinhamento(td.getAttribute("align")) ??
    alinhamento(estilo(td, "text-align")) ??
    "left"
  );
}

/** Espaçamento do `<td>` do bloco; "0px" quando o MJML não escreveu nenhum. */
function espacamentoDoTd(td: Element): string {
  return estilo(td, "padding") ?? "0px";
}

function filhosElemento(el: Element): Element[] {
  return Array.from(el.children);
}

/** Primeiro filho direto com a tag pedida. */
function filho(el: Element | null, tag: string): Element | null {
  return el ? (filhosElemento(el).find((f) => f.tagName === tag) ?? null) : null;
}

/** As `<tr>` de uma tabela, esteja ou não dentro de `<tbody>`. */
function linhasDaTabela(tabela: Element): Element[] {
  const corpo = filho(tabela, "TBODY") ?? tabela;
  return filhosElemento(corpo).filter((f) => f.tagName === "TR");
}

// ─── Reconhecimento de cada tipo de bloco ────────────────────────
//
// Cada função recebe o `<td>` do bloco e devolve o bloco do modelo, ou null
// quando aquele `<td>` não é daquele tipo. A ORDEM em que são tentadas importa
// (ver `converterBloco`): social tem imagem dentro, botão tem link dentro, e
// quem chega ao texto é o que sobrou.

function comoSocial(td: Element): Block | null {
  // O MJML põe cada rede numa tabelinha `display:inline-table` — é isso que
  // separa uma fileira de ícones de uma imagem qualquer com link.
  const tabelas = Array.from(td.querySelectorAll("table"));
  const ehFileira = tabelas.some((t) =>
    /inline-table/i.test(t.getAttribute("style") ?? "")
  );
  if (!ehFileira) return null;

  const items: SocialItem[] = [];
  let tamanho = 0;
  for (const img of Array.from(td.querySelectorAll("img"))) {
    const link = img.closest("a");
    items.push({
      label: img.getAttribute("alt") ?? "",
      iconSrc: img.getAttribute("src") ?? "",
      href: link?.getAttribute("href") ?? "",
    });
    tamanho =
      tamanho ||
      Number(img.getAttribute("width")) ||
      pixels(estilo(img, "width")) ||
      0;
  }
  if (items.length === 0) return null;

  return {
    id: uid(),
    type: "social",
    items,
    attrs: {
      iconSize: Math.round(tamanho) || 24,
      align: alinhamentoDoTd(td),
      padding: espacamentoDoTd(td),
    },
  };
}

function comoImagem(td: Element): Block | null {
  const imgs = Array.from(td.querySelectorAll("img"));
  if (imgs.length !== 1) return null;
  const img = imgs[0];
  const src = img.getAttribute("src");
  if (!src) return null;

  const link = img.closest("a");
  // Largura: o número que o MJML escreveu no atributo. Sem ele (imagem que
  // ocupa a coluna inteira), null — que é como o modelo diz "largura total".
  const largura = Number(img.getAttribute("width"));

  return {
    id: uid(),
    type: "image",
    src,
    alt: img.getAttribute("alt") ?? "",
    href: link?.getAttribute("href") ?? "",
    attrs: {
      width: Number.isFinite(largura) && largura > 0 ? Math.round(largura) : null,
      align:
        alinhamento(
          filho(td, "TABLE")?.getAttribute("align") ?? null
        ) ?? alinhamentoDoTd(td),
      borderRadius: Math.round(pixels(estilo(img, "border-radius")) ?? 0),
      padding: espacamentoDoTd(td),
    },
  };
}

function comoBotao(td: Element): Block | null {
  const link = td.querySelector("a");
  if (!link || td.querySelector("img")) return null;
  // O botão do MJML é um link em bloco dentro do `<td>` colorido de uma
  // tabela; um link no meio de um parágrafo não tem nada disso.
  if (!/inline-block/i.test(estilo(link, "display") ?? "")) return null;

  const celula = link.closest("td");
  const fundo =
    estilo(celula, "background") ??
    estilo(celula, "background-color") ??
    celula?.getAttribute("bgcolor") ??
    estilo(link, "background-color") ??
    "";

  return {
    id: uid(),
    type: "button",
    text: (link.textContent ?? "").trim(),
    href: link.getAttribute("href") ?? "",
    attrs: {
      backgroundColor: ehHex(fundo) ? fundo.trim() : "#1D50DC",
      color: ehHex(estilo(link, "color")) ? estilo(link, "color")!.trim() : "#FFFFFF",
      fontSize: Math.round(pixels(estilo(link, "font-size")) ?? 15),
      borderRadius: Math.round(
        pixels(estilo(link, "border-radius") ?? estilo(celula, "border-radius")) ?? 0
      ),
      align: alinhamentoDoTd(td),
      padding: espacamentoDoTd(td),
    },
  };
}

function comoDivisor(td: Element): Block | null {
  const p = filho(td, "P");
  const borda = estilo(p, "border-top");
  if (!p || !borda) return null;

  const cor = borda.match(/#[0-9a-f]{3,8}/i)?.[0];
  return {
    id: uid(),
    type: "divider",
    attrs: {
      borderColor: cor ?? "#DDDDDD",
      borderWidth: Math.round(pixelsNaFrase(borda) ?? 1),
      padding: espacamentoDoTd(td),
    },
  };
}

function comoEspaco(td: Element): Block | null {
  const div = filho(td, "DIV");
  const altura = pixels(estilo(div, "height"));
  if (!div || altura === null) return null;
  // Espaço é altura sem conteúdo — o gerador preenche a célula com um
  // caractere invisível (espaço fino, espaço rígido) só para ela não sumir.
  if ((div.textContent ?? "").replace(/\s/g, "") !== "") return null;

  return { id: uid(), type: "spacer", attrs: { height: Math.round(altura) } };
}

function comoTexto(td: Element): Block | null {
  const div = filho(td, "DIV");
  const conteudo = (div ?? td).innerHTML.trim();
  if (!conteudo) return null;

  const cor = estilo(div, "color");
  const entrelinha = estilo(div, "line-height");
  const semUnidade = entrelinha?.match(/^(\d+(?:\.\d+)?)$/);

  return {
    id: uid(),
    type: "text",
    html: conteudo,
    attrs: {
      fontSize: Math.round(pixels(estilo(div, "font-size")) ?? 14),
      lineHeight: semUnidade ? parseFloat(semUnidade[1]) : ENTRELINHA_PADRAO,
      color: ehHex(cor) ? cor.trim() : "",
      align:
        alinhamento(estilo(div, "text-align")) ?? alinhamentoDoTd(td),
      padding: espacamentoDoTd(td),
    },
  };
}

/** O `<td>` de um bloco → bloco do modelo, ou null se não for reconhecido. */
function converterBloco(td: Element): Block | null {
  return (
    comoSocial(td) ??
    comoBotao(td) ??
    comoImagem(td) ??
    comoDivisor(td) ??
    comoEspaco(td) ??
    comoTexto(td)
  );
}

// ─── Reconhecimento da seção ─────────────────────────────────────

/** Largura da coluna a partir da classe do MJML (mj-column-per-33-333333). */
function larguraDaColuna(el: Element): number {
  const classe = el.getAttribute("class") ?? "";
  const porcento = classe.match(/mj-column-per-(\d+)(?:-(\d+))?/);
  if (porcento) {
    return Math.min(100, parseFloat(`${porcento[1]}.${porcento[2] ?? "0"}`));
  }
  const px = classe.match(/mj-column-px-(\d+)/);
  if (px) return Math.min(100, (Number(px[1]) / 600) * 100);
  const doEstilo = estilo(el, "width");
  const emPorcento = doEstilo?.match(/^(\d+(?:\.\d+)?)%$/);
  if (emPorcento) return parseFloat(emPorcento[1]);
  return 100;
}

/**
 * Coluna com espaçamento próprio ganha uma tabela a mais em volta dos blocos:
 * uma linha, uma célula com o padding, e dentro dela a tabela dos blocos. Esta
 * função desce por esse embrulho e devolve a tabela dos blocos junto com o
 * espaçamento encontrado, que o modelo não guarda na coluna e por isso será
 * somado ao dos blocos — é o que preserva o vão entre duas colunas lado a lado.
 *
 * Só desce quando a tabela de dentro é uma tabela de blocos (`width="100%"`,
 * como o gerador sempre escreve): a tabelinha que embrulha uma imagem não tem
 * isso, e descer nela transformaria a imagem em conteúdo solto.
 */
function abrirEmbrulhoDaColuna(
  tabelaInicial: Element
): { tabela: Element; espacamento: number[] | null } {
  let tabela = tabelaInicial;
  let espacamento: number[] | null = null;

  for (let i = 0; i < 3; i++) {
    const linhas = linhasDaTabela(tabela);
    if (linhas.length !== 1) break;
    const td = filho(linhas[0], "TD");
    if (!td || filhosElemento(td).length !== 1) break;
    const dentro = filho(td, "TABLE");
    if (!dentro || dentro.getAttribute("width") !== "100%") break;

    const lido = lerEspacamento(estilo(td, "padding"));
    if (lido) {
      espacamento = espacamento
        ? espacamento.map((v, j) => v + lido[j])
        : lido;
    }
    tabela = dentro;
  }

  return { tabela, espacamento };
}

/**
 * Soma o espaçamento da coluna ao do bloco.
 *
 * Laterais valem para todos os blocos (é o vão da coluna); topo entra só no
 * primeiro e base só no último, senão o espaço se repetiria a cada bloco.
 */
function comEspacamentoDaColuna(
  bloco: Block,
  coluna: number[],
  primeiro: boolean,
  ultimo: boolean
): Block {
  const attrs = bloco.attrs as { padding?: string };
  if (typeof attrs.padding !== "string") return bloco;
  const doBloco = lerEspacamento(attrs.padding);
  if (!doBloco) return bloco;

  const somado = [
    doBloco[0] + (primeiro ? coluna[0] : 0),
    doBloco[1] + coluna[1],
    doBloco[2] + (ultimo ? coluna[2] : 0),
    doBloco[3] + coluna[3],
  ];
  return {
    ...bloco,
    attrs: { ...bloco.attrs, padding: escreverEspacamento(somado) },
  } as Block;
}

function converterColuna(div: Element): Column | null {
  const primeiraTabela = div.querySelector("table");
  if (!primeiraTabela) return null;
  const { tabela, espacamento } = abrirEmbrulhoDaColuna(primeiraTabela);

  const blocos: Block[] = [];
  for (const tr of linhasDaTabela(tabela)) {
    const td = filho(tr, "TD");
    if (!td) return null;
    const bloco = converterBloco(td);
    if (!bloco) return null;
    blocos.push(bloco);
  }
  if (blocos.length === 0) return null;

  const coluna = createColumn(larguraDaColuna(div));
  coluna.blocks = espacamento
    ? blocos.map((b, i) =>
        comEspacamentoDaColuna(
          b,
          espacamento,
          i === 0,
          i === blocos.length - 1
        )
      )
    : blocos;
  return coluna;
}

/**
 * Uma seção do e-mail → estrutura do modelo, ou null quando o formato não é
 * reconhecido (aí ela vira uma estrutura com HTML próprio).
 */
function converterSecao(html: string): Row | null {
  const doc = new DOMParser().parseFromString(
    `<div id="__raiz__">${html}</div>`,
    "text/html"
  );
  const raiz = doc.getElementById("__raiz__");
  if (!raiz) return null;

  // O embrulho de largura fixa é a assinatura de uma seção do MJML.
  const embrulho = raiz.querySelector('div[style*="max-width"]');
  const tabela = filho(embrulho, "TABLE");
  const tr = tabela ? linhasDaTabela(tabela)[0] : null;
  const tdDaSecao = filho(tr ?? null, "TD");
  if (!embrulho || !tabela || !tdDaSecao) return null;

  const colunas: Column[] = [];
  for (const div of Array.from(
    tdDaSecao.querySelectorAll('div[class*="mj-column-"]')
  )) {
    const coluna = converterColuna(div);
    if (!coluna) return null;
    colunas.push(coluna);
  }
  if (colunas.length === 0) return null;

  const fundo =
    estilo(tabela, "background-color") ??
    estilo(tabela, "background") ??
    tabela.getAttribute("bgcolor");

  const row = createRow([100]);
  row.columns = colunas;
  row.attrs.backgroundColor = ehHex(fundo) ? fundo.trim() : "";
  row.attrs.padding = estilo(tdDaSecao, "padding") ?? "0px";
  return row;
}

// ─── Quebra do documento em seções ───────────────────────────────

function estaEscondido(el: Element): boolean {
  return /display\s*:\s*none/i.test(el.getAttribute("style") ?? "");
}

/**
 * O container das seções.
 *
 * O MJML embrulha o e-mail inteiro numa `<div>` dentro do `<body>` (ao lado da
 * div escondida do preheader). Descer até ela é o que faz o e-mail virar várias
 * estruturas em vez de uma só. Quando não há esse embrulho — HTML colado de
 * qualquer lugar — para-se onde está, e o e-mail vira uma estrutura só:
 * continua editável, apenas sem a divisão por seções.
 */
function acharContainer(body: HTMLElement): Element {
  let atual: Element = body;
  for (let i = 0; i < 5; i++) {
    const filhos = filhosElemento(atual).filter((el) => !estaEscondido(el));
    if (
      filhos.length === 1 &&
      filhos[0].tagName === "DIV" &&
      filhos[0].children.length > 1
    ) {
      atual = filhos[0];
      continue;
    }
    break;
  }
  return atual;
}

/**
 * Agrupa os nós do container em seções.
 *
 * Cada seção do MJML sai cercada de comentários condicionais do Outlook
 * (`<!--[if mso | IE]>…`), que abrem uma tabela antes da `<div>` e a fecham
 * depois. Cortar só nos elementos deixaria essas metades órfãs em seções
 * diferentes e quebraria o e-mail no Outlook — por isso o grupo só fecha no
 * comentário seguinte ao próximo elemento.
 */
interface Grupo {
  html: string;
  /** Os elementos do grupo, vivos no documento renderizado. */
  elementos: Element[];
}

function agruparSecoes(container: Element): Grupo[] {
  const grupos: Grupo[] = [];
  let atual: string[] = [];
  let elementos: Element[] = [];
  let temElemento = false;

  for (const no of Array.from(container.childNodes)) {
    if (no.nodeType === Node.TEXT_NODE) {
      if (!no.textContent?.trim()) continue;
      atual.push(no.textContent);
      continue;
    }
    if (no.nodeType === Node.COMMENT_NODE) {
      atual.push(`<!--${(no as Comment).data}-->`);
      continue;
    }
    if (no.nodeType !== Node.ELEMENT_NODE) continue;

    const el = no as Element;
    if (estaEscondido(el)) continue;

    if (temElemento) {
      grupos.push({ html: atual.join(""), elementos });
      atual = [];
      elementos = [];
    }
    atual.push(el.outerHTML);
    elementos.push(el);
    temElemento = true;
  }

  if (temElemento) grupos.push({ html: atual.join(""), elementos });
  return grupos
    .map((g) => ({ ...g, html: g.html.trim() }))
    .filter((g) => g.html);
}

function linhaComHtml(html: string): Row {
  const row = createRow([100]);
  row.attrs.padding = "0px";
  row.attrs.backgroundColor = "";
  row.customHtml = html;
  return row;
}

export interface ResultadoDaImportacao {
  design: EmailDesign;
  /** Seções que viraram blocos editáveis do modelo. */
  convertidas: number;
  /** Seções que continuaram como HTML próprio (formato não reconhecido). */
  cruas: number;
}

/**
 * HTML de um e-mail → documento do Criador.
 *
 * `html` é o HTML JÁ COMPILADO, com as variáveis ainda no lugar: importar
 * depois da substituição gravaria os dados de exemplo dentro do template.
 */
export function importarHtmlParaDesign(html: string): ResultadoDaImportacao {
  const limpo = limparHtmlDoUsuario(html);
  return comDocumentoRenderizado(limpo, (doc, win) => {
    const p = criarPalco(doc, win);
    const settings: DesignSettings = { ...DEFAULT_SETTINGS };

    const grupos = agruparSecoes(acharContainer(doc.body));

    if (grupos.length === 0) {
      // Nada reconhecível para quebrar: guarda o e-mail inteiro como HTML
      // próprio do documento — o aviso do editor explica que quem manda ali é
      // o código.
      return {
        design: { version: 1, settings, rows: [], customHtml: limpo },
        convertidas: 0,
        cruas: 0,
      };
    }

    const rows: Row[] = [];
    const familias = new Map<string, string>();
    let convertidas = 0;
    let cruas = 0;
    for (const grupo of grupos) {
      // Primeiro a leitura exata do MJML; o que ela não reconhece vai para a
      // leitura pela renderização; só o que nem esta consegue fica como código.
      const linha = converterSecao(grupo.html);
      if (linha) {
        rows.push(linha);
        convertidas += 1;
        continue;
      }
      const generica = converterElementosEmLinhas(p, grupo.elementos);
      if (generica.rows.length > 0) {
        rows.push(...generica.rows);
        convertidas += generica.convertidas;
        cruas += generica.cruas;
        generica.familias.forEach((familia, id) => familias.set(id, familia));
      } else {
        rows.push(linhaComHtml(grupo.html));
        cruas += 1;
      }
    }

    // As configurações do e-mail vêm do próprio e-mail: o fundo da página, a
    // tipografia que domina e, como fundo do conteúdo, a cor mais comum entre
    // as seções — para o canvas e o e-mail combinarem já na abertura.
    settings.bodyBackground = fundoDaPagina(p) ?? settings.bodyBackground;
    const tipografia = amostrarTipografia(p, doc.body);
    if (tipografia) Object.assign(settings, tipografia);
    const fundos = new Map<string, number>();
    for (const row of rows) {
      const cor = row.attrs.backgroundColor;
      if (cor) fundos.set(cor, (fundos.get(cor) ?? 0) + 1);
    }
    let maior = 0;
    for (const [cor, n] of fundos) {
      if (n > maior) {
        maior = n;
        settings.contentBackground = cor;
      }
    }

    // Seção da cor do conteúdo passa a herdar (""): o controle global vale
    // para ela. O mesmo vale para a cor e a fonte dos blocos de texto.
    const rowsFinais = aplicarTipografia(
      rows.map((row) =>
        row.attrs.backgroundColor === settings.contentBackground
          ? { ...row, attrs: { ...row.attrs, backgroundColor: "" } }
          : row
      ),
      settings,
      familias
    );

    // O `<style>` do cabeçalho (media queries do MJML) só faz falta enquanto
    // sobrar seção crua: o que virou bloco é recompilado e ganha as regras de
    // novo. Guardá-lo à toa duplicaria CSS dentro do e-mail.
    if (cruas > 0) {
      const estilos = Array.from(doc.querySelectorAll("style"))
        .map((el) => el.outerHTML)
        .join("\n");
      const primeiraCrua = rowsFinais.find((r) => r.customHtml);
      if (estilos && primeiraCrua) {
        primeiraCrua.customHtml = `${estilos}\n${primeiraCrua.customHtml}`;
      }
    }

    return {
      design: { version: 1, settings, rows: rowsFinais },
      convertidas,
      cruas,
    };
  });
}

/**
 * Frase para a tela sobre o que a importação conseguiu montar.
 *
 * Importa dizer: bloco editável e HTML próprio se editam de maneiras
 * diferentes, e saber em qual dos dois se está evita procurar um controle que
 * não existe naquela seção.
 */
export function descreverImportacao(
  resultado: ResultadoDaImportacao
): string {
  const { convertidas, cruas, design } = resultado;
  if (convertidas === 0 && cruas === 0) {
    return design.customHtml
      ? "O formato não pôde ser dividido em seções, então o e-mail inteiro ficou como HTML próprio."
      : "";
  }
  if (cruas === 0) {
    return convertidas === 1
      ? "A seção do e-mail virou estrutura com blocos editáveis."
      : `As ${convertidas} seções do e-mail viraram estruturas com blocos editáveis.`;
  }
  if (convertidas === 0) {
    return `${cruas === 1 ? "A seção" : `As ${cruas} seções`} do e-mail ${cruas === 1 ? "ficou" : "ficaram"} como HTML próprio: o formato não corresponde aos blocos do criador. O texto continua editável na tela, e as imagens são trocáveis no painel.`;
  }
  return `${convertidas} de ${convertidas + cruas} seções viraram blocos editáveis; ${cruas === 1 ? "a outra ficou" : `as outras ${cruas} ficaram`} como HTML próprio, com o texto ainda editável na tela.`;
}
