import type { LeadQualificationRow, LeadStageRow } from "@/lib/db";
import { casarEtapa, ETAPA_DE_PERDA } from "@/lib/leads/etapas";
import { casarQualificacao } from "@/lib/leads/qualificacoes";

/**
 * Onde o lead está, decidido por TODOS os negócios dele nos funis acompanhados
 * — não pelo último que mudou.
 *
 * Com "vale o que mudou por último", o lead com um negócio perdido e outro
 * aberto ia para Perdido e voltava na mesma passada, e cada releitura repetia a
 * ida e a volta: a linha do tempo registrava as duas, a automação de "Lead
 * andou no funil" disparava duas vezes, e um negócio perdido atualizado depois
 * escondia um que seguia aberto (25 leads em 15/09/2026). Decidindo pelo
 * conjunto, a mesma lista de negócios dá sempre a mesma resposta, e reler não
 * mexe em ninguém.
 *
 * Pura: recebe os negócios já guardados e as tabelas de etapa e qualificação.
 */

/** Um negócio do espelho local (`pipedrive_deals`), do jeito que a regra precisa. */
export interface NegocioDoLead {
  status: string;
  /** Nome da etapa no Pipedrive, cru — resolvido pelos nomes e apelidos daqui. */
  stageName: string | null;
  /** Rótulo da opção do campo de qualificação no Pipedrive. */
  qualificacao: string | null;
  updateTime: string;
}

export interface DecisaoDoLead {
  /** Nula = não mexer na etapa (sem negócio vivo, ou etapa que não casa). */
  etapa: LeadStageRow | null;
  /** Nula = não mexer na qualificação. */
  qualificacao: LeadQualificationRow | null;
  /** Nomes que não casaram com nada cadastrado aqui. */
  recusas: number;
}

const ETAPA_DE_COMPRA = "comprou";

/** Mais recente primeiro. */
function porAtualizacao(a: NegocioDoLead, b: NegocioDoLead): number {
  return b.updateTime.localeCompare(a.updateTime);
}

export function decidirPelosNegocios(
  negocios: NegocioDoLead[],
  etapas: LeadStageRow[],
  qualificacoes: LeadQualificationRow[]
): DecisaoDoLead {
  // Excluído no Pipedrive, ou fora dos funis acompanhados: não existe mais
  // para a decisão.
  const vivos = negocios
    .filter((n) => ["open", "won", "lost"].includes(n.status))
    .sort(porAtualizacao);
  if (vivos.length === 0) {
    return { etapa: null, qualificacao: null, recusas: 0 };
  }

  let recusas = 0;
  let etapa: LeadStageRow | null = null;
  let base: NegocioDoLead;

  const ganhos = vivos.filter((n) => n.status === "won");
  const abertos = vivos.filter((n) => n.status === "open");

  if (ganhos.length > 0) {
    // Comprou vence tudo: um negócio aberto ao lado (outro produto, um
    // aditivo) não desfaz a compra.
    base = ganhos[0];
    etapa = casarEtapa(etapas, ETAPA_DE_COMPRA);
    if (!etapa) recusas++;
  } else if (abertos.length > 0) {
    // Negócio aberto vence o perdido. Entre abertos, vale o mais adiantado
    // no funil — é onde a relação com o lead chegou; empate, o mais recente.
    const resolvidos = abertos.map((n) => ({
      negocio: n,
      etapa: n.stageName ? casarEtapa(etapas, n.stageName) : null,
    }));
    recusas += resolvidos.filter(
      (r) => r.negocio.stageName !== null && !r.etapa
    ).length;
    const escolhido = resolvidos
      .filter((r): r is { negocio: NegocioDoLead; etapa: LeadStageRow } =>
        Boolean(r.etapa)
      )
      .sort(
        (a, b) =>
          b.etapa.position - a.etapa.position ||
          porAtualizacao(a.negocio, b.negocio)
      )[0];
    base = escolhido?.negocio ?? abertos[0];
    // Aberto com etapa que não casa não vira Perdido: o negócio existe, só
    // não sabemos em que etapa ele está. Melhor não mexer.
    etapa = escolhido?.etapa ?? null;
  } else {
    // Todos perdidos. Sem a etapa "perdido" cadastrada, não mexe.
    base = vivos[0];
    etapa = casarEtapa(etapas, ETAPA_DE_PERDA);
  }

  // A qualificação do negócio que decidiu a etapa; se ele não tiver, a do
  // mais recente que tiver — é da pessoa, não do negócio.
  const comQualificacao = [base, ...vivos].find((n) => n.qualificacao);
  let qualificacao: LeadQualificationRow | null = null;
  if (comQualificacao?.qualificacao) {
    qualificacao = casarQualificacao(qualificacoes, comQualificacao.qualificacao);
    if (!qualificacao) recusas++;
  }

  return { etapa, qualificacao, recusas };
}
