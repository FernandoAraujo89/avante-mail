import crypto from "crypto";
import { config } from "dotenv";
import { Client } from "pg";

// Teste ponta-a-ponta do webhook do WhatsApp (Fase 4) SEM depender da conta
// Meta. Semeia uma campanha/contatos de teste no banco, dispara payloads
// assinados (HMAC-SHA256, como a Meta faria) contra o endpoint real e confere
// o efeito no banco. No fim, limpa tudo que criou.
//
// Pré-requisitos (só para o teste; valores fictícios servem):
//   .env.local  →  WHATSAPP_APP_SECRET=test-secret
//                  WHATSAPP_WEBHOOK_VERIFY_TOKEN=test-token
// Com o servidor rodando (`npm run dev`):
//   npx tsx scripts/test-whatsapp-webhook.ts [http://localhost:3000]

config({ path: ".env.local" });

const BASE = (process.argv[2] || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.WHATSAPP_APP_SECRET;
const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const WEBHOOK = `${BASE}/api/webhooks/whatsapp`;

// Marcadores determinísticos — a limpeza remove qualquer resíduo de rodadas
// anteriores antes de semear.
const MARK = "zz_webhook_test";
const PHONE_A = "+5548900000001";
const PHONE_B = "+5548900000002";
const WAMID_A = `wamid.${MARK}_A`;
const WAMID_B = `wamid.${MARK}_B`;
const TEMPLATE_NAME = `${MARK}_tpl`;

if (!SECRET || !VERIFY_TOKEN) {
  console.error(
    "❌ Defina WHATSAPP_APP_SECRET e WHATSAPP_WEBHOOK_VERIFY_TOKEN no .env.local " +
      "(valores fictícios servem, ex.: test-secret / test-token) e rode de novo."
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DATABASE_URL não definida no .env.local.");
  process.exit(1);
}
const needsSsl = /sslmode=require|neon\.tech/.test(url);
const db = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

// ─── Utilidades ──────────────────────────────────────────────────────

function sign(body: string): string {
  return "sha256=" + crypto.createHmac("sha256", SECRET!).update(body, "utf8").digest("hex");
}

async function postSigned(
  payload: unknown,
  opts: { signature?: string } = {}
): Promise<{ status: number }> {
  const body = JSON.stringify(payload);
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": opts.signature ?? sign(body),
    },
    body,
  });
  return { status: res.status };
}

function nowUnix(): string {
  return String(Math.floor(Date.now() / 1000));
}

function statusPayload(wamid: string, status: string, error?: { code: number; message: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PNID_TEST" },
              statuses: [
                {
                  id: wamid,
                  status,
                  timestamp: nowUnix(),
                  recipient_id: "5548900000001",
                  ...(error ? { errors: [{ code: error.code, title: "erro", message: error.message }] } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function inboundPayload(fromPhoneNoPlus: string, text: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PNID_TEST" },
              contacts: [{ profile: { name: "Teste" }, wa_id: fromPhoneNoPlus }],
              messages: [
                {
                  from: fromPhoneNoPlus,
                  id: `wamid.inbound_${Date.now()}`,
                  timestamp: nowUnix(),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function templateStatusPayload(name: string, event: string, reason?: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [
          {
            field: "message_template_status_update",
            value: {
              message_template_id: 999999,
              message_template_name: name,
              message_template_language: "pt_BR",
              event,
              reason: reason ?? "NONE",
            },
          },
        ],
      },
    ],
  };
}

// ─── Consultas ao banco ──────────────────────────────────────────────

async function sendByWamid(wamid: string) {
  const r = await db.query(
    `select status, sent_at, delivered_at, read_at, replied_at, error_code
       from campaign_sends where provider_message_id = $1`,
    [wamid]
  );
  return r.rows[0];
}

async function contactByPhone(phone: string) {
  const r = await db.query(
    `select whatsapp_subscribed, whatsapp_opt_out_at from contacts where phone = $1`,
    [phone]
  );
  return r.rows[0];
}

// ─── Resultado dos testes ────────────────────────────────────────────

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ─── Semeadura e limpeza ─────────────────────────────────────────────

async function cleanup() {
  // Remove campanhas de teste (cascata apaga os campaign_sends), contatos e
  // o template de teste.
  await db.query(`DELETE FROM campaigns WHERE name = $1`, [`${MARK} campaign`]);
  await db.query(`DELETE FROM contacts WHERE phone IN ($1, $2)`, [PHONE_A, PHONE_B]);
  await db.query(`DELETE FROM whatsapp_templates WHERE name = $1`, [TEMPLATE_NAME]);
}

async function seed(): Promise<string> {
  const tpl = await db.query(
    `INSERT INTO whatsapp_templates (name, language, category, status, meta_template_id, body_text)
     VALUES ($1, 'pt_BR', 'MARKETING', 'pending', 'meta-test-id-999', 'Olá {{1}}!')
     RETURNING id`,
    [TEMPLATE_NAME]
  );

  const campaign = await db.query(
    `INSERT INTO campaigns (name, subject, channel, whatsapp_template_id, status)
     VALUES ($1, $1, 'whatsapp', $2, 'sending') RETURNING id`,
    [`${MARK} campaign`, tpl.rows[0].id]
  );
  const campaignId = campaign.rows[0].id;

  const contactA = await db.query(
    `INSERT INTO contacts (name, email, phone, whatsapp_subscribed, whatsapp_opt_in_at)
     VALUES ('Teste A', $1, $2, true, now()) RETURNING id`,
    [`${MARK}_a@exemplo.com`, PHONE_A]
  );
  const contactB = await db.query(
    `INSERT INTO contacts (name, email, phone, whatsapp_subscribed, whatsapp_opt_in_at)
     VALUES ('Teste B', $1, $2, true, now()) RETURNING id`,
    [`${MARK}_b@exemplo.com`, PHONE_B]
  );

  // Dois envios já "sent" (como o worker deixaria após chamar a Cloud API).
  await db.query(
    `INSERT INTO campaign_sends (campaign_id, contact_id, status, provider_message_id, sent_at)
     VALUES ($1, $2, 'sent', $3, now())`,
    [campaignId, contactA.rows[0].id, WAMID_A]
  );
  await db.query(
    `INSERT INTO campaign_sends (campaign_id, contact_id, status, provider_message_id, sent_at)
     VALUES ($1, $2, 'sent', $3, now())`,
    [campaignId, contactB.rows[0].id, WAMID_B]
  );

  return campaignId;
}

// ─── Execução ────────────────────────────────────────────────────────

async function main() {
  await db.connect();
  console.log(`\n🔗 Webhook: ${WEBHOOK}\n`);

  await cleanup(); // remove resíduos de rodadas anteriores
  await seed();

  // 1. Handshake (GET)
  console.log("1) Handshake de verificação (GET)");
  {
    const ok = await fetch(
      `${WEBHOOK}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY_TOKEN!)}&hub.challenge=desafio123`
    );
    const body = await ok.text();
    check("token correto ecoa o hub.challenge", ok.status === 200 && body === "desafio123", `status=${ok.status} body=${body}`);

    const bad = await fetch(`${WEBHOOK}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=x`);
    check("token errado → 403", bad.status === 403, `status=${bad.status}`);
  }

  // 2. Assinatura
  console.log("2) Verificação de assinatura (POST)");
  {
    const bad = await postSigned(statusPayload(WAMID_A, "delivered"), { signature: "sha256=deadbeef" });
    check("assinatura inválida → 401", bad.status === 401, `status=${bad.status}`);
  }

  // 3. Transição de status monotônica
  console.log("3) Status: sent → delivered → read (monotônico)");
  {
    const d = await postSigned(statusPayload(WAMID_A, "delivered"));
    const afterDelivered = await sendByWamid(WAMID_A);
    check("delivered aceito (200)", d.status === 200);
    check("status = delivered", afterDelivered.status === "delivered", afterDelivered.status);
    check("delivered_at preenchido", afterDelivered.delivered_at !== null);

    await postSigned(statusPayload(WAMID_A, "read"));
    const afterRead = await sendByWamid(WAMID_A);
    check("status = read", afterRead.status === "read", afterRead.status);
    check("read_at preenchido", afterRead.read_at !== null);

    // Evento atrasado 'delivered' chegando DEPOIS de 'read' não regride.
    await postSigned(statusPayload(WAMID_A, "delivered"));
    const afterLate = await sendByWamid(WAMID_A);
    check("evento fora de ordem não regride (continua read)", afterLate.status === "read", afterLate.status);
  }

  // 4. Falha permanente (131049)
  console.log("4) Status failed com erro 131049 (limite do destinatário)");
  {
    await postSigned(statusPayload(WAMID_B, "failed", { code: 131049, message: "frequency cap" }));
    const afterFail = await sendByWamid(WAMID_B);
    check("status = failed", afterFail.status === "failed", afterFail.status);
    check("error_code = 131049", afterFail.error_code === "131049", String(afterFail.error_code));
  }

  // 5. Mensagem recebida + opt-out por palavra-chave
  console.log('5) Mensagem recebida "SAIR" (opt-out + resposta)');
  {
    await postSigned(inboundPayload("5548900000001", "SAIR"));
    const contact = await contactByPhone(PHONE_A);
    check("contato descadastrado (whatsapp_subscribed=false)", contact.whatsapp_subscribed === false, String(contact.whatsapp_subscribed));
    check("whatsapp_opt_out_at preenchido", contact.whatsapp_opt_out_at !== null);
    const send = await sendByWamid(WAMID_A);
    check("replied_at registrado no envio do contato", send.replied_at !== null);
  }

  // 6. Atualização de status de template
  console.log("6) Status de template (REJECTED)");
  {
    await postSigned(templateStatusPayload(TEMPLATE_NAME, "REJECTED", "INVALID_FORMAT"));
    const r = await db.query(`select status, rejection_reason from whatsapp_templates where name = $1`, [TEMPLATE_NAME]);
    check("template status = rejected", r.rows[0].status === "rejected", r.rows[0].status);
    check("motivo da rejeição gravado", r.rows[0].rejection_reason === "INVALID_FORMAT", String(r.rows[0].rejection_reason));
  }

  // 7. Evento de mensagem para um wamid desconhecido é ignorado sem erro
  console.log("7) Evento de wamid desconhecido é ignorado (200)");
  {
    const r = await postSigned(statusPayload("wamid.NAO_EXISTE", "delivered"));
    check("responde 200 sem quebrar", r.status === 200, `status=${r.status}`);
  }

  await cleanup();
  await db.end();

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passaram, ${failed} falharam.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\n❌ Erro no teste:", error);
  await cleanup().catch(() => {});
  await db.end().catch(() => {});
  process.exit(1);
});
