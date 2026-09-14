import { describe, expect, it } from "vitest";

import { replyBreakdown, replyOf, type ReplySend } from "./replies";
import type { WhatsAppButton } from "./types";

const BUTTONS: WhatsAppButton[] = [
  { type: "QUICK_REPLY", text: "Sim, vou participar" },
  { type: "QUICK_REPLY", text: "Não poderei participar" },
  { type: "URL", text: "Ver agenda", url: "https://exemplo.com" },
];

function send(overrides: Partial<ReplySend> = {}): ReplySend {
  return {
    status: "delivered",
    deliveredAt: "2026-09-15T12:00:00Z",
    repliedAt: null,
    replyButton: null,
    ...overrides,
  };
}

describe("replyOf", () => {
  it("o botão vale mais que o texto escrito", () => {
    expect(
      replyOf(send({ repliedAt: "2026-09-15T12:01:00Z", replyButton: "Sim, vou participar" }))
    ).toEqual({ kind: "button", text: "Sim, vou participar" });
  });

  it("respondeu sem botão é resposta por texto", () => {
    expect(replyOf(send({ repliedAt: "2026-09-15T12:01:00Z" }))).toEqual({
      kind: "text",
    });
  });

  it("sem resposta", () => {
    expect(replyOf(send())).toEqual({ kind: "none" });
  });
});

describe("replyBreakdown", () => {
  it("conta cada botão na ordem do modelo, inclusive o que ninguém tocou", () => {
    const result = replyBreakdown(
      [
        send({ replyButton: "Sim, vou participar", repliedAt: "x" }),
        send({ replyButton: "Sim, vou participar", repliedAt: "x" }),
        send({ repliedAt: "x" }),
        send(),
        send({ status: "failed", deliveredAt: null }),
      ],
      BUTTONS
    );
    expect(result.buttons).toEqual([
      { text: "Sim, vou participar", count: 2, inTemplate: true },
      { text: "Não poderei participar", count: 0, inTemplate: true },
    ]);
    expect(result).toMatchObject({ textOnly: 1, replied: 3, reached: 4, noReply: 1 });
  });

  it("botão que não existe mais no modelo continua na conta", () => {
    const result = replyBreakdown(
      [send({ replyButton: "Talvez", repliedAt: "x" })],
      BUTTONS
    );
    expect(result.buttons.at(-1)).toEqual({
      text: "Talvez",
      count: 1,
      inTemplate: false,
    });
  });

  it("quem respondeu recebeu, mesmo sem a confirmação de entrega", () => {
    const result = replyBreakdown(
      [send({ status: "sent", deliveredAt: null, replyButton: "Sim, vou participar" })],
      BUTTONS
    );
    expect(result.reached).toBe(1);
    expect(result.noReply).toBe(0);
  });

  it("modelo sem botões apura só texto e silêncio", () => {
    const result = replyBreakdown([send({ repliedAt: "x" }), send()], null);
    expect(result.buttons).toEqual([]);
    expect(result).toMatchObject({ textOnly: 1, noReply: 1 });
  });
});
