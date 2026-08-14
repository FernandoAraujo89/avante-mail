import { NextResponse } from "next/server";

import { smsPricePerSegmentUsd, usdToBrlRate } from "@/lib/pricing";
import { isSmsEnabled, validateSmsEnv } from "@/lib/sms/config";

export const dynamic = "force-dynamic";

// Estado do canal SMS para a UI (wizard): se o canal está ligado e completo,
// o preço por segmento e o câmbio da estimativa de custo. Nenhum segredo sai
// daqui — `configured` é um booleano, e o que falta para configurar aparece só
// no log do servidor (validateSmsEnv fala de NOMES de variáveis, nunca de
// valores, mas nem o nome precisa chegar ao navegador).
export async function GET() {
  return NextResponse.json({
    configured: isSmsEnabled() && validateSmsEnv().length === 0,
    // Mesma tarifa que o relatório vai cobrar depois (a constante do canal, ou
    // a negociada em env): estimativa que não bate com a fatura é pior que
    // estimativa nenhuma.
    pricePerSegmentUsd: smsPricePerSegmentUsd(),
    usdBrlRate: usdToBrlRate(),
  });
}
