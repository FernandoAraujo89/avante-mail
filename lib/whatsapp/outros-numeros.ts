import { eq, inArray, sql } from "drizzle-orm";

import { getDb, whatsappOutrosNumeros } from "@/lib/db";
import { errorMessage } from "@/lib/utils";

import { fetchPhoneNumberInfo } from "./client";
import { rotuloDoOutroNumero, type OutroNumero } from "./outros-numeros-rotulo";

// Os números de outros sistemas (NRG Hub, equipes) que mandam eventos para o
// webhook porque a conta deles está inscrita no mesmo app da Meta. As conversas
// ficam em "outros números" (lib/whatsapp/linhas.ts); aqui, como mostrá-los.

export { rotuloDoOutroNumero, type OutroNumero };

/** Números já registrados por este processo: o webhook não volta ao banco a cada mensagem. */
const registrados = new Set<string>();

/**
 * Guarda o número que recebeu o evento, com o número de exibição que a Meta
 * manda no webhook e — uma tentativa por processo — o nome verificado, se o
 * token do Campanhas alcança a conta dele. Não lança: é só para a tela.
 */
export async function registrarOutroNumero(
  phoneNumberId: string,
  displayPhoneNumber: string | null | undefined
): Promise<void> {
  if (registrados.has(phoneNumberId)) return;
  const display = displayPhoneNumber?.replace(/\D/g, "") || null;
  try {
    const db = getDb();
    const [linha] = await db
      .insert(whatsappOutrosNumeros)
      .values({ phoneNumberId, displayPhoneNumber: display })
      .onConflictDoUpdate({
        target: whatsappOutrosNumeros.phoneNumberId,
        set: {
          displayPhoneNumber: sql`coalesce(excluded.display_phone_number, ${whatsappOutrosNumeros.displayPhoneNumber})`,
        },
      })
      .returning({ verifiedName: whatsappOutrosNumeros.verifiedName });

    if (!linha?.verifiedName && process.env.WHATSAPP_ACCESS_TOKEN) {
      try {
        const info = await fetchPhoneNumberInfo(phoneNumberId);
        if (info.verifiedName || info.displayPhoneNumber) {
          await db
            .update(whatsappOutrosNumeros)
            .set({
              verifiedName: info.verifiedName,
              ...(info.displayPhoneNumber
                ? { displayPhoneNumber: info.displayPhoneNumber.replace(/\D/g, "") }
                : {}),
            })
            .where(eq(whatsappOutrosNumeros.phoneNumberId, phoneNumberId));
        }
      } catch (error) {
        // Token sem acesso à conta desse número: fica só o número.
        console.warn(
          `[WHATSAPP] Nome do número ${phoneNumberId} indisponível:`,
          errorMessage(error)
        );
      }
    }
    registrados.add(phoneNumberId);
  } catch (error) {
    console.error(
      `[WHATSAPP] Falha ao registrar o número ${phoneNumberId}:`,
      errorMessage(error)
    );
  }
}

/**
 * Os números de fora pedidos, pelo phone_number_id. Só serve ao rótulo: se a
 * leitura falhar, a caixa de conversas abre do mesmo jeito, com o id no lugar
 * do nome.
 */
export async function outrosNumerosPorId(
  ids: string[]
): Promise<Map<string, OutroNumero>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  let rows: (typeof whatsappOutrosNumeros.$inferSelect)[];
  try {
    rows = await getDb()
      .select()
      .from(whatsappOutrosNumeros)
      .where(inArray(whatsappOutrosNumeros.phoneNumberId, unicos));
  } catch (error) {
    console.error("[WHATSAPP] Falha ao ler os outros números:", errorMessage(error));
    return new Map();
  }
  return new Map(
    rows.map((r) => [
      r.phoneNumberId,
      {
        phoneNumberId: r.phoneNumberId,
        displayPhoneNumber: r.displayPhoneNumber,
        verifiedName: r.verifiedName,
      },
    ])
  );
}
