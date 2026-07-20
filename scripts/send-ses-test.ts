import { config } from "dotenv";
import path from "path";

// Envia UM e-mail de teste direto pelo Amazon SES, sem passar pelo app nem
// pelo banco — serve para validar credenciais, identidade e envio.
// Uso: npx tsx scripts/send-ses-test.ts destino@email.com
//
// Lê do .env.local: SES_REGION, SES_FROM_EMAIL, AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY. No sandbox do SES, tanto o remetente quanto o
// destinatário precisam ser identidades verificadas.

config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Uso: npx tsx scripts/send-ses-test.ts destino@email.com");
    process.exit(1);
  }

  const missing = ["SES_FROM_EMAIL", "SES_SMTP_USER", "SES_SMTP_PASSWORD"].filter(
    (name) => !process.env[name]
  );
  if (missing.length > 0) {
    console.error(`Variáveis ausentes no .env.local: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Import dinâmico para garantir que o .env.local já foi carregado.
  const { sendEmail } = await import("../lib/ses");

  console.log(
    `Enviando via SES (${process.env.SES_REGION ?? "sa-east-1"}) de "${process.env.SES_FROM_EMAIL}" para "${to}"...`
  );

  const { messageId } = await sendEmail({
    to,
    subject: "Teste de envio via Amazon SES — Avante Mail",
    html: "<p>Se você recebeu este e-mail, o envio via <strong>Amazon SES</strong> está funcionando. ✅</p>",
  });

  console.log(`✓ Enviado. MessageId: ${messageId}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("✗ Falhou:", error);
  process.exit(1);
});
