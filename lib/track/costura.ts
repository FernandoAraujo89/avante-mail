import { asc, eq, inArray, lt, sql } from "drizzle-orm";

import {
  anonymousSiteEvents,
  contactEvents,
  contacts,
  getDb,
  type NewContact,
} from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { hostsPermitidos } from "@/lib/track/site";
import { primeiroToque, type PrimeiroToque } from "@/lib/track/primeiro-toque";

/**
 * A costura (fase E.2): o histórico anônimo de um visitante vira linha do
 * tempo do lead no momento em que a identidade aparece.
 *
 * É isto que responde "ele entrou no site ANTES do e-mail?" — a visita já
 * estava guardada, esperando dono. Dois caminhos chamam aqui, e SÓ eles:
 *
 *   1. /api/track/site, quando um lote chega com token VÁLIDO e visitante —
 *      o clique no e-mail identificou o navegador;
 *   2. o webhook de entrada, quando o payload do formulário traz `visitorId`
 *      — o lead se identificou preenchendo o formulário do site.
 *
 * Nunca por rota pública sem autenticação: o visitante é opaco e sem
 * assinatura, e um endpoint que aceitasse "este visitante é o contato X" sem
 * prova deixaria qualquer um enxertar histórico na ficha de qualquer um.
 */

/** Contadores da tela de diagnóstico (app_settings). */
export const CHAVE_COSTURAS = "rastreio_costuras";
export const CHAVE_EVENTOS_COSTURADOS = "rastreio_eventos_costurados";
const CHAVE_LIMPEZA = "rastreio_limpeza_anonimos";

/** Teto por costura: acima disso é lixo de coleta, não uma jornada. */
const MAX_EVENTOS_POR_COSTURA = 500;

/** Retenção do anônimo: quem nunca virou lead expira. */
export const RETENCAO_DIAS = 90;

/** Os campos de origem que o primeiro toque pode preencher. */
export type OrigemPreenchida = Partial<
  Pick<
    NewContact,
    | "sourceChannel"
    | "utmSource"
    | "utmMedium"
    | "utmCampaign"
    | "utmContent"
    | "utmTerm"
    | "referrer"
    | "landingPage"
  >
>;

export interface ResultadoDaCostura {
  /** Quantos eventos anônimos viraram linha do tempo. */
  eventos: number;
  /** A primeira visita com pista, quando alguma disse de onde veio. */
  primeiroToque: PrimeiroToque | null;
  /** O que estava vazio na ficha e foi preenchido a partir dela. */
  preenchido: OrigemPreenchida | null;
}

const NADA: ResultadoDaCostura = { eventos: 0, primeiroToque: null, preenchido: null };

export async function costurarVisitante(
  visitorId: string,
  contactId: string
): Promise<ResultadoDaCostura> {
  const db = getDb();

  const eventos = await db
    .select()
    .from(anonymousSiteEvents)
    .where(eq(anonymousSiteEvents.visitorId, visitorId))
    .orderBy(asc(anonymousSiteEvents.createdAt))
    .limit(MAX_EVENTOS_POR_COSTURA);

  if (eventos.length === 0) return NADA;

  // O `createdAt` ORIGINAL vai junto — a visita de três semanas atrás precisa
  // decair como uma visita de três semanas atrás, senão a costura fabricaria
  // um pico de engajamento de hoje. `processedAt` preenchido pela mesma razão
  // da rota de coleta: evento de site não é gatilho de automação, e pendente
  // ele disputaria o orçamento do motor com gatilho de verdade.
  await db
    .insert(contactEvents)
    .values(
      eventos.map((e) => ({
        contactId,
        type: e.type,
        payload: e.payload,
        createdAt: e.createdAt,
        processedAt: e.createdAt,
      }))
    )
    .onConflictDoNothing();

  await db.delete(anonymousSiteEvents).where(
    inArray(
      anonymousSiteEvents.id,
      eventos.map((e) => e.id)
    )
  );

  // Os eventos costurados são mais antigos que o último cálculo do score, e o
  // recálculo barato só olha evento NOVO. Zerar a marca é o que faz o worker
  // repontuar este lead no próximo ciclo, com a história completa.
  await db
    .update(contacts)
    .set({ leadScoreAt: null })
    .where(eq(contacts.id, contactId));

  // Contadores para a tela de rastreio — a costura apaga a origem, então sem
  // eles "quantos visitantes viraram lead" não teria resposta.
  await incrementar(CHAVE_COSTURAS, 1);
  await incrementar(CHAVE_EVENTOS_COSTURADOS, eventos.length);

  // O PRIMEIRO TOQUE (fase 1.5): a jornada acabou de ganhar dono, e a ficha
  // pode estar sem origem — o formulário não trouxe UTM, ou a pessoa se
  // identificou por um clique de e-mail. A visita mais antiga com pista
  // responde de onde ela veio. Só preenche o que está vazio: origem gravada
  // na entrada não é sobrescrita (§3 do plano, "primeiro toque").
  const toque = primeiroToque(eventos, hostsPermitidos());
  const preenchido = toque ? await preencherOrigem(contactId, toque) : null;

  return { eventos: eventos.length, primeiroToque: toque, preenchido };
}

async function preencherOrigem(
  contactId: string,
  toque: PrimeiroToque
): Promise<OrigemPreenchida | null> {
  const db = getDb();
  const [contato] = await db
    .select({
      sourceChannel: contacts.sourceChannel,
      utmSource: contacts.utmSource,
      utmMedium: contacts.utmMedium,
      utmCampaign: contacts.utmCampaign,
      utmContent: contacts.utmContent,
      utmTerm: contacts.utmTerm,
      referrer: contacts.referrer,
      landingPage: contacts.landingPage,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId));
  if (!contato) return null;

  // O canal é a rede normalizada; sem rede reconhecida, o utm_source cru —
  // a mesma regra do webhook (`sourceChannel ?? utmSource`). Referrer de
  // fora sem rede conhecida (um linktr.ee sem UTM) fica só no referrer.
  const canal = toque.fonte ?? toque.utm?.source ?? null;
  const patch: OrigemPreenchida = {};
  if (!contato.sourceChannel && canal) patch.sourceChannel = canal;
  if (!contato.utmSource && toque.utm?.source) patch.utmSource = toque.utm.source;
  if (!contato.utmMedium && toque.utm?.medium) patch.utmMedium = toque.utm.medium;
  if (!contato.utmCampaign && toque.utm?.campaign) {
    patch.utmCampaign = toque.utm.campaign;
  }
  if (!contato.utmContent && toque.utm?.content) patch.utmContent = toque.utm.content;
  if (!contato.utmTerm && toque.utm?.term) patch.utmTerm = toque.utm.term;
  if (!contato.referrer && toque.refHost) patch.referrer = toque.refHost;
  // Da visita só existe o caminho; a ficha mostra "/produtos" no lugar da
  // URL completa que o formulário mandaria. Legível, e sem inventar host.
  if (!contato.landingPage && toque.path) patch.landingPage = toque.path;

  if (Object.keys(patch).length === 0) return null;
  await db.update(contacts).set(patch).where(eq(contacts.id, contactId));
  return patch;
}

async function incrementar(chave: string, quanto: number): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    INSERT INTO app_settings (key, value) VALUES (${chave}, ${String(quanto)})
    ON CONFLICT (key) DO UPDATE
      SET value = ((COALESCE(NULLIF(app_settings.value, ''), '0'))::int + ${quanto})::text
  `);
}

export async function lerContadoresDaCostura(): Promise<{
  costuras: number;
  eventosCosturados: number;
}> {
  const [costuras, eventos] = await Promise.all([
    getSetting(CHAVE_COSTURAS),
    getSetting(CHAVE_EVENTOS_COSTURADOS),
  ]);
  return {
    costuras: Number(costuras) || 0,
    eventosCosturados: Number(eventos) || 0,
  };
}

/**
 * Apaga o anônimo que passou da retenção. Regula a si mesma (roda no máximo
 * uma vez por dia), como a passagem diária do score — o worker chama a cada
 * ciclo e ela decide.
 */
export async function limparVisitantesAntigos(
  agora = new Date()
): Promise<{ rodou: boolean; apagados: number }> {
  const ultima = await getSetting(CHAVE_LIMPEZA);
  if (ultima) {
    const horas = (agora.getTime() - new Date(ultima).getTime()) / 3_600_000;
    if (Number.isFinite(horas) && horas < 20) {
      return { rodou: false, apagados: 0 };
    }
  }

  const db = getDb();
  const corte = new Date(agora.getTime() - RETENCAO_DIAS * 86_400_000);
  const apagados = await db
    .delete(anonymousSiteEvents)
    .where(lt(anonymousSiteEvents.createdAt, corte))
    .returning({ id: anonymousSiteEvents.id });

  await setSetting(CHAVE_LIMPEZA, agora.toISOString());
  return { rodou: true, apagados: apagados.length };
}
