import { NextResponse } from "next/server";

import { usdToBrlRate } from "@/lib/pricing";
import { isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { WHATSAPP_BRAZIL_PRICE_USD } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

// Estado do canal WhatsApp para a UI (wizard): se as envs estão presentes,
// o limite diário do tier, a tabela de preços e o câmbio da estimativa de
// custo. Nenhum segredo sai daqui.
export async function GET() {
  const dailyLimit = Number(process.env.WHATSAPP_DAILY_LIMIT);
  return NextResponse.json({
    configured: isWhatsAppConfigured(),
    dailyLimit: Number.isFinite(dailyLimit) && dailyLimit > 0 ? dailyLimit : null,
    pricesUsd: WHATSAPP_BRAZIL_PRICE_USD,
    usdBrlRate: usdToBrlRate(),
  });
}
