import { getSetting } from "@/lib/settings";

/**
 * Quais funis do CRM a sincronização acompanha, e o que ela viu na última
 * passada.
 *
 * Separado de `sync.ts` porque a tela de etapas só precisa LER isto — e o
 * módulo da sincronização arrasta o motor das automações e o telefone junto.
 *
 * DOIS CRMs (23/10/2026): o Pipedrive (até a virada) e o NRG Hub. Cada um tem
 * as PRÓPRIAS chaves em app_settings (`pipedrive_*` / `nrg_*`): funis
 * acompanhados, marcas-d'água e releitura. Trocar de CRM é só trocar o token
 * no ambiente — o Hub começa do zero (backfill) sem mexer no que o Pipedrive
 * guardou, e os negócios do espelho de um não entram na decisão do outro
 * (a decisão filtra pelos funis acompanhados).
 */

export type Crm = "pipedrive" | "nrg";

export const NOME_DO_CRM: Record<Crm, string> = { pipedrive: "Pipedrive", nrg: "NRG Hub" };

/** Com NRG_HUB_API_TOKEN no ambiente, o CRM é o Hub; senão, o Pipedrive. */
export function crmAtivo(env: NodeJS.ProcessEnv = process.env): Crm {
  return env.NRG_HUB_API_TOKEN ? "nrg" : "pipedrive";
}

export interface ChavesDoCrm {
  /** Ids dos funis acompanhados, em JSON (`["8","14"]` ou os UUIDs do Hub). */
  funis: string;
  /** O que a última passada encontrou, com os nomes — para a tela dizer quais são. */
  funisDaUltima: string;
  /** Quando a última passada começou. */
  ultima: string;
  /** Marca-d'água, uma por funil: `<desde>:<id>`. */
  desde: string;
  /** Começo da releitura completa de um funil: `<inicio>:<id>`. */
  inicioDaReleitura: string;
  /** Quando a última releitura diária foi disparada. */
  ultimaReleitura: string;
}

export function chavesDoCrm(crm: Crm): ChavesDoCrm {
  const p = crm === "nrg" ? "nrg" : "pipedrive";
  return {
    funis: `${p}_funis`,
    funisDaUltima: `${p}_sync_funis`,
    ultima: `${p}_sync_ultima`,
    desde: `${p}_sync_desde`,
    inicioDaReleitura: `${p}_releitura_inicio`,
    ultimaReleitura: `${p}_releitura_ultima`,
  };
}

// As chaves do Pipedrive, como sempre existiram (scripts e migrações antigas).
export const CHAVE_FUNIS = chavesDoCrm("pipedrive").funis;
export const CHAVE_FUNIS_DA_ULTIMA = chavesDoCrm("pipedrive").funisDaUltima;
export const CHAVE_ULTIMA = chavesDoCrm("pipedrive").ultima;

export interface FunisDaUltimaPassada {
  funis: { id: string; nome: string }[];
  /** Configurados e não encontrados no CRM (`#id` ou `"nome"`). */
  ausentes: string[];
}

/**
 * Os ids guardados na chave de funis. Null quando a chave falta ou não é uma
 * lista de ids — aí valem os funis por nome (CRM_FUNIS), o comportamento de
 * antes. Id numérico (Pipedrive) vira texto; UUID (Hub) já é texto.
 */
export function lerIdsDosFunis(valor: string | null): string[] | null {
  if (!valor) return null;
  try {
    const lista: unknown = JSON.parse(valor);
    if (!Array.isArray(lista)) return null;
    const ids = [
      ...new Set(
        lista
          .map((v) =>
            typeof v === "number"
              ? Number.isInteger(v) && v > 0
                ? String(v)
                : ""
              : typeof v === "string"
                ? /^\d+$/.test(v.trim())
                  ? Number(v) > 0
                    ? String(Number(v))
                    : ""
                  : v.trim()
                : ""
          )
          .filter(Boolean)
      ),
    ];
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

export async function lerFunisDaUltimaPassada(
  crm: Crm = crmAtivo()
): Promise<(FunisDaUltimaPassada & { quando: string | null; crm: Crm }) | null> {
  const chaves = chavesDoCrm(crm);
  const [valor, quando] = await Promise.all([getSetting(chaves.funisDaUltima), getSetting(chaves.ultima)]);
  if (!valor) return null;
  try {
    const lido = JSON.parse(valor) as Partial<FunisDaUltimaPassada>;
    return {
      funis: Array.isArray(lido.funis) ? lido.funis.map((f) => ({ id: String(f.id), nome: String(f.nome) })) : [],
      ausentes: Array.isArray(lido.ausentes) ? lido.ausentes : [],
      quando,
      crm,
    };
  } catch {
    return null;
  }
}
