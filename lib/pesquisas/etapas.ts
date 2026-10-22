import type { SurveyAnswerValue } from "@/lib/db/schema";

import { respostaVazia, type PerguntaDoFormulario } from "./respostas";

// A página de resposta anda em ETAPAS, como um cadastro: boas-vindas, as
// perguntas em grupos e a conclusão. Com seções no formulário, cada seção é
// uma etapa (o título dela é o da tela); sem seções, as perguntas vão em
// grupos de até seis. Puro — a tela só desenha.

export const PERGUNTAS_POR_ETAPA = 6;

export interface Etapa {
  chave: string;
  titulo: string;
  descricao: string | null;
  perguntas: PerguntaDoFormulario[];
  /** Número da primeira pergunta desta etapa na contagem do formulário. */
  numeroInicial: number;
}

export function montarEtapas(perguntas: PerguntaDoFormulario[]): Etapa[] {
  const temSecao = perguntas.some((p) => p.type === "section");
  const etapas: Etapa[] = [];
  let numero = 1;

  if (temSecao) {
    let atual: Etapa | null = null;
    for (const p of perguntas) {
      if (p.type === "section") {
        atual = { chave: p.id, titulo: p.label, descricao: p.help, perguntas: [], numeroInicial: numero };
        etapas.push(atual);
        continue;
      }
      if (!atual) {
        atual = { chave: "inicio", titulo: "Para começar", descricao: null, perguntas: [], numeroInicial: numero };
        etapas.push(atual);
      }
      atual.perguntas.push(p);
      numero += 1;
    }
    return etapas.filter((e) => e.perguntas.length > 0);
  }

  const respondiveis = perguntas.filter((p) => p.type !== "section");
  const total = Math.ceil(respondiveis.length / PERGUNTAS_POR_ETAPA);
  for (let i = 0; i < total; i++) {
    const fatia = respondiveis.slice(i * PERGUNTAS_POR_ETAPA, (i + 1) * PERGUNTAS_POR_ETAPA);
    etapas.push({
      chave: `grupo-${i + 1}`,
      titulo: total === 1 ? "Suas respostas" : `Parte ${i + 1} de ${total}`,
      descricao: null,
      perguntas: fatia,
      numeroInicial: i * PERGUNTAS_POR_ETAPA + 1,
    });
  }
  return etapas;
}

/** Obrigatórias desta etapa ainda sem resposta — seguram o "Continuar". */
export function faltamNaEtapa(
  etapa: Etapa,
  respostas: Record<string, SurveyAnswerValue | null | undefined>
): string[] {
  return etapa.perguntas.filter((p) => p.required && respostaVazia(respostas[p.id])).map((p) => p.id);
}

/** A primeira etapa com algo por responder (para "continuar de onde parei"). */
export function primeiraEtapaPendente(
  etapas: Etapa[],
  respostas: Record<string, SurveyAnswerValue | null | undefined>
): number {
  const i = etapas.findIndex((e) => e.perguntas.some((p) => respostaVazia(respostas[p.id])));
  return i === -1 ? Math.max(0, etapas.length - 1) : i;
}

/** Estimativa honesta: uns 20 segundos por pergunta, mínimo de 1 minuto. */
export function minutosEstimados(totalDePerguntas: number): number {
  return Math.max(1, Math.round((totalDePerguntas * 20) / 60));
}
