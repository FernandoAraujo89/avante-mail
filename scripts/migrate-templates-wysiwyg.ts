import { config } from "dotenv";
import { eq } from "drizzle-orm";

import { getDb, templates } from "@/lib/db";
import { compileDesignToMjml } from "@/lib/email-builder/compile";
import { materializeDesignForEditing } from "@/lib/email-builder/materialize";

// Modelos agora são WYSIWYG: trocam os tokens de conteúdo ({{corpo}} etc.)
// por texto real editável, mantendo {{nome_parceiro}} e {{unsubscribe_url}}.
// Idempotente (materializar de novo não muda nada). Roda no deploy.
// `npx tsx scripts/migrate-templates-wysiwyg.ts`

config({ path: ".env.local" });

async function main() {
  const db = getDb();
  const rows = await db.select().from(templates);

  let changed = 0;
  for (const t of rows) {
    if (t.editorType !== "builder" || !t.design) continue;
    const materialized = materializeDesignForEditing(t.design);
    const mjml = compileDesignToMjml(materialized);
    const before = JSON.stringify(t.design);
    if (before === JSON.stringify(materialized)) continue; // já limpo
    await db
      .update(templates)
      .set({ design: materialized, mjmlContent: mjml })
      .where(eq(templates.id, t.id));
    changed++;
    console.log(`  ✓ ${t.name}`);
  }

  console.log(
    `[MIGRATE] Templates materializados: ${changed}/${rows.length}.`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("[MIGRATE] Falhou:", error);
  process.exit(1);
});
