import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(process.cwd(), ".env.local") });

import { and, isNotNull, isNull } from "drizzle-orm";

import { contacts, getDb } from "../lib/db";
import { enviarLeadAoHub } from "../lib/nrg/captacao";

// Carga única: manda ao NRG Hub (fonte de captação, NRG_HUB_CAPTACAO_URL) os
// leads daqui que ainda não têm funil no CRM — isto é, que o Hub não conhece.
// Quem já existe lá pelo telefone vira "Duplicado" no Hub (só completa o que
// faltava), então repetir a carga não cria pessoa duas vezes.
//
//   npx tsx scripts/enviar-leads-ao-hub.ts --dry-run      (só conta)
//   npx tsx scripts/enviar-leads-ao-hub.ts --limite 50    (manda os 50 primeiros)
//   npx tsx scripts/enviar-leads-ao-hub.ts                (manda todos)

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const i = args.indexOf("--limite");
  const limite = i >= 0 ? Number(args[i + 1]) : Infinity;
  if (!process.env.NRG_HUB_CAPTACAO_URL && !dryRun) {
    console.error("NRG_HUB_CAPTACAO_URL não definida.");
    process.exit(1);
  }
  const db = getDb();
  const leads = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      phone: contacts.phone,
      company: contacts.company,
      utmSource: contacts.utmSource,
      utmMedium: contacts.utmMedium,
      utmCampaign: contacts.utmCampaign,
      utmContent: contacts.utmContent,
      utmTerm: contacts.utmTerm,
      origem: contacts.sourceDetail,
    })
    .from(contacts)
    .where(and(isNotNull(contacts.stage), isNull(contacts.crmFunil), isNotNull(contacts.phone)))
    .orderBy(contacts.createdAt);
  console.log(`${leads.length} lead(s) sem funil e com telefone${dryRun ? " (dry-run, nada enviado)" : ""}.`);
  if (dryRun) return;

  let ok = 0;
  let falhas = 0;
  for (const lead of leads.slice(0, limite)) {
    const r = await enviarLeadAoHub(lead);
    if (r.ok) ok++;
    else {
      falhas++;
      console.log(`  falhou ${lead.id} (${lead.name}): ${r.motivo} ${r.status ?? ""} ${r.detalhe ?? ""}`);
    }
    // Sem pressa: a fonte do Hub não é feita para enxurrada.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  console.log(`enviados: ${ok} · falhas: ${falhas}. O funil chega pela sincronização (até 5 min) ou pelo webhook do Hub.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
