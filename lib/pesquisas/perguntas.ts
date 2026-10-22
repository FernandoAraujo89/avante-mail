import {
  SURVEY_OBJECTIVES,
  SURVEY_QUESTION_TYPES,
  SURVEY_STATUSES,
  type SurveyObjective,
  type SurveyQuestionOptions,
  type SurveyQuestionType,
  type SurveyStatus,
} from "@/lib/db/schema";

import { LIMITES_DA_MENSAGEM } from "./mensagens";

// Regras do construtor de pesquisa — puras, sem banco. A API valida por aqui
// e devolve a mensagem como está: ela já diz qual pergunta tem o problema.

export const LIMITES = {
  perguntas: 60,
  nome: 120,
  intro: 2000,
  thanks: 1000,
  rotulo: 300,
  ajuda: 500,
  opcoes: 20,
  opcao: 120,
  rotuloEscala: 40,
  unidade: 20,
  escalaMax: 10,
} as const;

/** Uma pergunta como chega do construtor (id nulo = nova). */
export interface PerguntaEntrada {
  id: string | null;
  type: SurveyQuestionType;
  label: string;
  help: string | null;
  required: boolean;
  options: SurveyQuestionOptions | null;
  isNps: boolean;
}

/** Seção é título; tudo o mais pede resposta. */
export function ehRespondivel(type: SurveyQuestionType): boolean {
  return type !== "section";
}

/** Configuração inicial ao escolher o tipo no construtor. */
export function opcoesPadrao(type: SurveyQuestionType): SurveyQuestionOptions | null {
  if (type === "single_choice" || type === "multiple_choice") {
    return { choices: ["Opção 1", "Opção 2"] };
  }
  if (type === "scale") return { min: 0, max: 10 };
  if (type === "number") return {};
  return null;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function textoOuNulo(valor: unknown, limite: number, campo: string): string | null {
  const t = texto(valor);
  if (!t) return null;
  if (t.length > limite) {
    throw new Error(`${campo} pode ter no máximo ${limite} caracteres.`);
  }
  return t;
}

export function ehObjetivo(valor: unknown): valor is SurveyObjective {
  return (
    typeof valor === "string" &&
    (SURVEY_OBJECTIVES as readonly string[]).includes(valor)
  );
}

export function ehStatus(valor: unknown): valor is SurveyStatus {
  return (
    typeof valor === "string" &&
    (SURVEY_STATUSES as readonly string[]).includes(valor)
  );
}

function ehTipo(valor: unknown): valor is SurveyQuestionType {
  return (
    typeof valor === "string" &&
    (SURVEY_QUESTION_TYPES as readonly string[]).includes(valor)
  );
}

export type ParsePesquisa =
  | { ok: true; dados: { name: string; intro: string | null; thanks: string | null } }
  | { ok: false; error: string };

/** Nome e textos da pesquisa. Campos ausentes ficam de fora do patch. */
export function parsePesquisa(body: unknown): ParsePesquisa {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = texto(b.name);
  if (!name) return { ok: false, error: "Dê um nome à pesquisa." };
  if (name.length > LIMITES.nome) {
    return { ok: false, error: `O nome pode ter no máximo ${LIMITES.nome} caracteres.` };
  }
  try {
    return {
      ok: true,
      dados: {
        name,
        intro: textoOuNulo(b.intro, LIMITES.intro, "O texto de abertura"),
        thanks: textoOuNulo(b.thanks, LIMITES.thanks, "O texto de agradecimento"),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function opcoesDoTipo(
  type: SurveyQuestionType,
  cru: unknown,
  n: number
): SurveyQuestionOptions | null {
  const o = (cru && typeof cru === "object" ? cru : {}) as Record<string, unknown>;

  if (type === "single_choice" || type === "multiple_choice") {
    const brutas = Array.isArray(o.choices) ? o.choices : [];
    const choices = brutas.map(texto).filter(Boolean);
    if (choices.length < 2) {
      throw new Error(`Pergunta ${n}: uma escolha precisa de pelo menos 2 opções.`);
    }
    if (choices.length > LIMITES.opcoes) {
      throw new Error(`Pergunta ${n}: no máximo ${LIMITES.opcoes} opções.`);
    }
    if (choices.some((c) => c.length > LIMITES.opcao)) {
      throw new Error(
        `Pergunta ${n}: cada opção pode ter no máximo ${LIMITES.opcao} caracteres.`
      );
    }
    if (new Set(choices.map((c) => c.toLowerCase())).size !== choices.length) {
      throw new Error(`Pergunta ${n}: há opções repetidas.`);
    }
    return { choices, ...(o.other === true ? { other: true } : {}) };
  }

  if (type === "scale") {
    const min = o.min === 1 ? 1 : 0;
    const max = typeof o.max === "number" && Number.isInteger(o.max) ? o.max : 10;
    if (max <= min || max > LIMITES.escalaMax) {
      throw new Error(
        `Pergunta ${n}: a escala vai de 0 ou 1 até no máximo ${LIMITES.escalaMax}.`
      );
    }
    const minLabel = texto(o.minLabel);
    const maxLabel = texto(o.maxLabel);
    if (minLabel.length > LIMITES.rotuloEscala || maxLabel.length > LIMITES.rotuloEscala) {
      throw new Error(
        `Pergunta ${n}: os rótulos da escala têm no máximo ${LIMITES.rotuloEscala} caracteres.`
      );
    }
    return {
      min,
      max,
      ...(minLabel ? { minLabel } : {}),
      ...(maxLabel ? { maxLabel } : {}),
    };
  }

  if (type === "number") {
    const unit = texto(o.unit);
    if (unit.length > LIMITES.unidade) {
      throw new Error(`Pergunta ${n}: a unidade tem no máximo ${LIMITES.unidade} caracteres.`);
    }
    return unit ? { unit } : {};
  }

  return null;
}

export type ParsePerguntas =
  | { ok: true; perguntas: PerguntaEntrada[] }
  | { ok: false; error: string };

/** A lista inteira do construtor, na ordem em que deve ficar. */
export function parsePerguntas(body: unknown): ParsePerguntas {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.questions)) {
    return { ok: false, error: "Envie a lista de perguntas." };
  }
  if (b.questions.length > LIMITES.perguntas) {
    return { ok: false, error: `Uma pesquisa tem no máximo ${LIMITES.perguntas} perguntas.` };
  }

  try {
    const perguntas: PerguntaEntrada[] = [];
    let nps = 0;
    b.questions.forEach((item: unknown, i: number) => {
      const n = i + 1;
      const q = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      if (!ehTipo(q.type)) throw new Error(`Pergunta ${n}: tipo inválido.`);
      const label = texto(q.label);
      if (!label) {
        throw new Error(
          q.type === "section"
            ? `Pergunta ${n}: a seção precisa de um título.`
            : `Pergunta ${n}: escreva o enunciado.`
        );
      }
      if (label.length > LIMITES.rotulo) {
        throw new Error(`Pergunta ${n}: o enunciado tem no máximo ${LIMITES.rotulo} caracteres.`);
      }
      const help = textoOuNulo(q.help, LIMITES.ajuda, `Pergunta ${n}: o texto de ajuda`);
      const isNps = q.isNps === true;
      const options = opcoesDoTipo(q.type, q.options, n);
      if (isNps) {
        if (q.type !== "scale" || options?.min !== 0 || options?.max !== 10) {
          throw new Error(`Pergunta ${n}: a pergunta do NPS precisa ser uma escala de 0 a 10.`);
        }
        nps += 1;
        if (nps > 1) throw new Error("Só uma pergunta pode ser a do NPS.");
      }
      perguntas.push({
        id: typeof q.id === "string" && q.id ? q.id : null,
        type: q.type,
        label,
        help,
        required: q.type !== "section" && q.required === true,
        options,
        isNps,
      });
    });
    return { ok: true, perguntas };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** O que o banco sabe de uma pergunta antes de salvar a lista nova. */
export interface PerguntaExistente {
  id: string;
  type: SurveyQuestionType;
  temRespostas: boolean;
  arquivada: boolean;
}

export interface DiffPerguntas {
  criar: (PerguntaEntrada & { position: number })[];
  atualizar: (PerguntaEntrada & { id: string; position: number })[];
  /** Saíram da lista mas já têm resposta: somem do formulário, ficam no relatório. */
  arquivar: string[];
  /** Saíram da lista e ninguém respondeu: podem ir embora. */
  remover: string[];
}

export type ResultadoDiff =
  | { ok: true; diff: DiffPerguntas }
  | { ok: false; error: string };

/**
 * Compara a lista nova com a existente. A regra que protege o relatório:
 * pergunta com resposta não troca de tipo nem é apagada.
 */
export function diffPerguntas(
  existentes: PerguntaExistente[],
  novas: PerguntaEntrada[]
): ResultadoDiff {
  const porId = new Map(existentes.map((e) => [e.id, e]));
  const vistas = new Set<string>();
  const diff: DiffPerguntas = { criar: [], atualizar: [], arquivar: [], remover: [] };

  for (const [i, nova] of novas.entries()) {
    if (!nova.id) {
      diff.criar.push({ ...nova, position: i });
      continue;
    }
    const atual = porId.get(nova.id);
    if (!atual) {
      return { ok: false, error: `Pergunta ${i + 1}: não existe mais nesta pesquisa.` };
    }
    if (vistas.has(nova.id)) {
      return { ok: false, error: `Pergunta ${i + 1}: aparece duas vezes.` };
    }
    vistas.add(nova.id);
    if (atual.temRespostas && atual.type !== nova.type) {
      return {
        ok: false,
        error: `Pergunta ${i + 1}: já tem respostas, então o tipo não pode mudar. Remova-a (fica arquivada) e crie outra.`,
      };
    }
    diff.atualizar.push({ ...nova, id: nova.id, position: i });
  }

  for (const e of existentes) {
    if (vistas.has(e.id) || e.arquivada) continue;
    (e.temRespostas ? diff.arquivar : diff.remover).push(e.id);
  }

  return { ok: true, diff };
}

/**
 * Rascunho → ativa (com pelo menos uma pergunta que pede resposta);
 * ativa → encerrada; encerrada → ativa (reabrir). O resto não existe.
 */
export function transicaoDeStatus(
  atual: SurveyStatus,
  novo: SurveyStatus,
  perguntasRespondiveis: number
): { ok: true } | { ok: false; error: string } {
  if (atual === novo) return { ok: true };
  if (novo === "active") {
    if (perguntasRespondiveis === 0) {
      return { ok: false, error: "Adicione pelo menos uma pergunta antes de ativar." };
    }
    return { ok: true };
  }
  if (novo === "closed" && atual === "active") return { ok: true };
  if (novo === "draft") {
    return { ok: false, error: "Uma pesquisa ativada não volta a rascunho — encerre-a." };
  }
  return { ok: false, error: "Mudança de situação inválida." };
}

export type ParseMensagens =
  | { ok: true; dados: { emailSubject: string | null; emailBody: string | null } }
  | { ok: false; error: string };

/** Assunto e corpo do convite por e-mail (vazios = usar o texto padrão). */
export function parseMensagens(body: unknown): ParseMensagens {
  const b = (body ?? {}) as Record<string, unknown>;
  try {
    return {
      ok: true,
      dados: {
        emailSubject: textoOuNulo(b.emailSubject, LIMITES_DA_MENSAGEM.assunto, "O assunto do e-mail"),
        emailBody: textoOuNulo(b.emailBody, LIMITES_DA_MENSAGEM.corpo, "O texto do e-mail"),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

