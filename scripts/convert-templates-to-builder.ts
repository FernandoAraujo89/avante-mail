// Converte os templates de fábrica (criados como código MJML) para o
// formato do Criador de email, permitindo edição visual com drag and drop.
// O PATCH na API recompila o MJML a partir do design no servidor.

const BASE = process.env.BASE_URL ?? "http://localhost:3003";

import { FACTORY_TEMPLATE_DESIGNS } from "../lib/email-builder/template-designs";

async function main() {
  const res = await fetch(`${BASE}/api/templates`);
  const templates = (await res.json()) as {
    id: string;
    name: string;
    editorType: string;
  }[];
  if (!res.ok || !Array.isArray(templates)) {
    throw new Error("Não foi possível listar os templates.");
  }

  for (const factory of FACTORY_TEMPLATE_DESIGNS) {
    const target = templates.find((t) => t.name === factory.name);
    if (!target) {
      console.log(`— "${factory.name}": não existe no banco, pulando`);
      continue;
    }
    if (target.editorType === "builder") {
      console.log(`— "${factory.name}": já é do criador visual, pulando`);
      continue;
    }

    const patch = await fetch(`${BASE}/api/templates/${target.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ design: factory.design() }),
    });
    const body = await patch.json();
    if (!patch.ok) {
      throw new Error(`"${factory.name}": ${body.error}`);
    }
    console.log(
      `✓ "${factory.name}" convertido → editorType=${body.editorType}, mjml ${Math.round(body.mjmlContent.length / 1024)}KB`
    );
  }

  console.log("\nConversão concluída.");
}

main().catch((error) => {
  console.error("erro:", error);
  process.exit(1);
});
