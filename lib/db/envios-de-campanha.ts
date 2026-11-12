import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { Destinatario } from "@/lib/contatos/destinatarios";

import { emLotes } from "./lotes";
import * as schema from "./schema";
import { campaignSends, type CampaignChannel } from "./schema";

/**
 * Endereços por INSERT. Cada um usa 4 valores (campanha, canal, contato,
 * endereço): 1.000 dão 4.000 valores, longe do limite de 65.535 do Postgres
 * (LIMITE_DE_VALORES_DO_POSTGRES). Num INSERT só, a campanha de 18 mil
 * e-mails de 12/11/2026 pedia 72 mil valores e foi recusada inteira — o teto
 * era 16.383 endereços.
 */
export const ENVIOS_POR_INSERT = 1_000;

/**
 * Cria um registro de envio por endereço da campanha, em lotes, numa
 * transação só. Devolve os envios na ordem dos destinos.
 *
 * A transação mantém o tudo-ou-nada que o INSERT único garantia: se um lote
 * falhar, nenhum fica gravado. Isso inclui o clique duplo — a segunda
 * requisição bate no índice único (campanha, contato, endereço), recebe o
 * 23505 e desfaz o que já tinha gravado, sem deixar metade da fila criada.
 */
export async function gravarEnviosDeCampanha(
  db: NodePgDatabase<typeof schema>,
  campaignId: string,
  channel: CampaignChannel,
  destinos: Destinatario[]
): Promise<{ id: string; contactId: string }[]> {
  return db.transaction(async (tx) => {
    const criados: { id: string; contactId: string }[] = [];
    for (const lote of emLotes(destinos, ENVIOS_POR_INSERT)) {
      const linhas = await tx
        .insert(campaignSends)
        .values(
          lote.map((destino) => ({
            campaignId,
            channel,
            contactId: destino.contactId,
            address: destino.address,
          }))
        )
        .returning({
          id: campaignSends.id,
          contactId: campaignSends.contactId,
        });
      criados.push(...linhas);
    }
    return criados;
  });
}
