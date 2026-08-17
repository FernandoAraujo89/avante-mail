import { describe, expect, it } from "vitest";

import {
  buildSendExport,
  describeSendForExport,
  sendsToCsv,
  type ExportableSend,
} from "./send-export";

// Esta planilha sai do sistema e vai para o time de sucesso do cliente, que
// liga para quem não recebeu. Dois compromissos, portanto: nenhum código de
// provedor pode vazar para a coluna (131026 não diz nada a quem vai ligar) e
// toda linha tem de dizer o que fazer a respeito.

function envio(over: Partial<ExportableSend> = {}): ExportableSend {
  return {
    status: "delivered",
    sentAt: "2026-08-17T18:14:00.000Z",
    openedAt: null,
    clickedAt: null,
    deliveredAt: "2026-08-17T18:14:30.000Z",
    readAt: null,
    repliedAt: null,
    complainedAt: null,
    bounceType: null,
    errorCode: null,
    errorMessage: null,
    contactName: "Poliana Brandão",
    contactEmail: "poliana@exemplo.com.br",
    contactPhone: "+5571996642930",
    contactCompany: "Mercado Bom Preço",
    ...over,
  };
}

describe("describeSendForExport", () => {
  it("traduz o número sem WhatsApp em motivo e ação", () => {
    const { motivo, texto } = describeSendForExport(
      envio({ status: "failed", errorCode: "131026" }),
      "whatsapp"
    );
    expect(motivo).toBe("Número não recebe");
    expect(texto).toContain("Confira o telefone");
    expect(texto).not.toContain("131026");
  });

  it("separa o limite de frequência, que não é problema de cadastro", () => {
    const { motivo, texto } = describeSendForExport(
      envio({ status: "failed", errorCode: "131049" }),
      "whatsapp"
    );
    expect(motivo).toBe("Limite do destinatário");
    expect(texto).toContain("reenvie mais tarde");
  });

  it("não inventa motivo para quem recebeu", () => {
    expect(describeSendForExport(envio(), "whatsapp")).toEqual({
      motivo: "",
      texto: "Entregue no aparelho do contato.",
    });
  });

  it("usa o vocabulário do SMS nos códigos da operadora", () => {
    expect(
      describeSendForExport(
        envio({ status: "failed", errorCode: "21614" }),
        "sms"
      ).motivo
    ).toBe("Número não recebe SMS");
    expect(
      describeSendForExport(
        envio({ status: "failed", errorCode: "21610" }),
        "sms"
      ).motivo
    ).toBe("Pediu para sair");
  });

  it("no e-mail, a denúncia de spam vale mais que o status", () => {
    const { motivo } = describeSendForExport(
      envio({ status: "sent", complainedAt: "2026-08-17T19:00:00.000Z" }),
      "email"
    );
    expect(motivo).toBe("Marcado como spam");
  });

  it("distingue devolução definitiva de temporária", () => {
    expect(
      describeSendForExport(
        envio({ status: "bounced", bounceType: "hard" }),
        "email"
      ).motivo
    ).toBe("Endereço inválido");
    expect(
      describeSendForExport(
        envio({ status: "bounced", bounceType: "soft" }),
        "email"
      ).motivo
    ).toBe("Devolução temporária");
  });

  it("repassa o texto da operadora quando o código é desconhecido", () => {
    const { motivo, texto } = describeSendForExport(
      envio({
        status: "failed",
        errorCode: "30007",
        errorMessage: "Mensagem filtrada pela operadora",
      }),
      "sms"
    );
    expect(motivo).toBe("Falha no envio");
    expect(texto).toBe("Mensagem filtrada pela operadora");
  });
});

describe("buildSendExport", () => {
  it("gera uma coluna para cada cabeçalho, em todos os canais", () => {
    for (const canal of ["whatsapp", "sms", "email"] as const) {
      const { headers, rows } = buildSendExport([envio()], canal);
      expect(rows[0]).toHaveLength(headers.length);
    }
  });

  it("põe telefone legível e data que a planilha entende", () => {
    const { headers, rows } = buildSendExport(
      [envio({ status: "read", readAt: "2026-08-17T18:19:00.000Z" })],
      "whatsapp"
    );
    const linha = rows[0];
    expect(linha[headers.indexOf("Telefone")]).toBe("+55 71 99664 2930");
    // Sem a vírgula do "17/08/2026, 15:14": com ela o Excel não reconhece data.
    expect(linha[headers.indexOf("Enviado em")]).toBe("17/08/2026 15:14");
    expect(linha[headers.indexOf("Lida em")]).toBe("17/08/2026 15:19");
  });

  it("deixa vazia a data que não aconteceu, em vez de travessão", () => {
    const { headers, rows } = buildSendExport([envio()], "whatsapp");
    expect(rows[0][headers.indexOf("Respondeu em")]).toBe("");
  });

  it("usa e-mail em vez de telefone no canal de e-mail", () => {
    const { headers, rows } = buildSendExport([envio()], "email");
    expect(headers).toContain("E-mail");
    expect(headers).not.toContain("Telefone");
    expect(rows[0][headers.indexOf("E-mail")]).toBe("poliana@exemplo.com.br");
  });
});

describe("sendsToCsv", () => {
  it("não deixa código de provedor chegar na planilha", () => {
    const csv = sendsToCsv(
      [
        envio({ status: "failed", errorCode: "131026" }),
        envio({ status: "failed", errorCode: "131049" }),
      ],
      "whatsapp"
    );
    expect(csv).not.toContain("131026");
    expect(csv).not.toContain("131049");
    expect(csv).toContain("Número não recebe");
  });

  it("mantém uma linha por envio, além do cabeçalho", () => {
    const csv = sendsToCsv([envio(), envio(), envio()], "whatsapp");
    expect(csv.trimEnd().split("\r\n")).toHaveLength(4);
  });
});
