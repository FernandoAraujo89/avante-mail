// Para onde a campanha vai: um envio por ENDEREÇO que aceita o canal, não
// por contato (decisão de 06/10/2026 — quem tem dois telefones recebe nos
// dois). As condições de público (lista, tag, escolha manual, "não é lead")
// continuam sendo do contato; o que muda é a expansão final em endereços.
import { and, asc, count, desc, eq, inArray, type SQL } from "drizzle-orm";

import {
  contactEmails,
  contactPhones,
  contacts,
  getDb,
  type CampaignChannel,
} from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface Destinatario {
  contactId: string;
  /** O e-mail ou telefone (E.164) exato deste envio. */
  address: string;
}

function tabela(canal: CampaignChannel) {
  return canal === "email"
    ? {
        t: contactEmails,
        contactId: contactEmails.contactId,
        address: contactEmails.email,
        aceita: eq(contactEmails.subscribed, true),
        principal: contactEmails.principal,
        createdAt: contactEmails.createdAt,
      }
    : {
        t: contactPhones,
        contactId: contactPhones.contactId,
        address: contactPhones.phone,
        aceita:
          canal === "whatsapp"
            ? eq(contactPhones.whatsappSubscribed, true)
            : eq(contactPhones.smsSubscribed, true),
        principal: contactPhones.principal,
        createdAt: contactPhones.createdAt,
      };
}

/**
 * Todos os endereços que aceitam o canal, dos contatos que passam nas
 * condições. Um contato com dois telefones aparece duas vezes.
 */
export async function enderecosElegiveis(
  db: Db,
  canal: CampaignChannel,
  condicoesDoContato: SQL[]
): Promise<Destinatario[]> {
  const c = tabela(canal);
  const rows = await db
    .select({ contactId: c.contactId, address: c.address })
    .from(c.t)
    .innerJoin(contacts, eq(contacts.id, c.contactId))
    .where(and(c.aceita, ...condicoesDoContato))
    .orderBy(asc(c.contactId), desc(c.principal), asc(c.createdAt));
  return rows;
}

/** Quantas mensagens a campanha mandaria (é o que custa e o que conta no limite). */
export async function contarEnderecosElegiveis(
  db: Db,
  canal: CampaignChannel,
  condicoesDoContato: SQL[]
): Promise<number> {
  const c = tabela(canal);
  const [row] = await db
    .select({ total: count() })
    .from(c.t)
    .innerJoin(contacts, eq(contacts.id, c.contactId))
    .where(and(c.aceita, ...condicoesDoContato));
  return row.total;
}

/**
 * O endereço de UM envio por contato (passo de automação): o principal, se
 * aceita o canal; senão o primeiro que aceita; senão nenhum.
 */
export async function enderecoParaEnvioUnico(
  db: Db,
  canal: CampaignChannel,
  contactId: string
): Promise<string | null> {
  const c = tabela(canal);
  const [row] = await db
    .select({ address: c.address })
    .from(c.t)
    .where(and(eq(c.contactId, contactId), c.aceita))
    .orderBy(desc(c.principal), asc(c.createdAt))
    .limit(1);
  return row?.address ?? null;
}

/**
 * O endereço ainda aceita o canal? Conferido pelo worker na hora de mandar:
 * a campanha pode ter sido agendada semanas antes, e o consentimento vale o
 * do momento do envio. Endereço que sumiu do cadastro também não recebe.
 */
export async function enderecoAceita(
  db: Db,
  canal: CampaignChannel,
  address: string
): Promise<boolean> {
  const c = tabela(canal);
  const [row] = await db
    .select({ um: c.contactId })
    .from(c.t)
    .where(and(eq(c.address, address), c.aceita))
    .limit(1);
  return Boolean(row);
}

/** Quais destes endereços ainda aceitam o canal (reenvio em lote). */
export async function enderecosQueAceitam(
  db: Db,
  canal: CampaignChannel,
  addresses: string[]
): Promise<Set<string>> {
  if (addresses.length === 0) return new Set();
  const c = tabela(canal);
  const rows = await db
    .select({ address: c.address })
    .from(c.t)
    .where(and(inArray(c.address, addresses), c.aceita));
  return new Set(rows.map((r) => r.address));
}
