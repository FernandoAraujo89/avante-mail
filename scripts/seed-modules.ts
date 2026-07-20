import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

import { getDb, modules } from "../lib/db";
import {
  createFooterModuleRow,
  createHeaderModuleRow,
} from "../lib/email-builder/presets";

async function main() {
  const db = getDb();
  const existing = await db.select({ name: modules.name }).from(modules);
  const names = new Set(existing.map((m) => m.name));

  const toInsert = [
    { name: "Header Avante", design: createHeaderModuleRow() },
    { name: "Footer Avante", design: createFooterModuleRow() },
  ].filter((m) => !names.has(m.name));

  if (toInsert.length === 0) {
    console.log("módulos de fábrica já existem");
    return;
  }
  await db.insert(modules).values(toInsert);
  console.log("✓ inseridos:", toInsert.map((m) => m.name).join(", "));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
