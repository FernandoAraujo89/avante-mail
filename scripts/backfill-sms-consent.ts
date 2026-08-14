import { config } from "dotenv";
import { Client } from "pg";

import {
  MOTIVO_LABEL,
  parseBrazilianMobile,
  type MotivoRejeicao,
} from "../lib/sms/phone";

// Backfill pontual: marca o consentimento de SMS para os contatos que já têm
// CELULAR cadastrado.
//
// NÃO é uma migração — o nome não casa com `migrate-*`, então o deploy não o
// executa. É de propósito: rodar a cada deploy reverteria as decisões tomadas
// depois (um contato importado de propósito sem opt-in voltaria a receber).
// Para aplicar de novo (ex.: depois de uma importação grande), rode à mão.
//
// TRAVA DE SEGURANÇA: quem já saiu do canal — `sms_opt_out_at` preenchido, seja
// porque respondeu SAIR/STOP (webhook de entrada), porque foi desmarcado na tela
// do contato, ou porque a Twilio recusou o número — NUNCA é reinscrito.
//
// POR QUE ESTE BACKFILL É MAIS ESTRITO QUE O DE WHATSAPP: a base foi
// normalizada por lib/phone.ts, que aceita telefone FIXO — e fixo não recebe
// SMS. A Twilio devolve o erro 21614, que é falha PERMANENTE: a mensagem é
// cobrada, não chega, e o worker ainda marca o contato como opt-out. Marcar a
// base inteira sem separar celular de fixo, portanto, não desperdiça só
// dinheiro: queima de vez o consentimento de quem foi cadastrado com o número
// do escritório. Por isso cada telefone passa por `parseBrazilianMobile`, e o
// que sobra é relatado por motivo.
//
// Rode NO SERVIDOR, onde está a base de verdade:
//
//   docker compose run --rm --no-deps app npx jiti scripts/backfill-sms-consent.ts
//
// É `jiti`, NÃO `tsx` — e isso não é preciosismo. Sob `npx tsx` o carregador
// CJS entrega a metadata da libphonenumber-js embrulhada em `{ default }` e
// TODA chamada de `parseBrazilianMobile` morre com "Cannot read properties of
// undefined (reading 'hasOwnProperty')". Não é questão de versão do Node:
// aconteceu igual no Node 26 do Mac e no node:22-slim do contêiner. O jiti
// resolve o build ESM do pacote, o mesmo caminho que o Next e os testes usam.
//
// O backfill de WhatsApp não tem essa ressalva porque só fala SQL. E o
// worker/whatsapp-worker.ts roda sob tsx sem problema porque só usa
// phoneToWaId, que é um replace de string e não toca na biblioteca.

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[BACKFILL-SMS] DATABASE_URL não definida no .env.local.");
  process.exit(1);
}

const needsSsl = /sslmode=require|neon\.tech/.test(url);
const client = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

// O UPDATE vai por lotes: a base cabe num array só, mas um `IN` com dezenas de
// milhares de ids é o tipo de consulta que o Postgres aceita e o pgbouncer não.
const LOTE = 500;

async function main() {
  await client.connect();

  const { rows: before } = await client.query<{
    com_telefone: string;
    ja_com_consentimento: string;
    opt_out: string;
  }>(`
    SELECT
      count(*) FILTER (WHERE phone IS NOT NULL) AS com_telefone,
      count(*) FILTER (WHERE phone IS NOT NULL AND sms_subscribed) AS ja_com_consentimento,
      count(*) FILTER (WHERE phone IS NOT NULL AND sms_opt_out_at IS NOT NULL) AS opt_out
    FROM contacts
  `);

  const stats = before[0];
  console.log(`[BACKFILL-SMS] Contatos com telefone: ${stats.com_telefone}`);
  console.log(`[BACKFILL-SMS]   já com consentimento: ${stats.ja_com_consentimento}`);
  console.log(`[BACKFILL-SMS]   preservados (opt-out): ${stats.opt_out}`);

  // Candidatos: tem telefone, ainda não tem consentimento de SMS e nunca saiu
  // do canal. A peneira de celular x fixo é feita aqui no código, porque a
  // regra da Anatel (DDD, nono dígito, prefixo) não cabe num WHERE.
  const { rows: candidatos } = await client.query<{
    id: string;
    phone: string;
  }>(`
    SELECT id, phone
      FROM contacts
     WHERE phone IS NOT NULL
       AND sms_subscribed = false
       AND sms_opt_out_at IS NULL
  `);

  const elegiveis: string[] = [];
  const foraPorMotivo = new Map<MotivoRejeicao, number>();

  for (const contato of candidatos) {
    const resultado = parseBrazilianMobile(contato.phone);
    if (resultado.ok) {
      elegiveis.push(contato.id);
    } else {
      foraPorMotivo.set(
        resultado.motivo,
        (foraPorMotivo.get(resultado.motivo) ?? 0) + 1
      );
    }
  }

  console.log(`[BACKFILL-SMS] Candidatos analisados: ${candidatos.length}`);
  console.log(`[BACKFILL-SMS]   celulares elegíveis: ${elegiveis.length}`);
  console.log(
    `[BACKFILL-SMS]   fora (não recebem SMS): ${candidatos.length - elegiveis.length}`
  );
  for (const [motivo, quantos] of [...foraPorMotivo].sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`[BACKFILL-SMS]     ${MOTIVO_LABEL[motivo]}: ${quantos}`);
  }

  // O opt_in_at só é preenchido quando ainda não existe: se o contato já tinha
  // uma data de consentimento registrada, ela é a prova original (LGPD).
  let atualizados = 0;
  for (let i = 0; i < elegiveis.length; i += LOTE) {
    const lote = elegiveis.slice(i, i + LOTE);
    const { rowCount } = await client.query(
      `
      UPDATE contacts
         SET sms_subscribed = true,
             sms_opt_in_at = coalesce(sms_opt_in_at, now())
       WHERE id = ANY($1::uuid[])
      `,
      [lote]
    );
    atualizados += rowCount ?? 0;
  }

  console.log(`[BACKFILL-SMS] Contatos atualizados: ${atualizados}`);
  console.log("[BACKFILL-SMS] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[BACKFILL-SMS] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
