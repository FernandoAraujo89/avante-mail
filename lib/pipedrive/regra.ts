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
  /** Nome do funil do CRM em que o negócio está (para a ficha do lead). */
  funil?: string | null;
  /** Motivo da perda escrito no CRM (negócio perdido). */
  motivoPerda?: string | null;
  /** Quando o negócio foi fechado, segundo o CRM. */
  fechadoEm?: Date | null;
}

/**
 * Por que e quando o lead foi perdido. `null` em `perda` (na decisão) = não
 * mexer; um objeto com campos nulos = limpar (o lead voltou a ter negócio).
 */
export interface PerdaDoLead {
  motivo: string | null;
  em: Date | null;
}

export interface DecisaoDoLead {
  /** Nula = não mexer na etapa (sem negócio vivo, ou etapa que não casa). */
  etapa: LeadStageRow | null;
  /** Nula = não mexer na qualificação. */
  qualificacao: LeadQualificationRow | null;
  /** Nomes que não casaram com nada cadastrado aqui. */
  recusas: number;
  /** Funil do negócio que decidiu a etapa; nulo sem negócio vivo. */
  funil: string | null;
  /**
   * Motivo e data da perda. Preenchidos quando TODOS os negócios vivos estão
   * perdidos; zerados quando há aberto ou ganho; `null` (não mexer) sem
   * negócio vivo — o lead fica onde está, e o motivo junto.
   */
  perda: PerdaDoLead | null;
}

const SEM_PERDA: PerdaDoLead = { motivo: null, em: null };

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
    return { etapa: null, qualificacao: null, recusas: 0, funil: null, perda: null };
  }

  let recusas = 0;
  let etapa: LeadStageRow | null = null;
  let base: NegocioDoLead;
  let perda: PerdaDoLead = SEM_PERDA;

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
    // O motivo da perda mais recente. Se a última perda veio sem motivo, vale
    // o da anterior que tiver: para o remarketing, um motivo antigo diz mais
    // do que nenhum. A data é sempre a da perda mais recente.
    const comMotivo = vivos.find((n) => n.motivoPerda?.trim());
    perda = {
      motivo: comMotivo?.motivoPerda?.trim() ?? null,
      em: base.fechadoEm ?? null,
    };
  }

  // A qualificação do negócio que decidiu a etapa; se ele não tiver, a do
  // mais recente que tiver — é da pessoa, não do negócio.
  const comQualificacao = [base, ...vivos].find((n) => n.qualificacao);
  let qualificacao: LeadQualificationRow | null = null;
  if (comQualificacao?.qualificacao) {
    qualificacao = casarQualificacao(qualificacoes, comQualificacao.qualificacao);
    if (!qualificacao) recusas++;
  }

  return { etapa, qualificacao, recusas, funil: base.funil ?? null, perda };
}
