import { contactEvents, getDb, type ContactEventType } from "@/lib/db";

// Registro do que acontece com um contato — a matéria-prima dos gatilhos das
// automações (docs/plano-automacoes.md).
//
// O problema que isto resolve: as tags são gravadas em bloco
// (`updates.tags = normalizeTags(body.tags)`), então o sistema conhece o
// ESTADO final, nunca a MUDANÇA. Um gatilho "quando a tag X for adicionada"
// depende da mudança — daí as funções de diferença abaixo.
//
// Nada aqui pode derrubar a operação que o originou: registrar evento é
// secundário em relação a salvar o contato. Por isso as falhas são engolidas
// com log, e não propagadas.

type Payload = Record<string, unknown>;

/** Um evento. Falha aqui não interrompe quem chamou. */
export async function emitContactEvent(
  type: ContactEventType,
  contactId: string,
  payload?: Payload
): Promise<void> {
  try {
    await getDb()
      .insert(contactEvents)
      .values({ contactId, type, payload: payload ?? null });
  } catch (error) {
    console.error(`[eventos] falhou ao registrar ${type}:`, error);
  }
}

/** Vários eventos de uma vez (importação, mudança de várias tags). */
export async function emitContactEvents(
  eventos: { type: ContactEventType; contactId: string; payload?: Payload }[]
): Promise<void> {
  if (eventos.length === 0) return;
  try {
    await getDb()
      .insert(contactEvents)
      .values(
        eventos.map((e) => ({
          contactId: e.contactId,
          type: e.type,
          payload: e.payload ?? null,
        }))
      );
  } catch (error) {
    console.error("[eventos] falhou ao registrar em lote:", error);
  }
}

/** O que entrou e o que saiu entre duas listas de valores. */
export function diff(
  antes: readonly string[] | null | undefined,
  depois: readonly string[] | null | undefined
): { adicionados: string[]; removidos: string[] } {
  const a = new Set(antes ?? []);
  const d = new Set(depois ?? []);
  return {
    adicionados: [...d].filter((v) => !a.has(v)),
    removidos: [...a].filter((v) => !d.has(v)),
  };
}

/** Eventos de tag a partir do antes/depois do array do contato. */
export async function emitTagDiff(
  contactId: string,
  antes: readonly string[] | null | undefined,
  depois: readonly string[] | null | undefined
): Promise<void> {
  const { adicionados, removidos } = diff(antes, depois);
  await emitContactEvents([
    ...adicionados.map((tag) => ({
      type: "tag_added" as const,
      contactId,
      payload: { tag },
    })),
    ...removidos.map((tag) => ({
      type: "tag_removed" as const,
      contactId,
      payload: { tag },
    })),
  ]);
}

/** Eventos de lista a partir do antes/depois das associações do contato. */
export async function emitListDiff(
  contactId: string,
  antes: readonly string[] | null | undefined,
  depois: readonly string[] | null | undefined
): Promise<void> {
  const { adicionados, removidos } = diff(antes, depois);
  await emitContactEvents([
    ...adicionados.map((listId) => ({
      type: "list_subscribed" as const,
      contactId,
      payload: { listId },
    })),
    ...removidos.map((listId) => ({
      type: "list_unsubscribed" as const,
      contactId,
      payload: { listId },
    })),
  ]);
}
