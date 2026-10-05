"use client";

import { useMemo, useRef, useState } from "react";
import { ListFilter, MessageSquareReply } from "lucide-react";

import {
  SendsTable,
  type SendTableRow,
} from "@/components/reports/sends-table";
import { Card } from "@/components/ui/card";
import { formatInt, formatPercent } from "@/lib/format";
import type { LinhasPorPagina } from "@/lib/paginacao";
import { REPLY_GROUP, replyBreakdown } from "@/lib/whatsapp/replies";
import type { WhatsAppButton } from "@/lib/whatsapp/types";
import { cn } from "@/lib/utils";

const TODOS = "todos";

interface Row {
  key: string;
  label: string;
  hint?: string;
  count: number;
  filter: string;
  /** Resposta (cor da marca) ou contexto (cinza): a forma de ênfase. */
  tone: "answer" | "context";
}

/**
 * Apuração das respostas de uma campanha de WhatsApp — quantos tocaram cada
 * botão do modelo, quantos escreveram, quantos ficaram em silêncio — com a
 * tabela de envios logo abaixo. Clicar numa linha filtra a tabela por aquela
 * resposta, e a exportação leva exatamente esse recorte: é o caminho de
 * "quem confirmou presença?" até a planilha.
 *
 * Barras de uma cor só, medidas contra quem RECEBEU: a pergunta é quanto de
 * cada resposta, não qual resposta é qual — cor por categoria faria o leitor
 * procurar uma legenda que não diz nada. O cinza marca o que é contexto.
 */
export function WhatsAppReplies({
  campaignId,
  sends,
  templateButtons,
  nomeDoDisparo,
  linhasIniciais,
}: {
  campaignId: string;
  sends: SendTableRow[];
  templateButtons: WhatsAppButton[] | null;
  nomeDoDisparo: string;
  linhasIniciais?: LinhasPorPagina;
}) {
  const [filtro, setFiltro] = useState(TODOS);
  const tableRef = useRef<HTMLDivElement>(null);

  const breakdown = useMemo(
    () =>
      replyBreakdown(
        sends.map((s) => ({
          status: s.status,
          deliveredAt: s.deliveredAt,
          repliedAt: s.repliedAt,
          replyButton: s.replyButton ?? null,
        })),
        templateButtons
      ),
    [sends, templateButtons]
  );

  const hasButtons = breakdown.buttons.length > 0;
  const rows: Row[] = [
    ...breakdown.buttons.map((b) => ({
      key: `botao:${b.text}`,
      label: b.text,
      hint: b.inTemplate ? undefined : "botão que não está mais no modelo",
      count: b.count,
      filter: REPLY_GROUP.button(b.text),
      tone: "answer" as const,
    })),
    {
      key: "texto",
      // "Mensagem" e não "escrevendo": áudio, foto e documento contam aqui.
      label: hasButtons ? "Responderam com mensagem, sem botão" : "Responderam com mensagem",
      count: breakdown.textOnly,
      filter: REPLY_GROUP.text,
      tone: "answer",
    },
    {
      key: "nenhuma",
      label: "Receberam e não responderam",
      count: breakdown.noReply,
      filter: REPLY_GROUP.none,
      tone: "context",
    },
  ];

  function applyFilter(value: string) {
    const next = filtro === value ? TODOS : value;
    setFiltro(next);
    if (next !== TODOS) {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <>
      <Card className="mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <MessageSquareReply className="size-4 text-primary" aria-hidden="true" />
              {hasButtons ? "Respostas aos botões" : "Respostas"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {breakdown.reached === 0
                ? "Ninguém recebeu a mensagem ainda — as respostas aparecem aqui assim que chegarem."
                : `De ${formatInt(breakdown.reached)} contato(s) que receberam, ${formatInt(
                    breakdown.replied
                  )} responderam (${formatPercent(breakdown.replied, breakdown.reached)}).`}
            </p>
          </div>
          {breakdown.reached > 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ListFilter className="size-3.5" aria-hidden="true" />
              Clique numa resposta para ver quem respondeu e mandar uma
              campanha só para esse grupo
            </p>
          ) : null}
        </div>

        {breakdown.reached > 0 ? (
          <ul className="mt-5 grid gap-1">
            {rows.map((row) => {
              const share = breakdown.reached > 0 ? row.count / breakdown.reached : 0;
              const active = filtro === row.filter;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => applyFilter(row.filter)}
                    disabled={row.count === 0}
                    aria-pressed={active}
                    title={`${formatInt(row.count)} de ${formatInt(
                      breakdown.reached
                    )} que receberam — ${active ? "clique para limpar o filtro" : "clique para filtrar a tabela"}`}
                    className={cn(
                      "grid w-full gap-1.5 rounded-lg px-3 py-2.5 text-left transition-colors disabled:cursor-default",
                      active ? "bg-accent ring-1 ring-primary/40" : "hover:bg-muted disabled:hover:bg-transparent"
                    )}
                  >
                    <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                      <span className="min-w-0 text-sm font-medium">
                        <span className="break-words">{row.label}</span>
                        {row.hint ? (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            ({row.hint})
                          </span>
                        ) : null}
                      </span>
                      <span className="ml-auto shrink-0 text-sm">
                        <span className="font-semibold tabular-nums">{formatInt(row.count)}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                          {formatPercent(row.count, breakdown.reached)}
                        </span>
                      </span>
                    </span>
                    {/* Trilho num tom claro da mesma rampa; ponta arredondada só
                        do lado do dado, reta na base. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "block h-2.5 w-full overflow-hidden rounded-r-[4px]",
                        row.tone === "answer" ? "bg-accent" : "bg-secondary"
                      )}
                    >
                      <span
                        className={cn(
                          "block h-full rounded-r-[4px]",
                          row.tone === "answer" ? "bg-primary" : "bg-muted-foreground"
                        )}
                        style={{ width: `${Math.min(100, share * 100)}%` }}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>

      <div ref={tableRef} className="scroll-mt-4">
        <Card className="mt-6">
          <SendsTable
            sends={sends}
            channel="whatsapp"
            nomeDoDisparo={nomeDoDisparo}
            campaignId={campaignId}
            vazio="Nenhum envio registrado para esta campanha."
            filtro={filtro}
            onFiltroChange={setFiltro}
            linhasIniciais={linhasIniciais}
          />
        </Card>
      </div>
    </>
  );
}
