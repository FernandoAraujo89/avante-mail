// Exportação dos envios de um disparo para planilha.
//
// O destino disto não é quem operou a campanha, é quem vai AGIR sobre ela: o
// time de sucesso do cliente abre a lista de quem não recebeu e liga, corrige o
// telefone ou tenta outro canal. Por isso cada linha carrega o motivo em
// português e uma frase do que fazer — nenhum código da Meta ou da Twilio
// aparece na planilha.

import { toCsv } from "./csv";
import { formatDateTime } from "./format";
import { formatPhone } from "./phone";
import { sendStatusLabel } from "./send-status";
import {
  describeSendOutcome,
  describeWhatsAppError,
} from "./whatsapp/errors";

export type ExportChannel = "email" | "whatsapp" | "sms";

/** O que a exportação precisa de um envio (mesma forma da tabela do relatório). */
export interface ExportableSend {
  status: string;
  sentAt: Date | string | null;
  openedAt: Date | string | null;
  clickedAt: Date | string | null;
  deliveredAt: Date | string | null;
  readAt: Date | string | null;
  repliedAt: Date | string | null;
  complainedAt?: Date | string | null;
  bounceType?: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  contactCompany: string | null;
}

/** Data no formato que a planilha reconhece: "17/08/2026 15:14", vazio se não houver. */
function dataParaPlanilha(valor: Date | string | null | undefined): string {
  if (!valor) return "";
  // formatDateTime devolve "17/08/2026, 15:14" — a vírgula atrapalha o Excel
  // a reconhecer a célula como data/hora.
  return formatDateTime(valor).replace(",", "");
}

// A Twilio devolve texto livre; estes dois códigos são os que mudam a base e
// merecem rótulo próprio (os mesmos destacados no relatório de SMS).
const SMS_FALHAS: Record<string, { motivo: string; texto: string }> = {
  "21610": {
    motivo: "Pediu para sair",
    texto: "O contato respondeu PARAR e foi descadastrado do SMS.",
  },
  "21614": {
    motivo: "Número não recebe SMS",
    texto:
      "O número não recebe SMS (fixo ou inexistente). Confira o telefone do contato.",
  },
  "21211": {
    motivo: "Número inválido",
    texto: "A operadora recusou o número. Confira o telefone do contato.",
  },
};

/** Motivo curto e explicação em uma frase, no vocabulário de cada canal. */
export function describeSendForExport(
  send: ExportableSend,
  channel: ExportChannel
): { motivo: string; texto: string } {
  if (channel === "whatsapp") {
    const { text } = describeSendOutcome(
      send.status,
      send.errorCode,
      send.errorMessage
    );
    const motivo =
      send.status === "failed"
        ? describeWhatsAppError(send.errorCode, send.errorMessage).label
        : "";
    return { motivo, texto: text };
  }

  if (channel === "sms") {
    if (send.status === "failed") {
      const conhecido = send.errorCode ? SMS_FALHAS[send.errorCode] : undefined;
      if (conhecido) return conhecido;
      return {
        motivo: "Falha no envio",
        texto:
          send.errorMessage?.trim() ||
          "A operadora recusou o envio e não detalhou o motivo.",
      };
    }
    switch (send.status) {
      case "delivered":
        return { motivo: "", texto: "Entregue pela operadora." };
      case "sent":
        return {
          motivo: "",
          texto: "Enviado: a operadora aceitou e ainda não confirmou a entrega.",
        };
      case "pending":
        return { motivo: "", texto: "Na fila, aguardando o envio." };
      default:
        return { motivo: "", texto: "" };
    }
  }

  // E-mail: a denúncia de spam vale mais que o status, porque é ela que
  // suprime o contato dos próximos envios.
  if (send.complainedAt) {
    return {
      motivo: "Marcado como spam",
      texto:
        "O contato marcou o e-mail como spam e foi suprimido dos próximos envios.",
    };
  }
  switch (send.status) {
    case "bounced":
      return send.bounceType === "hard"
        ? {
            motivo: "Endereço inválido",
            texto:
              "O endereço não existe e a devolução é definitiva. Corrija ou remova o contato.",
          }
        : {
            motivo: "Devolução temporária",
            texto:
              "Caixa cheia ou servidor fora do ar no momento — pode voltar a funcionar.",
          };
    case "clicked":
      return { motivo: "", texto: "Clicou em um link do e-mail." };
    case "opened":
      return { motivo: "", texto: "Abriu o e-mail." };
    case "sent":
      return {
        motivo: "",
        texto: "Entregue ao provedor; sem abertura registrada até agora.",
      };
    case "pending":
      return { motivo: "", texto: "Na fila, aguardando o envio." };
    case "failed":
      return {
        motivo: "Falha no envio",
        texto:
          send.errorMessage?.trim() ||
          "O provedor recusou o envio e não detalhou o motivo.",
      };
    default:
      return { motivo: "", texto: "" };
  }
}

const COLUNAS: Record<ExportChannel, string[]> = {
  whatsapp: [
    "Nome",
    "Empresa",
    "Telefone",
    "Status",
    "Motivo",
    "O que aconteceu",
    "Enviado em",
    "Entregue em",
    "Lida em",
    "Respondeu em",
  ],
  sms: [
    "Nome",
    "Empresa",
    "Telefone",
    "Status",
    "Motivo",
    "O que aconteceu",
    "Enviado em",
    "Entregue em",
    "Respondeu em",
  ],
  email: [
    "Nome",
    "Empresa",
    "E-mail",
    "Status",
    "Motivo",
    "O que aconteceu",
    "Enviado em",
    "Aberto em",
    "Clicado em",
  ],
};

/** Cabeçalho e linhas da planilha, na ordem em que os envios chegam. */
export function buildSendExport(
  sends: ExportableSend[],
  channel: ExportChannel
): { headers: string[]; rows: string[][] } {
  const rows = sends.map((send) => {
    const { motivo, texto } = describeSendForExport(send, channel);
    const inicio = [
      send.contactName,
      send.contactCompany ?? "",
      channel === "email"
        ? send.contactEmail
        : send.contactPhone
          ? formatPhone(send.contactPhone)
          : "",
      sendStatusLabel(send.status),
      motivo,
      texto,
      dataParaPlanilha(send.sentAt),
    ];

    if (channel === "whatsapp") {
      return [
        ...inicio,
        dataParaPlanilha(send.deliveredAt),
        dataParaPlanilha(send.readAt),
        dataParaPlanilha(send.repliedAt),
      ];
    }
    if (channel === "sms") {
      return [
        ...inicio,
        dataParaPlanilha(send.deliveredAt),
        dataParaPlanilha(send.repliedAt),
      ];
    }
    return [
      ...inicio,
      dataParaPlanilha(send.openedAt),
      dataParaPlanilha(send.clickedAt),
    ];
  });

  return { headers: COLUNAS[channel], rows };
}

/** Conteúdo pronto do arquivo .csv. */
export function sendsToCsv(
  sends: ExportableSend[],
  channel: ExportChannel
): string {
  const { headers, rows } = buildSendExport(sends, channel);
  return toCsv(headers, rows);
}
