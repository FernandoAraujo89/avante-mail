import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";

import {
  contacts,
  getDb,
  pipedriveDeals,
  type LeadQualificationRow,
  type LeadStageRow,
} from "@/lib/db";
import { listarEtapas } from "@/lib/leads/etapas";
import { listarQualificacoes } from "@/lib/leads/qualificacoes";
import { aplicarMudancaDoLead } from "@/lib/leads/mudanca";
import { contatosPorEnderecos } from "@/lib/contatos/enderecos";
import { normalizePhone } from "@/lib/phone";
import { phoneCandidatesFromWaId } from "@/lib/whatsapp/inbound";
import { getSetting, setSetting } from "@/lib/settings";
import {
  clientePipedrive,
  type DealDoPipedrive,
  type PipedriveApi,
} from "./client";
import {
  CHAVE_FUNIS,
  CHAVE_FUNIS_DA_ULTIMA,
  CHAVE_ULTIMA,
  lerIdsDosFunis,
  type FunisDaUltimaPassada,
} from "./funis";
import { decidirPelosNegocios, type NegocioDoLead } from "./regra";

/**
 * Reconciliação com o Pipedrive (docs/plano-webhooks-leads.md, seção
 * "Sincronização com o Pipedrive").
 *
 * O sistema tem uma porta de webhook pronta para receber qualificação e etapa
 * — e ela ficou TRÊS SEMANAS esperando um push que nunca foi configurado no
 * Make, sem nenhum erro em lugar nenhum: só um funil parado. Integração por
 * evento falha assim, em silêncio. Este job PUXA: a cada passada, lê os deals
 * dos funis que mudaram desde a última e aplica qualificação, etapa e compra.
 * Converge sozinho, faz o backfill do que já existia, e um push (Make) por
 * cima vira só uma questão de latência, não de correção.
 *
 * MAIS DE UM FUNIL desde 14/09/2026 ("White Label - Inbound" e
 * "SDR-TESTE-NRG"): os dois têm as mesmas etapas, e o funil daqui é um só.
 * Os funis acompanhados moram em app_settings POR ID — renomear um funil no
 * Pipedrive (e um nome com "TESTE" pede para ser renomeado) não pode parar a
 * sincronização em silêncio.
 *
 * Cada funil tem sua marca-d'água (`update_time` do último deal processado
 * dele) em app_settings, então a passada sobrevive a restart e não relê a base
 * inteira. A PRIMEIRA passada de um funil, sem marca, lê tudo — é o backfill.
 *
 * DESDE 15/09/2026 a etapa do lead é decidida por TODOS os negócios dele, não
 * pelo último que mudou (lib/pipedrive/regra.ts). A passada lê só o que mudou,
 * então os negócios lidos ficam num espelho local (`pipedrive_deals`), cada um
 * com o lead que casou; depois, cada lead tocado é decidido de novo pelo
 * conjunto — no máximo uma mudança por lead, e reler não mexe em ninguém.
 */

/** Marca-d'água, uma por funil: `pipedrive_sync_desde:<id>`. */
const CHAVE_DESDE = "pipedrive_sync_desde";

/** Começo da releitura completa de um funil: `pipedrive_releitura_inicio:<id>`. */
const CHAVE_INICIO_DA_RELEITURA = "pipedrive_releitura_inicio";
/** Quando a última releitura diária foi disparada. */
const CHAVE_ULTIMA_RELEITURA = "pipedrive_releitura_ultima";
/** De quanto em quanto tempo a passada relê os funis inteiros. */
const HORAS_ENTRE_RELEITURAS = 20;
/** Negócio que não apareceu na releitura: excluído ou movido de funil. */
const STATUS_FORA = "fora";

/** Páginas de 500 deals por funil a cada passada — o resto fica para a próxima. */
const PAGINAS_POR_FUNIL = 4;
/** Deals aplicados por vez: uma consulta de pessoas e duas de contatos por lote. */
const TAMANHO_DO_LOTE = 500;

export interface ResultadoDaSincronizacao {
  rodou: boolean;
  motivo?: string;
  funis?: number;
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
let avisouTelefone = false;

/**
 * Todas as formas E.164 sob as quais os telefones da pessoa podem estar
 * cadastrados aqui: CADA número dela (e cada número de um campo com dois, "37
 * 99947-2264 / 37 3241-0000"), não só o primeiro, e cada um com e sem o nono
 * dígito — a mesma regra que casa a resposta do WhatsApp com o contato.
 *
 * Até 15/09/2026 o telefone não casava nada: a biblioteca morria sob tsx, que
 * é como o worker roda (lib/phone.ts explica e corrige). O `try` fica como rede
 * de segurança — o telefone é o segundo critério, e se a biblioteca voltar a
 * falhar a passada segue casando por e-mail, com um aviso, em vez de parar.
 */
function telefonesDaPessoa(textos: string[]): string[] {
  const formas = new Set<string>();
  try {
    for (const texto of textos) {
      for (const pedaco of texto.split(/[,;/|\r\n]+/)) {
        const e164 = normalizePhone(pedaco);
        if (!e164) continue;
        for (const forma of phoneCandidatesFromWaId(e164)) formas.add(forma);
      }
    }
  } catch {
    if (!avisouTelefone) {
      avisouTelefone = true;
      console.error(
        "[PIPEDRIVE] telefone indisponível neste runtime — casando leads só por e-mail."
      );
    }
  }
  return [...formas];
}

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

async function resolverFunis(
  api: PipedriveApi
): Promise<{ funis: { id: number; name: string }[]; ausentes: string[] }> {
  const pipelines = await api.pipelines();
  const ids = lerIdsDosFunis(await getSetting(CHAVE_FUNIS));

  if (ids) {
    return {
      funis: ids
        .map((id) => pipelines.find((p) => p.id === id))
        .filter((p): p is { id: number; name: string } => Boolean(p)),
      ausentes: ids
        .filter((id) => !pipelines.some((p) => p.id === id))
        .map((id) => `#${id}`),
    };
  }

  const nome = process.env.PIPEDRIVE_PIPELINE ?? "White Label - Inbound";
  const funil = pipelines.find(
    (p) => normalizado(p.name) === normalizado(nome)
  );
  return { funis: funil ? [funil] : [], ausentes: funil ? [] : [`"${nome}"`] };
}

interface Contagem {
  etapasAplicadas: number;
  qualificacoesAplicadas: number;
  convertidos: number;
  semContato: number;
  recusas: number;
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

  // A passada se marca ANTES de trabalhar: uma falha no meio (API fora, token
  // errado) espera o intervalo como uma passada boa, em vez de martelar a API
  // a cada ciclo de 10 segundos do worker. As marcas-d'água dos deals são
  // outra coisa — elas só avançam no fim, então nada processado se perde.
  await setSetting(CHAVE_ULTIMA, agora.toISOString());

  const nomeDoCampo =
    process.env.PIPEDRIVE_CAMPO_QUALIFICACAO ?? "Lead qualificado";

  const { funis, ausentes } = await resolverFunis(api);
  await setSetting(
    CHAVE_FUNIS_DA_ULTIMA,
    JSON.stringify({
      funis: funis.map((f) => ({ id: f.id, nome: f.name })),
      ausentes,
    } satisfies FunisDaUltimaPassada)
  );
  if (ausentes.length > 0) {
    // Um funil que sumiu não para os outros — mas precisa aparecer no log.
    const aviso = `funil ${ausentes.join(", ")} não encontrado no Pipedrive`;
    if (avisouConfig !== aviso) {
      avisouConfig = aviso;
      console.error(
        `[PIPEDRIVE] ${aviso} — confira ${CHAVE_FUNIS} em app_settings (ou PIPEDRIVE_PIPELINE).`
      );
    }
  }
  if (funis.length === 0) {
    return { rodou: false, motivo: "funil-nao-encontrado" };
  }

  const [etapasPorFunil, campo, etapas, qualificacoes] = await Promise.all([
    Promise.all(funis.map((f) => api.stages(f.id))),
    api.campoDeDeal(nomeDoCampo),
    listarEtapas(true),
    listarQualificacoes(true),
  ]);
  // Id de etapa é único na conta inteira: um mapa só serve a todos os funis.
  const nomesDasEtapasPd = new Map(etapasPorFunil.flatMap((m) => [...m]));
  if (!campo && avisouConfig !== "sem-campo") {
    avisouConfig = "sem-campo";
    console.error(
      `[PIPEDRIVE] campo "${nomeDoCampo}" não existe no Pipedrive — sincronizando só as etapas.`
    );
  }

  // Uma vez por dia a passada relê os funis inteiros: é o que tira da conta o
  // negócio excluído ou movido para um funil que não é acompanhado (a leitura
  // incremental nunca mais o vê), e o que acha o lead que chegou DEPOIS do
  // negócio dele parar de mudar.
  const ultimaReleitura = await getSetting(CHAVE_ULTIMA_RELEITURA);
  const horasDesdeReleitura = ultimaReleitura
    ? (agora.getTime() - new Date(ultimaReleitura).getTime()) / 3_600_000
    : Number.POSITIVE_INFINITY;
  if (!(horasDesdeReleitura < HORAS_ENTRE_RELEITURAS)) {
    for (const funil of funis) {
      await setSetting(`${CHAVE_DESDE}:${funil.id}`, null);
    }
    await setSetting(CHAVE_ULTIMA_RELEITURA, agora.toISOString());
  }

  // Cada funil a partir da sua marca-d'água.
  const lidos = new Map<number, { deal: DealDoPipedrive; funilId: number }>();
  const marcas = new Map<number, string>();
  const chegaramAoFim = new Set<number>();
  for (const funil of funis) {
    const desde =
      (await getSetting(`${CHAVE_DESDE}:${funil.id}`)) || undefined;
    // Sem marca-d'água é leitura completa. O começo fica guardado: quando ela
    // chegar ao fim — nesta passada ou numa seguinte, se o funil for grande —
    // o negócio lido antes disso e que não apareceu de novo saiu do funil.
    const chaveInicio = `${CHAVE_INICIO_DA_RELEITURA}:${funil.id}`;
    if (!desde && !(await getSetting(chaveInicio))) {
      await setSetting(chaveInicio, agora.toISOString());
    }
    let cursor: string | undefined;
    for (let pagina = 0; pagina < PAGINAS_POR_FUNIL; pagina++) {
      const { deals, nextCursor } = await api.deals({
        pipelineId: funil.id,
        campoKey: campo?.key ?? null,
        updatedSince: desde,
        cursor,
      });
      for (const deal of deals) {
        // O mesmo negócio pode vir duas vezes (mudou de funil no meio da
        // leitura): fica a versão mais nova.
        const anterior = lidos.get(deal.id);
        if (!anterior || anterior.deal.updateTime <= deal.updateTime) {
          lidos.set(deal.id, { deal, funilId: funil.id });
        }
        // A API devolve em ordem de update_time: o último é a marca nova.
        if (deal.updateTime) marcas.set(funil.id, deal.updateTime);
      }
      if (deals.length === 0 || !nextCursor) {
        chegaramAoFim.add(funil.id);
        break;
      }
      cursor = nextCursor;
    }
  }

  const contagem: Contagem = {
    etapasAplicadas: 0,
    qualificacoesAplicadas: 0,
    convertidos: 0,
    semContato: 0,
    recusas: 0,
  };

  // 1. Guarda os negócios lidos, cada um com o lead que casou.
  const afetados = new Set<string>();
  const todos = [...lidos.values()];
  for (let i = 0; i < todos.length; i += TAMANHO_DO_LOTE) {
    await espelharLote(todos.slice(i, i + TAMANHO_DO_LOTE), {
      api,
      campo,
      nomesDasEtapasPd,
      agora,
      afetados,
      contagem,
    });
  }

  // 2. Releitura que chegou ao fim: o que não apareceu saiu do funil.
  const db = getDb();
  for (const funilId of chegaramAoFim) {
    const chaveInicio = `${CHAVE_INICIO_DA_RELEITURA}:${funilId}`;
    const inicio = await getSetting(chaveInicio);
    if (!inicio) continue;
    const sairam = await db
      .update(pipedriveDeals)
      .set({ status: STATUS_FORA })
      .where(
        and(
          eq(pipedriveDeals.pipelineId, funilId),
          lt(pipedriveDeals.lidoEm, new Date(inicio)),
          ne(pipedriveDeals.status, STATUS_FORA)
        )
      )
      .returning({ contactId: pipedriveDeals.contactId });
    for (const saiu of sairam) {
      if (saiu.contactId) afetados.add(saiu.contactId);
    }
    await setSetting(chaveInicio, null);
  }

  // 3. Decide cada lead afetado por todos os negócios dele.
  await recalcularLeads([...afetados], {
    funis: funis.map((f) => f.id),
    etapas,
    qualificacoes,
    contagem,
  });

  for (const [funilId, marca] of marcas) {
    await setSetting(`${CHAVE_DESDE}:${funilId}`, marca);
  }

  return {
    rodou: true,
    funis: funis.length,
    deals: lidos.size,
    ...contagem,
  };
}

/**
 * Casa os negócios de um lote com os leads (e-mail primeiro, depois telefone)
 * e grava no espelho. Junta em `afetados` o lead de cada negócio — e também o
 * lead ANTIGO, quando o negócio deixou de casar com ele.
 */
async function espelharLote(
  lote: { deal: DealDoPipedrive; funilId: number }[],
  ctx: {
    api: PipedriveApi;
    campo: { key: string; opcoes: Map<number, string> } | null;
    nomesDasEtapasPd: Map<number, string>;
    agora: Date;
    afetados: Set<string>;
    contagem: Contagem;
  }
): Promise<void> {
  const { api, campo, nomesDasEtapasPd, agora, afetados, contagem } = ctx;

  // Identidades do lote inteiro de uma vez: uma consulta por lote, não duas
  // por deal.
  const idsDePessoas = [
    ...new Set(
      lote
        .map(({ deal }) => deal.personId)
        .filter((id): id is number => id !== null)
    ),
  ];
  const pessoas = await api.pessoas(idsDePessoas);

  const emails = new Set<string>();
  const telefones = new Set<string>();
  const telefonesPorPessoa = new Map<number, string[]>();
  for (const [idDaPessoa, pessoa] of pessoas) {
    for (const e of pessoa.emails) emails.add(e.toLowerCase());
    const formas = telefonesDaPessoa(pessoa.phones);
    telefonesPorPessoa.set(idDaPessoa, formas);
    for (const forma of formas) telefones.add(forma);
  }

  // Pelos endereços do contato (todos os e-mails e telefones dele, não só o
  // principal), em lote. Traz também parceiro (`stage` nulo): o negócio casa
  // com ele e fica guardado, e a decisão é que o deixa de fora — parceiro não
  // volta a lead.
  const db = getDb();
  const [{ porEmail, porTelefone }, anteriores] = await Promise.all([
    contatosPorEnderecos(db, {
      emails: [...emails],
      phones: [...telefones],
    }),
    db
      .select({ id: pipedriveDeals.id, contactId: pipedriveDeals.contactId })
      .from(pipedriveDeals)
      .where(
        inArray(
          pipedriveDeals.id,
          lote.map(({ deal }) => deal.id)
        )
      ),
  ]);
  const contatoAnterior = new Map(anteriores.map((a) => [a.id, a.contactId]));

  const linhas = lote.map(({ deal, funilId }) => {
    const pessoa = deal.personId === null ? null : pessoas.get(deal.personId);
    const contactId = pessoa
      ? (pessoa.emails
          .map((e) => porEmail.get(e.toLowerCase()))
          .find(Boolean) ??
        (telefonesPorPessoa.get(deal.personId as number) ?? [])
          .map((forma) => porTelefone.get(forma))
          .find(Boolean) ??
        null)
      : null;
    if (!contactId) contagem.semContato++;

    if (contactId) afetados.add(contactId);
    const antes = contatoAnterior.get(deal.id);
    if (antes && antes !== contactId) afetados.add(antes);

    return {
      id: deal.id,
      pipelineId: funilId,
      stageName: nomesDasEtapasPd.get(deal.stageId) ?? null,
      status: deal.status,
      personId: deal.personId,
      contactId,
      qualificacao: campo
        ? rotuloDaOpcao(deal.qualificacaoCrua, campo.opcoes)
        : null,
      updateTime: deal.updateTime,
      lidoEm: agora,
    };
  });

  if (linhas.length === 0) return;
  await db
    .insert(pipedriveDeals)
    .values(linhas)
    .onConflictDoUpdate({
      target: pipedriveDeals.id,
      set: {
        pipelineId: sql`excluded.pipeline_id`,
        stageName: sql`excluded.stage_name`,
        status: sql`excluded.status`,
        personId: sql`excluded.person_id`,
        contactId: sql`excluded.contact_id`,
        qualificacao: sql`excluded.qualificacao`,
        updateTime: sql`excluded.update_time`,
        lidoEm: sql`excluded.lido_em`,
      },
    });
}

/**
 * Decide cada lead pelos negócios dele que estão guardados (só dos funis
 * acompanhados) e aplica a mudança — no máximo uma por lead por passada.
 */
async function recalcularLeads(
  ids: string[],
  ctx: {
    funis: number[];
    etapas: LeadStageRow[];
    qualificacoes: LeadQualificationRow[];
    contagem: Contagem;
  }
): Promise<void> {
  const { funis, etapas, qualificacoes, contagem } = ctx;
  const db = getDb();

  for (let i = 0; i < ids.length; i += TAMANHO_DO_LOTE) {
    const lote = ids.slice(i, i + TAMANHO_DO_LOTE);
    const [leads, negocios] = await Promise.all([
      db
        .select({
          id: contacts.id,
          stage: contacts.stage,
          qualification: contacts.qualification,
        })
        .from(contacts)
        .where(inArray(contacts.id, lote)),
      db
        .select({
          contactId: pipedriveDeals.contactId,
          status: pipedriveDeals.status,
          stageName: pipedriveDeals.stageName,
          qualificacao: pipedriveDeals.qualificacao,
          updateTime: pipedriveDeals.updateTime,
        })
        .from(pipedriveDeals)
        .where(
          and(
            inArray(pipedriveDeals.contactId, lote),
            inArray(pipedriveDeals.pipelineId, funis)
          )
        ),
    ]);

    const porContato = new Map<string, NegocioDoLead[]>();
    for (const n of negocios) {
      if (!n.contactId) continue;
      const lista = porContato.get(n.contactId) ?? [];
      lista.push(n);
      porContato.set(n.contactId, lista);
    }

    for (const lead of leads) {
      // Parceiro não é lead: a regra única de mudança recusaria de todo jeito,
      // e a decisão contaria recusas que não são problema de ninguém.
      if (lead.stage === null) continue;

      const decisao = decidirPelosNegocios(
        porContato.get(lead.id) ?? [],
        etapas,
        qualificacoes
      );
      contagem.recusas += decisao.recusas;

      const aplicado = await aplicarMudancaDoLead(lead, {
        qualificacao: decisao.qualificacao?.slug ?? null,
        etapa: decisao.etapa,
        origem: "pipedrive",
      });
      if (aplicado.mudouQualificacao) contagem.qualificacoesAplicadas++;
      if (aplicado.mudouEtapa) contagem.etapasAplicadas++;
      if (aplicado.convertidoPara) contagem.convertidos++;
      if (aplicado.conversaoRecusada) contagem.recusas++;
    }
  }
}
