// O modelo e o mapeamento de variáveis do convite por WhatsApp, vindos do
// construtor. Fica FORA de ./perguntas.ts porque template-input.ts puxa
// lib/uploads.ts (fs), e perguntas.ts é importado pela tela no navegador.
import { parseVariableMap } from "@/lib/whatsapp/template-input";
import type { WhatsAppVariableMap } from "@/lib/whatsapp/types";
export type ParseWhatsApp =
  | {
      ok: true;
      dados: { whatsappTemplateId: string | null; whatsappVariables: WhatsAppVariableMap | null };
    }
  | { ok: false; error: string };

/** Modelo e mapeamento de variáveis do convite por WhatsApp (vazio = sem WhatsApp). */
export function parseWhatsApp(body: unknown): ParseWhatsApp {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = typeof b.whatsappTemplateId === "string" ? b.whatsappTemplateId.trim() : "";
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, error: "Modelo de WhatsApp inválido." };
  }
  const variables =
    b.whatsappVariables === null || b.whatsappVariables === undefined
      ? null
      : parseVariableMap(b.whatsappVariables);
  if (b.whatsappVariables && !variables) {
    return { ok: false, error: "Mapeamento das variáveis do modelo inválido." };
  }
  return {
    ok: true,
    dados: { whatsappTemplateId: id || null, whatsappVariables: id ? variables : null },
  };
}
