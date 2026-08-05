"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Pause,
  Play,
  Save,
} from "lucide-react";

import { AutomationStatusBadge } from "@/components/status-badge";
import type { WaTemplateOption } from "@/components/campaigns/whatsapp-message-step";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  atualizarConfig,
  inserir,
  mover,
  remover,
  type Destino,
  type StepDraft,
  type TriggerDraft,
} from "@/lib/automations/arvore";
import type { AutomationStatus, AutomationStepType } from "@/lib/db/schema";

import { type Catalogo } from "./labels";
import { StepPanel } from "./step-panel";
import { StepTree, type MetricaDoCartao } from "./step-tree";
import { TriggerEditor } from "./trigger-editor";

// Editor da automação: gatilhos, a árvore do fluxo e o painel do passo.
//
// O que está na tela é um RASCUNHO até salvar. Salvar uma automação em uso
// cria uma versão nova no servidor — quem já está dentro termina pela versão
// em que entrou.

interface Problema {
  stepId?: string;
  mensagem: string;
}

export function AutomationEditor({ automationId }: { automationId: string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<AutomationStatus>("draft");
  const [version, setVersion] = useState(1);
  const [activeRunCount, setActiveRunCount] = useState(0);

  const [triggers, setTriggers] = useState<TriggerDraft[]>([]);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [problems, setProblems] = useState<Problema[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [catalogo, setCatalogo] = useState<Catalogo>({
    lists: [],
    templates: [],
    waTemplates: [],
    etapas: [],
  });
  const [waTemplates, setWaTemplates] = useState<WaTemplateOption[] | null>(null);

  const [metricas, setMetricas] = useState<Map<string, MetricaDoCartao>>(
    new Map()
  );

  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [alterado, setAlterado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await fetch(`/api/automations/${automationId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar a automação.");
      setName(json.name ?? "");
      setDescription(json.description ?? "");
      setStatus(json.status);
      setVersion(json.version ?? 1);
      setActiveRunCount(json.activeRunCount ?? 0);
      setTriggers(json.triggers ?? []);
      setSteps(json.steps ?? []);
      setProblems(json.problems ?? []);
      setAlterado(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCarregando(false);
    }
  }, [automationId]);

  useEffect(() => {
    load();
  }, [load]);

  // Números por passo (fase 5). Chega depois do fluxo, sem segurar a tela: se
  // falhar, o editor continua servindo — só fica sem os contadores.
  const carregarMetricas = useCallback(async () => {
    try {
      const res = await fetch(`/api/automations/${automationId}/metrics`);
      if (!res.ok) return;
      const json = await res.json();
      setMetricas(
        new Map<string, MetricaDoCartao>(
          (json.passos ?? []).map((p: MetricaDoCartao & { stepId: string }) => [
            p.stepId,
            { agora: p.agora, passaram: p.passaram, envios: p.envios },
          ])
        )
      );
    } catch {
      // sem contadores; o resto da tela não depende deles
    }
  }, [automationId]);

  useEffect(() => {
    carregarMetricas();
  }, [carregarMetricas]);

  // Catálogo dos seletores (listas, modelos de e-mail e de WhatsApp).
  useEffect(() => {
    (async () => {
      try {
        const [listas, modelos, wa, etapas] = await Promise.all([
          fetch("/api/lists").then((r) => r.json()),
          fetch("/api/templates").then((r) => r.json()),
          fetch("/api/whatsapp-templates").then((r) => r.json()),
          fetch("/api/leads/etapas").then((r) => r.json()),
        ]);
        setCatalogo({
          lists: Array.isArray(listas) ? listas : [],
          templates: Array.isArray(modelos) ? modelos : [],
          waTemplates: Array.isArray(wa) ? wa : [],
          etapas: Array.isArray(etapas?.etapas) ? etapas.etapas : [],
        });
        setWaTemplates(Array.isArray(wa) ? wa : []);
      } catch {
        // Sem catálogo os seletores ficam vazios; o resto da tela funciona.
        setWaTemplates([]);
      }
    })();
  }, []);

  const problemasPorPasso = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const p of problems) {
      if (!p.stepId) continue;
      mapa.set(p.stepId, [...(mapa.get(p.stepId) ?? []), p.mensagem]);
    }
    return mapa;
  }, [problems]);

  const problemasGerais = problems.filter((p) => !p.stepId);
  const selecionado = steps.find((s) => s.id === selectedId) ?? null;

  function mexeu<T>(valor: T, aplicar: (v: T) => void) {
    aplicar(valor);
    setAlterado(true);
    setAviso("");
    // Os problemas são do último salvamento — mantê-los na tela depois de uma
    // edição faria o aviso contradizer o que o usuário acabou de corrigir.
    // Eles voltam, conferidos pelo servidor, no próximo Salvar.
    setProblems([]);
  }

  async function salvar(): Promise<boolean> {
    setSalvando(true);
    setError("");
    setAviso("");
    try {
      const res = await fetch(`/api/automations/${automationId}/version`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, triggers, steps }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar a automação.");

      // O servidor devolve os passos com os ids definitivos — adotar os dele
      // mantém a tela e o banco falando dos mesmos passos.
      setSteps(json.steps ?? []);
      setSelectedId(null);
      setProblems(json.problems ?? []);
      setAlterado(false);
      if (json.versionCreated) {
        setVersion((v) => v + 1);
        setAviso(
          "Automação em uso: as mudanças entraram como uma versão nova. Quem já está no fluxo termina pela versão em que entrou."
        );
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function mudarStatus(novo: AutomationStatus) {
    setError("");
    // Ativar valida o fluxo no servidor; salvar antes evita ativar uma versão
    // diferente da que está na tela.
    if (alterado && !(await salvar())) return;
    try {
      const res = await fetch(`/api/automations/${automationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novo }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (Array.isArray(json.problems)) setProblems(json.problems);
        throw new Error(json.error ?? "Erro ao mudar o status.");
      }
      setStatus(json.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (carregando) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Carregando automação...
      </p>
    );
  }

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/automations">
            <ArrowLeft />
            Automações
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-64 flex-1">
            <Input
              value={name}
              onChange={(e) => mexeu(e.target.value, setName)}
              placeholder="Nome da automação"
              className="h-auto border-0 bg-transparent px-0 text-2xl font-bold tracking-tight focus:ring-0"
            />
            <Input
              value={description}
              onChange={(e) => mexeu(e.target.value, setDescription)}
              placeholder="Descrição (opcional)"
              className="h-auto border-0 bg-transparent px-0 text-sm text-muted-foreground focus:ring-0"
            />
          </div>

          {/* flex-wrap: com o botão do relatório, a fileira não cabe em 375px
              e empurrava a página inteira para o lado. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <AutomationStatusBadge status={status} />
            <span className="text-xs text-muted-foreground">v{version}</span>
            <Button variant="ghost" asChild>
              <Link href={`/automations/${automationId}/report`}>
                <BarChart3 />
                Relatório
              </Link>
            </Button>
            <Button variant="outline" onClick={salvar} disabled={salvando}>
              <Save />
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
            {status === "active" ? (
              <Button variant="secondary" onClick={() => mudarStatus("paused")}>
                <Pause />
                Pausar
              </Button>
            ) : (
              <Button onClick={() => mudarStatus("active")}>
                <Play />
                Ativar
              </Button>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      {aviso ? (
        <div className="mb-4 rounded-lg border border-info-dark/30 bg-info-light/20 px-4 py-3 text-sm text-info-dark">
          {aviso}
        </div>
      ) : null}

      {status === "active" && activeRunCount > 0 ? (
        <div className="mb-4 rounded-lg border border-warning-dark/30 bg-warning-light/30 px-4 py-3 text-sm text-warning-dark">
          {activeRunCount} contato(s) estão percorrendo esta automação agora.
          Salvar cria uma versão nova; eles terminam pela versão em que entraram.
        </div>
      ) : null}

      {problemasGerais.length > 0 ? (
        <div className="mb-4 grid gap-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {problemasGerais.map((p, i) => (
            <p key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {p.mensagem}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="grid gap-6">
          <Card>
            <CardContent className="grid gap-4 p-5">
              <div>
                <Label className="text-sm font-semibold">Gatilhos</Label>
                <p className="text-xs text-muted-foreground">
                  O que faz um contato entrar no fluxo.
                </p>
              </div>
              <TriggerEditor
                triggers={triggers}
                catalogo={catalogo}
                onChange={(t) => mexeu(t, setTriggers)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <StepTree
                steps={steps}
                selectedId={selectedId}
                problemas={problemasPorPasso}
                metricas={metricas}
                catalogo={catalogo}
                onSelect={setSelectedId}
                onInsert={(destino: Destino, tipo: AutomationStepType) => {
                  const { steps: novos, novo, herdados } = inserir(
                    steps,
                    destino,
                    tipo
                  );
                  mexeu(novos, setSteps);
                  setSelectedId(novo.id);
                  if (herdados > 0) {
                    setAviso(
                      `Como nada roda depois de um Se/Então, ${herdados === 1 ? "o passo que estava" : `os ${herdados} passos que estavam`} abaixo dele ${herdados === 1 ? "foi" : "foram"} para o lado "Sim". Arraste para o "Não" o que precisar mudar de lado.`
                    );
                  }
                }}
                onRemove={(id) => {
                  mexeu(remover(steps, id), setSteps);
                  if (selectedId === id) setSelectedId(null);
                }}
                onMove={(id, destino) => mexeu(mover(steps, id, destino), setSteps)}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="lg:sticky lg:top-6">
          <CardContent className="p-5">
            <StepPanel
              step={selecionado}
              catalogo={catalogo}
              waTemplates={waTemplates}
              problemas={
                selecionado ? (problemasPorPasso.get(selecionado.id) ?? []) : []
              }
              onChange={(config) =>
                selecionado
                  ? mexeu(atualizarConfig(steps, selecionado.id, config), setSteps)
                  : undefined
              }
            />
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        {alterado
          ? "Há mudanças não salvas — o fluxo em execução ainda é o salvo."
          : "Tudo salvo."}
      </p>
    </>
  );
}
