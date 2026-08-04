"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gauge } from "lucide-react";

import { faixaInfo } from "@/components/leads/estagios";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

interface Linha {
  tipo: string;
  descricao: string;
  quando: string;
  pontosOriginais: number;
  pontosHoje: number;
}

interface Conta {
  score: number;
  faixa: string;
  linhas: Linha[];
  config: { meiaVidaDias: number };
}

/**
 * A pontuação com a conta ABERTA — *por que* este lead tem os pontos que tem.
 *
 * Um número sem explicação não muda o comportamento de ninguém: ou é aceito
 * cegamente, ou ignorado. Mostrar cada ação, o que ela valia e o que o tempo já
 * corroeu é o que faz o modelo ser discutido — e ajustado na tela de Pontuação.
 */
export function LeadScoreCard({ leadId }: { leadId: string }) {
  const [conta, setConta] = useState<Conta | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/score`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao calcular.");
        setConta(json);
      } catch (err) {
        setErro(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [leadId]);

  const faixa = conta ? faixaInfo(conta.faixa) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" />
          Pontuação
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : conta === null ? (
          <p className="text-sm text-muted-foreground">Calculando...</p>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold tabular-nums">
                {conta.score}
              </span>
              {faixa ? (
                <Badge variant={faixa.variante}>{faixa.rotulo}</Badge>
              ) : null}
            </div>

            {conta.linhas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma ação pontuada ainda.
              </p>
            ) : (
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Ação</span>
                  <span>Valia → vale hoje</span>
                </div>
                <ul className="grid max-h-72 gap-2 overflow-y-auto">
                  {conta.linhas.map((l, i) => (
                    <li
                      key={`${l.tipo}-${l.quando}-${i}`}
                      className="flex items-start justify-between gap-3 border-b border-border pb-2 text-sm last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate">{l.descricao}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(l.quando)}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums">
                        <span className="text-muted-foreground">
                          {l.pontosOriginais > 0 ? "+" : ""}
                          {l.pontosOriginais}
                        </span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-medium">
                          {l.pontosHoje > 0 ? "+" : ""}
                          {l.pontosHoje}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Cada ação perde metade do valor a cada {conta.config.meiaVidaDias}{" "}
              dias, para a nota refletir interesse atual.{" "}
              <Link href="/leads/pontuacao" className="underline">
                Ajustar o modelo
              </Link>
              .
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
