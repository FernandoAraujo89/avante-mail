import { config } from "dotenv";
import { Client } from "pg";

// Migração idempotente: trava contra envio duplicado + segmentos cobrados.
//
// 1. ÍNDICE ÚNICO campaign_sends(campaign_id, contact_id).
//    Uma campanha manda UMA vez para cada contato. Sem isso, dois cliques em
//    "Disparar" — ou um disparo de campanha que já estava agendada — criavam a
//    fila inteira outra vez: cada contato recebia duas mensagens e a conta
//    vinha dobrada. Em e-mail isso irrita; em SMS, que cobra por segmento, é
//    dinheiro direto. O índice é PARCIAL porque envio de automação tem
//    campaign_id nulo e já tem trava própria (campaign_sends_automacao_passo_idx).
//
// 2. campaign_sends.sms_segments_billed — quantos segmentos a TWILIO diz ter
//    cobrado (NumSegments do status callback). A coluna sms_segments é a nossa
//    contagem; esta é a do provedor. Ter as duas é o que permite perceber
//    divergência entre o relatório e a fatura em vez de descobrir no cartão.
//
// Rode: `npx tsx scripts/migrate-envio-unico.ts` (o deploy roda sozinho)

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[MIGRATE] DATABASE_URL não definida no .env.local.");
  process.exit(1);
}

const needsSsl = /sslmode=require|neon\.tech/.test(url);
const client = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  await client.connect();

  console.log("[MIGRATE] campaign_sends: segmentos cobrados pelo provedor...");
  await client.query(
    `ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS sms_segments_billed integer`
  );

  // O índice único falharia com erro cru do Postgres se já houvesse duplicata.
  // Conferir antes deixa a mensagem legível e, principalmente, MOSTRA quais
  // pares estão duplicados — sem isso o deploy quebra sem dizer o que fazer.
  console.log("[MIGRATE] conferindo envios duplicados existentes...");
  const { rows: dups } = await client.query(
    `SELECT campaign_id, contact_id, count(*) AS n
       FROM campaign_sends
      WHERE campaign_id IS NOT NULL
      GROUP BY campaign_id, contact_id
     HAVING count(*) > 1
      ORDER BY n DESC
      LIMIT 20`
  );

  if (dups.length > 0) {
    console.error(
      `[MIGRATE] ABORTADO: existem ${dups.length}+ pares (campanha, contato) duplicados.\n` +
        "O índice único não pode ser criado enquanto eles existirem. Os primeiros:"
    );
    for (const d of dups) {
      console.error(`  campanha ${d.campaign_id} · contato ${d.contact_id} → ${d.n} envios`);
    }
    console.error(
      "\nDecida o que fazer com cada um (provavelmente apagar o mais recente,\n" +
        "preservando o que tem sentAt/provider_message_id) e rode de novo."
    );
    await client.end();
    process.exit(1);
  }

  console.log("[MIGRATE] campaign_sends: índice único (campanha, contato)...");
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS campaign_sends_campanha_contato_idx
       ON campaign_sends (campaign_id, contact_id)
     WHERE campaign_id IS NOT NULL`
  );

  console.log("[MIGRATE] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
