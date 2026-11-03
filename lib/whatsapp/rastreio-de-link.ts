/**
 * Rastreio de clique no botão de LINK do WhatsApp.
 *
 * A Meta avisa o toque em botão de resposta rápida, mas não em botão de link.
 * Para contar o clique, o botão marcado como rastreado (`tracked: true` em
 * lib/whatsapp/types.ts) vai à Meta com o link da plataforma e o fim variável
 * (`…/api/track/l/{{1}}`); cada envio preenche o fim com o próprio id, e a
 * rota app/api/track/l/[codigo] marca o clique no envio e redireciona ao
 * destino de verdade, que fica guardado no `url` do botão do modelo.
 *
 * Opcional por botão: modelo sem botão rastreado continua exatamente como
 * antes. O envio de teste (sem linha em campaign_sends) leva um código de
 * teste, que só redireciona, sem contar.
 */
import { eq } from "drizzle-orm";

import { modeloDoPassoDeWhatsApp } from "@/lib/automations/envios";
import {
  campaigns,
  campaignSends,
  getDb,
  surveyInvites,
  surveys,
  whatsappTemplates,
  type SendStatus,
} from "@/lib/db";
import { emitContactEvent } from "@/lib/events";

import { trackedUrlButtonIndex, type WhatsAppButton } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXO_TESTE = "t-";

// ─── Puro ────────────────────────────────────────────────────────────────

/** O fim do link de um envio: o id dele (é o que a rota lê de volta). */
export function codigoDoEnvio(sendId: string): string {
  return sendId;
}

/** O fim do link de um envio de TESTE: aponta o modelo, para achar o destino sem contar nada. */
export function codigoDeTeste(templateId: string): string {
  return `${PREFIXO_TESTE}${templateId}`;
}

export type CodigoDoLink =
  | { tipo: "envio"; sendId: string }
  | { tipo: "teste"; templateId: string }
  | null;

export function lerCodigo(codigo: string): CodigoDoLink {
  const c = codigo.trim();
  if (UUID.test(c)) return { tipo: "envio", sendId: c.toLowerCase() };
  if (c.startsWith(PREFIXO_TESTE)) {
    const id = c.slice(PREFIXO_TESTE.length);
    if (UUID.test(id)) return { tipo: "teste", templateId: id.toLowerCase() };
  }
  return null;
}

/** O destino do botão rastreado do modelo (só http/https), ou null se não há. */
export function destinoDoBotaoRastreado(buttons: WhatsAppButton[] | null): string | null {
  const i = trackedUrlButtonIndex(buttons);
  const b = i === null ? null : (buttons?.[i] ?? null);
  if (!b || b.type !== "URL") return null;
  const url = b.url.trim();
  return /^https?:\/\//.test(url) ? url : null;
}

export interface EstadoDoEnvio {
  status: SendStatus;
  deliveredAt: Date | null;
  readAt: Date | null;
  clickedAt: Date | null;
}

export interface PatchDoClique {
  clickedAt: Date;
  status?: SendStatus;
  deliveredAt?: Date;
  readAt?: Date;
}

/**
 * O que muda no envio com o clique. O primeiro clique fica (reabrir o link não
 * é fato novo). O clique prova entrega e leitura, então preenche o que a Meta
 * ainda não confirmou — quem desliga o "visto" aparece só como entregue, e
 * clicou. Falha e devolução são terminais: só o clique é anotado.
 */
export function patchDoClique(atual: EstadoDoEnvio, agora: Date): PatchDoClique {
  const patch: PatchDoClique = { clickedAt: atual.clickedAt ?? agora };
  if (atual.status === "failed" || atual.status === "bounced") return patch;
  if (!atual.deliveredAt) patch.deliveredAt = agora;
  if (!atual.readAt) patch.readAt = agora;
  if (atual.status === "pending" || atual.status === "sent" || atual.status === "delivered") {
    patch.status = "read";
  }
  return patch;
}

// ─── Banco ───────────────────────────────────────────────────────────────

/** Os botões do modelo de um envio: da campanha, do convite de pesquisa ou do passo da automação. */
async function botoesDoModeloDoEnvio(send: {
  campaignId: string | null;
  surveyInviteId: string | null;
  automationStepId: string | null;
}): Promise<WhatsAppButton[] | null> {
  const db = getDb();
  let templateId: string | null = null;
  if (send.campaignId) {
    const [c] = await db
      .select({ id: campaigns.whatsappTemplateId })
      .from(campaigns)
      .where(eq(campaigns.id, send.campaignId));
    templateId = c?.id ?? null;
  } else if (send.surveyInviteId) {
    const [s] = await db
      .select({ id: surveys.whatsappTemplateId })
      .from(surveyInvites)
      .innerJoin(surveys, eq(surveys.id, surveyInvites.surveyId))
      .where(eq(surveyInvites.id, send.surveyInviteId));
    templateId = s?.id ?? null;
  } else if (send.automationStepId) {
    try {
      return (await modeloDoPassoDeWhatsApp(send.automationStepId)).template.buttons;
    } catch {
      return null; // passo apagado: não há mais destino
    }
  }
  if (!templateId) return null;
  const [t] = await db
    .select({ buttons: whatsappTemplates.buttons })
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.id, templateId));
  return t?.buttons ?? null;
}

export interface CliqueResolvido {
  destino: string;
  /** Quem clicou (null no envio de teste). */
  contactId: string | null;
}

/**
 * Resolve o código do link: o destino para redirecionar e, quando é um envio
 * de verdade, a marcação do clique. Null quando o código não leva a nada —
 * quem chama manda a pessoa para a página inicial.
 */
export async function resolverCliqueDeLink(codigo: string): Promise<CliqueResolvido | null> {
  const lido = lerCodigo(codigo);
  if (!lido) return null;
  const db = getDb();

  if (lido.tipo === "teste") {
    const [t] = await db
      .select({ buttons: whatsappTemplates.buttons })
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.id, lido.templateId));
    const destino = destinoDoBotaoRastreado(t?.buttons ?? null);
    return destino ? { destino, contactId: null } : null;
  }

  const [send] = await db.select().from(campaignSends).where(eq(campaignSends.id, lido.sendId));
  if (!send) return null;
  const destino = destinoDoBotaoRastreado(await botoesDoModeloDoEnvio(send));
  if (!destino) return null;

  // Em try próprio: o redirecionamento acontece mesmo se a marcação falhar.
  try {
    await db
      .update(campaignSends)
      .set(patchDoClique(send, new Date()))
      .where(eq(campaignSends.id, send.id));
    if (!send.clickedAt) {
      await emitContactEvent("whatsapp_clicked", send.contactId, {
        campaignId: send.campaignId,
        sendId: send.id,
      });
    }
  } catch (error) {
    console.error("[track/l] marcação do clique:", error);
  }
  return { destino, contactId: send.contactId };
}
