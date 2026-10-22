import type {
  SurveyAnswerValue,
  SurveyInviteStatus,
  SurveyQuestionOptions,
  SurveyQuestionType,
} from "@/lib/db/schema";

import { OUTRO_PREFIXO } from "./respostas";

// O relatório de uma pesquisa, puro: o funil dos convites, a agregação de
// cada pergunta pelo tipo e o NPS. A tela, a rota JSON e o CSV leem daqui —
// os três contam igual.

export interface ConviteDoRelatorio {
  id: string;
  status: SurveyInviteStatus;
  openedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  contato: { id: string; name: string; company: string | null };
}

export interface PerguntaDoRelatorio {
  id: string;
  type: SurveyQuestionType;
  label: string;
  options: SurveyQuestionOptions | null;
  isNps: boolean;
  /** Arquivada: sumiu do formulário, mas as respostas continuam valendo. */
  arquivada: boolean;
  position: number;
}

export interface RespostaDoRelatorio {
  inviteId: string;
  questionId: string;
  value: SurveyAnswerValue;
  updatedAt: string;
}

export interface Funil {
  convidados: number;
  abriram: number;
  comecaram: number;
  concluiram: number;
}

export function funil(convites: ConviteDoRelatorio[]): Funil {
  const abriu = (c: ConviteDoRelatorio) =>
    Boolean(c.openedAt || c.startedAt || c.completedAt) || c.status !== "pending";
  const comecou = (c: ConviteDoRelatorio) =>
    Boolean(c.startedAt || c.completedAt) || c.status === "in_progress" || c.status === "completed";
  return {
    convidados: convites.length,
    abriram: convites.filter(abriu).length,
    comecaram: convites.filter(comecou).length,
    concluiram: convites.filter((c) => c.status === "completed").length,
  };
}

export interface Nps {
  n: number;
  promotores: number;
  neutros: number;
  detratores: number;
  /** % promotores − % detratores, de −100 a 100. */
  score: number;
}

export function calcularNps(notas: number[]): Nps | null {
  if (notas.length === 0) return null;
  const promotores = notas.filter((n) => n >= 9).length;
  const detratores = notas.filter((n) => n <= 6).length;
  const n = notas.length;
  return {
    n,
    promotores,
    neutros: n - promotores - detratores,
    detratores,
    score: Math.round(((promotores - detratores) / n) * 100),
  };
}

export interface ItemDeBarra {
  rotulo: string;
  count: number;
  /** Sobre quem respondeu a pergunta (múltipla escolha pode somar mais de 100). */
  pct: number;
}

export type Agregado =
  | { tipo: "secao" }
  | {
      tipo: "barras";
      n: number;
      itens: ItemDeBarra[];
      outros: { texto: string; contato: string }[];
    }
  | {
      tipo: "escala";
      n: number;
      min: number;
      max: number;
      media: number;
      distribuicao: ItemDeBarra[];
      nps: Nps | null;
    }
  | { tipo: "simnao"; n: number; sim: number; nao: number }
  | { tipo: "numero"; n: number; media: number; mediana: number; minimo: number; maximo: number }
  | { tipo: "texto"; n: number; respostas: { texto: string; contato: string; data: string }[] };

const pct = (parte: number, todo: number) => (todo === 0 ? 0 : Math.round((parte / todo) * 100));

function mediana(valores: number[]): number {
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[meio - 1] + v[meio]) / 2 : v[meio];
}

export function agregar(
  pergunta: PerguntaDoRelatorio,
  respostas: RespostaDoRelatorio[],
  nomeDoContato: (inviteId: string) => string
): Agregado {
  const minhas = respostas.filter((r) => r.questionId === pergunta.id);
  const o = pergunta.options ?? {};

  switch (pergunta.type) {
    case "section":
      return { tipo: "secao" };

    case "single_choice":
    case "multiple_choice": {
      const contagem = new Map<string, number>();
      const outros: { texto: string; contato: string }[] = [];
      for (const r of minhas) {
        for (const escolha of Array.isArray(r.value) ? r.value : [String(r.value)]) {
          if (escolha.toLowerCase().startsWith(OUTRO_PREFIXO)) {
            outros.push({ texto: escolha.slice(OUTRO_PREFIXO.length), contato: nomeDoContato(r.inviteId) });
            contagem.set("Outro", (contagem.get("Outro") ?? 0) + 1);
          } else {
            contagem.set(escolha, (contagem.get(escolha) ?? 0) + 1);
          }
        }
      }
      // Na ordem do modelo, inclusive as que ninguém marcou; depois o que sobrou.
      const ordem = [...(o.choices ?? []), ...(o.other ? ["Outro"] : [])];
      const itens: ItemDeBarra[] = ordem.map((rotulo) => ({
        rotulo,
        count: contagem.get(rotulo) ?? 0,
        pct: pct(contagem.get(rotulo) ?? 0, minhas.length),
      }));
      for (const [rotulo, count] of contagem) {
        if (!ordem.includes(rotulo)) itens.push({ rotulo, count, pct: pct(count, minhas.length) });
      }
      return { tipo: "barras", n: minhas.length, itens, outros };
    }

    case "scale": {
      const min = o.min ?? 0;
      const max = o.max ?? 10;
      const notas = minhas.map((r) => Number(r.value)).filter((n) => Number.isFinite(n));
      const distribuicao: ItemDeBarra[] = [];
      for (let v = min; v <= max; v++) {
        const count = notas.filter((n) => n === v).length;
        distribuicao.push({ rotulo: String(v), count, pct: pct(count, notas.length) });
      }
      const media = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
      return {
        tipo: "escala",
        n: notas.length,
        min,
        max,
        media: Math.round(media * 10) / 10,
        distribuicao,
        nps: pergunta.isNps ? calcularNps(notas) : null,
      };
    }

    case "yes_no": {
      const sim = minhas.filter((r) => r.value === true).length;
      return { tipo: "simnao", n: minhas.length, sim, nao: minhas.length - sim };
    }

    case "number": {
      const valores = minhas.map((r) => Number(r.value)).filter((n) => Number.isFinite(n));
      if (valores.length === 0) {
        return { tipo: "numero", n: 0, media: 0, mediana: 0, minimo: 0, maximo: 0 };
      }
      const media = valores.reduce((a, b) => a + b, 0) / valores.length;
      return {
        tipo: "numero",
        n: valores.length,
        media: Math.round(media * 100) / 100,
        mediana: mediana(valores),
        minimo: Math.min(...valores),
        maximo: Math.max(...valores),
      };
    }

    case "short_text":
    case "long_text":
      return {
        tipo: "texto",
        n: minhas.length,
        respostas: minhas
          .map((r) => ({ texto: String(r.value), contato: nomeDoContato(r.inviteId), data: r.updatedAt }))
          .sort((a, b) => b.data.localeCompare(a.data)),
      };
  }
}

export interface Relatorio {
  funil: Funil;
  nps: Nps | null;
  perguntas: { pergunta: PerguntaDoRelatorio; agregado: Agregado }[];
}

export function relatorio(
  perguntas: PerguntaDoRelatorio[],
  respostas: RespostaDoRelatorio[],
  convites: ConviteDoRelatorio[]
): Relatorio {
  const nomes = new Map(convites.map((c) => [c.id, c.contato.name]));
  const nome = (inviteId: string) => nomes.get(inviteId) ?? "—";
  const ordenadas = [...perguntas].sort(
    (a, b) => Number(a.arquivada) - Number(b.arquivada) || a.position - b.position
  );
  const itens = ordenadas.map((pergunta) => ({ pergunta, agregado: agregar(pergunta, respostas, nome) }));
  const npsItem = itens.find((i) => i.agregado.tipo === "escala" && i.agregado.nps);
  return {
    funil: funil(convites),
    nps: npsItem && npsItem.agregado.tipo === "escala" ? npsItem.agregado.nps : null,
    perguntas: itens,
  };
}

/** Como uma resposta aparece numa célula (CSV, ficha do parceiro). */
export function formatarValor(value: SurveyAnswerValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) {
    return value
      .map((v) => (v.toLowerCase().startsWith(OUTRO_PREFIXO) ? `Outro: ${v.slice(OUTRO_PREFIXO.length)}` : v))
      .join("; ");
  }
  return String(value);
}

export const CONVITE_STATUS_CSV: Record<SurveyInviteStatus, string> = {
  pending: "Convidado",
  opened: "Abriu",
  in_progress: "Respondendo",
  completed: "Concluída",
  closed: "Encerrado",
};

/** Uma linha por convite, uma coluna por pergunta. */
export function linhasCsv(
  perguntas: PerguntaDoRelatorio[],
  respostas: RespostaDoRelatorio[],
  convites: ConviteDoRelatorio[]
): { headers: string[]; rows: string[][] } {
  const colunas = perguntas
    .filter((p) => p.type !== "section")
    .sort((a, b) => Number(a.arquivada) - Number(b.arquivada) || a.position - b.position);
  const porConvite = new Map<string, Map<string, SurveyAnswerValue>>();
  for (const r of respostas) {
    const m = porConvite.get(r.inviteId) ?? new Map();
    m.set(r.questionId, r.value);
    porConvite.set(r.inviteId, m);
  }
  return {
    headers: [
      "Parceiro",
      "Empresa",
      "Situação",
      "Concluído em",
      ...colunas.map((p) => (p.arquivada ? `${p.label} (arquivada)` : p.label)),
    ],
    rows: convites.map((c) => [
      c.contato.name,
      c.contato.company ?? "",
      CONVITE_STATUS_CSV[c.status],
      c.completedAt ?? "",
      ...colunas.map((p) => formatarValor(porConvite.get(c.id)?.get(p.id))),
    ]),
  };
}
