// Conversão de HTML livre — de qualquer origem — em estruturas e blocos do
// Criador de email.
//
// O importador (importar.ts) reconhece o HTML que o próprio MJML gera: cada
// seção tem assinatura conhecida e os atributos saem exatos. Um e-mail vindo
// de outra ferramenta, ou escrito à mão, não tem assinatura nenhuma: tabela
// dentro de tabela, estilo por classe, alinhamento por atributo, espaço por
// célula vazia. Ler isso "no papel" seria reescrever o navegador. Então quem
// lê é o navegador: o HTML é renderizado num iframe invisível e o que se lê é
// o RESULTADO — o estilo computado (fonte, cor, entrelinha, com herança e folha
// de estilo já resolvidas) e a geometria (onde cada pedaço ficou). Da geometria
// saem colunas, alinhamentos e espaçamentos; do estilo, os atributos dos blocos.
//
// Regra herdada do importador: NENHUM caminho perde conteúdo. Cada seção
// convertida é conferida (texto e imagens) contra o original; se algo faltou,
// ela fica como HTML próprio — ainda editável na tela, com imagens trocáveis,
// só não em blocos.
//
// Roda só no navegador (iframe + getComputedStyle), como o resto do criador.

import { limparHtmlDoUsuario } from "./codigo";
import { createColumn, createRow, uid } from "./ops";
import { DEFAULT_SETTINGS, FONT_OPTIONS } from "./presets";
import type {
  Block,
  ButtonBlock,
  DesignSettings,
  DividerBlock,
  ImageBlock,
  Row,
  SocialBlock,
  SocialItem,
  TextBlock,
} from "./types";

// ─── Palco: o HTML renderizado num iframe invisível ──────────────

/**
 * Largura do palco. Bem mais que os 600px de um e-mail, para que a coluna de
 * conteúdo (a tabela de 600) fique estreita em relação aos embrulhos de
 * largura total — é essa diferença que separa "embrulho que centraliza" de
 * "embrulho que dá espaçamento".
 */
const LARGURA_DO_PALCO = 1000;
/** Abaixo disto, o elemento é coluna de conteúdo; acima, embrulho de página. */
const LARGURA_MAXIMA_DO_CONTEUDO = 900;

/**
 * Renderiza `html` num iframe fora da tela e entrega o documento pronto para
 * ser lido — estilos computados e geometria. O iframe some ao terminar.
 *
 * Sem `allow-scripts`: nada do HTML colado roda, nem por acidente. É a mesma
 * garantia que limparHtmlDoUsuario dá por texto, agora dada pelo navegador.
 */
export function comDocumentoRenderizado<T>(
  html: string,
  trabalho: (doc: Document, win: Window) => T
): T {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText = `position:absolute;left:-10000px;top:0;width:${LARGURA_DO_PALCO}px;height:1200px;border:0;visibility:hidden;pointer-events:none;`;
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      throw new Error("Não foi possível preparar a leitura do HTML.");
    }
    doc.open();
    doc.write(html);
    doc.close();
    return trabalho(doc, win);
  } finally {
    iframe.remove();
  }
}

export interface Palco {
  doc: Document;
  win: Window;
  estilo(el: Element): CSSStyleDeclaration;
  rect(el: Element): DOMRect;
}

/** Leitura do documento renderizado, com cache: nada no palco muda. */
export function criarPalco(doc: Document, win: Window): Palco {
  const estilos = new WeakMap<Element, CSSStyleDeclaration>();
  const rects = new WeakMap<Element, DOMRect>();
  return {
    doc,
    win,
    estilo(el) {
      let cs = estilos.get(el);
      if (!cs) {
        cs = win.getComputedStyle(el);
        estilos.set(el, cs);
      }
      return cs;
    },
    rect(el) {
      let r = rects.get(el);
      if (!r) {
        r = el.getBoundingClientRect();
        rects.set(el, r);
      }
      return r;
    },
  };
}

// ─── Leitura de estilo ───────────────────────────────────────────

function px(valor: string | null | undefined): number {
  const n = parseFloat(valor ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** Cor computada (rgb/rgba) → hex maiúsculo; transparente → null. */
function hex(valor: string | null | undefined): string | null {
  const v = valor?.trim() ?? "";
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  const m = v.match(
    /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i
  );
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  const c = (n: string) => Math.min(255, Number(n)).toString(16).padStart(2, "0");
  return `#${c(m[1])}${c(m[2])}${c(m[3])}`.toUpperCase();
}

function peso(valor: string): number {
  if (valor === "bold" || valor === "bolder") return 700;
  const n = parseInt(valor, 10);
  return Number.isFinite(n) ? n : 400;
}

/** Primeira família da lista, sem aspas e em minúsculas — para comparar. */
function primeiraFamilia(valor: string): string {
  return (valor.split(",")[0] ?? "").replace(/["']/g, "").trim().toLowerCase();
}

/** A lista de fontes sem nada que não seja nome de fonte (vai num style="…"). */
function familiaSegura(valor: string): string {
  return valor.replace(/"/g, "'").replace(/[^A-Za-z0-9 ,'\-]/g, "").trim();
}

/** Entrelinha como múltiplo da fonte, que é como o bloco de texto a guarda. */
function entrelinha(cs: CSSStyleDeclaration): number {
  const fonte = px(cs.fontSize);
  const lh = px(cs.lineHeight);
  // "normal" não tem número: o navegador desenha perto de 1,2.
  if (!fonte || !lh) return 1.2;
  return Math.round((lh / fonte) * 100) / 100;
}

type Alinhamento = "left" | "center" | "right";

function alinhamentoDoTexto(cs: CSSStyleDeclaration): Alinhamento {
  const v = cs.textAlign.replace(/^-(webkit|moz)-/, "");
  if (v === "center") return "center";
  if (v === "right" || v === "end") return "right";
  return "left";
}

// ─── O que é o quê no documento ──────────────────────────────────

const IGNORADAS = new Set([
  "SCRIPT", "STYLE", "HEAD", "META", "LINK", "TITLE", "TEMPLATE", "NOSCRIPT",
  "BASE", "OBJECT", "EMBED", "IFRAME", "SVG", "MAP", "AREA", "INPUT", "BUTTON",
  "SELECT", "TEXTAREA",
]);

const INLINE = new Set([
  "A", "SPAN", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "INS",
  "SUP", "SUB", "SMALL", "BIG", "FONT", "CODE", "LABEL", "ABBR", "CITE", "Q",
  "MARK", "TIME", "WBR", "BR", "TT", "KBD", "SAMP", "VAR", "DFN", "BDI", "BDO",
]);

/** Elementos que embrulham outros — a divisão em seções desce por eles. */
const CONTEINERES = new Set([
  "TABLE", "DIV", "CENTER", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN",
  "ASIDE", "NAV", "FORM", "BODY", "FIGURE", "TD", "TH", "BLOCKQUOTE",
]);

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function escondido(p: Palco, el: Element): boolean {
  const tag = el.tagName;
  if (IGNORADAS.has(tag)) return true;
  if (tag === "BR" || tag === "WBR") return false;
  const cs = p.estilo(el);
  if (
    cs.display === "none" ||
    cs.visibility === "hidden" ||
    parseFloat(cs.opacity) === 0
  ) {
    return true;
  }
  // Imagem ainda carregando mede 0×0 — e não é por isso que ela some. O
  // `<hr>` mede 1px de altura e vem com overflow:hidden do navegador: também
  // não é preheader.
  if (tag === "IMG" || tag === "HR") return false;
  const r = p.rect(el);
  if (r.width <= 1 && r.height <= 1 && !el.querySelector("img")) return true;
  // Preheader: texto escondido por altura zero ou por fonte de 1px. A fonte
  // zero só conta com texto direto dentro — `font-size:0` também é o truque
  // que tira o vão entre colunas inline-block, e essas têm que ser lidas.
  const temTextoDireto = Array.from(el.childNodes).some(
    (n) => n.nodeType === 3 && normalizar(n.textContent)
  );
  if (r.height <= 1 && cs.overflow === "hidden" && normalizar(el.textContent)) {
    return true;
  }
  if (px(cs.fontSize) <= 1 && temTextoDireto) return true;
  return false;
}

function ehInline(p: Palco, el: Element): boolean {
  if (el.tagName === "IMG") return false;
  const d = p.estilo(el).display;
  return (
    d === "inline" ||
    d === "contents" ||
    (d === "inline-block" && INLINE.has(el.tagName))
  );
}

/** Texto que aparece — o que está escondido não conta. */
function textoVisivel(p: Palco, no: Node): string {
  if (no.nodeType === 3) return no.textContent ?? "";
  if (no.nodeType !== 1) return "";
  const el = no as Element;
  if (escondido(p, el)) return "";
  if (el.tagName === "BR") return " ";
  let s = "";
  for (const filho of Array.from(el.childNodes)) s += textoVisivel(p, filho);
  return ehInline(p, el) ? s : ` ${s} `;
}

function imagensVisiveis(p: Palco, no: Node, saida: Element[] = []): Element[] {
  if (no.nodeType !== 1) return saida;
  const el = no as Element;
  if (escondido(p, el)) return saida;
  if (el.tagName === "IMG") {
    saida.push(el);
    return saida;
  }
  for (const filho of Array.from(el.childNodes)) imagensVisiveis(p, filho, saida);
  return saida;
}

function temConteudo(p: Palco, el: Element): boolean {
  if (escondido(p, el)) return false;
  return (
    normalizar(textoVisivel(p, el)).length > 0 ||
    imagensVisiveis(p, el).length > 0
  );
}

/** Largura declarada da imagem (atributo ou estilo); null = não declarada. */
function larguraDaImagem(p: Palco, img: Element): number | null {
  const attr = img.getAttribute("width")?.trim() ?? "";
  if (/^\d+(\.\d+)?(px)?$/i.test(attr) && parseFloat(attr) > 0) {
    return parseFloat(attr);
  }
  const inline = (img as HTMLElement).style?.width ?? "";
  if (/^\d+(\.\d+)?px$/i.test(inline)) return parseFloat(inline);
  const el = img as HTMLImageElement;
  if (el.complete && el.naturalWidth > 0) {
    const w = p.rect(img).width;
    return w > 0 ? w : null;
  }
  return null;
}

/** Ícone no meio do texto (emoji em imagem, seta): fica no texto, não vira bloco. */
function imagemPequena(p: Palco, img: Element): boolean {
  const w = larguraDaImagem(p, img) ?? p.rect(img).width;
  return w > 0 && w <= 32;
}

/** Ícone de rede social: pequeno, e quase sempre com link. */
function ehIcone(p: Palco, img: Element): boolean {
  const w = larguraDaImagem(p, img) ?? p.rect(img).width;
  return w > 0 && w <= 64;
}

/** Só texto e ênfase dentro — o que cabe num bloco de texto. */
function soTemInline(p: Palco, el: Element): boolean {
  for (const no of Array.from(el.childNodes)) {
    if (no.nodeType !== 1) continue;
    const f = no as Element;
    if (escondido(p, f)) continue;
    if (f.tagName === "IMG") {
      if (!imagemPequena(p, f)) return false;
      continue;
    }
    if (f.tagName === "A" && pareceBotao(p, f)) return false;
    if (!ehInline(p, f) || !soTemInline(p, f)) return false;
  }
  return true;
}

/** Primeira cor de fundo opaca subindo pelos ancestrais (o próprio excluído). */
function fundoAoRedor(p: Palco, el: Element): string | null {
  let atual: Element | null = el.parentElement;
  while (atual) {
    const cor = hex(p.estilo(atual).backgroundColor);
    if (cor) return cor;
    atual = atual.parentElement;
  }
  return null;
}

/**
 * Link que é botão: tem fundo ou borda próprios e não corre no meio do
 * texto — ou é a única coisa dentro de uma célula colorida (o botão clássico
 * de tabela). Uma célula da cor do que está em volta não é botão: é só uma
 * célula numa área colorida.
 */
function pareceBotao(p: Palco, a: Element): boolean {
  if (a.tagName !== "A") return false;
  if (imagensVisiveis(p, a).length > 0) return false;
  const texto = normalizar(textoVisivel(p, a));
  if (!texto || texto.length > 80) return false;

  const cs = p.estilo(a);
  const fundo = hex(cs.backgroundColor);
  const borda = px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none";
  if (fundo || borda) {
    if (cs.display !== "inline") return true;
    if (px(cs.paddingLeft) + px(cs.paddingRight) > 0) return true;
  }

  const celula = a.parentElement?.closest("td,th") ?? null;
  if (!celula) return false;
  const corDaCelula = hex(p.estilo(celula).backgroundColor);
  if (!corDaCelula || corDaCelula === fundoAoRedor(p, celula)) return false;
  if (normalizar(textoVisivel(p, celula)) !== texto) return false;
  const r = p.rect(celula);
  return r.width <= 420 && r.height <= 96;
}

/**
 * Linha divisória: `<hr>`, ou um elemento vazio que só tem uma borda (ou uma
 * faixa fininha de cor) para mostrar.
 */
function pareceDivisor(p: Palco, el: Element): boolean {
  if (escondido(p, el)) return false;
  if (el.tagName === "HR") return true;
  if (normalizar(textoVisivel(p, el)) || imagensVisiveis(p, el).length) {
    return false;
  }
  const cs = p.estilo(el);
  const r = p.rect(el);
  const topo = px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none";
  const base = px(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== "none";
  if (topo || base) return r.height <= 40;
  return r.height >= 1 && r.height <= 4 && r.width > 0 && Boolean(hex(cs.backgroundColor));
}

function linhasDaTabela(tabela: Element): Element[] {
  const linhas: Element[] = [];
  for (const filho of Array.from(tabela.children)) {
    if (filho.tagName === "TR") linhas.push(filho);
    else if (["TBODY", "THEAD", "TFOOT"].includes(filho.tagName)) {
      linhas.push(...Array.from(filho.children).filter((f) => f.tagName === "TR"));
    }
  }
  return linhas;
}

function celulasDaLinha(p: Palco, tr: Element): Element[] {
  return Array.from(tr.children).filter(
    (c) => (c.tagName === "TD" || c.tagName === "TH") && !escondido(p, c)
  );
}

/** A caixa em que uma tabela está — para saber se ela está alinhada. */
function containerDe(el: Element): Element {
  let atual = el.parentElement;
  while (atual && ["TBODY", "THEAD", "TFOOT", "TR", "TABLE"].includes(atual.tagName)) {
    atual = atual.parentElement;
  }
  return atual ?? el;
}

// ─── Geometria ───────────────────────────────────────────────────

interface Caixa {
  topo: number;
  base: number;
  esquerda: number;
  direita: number;
}

function caixaDaBorda(p: Palco, el: Element): Caixa {
  const r = p.rect(el);
  return { topo: r.top, base: r.bottom, esquerda: r.left, direita: r.right };
}

function caixaDeConteudo(p: Palco, el: Element): Caixa {
  const r = p.rect(el);
  const cs = p.estilo(el);
  return {
    topo: r.top + px(cs.borderTopWidth) + px(cs.paddingTop),
    base: r.bottom - px(cs.borderBottomWidth) - px(cs.paddingBottom),
    esquerda: r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft),
    direita: r.right - px(cs.borderRightWidth) - px(cs.paddingRight),
  };
}

/** Retângulo que envolve uma sequência de nós irmãos (texto inclusive). */
function retanguloDosNos(p: Palco, nos: Node[]): DOMRect | null {
  if (nos.length === 0) return null;
  const range = p.doc.createRange();
  range.setStartBefore(nos[0]);
  range.setEndAfter(nos[nos.length - 1]);
  const r = range.getBoundingClientRect();
  return r.width > 0 || r.height > 0 ? r : null;
}

/** Onde algo está dentro da sua caixa: folga igual dos dois lados é centro. */
function alinhamentoPorGeometria(
  esq: number,
  dir: number,
  contEsq: number,
  contDir: number
): Alinhamento {
  const folgaEsq = esq - contEsq;
  const folgaDir = contDir - dir;
  if (Math.abs(folgaEsq - folgaDir) <= 3) return "center";
  return folgaEsq < folgaDir ? "left" : "right";
}

function ladoALado(p: Palco, a: Element, b: Element): boolean {
  const ra = p.rect(a);
  const rb = p.rect(b);
  if (ra.width <= 0 || rb.width <= 0) return false;
  return rb.left >= ra.right - 2 && rb.top < ra.bottom + 2 && rb.bottom > ra.top - 2;
}

function todosLadoALado(p: Palco, els: Element[]): boolean {
  if (els.length < 2) return false;
  for (let i = 1; i < els.length; i++) {
    if (!ladoALado(p, els[i - 1], els[i])) return false;
  }
  return true;
}

// ─── Serialização do conteúdo de um bloco de texto ───────────────
//
// O `html` do bloco é HTML livre, mas a tipografia base (fonte, cor, tamanho)
// vem dos atributos do bloco. Então o que se escreve aqui é só o que DIFERE da
// base — negrito num trecho, uma cor, um link — e o resto herda. É o que deixa
// os controles do painel valendo sobre o texto importado.

function escapar(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(valor: string): string {
  return escapar(valor).replace(/"/g, "&quot;");
}

function hrefDe(el: Element | null): string | null {
  const href = el?.getAttribute("href")?.trim();
  if (!href) return null;
  return /^(https?:|mailto:|tel:|#|\{\{)/i.test(href) ? href : null;
}

/** Qualquer endereço serve — imagem quebrada se troca no painel. */
function srcSeguro(src: string | null | undefined): string | null {
  const v = src?.trim();
  if (!v || /^javascript:/i.test(v)) return null;
  return v;
}

function textoDeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(
    `<div>${html.replace(/<br\s*\/?>/gi, " ").replace(/<\/(li|p|div)>/gi, " ")}</div>`,
    "text/html"
  );
  return doc.body.textContent ?? "";
}

interface Diferencas {
  strong: boolean;
  em: boolean;
  u: boolean;
  s: boolean;
  estilo: string;
}

function diferencas(
  cs: CSSStyleDeclaration,
  base: CSSStyleDeclaration,
  ehLink: boolean
): Diferencas {
  const d: Diferencas = { strong: false, em: false, u: false, s: false, estilo: "" };
  const partes: string[] = [];

  // Link leva a cor sempre: a regra global `a { color }` do e-mail venceria
  // a cor herdada, e um link discreto no rodapé viraria azul.
  const cor = hex(cs.color);
  if (cor && (ehLink || cor !== hex(base.color))) partes.push(`color:${cor}`);

  const tamanho = Math.round(px(cs.fontSize));
  if (tamanho && tamanho !== Math.round(px(base.fontSize))) {
    partes.push(`font-size:${tamanho}px`);
  }

  const pesoEl = peso(cs.fontWeight);
  const pesoBase = peso(base.fontWeight);
  if (pesoEl >= 600 && pesoBase < 600) d.strong = true;
  else if (pesoEl < 600 && pesoBase >= 600) partes.push("font-weight:400");

  const italico = cs.fontStyle === "italic" || cs.fontStyle === "oblique";
  const italicoBase = base.fontStyle === "italic" || base.fontStyle === "oblique";
  if (italico && !italicoBase) d.em = true;
  else if (!italico && italicoBase) partes.push("font-style:normal");

  const decoracao = cs.textDecorationLine || cs.textDecoration;
  const decoracaoBase = base.textDecorationLine || base.textDecoration;
  if (ehLink) {
    // Link vem sublinhado por padrão nos clientes de e-mail: só o "sem
    // sublinhado" precisa ser dito.
    if (!/underline/.test(decoracao)) partes.push("text-decoration:none");
  } else if (/underline/.test(decoracao) && !/underline/.test(decoracaoBase)) {
    d.u = true;
  }
  if (/line-through/.test(decoracao) && !/line-through/.test(decoracaoBase)) {
    d.s = true;
  }

  const familia = primeiraFamilia(cs.fontFamily);
  if (familia && familia !== primeiraFamilia(base.fontFamily)) {
    partes.push(`font-family:${familiaSegura(cs.fontFamily)}`);
  }
  if (cs.textTransform !== "none" && cs.textTransform !== base.textTransform) {
    partes.push(`text-transform:${cs.textTransform}`);
  }

  d.estilo = partes.join(";");
  return d;
}

function envolver(interno: string, d: Diferencas, href: string | null): string {
  let s = interno;
  if (d.strong) s = `<strong>${s}</strong>`;
  if (d.em) s = `<em>${s}</em>`;
  if (d.u) s = `<u>${s}</u>`;
  if (d.s) s = `<s>${s}</s>`;
  const estilo = d.estilo ? ` style="${d.estilo}"` : "";
  if (href !== null) return `<a href="${escAttr(href)}"${estilo}>${s}</a>`;
  return d.estilo ? `<span${estilo}>${s}</span>` : s;
}

function imgInline(p: Palco, img: Element): string {
  const src = srcSeguro(img.getAttribute("src"));
  if (!src) return "";
  const w = larguraDaImagem(p, img) ?? p.rect(img).width;
  const h = p.rect(img).height;
  const tamanho =
    w > 0
      ? ` width="${Math.round(w)}"${h > 0 ? ` height="${Math.round(h)}"` : ""}`
      : "";
  return `<img src="${escAttr(src)}" alt="${escAttr(img.getAttribute("alt") ?? "")}"${tamanho} style="vertical-align:middle;border:0;">`;
}

function serializarInline(p: Palco, nos: Node[], base: CSSStyleDeclaration): string {
  let saida = "";
  nos.forEach((no, i) => {
    if (no.nodeType === 3) {
      saida += escapar((no.textContent ?? "").replace(/[ \t\r\n\f]+/g, " "));
      return;
    }
    if (no.nodeType !== 1) return;
    const el = no as Element;
    const tag = el.tagName;
    if (escondido(p, el)) return;
    if (tag === "BR") {
      saida += "<br>";
      return;
    }
    if (tag === "IMG") {
      saida += imgInline(p, el);
      return;
    }
    if (tag === "UL" || tag === "OL") {
      saida += serializarLista(p, el, base);
      return;
    }
    const cs = p.estilo(el);
    const interno = serializarInline(p, Array.from(el.childNodes), cs);
    if (!interno.trim()) {
      saida += interno; // só espaço: fica o espaço, sem a tag
      return;
    }
    const href = tag === "A" ? hrefDe(el) : null;
    saida += envolver(interno, diferencas(cs, base, href !== null), href);
    // Bloco no meio de conteúdo corrido (um <p> dentro de <li>): quebra a linha.
    if (!ehInline(p, el) && i < nos.length - 1) saida += "<br>";
  });
  return saida;
}

function serializarLista(p: Palco, lista: Element, base: CSSStyleDeclaration): string {
  const tag = lista.tagName === "OL" ? "ol" : "ul";
  const itens = Array.from(lista.children)
    .filter((li) => li.tagName === "LI" && !escondido(p, li))
    .map((li) => {
      const cs = p.estilo(li);
      const interno = serializarInline(p, Array.from(li.childNodes), cs).trim();
      return `<li>${envolver(interno, diferencas(cs, base, false), null)}</li>`;
    })
    .join("");
  return `<${tag} style="margin:0;padding-left:24px;">${itens}</${tag}>`;
}

// ─── Folhas: cada pedaço lido, com a caixa em que ele ficou ──────

interface FolhaBloco {
  tipo: "bloco";
  bloco: Block;
  /**
   * Vertical: onde o conteúdo do bloco começa e termina. Horizontal: a caixa
   * em que ele está — é dela que sai o espaçamento lateral, e o alinhamento
   * já foi decidido pela posição dentro dela.
   */
  caixa: Caixa;
  /** Retângulo do próprio elemento (imagens): para agrupar ícones sociais. */
  propria?: DOMRect;
}

interface FolhaColunas {
  tipo: "colunas";
  partes: Element[];
  caixa: Caixa;
}

type Folha = FolhaBloco | FolhaColunas;

interface Contexto {
  p: Palco;
  /**
   * 0 = direto na seção, onde colunas viram estruturas. Coluna dentro de
   * coluna não cabe no modelo: acima de zero, o que está lado a lado é
   * empilhado, na ordem — como o celular já mostra.
   */
  profundidade: number;
  /** href de um `<a>` que envolve tudo o que está sendo lido. */
  link: string | null;
  /** Fonte de cada bloco de texto, para depois comparar com a do e-mail. */
  familias: Map<string, string>;
}

/**
 * Um único `<span>`/`<font>` envolvendo tudo é quem manda no estilo: é ele
 * que vira a base do bloco, e não a moldura de fora.
 */
function miolo(p: Palco, el: Element): Element {
  let atual = el;
  for (let i = 0; i < 3; i++) {
    const filhos = Array.from(atual.childNodes).filter((n) =>
      n.nodeType === 1 ? !escondido(p, n as Element) : normalizar(n.textContent).length > 0
    );
    const unico =
      filhos.length === 1 && filhos[0].nodeType === 1 ? (filhos[0] as Element) : null;
    if (!unico || (unico.tagName !== "SPAN" && unico.tagName !== "FONT")) break;
    atual = unico;
  }
  return atual;
}

function blocoDeTexto(
  base: CSSStyleDeclaration,
  html: string,
  ctx: Contexto
): TextBlock {
  let conteudo = html.trim();
  // A moldura do bloco não sabe de peso/itálico/sublinhado: entram no conteúdo.
  if (peso(base.fontWeight) >= 600) conteudo = `<strong>${conteudo}</strong>`;
  if (base.fontStyle === "italic" || base.fontStyle === "oblique") {
    conteudo = `<em>${conteudo}</em>`;
  }
  if (/underline/.test(base.textDecorationLine || base.textDecoration)) {
    conteudo = `<u>${conteudo}</u>`;
  }
  if (ctx.link && !/<a\s/i.test(conteudo)) {
    conteudo = `<a href="${escAttr(ctx.link)}" style="color:${hex(base.color) ?? "inherit"};text-decoration:none">${conteudo}</a>`;
  }
  const bloco: TextBlock = {
    id: uid(),
    type: "text",
    html: conteudo,
    attrs: {
      fontSize: Math.round(px(base.fontSize)) || 14,
      lineHeight: entrelinha(base),
      color: hex(base.color) ?? "",
      align: alinhamentoDoTexto(base),
      padding: "0px",
    },
  };
  ctx.familias.set(bloco.id, base.fontFamily);
  return bloco;
}

function temTexto(html: string): boolean {
  return normalizar(textoDeHtml(html)).length > 0 || html.includes("<img");
}

/** Elemento de bloco que só tem conteúdo corrido dentro (p, h1, td…). */
function folhaDeTexto(p: Palco, el: Element, ctx: Contexto): FolhaBloco | null {
  const centro = miolo(p, el);
  const base = p.estilo(centro);
  const html = serializarInline(p, Array.from(centro.childNodes), base);
  if (!temTexto(html)) return null;
  return {
    tipo: "bloco",
    bloco: blocoDeTexto(base, html, ctx),
    caixa: caixaDeConteudo(p, el),
  };
}

/** Sequência de texto e ênfases soltos dentro de uma caixa (sem <p> em volta). */
function folhaDeCorrida(
  p: Palco,
  nos: Node[],
  container: Element,
  ctx: Contexto
): FolhaBloco | null {
  const vazio = (n: Node) =>
    n.nodeType === 3
      ? !normalizar(n.textContent)
      : n.nodeType === 1 && (n as Element).tagName === "BR";
  let inicio = 0;
  let fim = nos.length;
  while (inicio < fim && vazio(nos[inicio])) inicio++;
  while (fim > inicio && vazio(nos[fim - 1])) fim--;
  const uteis = nos.slice(inicio, fim);
  if (uteis.length === 0) return null;

  let centro: Element = container;
  let conteudo: Node[] = uteis;
  const unico = uteis.length === 1 && uteis[0].nodeType === 1 ? (uteis[0] as Element) : null;
  if (unico && (unico.tagName === "SPAN" || unico.tagName === "FONT")) {
    centro = miolo(p, unico);
    conteudo = Array.from(centro.childNodes);
  }
  const base = p.estilo(centro);
  const html = serializarInline(p, conteudo, base);
  if (!temTexto(html)) return null;

  const cont = caixaDeConteudo(p, container);
  const r = retanguloDosNos(p, uteis);
  return {
    tipo: "bloco",
    bloco: blocoDeTexto(base, html, ctx),
    caixa: {
      topo: r ? r.top : cont.topo,
      base: r ? r.bottom : cont.base,
      esquerda: cont.esquerda,
      direita: cont.direita,
    },
  };
}

function folhaDeImagem(
  p: Palco,
  img: Element,
  container: Element,
  ctx: Contexto
): FolhaBloco | null {
  const src = srcSeguro(img.getAttribute("src"));
  if (!src) return null;
  const cont = caixaDeConteudo(p, container);
  const larguraDoContainer = cont.direita - cont.esquerda;
  let largura = larguraDaImagem(p, img);
  // Imagem da largura da caixa é "largura total" no modelo (null) — e assim
  // encolhe junto no celular.
  if (largura !== null && largura >= larguraDoContainer - 2) largura = null;
  const r = p.rect(img);
  const align: Alinhamento =
    largura === null || r.width <= 0
      ? "center"
      : alinhamentoPorGeometria(r.left, r.right, cont.esquerda, cont.direita);
  const bloco: ImageBlock = {
    id: uid(),
    type: "image",
    src,
    alt: img.getAttribute("alt") ?? "",
    href: hrefDe(img.closest("a")) ?? ctx.link ?? "",
    attrs: {
      width: largura === null ? null : Math.round(largura),
      align,
      borderRadius: Math.round(px(p.estilo(img).borderTopLeftRadius)),
      padding: "0px",
    },
  };
  return {
    tipo: "bloco",
    bloco,
    caixa: {
      topo: r.top,
      base: r.height > 0 ? r.bottom : r.top,
      esquerda: cont.esquerda,
      direita: cont.direita,
    },
    propria: r,
  };
}

function folhaDeBotao(
  p: Palco,
  a: Element,
  container: Element,
  ctx: Contexto
): FolhaBloco {
  const cs = p.estilo(a);
  const proprio =
    Boolean(hex(cs.backgroundColor)) ||
    (px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none");
  // A caixa do botão: o link, quando ele mesmo é colorido; senão a célula.
  const caixaEl: Element = proprio ? a : (a.parentElement?.closest("td,th") ?? a);
  const csCaixa = p.estilo(caixaEl);
  const rBotao = p.rect(caixaEl);

  // Em que caixa o botão está alinhado: o primeiro ancestral mais largo que ele.
  let cont = caixaDeConteudo(p, container);
  let anc: Element | null = caixaEl.parentElement;
  while (anc) {
    if (!ehInline(p, anc)) {
      const c = caixaDeConteudo(p, anc);
      if (c.direita - c.esquerda >= rBotao.width + 4) {
        cont = c;
        break;
      }
    }
    if (anc === container) break;
    anc = anc.parentElement;
  }

  const bloco: ButtonBlock = {
    id: uid(),
    type: "button",
    text: normalizar(textoVisivel(p, a)),
    href: hrefDe(a) ?? ctx.link ?? "",
    attrs: {
      backgroundColor: hex(csCaixa.backgroundColor) ?? hex(cs.backgroundColor) ?? "#1D50DC",
      color: hex(cs.color) ?? "#FFFFFF",
      fontSize: Math.round(px(cs.fontSize)) || 15,
      borderRadius: Math.round(
        px(csCaixa.borderTopLeftRadius) || px(cs.borderTopLeftRadius)
      ),
      align: alinhamentoPorGeometria(rBotao.left, rBotao.right, cont.esquerda, cont.direita),
      padding: "0px",
    },
  };
  return {
    tipo: "bloco",
    bloco,
    caixa: { topo: rBotao.top, base: rBotao.bottom, esquerda: cont.esquerda, direita: cont.direita },
  };
}

function folhaDeDivisor(p: Palco, el: Element): FolhaBloco {
  const cs = p.estilo(el);
  const r = p.rect(el);
  const topo = px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none";
  const base = !topo && px(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== "none";
  const cor =
    (topo ? hex(cs.borderTopColor) : base ? hex(cs.borderBottomColor) : hex(cs.backgroundColor)) ??
    "#DDDDDD";
  const espessura = Math.max(
    1,
    Math.round(topo ? px(cs.borderTopWidth) : base ? px(cs.borderBottomWidth) : r.height)
  );
  // A caixa é a LINHA, não o elemento: o que sobra dele em volta vira espaço.
  const linhaTopo = base ? r.bottom - espessura : r.top;
  const bloco: DividerBlock = {
    id: uid(),
    type: "divider",
    attrs: { borderColor: cor, borderWidth: espessura, padding: "0px" },
  };
  return {
    tipo: "bloco",
    bloco,
    caixa: { topo: linhaTopo, base: linhaTopo + espessura, esquerda: r.left, direita: r.right },
  };
}

function folhaDeLista(p: Palco, lista: Element, ctx: Contexto): FolhaBloco | null {
  const base = p.estilo(lista);
  const html = serializarLista(p, lista, base);
  if (!temTexto(html)) return null;
  const r = p.rect(lista);
  return {
    tipo: "bloco",
    bloco: blocoDeTexto(base, html, ctx),
    // O recuo dos marcadores é escrito no próprio HTML: a caixa vai até a borda.
    caixa: {
      topo: r.top + px(base.borderTopWidth) + px(base.paddingTop),
      base: r.bottom - px(base.borderBottomWidth) - px(base.paddingBottom),
      esquerda: r.left,
      direita: r.right,
    },
  };
}

function folhaSocial(
  p: Palco,
  imgs: Element[],
  container: Element,
  ctx: Contexto
): FolhaBloco | null {
  const items: SocialItem[] = [];
  let tamanho = 0;
  let topo = Infinity;
  let base = -Infinity;
  let esq = Infinity;
  let dir = -Infinity;
  for (const img of imgs) {
    const src = srcSeguro(img.getAttribute("src"));
    if (!src) continue;
    items.push({
      label: img.getAttribute("alt") ?? "",
      iconSrc: src,
      href: hrefDe(img.closest("a")) ?? ctx.link ?? "",
    });
    tamanho = Math.max(tamanho, larguraDaImagem(p, img) ?? p.rect(img).width);
    const r = p.rect(img);
    topo = Math.min(topo, r.top);
    base = Math.max(base, r.bottom);
    esq = Math.min(esq, r.left);
    dir = Math.max(dir, r.right);
  }
  if (items.length < 2) return null;
  const cont = caixaDeConteudo(p, container);
  const bloco: SocialBlock = {
    id: uid(),
    type: "social",
    items,
    attrs: {
      iconSize: Math.round(tamanho) || 24,
      align: alinhamentoPorGeometria(esq, dir, cont.esquerda, cont.direita),
      padding: "0px",
    },
  };
  return {
    tipo: "bloco",
    bloco,
    caixa: { topo, base: base > topo ? base : topo, esquerda: cont.esquerda, direita: cont.direita },
  };
}

// ─── Leitura de uma caixa: o que há dentro, na ordem ─────────────

/** Elementos irmãos que ficaram lado a lado (colunas por float/inline-block). */
function gruposLadoALado(p: Palco, nos: Node[]): Map<Element, Element[]> {
  const candidatos = nos.filter((n): n is Element => {
    if (n.nodeType !== 1) return false;
    const el = n as Element;
    return !escondido(p, el) && !ehInline(p, el) && el.tagName !== "BR" && temConteudo(p, el);
  });
  const grupos = new Map<Element, Element[]>();
  let atual: Element[] = [];
  const fechar = () => {
    if (atual.length >= 2) grupos.set(atual[0], atual);
    atual = [];
  };
  for (const el of candidatos) {
    if (atual.length && ladoALado(p, atual[atual.length - 1], el)) atual.push(el);
    else {
      fechar();
      atual = [el];
    }
  }
  fechar();
  return grupos;
}

function uniao(p: Palco, els: Element[]): Caixa {
  const caixas = els.map((el) => caixaDaBorda(p, el));
  return {
    topo: Math.min(...caixas.map((c) => c.topo)),
    base: Math.max(...caixas.map((c) => c.base)),
    esquerda: Math.min(...caixas.map((c) => c.esquerda)),
    direita: Math.max(...caixas.map((c) => c.direita)),
  };
}

/** O irmão seguinte é texto (ou ênfase com texto) — a imagem corre com ele. */
function proximoEhTexto(p: Palco, no: Node): boolean {
  const prox = no.nextSibling;
  if (!prox) return false;
  if (prox.nodeType === 3) return normalizar(prox.textContent).length > 0;
  return (
    prox.nodeType === 1 &&
    INLINE.has((prox as Element).tagName) &&
    normalizar(textoVisivel(p, prox)).length > 0
  );
}

/** A corrida já tem texto de verdade (não só espaço e imagens). */
function corridaTemTexto(p: Palco, corrida: Node[]): boolean {
  return corrida.some((n) =>
    n.nodeType === 3
      ? normalizar(n.textContent).length > 0
      : n.nodeType === 1 && normalizar(textoVisivel(p, n)).length > 0
  );
}

function folhasDe(p: Palco, el: Element, ctx: Contexto): Folha[] {
  return el.tagName === "TABLE"
    ? folhasDeTabela(p, el, ctx)
    : coletarFolhas(Array.from(el.childNodes), el, ctx);
}

/**
 * Percorre os nós de uma caixa e devolve as folhas, na ordem em que aparecem.
 * Texto e ênfases soltos se juntam numa "corrida" até esbarrar em algo que é
 * bloco por si (imagem, botão, tabela, parágrafo) — aí a corrida vira bloco
 * de texto e o outro pedaço segue o seu caminho.
 */
function coletarFolhas(nos: Node[], container: Element, ctx: Contexto): Folha[] {
  const { p } = ctx;
  const folhas: Folha[] = [];
  let corrida: Node[] = [];
  const despejar = () => {
    if (corrida.length === 0) return;
    const f = folhaDeCorrida(p, corrida, container, ctx);
    if (f) folhas.push(f);
    corrida = [];
  };

  const grupos = ctx.profundidade === 0 ? gruposLadoALado(p, nos) : new Map<Element, Element[]>();
  const consumidos = new Set<Element>();
  for (const membros of grupos.values()) {
    membros.slice(1).forEach((m) => consumidos.add(m));
  }

  for (const no of nos) {
    if (no.nodeType === 3) {
      if (normalizar(no.textContent) || corrida.length) corrida.push(no);
      continue;
    }
    if (no.nodeType !== 1) continue;
    const el = no as Element;
    if (consumidos.has(el) || escondido(p, el)) continue;
    const tag = el.tagName;

    if (tag === "BR") {
      if (corrida.length) corrida.push(el);
      continue;
    }
    const grupo = grupos.get(el);
    if (grupo) {
      despejar();
      folhas.push({ tipo: "colunas", partes: grupo, caixa: uniao(p, grupo) });
      continue;
    }
    if (tag === "IMG") {
      // Ícone no meio de texto fica no texto; ícone sozinho é imagem (e uma
      // fileira deles vira bloco social, na montagem).
      if (imagemPequena(p, el) && (corridaTemTexto(p, corrida) || proximoEhTexto(p, no))) {
        corrida.push(el);
        continue;
      }
      despejar();
      const f = folhaDeImagem(p, el, container, ctx);
      if (f) folhas.push(f);
      continue;
    }
    if (tag === "HR") {
      despejar();
      folhas.push(folhaDeDivisor(p, el));
      continue;
    }
    if (tag === "TABLE") {
      despejar();
      folhas.push(...folhasDeTabela(p, el, ctx));
      continue;
    }
    if (tag === "UL" || tag === "OL") {
      despejar();
      const f = folhaDeLista(p, el, ctx);
      if (f) folhas.push(f);
      continue;
    }
    if (tag === "A" && pareceBotao(p, el)) {
      despejar();
      folhas.push(folhaDeBotao(p, el, container, ctx));
      continue;
    }
    const ctxFilho =
      tag === "A" ? { ...ctx, link: hrefDe(el) ?? ctx.link } : ctx;
    if (ehInline(p, el)) {
      if (soTemInline(p, el)) {
        // Link/ênfase que só embrulha uma imagem, sem texto em volta: a imagem
        // é quem manda — desce até ela em vez de juntá-la a um texto vazio.
        const soImagem =
          imagensVisiveis(p, el).length > 0 && !normalizar(textoVisivel(p, el));
        if (soImagem && !corridaTemTexto(p, corrida) && !proximoEhTexto(p, no)) {
          despejar();
          folhas.push(...coletarFolhas(Array.from(el.childNodes), container, ctxFilho));
          continue;
        }
        corrida.push(el);
        continue;
      }
      // Ênfase/link com bloco dentro (um <a> em volta de um card): desce.
      despejar();
      folhas.push(...coletarFolhas(Array.from(el.childNodes), container, ctxFilho));
      continue;
    }

    despejar();
    if (pareceDivisor(p, el)) {
      folhas.push(folhaDeDivisor(p, el));
      continue;
    }
    if (soTemInline(p, el)) {
      const f = folhaDeTexto(p, el, ctxFilho);
      if (f) folhas.push(f);
      continue;
    }
    folhas.push(...coletarFolhas(Array.from(el.childNodes), el, ctxFilho));
  }
  despejar();
  return folhas;
}

/** Uma fileira de ícones, cada um na sua célula (o bloco social clássico). */
function iconesDaLinha(p: Palco, celulas: Element[]): Element[] | null {
  if (celulas.length < 2) return null;
  const icones: Element[] = [];
  for (const c of celulas) {
    const imgs = imagensVisiveis(p, c);
    if (imgs.length !== 1 || normalizar(textoVisivel(p, c)) || !ehIcone(p, imgs[0])) {
      return null;
    }
    icones.push(imgs[0]);
  }
  return icones;
}

function folhasDaLinha(p: Palco, tr: Element, ctx: Contexto): Folha[] {
  const folhas: Folha[] = [];
  const celulas = celulasDaLinha(p, tr);
  const comConteudo = celulas.filter((c) => temConteudo(p, c));
  if (comConteudo.length === 0) {
    // Linha vazia: divisor, ou só espaço — que a geometria absorve sozinha.
    const divisor = celulas.find((c) => pareceDivisor(p, c));
    if (divisor) folhas.push(folhaDeDivisor(p, divisor));
    return folhas;
  }
  if (comConteudo.length === 1) {
    return coletarFolhas(Array.from(comConteudo[0].childNodes), comConteudo[0], ctx);
  }
  const icones = iconesDaLinha(p, comConteudo);
  if (icones) {
    const tabela = tr.closest("table") ?? tr;
    const f = folhaSocial(p, icones, containerDe(tabela), ctx);
    if (f) return [f];
  }
  if (ctx.profundidade === 0) {
    return [{ tipo: "colunas", partes: comConteudo, caixa: caixaDaBorda(p, tr) }];
  }
  for (const c of comConteudo) {
    folhas.push(...coletarFolhas(Array.from(c.childNodes), c, ctx));
  }
  return folhas;
}

function folhasDeTabela(p: Palco, tabela: Element, ctx: Contexto): Folha[] {
  const folhas: Folha[] = [];
  for (const tr of linhasDaTabela(tabela)) {
    if (escondido(p, tr)) continue;
    folhas.push(...folhasDaLinha(p, tr, ctx));
  }
  return folhas;
}

// ─── Montagem: folhas → blocos com espaçamento, colunas → estrutura ─

function comEspacamento(bloco: Block, lados: number[]): Block {
  if (bloco.type === "spacer") return bloco;
  const padding = `${lados[0]}px ${lados[1]}px ${lados[2]}px ${lados[3]}px`;
  return { ...bloco, attrs: { ...bloco.attrs, padding } } as Block;
}

/** Ícones pequenos com link, um ao lado do outro, viram um bloco social. */
function agruparSociais(folhas: FolhaBloco[]): FolhaBloco[] {
  const saida: FolhaBloco[] = [];
  let i = 0;
  const ehIconeSolto = (f: FolhaBloco) =>
    f.bloco.type === "image" &&
    f.propria !== undefined &&
    f.bloco.attrs.width !== null &&
    f.bloco.attrs.width <= 64;
  while (i < folhas.length) {
    const grupo: FolhaBloco[] = [];
    let j = i;
    while (
      j < folhas.length &&
      ehIconeSolto(folhas[j]) &&
      (grupo.length === 0 ||
        Math.abs(folhas[j].propria!.top - grupo[0].propria!.top) <= 8)
    ) {
      grupo.push(folhas[j]);
      j++;
    }
    if (grupo.length >= 2) {
      const imagens = grupo.map((f) => f.bloco as ImageBlock);
      const rects = grupo.map((f) => f.propria!);
      const cont = grupo[0].caixa;
      const bloco: SocialBlock = {
        id: uid(),
        type: "social",
        items: imagens.map((img) => ({ label: img.alt, iconSrc: img.src, href: img.href })),
        attrs: {
          iconSize: Math.max(...imagens.map((img) => img.attrs.width ?? 24)),
          align: alinhamentoPorGeometria(
            Math.min(...rects.map((r) => r.left)),
            Math.max(...rects.map((r) => r.right)),
            cont.esquerda,
            cont.direita
          ),
          padding: "0px",
        },
      };
      saida.push({
        tipo: "bloco",
        bloco,
        caixa: {
          topo: Math.min(...grupo.map((f) => f.caixa.topo)),
          base: Math.max(...grupo.map((f) => f.caixa.base)),
          esquerda: cont.esquerda,
          direita: cont.direita,
        },
      });
      i = j;
    } else {
      saida.push(folhas[i]);
      i++;
    }
  }
  return saida;
}

/**
 * Dá a cada bloco o espaçamento que o separa do anterior e das bordas da
 * coluna. É a geometria que manda: padding de célula, margem de parágrafo ou
 * linha vazia de tabela dão no mesmo — o espaço que se vê entre os pedaços.
 */
function montarBlocos(folhasIn: FolhaBloco[], coluna: Caixa): Block[] {
  const folhas = agruparSociais(folhasIn);
  if (folhas.length === 0) {
    const altura = Math.round(coluna.base - coluna.topo);
    return altura >= 2 ? [{ id: uid(), type: "spacer", attrs: { height: altura } }] : [];
  }
  let anterior = coluna.topo;
  return folhas.map((f, i) => {
    const ultimo = i === folhas.length - 1;
    const topo = Math.max(0, Math.round(f.caixa.topo - anterior));
    const base = ultimo ? Math.max(0, Math.round(coluna.base - f.caixa.base)) : 0;
    const esq = Math.max(0, Math.round(f.caixa.esquerda - coluna.esquerda));
    const dir = Math.max(0, Math.round(coluna.direita - f.caixa.direita));
    anterior = Math.max(anterior, f.caixa.base);
    return comEspacamento(f.bloco, [topo, dir, base, esq]);
  });
}

function soBlocos(folhas: Folha[]): FolhaBloco[] {
  return folhas.filter((f): f is FolhaBloco => f.tipo === "bloco");
}

function arredondar(lados: number[]): string {
  return lados.map((v) => `${Math.max(0, Math.round(v))}px`).join(" ");
}

function linhaDeColunas(
  folha: FolhaColunas,
  secao: Caixa,
  fundo: string,
  ctx: Contexto,
  primeiro: boolean,
  ultimo: boolean
): Row {
  const { p } = ctx;
  const caixas = folha.partes.map((el) => caixaDaBorda(p, el));
  const larguras = caixas.map((c) => Math.max(0, c.direita - c.esquerda));
  const total = larguras.reduce((a, b) => a + b, 0);
  const pct =
    total > 0
      ? larguras.map((l) => Math.round((l / total) * 10000) / 100)
      : folha.partes.map(() => Math.round((100 / folha.partes.length) * 100) / 100);
  const soma = pct.reduce((a, b) => a + b, 0);
  pct[pct.length - 1] = Math.round((pct[pct.length - 1] + 100 - soma) * 100) / 100;

  const row = createRow(pct);
  row.columns = folha.partes.map((parte, i) => {
    const coluna = createColumn(pct[i]);
    const dentro = { ...ctx, profundidade: ctx.profundidade + 1 };
    coluna.blocks = montarBlocos(soBlocos(folhasDe(p, parte, dentro)), caixas[i]);
    return coluna;
  });
  row.attrs = {
    backgroundColor: fundo,
    padding: arredondar([
      primeiro ? folha.caixa.topo - secao.topo : 0,
      secao.direita - folha.caixa.direita,
      ultimo ? secao.base - folha.caixa.base : 0,
      folha.caixa.esquerda - secao.esquerda,
    ]),
  };
  return row;
}

// ─── Seções ──────────────────────────────────────────────────────

interface Secao {
  /** O elemento que delimita a seção — ou o `<tr>` das colunas. */
  container: Element;
  /** Os nós de conteúdo: o container inteiro, ou um trecho contíguo dos filhos. */
  nos: Node[];
  /** Células/caixas lado a lado, quando a seção já nasce em colunas. */
  colunas?: Element[];
  /** Vão entre seções cuja cor de fundo é outra: vira uma linha só de espaço. */
  espacador?: { altura: number; fundo: string };
  /** Onde a seção fica. Ajustada depois pelos embrulhos em volta. */
  caixa: Caixa;
}

/**
 * Cor de fundo de uma seção: a primeira opaca subindo do elemento, contando
 * só quem ocupa a largura da coluna. A célula azul de um botão tem fundo, mas
 * não é o fundo da seção — é o do botão.
 */
function fundoDe(p: Palco, el: Element, largura: number): string {
  let atual: Element | null = el;
  while (atual) {
    if (p.rect(atual).width >= largura - 8) {
      const cor = hex(p.estilo(atual).backgroundColor);
      if (cor) return cor;
    }
    atual = atual.parentElement;
  }
  return "";
}

function temAlgo(p: Palco, no: Node): boolean {
  if (no.nodeType === 3) return normalizar(no.textContent).length > 0;
  if (no.nodeType !== 1) return false;
  const el = no as Element;
  return !escondido(p, el) && (temConteudo(p, el) || pareceDivisor(p, el));
}

/**
 * Divide um pedaço do documento em seções — cada uma vira uma ou mais
 * estruturas do modelo.
 *
 * Desce pelos embrulhos (tabela dentro de célula dentro de tabela…) até chegar
 * onde há mais de uma coisa: linhas de uma tabela, filhos de uma div. Cada
 * linha com conteúdo é uma seção; célula ao lado de célula é seção em colunas;
 * parágrafos e imagens soltos e contíguos se juntam numa seção só.
 *
 * O que um embrulho tem de espaçamento (o padding da célula em volta da
 * tabela) não some: a caixa das seções de dentro é esticada até a borda dele,
 * e a diferença vira espaçamento dos blocos. Embrulhos de página — os de
 * largura total, que só centralizam a coluna de conteúdo — ficam de fora
 * dessa conta, senão a margem de centralização viraria espaçamento.
 */
function acharSecoes(p: Palco, raiz: Element): Secao[] {
  const secoes: Secao[] = [];

  const empurrar = (secao: Omit<Secao, "caixa"> & { caixa?: Caixa }) => {
    let caixa = secao.caixa;
    if (!caixa) {
      const { container, nos } = secao;
      const inteiro = nos.length === 1 && nos[0] === container;
      const borda = caixaDaBorda(p, container);
      if (inteiro || nos.length === container.childNodes.length) caixa = borda;
      else {
        const r = retanguloDosNos(p, nos);
        caixa = {
          topo: r ? r.top : borda.topo,
          base: r ? r.bottom : borda.base,
          esquerda: borda.esquerda,
          direita: borda.direita,
        };
      }
    }
    secoes.push({ ...secao, caixa });
  };

  const visitar = (el: Element, moldura: Caixa | null): void => {
    if (el.tagName === "TABLE") {
      for (const tr of linhasDaTabela(el)) {
        if (escondido(p, tr)) continue;
        const celulas = celulasDaLinha(p, tr);
        const comConteudo = celulas.filter((c) => temConteudo(p, c));
        if (comConteudo.length === 0) {
          const divisor = celulas.find((c) => pareceDivisor(p, c));
          if (divisor) empurrar({ container: divisor, nos: [divisor] });
          continue;
        }
        if (comConteudo.length === 1) {
          dentro(comConteudo[0], moldura);
          continue;
        }
        // Ícones lado a lado são um bloco social, não colunas.
        if (iconesDaLinha(p, comConteudo)) empurrar({ container: tr, nos: [tr] });
        else empurrar({ container: tr, nos: [tr], colunas: comConteudo });
      }
      return;
    }

    const filhos = Array.from(el.childNodes);
    const elementos = filhos.filter(
      (n): n is Element => n.nodeType === 1 && !escondido(p, n as Element)
    );
    const textoSolto = filhos.some((n) => n.nodeType === 3 && normalizar(n.textContent));
    const relevantes = elementos.filter((f) => temConteudo(p, f) || pareceDivisor(p, f));

    if (relevantes.length === 0) {
      if (textoSolto) empurrar({ container: el, nos: filhos });
      else if (pareceDivisor(p, el)) empurrar({ container: el, nos: [el] });
      return;
    }
    if (textoSolto) {
      empurrar({ container: el, nos: filhos });
      return;
    }
    if (relevantes.length === 1) {
      const unico = relevantes[0];
      if (CONTEINERES.has(unico.tagName)) dentro(unico, moldura);
      else empurrar({ container: el, nos: filhos });
      return;
    }
    if (relevantes.every((f) => !ehInline(p, f)) && todosLadoALado(p, relevantes)) {
      empurrar({ container: el, nos: [el], colunas: relevantes });
      return;
    }
    let grupo: Node[] = [];
    for (const no of filhos) {
      if (no.nodeType === 1) {
        const f = no as Element;
        if (escondido(p, f)) continue;
        if (CONTEINERES.has(f.tagName) && (temConteudo(p, f) || pareceDivisor(p, f))) {
          if (grupo.some((n) => temAlgo(p, n))) empurrar({ container: el, nos: grupo });
          grupo = [];
          dentro(f, moldura);
          continue;
        }
      }
      grupo.push(no);
    }
    if (grupo.some((n) => temAlgo(p, n))) empurrar({ container: el, nos: grupo });
  };

  /**
   * Visita `el` e, se ele é coluna de conteúdo (e não embrulho de página),
   * estica as seções de dentro até as bordas dele e preenche os vãos entre
   * elas — com o espaço indo para a seção da mesma cor, ou virando uma linha
   * só de espaço quando a cor do vão é outra.
   */
  const dentro = (el: Element, moldura: Caixa | null): void => {
    if (escondido(p, el)) return;
    const inicio = secoes.length;
    const caixa = caixaDaBorda(p, el);
    const ehConteudo = caixa.direita - caixa.esquerda < LARGURA_MAXIMA_DO_CONTEUDO;
    const m = moldura ?? (ehConteudo ? caixa : null);
    visitar(el, m);
    if (!ehConteudo || secoes.length === inicio) return;

    const largura = (m ?? caixa).direita - (m ?? caixa).esquerda;
    const fundoDoEmbrulho = fundoDe(p, el, largura);
    const dentroDele = secoes.splice(inicio);
    const preenchidas: Secao[] = [];
    for (const secao of dentroDele) {
      if (m) {
        secao.caixa.esquerda = m.esquerda;
        secao.caixa.direita = m.direita;
      }
      const anterior = preenchidas[preenchidas.length - 1];
      if (anterior) {
        const vao = secao.caixa.topo - anterior.caixa.base;
        if (vao >= 4) {
          const fundoAnterior =
            anterior.espacador?.fundo ?? fundoDe(p, anterior.container, largura);
          const fundoDesta = fundoDe(p, secao.container, largura);
          if (fundoDoEmbrulho === fundoDesta || !fundoDoEmbrulho) {
            secao.caixa.topo = anterior.caixa.base;
          } else if (fundoDoEmbrulho === fundoAnterior) {
            anterior.caixa.base = secao.caixa.topo;
          } else {
            preenchidas.push({
              container: el,
              nos: [],
              espacador: { altura: vao, fundo: fundoDoEmbrulho },
              caixa: {
                topo: anterior.caixa.base,
                base: secao.caixa.topo,
                esquerda: secao.caixa.esquerda,
                direita: secao.caixa.direita,
              },
            });
          }
        }
      }
      preenchidas.push(secao);
    }
    preenchidas[0].caixa.topo = Math.min(preenchidas[0].caixa.topo, caixa.topo);
    const ultima = preenchidas[preenchidas.length - 1];
    ultima.caixa.base = Math.max(ultima.caixa.base, caixa.base);
    secoes.push(...preenchidas);
  };

  dentro(raiz, null);
  return secoes;
}

// ─── Conferência: nada pode ter ficado para trás ─────────────────

function blocosDe(rows: Row[]): Block[] {
  return rows.flatMap((r) => r.columns.flatMap((c) => c.blocks));
}

function textoDosBlocos(rows: Row[]): string {
  return blocosDe(rows)
    .map((b) => (b.type === "text" ? textoDeHtml(b.html) : b.type === "button" ? b.text : ""))
    .join(" ");
}

function imagensDosBlocos(rows: Row[]): number {
  return blocosDe(rows).reduce((n, b) => {
    if (b.type === "image") return n + 1;
    if (b.type === "social") return n + b.items.length;
    if (b.type === "text") return n + (b.html.match(/<img\b/gi) ?? []).length;
    return n;
  }, 0);
}

function conferir(p: Palco, nos: Node[], rows: Row[]): boolean {
  // Sem espaço entre os nós: são irmãos no mesmo fluxo ("aqui" + ".").
  const texto = normalizar(nos.map((n) => textoVisivel(p, n)).join(""));
  const imagens = nos.reduce((n, no) => n + imagensVisiveis(p, no).length, 0);
  return normalizar(textoDosBlocos(rows)) === texto && imagensDosBlocos(rows) === imagens;
}

// ─── Seção → estruturas ──────────────────────────────────────────

function converterSecao(p: Palco, secao: Secao, familias: Map<string, string>): Row[] | null {
  if (secao.espacador) {
    const row = createRow([100]);
    row.attrs = { backgroundColor: secao.espacador.fundo, padding: "0px" };
    row.columns[0].blocks = [
      { id: uid(), type: "spacer", attrs: { height: Math.round(secao.espacador.altura) } },
    ];
    return secao.espacador.altura >= 2 ? [row] : [];
  }

  const ctx: Contexto = { p, profundidade: 0, link: null, familias };
  const { container, nos, caixa } = secao;
  const fundo = fundoDe(p, container, caixa.direita - caixa.esquerda);
  const inteiro = nos.length === 1 && nos[0] === container;

  let folhas: Folha[];
  if (secao.colunas) {
    folhas = [{ tipo: "colunas", partes: secao.colunas, caixa: caixaDaBorda(p, container) }];
  } else if (inteiro && pareceDivisor(p, container)) {
    folhas = [folhaDeDivisor(p, container)];
  } else if (inteiro && container.tagName === "TR") {
    folhas = folhasDaLinha(p, container, ctx);
  } else if (inteiro) {
    folhas = folhasDe(p, container, ctx);
  } else {
    folhas = coletarFolhas(nos, container, ctx);
  }

  // Colunas no meio de uma seção quebram-na em três: antes, colunas, depois.
  type Segmento =
    | { tipo: "blocos"; folhas: FolhaBloco[] }
    | { tipo: "colunas"; folha: FolhaColunas };
  const segmentos: Segmento[] = [];
  let atual: FolhaBloco[] = [];
  for (const f of folhas) {
    if (f.tipo === "colunas") {
      if (atual.length) segmentos.push({ tipo: "blocos", folhas: atual });
      atual = [];
      segmentos.push({ tipo: "colunas", folha: f });
    } else atual.push(f);
  }
  if (atual.length) segmentos.push({ tipo: "blocos", folhas: atual });

  if (segmentos.length === 0) {
    const altura = Math.round(caixa.base - caixa.topo);
    if (altura < 2) return [];
    const row = createRow([100]);
    row.attrs = { backgroundColor: fundo, padding: "0px" };
    row.columns[0].blocks = [{ id: uid(), type: "spacer", attrs: { height: altura } }];
    return [row];
  }

  const inicioDe = (s: Segmento) =>
    s.tipo === "colunas" ? s.folha.caixa.topo : Math.min(...s.folhas.map((f) => f.caixa.topo));
  const fimDe = (s: Segmento) =>
    s.tipo === "colunas" ? s.folha.caixa.base : Math.max(...s.folhas.map((f) => f.caixa.base));

  const rows = segmentos.map((seg, i) => {
    const primeiro = i === 0;
    const ultimo = i === segmentos.length - 1;
    const topo = primeiro ? caixa.topo : fimDe(segmentos[i - 1]);
    const base = ultimo ? caixa.base : inicioDe(segmentos[i + 1]);
    const recorte: Caixa = { topo, base, esquerda: caixa.esquerda, direita: caixa.direita };
    if (seg.tipo === "colunas") {
      return linhaDeColunas(seg.folha, recorte, fundo, ctx, primeiro, ultimo);
    }
    const row = createRow([100]);
    row.attrs = { backgroundColor: fundo, padding: "0px" };
    row.columns[0].blocks = montarBlocos(seg.folhas, recorte);
    return row;
  });

  return conferir(p, nos, rows) ? rows : null;
}

/** O HTML de uma seção que não pôde virar blocos, pronto para ser HTML próprio. */
function htmlDaSecao(secao: Secao): string {
  const { container, nos } = secao;
  let el: Element;
  if (nos.length === 1 && nos[0] === container) {
    el = container.cloneNode(true) as Element;
  } else {
    el = (container.tagName === "BODY"
      ? container.ownerDocument.createElement("div")
      : container.cloneNode(false)) as Element;
    for (const n of nos) el.appendChild(n.cloneNode(true));
  }
  // Célula e linha não vivem fora de tabela: ganham de volta a moldura delas.
  let html = el.outerHTML;
  let atual: Element | null = container;
  if (container.tagName === "TD" || container.tagName === "TH") {
    const tr = container.parentElement;
    if (tr) {
      const casca = tr.cloneNode(false) as Element;
      casca.innerHTML = html;
      html = casca.outerHTML;
      atual = tr;
    }
  }
  if (atual && atual.tagName === "TR") {
    const tabela = atual.closest("table");
    if (tabela) {
      const casca = tabela.cloneNode(false) as Element;
      casca.innerHTML = html;
      html = casca.outerHTML;
    }
  }
  return `<div style="max-width:600px;margin:0 auto;">${html}</div>`;
}

function linhaCrua(html: string): Row {
  const row = createRow([100]);
  row.attrs = { backgroundColor: "", padding: "0px" };
  row.customHtml = html;
  return row;
}

export interface ConversaoDeHtml {
  rows: Row[];
  /** Seções que viraram estruturas com blocos. */
  convertidas: number;
  /** Seções que ficaram como HTML próprio. */
  cruas: number;
  /** Fonte de cada bloco de texto convertido (id → font-family computada). */
  familias: Map<string, string>;
}

/** Elementos já renderizados no palco → estruturas do modelo. */
export function converterElementosEmLinhas(p: Palco, elementos: Element[]): ConversaoDeHtml {
  const familias = new Map<string, string>();
  const rows: Row[] = [];
  let convertidas = 0;
  let cruas = 0;
  for (const secao of elementos.flatMap((el) => acharSecoes(p, el))) {
    const feitas = converterSecao(p, secao, familias);
    if (feitas) {
      rows.push(...feitas);
      if (!secao.espacador) convertidas += 1;
    } else {
      rows.push(linhaCrua(htmlDaSecao(secao)));
      cruas += 1;
    }
  }
  return { rows, convertidas, cruas, familias };
}

// ─── Tipografia do e-mail ────────────────────────────────────────

/** A fonte do painel que corresponde à computada — ou a computada mesmo. */
export function escolherFonte(familia: string): string {
  const primeira = primeiraFamilia(familia);
  if (!primeira) return DEFAULT_SETTINGS.fontFamily;
  const opcao = FONT_OPTIONS.find((o) => primeiraFamilia(o.value) === primeira);
  if (opcao) return opcao.value;
  if (/helvetica|arial|verdana|tahoma|trebuchet/.test(primeira)) return FONT_OPTIONS[1].value;
  if (/georgia|times|serif|garamond|cambria|palatino/.test(primeira)) return FONT_OPTIONS[2].value;
  if (/inter|segoe|system|roboto|apple|open sans|lato|montserrat|poppins/.test(primeira)) {
    return FONT_OPTIONS[3].value;
  }
  return familiaSegura(familia) || DEFAULT_SETTINGS.fontFamily;
}

function maisComum(contagem: Map<string, number>): string | null {
  let melhor: string | null = null;
  let maior = 0;
  for (const [chave, n] of contagem) {
    if (n > maior) {
      maior = n;
      melhor = chave;
    }
  }
  return melhor;
}

/**
 * Fonte, cor do texto e cor dos links que dominam o documento — pesadas pela
 * quantidade de texto, para o título grande não mandar mais que o corpo.
 */
export function amostrarTipografia(
  p: Palco,
  raiz: Element
): Pick<DesignSettings, "fontFamily" | "textColor" | "linkColor"> | null {
  const fontes = new Map<string, number>();
  const cores = new Map<string, number>();
  // Links da cor do texto em volta não dizem qual é "a cor de link" do
  // e-mail; só os que se destacam contam — e, sem nenhum, qualquer um.
  const links = new Map<string, number>();
  const linksDiscretos = new Map<string, number>();
  const somar = (mapa: Map<string, number>, chave: string, peso: number) =>
    mapa.set(chave, (mapa.get(chave) ?? 0) + peso);

  const andar = (no: Node) => {
    if (no.nodeType === 3) {
      const t = normalizar(no.textContent);
      const pai = no.parentElement;
      if (!t || !pai) return;
      const cs = p.estilo(pai);
      somar(fontes, cs.fontFamily, t.length);
      const cor = hex(cs.color);
      if (!cor) return;
      const link = pai.closest("a");
      if (!link) {
        somar(cores, cor, t.length);
        return;
      }
      const emVolta = link.parentElement ? hex(p.estilo(link.parentElement).color) : null;
      somar(cor === emVolta ? linksDiscretos : links, cor, t.length);
      return;
    }
    if (no.nodeType !== 1 || escondido(p, no as Element)) return;
    for (const filho of Array.from(no.childNodes)) andar(filho);
  };
  andar(raiz);

  const fonte = maisComum(fontes);
  if (!fonte) return null;
  return {
    fontFamily: escolherFonte(fonte),
    textColor: maisComum(cores) ?? DEFAULT_SETTINGS.textColor,
    linkColor: maisComum(links) ?? maisComum(linksDiscretos) ?? DEFAULT_SETTINGS.linkColor,
  };
}

/**
 * Cor de fundo da página: do corpo, ou do primeiro embrulho de largura total
 * que tenha cor (a tabela de 100% em volta da coluna de conteúdo).
 */
export function fundoDaPagina(p: Palco): string | null {
  const { doc } = p;
  const doCorpo = hex(p.estilo(doc.body).backgroundColor) ?? hex(p.estilo(doc.documentElement).backgroundColor);
  if (doCorpo) return doCorpo;
  let atual: Element | null = doc.body;
  while (atual) {
    const r = p.rect(atual);
    if (r.width < LARGURA_MAXIMA_DO_CONTEUDO) break;
    const cor = hex(p.estilo(atual).backgroundColor);
    if (cor) return cor;
    const filhos: Element[] = Array.from(atual.children).filter(
      (f) => !escondido(p, f) && temConteudo(p, f)
    );
    atual = filhos.length === 1 ? filhos[0] : null;
  }
  return null;
}

/**
 * Deixa os blocos de texto herdarem o que é do e-mail inteiro: a cor igual à
 * padrão vira "herda" (o controle global passa a valer) e só a fonte que
 * DIFERE da do e-mail é escrita no bloco.
 */
export function aplicarTipografia(
  rows: Row[],
  settings: DesignSettings,
  familias: Map<string, string>
): Row[] {
  return rows.map((row) => ({
    ...row,
    columns: row.columns.map((col) => ({
      ...col,
      blocks: col.blocks.map((b) => {
        if (b.type !== "text") return b;
        const familia = familias.get(b.id);
        const html =
          familia && escolherFonte(familia) !== settings.fontFamily
            ? `<span style="font-family:${familiaSegura(familia)}">${b.html}</span>`
            : b.html;
        const color = b.attrs.color === settings.textColor ? "" : b.attrs.color;
        return { ...b, html, attrs: { ...b.attrs, color } };
      }),
    })),
  }));
}

// ─── Entradas: HTML de um pedaço → blocos ────────────────────────

const CABECA = `<!doctype html><html><head><meta charset="utf-8"></head>`;

/**
 * HTML próprio de uma ESTRUTURA (ou qualquer trecho de e-mail) → estruturas
 * com blocos. Renderiza numa coluna de 600px, que é a largura do e-mail.
 */
export function converterHtmlEmLinhas(html: string, settings: DesignSettings): ConversaoDeHtml {
  const limpo = limparHtmlDoUsuario(html);
  const documento = `${CABECA}<body style="margin:0;padding:0;"><div id="__palco__" style="width:600px;margin:0 auto;">${limpo}</div></body></html>`;
  return comDocumentoRenderizado(documento, (doc, win) => {
    const p = criarPalco(doc, win);
    const raiz = doc.getElementById("__palco__");
    if (!raiz) return { rows: [], convertidas: 0, cruas: 0, familias: new Map() };
    const r = converterElementosEmLinhas(p, [raiz]);
    return { ...r, rows: aplicarTipografia(r.rows, settings, r.familias) };
  });
}

/**
 * HTML próprio de um BLOCO (um `<td>`) → blocos. Null quando nada de
 * reconhecível saiu dele — aí o código fica como está.
 */
export function converterHtmlEmBlocos(html: string, settings: DesignSettings): Block[] | null {
  const limpo = limparHtmlDoUsuario(html);
  const celula = /^\s*<t[dh]\b/i.test(limpo) ? limpo : `<td>${limpo}</td>`;
  const documento = `${CABECA}<body style="margin:0;padding:0;"><table width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;margin:0 auto;"><tbody><tr id="__palco__">${celula}</tr></tbody></table></body></html>`;
  return comDocumentoRenderizado(documento, (doc, win) => {
    const p = criarPalco(doc, win);
    const td = doc.getElementById("__palco__")?.querySelector("td,th") ?? null;
    if (!td) return null;
    const familias = new Map<string, string>();
    const ctx: Contexto = { p, profundidade: 1, link: null, familias };
    const nos = Array.from(td.childNodes);
    const blocos = montarBlocos(soBlocos(coletarFolhas(nos, td, ctx)), caixaDaBorda(p, td));
    if (blocos.length === 0) return null;
    const row = createRow([100]);
    row.columns[0].blocks = blocos;
    if (!conferir(p, nos, [row])) return null;
    return aplicarTipografia([row], settings, familias)[0].columns[0].blocks;
  });
}
