"use client";

import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, ChevronDown, CopyPlus, Trash2 } from "lucide-react";

import { TIPO_CURTO, TIPO_ICONE } from "@/components/pesquisas/tipo-de-pergunta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  SURVEY_QUESTION_TYPES,
  type SurveyQuestionOptions,
  type SurveyQuestionType,
} from "@/lib/db/schema";
import { opcoesPadrao } from "@/lib/pesquisas/perguntas";
import { TIPO_LABEL } from "@/lib/pesquisas/rotulos";
import { cn } from "@/lib/utils";

/** Uma pergunta no construtor. `chave` é só do navegador (nova ainda não tem id). */
export interface PerguntaLocal {
  chave: string;
  id: string | null;
  type: SurveyQuestionType;
  label: string;
  help: string;
  required: boolean;
  options: SurveyQuestionOptions | null;
  isNps: boolean;
  answerCount: number;
}

/**
 * Uma linha da lista de perguntas: fechada mostra só o essencial (tipo,
 * enunciado, marcas); aberta mostra o formulário de edição. Só o que está
 * sendo editado ocupa espaço (progressive disclosure).
 */
export function EditorPergunta({
  pergunta,
  numero,
  aberta,
  problema,
  ehPrimeira,
  ehUltima,
  focarAoAbrir = false,
  onToggle,
  onChange,
  onMover,
  onDuplicar,
  onRemover,
}: {
  pergunta: PerguntaLocal;
  /** Número que o parceiro vê (seção não tem). */
  numero: number | null;
  aberta: boolean;
  /** O que falta corrigir nesta pergunta (lib/pesquisas/perguntas.ts). */
  problema: string | null;
  ehPrimeira: boolean;
  ehUltima: boolean;
  /** Pergunta recém-criada: abre com o cursor no enunciado. */
  focarAoAbrir?: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<PerguntaLocal>) => void;
  onMover: (direcao: -1 | 1) => void;
  onDuplicar: () => void;
  onRemover: () => void;
}) {
  const o = pergunta.options ?? {};
  const ehSecao = pergunta.type === "section";
  const tipoTravado = pergunta.answerCount > 0;
  const Icone = TIPO_ICONE[pergunta.type];
  const campoId = (nome: string) => `${pergunta.chave}-${nome}`;
  const enunciadoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberta && focarAoAbrir) enunciadoRef.current?.focus();
  }, [aberta, focarAoAbrir]);

  function trocarTipo(type: SurveyQuestionType) {
    onChange({
      type,
      options: opcoesPadrao(type),
      required: type === "section" ? false : pergunta.required,
      isNps: false,
    });
  }

  function opcoes(patch: Partial<SurveyQuestionOptions>) {
    onChange({ options: { ...o, ...patch } });
  }

  // Seção: só o título importa. Barra escura (superfície invertida) com o
  // título digitado direto na linha — distinta de pergunta e de campo
  // desabilitado — e as ações ao lado; não abre nem fecha.
  if (ehSecao) {
    const acaoNaBarra = "text-inverse-foreground hover:bg-white/15 hover:text-inverse-foreground active:bg-white/25 disabled:opacity-40";
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-inverse px-3 py-2 text-inverse-foreground",
          problema && "ring-2 ring-warning ring-inset"
        )}
      >
        <Icone className="size-4 shrink-0 text-inverse-muted" aria-hidden />
        <input
          ref={enunciadoRef}
          id={campoId("label")}
          value={pergunta.label}
          maxLength={300}
          aria-label="Título da seção"
          aria-invalid={!pergunta.label.trim() || undefined}
          placeholder="Título da seção — ex.: Sobre a empresa"
          onChange={(e) => onChange({ label: e.target.value })}
          className="h-9 min-w-[10rem] flex-1 border-b border-transparent bg-transparent px-1 text-base font-medium text-inverse-foreground placeholder:font-light placeholder:text-inverse-muted focus-visible:border-inverse-foreground/70 focus-visible:outline-none"
        />
        {problema ? (
          <span className="text-xs text-warning-light" role="alert">
            {problema}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center">
          <Button type="button" variant="ghost" size="icon" className={acaoNaBarra} aria-label="Mover para cima" title="Mover para cima" disabled={ehPrimeira} onClick={onMover.bind(null, -1)}>
            <ArrowUp />
          </Button>
          <Button type="button" variant="ghost" size="icon" className={acaoNaBarra} aria-label="Mover para baixo" title="Mover para baixo" disabled={ehUltima} onClick={onMover.bind(null, 1)}>
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon" className={acaoNaBarra} aria-label="Duplicar" title="Duplicar" onClick={onDuplicar}>
            <CopyPlus />
          </Button>
          <Button type="button" variant="ghost" size="icon" className={acaoNaBarra} aria-label="Remover" title="Remover" onClick={onRemover}>
            <Trash2 />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-colors",
        problema ? "border-destructive/50" : aberta ? "border-primary/50" : "border-border"
      )}
    >
      {/* Cabeçalho da linha: clique abre/fecha; as ações ficam fora do botão. */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={aberta}
          aria-controls={campoId("corpo")}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {numero ?? ""}
          </span>
          <Icone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm", !pergunta.label.trim() && "text-muted-foreground italic")}>
              {pergunta.label.trim() || "Pergunta sem enunciado"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {TIPO_CURTO[pergunta.type]}
              {pergunta.type === "scale" ? ` ${o.min ?? 0}–${o.max ?? 10}` : ""}
              {pergunta.type === "single_choice" || pergunta.type === "multiple_choice"
                ? ` · ${(o.choices ?? []).filter((c) => c.trim()).length} opções`
                : ""}
              {problema ? <span className="text-destructive"> · {problema}</span> : null}
            </span>
          </span>
          <span className="hidden shrink-0 items-center gap-1 sm:flex">
            {pergunta.required ? <Badge variant="secondary">Obrigatória</Badge> : null}
            {pergunta.isNps ? <Badge variant="info">NPS</Badge> : null}
            {tipoTravado ? (
              <Badge variant="outline" title="Já tem respostas: o tipo não muda; remover arquiva.">
                {pergunta.answerCount} resp.
              </Badge>
            ) : null}
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", aberta && "rotate-180")}
            aria-hidden
          />
        </button>
        {/* Nas telas largas as ações ficam no cabeçalho; no celular, dentro da linha aberta (ver rodapé). */}
        <div className="hidden shrink-0 items-center sm:flex">
          <Button type="button" variant="ghost" size="icon" aria-label="Mover para cima" title="Mover para cima" disabled={ehPrimeira} onClick={onMover.bind(null, -1)}>
            <ArrowUp />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Mover para baixo" title="Mover para baixo" disabled={ehUltima} onClick={onMover.bind(null, 1)}>
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Duplicar" title="Duplicar" onClick={onDuplicar}>
            <CopyPlus />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={tipoTravado ? "Arquivar" : "Remover"}
            title={tipoTravado ? "Arquivar (as respostas continuam no relatório)" : "Remover"}
            onClick={onRemover}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {aberta ? (
        <div id={campoId("corpo")} className="border-t border-border px-4 pt-4 pb-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="grid gap-1.5">
              <Label htmlFor={campoId("label")}>Enunciado</Label>
              <Input
                ref={enunciadoRef}
                id={campoId("label")}
                value={pergunta.label}
                maxLength={300}
                aria-invalid={!pergunta.label.trim() || undefined}
                placeholder="ex.: Quantos clientes ativos a empresa tem hoje?"
                onChange={(e) => onChange({ label: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={campoId("type")}>Tipo</Label>
              <Select value={pergunta.type} onValueChange={(v) => trocarTipo(v as SurveyQuestionType)} disabled={tipoTravado}>
                <SelectTrigger id={campoId("type")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SURVEY_QUESTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPO_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 grid gap-1.5">
            <Label htmlFor={campoId("help")}>
              Texto de ajuda <span className="font-normal text-muted-foreground">(opcional — aparece abaixo da pergunta)</span>
            </Label>
            <Input id={campoId("help")} value={pergunta.help} maxLength={500} onChange={(e) => onChange({ help: e.target.value })} />
          </div>

          {pergunta.type === "single_choice" || pergunta.type === "multiple_choice" ? (
            <div className="mt-3 grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor={campoId("choices")}>Opções — uma por linha</Label>
                <Textarea
                  id={campoId("choices")}
                  rows={Math.min(8, Math.max(3, (o.choices ?? []).length + 1))}
                  value={(o.choices ?? []).join("\n")}
                  onChange={(e) => opcoes({ choices: e.target.value.split("\n") })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={o.other === true} onChange={(e) => opcoes({ other: e.target.checked })} />
                Permitir &quot;Outro&quot; com texto livre
              </label>
            </div>
          ) : null}

          {pergunta.type === "scale" ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div className="grid gap-1.5">
                <Label htmlFor={campoId("min")}>De</Label>
                <Select value={String(o.min ?? 0)} onValueChange={(v) => opcoes({ min: Number(v) })}>
                  <SelectTrigger id={campoId("min")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0</SelectItem>
                    <SelectItem value="1">1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={campoId("max")}>Até</Label>
                <Select value={String(o.max ?? 10)} onValueChange={(v) => opcoes({ max: Number(v) })}>
                  <SelectTrigger id={campoId("max")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={campoId("minLabel")}>Rótulo do mínimo</Label>
                <Input id={campoId("minLabel")} value={o.minLabel ?? ""} maxLength={40} placeholder="ex.: Não recomendaria" onChange={(e) => opcoes({ minLabel: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={campoId("maxLabel")}>Rótulo do máximo</Label>
                <Input id={campoId("maxLabel")} value={o.maxLabel ?? ""} maxLength={40} placeholder="ex.: Com certeza" onChange={(e) => opcoes({ maxLabel: e.target.value })} />
              </div>
            </div>
          ) : null}

          {pergunta.type === "number" ? (
            <div className="mt-3 grid gap-1.5 sm:max-w-48">
              <Label htmlFor={campoId("unit")}>
                Unidade <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Input id={campoId("unit")} value={o.unit ?? ""} maxLength={20} placeholder="ex.: clientes, R$" onChange={(e) => opcoes({ unit: e.target.value })} />
            </div>
          ) : null}

          {!ehSecao ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={pergunta.required} onChange={(e) => onChange({ required: e.target.checked })} />
                Obrigatória
              </label>
              {pergunta.type === "scale" && (o.min ?? 0) === 0 && (o.max ?? 10) === 10 ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={pergunta.isNps} onChange={(e) => onChange({ isNps: e.target.checked })} />
                  É a pergunta do NPS
                </label>
              ) : null}
              {tipoTravado ? (
                <span className="text-xs text-muted-foreground">
                  {pergunta.answerCount} resposta{pergunta.answerCount === 1 ? "" : "s"} — o tipo não muda mais; remover arquiva.
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-1 border-t border-border pt-3 sm:hidden" aria-label="Ações da pergunta">
            <Button type="button" variant="ghost" size="sm" disabled={ehPrimeira} onClick={onMover.bind(null, -1)}>
              <ArrowUp /> Subir
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={ehUltima} onClick={onMover.bind(null, 1)}>
              <ArrowDown /> Descer
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDuplicar}>
              <CopyPlus /> Duplicar
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRemover}>
              <Trash2 /> {tipoTravado ? "Arquivar" : "Remover"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
