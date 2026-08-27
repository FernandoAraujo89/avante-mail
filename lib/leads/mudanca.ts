import { and, eq, inArray } from "drizzle-orm";

import { encerrarPercursosDoContato } from "@/lib/automations/engine";
import {
  contactLists,
  contacts,
  getDb,
  lists,
  type LeadStageRow,
} from "@/lib/db";
import { emitContactEvent, emitListDiff } from "@/lib/events";
import { idsDasListasDeLeads } from "@/lib/leads";

/**
 * O que acontece quando o Pipedrive fala sobre um lead — num lugar só.
 *
 * Duas portas trazem a mesma notícia: o webhook do agente (`entrada.ts`) e a
 * sincronização por reconciliação (`lib/pipedrive/sync.ts`). Se cada uma
 * aplicasse a mudança do seu jeito, as regras (encerrar ANTES do evento,
 * converter DEPOIS da etapa, não tocar em quem não é lead) divergiriam na
 * primeira manutenção — e o sintoma seria um lead nutrido depois de comprar.
 */

export interface MudancaDoLead {
  /** Slug já resolvido na tabela de qualificações. Nulo = não mexer. */
  qualificacao: string | null;
  /** Etapa já resolvida na tabela. Nulo = não mexer. */
  etapa: LeadStageRow | null;
  /** De onde veio a notícia — vai no payload dos eventos ("webhook:lp", "pipedrive"). */
  origem: string;
}

export interface ResultadoDaMudanca {
  mudouQualificacao: boolean;
  mudouEtapa: boolean;
  percursosEncerrados: number;
  /** Nome da lista quando a etapa converteu o lead em parceiro. */
  convertidoPara: string | null;
  /** A conversão automática que a etapa pedia e não pôde ser feita. */
  conversaoRecusada: string | null;
}

const NADA: ResultadoDaMudanca = {
  mudouQualificacao: false,
  mudouEtapa: false,
  percursosEncerrados: 0,
  convertidoPara: null,
  conversaoRecusada: null,
};

/**
 * Aplica qualificação e/ou etapa a um lead, com tudo que a chegada numa etapa
 * provoca: encerramento da nutrição e conversão em parceiro.
 *
 * ORDEM IMPORTA, duas vezes:
 * - encerrar percursos ANTES de emitir `lead_stage_changed` — a automação que
 *   reage a "comprou" precisa poder rodar; se o evento saísse primeiro, o
 *   percurso novo nasceria e seria morto pelo encerramento no mesmo instante;
 * - converter DEPOIS do evento da etapa — a linha do tempo registra que ele
 *   CHEGOU em "comprou" e então virou parceiro, não um pulo direto para fora
 *   do funil que ninguém saberia explicar.
 */
export async function aplicarMudancaDoLead(
  contato: { id: string; stage: string | null; qualification: string | null },
  mudanca: MudancaDoLead
): Promise<ResultadoDaMudanca> {
  const db = getDb();

  // Contato que não é lead não entra no funil por aqui — mesma trava da
  // entrada: um parceiro citado num payload sairia calado das campanhas.
  if (contato.stage === null) return { ...NADA };

  const resultado: ResultadoDaMudanca = { ...NADA };

  const mudarQualificacao =
    mudanca.qualificacao !== null &&
    mudanca.qualificacao !== contato.qualification;
  const mudarEtapa =
    mudanca.etapa !== null && mudanca.etapa.slug !== contato.stage;

  if (!mudarQualificacao && !mudarEtapa) return resultado;

  await db
    .update(contacts)
    .set({
      ...(mudarQualificacao
        ? { qualification: mudanca.qualificacao, qualifiedAt: new Date() }
        : {}),
      ...(mudarEtapa
        ? { stage: mudanca.etapa!.slug, stageChangedAt: new Date() }
        : {}),
    })
    .where(eq(contacts.id, contato.id));

  if (mudarQualificacao) {
    resultado.mudouQualificacao = true;
    await emitContactEvent("lead_qualified", contato.id, {
      de: contato.qualification,
      qualificacao: mudanca.qualificacao,
      origem: mudanca.origem,
    });
  }

  if (mudarEtapa) {
    const etapa = mudanca.etapa!;
    resultado.mudouEtapa = true;

    resultado.percursosEncerrados = etapa.stopsNurturing
      ? await encerrarPercursosDoContato(
          contato.id,
          `etapa "${etapa.label}" encerra a nutrição`
        )
      : 0;

    await emitContactEvent("lead_stage_changed", contato.id, {
      de: contato.stage,
      para: etapa.slug,
      origem: mudanca.origem,
    });

    if (etapa.convertListId) {
      const conversao = await converterLeadEmParceiro(
        { id: contato.id, stage: etapa.slug },
        etapa.convertListId,
        `etapa "${etapa.label}"`
      );
      if ("erro" in conversao) {
        resultado.conversaoRecusada = conversao.erro;
      } else {
        resultado.convertidoPara = conversao.listaNome;
      }
    }
  }

  return resultado;
}

/**
 * Converte um lead em parceiro: sai do funil (`stage` nulo — é a linha que o
 * devolve ao público das campanhas), entra na lista de destino e deixa as
 * listas de leads. Sair do funil sem entrar numa lista deixaria o contato no
 * limbo, então as três coisas andam juntas.
 *
 * Usada pela ficha (ação manual) e pela chegada numa etapa com conversão
 * automática — as validações são as mesmas nos dois caminhos.
 */
export async function converterLeadEmParceiro(
  contato: { id: string; stage: string | null },
  listaDestinoId: string,
  origem: string
): Promise<{ listaNome: string; subscribed?: boolean } | { erro: string }> {
  const db = getDb();

  const [destino] = await db
    .select({ id: lists.id, kind: lists.kind, name: lists.name })
    .from(lists)
    .where(eq(lists.id, listaDestinoId));

  if (!destino) {
    return { erro: "Lista de destino não encontrada." };
  }
  // Converter para dentro da própria lista de leads não converteria nada —
  // o contato sairia do funil e continuaria no balcão de leads.
  if (destino.kind === "leads") {
    return {
      erro: "Escolha uma lista de parceiros, clientes ou colaboradores — converter para a própria lista de leads não muda nada.",
    };
  }

  const idsDeLeads = await idsDasListasDeLeads();

  // Estágio nulo = deixou de ser lead. É esta linha que devolve o contato ao
  // público das campanhas.
  await db
    .update(contacts)
    .set({ stage: null })
    .where(eq(contacts.id, contato.id));

  await db
    .insert(contactLists)
    .values({ contactId: contato.id, listId: destino.id })
    .onConflictDoNothing();

  if (idsDeLeads.length > 0) {
    await db
      .delete(contactLists)
      .where(
        and(
          eq(contactLists.contactId, contato.id),
          inArray(contactLists.listId, idsDeLeads)
        )
      );
  }

  await emitListDiff(contato.id, idsDeLeads, [destino.id]);
  await emitContactEvent("lead_stage_changed", contato.id, {
    de: contato.stage,
    para: null,
    acao: "convertido em parceiro",
    listId: destino.id,
    origem,
  });

  return { listaNome: destino.name };
}
