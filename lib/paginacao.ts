/**
 * Paginação das listas e tabelas (15/09/2026): lista longa mostra uma página
 * por vez, com 20, 50, 100 ou 200 linhas — senão a tela rola sem fim. A escolha
 * de linhas fica lembrada por lista: quem prefere ver 100 contatos por vez não
 * escolhe de novo a cada visita.
 *
 * Aqui mora só a conta, sem React nem Next: o componente
 * (components/paginacao.tsx) e as páginas renderizadas no servidor
 * (lib/paginacao-servidor.ts) usam as mesmas funções.
 */

export const OPCOES_DE_LINHAS = [20, 50, 100, 200] as const;

export type LinhasPorPagina = (typeof OPCOES_DE_LINHAS)[number];

export const LINHAS_PADRAO: LinhasPorPagina = 20;

/**
 * Cookie com a escolha de cada lista ("contatos:50|leads:100"). Cookie, e não
 * localStorage, porque as listas que o servidor renderiza (campanhas,
 * templates...) precisam saber o tamanho da página antes de consultar o banco.
 */
export const COOKIE_DE_LINHAS = "linhas-por-pagina";

function numero(valor: unknown): number {
  if (typeof valor === "number") return valor;
  if (typeof valor === "string" && valor.trim() !== "") return Number(valor);
  return Number.NaN;
}

/** Uma das opções de linhas, ou null — valor de URL ou cookie é entrada livre. */
export function lerLinhas(valor: unknown): LinhasPorPagina | null {
  const n = numero(valor);
  return (OPCOES_DE_LINHAS as readonly number[]).includes(n)
    ? (n as LinhasPorPagina)
    : null;
}

/** Número de página pedido (1 em diante); qualquer outra coisa vira a primeira. */
export function lerPagina(valor: unknown): number {
  const n = numero(valor);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

export interface Recorte {
  /** A página pedida, presa ao intervalo que existe. */
  pagina: number;
  /** Pelo menos 1, mesmo com a lista vazia. */
  totalPaginas: number;
  /** Índice do primeiro item da página (a partir de 0). */
  inicio: number;
  /** Índice logo depois do último item da página. */
  fim: number;
}

/**
 * O pedaço da lista que a página mostra. A página fica presa ao que existe:
 * excluir o último item da última página, ou apertar o filtro, não pode deixar
 * a pessoa numa página vazia que parece "nenhum resultado".
 */
export function recortar(
  total: number,
  pagina: number,
  linhas: number
): Recorte {
  const totalPaginas = Math.max(1, Math.ceil(total / linhas));
  const atual = Math.min(Math.max(1, Math.floor(pagina)), totalPaginas);
  const inicio = (atual - 1) * linhas;
  return {
    pagina: atual,
    totalPaginas,
    inicio,
    fim: Math.min(total, inicio + linhas),
  };
}

/**
 * A página que contém o item de índice `indice` com `linhas` por página. Serve
 * para trocar o tamanho sem perder o lugar: quem estava vendo do 41º ao 60º e
 * passa para 50 por página continua vendo o 41º.
 */
export function paginaDoItem(indice: number, linhas: number): number {
  return Math.floor(Math.max(0, indice) / linhas) + 1;
}

export type BotaoDePagina = number | "reticencias-inicio" | "reticencias-fim";

/**
 * Os botões numerados: a primeira e a última página sempre, a atual com as
 * vizinhas, e reticências no lugar do resto. Passando de 7 páginas são sempre
 * 7 posições — a barra não muda de largura a cada clique, e o próximo botão
 * não foge de baixo do mouse.
 */
export function botoesDePagina(
  pagina: number,
  totalPaginas: number
): BotaoDePagina[] {
  if (totalPaginas <= 7) {
    return Array.from({ length: totalPaginas }, (_, i) => i + 1);
  }
  if (pagina <= 4) return [1, 2, 3, 4, 5, "reticencias-fim", totalPaginas];
  if (pagina >= totalPaginas - 3) {
    return [
      1,
      "reticencias-inicio",
      totalPaginas - 4,
      totalPaginas - 3,
      totalPaginas - 2,
      totalPaginas - 1,
      totalPaginas,
    ];
  }
  return [
    1,
    "reticencias-inicio",
    pagina - 1,
    pagina,
    pagina + 1,
    "reticencias-fim",
    totalPaginas,
  ];
}

/** O valor de um cookie dentro do cabeçalho ("a=1; b=2"), sem decodificar. */
export function valorDoCookie(
  cabecalho: string | null | undefined,
  nome: string
): string | undefined {
  if (!cabecalho) return undefined;
  for (const parte of cabecalho.split(";")) {
    const igual = parte.indexOf("=");
    if (igual === -1) continue;
    if (parte.slice(0, igual).trim() === nome) {
      return parte.slice(igual + 1).trim();
    }
  }
  return undefined;
}

/** Nome de lista aceito no cookie: sem os separadores do próprio formato. */
const CHAVE_VALIDA = /^[a-z0-9-]+$/;

/** "contatos:50|leads:100" → { contatos: 50, leads: 100 }. O que não casa é ignorado. */
export function lerPreferencias(
  valor: string | null | undefined
): Record<string, LinhasPorPagina> {
  const preferencias: Record<string, LinhasPorPagina> = {};
  if (!valor) return preferencias;
  let texto = valor;
  try {
    texto = decodeURIComponent(valor);
  } catch {
    // Valor cru, sem codificação.
  }
  for (const par of texto.split("|")) {
    const [chave, linhas] = par.split(":");
    const lidas = lerLinhas(linhas);
    if (chave && CHAVE_VALIDA.test(chave) && lidas) preferencias[chave] = lidas;
  }
  return preferencias;
}

/**
 * O valor novo do cookie com a escolha de uma lista. O tamanho padrão sai do
 * cookie em vez de ocupar espaço nele — e string vazia quer dizer "apague".
 */
export function gravarPreferencia(
  valorAtual: string | null | undefined,
  chave: string,
  linhas: LinhasPorPagina
): string {
  const preferencias = lerPreferencias(valorAtual);
  if (linhas === LINHAS_PADRAO || !CHAVE_VALIDA.test(chave)) {
    delete preferencias[chave];
  } else {
    preferencias[chave] = linhas;
  }
  return Object.entries(preferencias)
    .map(([nome, n]) => `${nome}:${n}`)
    .join("|");
}
