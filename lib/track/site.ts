/**
 * Regras puras do rastreio de site (fase E). Sem banco, sem rede, sem Next —
 * é o único pedaço da fase que dá para conferir de cabeça, e por isso concentra
 * as decisões que, erradas, vazam dado de gente.
 */

/**
 * Teto do corpo do POST.
 *
 * Dimensionado para caber um lote CHEIO: 20 eventos com caminho e título nos
 * tetos abaixo passam de 2 KB, e o corpo é conferido antes de tudo — o lote
 * inteiro seria recusado e o script o descartaria em silêncio, exatamente no
 * caso de quem mais navegou. 16 KB continua ínfimo para um endpoint público e
 * dá folga confortável.
 */
export const TAMANHO_MAXIMO_BYTES = 16 * 1024;

/** Tetos de cada campo. Truncar é preferível a recusar: o dado é secundário. */
export const MAX_PATH = 512;
export const MAX_TITULO = 120;
export const MAX_EVENTO = 40;
export const MAX_SESSAO = 64;
export const MAX_EVENTOS_POR_LOTE = 20;

/**
 * Origens que podem ser rastreadas — mesma lista para DUAS coisas: onde o
 * `?av=` pode ser anexado e quem pode chamar o endpoint (CORS).
 *
 * Uma lista só, de propósito. Se fossem duas, um dia divergiriam e o token
 * passaria a ser anexado para um domínio que não é nosso — que é exatamente o
 * vazamento que esta fase precisa evitar.
 *
 * VAZIA por padrão: sem configuração explícita o rastreio fica inerte. Ninguém
 * liga um rastreamento de pessoa por descuido de configuração.
 */
export function origensPermitidas(): string[] {
  const cru = process.env.SITE_TRACK_ORIGINS ?? "";
  return cru
    .split(",")
    .map((o) => o.trim().replace(/\/$/, "").toLowerCase())
    .filter(Boolean);
}

function origemDaUrl(url: URL): string {
  return `${url.protocol}//${url.host}`.toLowerCase();
}

/**
 * O destino de um link de e-mail pode receber o token?
 *
 * Chamado antes de anexar `?av=` em /api/track/click. Sem esta função, uma
 * campanha que linke para um site de terceiro mandaria junto um token que
 * identifica a pessoa — e o dono daquele site passaria a poder escrever na
 * ficha dela.
 */
export function hostPermitido(destino: string): boolean {
  const permitidas = origensPermitidas();
  if (permitidas.length === 0) return false;
  try {
    const url = new URL(destino);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return permitidas.includes(origemDaUrl(url));
  } catch {
    return false;
  }
}

/** O cabeçalho Origin da requisição está na lista? Devolve a origem exata. */
export function origemPermitida(header: string | null): string | null {
  if (!header) return null;
  const permitidas = origensPermitidas();
  if (permitidas.length === 0) return null;
  const normalizada = header.trim().replace(/\/$/, "").toLowerCase();
  return permitidas.includes(normalizada) ? normalizada : null;
}

/**
 * Anexa o token ao destino SEM quebrar o link.
 *
 * Usa a API de URL em vez de concatenar string: o destino pode já ter query
 * (`?plano=pro`) ou âncora (`#planos`), e concatenar `"?av="` num link com
 * âncora enfia o token dentro do fragmento — o script nunca o veria, e ele
 * ficaria visível na barra de endereço para sempre.
 */
export function anexarToken(destino: string, token: string): string {
  const url = new URL(destino);
  url.searchParams.set("av", token);
  return url.toString();
}

/**
 * Caminho normalizado da página. É o que casa com a regra de pontuação, e o
 * casamento é por igualdade estrita — então `/planos`, `/Planos` e `/planos/`
 * PRECISAM virar a mesma coisa, senão a regra vale para uns visitantes e não
 * para outros, sem ninguém entender por quê.
 *
 * Query e fragmento são descartados inteiros. A query da página pode conter
 * dado pessoal (e contém, no mínimo, o NOSSO `?av=`): guardá-la colocaria um
 * token que identifica o contato dentro de um evento que a ficha do lead
 * mostra na tela.
 */
export function normalizarPath(cru: unknown): string | null {
  if (typeof cru !== "string") return null;
  const limpo = cru.trim();
  if (!limpo) return null;

  let caminho = limpo;
  // Aceita tanto URL completa quanto caminho puro — o script manda o caminho,
  // mas um chamador distraído mandaria a URL inteira.
  if (/^https?:\/\//i.test(limpo)) {
    try {
      caminho = new URL(limpo).pathname;
    } catch {
      return null;
    }
  }

  caminho = caminho.split("#")[0].split("?")[0];
  if (!caminho.startsWith("/")) caminho = `/${caminho}`;
  caminho = caminho.toLowerCase().replace(/\/{2,}/g, "/");
  // Raiz continua "/"; o resto perde a barra final.
  if (caminho.length > 1) caminho = caminho.replace(/\/+$/, "") || "/";

  return caminho.slice(0, MAX_PATH);
}

/** Nome de evento: minúsculo, sem espaço, curto. Fora disso, não é evento. */
export function slugEvento(cru: unknown): string | null {
  if (typeof cru !== "string") return null;
  const limpo = cru.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(limpo)) return null;
  return limpo;
}

/** Texto de terceiro: sem caracteres de controle e com teto. */
export function textoSeguro(cru: unknown, maximo: number): string | null {
  if (typeof cru !== "string") return null;
  const limpo = cru.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return limpo ? limpo.slice(0, maximo) : null;
}

/**
 * Só o HOST do referrer, nunca a URL. Responde "que canal trouxe" sem carregar
 * a query string de um site de terceiro para dentro da nossa base.
 */
export function hostDoReferrer(cru: unknown): string | null {
  if (typeof cru !== "string" || !cru.trim()) return null;
  try {
    const url = new URL(cru);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.host.toLowerCase().slice(0, 120) || null;
  } catch {
    return null;
  }
}

/** Identificador de sessão vindo do script — opaco para nós, só saneado. */
export function sessaoSegura(cru: unknown): string | null {
  if (typeof cru !== "string") return null;
  const limpo = cru.trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(limpo)) return null;
  return limpo.slice(0, MAX_SESSAO);
}
