import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { campaignSends, contacts, getDb } from "@/lib/db";
import { getBaseUrl } from "@/lib/email";
import { emitContactEvent } from "@/lib/events";
import { anexarToken, hostPermitido } from "@/lib/track/site";
import { signSiteToken } from "@/lib/track/token";

export const dynamic = "force-dynamic";

function safeTargetUrl(raw: string | null): string {
  if (!raw) return getBaseUrl();
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // URL inválida: cai no fallback abaixo.
  }
  return getBaseUrl();
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const sid = params.get("sid");
  let target = safeTargetUrl(params.get("url"));

  if (sid) {
    try {
      const db = getDb();
      const [send] = await db
        .select()
        .from(campaignSends)
        .where(eq(campaignSends.id, sid));

      if (send) {
        // Rastreio do site (fase E): o destino leva um token que identifica a
        // pessoa — mas SÓ para os nossos domínios.
        //
        // `hostPermitido` é a diferença entre rastrear o próprio site e
        // entregar a identidade do lead a terceiros: esta rota redireciona
        // para qualquer http(s), então uma campanha que linke para fora
        // mandaria o token junto, e o dono daquele site passaria a poder
        // escrever na ficha do nosso contato. Em bloco próprio porque, como
        // diz o catch abaixo, o redirect precisa acontecer mesmo se o rastreio
        // falhar.
        try {
          if (hostPermitido(target)) {
            // Duas condições, consultadas juntas para não pagar uma ida ao
            // banco por link clicado quando o rastreio nem está ligado:
            //  - quem PEDIU PARA SAIR não recebe token novo. Sem isto, um
            //    e-mail antigo que ainda está na caixa da pessoa implantaria
            //    um identificador de 30 dias em quem já se descadastrou;
            //  - só LEAD é rastreado. A fase se chama rastreio de leads, e
            //    coletar navegação de parceiro seria coleta fora do propósito
            //    declarado — pior justamente por eles serem a maior parte da
            //    base.
            const [dono] = await db
              .select({ stage: contacts.stage, optOut: contacts.emailOptOutAt })
              .from(contacts)
              .where(eq(contacts.id, send.contactId));

            if (dono?.stage && !dono.optOut) {
              target = anexarToken(target, await signSiteToken(send.contactId));
            }
          }
        } catch (error) {
          console.error("[track/click] token de rastreio:", error);
        }

        const now = new Date();
        await db
          .update(campaignSends)
          .set({
            status: "clicked",
            clickedAt: send.clickedAt ?? now,
            // Quem clicou necessariamente abriu.
            openedAt: send.openedAt ?? now,
          })
          .where(eq(campaignSends.id, sid));

        // Só o primeiro clique vira evento — reabrir o link não é fato novo.
        if (!send.clickedAt) {
          await emitContactEvent("email_clicked", send.contactId, {
            campaignId: send.campaignId,
            sendId: send.id,
          });
        }
      }
    } catch (error) {
      // O redirect precisa acontecer mesmo se o tracking falhar.
      console.error("[track/click]", error);
    }
  }

  return NextResponse.redirect(target, 302);
}
