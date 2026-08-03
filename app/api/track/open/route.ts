import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { campaignSends, getDb } from "@/lib/db";
import { emitContactEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

// GIF 1x1 transparente.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(request: NextRequest) {
  const sid = request.nextUrl.searchParams.get("sid");

  if (sid) {
    try {
      const db = getDb();
      const [send] = await db
        .select()
        .from(campaignSends)
        .where(eq(campaignSends.id, sid));

      if (send) {
        await db
          .update(campaignSends)
          .set({
            // Clique é um estado mais forte que abertura: não regride.
            status: send.status === "clicked" ? "clicked" : "opened",
            openedAt: send.openedAt ?? new Date(),
          })
          .where(eq(campaignSends.id, sid));

        // Só a PRIMEIRA abertura vira evento: o pixel é carregado toda vez que
        // o e-mail é reaberto, e um gatilho não deve disparar de novo por isso.
        if (!send.openedAt) {
          await emitContactEvent("email_opened", send.contactId, {
            campaignId: send.campaignId,
            sendId: send.id,
          });
        }
      }
    } catch (error) {
      // O pixel precisa responder mesmo se o tracking falhar.
      console.error("[track/open]", error);
    }
  }

  return new NextResponse(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
