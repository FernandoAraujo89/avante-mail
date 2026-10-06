// Os endereços de um contato — vários e-mails e vários telefones, cada um
// com o próprio consentimento — e o RESUMO deles nas colunas de `contacts`
// (ver o comentário da tabela em lib/db/schema.ts).
//
// Este é o ÚNICO lugar que escreve em contact_emails, contact_phones e nas
// colunas de endereço/consentimento de `contacts`. A regra é simples: toda
// mudança termina em `sincronizarResumo`, e é isso que mantém as telas, os
// filtros e as condições de automação — que leem o resumo — dizendo a verdade.
import { asc, desc, eq, inArray, sql } from "drizzle-orm";

import {
  contactEmails,
  contactPhones,
  contacts,
  getDb,
  type ContactEmail,
  type ContactPhone,
} from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { parseBrazilianMobile } from "@/lib/sms/phone";
import { normalizeEmail } from "@/lib/utils";
import { phoneCandidatesFromWaId } from "@/lib/whatsapp/inbound";

/** Conexão ou transação: as funções servem às duas. */
export type Db =
  | ReturnType<typeof getDb>
  | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export interface EmailEntrada {
  email: string;
  /** Ausente = mantém o que está (endereço existente) ou aceita (novo). */
  subscribed?: boolean;
}

export interface TelefoneEntrada {
  phone: string;
  /** Ausente = mantém o que está (telefone existente) ou aceita (novo). */
  whatsapp?: boolean;
  /** Idem. Só vale em celular: fixo não recebe SMS, seja qual for a escolha. */
  sms?: boolean;
}

export interface Enderecos {
  emails: ContactEmail[];
  phones: ContactPhone[];
}

/** O que o resumo diz sobre os canais — para quem precisa saber se mudou. */
export interface ResumoDosCanais {
  subscribed: boolean;
  whatsappSubscribed: boolean;
  smsSubscribed: boolean;
}

/** Um e-mail ou telefone que já pertence a OUTRO contato. */
export class EnderecoDeOutroContato extends Error {
  constructor(
    public readonly tipo: "email" | "telefone",
    public readonly valor: string
  ) {
    super(
      tipo === "email"
        ? "Já existe um contato com este e-mail."
        : "Já existe um contato com este telefone."
    );
  }
}

// ─── Leitura ───────────────────────────────────────────────────────────────

/** Principal primeiro, depois na ordem em que entraram. */
export async function listarEnderecos(
  db: Db,
  contactId: string
): Promise<Enderecos> {
  const [emails, phones] = await Promise.all([
    db
      .select()
      .from(contactEmails)
      .where(eq(contactEmails.contactId, contactId))
      .orderBy(desc(contactEmails.principal), asc(contactEmails.createdAt)),
    db
      .select()
      .from(contactPhones)
      .where(eq(contactPhones.contactId, contactId))
      .orderBy(desc(contactPhones.principal), asc(contactPhones.createdAt)),
  ]);
  return { emails, phones };
}

/** Os endereços de vários contatos de uma vez (listas e relatórios). */
export async function listarEnderecosDeVarios(
  db: Db,
  contactIds: string[]
): Promise<Map<string, Enderecos>> {
  const porContato = new Map<string, Enderecos>();
  if (contactIds.length === 0) return porContato;
  const [emails, phones] = await Promise.all([
    db
      .select()
      .from(contactEmails)
      .where(inArray(contactEmails.contactId, contactIds))
      .orderBy(desc(contactEmails.principal), asc(contactEmails.createdAt)),
    db
      .select()
      .from(contactPhones)
      .where(inArray(contactPhones.contactId, contactIds))
      .orderBy(desc(contactPhones.principal), asc(contactPhones.createdAt)),
  ]);
  const de = (id: string) => {
    let e = porContato.get(id);
    if (!e) {
      e = { emails: [], phones: [] };
      porContato.set(id, e);
    }
    return e;
  };
  for (const e of emails) de(e.contactId).emails.push(e);
  for (const p of phones) de(p.contactId).phones.push(p);
  return porContato;
}

export async function contatoPorEmail(
  db: Db,
  email: string
): Promise<ContactEmail | null> {
  const normalizado = normalizeEmail(email);
  if (!normalizado) return null;
  const [row] = await db
    .select()
    .from(contactEmails)
    .where(eq(contactEmails.email, normalizado));
  return row ?? null;
}

export async function contatoPorTelefone(
  db: Db,
  phone: string
): Promise<ContactPhone | null> {
  const normalizado = normalizePhone(phone);
  if (!normalizado) return null;
  const [row] = await db
    .select()
    .from(contactPhones)
    .where(eq(contactPhones.phone, normalizado));
  return row ?? null;
}

/**
 * O telefone cadastrado de quem escreveu no WhatsApp, nas duas formas do
 * celular brasileiro (com e sem o nono dígito). A forma exata vem primeiro.
 */
export async function contatoPorWaId(
  db: Db,
  waId: string
): Promise<ContactPhone | null> {
  const candidatos = phoneCandidatesFromWaId(waId);
  if (candidatos.length === 0) return null;
  const rows = await db
    .select()
    .from(contactPhones)
    .where(inArray(contactPhones.phone, candidatos));
  for (const phone of candidatos) {
    const hit = rows.find((r) => r.phone === phone);
    if (hit) return hit;
  }
  return null;
}

/**
 * A que contato cada e-mail/telefone pertence — em lote, para importação e
 * sincronização. Entradas já normalizadas; as que não existem ficam de fora.
 */
export async function contatosPorEnderecos(
  db: Db,
  args: { emails?: string[]; phones?: string[] }
): Promise<{
  porEmail: Map<string, string>;
  porTelefone: Map<string, string>;
}> {
  const porEmail = new Map<string, string>();
  const porTelefone = new Map<string, string>();
  const emails = [...new Set(args.emails ?? [])];
  const phones = [...new Set(args.phones ?? [])];
  const LOTE = 500;
  for (let i = 0; i < emails.length; i += LOTE) {
    const rows = await db
      .select({
        email: contactEmails.email,
        contactId: contactEmails.contactId,
      })
      .from(contactEmails)
      .where(inArray(contactEmails.email, emails.slice(i, i + LOTE)));
    for (const r of rows) porEmail.set(r.email, r.contactId);
  }
  for (let i = 0; i < phones.length; i += LOTE) {
    const rows = await db
      .select({
        phone: contactPhones.phone,
        contactId: contactPhones.contactId,
      })
      .from(contactPhones)
      .where(inArray(contactPhones.phone, phones.slice(i, i + LOTE)));
    for (const r of rows) porTelefone.set(r.phone, r.contactId);
  }
  return { porEmail, porTelefone };
}

// ─── Escrita ───────────────────────────────────────────────────────────────

function primeiroPrincipal<T extends { principal: boolean }>(
  rows: T[]
): boolean {
  return !rows.some((r) => r.principal);
}

/**
 * Acrescenta endereços a um contato sem mexer nos que ele já tem: é o caminho
 * da importação, do webhook de leads e de quem "só completa". Endereço que
 * pertence a outro contato NÃO é movido — volta na resposta para quem chamou
 * decidir (fundir contatos é decisão de gente, não de script).
 */
export async function adicionarEnderecos(
  db: Db,
  contactId: string,
  entrada: { emails?: EmailEntrada[]; phones?: TelefoneEntrada[] }
): Promise<{
  emailsAdicionados: string[];
  telefonesAdicionados: string[];
  emailsDeOutro: string[];
  telefonesDeOutro: string[];
}> {
  const resultado = {
    emailsAdicionados: [] as string[],
    telefonesAdicionados: [] as string[],
    emailsDeOutro: [] as string[],
    telefonesDeOutro: [] as string[],
  };

  const emails = dedupePor(
    (entrada.emails ?? []).flatMap((e) => {
      const email = normalizeEmail(e.email);
      return email ? [{ ...e, email }] : [];
    }),
    (e) => e.email
  );
  const phones = dedupePor(
    (entrada.phones ?? []).flatMap((p) => {
      const phone = normalizePhone(p.phone);
      return phone ? [{ ...p, phone }] : [];
    }),
    (p) => p.phone
  );
  if (emails.length === 0 && phones.length === 0) return resultado;

  const atuais = await listarEnderecos(db, contactId);
  const donos = await contatosPorEnderecos(db, {
    emails: emails.map((e) => e.email),
    phones: phones.map((p) => p.phone),
  });

  let emailPrincipalLivre = primeiroPrincipal(atuais.emails);
  for (const e of emails) {
    const dono = donos.porEmail.get(e.email);
    if (dono === contactId) continue;
    if (dono) {
      resultado.emailsDeOutro.push(e.email);
      continue;
    }
    await db.insert(contactEmails).values({
      contactId,
      email: e.email,
      subscribed: e.subscribed !== false,
      optOutAt: e.subscribed === false ? new Date() : null,
      principal: emailPrincipalLivre,
    });
    emailPrincipalLivre = false;
    resultado.emailsAdicionados.push(e.email);
  }

  let telefonePrincipalLivre = primeiroPrincipal(atuais.phones);
  for (const p of phones) {
    const dono = donos.porTelefone.get(p.phone);
    if (dono === contactId) continue;
    if (dono) {
      resultado.telefonesDeOutro.push(p.phone);
      continue;
    }
    await db.insert(contactPhones).values({
      contactId,
      phone: p.phone,
      ...consentimentoDeTelefoneNovo(p),
      principal: telefonePrincipalLivre,
    });
    telefonePrincipalLivre = false;
    resultado.telefonesAdicionados.push(p.phone);
  }

  if (
    resultado.emailsAdicionados.length > 0 ||
    resultado.telefonesAdicionados.length > 0
  ) {
    await sincronizarResumo(db, contactId);
  }
  return resultado;
}

/**
 * Define o conjunto COMPLETO de endereços do contato (a tela de edição): o
 * que não está na lista sai, o que é novo entra, o que já existia tem o
 * consentimento ajustado. O primeiro de cada lista é o principal. Devolve o
 * resumo de antes e de depois, para quem chamou registrar os eventos de
 * saída de canal.
 */
export async function definirEnderecos(
  db: Db,
  contactId: string,
  entrada: { emails?: EmailEntrada[]; phones?: TelefoneEntrada[] }
): Promise<{ antes: ResumoDosCanais; depois: ResumoDosCanais }> {
  const atuais = await listarEnderecos(db, contactId);
  const antes = canaisDe(atuais);
  const agora = new Date();

  if (entrada.emails) {
    const desejados = dedupePor(
      entrada.emails.flatMap((e) => {
        const email = normalizeEmail(e.email);
        return email ? [{ ...e, email }] : [];
      }),
      (e) => e.email
    );
    const donos = await contatosPorEnderecos(db, {
      emails: desejados.map((e) => e.email),
    });
    for (const e of desejados) {
      const dono = donos.porEmail.get(e.email);
      if (dono && dono !== contactId) {
        throw new EnderecoDeOutroContato("email", e.email);
      }
    }
    const manter = new Set(desejados.map((e) => e.email));
    const sobrando = atuais.emails.filter((a) => !manter.has(a.email));
    if (sobrando.length > 0) {
      await db.delete(contactEmails).where(
        inArray(
          contactEmails.id,
          sobrando.map((a) => a.id)
        )
      );
    }
    // Duas passadas: primeiro quem DEIXA de ser principal, depois o resto —
    // o índice parcial não aceita dois principais ao mesmo tempo.
    for (const passada of ["solta", "aplica"] as const) {
      for (const [indice, e] of desejados.entries()) {
        const existente = atuais.emails.find((a) => a.email === e.email);
        const principal = indice === 0;
        if (existente) {
          const patch = patchDeEmailExistente(existente, e, principal, agora);
          if (Object.keys(patch).length === 0) continue;
          if ((passada === "solta") !== (patch.principal === false)) continue;
          await db
            .update(contactEmails)
            .set(patch)
            .where(eq(contactEmails.id, existente.id));
        } else if (passada === "aplica") {
          await db.insert(contactEmails).values({
            contactId,
            email: e.email,
            subscribed: e.subscribed !== false,
            optOutAt: e.subscribed === false ? agora : null,
            principal,
          });
        }
      }
    }
  }

  if (entrada.phones) {
    const desejados = dedupePor(
      entrada.phones.flatMap((p) => {
        const phone = normalizePhone(p.phone);
        return phone ? [{ ...p, phone }] : [];
      }),
      (p) => p.phone
    );
    const donos = await contatosPorEnderecos(db, {
      phones: desejados.map((p) => p.phone),
    });
    for (const p of desejados) {
      const dono = donos.porTelefone.get(p.phone);
      if (dono && dono !== contactId) {
        throw new EnderecoDeOutroContato("telefone", p.phone);
      }
    }
    const manter = new Set(desejados.map((p) => p.phone));
    const sobrando = atuais.phones.filter((a) => !manter.has(a.phone));
    if (sobrando.length > 0) {
      await db.delete(contactPhones).where(
        inArray(
          contactPhones.id,
          sobrando.map((a) => a.id)
        )
      );
    }
    // Mesmas duas passadas dos e-mails.
    for (const passada of ["solta", "aplica"] as const) {
      for (const [indice, p] of desejados.entries()) {
        const existente = atuais.phones.find((a) => a.phone === p.phone);
        const principal = indice === 0;
        if (existente) {
          const patch = patchDeTelefoneExistente(
            existente,
            p,
            principal,
            agora
          );
          const solta = patch.principal === false;
          if (Object.keys(patch).length === 0) continue;
          if ((passada === "solta") !== solta) continue;
          await db
            .update(contactPhones)
            .set(patch)
            .where(eq(contactPhones.id, existente.id));
        } else if (passada === "aplica") {
          await db.insert(contactPhones).values({
            contactId,
            phone: p.phone,
            ...consentimentoDeTelefoneNovo(p, agora),
            principal,
          });
        }
      }
    }
  }

  const depois = await sincronizarResumo(db, contactId);
  return { antes, depois };
}

/** Consentimento de um telefone que está ENTRANDO: aceita, salvo "não". */
function consentimentoDeTelefoneNovo(
  p: TelefoneEntrada,
  agora: Date = new Date()
) {
  const whatsapp = p.whatsapp !== false;
  // SMS só chega em celular: fixo com opt-in vira mensagem paga e um 21614
  // na primeira campanha.
  const sms = p.sms !== false && parseBrazilianMobile(p.phone).ok;
  return {
    whatsappSubscribed: whatsapp,
    whatsappOptInAt: whatsapp ? agora : null,
    whatsappOptOutAt: p.whatsapp === false ? agora : null,
    smsSubscribed: sms,
    smsOptInAt: sms ? agora : null,
    smsOptOutAt: p.sms === false ? agora : null,
  };
}

function patchDeEmailExistente(
  existente: ContactEmail,
  e: EmailEntrada,
  principal: boolean,
  agora: Date
): Partial<ContactEmail> {
  const patch: Partial<ContactEmail> = {};
  if (existente.principal !== principal) patch.principal = principal;
  if (e.subscribed !== undefined && e.subscribed !== existente.subscribed) {
    patch.subscribed = e.subscribed;
    patch.optOutAt = e.subscribed ? null : agora;
  }
  return patch;
}

function patchDeTelefoneExistente(
  existente: ContactPhone,
  p: TelefoneEntrada,
  principal: boolean,
  agora: Date
): Partial<ContactPhone> {
  const patch: Partial<ContactPhone> = {};
  if (existente.principal !== principal) patch.principal = principal;
  if (p.whatsapp !== undefined && p.whatsapp !== existente.whatsappSubscribed) {
    patch.whatsappSubscribed = p.whatsapp;
    if (p.whatsapp) {
      // Preserva a data do primeiro consentimento (prova LGPD).
      patch.whatsappOptInAt = existente.whatsappOptInAt ?? agora;
      patch.whatsappOptOutAt = null;
    } else {
      patch.whatsappOptOutAt = agora;
    }
  }
  const smsDesejado =
    p.sms === undefined
      ? undefined
      : p.sms && parseBrazilianMobile(existente.phone).ok;
  if (smsDesejado !== undefined && smsDesejado !== existente.smsSubscribed) {
    patch.smsSubscribed = smsDesejado;
    if (smsDesejado) {
      patch.smsOptInAt = existente.smsOptInAt ?? agora;
      patch.smsOptOutAt = null;
    } else {
      patch.smsOptOutAt = agora;
    }
  }
  return patch;
}

// ─── Saída de canal (opt-out) ──────────────────────────────────────────────

export interface ResultadoDoOptOut {
  contactId: string;
  /** Algum endereço mudou de estado (o link costuma ser aberto mais de uma vez). */
  mudou: boolean;
  /** O contato ficou SEM endereço aceitando o canal — é o que vira evento. */
  contatoSaiu: boolean;
}

/** Um e-mail pediu para sair (link, devolução definitiva, reclamação). */
export async function optOutEmail(
  db: Db,
  email: string
): Promise<ResultadoDoOptOut | null> {
  const row = await contatoPorEmail(db, email);
  if (!row) return null;
  return optOutDeEmails(db, row.contactId, [row]);
}

/** Todos os e-mails do contato — para os pedidos de antes dos endereços. */
export async function optOutEmailsDoContato(
  db: Db,
  contactId: string
): Promise<ResultadoDoOptOut> {
  const { emails } = await listarEnderecos(db, contactId);
  return optOutDeEmails(db, contactId, emails);
}

async function optOutDeEmails(
  db: Db,
  contactId: string,
  rows: ContactEmail[]
): Promise<ResultadoDoOptOut> {
  const antes = await resumoAtual(db, contactId);
  const alvo = rows.filter((r) => r.subscribed).map((r) => r.id);
  if (alvo.length > 0) {
    await db
      .update(contactEmails)
      .set({ subscribed: false, optOutAt: new Date() })
      .where(inArray(contactEmails.id, alvo));
  }
  const depois = await sincronizarResumo(db, contactId);
  return {
    contactId,
    mudou: alvo.length > 0,
    contatoSaiu: antes.subscribed && !depois.subscribed,
  };
}

export type CanalDeTelefone = "whatsapp" | "sms";

/** Um número pediu para sair de um canal (SAIR, STOP, erro definitivo). */
export async function optOutTelefone(
  db: Db,
  phone: string,
  canal: CanalDeTelefone
): Promise<ResultadoDoOptOut | null> {
  const row = await contatoPorTelefone(db, phone);
  if (!row) return null;
  return optOutDeTelefones(db, row.contactId, [row], canal);
}

/** O número que escreveu no WhatsApp, seja qual for a forma cadastrada. */
export async function optOutTelefonePorWaId(
  db: Db,
  waId: string,
  canal: CanalDeTelefone
): Promise<ResultadoDoOptOut | null> {
  const row = await contatoPorWaId(db, waId);
  if (!row) return null;
  return optOutDeTelefones(db, row.contactId, [row], canal);
}

export async function optOutTelefonesDoContato(
  db: Db,
  contactId: string,
  canal: CanalDeTelefone
): Promise<ResultadoDoOptOut> {
  const { phones } = await listarEnderecos(db, contactId);
  return optOutDeTelefones(db, contactId, phones, canal);
}

async function optOutDeTelefones(
  db: Db,
  contactId: string,
  rows: ContactPhone[],
  canal: CanalDeTelefone
): Promise<ResultadoDoOptOut> {
  const antes = await resumoAtual(db, contactId);
  const aceita = (r: ContactPhone) =>
    canal === "whatsapp" ? r.whatsappSubscribed : r.smsSubscribed;
  const alvo = rows.filter(aceita).map((r) => r.id);
  if (alvo.length > 0) {
    await db
      .update(contactPhones)
      .set(
        canal === "whatsapp"
          ? { whatsappSubscribed: false, whatsappOptOutAt: new Date() }
          : { smsSubscribed: false, smsOptOutAt: new Date() }
      )
      .where(inArray(contactPhones.id, alvo));
  }
  const depois = await sincronizarResumo(db, contactId);
  const chave = canal === "whatsapp" ? "whatsappSubscribed" : "smsSubscribed";
  return {
    contactId,
    mudou: alvo.length > 0,
    contatoSaiu: antes[chave] && !depois[chave],
  };
}

// ─── Resumo ────────────────────────────────────────────────────────────────

function canaisDe(enderecos: Enderecos): ResumoDosCanais {
  return {
    subscribed: enderecos.emails.some((e) => e.subscribed),
    whatsappSubscribed: enderecos.phones.some((p) => p.whatsappSubscribed),
    smsSubscribed: enderecos.phones.some((p) => p.smsSubscribed),
  };
}

async function resumoAtual(
  db: Db,
  contactId: string
): Promise<ResumoDosCanais> {
  return canaisDe(await listarEnderecos(db, contactId));
}

function menorData(datas: (Date | null)[]): Date | null {
  let menor: Date | null = null;
  for (const d of datas) if (d && (!menor || d < menor)) menor = d;
  return menor;
}

function maiorData(datas: (Date | null)[]): Date | null {
  let maior: Date | null = null;
  for (const d of datas) if (d && (!maior || d > maior)) maior = d;
  return maior;
}

/**
 * Recalcula as colunas-resumo de `contacts` a partir dos endereços. É chamado
 * ao fim de toda escrita deste módulo; chamar à toa não faz mal.
 */
export async function sincronizarResumo(
  db: Db,
  contactId: string
): Promise<ResumoDosCanais> {
  const { emails, phones } = await listarEnderecos(db, contactId);
  const canais = canaisDe({ emails, phones });
  const principalEmail = emails.find((e) => e.principal) ?? emails[0] ?? null;
  const principalPhone = phones.find((p) => p.principal) ?? phones[0] ?? null;
  await db
    .update(contacts)
    .set({
      email: principalEmail?.email ?? null,
      phone: principalPhone?.phone ?? null,
      subscribed: canais.subscribed,
      emailOptOutAt: canais.subscribed
        ? null
        : maiorData(emails.map((e) => e.optOutAt)),
      whatsappSubscribed: canais.whatsappSubscribed,
      whatsappOptInAt: menorData(phones.map((p) => p.whatsappOptInAt)),
      whatsappOptOutAt: canais.whatsappSubscribed
        ? null
        : maiorData(phones.map((p) => p.whatsappOptOutAt)),
      smsSubscribed: canais.smsSubscribed,
      smsOptInAt: menorData(phones.map((p) => p.smsOptInAt)),
      smsOptOutAt: canais.smsSubscribed
        ? null
        : maiorData(phones.map((p) => p.smsOptOutAt)),
    })
    .where(eq(contacts.id, contactId));
  return canais;
}

/**
 * Copia o e-mail e o telefone das colunas antigas de `contacts` para as
 * tabelas de endereço, para quem ainda não tem linha lá. É o que a migração
 * faz em produção; aqui serve ao seed e aos scripts de teste, que inserem
 * contatos direto na tabela.
 */
export async function importarEnderecosDasColunasAntigas(
  db: Db
): Promise<void> {
  await db.execute(sql`
    INSERT INTO contact_emails (contact_id, email, subscribed, opt_out_at, principal, created_at)
    SELECT c.id, lower(c.email), c.subscribed, c.email_opt_out_at,
           NOT EXISTS (SELECT 1 FROM contact_emails e WHERE e.contact_id = c.id AND e.principal),
           c.created_at
      FROM contacts c
     WHERE c.email IS NOT NULL
    ON CONFLICT (email) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO contact_phones (contact_id, phone, whatsapp_subscribed, whatsapp_opt_in_at, whatsapp_opt_out_at,
                                sms_subscribed, sms_opt_in_at, sms_opt_out_at, principal, created_at)
    SELECT c.id, c.phone, c.whatsapp_subscribed, c.whatsapp_opt_in_at, c.whatsapp_opt_out_at,
           c.sms_subscribed, c.sms_opt_in_at, c.sms_opt_out_at,
           NOT EXISTS (SELECT 1 FROM contact_phones p WHERE p.contact_id = c.id AND p.principal),
           c.created_at
      FROM contacts c
     WHERE c.phone IS NOT NULL
    ON CONFLICT (phone) DO NOTHING
  `);
}

function dedupePor<T>(itens: T[], chave: (item: T) => string): T[] {
  const vistos = new Set<string>();
  const unicos: T[] = [];
  for (const item of itens) {
    const k = chave(item);
    if (vistos.has(k)) continue;
    vistos.add(k);
    unicos.push(item);
  }
  return unicos;
}
