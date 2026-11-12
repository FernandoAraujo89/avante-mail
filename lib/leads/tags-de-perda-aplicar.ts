import { and, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";

import { contacts, getDb, type ContactEventType } from "@/lib/db";
import { diff, emitContactEvents } from "@/lib/events";
import { getSetting, setSetting } from "@/lib/settings";
import {
  mesmasTags,
  PREFIXO_DA_TAG_DE_PERDA,
  tagsComAPerda,
} from "./tags-de-perda";

/**
 * O interruptor das tags de motivo de perda e a marcação em massa
 * (lib/leads/tags-de-perda.ts tem a regra).
 *
 * DESLIGADO por padrão. O motor de automações reage a cada evento uma vez só,
 * contra as automações ativas NAQUELE momento: tag aplicada antes de a
 * automação de remarketing existir não dispararia nada depois. Então a ordem é
 * esta — a equipe cria e ativa as automações, e só então liga aqui; ao ligar,
 * todos os leads já perdidos recebem a tag de uma vez (e entram nelas), e daí
 * em diante a sincronização com o CRM mantém a tag de cada lead.
 *
 * Desligar só para de manter: as tags já aplicadas ficam, sem evento.
 */

/** Valor: quando foi ligado (ISO); ausente = desligado. */
export const CHAVE_TAGS_DE_PERDA = "leads_tags_motivo_perda";

export async function tagsDePerdaLigadasEm(): Promise<string | null> {
  return (await getSetting(CHAVE_TAGS_DE_PERDA)) || null;
}

export async function ligarTagsDePerda(agora = new Date()): Promise<void> {
  await setSetting(CHAVE_TAGS_DE_PERDA, agora.toISOString());
}

export async function desligarTagsDePerda(): Promise<void> {
  await setSetting(CHAVE_TAGS_DE_PERDA, null);
}

const LOTE_DE_EVENTOS = 1000;

/** Alguma tag do contato começa com o prefixo de perda. */
function temTagDePerda(): SQL {
  return sql`exists (select 1 from unnest(${contacts.tags}) as t where t like ${PREFIXO_DA_TAG_DE_PERDA + "%"})`;
}

/**
 * Acerta a tag de perda dos leads: com `ids`, só desses; sem, de TODOS os
 * leads que têm motivo ou que ainda carregam uma tag de perda. Grava só quem
 * muda e registra `tag_added`/`tag_removed` — é o que dispara as automações.
 * Não olha o interruptor: quem chama decide.
 */
export async function aplicarTagsDePerda(ids?: string[]): Promise<{ alterados: number }> {
  const db = getDb();
  if (ids && ids.length === 0) return { alterados: 0 };

  const leads = await db
    .select({ id: contacts.id, tags: contacts.tags, motivo: contacts.crmMotivoPerda })
    .from(contacts)
    .where(
      and(
        // Só lead: parceiro (stage nulo) não é tocado por aqui.
        isNotNull(contacts.stage),
        ids
          ? inArray(contacts.id, ids)
          : or(isNotNull(contacts.crmMotivoPerda), temTagDePerda())
      )
    );

  const eventos: { type: ContactEventType; contactId: string; payload: { tag: string } }[] = [];
  let alterados = 0;
  for (const lead of leads) {
    const novas = tagsComAPerda(lead.tags, lead.motivo);
    if (mesmasTags(lead.tags, novas)) continue;
    await db.update(contacts).set({ tags: novas }).where(eq(contacts.id, lead.id));
    alterados++;
    const { adicionados, removidos } = diff(lead.tags, novas);
    for (const tag of adicionados) eventos.push({ type: "tag_added", contactId: lead.id, payload: { tag } });
    for (const tag of removidos) eventos.push({ type: "tag_removed", contactId: lead.id, payload: { tag } });
  }

  for (let i = 0; i < eventos.length; i += LOTE_DE_EVENTOS) {
    await emitContactEvents(eventos.slice(i, i + LOTE_DE_EVENTOS));
  }
  return { alterados };
}
