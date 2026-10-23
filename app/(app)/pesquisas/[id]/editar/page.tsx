"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Eye, Save, Undo2 } from "lucide-react";

import {
  EditorPergunta,
  type PerguntaLocal,
} from "@/components/pesquisas/editor-pergunta";
import {
  FormularioPesquisa,
  type Respostas,
} from "@/components/pesquisas/formulario-pesquisa";
import { ChipsDeTipo } from "@/components/pesquisas/tipo-de-pergunta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SurveyAnswerValue, SurveyQuestionType, SurveyStatus } from "@/lib/db/schema";
import { formatTime } from "@/lib/format";
import { assuntoPadrao, corpoPadrao } from "@/lib/pesquisas/mensagens";
import { opcoesPadrao, problemaDaPergunta } from "@/lib/pesquisas/perguntas";
import { progresso } from "@/lib/pesquisas/respostas";
import {
  OBJETIVO_LABEL,
  STATUS_LABEL,
  type PesquisaDto,
} from "@/lib/pesquisas/rotulos";
import { modeloTemLinkDinamico } from "@/lib/pesquisas/whatsapp";
import {
  extractVariables,
  type WhatsAppButton,
  type WhatsAppTemplateStatus,
  type WhatsAppVariableMap,
  type WhatsAppVariableSource,
} from "@/lib/whatsapp/types";
import { cn } from "@/lib/utils";

// O construtor da pesquisa. Três abas (perguntas, textos, convite) para a
// tela mostrar só o que se está fazendo; a lista de perguntas em linhas que
// abrem para editar; a barra fixa diz o estado (salvo / não salvo / com
// problema) e guarda a única ação primária. Remover tem "desfazer";
// arquivar e descartar pedem confirmação. Ctrl/Cmd+S salva.

const STATUS_VARIANT: Record<SurveyStatus, "secondary" | "success" | "warning"> = {
  draft: "secondary",
  active: "success",
  closed: "warning",
};

type Aba = "perguntas" | "textos" | "convite";

type ModeloDto = {
  id: string;
  name: string;
  status: WhatsAppTemplateStatus;
  bodyText: string;
  buttons: WhatsAppButton[] | null;
};

const SEM_MODELO = "__nenhum__";
const DESFAZER_MS = 8000;

function chaveNova(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `nova-${Date.now()}-${Math.random()}`;
}

function paraLocal(p: PesquisaDto): PerguntaLocal[] {
  return p.questions.map((q) => ({
    chave: q.id,
    id: q.id,
    type: q.type,
    label: q.label,
    help: q.help ?? "",
    required: q.required,
    options: q.options,
    isNps: q.isNps,
    answerCount: q.answerCount,
  }));
}

/** O que vai para a API, sem a chave local. */
function paraEnvio(perguntas: PerguntaLocal[]) {
  return perguntas.map((p) => ({
    id: p.id,
    type: p.type,
    label: p.label,
    help: p.help,
    required: p.required,
    options: p.options,
    isNps: p.isNps,
  }));
}

export default function EditarPesquisaPage() {
  const { id } = useParams<{ id: string }>();

  const [pesquisa, setPesquisa] = useState<PesquisaDto | null>(null);
  const [erro, setErro] = useState("");
  const [salvoEm, setSalvoEm] = useState<Date | null>(null);
  const [aba, setAba] = useState<Aba>("perguntas");

  const [nome, setNome] = useState("");
  const [intro, setIntro] = useState("");
  const [agradecimento, setAgradecimento] = useState("");
  const [assuntoEmail, setAssuntoEmail] = useState("");
  const [corpoEmail, setCorpoEmail] = useState("");
  const [modelos, setModelos] = useState<ModeloDto[]>([]);
  const [modeloId, setModeloId] = useState<string>(SEM_MODELO);
  const [variaveis, setVariaveis] = useState<WhatsAppVariableMap>({});
  const [perguntas, setPerguntas] = useState<PerguntaLocal[]>([]);
  const [salvando, setSalvando] = useState(false);

  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [focar, setFocar] = useState<string | null>(null);
  /** Seções com as perguntas escondidas (a barra minimizada). */
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set());
  const [removida, setRemovida] = useState<{ pergunta: PerguntaLocal; indice: number } | null>(null);
  const [arquivando, setArquivando] = useState<PerguntaLocal | null>(null);
  const [descartando, setDescartando] = useState(false);

  const [previa, setPrevia] = useState(false);
  const [respostasPrevia, setRespostasPrevia] = useState<Respostas>({});
  const desfazerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aplicar = useCallback((p: PesquisaDto) => {
    setPesquisa(p);
    setNome(p.name);
    setIntro(p.intro ?? "");
    setAgradecimento(p.thanks ?? "");
    setAssuntoEmail(p.emailSubject ?? "");
    setCorpoEmail(p.emailBody ?? "");
    setModeloId(p.whatsappTemplateId ?? SEM_MODELO);
    setVariaveis(p.whatsappVariables ?? {});
    setPerguntas(paraLocal(p));
  }, []);

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch(`/api/pesquisas/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar a pesquisa.");
      aplicar(json);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, [id, aplicar]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Os modelos da WABA, para o convite por WhatsApp.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/whatsapp-templates");
        if (res.ok) {
          const lista = (await res.json()) as ModeloDto[];
          setModelos(Array.isArray(lista) ? lista : []);
        }
      } catch {
        // sem a lista, o seletor fica vazio e a tela avisa
      }
    })();
  }, []);

  // "Sujo" = difere do que foi carregado. Guia o botão Salvar e o aviso ao sair.
  const sujo = useMemo(() => {
    if (!pesquisa) return false;
    const original = JSON.stringify({
      nome: pesquisa.name,
      intro: pesquisa.intro ?? "",
      thanks: pesquisa.thanks ?? "",
      emailSubject: pesquisa.emailSubject ?? "",
      emailBody: pesquisa.emailBody ?? "",
      whatsappTemplateId: pesquisa.whatsappTemplateId ?? SEM_MODELO,
      whatsappVariables: pesquisa.whatsappVariables ?? {},
      perguntas: paraEnvio(paraLocal(pesquisa)),
    });
    const atual = JSON.stringify({
      nome,
      intro,
      thanks: agradecimento,
      emailSubject: assuntoEmail,
      emailBody: corpoEmail,
      whatsappTemplateId: modeloId,
      whatsappVariables: modeloId === SEM_MODELO ? {} : variaveis,
      perguntas: paraEnvio(perguntas),
    });
    return original !== atual;
  }, [pesquisa, nome, intro, agradecimento, assuntoEmail, corpoEmail, modeloId, variaveis, perguntas]);

  useEffect(() => {
    if (!sujo) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  // O que falta corrigir, por pergunta — a linha mostra, a barra soma.
  const problemas = useMemo(() => new Map(perguntas.map((p) => [p.chave, problemaDaPergunta(p)])), [perguntas]);
  const nProblemas = [...problemas.values()].filter(Boolean).length;

  // A que seção cada pergunta pertence (a última seção acima dela), e o
  // resumo de cada seção: quantas perguntas e quantas precisam de atenção.
  const secaoDe = useMemo(() => {
    const mapa = new Map<string, string | null>();
    let atual: string | null = null;
    for (const p of perguntas) {
      if (p.type === "section") atual = p.chave;
      else mapa.set(p.chave, atual);
    }
    return mapa;
  }, [perguntas]);
  const resumoDaSecao = useMemo(() => {
    const mapa = new Map<string, { n: number; problemas: number }>();
    for (const [chave, secao] of secaoDe) {
      if (!secao) continue;
      const r = mapa.get(secao) ?? { n: 0, problemas: 0 };
      r.n += 1;
      if (problemas.get(chave)) r.problemas += 1;
      mapa.set(secao, r);
    }
    return mapa;
  }, [secaoDe, problemas]);
  const secoes = useMemo(() => perguntas.filter((p) => p.type === "section").map((p) => p.chave), [perguntas]);



  async function mudarStatus(status: SurveyStatus) {
    setErro("");
    try {
      const res = await fetch(`/api/pesquisas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao atualizar a pesquisa.");
      aplicar(json);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }

  function descartar() {
    if (pesquisa) aplicar(pesquisa);
    setAbertas(new Set());
    setDescartando(false);
  }

  const nomeVazio = !nome.trim();
  const podeSalvar = sujo && !salvando && nProblemas === 0 && !nomeVazio;

  const salvar = useCallback(async () => {
    if (!podeSalvar) return;
    setSalvando(true);
    setErro("");
    try {
      const resCampos = await fetch(`/api/pesquisas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nome,
          intro,
          thanks: agradecimento,
          emailSubject: assuntoEmail,
          emailBody: corpoEmail,
          whatsappTemplateId: modeloId === SEM_MODELO ? null : modeloId,
          whatsappVariables: modeloId === SEM_MODELO ? null : variaveis,
        }),
      });
      const jsonCampos = await resCampos.json();
      if (!resCampos.ok) throw new Error(jsonCampos.error ?? "Erro ao salvar.");

      const resPerguntas = await fetch(`/api/pesquisas/${id}/perguntas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: paraEnvio(perguntas) }),
      });
      const jsonPerguntas = await resPerguntas.json();
      if (!resPerguntas.ok) throw new Error(jsonPerguntas.error ?? "Erro ao salvar as perguntas.");
      aplicar(jsonPerguntas);
      setAbertas(new Set());
      setSalvoEm(new Date());
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      setErro(mensagem);
      // "Pergunta N: …" — abre a pergunta com problema e vai até ela.
      const m = /^Pergunta (\d+):/.exec(mensagem);
      if (m) {
        const alvo = perguntas[Number(m[1]) - 1];
        if (alvo) {
          setAba("perguntas");
          setAbertas((a) => new Set(a).add(alvo.chave));
          const secao = secaoDe.get(alvo.chave) ?? null;
          if (secao) setRecolhidas((r) => (r.has(secao) ? new Set([...r].filter((c) => c !== secao)) : r));
          setTimeout(() => document.getElementById(`linha-${alvo.chave}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
        }
      }
    } finally {
      setSalvando(false);
    }
  }, [podeSalvar, id, nome, intro, agradecimento, assuntoEmail, corpoEmail, modeloId, variaveis, perguntas, aplicar, secaoDe]);

  // Ctrl/Cmd+S salva — o atalho que todo editor tem.
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void salvar();
      }
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, [salvar]);

  // ── Perguntas ────────────────────────────────────────────────────────────

  function alternarRecolhida(chave: string) {
    setRecolhidas((r) => {
      const copia = new Set(r);
      if (copia.has(chave)) copia.delete(chave);
      else copia.add(chave);
      return copia;
    });
  }

  /** Mostra a seção que esconde esta pergunta (nada acontece se já está visível). */
  function garantirVisivel(chave: string) {
    const secao = secaoDe.get(chave) ?? null;
    if (!secao) return;
    setRecolhidas((r) => {
      if (!r.has(secao)) return r;
      const copia = new Set(r);
      copia.delete(secao);
      return copia;
    });
  }

  function alternarAberta(chave: string) {
    setAbertas((a) => {
      const copia = new Set(a);
      if (copia.has(chave)) copia.delete(chave);
      else copia.add(chave);
      return copia;
    });
  }

  function alterar(chave: string, patch: Partial<PerguntaLocal>) {
    setPerguntas((lista) => lista.map((p) => (p.chave === chave ? { ...p, ...patch } : p)));
  }

  function mover(chave: string, direcao: -1 | 1) {
    setPerguntas((lista) => {
      const i = lista.findIndex((p) => p.chave === chave);
      const j = i + direcao;
      if (i < 0 || j < 0 || j >= lista.length) return lista;
      const copia = [...lista];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
  }

  function adicionar(type: SurveyQuestionType) {
    const chave = chaveNova();
    setPerguntas((lista) => [
      ...lista,
      { chave, id: null, type, label: "", help: "", required: false, options: opcoesPadrao(type), isNps: false, answerCount: 0 },
    ]);
    // Entra no fim, dentro da última seção: ela precisa estar expandida.
    const ultimaSecao = secoes[secoes.length - 1];
    if (type !== "section" && ultimaSecao) {
      setRecolhidas((r) => {
        if (!r.has(ultimaSecao)) return r;
        const copia = new Set(r);
        copia.delete(ultimaSecao);
        return copia;
      });
    }
    setAbertas((a) => new Set(a).add(chave));
    setFocar(chave);
    setTimeout(() => document.getElementById(`linha-${chave}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  function duplicar(chave: string) {
    garantirVisivel(chave);
    setPerguntas((lista) => {
      const i = lista.findIndex((p) => p.chave === chave);
      if (i < 0) return lista;
      const nova: PerguntaLocal = { ...lista[i], chave: chaveNova(), id: null, isNps: false, answerCount: 0 };
      const copia = [...lista];
      copia.splice(i + 1, 0, nova);
      setAbertas((a) => new Set(a).add(nova.chave));
      return copia;
    });
  }

  function remover(pergunta: PerguntaLocal) {
    if (pergunta.answerCount > 0) {
      setArquivando(pergunta);
      return;
    }
    const indice = perguntas.findIndex((p) => p.chave === pergunta.chave);
    setPerguntas((lista) => lista.filter((p) => p.chave !== pergunta.chave));
    setRemovida({ pergunta, indice });
    if (desfazerTimer.current) clearTimeout(desfazerTimer.current);
    desfazerTimer.current = setTimeout(() => setRemovida(null), DESFAZER_MS);
  }

  function desfazerRemocao() {
    if (!removida) return;
    setPerguntas((lista) => {
      const copia = [...lista];
      copia.splice(Math.min(removida.indice, copia.length), 0, removida.pergunta);
      return copia;
    });
    setRemovida(null);
    if (desfazerTimer.current) clearTimeout(desfazerTimer.current);
  }

  function confirmarArquivar() {
    if (!arquivando) return;
    setPerguntas((lista) => lista.filter((p) => p.chave !== arquivando.chave));
    setArquivando(null);
  }

  useEffect(() => () => {
    if (desfazerTimer.current) clearTimeout(desfazerTimer.current);
  }, []);

  // ── WhatsApp ─────────────────────────────────────────────────────────────

  const modelo = modelos.find((m) => m.id === modeloId) ?? null;
  const indicesDoModelo = modelo ? extractVariables(modelo.bodyText) : [];

  function definirFonte(n: number, tipo: "name" | "company" | "static") {
    setVariaveis((atual) => {
      const chave = String(n);
      const anterior = atual[chave];
      const fonte: WhatsAppVariableSource =
        tipo === "static"
          ? { source: "static", value: anterior?.source === "static" ? (anterior.value ?? "") : "" }
          : { source: tipo };
      return { ...atual, [chave]: fonte };
    });
  }

  // ── Pré-visualização (a lista local: o que ainda não foi salvo também) ───

  const perguntasDaPrevia = perguntas.map((p) => ({
    id: p.chave,
    type: p.type,
    label: p.label || (p.type === "section" ? "Seção sem título" : "Pergunta sem enunciado"),
    help: p.help || null,
    required: p.required,
    options: p.options,
  }));
  const progressoPrevia = progresso(perguntasDaPrevia, respostasPrevia);
  const nRespondiveis = perguntas.filter((p) => p.type !== "section").length;
  const nObrigatorias = perguntas.filter((p) => p.required).length;

  let numero = 0;

  if (!pesquisa && !erro) {
    return (
      <Card>
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando pesquisa...</p>
      </Card>
    );
  }

  const estado = salvando
    ? "Salvando..."
    : nProblemas > 0
      ? `${nProblemas} pergunta${nProblemas === 1 ? "" : "s"} precisa${nProblemas === 1 ? "" : "m"} de atenção`
      : nomeVazio
        ? "Dê um nome à pesquisa"
        : sujo
          ? "Alterações não salvas"
          : salvoEm
            ? `Salvo às ${formatTime(salvoEm)}`
            : "Tudo salvo";

  const previaConteudo = (
    <>
      <p className="text-xs text-muted-foreground">
        {progressoPrevia.respondidas} de {progressoPrevia.total} respondidas
      </p>
      {intro ? <p className="mt-2 text-sm whitespace-pre-line">{intro}</p> : null}
      <div className="mt-4">
        <FormularioPesquisa
          perguntas={perguntasDaPrevia}
          respostas={respostasPrevia}
          onResposta={(pid: string, valor: SurveyAnswerValue | null) => setRespostasPrevia((r) => ({ ...r, [pid]: valor }))}
        />
      </div>
      {agradecimento ? (
        <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">Ao concluir: &quot;{agradecimento}&quot;</p>
      ) : null}
    </>
  );

  return (
    <>
      {/* Barra fixa: onde se está, em que estado, e a única ação primária. */}
      <div className="sticky top-14 z-20 -mx-4 mb-6 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:top-0 md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href={`/pesquisas/${id}`}>
              <ArrowLeft />
              Acompanhamento
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-medium tracking-tight">{nome.trim() || "Pesquisa sem nome"}</h1>
            <p className="truncate text-xs text-muted-foreground" aria-live="polite">
              {pesquisa ? OBJETIVO_LABEL[pesquisa.objective] : ""} · <span className={cn(nProblemas > 0 || nomeVazio ? "text-destructive" : sujo ? "text-warning-dark" : "")}>{estado}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pesquisa ? <Badge variant={STATUS_VARIANT[pesquisa.status]}>{STATUS_LABEL[pesquisa.status]}</Badge> : null}
            <Button variant="outline" size="sm" className="xl:hidden" onClick={() => setPrevia(true)}>
              <Eye />
              Pré-visualizar
            </Button>
            {sujo ? (
              <Button variant="ghost" size="sm" onClick={() => setDescartando(true)} disabled={salvando}>
                Descartar
              </Button>
            ) : pesquisa?.status === "draft" && nRespondiveis > 0 ? (
              <Button variant="outline" size="sm" onClick={() => mudarStatus("active")} title="Libera convites e respostas">
                <CheckCircle2 />
                Ativar pesquisa
              </Button>
            ) : null}
            <Button size="sm" onClick={salvar} disabled={!podeSalvar} title="Ctrl/Cmd + S">
              <Save />
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      </div>

      {erro ? (
        <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0">
          {/* Abas: cada uma é uma tarefa; o resto fica fora da vista. */}
          <div className="mb-5 flex gap-1 rounded-lg border border-border bg-muted p-1" role="tablist" aria-label="Partes da pesquisa">
            {(
              [
                ["perguntas", <>Perguntas<span className="hidden sm:inline"> ({nRespondiveis})</span></>],
                ["textos", "Textos"],
                ["convite", "Convite"],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={aba === valor}
                onClick={() => setAba(valor)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none",
                  aba === valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {aba === "perguntas" ? (
            <div className="grid min-w-0 gap-4" role="tabpanel">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {nRespondiveis === 0
                    ? "Comece pela primeira pergunta — escolha o tipo:"
                    : `${nRespondiveis} pergunta${nRespondiveis === 1 ? "" : "s"}${nObrigatorias ? ` · ${nObrigatorias} obrigatória${nObrigatorias === 1 ? "" : "s"}` : ""}`}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  {secoes.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRecolhidas(recolhidas.size < secoes.length ? new Set(secoes) : new Set())}
                    >
                      {recolhidas.size < secoes.length ? "Minimizar seções" : "Ampliar seções"}
                    </Button>
                  ) : null}
                  {perguntas.length > 0 ? (
                    <Button variant="ghost" size="sm" onClick={() => setAbertas(abertas.size ? new Set() : new Set(perguntas.map((p) => p.chave)))}>
                      {abertas.size ? "Recolher todas" : "Expandir todas"}
                    </Button>
                  ) : null}
                </div>
              </div>

              <ChipsDeTipo onEscolher={adicionar} />

              {removida ? (
                <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm">
                  <span>
                    &quot;{removida.pergunta.label.trim() || "Pergunta sem enunciado"}&quot; removida.
                  </span>
                  <Button variant="outline" size="sm" onClick={desfazerRemocao}>
                    <Undo2 />
                    Desfazer
                  </Button>
                </div>
              ) : null}

              {perguntas.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
                  <p className="text-sm">Nenhuma pergunta ainda.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Uma seção agrupa as perguntas seguintes em uma etapa para o parceiro. A escala 0–10 pode ser a pergunta do NPS.
                  </p>
                </div>
              ) : (
                <ol className="grid min-w-0 gap-2">
                  {perguntas.map((p, i) => {
                    if (p.type !== "section") numero += 1;
                    const secao = p.type === "section" ? null : (secaoDe.get(p.chave) ?? null);
                    // Dentro de uma seção minimizada: escondida, mas a numeração segue.
                    if (secao && recolhidas.has(secao)) return null;
                    const resumo = p.type === "section" ? resumoDaSecao.get(p.chave) : undefined;
                    return (
                      <li key={p.chave} id={`linha-${p.chave}`} className="min-w-0">
                        <EditorPergunta
                          pergunta={p}
                          numero={p.type === "section" ? null : numero}
                          aberta={abertas.has(p.chave)}
                          problema={problemas.get(p.chave) ?? null}
                          ehPrimeira={i === 0}
                          ehUltima={i === perguntas.length - 1}
                          focarAoAbrir={focar === p.chave}
                          onToggle={() => alternarAberta(p.chave)}
                          onChange={(patch) => alterar(p.chave, patch)}
                          onMover={(direcao) => mover(p.chave, direcao)}
                          onDuplicar={() => duplicar(p.chave)}
                          onRemover={() => remover(p)}
                          recolhida={p.type === "section" && recolhidas.has(p.chave)}
                          nDentro={resumo?.n ?? 0}
                          problemasDentro={resumo?.problemas ?? 0}
                          onRecolher={() => alternarRecolhida(p.chave)}
                        />
                      </li>
                    );
                  })}
                </ol>
              )}

              {perguntas.length >= 4 ? (
                <div className="border-t border-border pt-4">
                  <p className="mb-2 text-xs text-muted-foreground">Adicionar no fim:</p>
                  <ChipsDeTipo onEscolher={adicionar} />
                </div>
              ) : null}
            </div>
          ) : null}

          {aba === "textos" ? (
            <Card className="p-4 sm:p-5" role="tabpanel">
              <div className="grid gap-5">
                <div className="grid gap-1.5">
                  <Label htmlFor="pesquisa-nome">Nome da pesquisa</Label>
                  <Input id="pesquisa-nome" value={nome} maxLength={120} aria-invalid={nomeVazio || undefined} onChange={(e) => setNome(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Aparece no painel azul da página do parceiro e nos relatórios.</p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pesquisa-intro">Texto de abertura</Label>
                  <Textarea id="pesquisa-intro" rows={4} value={intro} maxLength={2000} onChange={(e) => setIntro(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    O parceiro lê antes de começar. Diga para que serve e quanto tempo leva. {intro.length}/2000
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pesquisa-thanks">Agradecimento</Label>
                  <Textarea id="pesquisa-thanks" rows={2} value={agradecimento} maxLength={1000} onChange={(e) => setAgradecimento(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Aparece ao concluir. {agradecimento.length}/1000</p>
                </div>
              </div>
            </Card>
          ) : null}

          {aba === "convite" ? (
            <div className="grid gap-4" role="tabpanel">
              <Card className="p-4 sm:p-5">
                <h2 className="text-base">Convite por e-mail</h2>
                <p className="mt-1 mb-4 text-xs text-muted-foreground">
                  O botão &quot;Responder pesquisa&quot; com o link de cada parceiro entra sozinho no fim. Pode usar {"{{nome}}"}, {"{{empresa}}"} e {"{{pesquisa}}"}. Em branco, vale o texto padrão.
                </p>
                <div className="grid gap-4">
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="pesquisa-email-assunto">Assunto</Label>
                      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setAssuntoEmail(assuntoPadrao(nome || "Pesquisa"))}>
                        Usar o padrão
                      </Button>
                    </div>
                    <Input id="pesquisa-email-assunto" value={assuntoEmail} maxLength={150} placeholder={assuntoPadrao(nome || "Pesquisa")} onChange={(e) => setAssuntoEmail(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="pesquisa-email-corpo">Texto</Label>
                      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setCorpoEmail(corpoPadrao())}>
                        Usar o padrão
                      </Button>
                    </div>
                    <Textarea id="pesquisa-email-corpo" rows={6} value={corpoEmail} maxLength={3000} placeholder={corpoPadrao()} onChange={(e) => setCorpoEmail(e.target.value)} />
                  </div>
                </div>
              </Card>

              <Card className="p-4 sm:p-5">
                <h2 className="text-base">Convite por WhatsApp</h2>
                <p className="mt-1 mb-4 text-xs text-muted-foreground">
                  Sai pelo número Avante Expansão com um modelo aprovado pela Meta que tenha um botão de link terminando em {"{{1}}"} — por ele vai o link de cada parceiro.
                </p>
                <div className="grid gap-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="pesquisa-modelo">Modelo</Label>
                    <Select value={modeloId} onValueChange={setModeloId}>
                      <SelectTrigger id="pesquisa-modelo">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SEM_MODELO}>Sem convite por WhatsApp</SelectItem>
                        {modelos.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                            {m.status !== "approved" ? " (não aprovado)" : modeloTemLinkDinamico(m.buttons) ? "" : " (sem botão de link dinâmico)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {pesquisa?.whatsapp && !pesquisa.whatsapp.pronto && modeloId !== SEM_MODELO && !sujo ? (
                      <p className="text-xs text-warning-dark">{pesquisa.whatsapp.motivo}</p>
                    ) : null}
                  </div>
                  {modelo ? (
                    <div className="grid gap-3">
                      <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-line">{modelo.bodyText}</p>
                      {indicesDoModelo.length > 0 ? (
                        <div className="grid gap-2">
                          {indicesDoModelo.map((n) => {
                            const fonte = variaveis[String(n)];
                            return (
                              <div key={n} className="grid gap-2 sm:grid-cols-[6rem_12rem_minmax(0,1fr)] sm:items-center">
                                <Label htmlFor={`var-${n}`}>{`{{${n}}}`}</Label>
                                <Select value={fonte?.source ?? ""} onValueChange={(v) => definirFonte(n, v as "name" | "company" | "static")}>
                                  <SelectTrigger id={`var-${n}`}>
                                    <SelectValue placeholder="Escolha a fonte" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="name">Nome do parceiro</SelectItem>
                                    <SelectItem value="company">Empresa do parceiro</SelectItem>
                                    <SelectItem value="static">Texto fixo</SelectItem>
                                  </SelectContent>
                                </Select>
                                {fonte?.source === "static" ? (
                                  <Input
                                    aria-label={`Texto fixo de {{${n}}}`}
                                    value={fonte.value ?? ""}
                                    onChange={(e) => setVariaveis((atual) => ({ ...atual, [String(n)]: { source: "static", value: e.target.value } }))}
                                  />
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Card>
            </div>
          ) : null}
        </div>

        {/* Pré-visualização ao vivo nas telas largas: o que o parceiro vê, enquanto se edita. */}
        <aside className="hidden xl:block">
          <div className="sticky top-20">
            <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Eye className="size-3.5" aria-hidden />
              Como o parceiro vê · pode responder para testar, nada é gravado
            </p>
            <div className="max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="text-lg">{nome.trim() || "Pesquisa"}</h2>
              {previaConteudo}
            </div>
          </div>
        </aside>
      </div>

      <Dialog open={previa} onOpenChange={setPrevia}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{nome.trim() || "Pesquisa"}</DialogTitle>
            <DialogDescription>É assim que o parceiro vê. Pode responder aqui para testar — nada é gravado.</DialogDescription>
          </DialogHeader>
          {previaConteudo}
        </DialogContent>
      </Dialog>

      <Dialog open={arquivando !== null} onOpenChange={(open) => !open && setArquivando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arquivar a pergunta?</DialogTitle>
            <DialogDescription>
              &quot;{arquivando?.label}&quot; já tem {arquivando?.answerCount} resposta{arquivando?.answerCount === 1 ? "" : "s"}. Ela sai do formulário, mas as respostas continuam no relatório. Vale ao salvar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArquivando(null)}>
              Manter
            </Button>
            <Button variant="destructive" onClick={confirmarArquivar}>
              Arquivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={descartando} onOpenChange={setDescartando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar as alterações?</DialogTitle>
            <DialogDescription>A pesquisa volta ao que está salvo. O que você mudou desde então se perde.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDescartando(false)}>
              Continuar editando
            </Button>
            <Button variant="destructive" onClick={descartar}>
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="sr-only" aria-live="polite">
        {salvoEm ? `Pesquisa salva às ${formatTime(salvoEm)}` : ""}
      </p>
    </>
  );
}
