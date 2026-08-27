import { inArray } from "drizzle-orm";

import { contacts, getDb, type LeadStageRow } from "@/lib/db";
import { casarEtapa, listarEtapas } from "@/lib/leads/etapas";
import {
  casarQualificacao,
  listarQualificacoes,
} from "@/lib/leads/qualificacoes";
import { aplicarMudancaDoLead } from "@/lib/leads/mudanca";
import { firstValidPhone } from "@/lib/phone";
import { getSetting, setSetting } from "@/lib/settings";
import { clientePipedrive, type PipedriveApi } from "./client";

/**
 * Reconciliação com o Pipedrive (docs/plano-webhooks-leads.md, seção
 * "Sincronização com o Pipedrive").
 *
 * O sistema tem uma porta de webhook pronta para receber qualificação e etapa
 * — e ela ficou TRÊS SEMANAS esperando um push que nunca foi configurado no
 * Make, sem nenhum erro em lugar nenhum: só um funil parado. Integração por
 * evento falha assim, em silêncio. Este job PUXA: a cada passada, lê os deals
 * do funil que mudaram desde a última e aplica qualificação, marco do funil e
 * compra. Converge sozinho, faz o backfill do que já existia, e um push (Make)
 * por cima vira só uma questão de latência, não de correção.
 *
 * A marca-d'água (`update_time` do último deal processado) fica em
 * app_settings, então a passada sobrevive a restart e não relê a base inteira.
 * A PRIMEIRA passada, sem marca, lê tudo — é o backfill.
 */

const CHAVE_DESDE = "pipedrive_sync_desde";
const CHAVE_ULTIMA = "pipedrive_sync_ultima";

/** Deal ganho vira esta etapa — a que encerra a nutrição e converte. */
const ETAPA_DE_COMPRA = "comprou";
/** Deal perdido vira esta etapa SE ela estiver cadastrada; senão, não mexe. */
const ETAPA_DE_PERDA = "perdido";

/** Páginas de 500 deals por passada — o resto fica para a próxima. */
const PAGINAS_POR_PASSADA = 4;

export interface ResultadoDaSincronizacao {
  rodou: boolean;
  motivo?: string;
  deals?: number;
  etapasAplicadas?: number;
  qualificacoesAplicadas?: number;
  convertidos?: number;
  semContato?: number;
  recusas?: number;
}

// Avisos que só fazem sentido uma vez por processo — sem isto o worker
// repetiria "sem token" a cada 10 segundos no log.
let avisouSemToken = false;
let avisouConfig: string | null = null;

function normalizado(texto: string): string {
  return texto.trim().toLowerCase();
}

/** O rótulo da opção escolhida no campo de qualificação, das formas que a API manda. */
function rotuloDaOpcao(
  cru: unknown,
  opcoes: Map<number, string>
): string | null {
  if (cru === null || cru === undefined || cru === "") return null;
  if (typeof cru === "number") return opcoes.get(cru) ?? null;
  if (typeof cru === "string") {
    const numero = Number(cru);
    if (Number.isFinite(numero) && opcoes.has(numero)) {
      return opcoes.get(numero) ?? null;
    }
    return cru;
  }
  if (typeof cru === "object" && "id" in (cru as Record<string, unknown>)) {
    return opcoes.get(Number((cru as { id: unknown }).id)) ?? null;
  }
  return null;
}

export async function sincronizarPipedrive(args?: {
  api?: PipedriveApi;
  intervaloMin?: number;
  agora?: Date;
}): Promise<ResultadoDaSincronizacao> {
  const agora = args?.agora ?? new Date();

  let api = args?.api;
  if (!api) {
    const token = process.env.PIPEDRIVE_API_TOKEN;
    if (!token) {
      if (!avisouSemToken) {
        avisouSemToken = true;
        console.log(
          "[PIPEDRIVE] PIPEDRIVE_API_TOKEN não definido — sincronização desligada."
        );
      }
      return { rodou: false, motivo: "sem-token" };
    }
    api = clientePipedrive(token);
  }

  // Regula a si mesma, como a passagem diária do score: o worker chama a cada
  // ciclo e ela decide se já passou o intervalo.
  const intervaloMin = args?.intervaloMin ?? 5;
  const ultima = await getSetting(CHAVE_ULTIMA);
  if (ultima) {
    const minutos = (agora.getTime() - new Date(ultima).getTime()) / 60_000;
    if (Number.isFinite(minutos) && minutos < intervaloMin) {
      return { rodou: false, motivo: "aguardando-intervalo" };
    }
  }

  const nomeDoFunil = process.env.PIPEDRIVE_PIPELINE ?? "White Label - Inbound";
  const nomeDoCampo =
    process.env.PIPEDRIVE_CAMPO_QUALIFICACAO ?? "Lead qualificado";

  const pipelines = await api.pipelines();
  const funil = pipelines.find(
    (p) => normalizado(p.name) === normalizado(nomeDoFunil)
  );
  if (!funil) {
    // Marca a passada mesmo assim: sem isto, a cada ciclo de 10s uma chamada
    // iria à API para redescobrir o mesmo problema.
    await setSetting(CHAVE_ULTIMA, agora.toISOString());
    const aviso = `funil "${nomeDoFunil}" não encontrado no Pipedrive`;
    if (avisouConfig !== aviso) {
      avisouConfig = aviso;
      console.error(`[PIPEDRIVE] ${aviso} — confira PIPEDRIVE_PIPELINE.`);
    }
    return { rodou: false, motivo: "funil-nao-encontrado" };
  }

  const [nomesDasEtapasPd, campo, etapas, qualificacoes] = await Promise.all([
    api.stages(funil.id),
    api.campoDeDeal(nomeDoCampo),
    listarEtapas(true),
    listarQualificacoes(true),
  ]);
  if (!campo && avisouConfig !== "sem-campo") {
    avisouConfig = "sem-campo";
    console.error(
      `[PIPEDRIVE] campo "${nomeDoCampo}" não existe no Pipedrive — sincronizando só as etapas.`
    );
  }

  const desde = (await getSetting(CHAVE_DESDE)) ?? undefined;

  let cursor: string | undefined;
  let totalDeals = 0;
  let etapasAplicadas = 0;
  let qualificacoesAplicadas = 0;
  let convertidos = 0;
  let semContato = 0;
  let recusas = 0;
  let maiorUpdate: string | null = null;

  for (let pagina = 0; pagina < PAGINAS_POR_PASSADA; pagina++) {
    const { deals, nextCursor } = await api.deals({
      pipelineId: funil.id,
      campoKey: campo?.key ?? null,
      updatedSince: desde,
      cursor,
    });
    if (deals.length === 0) break;
    totalDeals += deals.length;

    // Identidades do lote inteiro de uma vez: uma consulta por página, não
    // duas por deal.
    const idsDePessoas = [
      ...new Set(deals.map((d) => d.personId).filter((id): id is number => id !== null)),
    ];
    const pessoas = await api.pessoas(idsDePessoas);

    const emails = new Set<string>();
    const telefones = new Set<string>();
    for (const pessoa of pessoas.values()) {
      for (const e of pessoa.emails) emails.add(e.toLowerCase());
      const tel = firstValidPhone(pessoa.phones.join(" / "));
      if (tel) telefones.add(tel);
    }

    // Duas consultas por página (e-mail e telefone) em vez de duas por deal.
    // Traz também quem tem `stage` nulo: parceiro reconhecido é "pular", que
    // é diferente de "não achei" — os dois contam em lugares diferentes.
    const db = getDb();
    const colunas = {
      id: contacts.id,
      email: contacts.email,
      phone: contacts.phone,
      stage: contacts.stage,
      qualification: contacts.qualification,
    };
    const linhasPorEmail =
      emails.size > 0
        ? await db
            .select(colunas)
            .from(contacts)
            .where(inArray(contacts.email, [...emails]))
        : [];
    const linhasPorTelefone =
      telefones.size > 0
        ? await db
            .select(colunas)
            .from(contacts)
            .where(inArray(contacts.phone, [...telefones]))
        : [];

    const porEmail = new Map(
      linhasPorEmail.map((c) => [c.email.toLowerCase(), c])
    );
    const mapaTelefone = new Map(
      linhasPorTelefone
        .filter((c) => c.phone)
        .map((c) => [c.phone as string, c])
    );

    for (const deal of deals) {
      maiorUpdate = deal.updateTime || maiorUpdate;
      if (deal.personId === null) continue;
      const pessoa = pessoas.get(deal.personId);
      if (!pessoa) continue;

      let contato =
        pessoa.emails
          .map((e) => porEmail.get(e.toLowerCase()))
          .find(Boolean) ?? null;
      if (!contato) {
        const tel = firstValidPhone(pessoa.phones.join(" / "));
        contato = (tel ? mapaTelefone.get(tel) : null) ?? null;
      }
      if (!contato) {
        semContato++;
        continue;
      }
      // Convertido no meio do lote (dois deals da mesma pessoa): não é mais lead.
      if (contato.stage === null) continue;

      // Qualificação: o rótulo exato da opção no Pipedrive, resolvido na
      // tabela — as mesmas 7 formas que o webhook aceita.
      let qualificacao: string | null = null;
      if (campo) {
        const rotulo = rotuloDaOpcao(deal.qualificacaoCrua, campo.opcoes);
        if (rotulo) {
          qualificacao = casarQualificacao(qualificacoes, rotulo)?.slug ?? null;
          if (!qualificacao) recusas++;
        }
      }

      // Etapa: ganho → compra; perdido → "perdido" se cadastrada; aberto →
      // o nome da etapa do funil, traduzido pelos apelidos.
      let etapa: LeadStageRow | null = null;
      if (deal.status === "won") {
        etapa = casarEtapa(etapas, ETAPA_DE_COMPRA);
        if (!etapa) recusas++;
      } else if (deal.status === "lost") {
        etapa = casarEtapa(etapas, ETAPA_DE_PERDA);
      } else if (deal.status === "open") {
        const nome = nomesDasEtapasPd.get(deal.stageId);
        if (nome) {
          etapa = casarEtapa(etapas, nome);
          if (!etapa) recusas++;
        }
      }

      const aplicado = await aplicarMudancaDoLead(contato, {
        qualificacao,
        etapa,
        origem: "pipedrive",
      });

      // O retrato em memória acompanha o banco: um segundo deal da mesma
      // pessoa neste lote precisa ver o estado novo, não o da consulta.
      if (aplicado.mudouQualificacao) {
        qualificacoesAplicadas++;
        contato.qualification = qualificacao;
      }
      if (aplicado.mudouEtapa && etapa) {
        etapasAplicadas++;
        contato.stage = etapa.slug;
      }
      if (aplicado.convertidoPara) {
        convertidos++;
        contato.stage = null;
      }
      if (aplicado.conversaoRecusada) recusas++;
    }

    if (!nextCursor) {
      cursor = undefined;
      break;
    }
    cursor = nextCursor;
  }

  if (maiorUpdate) await setSetting(CHAVE_DESDE, maiorUpdate);
  await setSetting(CHAVE_ULTIMA, agora.toISOString());

  return {
    rodou: true,
    deals: totalDeals,
    etapasAplicadas,
    qualificacoesAplicadas,
    convertidos,
    semContato,
    recusas,
  };
}
