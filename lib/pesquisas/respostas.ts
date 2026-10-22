import type {
  SurveyAnswerValue,
  SurveyQuestionOptions,
  SurveyQuestionType,
} from "@/lib/db/schema";

// A resposta de cada tipo de pergunta: o que vale, o que conta como vazio e
// quanto do formulário já foi respondido. Puro — o formulário no navegador e
// a API pública leem daqui, para os dois concordarem.

/** O que o formulário precisa saber de uma pergunta. */
export interface PerguntaDoFormulario {
  id: string;
  type: SurveyQuestionType;
  label: string;
  help: string | null;
  required: boolean;
  options: SurveyQuestionOptions | null;
}

export const RESPOSTA_TEXTO_MAX = 4000;

/** Prefixo da escolha "Outro" com texto livre, guardado junto das opções. */
export const OUTRO_PREFIXO = "outro:";

export function respostaVazia(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === "string") return valor.trim() === "";
  if (Array.isArray(valor)) return valor.length === 0;
  return false;
}

export type ValidacaoResposta =
  | { ok: true; valor: SurveyAnswerValue | null }
  | { ok: false; error: string };

/**
 * Normaliza e valida o valor para a pergunta. `null` = apagou a resposta.
 * Escolha livre ("Outro") vai como "outro:<texto>" na lista de escolhas.
 */
export function validarResposta(
  pergunta: PerguntaDoFormulario,
  valor: unknown
): ValidacaoResposta {
  if (respostaVazia(valor)) return { ok: true, valor: null };
  const o = pergunta.options ?? {};

  switch (pergunta.type) {
    case "section":
      return { ok: false, error: "Seção não recebe resposta." };

    case "short_text":
    case "long_text": {
      if (typeof valor !== "string") return { ok: false, error: "Resposta inválida." };
      const t = valor.trim();
      if (t.length > RESPOSTA_TEXTO_MAX) {
        return { ok: false, error: `A resposta pode ter no máximo ${RESPOSTA_TEXTO_MAX} caracteres.` };
      }
      return { ok: true, valor: t };
    }

    case "number": {
      const n = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, error: "Informe um número." };
      return { ok: true, valor: n };
    }

    case "scale": {
      const n = typeof valor === "number" ? valor : Number(valor);
      const min = o.min ?? 0;
      const max = o.max ?? 10;
      if (!Number.isInteger(n) || n < min || n > max) {
        return { ok: false, error: `Escolha um valor de ${min} a ${max}.` };
      }
      return { ok: true, valor: n };
    }

    case "yes_no": {
      if (typeof valor === "boolean") return { ok: true, valor };
      if (valor === "sim" || valor === "true") return { ok: true, valor: true };
      if (valor === "nao" || valor === "não" || valor === "false") return { ok: true, valor: false };
      return { ok: false, error: "Responda sim ou não." };
    }

    case "single_choice":
    case "multiple_choice": {
      const lista = Array.isArray(valor) ? valor : [valor];
      const escolhas: string[] = [];
      for (const item of lista) {
        if (typeof item !== "string") return { ok: false, error: "Escolha inválida." };
        const t = item.trim();
        if (!t) continue;
        const ehOutro = t.toLowerCase().startsWith(OUTRO_PREFIXO);
        if (ehOutro) {
          if (!o.other) return { ok: false, error: "Esta pergunta não aceita outra resposta." };
          const livre = t.slice(OUTRO_PREFIXO.length).trim();
          if (!livre) continue;
          if (livre.length > 200) return { ok: false, error: "A outra resposta tem no máximo 200 caracteres." };
          escolhas.push(`${OUTRO_PREFIXO}${livre}`);
        } else {
          if (!(o.choices ?? []).includes(t)) {
            return { ok: false, error: "Escolha uma das opções." };
          }
          if (!escolhas.includes(t)) escolhas.push(t);
        }
      }
      if (escolhas.length === 0) return { ok: true, valor: null };
      if (pergunta.type === "single_choice" && escolhas.length > 1) {
        return { ok: false, error: "Escolha só uma opção." };
      }
      return { ok: true, valor: escolhas };
    }
  }
}

export interface Progresso {
  /** Perguntas que pedem resposta (seção fica de fora). */
  total: number;
  respondidas: number;
  /** Ids das obrigatórias ainda sem resposta — impedem concluir. */
  faltamObrigatorias: string[];
}

export function progresso(
  perguntas: PerguntaDoFormulario[],
  respostas: Record<string, SurveyAnswerValue | null | undefined>
): Progresso {
  const respondiveis = perguntas.filter((p) => p.type !== "section");
  const respondidas = respondiveis.filter((p) => !respostaVazia(respostas[p.id]));
  return {
    total: respondiveis.length,
    respondidas: respondidas.length,
    faltamObrigatorias: respondiveis
      .filter((p) => p.required && respostaVazia(respostas[p.id]))
      .map((p) => p.id),
  };
}
