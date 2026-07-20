import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { campaignSends, getDb } from "@/lib/db";
import { getBaseUrl } from "@/lib/email";

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
  const target = safeTargetUrl(params.get("url"));

  if (sid) {
    try {
      const db = getDb();
      const [send] = await db
        .select()
        .from(campaignSends)
        .where(eq(campaignSends.id, sid));

      if (send) {
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
      }
    } catch (error) {
      // O redirect precisa acontecer mesmo se o tracking falhar.
      console.error("[track/click]", error);
    }
  }

  return NextResponse.redirect(target, 302);
}
