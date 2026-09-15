import { getSetting } from "@/lib/settings";

/**
 * Quais funis do Pipedrive a sincronização acompanha, e o que ela viu na
 * última passada.
 *
 * Separado de `sync.ts` porque a tela de etapas só precisa LER isto — e o
 * módulo da sincronização arrasta o motor das automações e o telefone junto.
 */

/** Ids dos funis acompanhados, em JSON (`[8,14]`). */
export const CHAVE_FUNIS = "pipedrive_funis";
/** O que a última passada encontrou, com os nomes — para a tela dizer quais são. */
export const CHAVE_FUNIS_DA_ULTIMA = "pipedrive_sync_funis";
/** Quando a última passada começou. */
export const CHAVE_ULTIMA = "pipedrive_sync_ultima";

export interface FunisDaUltimaPassada {
  funis: { id: number; nome: string }[];
  /** Configurados e não encontrados no Pipedrive (`#id` ou `"nome"`). */
  ausentes: string[];
}

/**
 * Os ids guardados em `pipedrive_funis`. Null quando a chave falta ou não é
 * uma lista de ids — aí vale o funil único do env, o comportamento de antes.
 */
export function lerIdsDosFunis(valor: string | null): number[] | null {
  if (!valor) return null;
  try {
    const lista: unknown = JSON.parse(valor);
    if (!Array.isArray(lista)) return null;
    const ids = [
      ...new Set(
        lista.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
      ),
    ];
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

export async function lerFunisDaUltimaPassada(): Promise<
  (FunisDaUltimaPassada & { quando: string | null }) | null
> {
  const [valor, quando] = await Promise.all([
    getSetting(CHAVE_FUNIS_DA_ULTIMA),
    getSetting(CHAVE_ULTIMA),
  ]);
  if (!valor) return null;
  try {
    const lido = JSON.parse(valor) as Partial<FunisDaUltimaPassada>;
    return {
      funis: Array.isArray(lido.funis) ? lido.funis : [],
      ausentes: Array.isArray(lido.ausentes) ? lido.ausentes : [],
      quando,
    };
  } catch {
    return null;
  }
}
