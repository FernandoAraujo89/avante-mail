// Troca de imagem dentro de um pedaço com HTML próprio.
//
// Quando uma seção do e-mail não cabe nos blocos do modelo, ela fica como HTML
// próprio — e aí não existe bloco de imagem para o painel editar. Só que o
// problema mais comum de um e-mail importado é exatamente a imagem: ela vinha
// por link de outro site e esse link caiu. Sem uma saída, a única opção seria
// mexer no código à mão.
//
// Estas funções dão a mesma troca de imagem do bloco comum: listam o que há de
// `<img>` no código e substituem o endereço de UMA delas, pela posição, sem
// tocar em mais nada do HTML.
//
// Roda só no navegador (DOMParser), como o resto do criador.

export interface ImagemNoHtml {
  /** Posição no código — é por ela que a troca é feita. */
  indice: number;
  src: string;
  alt: string;
}

/**
 * O HTML de um bloco é um `<td>`, que o parser descarta fora de uma tabela.
 * Esta função embrulha, deixa a função trabalhar no DOM e desembrulha.
 */
function comDom<T>(html: string, trabalho: (raiz: Element) => T): T {
  const ehCelula = /^\s*<t[dr]\b/i.test(html);
  const doc = new DOMParser().parseFromString(
    ehCelula
      ? `<table id="__raiz__"><tbody><tr>${html}</tr></tbody></table>`
      : `<div id="__raiz__">${html}</div>`,
    "text/html"
  );
  const raiz = doc.getElementById("__raiz__");
  if (!raiz) throw new Error("HTML não pôde ser lido.");
  return trabalho(raiz);
}

function desembrulhar(raiz: Element, html: string): string {
  if (raiz.tagName !== "TABLE") return raiz.innerHTML;
  const tr = raiz.querySelector("tr");
  if (!tr) return html;
  // O `<tr>` é do canvas: guarda-se o miolo, como no resto do editor.
  return /^\s*<tr\b/i.test(html) ? tr.outerHTML : tr.innerHTML;
}

/** As imagens que existem num HTML próprio, na ordem em que aparecem. */
export function listarImagensDoHtml(html: string): ImagemNoHtml[] {
  if (!html.trim()) return [];
  try {
    return comDom(html, (raiz) =>
      Array.from(raiz.querySelectorAll("img")).map((img, indice) => ({
        indice,
        src: img.getAttribute("src") ?? "",
        alt: img.getAttribute("alt") ?? "",
      }))
    );
  } catch {
    return [];
  }
}

/** Troca o endereço da imagem naquela posição; devolve o HTML novo. */
export function trocarImagemNoHtml(
  html: string,
  indice: number,
  novoSrc: string
): string {
  if (!html.trim() || !novoSrc.trim()) return html;
  try {
    return comDom(html, (raiz) => {
      const imgs = Array.from(raiz.querySelectorAll("img"));
      const img = imgs[indice];
      if (!img) return html;
      img.setAttribute("src", novoSrc);
      // Um `srcset` antigo venceria o `src` novo e a imagem trocada não
      // apareceria — some com ele junto.
      img.removeAttribute("srcset");
      return desembrulhar(raiz, html);
    });
  } catch {
    return html;
  }
}
