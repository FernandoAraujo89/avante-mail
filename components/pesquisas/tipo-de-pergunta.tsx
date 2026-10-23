"use client";

import {
  AlignLeft,
  CircleDot,
  Hash,
  Heading,
  ListChecks,
  SlidersHorizontal,
  TextCursorInput,
  ToggleLeft,
  type LucideIcon,
} from "lucide-react";

import { SURVEY_QUESTION_TYPES, type SurveyQuestionType } from "@/lib/db/schema";
import { TIPO_LABEL } from "@/lib/pesquisas/rotulos";
import { cn } from "@/lib/utils";

// O tipo de pergunta sempre com o mesmo ícone, em todo o construtor: quem
// reconhece o ícone não precisa ler o rótulo (reconhecimento > memória).

export const TIPO_ICONE: Record<SurveyQuestionType, LucideIcon> = {
  section: Heading,
  short_text: TextCursorInput,
  long_text: AlignLeft,
  number: Hash,
  single_choice: CircleDot,
  multiple_choice: ListChecks,
  scale: SlidersHorizontal,
  yes_no: ToggleLeft,
};

/** Rótulo curto, para caber no chip. */
export const TIPO_CURTO: Record<SurveyQuestionType, string> = {
  section: "Seção",
  short_text: "Texto curto",
  long_text: "Texto longo",
  number: "Número",
  single_choice: "Escolha única",
  multiple_choice: "Múltipla escolha",
  scale: "Escala",
  yes_no: "Sim ou não",
};

/** Os chips "Adicionar": um clique cria a pergunta já do tipo certo. */
export function ChipsDeTipo({
  onEscolher,
  className,
}: {
  onEscolher: (type: SurveyQuestionType) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group" aria-label="Adicionar pergunta">
      {SURVEY_QUESTION_TYPES.map((t) => {
        const Icone = TIPO_ICONE[t];
        return (
          <button
            key={t}
            type="button"
            onClick={() => onEscolher(t)}
            title={`Adicionar ${TIPO_LABEL[t].toLowerCase()}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:border-primary hover:bg-accent hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <Icone className="size-4 text-muted-foreground" aria-hidden />
            {TIPO_CURTO[t]}
          </button>
        );
      })}
    </div>
  );
}
