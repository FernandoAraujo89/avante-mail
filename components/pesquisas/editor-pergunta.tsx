"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

export function EditorPergunta({
  pergunta,
  numero,
  ehPrimeira,
  ehUltima,
  onChange,
  onMover,
  onRemover,
}: {
  pergunta: PerguntaLocal;
  /** Número que o parceiro vê (seção não tem). */
  numero: number | null;
  ehPrimeira: boolean;
  ehUltima: boolean;
  onChange: (patch: Partial<PerguntaLocal>) => void;
  onMover: (direcao: -1 | 1) => void;
  onRemover: () => void;
}) {
  const o = pergunta.options ?? {};
  const ehSecao = pergunta.type === "section";
  const tipoTravado = pergunta.answerCount > 0;
  const campoId = (nome: string) => `${pergunta.chave}-${nome}`;

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

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {ehSecao ? "Seção" : `Pergunta ${numero}`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Mover para cima"
            disabled={ehPrimeira}
            onClick={() => onMover(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Mover para baixo"
            disabled={ehUltima}
            onClick={() => onMover(1)}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={tipoTravado ? "Arquivar pergunta" : "Remover pergunta"}
            onClick={onRemover}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="grid gap-1.5">
          <Label htmlFor={campoId("label")}>
            {ehSecao ? "Título da seção" : "Enunciado"}
          </Label>
          <Input
            id={campoId("label")}
            value={pergunta.label}
            maxLength={300}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={campoId("type")}>Tipo</Label>
          <Select
            value={pergunta.type}
            onValueChange={(v) => trocarTipo(v as SurveyQuestionType)}
            disabled={tipoTravado}
          >
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
          Texto de ajuda <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id={campoId("help")}
          value={pergunta.help}
          maxLength={500}
          onChange={(e) => onChange({ help: e.target.value })}
        />
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
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={o.other === true}
              onChange={(e) => opcoes({ other: e.target.checked })}
            />
            Permitir a opção &quot;Outro&quot; com texto livre
          </label>
        </div>
      ) : null}

      {pergunta.type === "scale" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor={campoId("min")}>De</Label>
            <Select
              value={String(o.min ?? 0)}
              onValueChange={(v) => opcoes({ min: Number(v) })}
            >
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
            <Select
              value={String(o.max ?? 10)}
              onValueChange={(v) => opcoes({ max: Number(v) })}
            >
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
            <Input
              id={campoId("minLabel")}
              value={o.minLabel ?? ""}
              maxLength={40}
              placeholder="ex.: Não recomendaria"
              onChange={(e) => opcoes({ minLabel: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={campoId("maxLabel")}>Rótulo do máximo</Label>
            <Input
              id={campoId("maxLabel")}
              value={o.maxLabel ?? ""}
              maxLength={40}
              placeholder="ex.: Com certeza"
              onChange={(e) => opcoes({ maxLabel: e.target.value })}
            />
          </div>
        </div>
      ) : null}

      {pergunta.type === "number" ? (
        <div className="mt-3 grid gap-1.5 sm:max-w-48">
          <Label htmlFor={campoId("unit")}>
            Unidade <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id={campoId("unit")}
            value={o.unit ?? ""}
            maxLength={20}
            placeholder="ex.: clientes, R$"
            onChange={(e) => opcoes({ unit: e.target.value })}
          />
        </div>
      ) : null}

      {!ehSecao ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={pergunta.required}
              onChange={(e) => onChange({ required: e.target.checked })}
            />
            Obrigatória
          </label>
          {pergunta.type === "scale" && (o.min ?? 0) === 0 && (o.max ?? 10) === 10 ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={pergunta.isNps}
                onChange={(e) => onChange({ isNps: e.target.checked })}
              />
              É a pergunta do NPS
            </label>
          ) : null}
          {tipoTravado ? (
            <span className="text-xs text-muted-foreground">
              {pergunta.answerCount} resposta{pergunta.answerCount === 1 ? "" : "s"} — o tipo
              não muda mais; remover arquiva.
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
