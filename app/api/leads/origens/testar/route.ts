import { NextRequest, NextResponse } from "next/server";

import { firstValidPhone } from "@/lib/phone";
import { extrairCampos } from "@/lib/webhooks/entrada";
import { limparMapeamento } from "@/lib/webhooks/origens";
import { EMAIL_REGEX, errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Ensaio do mapeamento: aplica o mapa sobre um corpo colado e mostra o que
 * SAIRIA — sem criar lead, sem gravar entrega.
 *
 * Existe porque configurar mapeamento às cegas é o jeito garantido de descobrir
 * o erro só quando o lead de verdade some. Aqui o acerto é conferido antes de a
 * origem entrar no ar.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    let payload: unknown;
    if (typeof body.payload === "string") {
      try {
        payload = JSON.parse(body.payload);
      } catch {
        return NextResponse.json(
          { error: "O corpo colado não é um JSON válido." },
          { status: 400 }
        );
      }
    } else {
      payload = body.payload;
    }

    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { error: "Cole o corpo (JSON) que a plataforma envia." },
        { status: 400 }
      );
    }

    const campos = extrairCampos(payload, limparMapeamento(body.mapping));
    const email = campos.email?.toLowerCase() ?? null;
    const telefone = campos.phone ? firstValidPhone(campos.phone) : null;

    // Mesmas regras da entrada de verdade: sem identidade utilizável o lead é
    // recusado, e é melhor descobrir isso aqui.
    const problemas: string[] = [];
    if (!email && !telefone) {
      problemas.push(
        "Sem e-mail nem telefone válidos — este payload seria recusado."
      );
    }
    if (email && !EMAIL_REGEX.test(email)) {
      problemas.push(`E-mail inválido: “${email}”.`);
    }
    if (campos.phone && !telefone) {
      problemas.push(
        `Telefone não reconhecido: “${campos.phone}” (esperado com DDD).`
      );
    }

    return NextResponse.json({
      campos: { ...campos, email, phone: telefone },
      // O que a entrada faria com este corpo, na linguagem de quem configura.
      valido: problemas.length === 0,
      problemas,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
