"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Regra {
  id: string;
  eventType: string;
  points: number;
  active: boolean;
  description: string | null;
}

interface Config {
  meiaVidaDias: number;
  faixaMorno: number;
  faixaAquecido: number;
  faixaQuente: number;
}

export default function PontuacaoPage() {
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch("/api/leads/pontuacao");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar o modelo.");
      setRegras(json.regras);
      setConfig(json.config);
    } catch (err) {
      setRegras([]);
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar() {
    if (!config) return;
    setSalvando(true);
    setErro("");
    setAviso("");
    try {
      const res = await fetch("/api/leads/pontuacao", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regras, config }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar.");
      setRegras(json.regras);
      setConfig(json.config);
      setAviso(
        `Modelo salvo e ${json.recalculados} lead${
          json.recalculados === 1 ? "" : "s"
        } repontuado${json.recalculados === 1 ? "" : "s"}.`
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  // Por ID, não por tipo: desde a fase E duas regras dividem o mesmo
  // `event_type` ("viu preços" e "pediu demonstração" são ambas `site_event`),
  // e chavear por tipo faria as duas mudarem juntas.
  function mudarRegra(id: string, patch: Partial<Regra>) {
    setRegras((atual) =>
      (atual ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/leads">
            <ArrowLeft />
            Voltar para leads
          </Link>
        </Button>
        <PageHeader
          title="Pontuação dos leads"
          description="Quanto vale cada ponto de contato e quando um lead vira “quente”. Mudar aqui recalcula todo o histórico na hora."
        >
          <Button onClick={salvar} disabled={salvando || !config}>
            <Save />
            {salvando ? "Salvando e recalculando..." : "Salvar"}
          </Button>
        </PageHeader>
      </div>

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}
      {aviso ? (
        <div className="mb-4 rounded-lg border border-success-dark/30 bg-success-light/20 px-4 py-3 text-sm text-success-dark">
          {aviso}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Quanto vale cada ação</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {regras === null ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : (
              regras.map((regra) => (
                <div
                  key={regra.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
                >
                  <label className="flex min-w-48 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={regra.active}
                      onChange={(e) =>
                        mudarRegra(regra.id, { active: e.target.checked })
                      }
                      className="size-4 accent-[#1D50DC]"
                    />
                    <span className="text-sm">
                      {regra.description ?? regra.eventType}
                      {regra.eventType.startsWith("site_") ? (
                        <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs text-primary">
                          site
                        </span>
                      ) : null}
                      {!regra.active ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (fora da conta)
                        </span>
                      ) : null}
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={regra.points}
                      onChange={(e) =>
                        mudarRegra(regra.id, {
                          points: Number(e.target.value),
                        })
                      }
                      className="h-9 w-24 text-right tabular-nums"
                      aria-label={`Pontos de ${regra.description ?? regra.eventType}`}
                    />
                    <span className="w-14 text-xs text-muted-foreground">
                      pontos
                    </span>
                  </div>
                </div>
              ))
            )}
            <p className="text-xs text-muted-foreground">
              Valores negativos afastam o lead do topo — é o caso do
              descadastro. Desmarcar tira a ação da conta sem perder o número
              que estava ali.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Faixas</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="faixa-morno">Morno a partir de</Label>
                <Input
                  id="faixa-morno"
                  type="number"
                  value={config?.faixaMorno ?? ""}
                  onChange={(e) =>
                    setConfig((c) =>
                      c ? { ...c, faixaMorno: Number(e.target.value) } : c
                    )
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="faixa-aquecido">Aquecido a partir de</Label>
                <Input
                  id="faixa-aquecido"
                  type="number"
                  value={config?.faixaAquecido ?? ""}
                  onChange={(e) =>
                    setConfig((c) =>
                      c ? { ...c, faixaAquecido: Number(e.target.value) } : c
                    )
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="faixa-quente">Quente a partir de</Label>
                <Input
                  id="faixa-quente"
                  type="number"
                  value={config?.faixaQuente ?? ""}
                  onChange={(e) =>
                    setConfig((c) =>
                      c ? { ...c, faixaQuente: Number(e.target.value) } : c
                    )
                  }
                />
              </div>
              {config ? (
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">Frio</Badge>
                  {`abaixo de ${config.faixaMorno}`}
                  <Badge variant="info">Morno</Badge>
                  {`${config.faixaMorno} a ${config.faixaAquecido - 1}`}
                  <Badge variant="warning">Aquecido</Badge>
                  {`${config.faixaAquecido} a ${config.faixaQuente - 1}`}
                  <Badge variant="destructive">Quente</Badge>
                  {`${config.faixaQuente} ou mais`}
                </p>
              ) : null}
              {/* "Quente" é o topo da régua: é ele que enche a barra de calor e
                  é dele que sai a decisão de mandar ao comercial. */}
              <p className="text-xs text-muted-foreground">
                “Quente” é o topo da escala — é onde a barra de calor enche.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Decaimento</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="meia-vida">Meia-vida (dias)</Label>
                <Input
                  id="meia-vida"
                  type="number"
                  min={1}
                  value={config?.meiaVidaDias ?? ""}
                  onChange={(e) =>
                    setConfig((c) =>
                      c ? { ...c, meiaVidaDias: Number(e.target.value) } : c
                    )
                  }
                />
              </div>
              {/* Sem decaimento todo lead antigo vira "quente" e o número perde
                  sentido: quem abriu dez e-mails há um ano ficaria na frente de
                  quem pediu demonstração ontem. */}
              <p className="text-xs text-muted-foreground">
                Cada ação vale metade dos pontos a cada{" "}
                {config?.meiaVidaDias ?? 30} dias. Um clique de 5 pontos hoje
                vale 2,5 daqui a {config?.meiaVidaDias ?? 30} dias e 1,25 daqui
                a {(config?.meiaVidaDias ?? 30) * 2}. É o que faz a pontuação
                refletir interesse <span className="font-medium">atual</span>, e
                não histórico acumulado.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
