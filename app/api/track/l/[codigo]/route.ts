import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getBaseUrl } from "@/lib/base-url";
import { contacts, getDb } from "@/lib/db";
import { anexarToken, hostPermitido } from "@/lib/track/site";
import { signSiteToken } from "@/lib/track/token";
import { resolverCliqueDeLink } from "@/lib/whatsapp/rastreio-de-link";

export const dynamic = "force-dynamic";

/**
 * O clique no botão de link rastreado do WhatsApp (lib/whatsapp/rastreio-de-
 * link.ts). Pública, como /api/track/click: o prefixo /api/track/ já está
 * liberado no middleware. Marca o clique e redireciona ao destino do botão;
 * código que não leva a nada vai para a página inicial.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await context.params;
  let destino = getBaseUrl();

  try {
    const clique = await resolverCliqueDeLink(codigo);
    if (clique) {
      destino = clique.destino;
      // Rastreio do site (fase E), a mesma regra do clique de e-mail: o
      // destino leva o token da pessoa SÓ para os nossos domínios, só para
      // lead e só para quem não pediu para sair.
      if (clique.contactId && hostPermitido(destino)) {
        try {
          const [dono] = await getDb()
            .select({ stage: contacts.stage, optOut: contacts.emailOptOutAt })
            .from(contacts)
            .where(eq(contacts.id, clique.contactId));
          if (dono?.stage && !dono.optOut) {
            destino = anexarToken(destino, await signSiteToken(clique.contactId));
          }
        } catch (error) {
          console.error("[track/l] token de rastreio:", error);
        }
      }
    }
  } catch (error) {
    // O redirecionamento precisa acontecer mesmo se o rastreio falhar.
    console.error("[track/l]", error);
  }

  return NextResponse.redirect(destino, 302);
}
