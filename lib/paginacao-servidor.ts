import { cookies } from "next/headers";

import {
  COOKIE_DE_LINHAS,
  LINHAS_PADRAO,
  lerLinhas,
  lerPagina,
  lerPreferencias,
  type LinhasPorPagina,
} from "@/lib/paginacao";

/** Os `searchParams` que o Next entrega a uma página. */
export type ParametrosDaUrl = Record<string, string | string[] | undefined>;

/** A escolha de linhas guardada para a lista, ou o padrão. */
export async function linhasGuardadas(chave: string): Promise<LinhasPorPagina> {
  const valor = (await cookies()).get(COOKIE_DE_LINHAS)?.value;
  return lerPreferencias(valor)[chave] ?? LINHAS_PADRAO;
}

/**
 * Página e linhas de uma lista renderizada no servidor. A URL manda
 * (`?pagina=3&linhas=50` — o voltar do navegador devolve a mesma página); sem
 * `linhas` nela, vale a escolha guardada da lista. A página ainda precisa ser
 * presa ao total com `recortar`, depois de contar as linhas.
 */
export async function paginacaoDaUrl(
  parametros: ParametrosDaUrl,
  chave: string
): Promise<{ pagina: number; linhas: LinhasPorPagina }> {
  return {
    pagina: lerPagina(parametros.pagina),
    linhas: lerLinhas(parametros.linhas) ?? (await linhasGuardadas(chave)),
  };
}
