// Importação de um e-mail em HTML/MJML para o modelo do Criador (WYSIWYG).
//
// Um template escrito como código só podia ser editado como código: abrir o
// criador visual devolvia "este template foi criado como código". O importador
// desfaz esse beco. Ele NÃO tenta adivinhar blocos (isso inventaria um e-mail
// diferente do que é enviado): quebra o e-mail nas suas SEÇÕES e entrega cada
// uma como uma linha com HTML próprio.
//
// O que se ganha com isso é o que o criador já sabe fazer com HTML próprio:
// texto editável no canvas, reordenar/duplicar/remover seção, acrescentar
// estruturas e blocos novos em volta, e o painel de código por seção — em vez
// de um textarea único com o e-mail inteiro.
//
// Roda só no navegador (DOMParser), como o resto do criador.

import { limparHtmlDoUsuario } from "./codigo";
import { createRow } from "./ops";
import { DEFAULT_SETTINGS } from "./presets";
import type { DesignSettings, EmailDesign, Row } from "./types";

function propriedadeDoStyle(style: string, prop: string): string | null {
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
  return m ? m[1].trim() : null;
}

function estaEscondido(el: Element): boolean {
  const style = el.getAttribute("style") ?? "";
  return /display\s*:\s*none/i.test(style);
}

/**
 * O container das seções.
 *
 * O MJML embrulha o e-mail inteiro numa `<div>` dentro do `<body>` (ao lado da
 * div escondida do preheader). Descer até ela é o que faz o e-mail virar várias
 * linhas em vez de uma só. Quando não há esse embrulho — HTML colado de
 * qualquer lugar — para-se onde está, e o e-mail vira uma linha só: continua
 * editável, apenas sem a divisão por seções.
 */
function acharContainer(body: HTMLElement): Element {
  let atual: Element = body;
  for (let i = 0; i < 5; i++) {
    const filhos = Array.from(atual.children).filter((el) => !estaEscondido(el));
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
 * depois. Cortar só nos elementos deixaria essas metades órfãs em linhas
 * diferentes e quebraria o e-mail no Outlook — por isso o grupo só fecha no
 * comentário seguinte ao próximo elemento.
 */
function agruparSecoes(container: Element): string[] {
  const grupos: string[] = [];
  let atual: string[] = [];
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
      grupos.push(atual.join(""));
      atual = [];
    }
    atual.push(el.outerHTML);
    temElemento = true;
  }

  if (temElemento) grupos.push(atual.join(""));
  return grupos.map((g) => g.trim()).filter(Boolean);
}

function linhaComHtml(html: string): Row {
  const row = createRow([100]);
  row.attrs.padding = "0px";
  row.attrs.backgroundColor = "";
  row.customHtml = html;
  return row;
}

/**
 * HTML de um e-mail → documento do Criador.
 *
 * `html` é o HTML JÁ COMPILADO (MJML passa pelo servidor antes), com as
 * variáveis ainda no lugar: importar depois da substituição gravaria os dados
 * de exemplo dentro do template.
 */
export function importarHtmlParaDesign(html: string): EmailDesign {
  const limpo = limparHtmlDoUsuario(html);
  const doc = new DOMParser().parseFromString(limpo, "text/html");

  const settings: DesignSettings = { ...DEFAULT_SETTINGS };
  const bodyStyle = doc.body.getAttribute("style") ?? "";
  const fundo = propriedadeDoStyle(bodyStyle, "background-color");
  if (fundo && /^#[0-9a-f]{3,8}$/i.test(fundo)) settings.bodyBackground = fundo;

  const container = acharContainer(doc.body);
  const secoes = agruparSecoes(container);

  if (secoes.length === 0) {
    // Nada reconhecível para quebrar: guarda o e-mail inteiro como HTML
    // próprio do documento — é o comportamento que já existia, e o aviso do
    // editor explica que quem manda ali é o código.
    return { version: 1, settings, rows: [], customHtml: limpo };
  }

  // O `<style>` do cabeçalho (media queries que fazem o e-mail responder no
  // celular) não tem campo no modelo: vai junto da primeira seção. Cliente de
  // e-mail lê `<style>` no corpo, e assim ele acompanha o e-mail se a seção
  // for movida — perder as media queries deixaria o import responsivo só na
  // aparência.
  const estilos = Array.from(doc.querySelectorAll("style"))
    .map((el) => el.outerHTML)
    .join("\n");
  const rows = secoes.map((secao, i) =>
    linhaComHtml(i === 0 && estilos ? `${estilos}\n${secao}` : secao)
  );

  return { version: 1, settings, rows };
}
