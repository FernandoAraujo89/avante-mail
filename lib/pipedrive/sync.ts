import { inArray } from "drizzle-orm";

import {
  contacts,
  getDb,
  type LeadQualificationRow,
  type LeadStageRow,
} from "@/lib/db";
import {
  casarEtapa,
  ETAPA_DE_PERDA,
  listarEtapas,
} from "@/lib/leads/etapas";
import {
  casarQualificacao,
  listarQualificacoes,
} from "@/lib/leads/qualificacoes";
import { aplicarMudancaDoLead } from "@/lib/leads/mudanca";
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
 */

/** Marca-d'água, uma por funil: `pipedrive_sync_desde:<id>`. */
const CHAVE_DESDE = "pipedrive_sync_desde";

/** Deal ganho vira esta etapa — a que encerra a nutrição e converte. */
const ETAPA_DE_COMPRA = "comprou";
// Deal perdido vira ETAPA_DE_PERDA SE ela estiver cadastrada; senão, não mexe.

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

  // Cada funil a partir da sua marca-d'água.
  const lidos: DealDoPipedrive[] = [];
  const marcas = new Map<number, string>();
  for (const funil of funis) {
    const desde = (await getSetting(`${CHAVE_DESDE}:${funil.id}`)) ?? undefined;
    let cursor: string | undefined;
    for (let pagina = 0; pagina < PAGINAS_POR_FUNIL; pagina++) {
      const { deals, nextCursor } = await api.deals({
        pipelineId: funil.id,
        campoKey: campo?.key ?? null,
        updatedSince: desde,
        cursor,
      });
      for (const deal of deals) {
        lidos.push(deal);
        // A API devolve em ordem de update_time: o último é a marca nova.
        if (deal.updateTime) marcas.set(funil.id, deal.updateTime);
      }
      if (deals.length === 0 || !nextCursor) break;
      cursor = nextCursor;
    }
  }

  // Os funis misturados, na ordem em que os deals mudaram. Se a mesma pessoa
  // tiver negócio nos dois, vale o que mudou por último — e não o do funil
  // que por acaso foi lido depois.
  lidos.sort((a, b) => a.updateTime.localeCompare(b.updateTime));

  const contagem: Contagem = {
    etapasAplicadas: 0,
    qualificacoesAplicadas: 0,
    convertidos: 0,
    semContato: 0,
    recusas: 0,
  };
  for (let i = 0; i < lidos.length; i += TAMANHO_DO_LOTE) {
    await aplicarLote(lidos.slice(i, i + TAMANHO_DO_LOTE), {
      api,
      campo,
      nomesDasEtapasPd,
      etapas,
      qualificacoes,
      contagem,
    });
  }

  for (const [funilId, marca] of marcas) {
    await setSetting(`${CHAVE_DESDE}:${funilId}`, marca);
  }

  return {
    rodou: true,
    funis: funis.length,
    deals: lidos.length,
    ...contagem,
  };
}

async function aplicarLote(
  deals: DealDoPipedrive[],
  ctx: {
    api: PipedriveApi;
    campo: { key: string; opcoes: Map<number, string> } | null;
    nomesDasEtapasPd: Map<number, string>;
    etapas: LeadStageRow[];
    qualificacoes: LeadQualificationRow[];
    contagem: Contagem;
  }
): Promise<void> {
  const { api, campo, nomesDasEtapasPd, etapas, qualificacoes, contagem } =
    ctx;

  // Identidades do lote inteiro de uma vez: uma consulta por lote, não duas
  // por deal.
  const idsDePessoas = [
    ...new Set(
      deals.map((d) => d.personId).filter((id): id is number => id !== null)
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

  // Duas consultas por lote (e-mail e telefone) em vez de duas por deal.
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

  // Um objeto por contato, achado por e-mail ou por telefone: o estado em
  // memória que a passada atualiza (etapa, qualificação) precisa ser o mesmo
  // nos dois mapas, senão o segundo deal da pessoa veria o contato antigo.
  const porId = new Map(
    [...linhasPorEmail, ...linhasPorTelefone].map((c) => [c.id, c])
  );
  const porEmail = new Map(
    [...porId.values()].map((c) => [c.email.toLowerCase(), c])
  );
  const mapaTelefone = new Map(
    [...porId.values()]
      .filter((c) => c.phone)
      .map((c) => [c.phone as string, c])
  );

  for (const deal of deals) {
    if (deal.personId === null) continue;
    const pessoa = pessoas.get(deal.personId);
    if (!pessoa) continue;

    let contato =
      pessoa.emails
        .map((e) => porEmail.get(e.toLowerCase()))
        .find(Boolean) ?? null;
    if (!contato) {
      contato =
        (telefonesPorPessoa.get(deal.personId) ?? [])
          .map((forma) => mapaTelefone.get(forma))
          .find(Boolean) ?? null;
    }
    if (!contato) {
      contagem.semContato++;
      continue;
    }
    // Convertido no meio do lote (dois deals da mesma pessoa): não é mais lead.
    if (contato.stage === null) continue;

    // Qualificação: o rótulo exato da opção no Pipedrive, resolvido na
    // tabela — as mesmas formas que o webhook aceita.
    let qualificacao: string | null = null;
    if (campo) {
      const rotulo = rotuloDaOpcao(deal.qualificacaoCrua, campo.opcoes);
      if (rotulo) {
        qualificacao = casarQualificacao(qualificacoes, rotulo)?.slug ?? null;
        if (!qualificacao) contagem.recusas++;
      }
    }

    // Etapa: ganho → compra; perdido → "perdido" se cadastrada; aberto →
    // o nome da etapa do funil, resolvido pelo nome ou pelos apelidos.
    let etapa: LeadStageRow | null = null;
    if (deal.status === "won") {
      etapa = casarEtapa(etapas, ETAPA_DE_COMPRA);
      if (!etapa) contagem.recusas++;
    } else if (deal.status === "lost") {
      etapa = casarEtapa(etapas, ETAPA_DE_PERDA);
    } else if (deal.status === "open") {
      const nome = nomesDasEtapasPd.get(deal.stageId);
      if (nome) {
        etapa = casarEtapa(etapas, nome);
        if (!etapa) contagem.recusas++;
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
      contagem.qualificacoesAplicadas++;
      contato.qualification = qualificacao;
    }
    if (aplicado.mudouEtapa && etapa) {
      contagem.etapasAplicadas++;
      contato.stage = etapa.slug;
    }
    if (aplicado.convertidoPara) {
      contagem.convertidos++;
      contato.stage = null;
    }
    if (aplicado.conversaoRecusada) contagem.recusas++;
  }
}
