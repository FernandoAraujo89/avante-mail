import type { AutomationStepType, AutomationTriggerType } from "@/lib/db/schema";

// Árvore do fluxo, do lado da tela (docs/plano-automacoes.md, fase 4).
//
// Funções puras sobre a lista de passos: a tela não faz nada "no lugar", e o
// mesmo arquivo serve para a coluna, os ramos e o arrastar. Nada aqui toca o
// banco — o id é temporário até salvar, e o servidor gera o definitivo.

export type Branch = "main" | "yes" | "no";

export interface StepDraft {
  id: string;
  parentId: string | null;
  branch: Branch;
  position: number;
  type: AutomationStepType;
  config: Record<string, unknown>;
}

export interface TriggerDraft {
  type: AutomationTriggerType;
  config: Record<string, unknown>;
}

export interface Destino {
  parentId: string | null;
  branch: Branch;
  position: number;
}

export function novoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp-${Math.random().toString(36).slice(2)}`;
}

/** Passos de um grupo (mesmo pai, mesmo ramo), em ordem. */
export function filhosDe(
  steps: StepDraft[],
  parentId: string | null,
  branch: Branch
): StepDraft[] {
  return steps
    .filter((s) => s.parentId === parentId && s.branch === branch)
    .sort((a, b) => a.position - b.position);
}

/** O passo e tudo que pende dele — um Se/Então carrega os dois ramos junto. */
export function descendentesDe(steps: StepDraft[], id: string): Set<string> {
  const marcados = new Set<string>([id]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const s of steps) {
      if (s.parentId && marcados.has(s.parentId) && !marcados.has(s.id)) {
        marcados.add(s.id);
        mudou = true;
      }
    }
  }
  return marcados;
}

/** Renumera cada grupo em 0..n, sem buracos. */
function reindexar(steps: StepDraft[]): StepDraft[] {
  const contadores = new Map<string, number>();
  return [...steps]
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      const grupo = `${s.parentId ?? "raiz"}/${s.branch}`;
      const position = contadores.get(grupo) ?? 0;
      contadores.set(grupo, position + 1);
      return { ...s, position };
    });
}

/** Config inicial de cada tipo — o suficiente para o passo já fazer sentido. */
export function configPadrao(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case "wait":
      return { days: 1, hours: 0, minutes: 0 };
    case "add_tag":
    case "remove_tag":
      return { tag: "" };
    case "subscribe_list":
    case "unsubscribe_list":
      return { listId: "" };
    case "send_email":
      return { subject: "" };
    case "send_whatsapp":
      return { whatsappTemplateId: "", variables: {} };
    case "if_else":
      return { match: "all", conditions: [{ type: "has_tag", tag: "" }] };
    default:
      return {};
  }
}

export function inserir(
  steps: StepDraft[],
  destino: Destino,
  type: AutomationStepType
): { steps: StepDraft[]; novo: StepDraft } {
  const novo: StepDraft = {
    id: novoId(),
    parentId: destino.parentId,
    branch: destino.branch,
    // +0.5 entra ENTRE os vizinhos; o reindexar logo abaixo devolve inteiros.
    position: destino.position - 0.5,
    type,
    config: configPadrao(type),
  };
  return { steps: reindexar([...steps, novo]), novo };
}

/** Remove o passo e o que pende dele. */
export function remover(steps: StepDraft[], id: string): StepDraft[] {
  const fora = descendentesDe(steps, id);
  return reindexar(steps.filter((s) => !fora.has(s.id)));
}

/**
 * Soltar um passo dentro do próprio ramo criaria um ciclo — a árvore deixaria
 * de ter fim e o motor rodaria em círculo. É o único movimento proibido.
 */
export function podeSoltar(
  steps: StepDraft[],
  id: string,
  destino: Destino
): boolean {
  if (!destino.parentId) return true;
  return !descendentesDe(steps, id).has(destino.parentId);
}

export function mover(
  steps: StepDraft[],
  id: string,
  destino: Destino
): StepDraft[] {
  if (!podeSoltar(steps, id, destino)) return steps;

  if (!steps.some((s) => s.id === id)) return steps;

  // A zona de soltura em k significa "antes de quem está em k": k − 0.5 cai
  // exatamente ali na ordenação, e vale igual para subir, descer ou trocar de
  // ramo. O reindexar devolve inteiros em seguida.
  return reindexar(
    steps.map((s) =>
      s.id === id
        ? {
            ...s,
            parentId: destino.parentId,
            branch: destino.branch,
            position: destino.position - 0.5,
          }
        : s
    )
  );
}

export function atualizarConfig(
  steps: StepDraft[],
  id: string,
  config: Record<string, unknown>
): StepDraft[] {
  return steps.map((s) => (s.id === id ? { ...s, config } : s));
}
