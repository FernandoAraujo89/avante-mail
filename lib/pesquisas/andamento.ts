import type { SurveyInviteStatus } from "@/lib/db/schema";

// O andamento de uma pesquisa: quantos convidados estão em cada situação e a
// barra segmentada que a tela desenha. Puro — a lista, o acompanhamento e o
// painel contam igual.

export interface Andamento {
  convidados: number;
  /** Ainda sem abrir o link. */
  pendentes: number;
  abriram: number;
  respondendo: number;
  concluidas: number;
  encerrados: number;
  /** % de convidados que concluíram (0–100). */
  pctConcluidas: number;
}

export function andamento(convites: { status: SurveyInviteStatus }[]): Andamento {
  const conta = (s: SurveyInviteStatus) => convites.filter((c) => c.status === s).length;
  const convidados = convites.length;
  const concluidas = conta("completed");
  return {
    convidados,
    pendentes: conta("pending"),
    abriram: conta("opened"),
    respondendo: conta("in_progress"),
    concluidas,
    encerrados: conta("closed"),
    pctConcluidas: convidados === 0 ? 0 : Math.round((concluidas / convidados) * 100),
  };
}

export interface Segmento {
  chave: "concluidas" | "respondendo" | "abriram" | "pendentes" | "encerrados";
  rotulo: string;
  valor: number;
  /** Largura na barra, em % dos convidados. */
  pct: number;
}

/** Os segmentos da barra, do mais avançado ao menos — sem os vazios. */
export function segmentos(a: Andamento): Segmento[] {
  const pct = (v: number) => (a.convidados === 0 ? 0 : (v / a.convidados) * 100);
  const todos: Segmento[] = [
    { chave: "concluidas", rotulo: "Concluíram", valor: a.concluidas, pct: pct(a.concluidas) },
    { chave: "respondendo", rotulo: "Respondendo", valor: a.respondendo, pct: pct(a.respondendo) },
    { chave: "abriram", rotulo: "Abriram o link", valor: a.abriram, pct: pct(a.abriram) },
    { chave: "pendentes", rotulo: "Só convidados", valor: a.pendentes, pct: pct(a.pendentes) },
    { chave: "encerrados", rotulo: "Encerrados", valor: a.encerrados, pct: pct(a.encerrados) },
  ];
  return todos.filter((s) => s.valor > 0);
}
