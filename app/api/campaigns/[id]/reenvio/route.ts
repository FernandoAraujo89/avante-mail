import { NextRequest, NextResponse } from "next/server";

import {
  campanhaPorId,
  conferirDestinatarios,
  lerDestinatarios,
  MAX_REENVIO,
  podeReenviar,
  reenviarEmailDaCampanha,
} from "@/lib/reenvio";
import { sessionUserFromRequest } from "@/lib/session";
import { mensagemSemSql } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Reenvio avulso do e-mail de uma campanha já disparada, para endereços
// digitados à mão (lib/reenvio). Não confundir com /resend, que reenfileira
// os envios de WhatsApp que a Meta segurou.
//
// Corpo: { destinatarios: [{ email, nome? }] | "texto livre", conferir?: true }
//  · conferir = true → só diz o que acontece com cada endereço (é contato,
//    está fora da base, está descadastrado) e não manda nada. É o passo de
//    conferência da tela, antes do botão que envia de verdade.
//  · sem conferir → envia. Tudo é validado de novo aqui: a conferência é
//    ajuda para quem digita, não a trava.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const campanha = await campanhaPorId(id);
    if (!campanha) {
      return NextResponse.json(
        { error: "Campanha não encontrada." },
        { status: 404 }
      );
    }
    if (campanha.channel !== "email") {
      return NextResponse.json(
        { error: "O reenvio para e-mails vale só para campanhas de e-mail." },
        { status: 400 }
      );
    }
    if (!podeReenviar(campanha)) {
      return NextResponse.json(
        {
          error:
            "Só dá para reenviar o e-mail de uma campanha que já foi disparada.",
        },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { destinatarios, invalidos } = lerDestinatarios(body.destinatarios);

    if (invalidos.length > 0) {
      return NextResponse.json(
        { error: `E-mail(s) inválido(s): ${invalidos.join(", ")}` },
        { status: 400 }
      );
    }
    if (destinatarios.length === 0) {
      return NextResponse.json(
        { error: "Informe ao menos um e-mail." },
        { status: 400 }
      );
    }
    if (destinatarios.length > MAX_REENVIO) {
      return NextResponse.json(
        {
          error: `Máximo de ${MAX_REENVIO} e-mails por reenvio. Para mais gente, duplique a campanha e escolha os destinatários.`,
        },
        { status: 400 }
      );
    }

    const { enderecos, emailUsaNome } = await conferirDestinatarios(
      campanha,
      destinatarios
    );

    if (body.conferir === true) {
      return NextResponse.json({ enderecos, emailUsaNome });
    }

    const semNome = enderecos.filter((e) => e.faltaNome).map((e) => e.email);
    if (semNome.length > 0) {
      return NextResponse.json(
        {
          error: `Este e-mail chama o destinatário pelo nome. Informe o nome de: ${semNome.join(", ")}`,
        },
        { status: 400 }
      );
    }
    if (enderecos.every((e) => e.situacao === "descadastrado")) {
      return NextResponse.json(
        {
          error:
            "Nenhum destes endereços pode receber: todos estão descadastrados.",
        },
        { status: 400 }
      );
    }
    if (!process.env.SES_FROM_EMAIL) {
      return NextResponse.json(
        { error: "Envio não configurado (SES_FROM_EMAIL)." },
        { status: 500 }
      );
    }

    const autor = await sessionUserFromRequest(request);
    const resultado = await reenviarEmailDaCampanha({
      campaign: campanha,
      destinatarios,
      autor: autor ? { id: autor.id, name: autor.name } : null,
    });

    if (resultado.enviados.length === 0) {
      const [primeira] = resultado.falhas;
      return NextResponse.json(
        {
          error: `Nenhum e-mail saiu${primeira ? ` — ${primeira.motivo}` : "."}`,
          ...resultado,
        },
        { status: 502 }
      );
    }
    return NextResponse.json(resultado);
  } catch (error) {
    return NextResponse.json({ error: mensagemSemSql(error) }, { status: 500 });
  }
}
