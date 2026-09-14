import { describe, expect, it } from "vitest";

import {
  attributionStrategy,
  messagePreview,
  parseInboundMessage,
  phoneCandidatesFromWaId,
  serviceWindow,
  SERVICE_WINDOW_MS,
  shouldEmitRepliedEvent,
} from "./inbound";

const base = { from: "5531995650622", id: "wamid.X", timestamp: "1789400000" };

describe("parseInboundMessage", () => {
  it("lê o toque no botão de modelo com a citação do envio", () => {
    const parsed = parseInboundMessage({
      ...base,
      type: "button",
      context: { from: "553799472264", id: "wamid.MODELO" },
      button: { text: "Sim, vou participar", payload: "Sim, vou participar" },
    });
    expect(parsed).toMatchObject({
      type: "button",
      body: "Sim, vou participar",
      isButtonReply: true,
      isReaction: false,
      contextWamid: "wamid.MODELO",
    });
    expect(parsed?.at.toISOString()).toBe(new Date(1789400000 * 1000).toISOString());
  });

  it("lê texto, sem citação", () => {
    const parsed = parseInboundMessage({
      ...base,
      type: "text",
      text: { body: "  Vou sim!  " },
    });
    expect(parsed).toMatchObject({
      body: "Vou sim!",
      isButtonReply: false,
      contextWamid: null,
    });
  });

  it("lê a mídia com legenda e nome do arquivo", () => {
    const parsed = parseInboundMessage({
      ...base,
      type: "document",
      document: {
        id: "MEDIA1",
        mime_type: "application/pdf",
        filename: "contrato.pdf",
        caption: "segue",
      },
    });
    expect(parsed?.media).toEqual({
      id: "MEDIA1",
      mimeType: "application/pdf",
      filename: "contrato.pdf",
    });
    expect(parsed?.body).toBe("segue");
  });

  it("áudio sem legenda fica sem texto", () => {
    const parsed = parseInboundMessage({
      ...base,
      type: "audio",
      audio: { id: "MEDIA2", mime_type: "audio/ogg; codecs=opus" },
    });
    expect(parsed?.body).toBeNull();
    expect(parsed?.media?.id).toBe("MEDIA2");
  });

  it("a reação aponta a mensagem reagida e não é resposta", () => {
    const parsed = parseInboundMessage({
      ...base,
      type: "reaction",
      reaction: { message_id: "wamid.MODELO", emoji: "👍" },
    });
    expect(parsed).toMatchObject({
      isReaction: true,
      isButtonReply: false,
      body: "👍",
      contextWamid: "wamid.MODELO",
    });
  });

  it("sem remetente ou sem id não há o que gravar", () => {
    expect(parseInboundMessage({ id: "wamid.X", type: "text" })).toBeNull();
    expect(parseInboundMessage({ from: "5531995650622", type: "text" })).toBeNull();
  });

  it("tipo desconhecido vira unsupported, sem quebrar", () => {
    expect(parseInboundMessage({ from: "55", id: "w" })?.type).toBe("unsupported");
  });
});

describe("messagePreview", () => {
  it("texto e botão aparecem como escritos", () => {
    expect(messagePreview({ type: "text", body: "Oi" })).toBe("Oi");
    expect(messagePreview({ type: "button", body: "Não poderei ir" })).toBe(
      "Não poderei ir"
    );
  });

  it("mídia ganha rótulo, com a legenda quando houver", () => {
    expect(messagePreview({ type: "audio", body: null })).toBe("🎤 Áudio");
    expect(messagePreview({ type: "image", body: "print" })).toBe("📷 Foto: print");
  });

  it("reação retirada tem texto próprio", () => {
    expect(messagePreview({ type: "reaction", body: "👍" })).toBe("Reagiu 👍");
    expect(messagePreview({ type: "reaction", body: null })).toBe("Retirou a reação");
  });
});

describe("serviceWindow", () => {
  const now = new Date("2026-09-15T12:00:00Z");

  it("sem mensagem do contato, fechada", () => {
    expect(serviceWindow(null, now)).toEqual({ open: false, closesAt: null });
  });

  it("aberta até 24h depois da última mensagem do contato", () => {
    const w = serviceWindow(new Date("2026-09-14T12:00:01Z"), now);
    expect(w.open).toBe(true);
    expect(w.closesAt?.toISOString()).toBe("2026-09-15T12:00:01.000Z");
  });

  it("fecha no instante exato das 24h", () => {
    expect(serviceWindow(new Date("2026-09-14T12:00:00Z"), now).open).toBe(false);
  });
});

describe("attributionStrategy", () => {
  it("com citação procura só o envio citado", () => {
    expect(attributionStrategy({ contextWamid: "wamid.X", isReaction: false })).toBe(
      "context"
    );
  });

  it("sem citação procura o envio recente", () => {
    expect(attributionStrategy({ contextWamid: null, isReaction: false })).toBe(
      "recent"
    );
  });

  it("reação não responde a envio nenhum", () => {
    expect(attributionStrategy({ contextWamid: "wamid.X", isReaction: true })).toBe(
      "none"
    );
  });
});

describe("shouldEmitRepliedEvent", () => {
  const at = new Date("2026-09-15T12:00:00Z");
  const minutesAgo = (m: number) => new Date(at.getTime() - m * 60_000);

  it("toque em botão sempre vira evento", () => {
    expect(
      shouldEmitRepliedEvent({
        isButtonReply: true,
        firstReplyToSend: false,
        previousInboundAt: minutesAgo(1),
        at,
      })
    ).toBe(true);
  });

  it("a primeira resposta a um envio vira evento", () => {
    expect(
      shouldEmitRepliedEvent({
        isButtonReply: false,
        firstReplyToSend: true,
        previousInboundAt: minutesAgo(1),
        at,
      })
    ).toBe(true);
  });

  it("a conversa em andamento não gera um evento por mensagem", () => {
    expect(
      shouldEmitRepliedEvent({
        isButtonReply: false,
        firstReplyToSend: false,
        previousInboundAt: minutesAgo(5),
        at,
      })
    ).toBe(false);
  });

  it("voltar depois da janela fechada é sinal novo", () => {
    expect(
      shouldEmitRepliedEvent({
        isButtonReply: false,
        firstReplyToSend: false,
        previousInboundAt: new Date(at.getTime() - SERVICE_WINDOW_MS),
        at,
      })
    ).toBe(true);
  });
});

describe("phoneCandidatesFromWaId", () => {
  it("celular do Brasil sem o nono dígito também procura com ele", () => {
    expect(phoneCandidatesFromWaId("553195650622")).toEqual([
      "+553195650622",
      "+5531995650622",
    ]);
  });

  it("celular com o nono dígito também procura sem ele", () => {
    expect(phoneCandidatesFromWaId("5531995650622")).toEqual([
      "+5531995650622",
      "+553195650622",
    ]);
  });

  it("fixo do Brasil (começa com 2 a 5) não ganha nono dígito", () => {
    expect(phoneCandidatesFromWaId("554833334444")).toEqual(["+554833334444"]);
  });

  it("número de fora do Brasil fica como veio", () => {
    expect(phoneCandidatesFromWaId("14155550123")).toEqual(["+14155550123"]);
  });

  it("vazio não procura nada", () => {
    expect(phoneCandidatesFromWaId("")).toEqual([]);
  });
});
