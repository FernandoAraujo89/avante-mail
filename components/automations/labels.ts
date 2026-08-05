import type {
  AutomationStepType,
  AutomationStatus,
  AutomationTriggerType,
} from "@/lib/db/schema";
import type { StepDraft, TriggerDraft } from "@/lib/automations/arvore";

// Rótulos e resumos em português da tela de automações. Um lugar só: o cartão
// do passo, o painel lateral e a lista mostram o mesmo texto.

export const STATUS_LABEL: Record<AutomationStatus, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  archived: "Arquivada",
};

export const STEP_LABEL: Record<AutomationStepType, string> = {
  send_email: "Enviar e-mail",
  send_whatsapp: "Enviar WhatsApp",
  wait: "Aguardar",
  if_else: "Se/Então",
  add_tag: "Adicionar tag",
  remove_tag: "Remover tag",
  subscribe_list: "Inscrever na lista",
  unsubscribe_list: "Cancelar inscrição na lista",
  update_field: "Atualizar campo",
  webhook: "Webhook",
  end: "Fim",
};

/** Tipos oferecidos no "+", agrupados como no plano. */
export const STEP_MENU: { grupo: string; tipos: AutomationStepType[] }[] = [
  { grupo: "Envio", tipos: ["send_email", "send_whatsapp"] },
  { grupo: "Fluxo", tipos: ["wait", "if_else", "end"] },
  {
    grupo: "Contato",
    tipos: ["add_tag", "remove_tag", "subscribe_list", "unsubscribe_list"],
  },
  // Fase F. `update_field` continua fora: o motor ainda o recusa, e oferecer
  // no menu um passo que quebra o percurso seria pior que não oferecer.
  { grupo: "Integração", tipos: ["webhook"] },
];

export const TRIGGER_LABEL: Record<AutomationTriggerType, string> = {
  tag_added: "Tag adicionada",
  tag_removed: "Tag removida",
  list_subscribed: "Inscrito na lista",
  list_unsubscribed: "Inscrição cancelada",
  contact_created: "Contato criado",
  email_opened: "E-mail aberto",
  email_clicked: "Link clicado",
  whatsapp_replied: "Respondeu no WhatsApp",
  lead_score_changed: "Lead mudou de faixa de pontuação",
  manual: "Manual",
};

/**
 * Gatilhos oferecidos na tela.
 *
 * ATENÇÃO: é MENOR que AUTOMATION_TRIGGER_TYPES de propósito. O motor casa
 * qualquer tipo declarado contra os eventos (lib/automations/engine.ts), mas
 * `email_opened`, `email_clicked` e `whatsapp_replied` seguem fora daqui desde
 * a fase 1 — não por falta de suporte, e sim por decisão de produto que nunca
 * foi revista. Quem for expor esses três: o motor já os consome, basta
 * acrescentá-los nesta lista.
 */
export const TRIGGER_TYPES_DISPONIVEIS: AutomationTriggerType[] = [
  "tag_added",
  "tag_removed",
  "list_subscribed",
  "list_unsubscribed",
  "contact_created",
  "lead_score_changed",
];

/** Faixas oferecidas no gatilho de pontuação. Vazio = qualquer mudança. */
export const FAIXAS_DO_GATILHO: { valor: string; rotulo: string }[] = [
  { valor: "", rotulo: "Qualquer mudança de faixa" },
  { valor: "quente", rotulo: "Virou quente" },
  { valor: "aquecido", rotulo: "Virou aquecido" },
  { valor: "morno", rotulo: "Virou morno" },
  { valor: "frio", rotulo: "Esfriou (virou frio)" },
];

export const CONDITION_LABEL: Record<string, string> = {
  has_tag: "Tem a tag",
  in_list: "Está na lista",
  email_opened: "Abriu o e-mail",
  email_clicked: "Clicou no e-mail",
  whatsapp_replied: "Respondeu no WhatsApp",
  whatsapp_subscribed: "Aceita WhatsApp",
  field_equals: "Campo é igual a",
};

export const FIELD_LABEL: Record<string, string> = {
  name: "Nome",
  email: "E-mail",
  company: "Empresa",
  phone: "Telefone",
};

/** Nomes que o resumo precisa para não mostrar uuid na tela. */
export interface Catalogo {
  lists: { id: string; name: string }[];
  templates: { id: string; name: string }[];
  /** bodyText alimenta a prévia da mensagem no cartão do passo. */
  waTemplates: { id: string; name: string; bodyText?: string }[];
}

const VAZIO: Catalogo = { lists: [], templates: [], waTemplates: [] };

function nome(itens: { id: string; name: string }[], id: unknown): string {
  const achado = itens.find((i) => i.id === id);
  return achado?.name ?? "—";
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** "2 dias e 3 horas" a partir do config do Aguardar. */
export function resumoDaEspera(config: Record<string, unknown>): string {
  const partes: string[] = [];
  const dias = Number(config.days ?? 0);
  const horas = Number(config.hours ?? 0);
  const minutos = Number(config.minutes ?? 0);
  if (dias > 0) partes.push(`${dias} ${dias === 1 ? "dia" : "dias"}`);
  if (horas > 0) partes.push(`${horas} ${horas === 1 ? "hora" : "horas"}`);
  if (minutos > 0)
    partes.push(`${minutos} ${minutos === 1 ? "minuto" : "minutos"}`);
  if (partes.length === 0) return "sem tempo definido";
  return partes.join(" e ");
}

export function resumoDaCondicao(
  cond: Record<string, unknown>,
  catalogo: Catalogo = VAZIO
): string {
  const rotulo = CONDITION_LABEL[String(cond.type)] ?? String(cond.type);
  const nao = cond.negate ? "não " : "";
  switch (cond.type) {
    case "has_tag":
      return `${nao}tem a tag "${texto(cond.tag) || "—"}"`;
    case "in_list":
      return `${nao}está na lista ${nome(catalogo.lists, cond.listId)}`;
    case "field_equals":
      return `${FIELD_LABEL[String(cond.field)] ?? "campo"} ${nao ? "≠" : "="} "${texto(cond.value)}"`;
    default:
      return `${nao}${rotulo.toLowerCase()}`;
  }
}

/** Uma linha por passo, do jeito que aparece no cartão da árvore. */
export function resumoDoPasso(
  step: StepDraft,
  catalogo: Catalogo = VAZIO
): string {
  const c = step.config ?? {};
  switch (step.type) {
    case "wait":
      return resumoDaEspera(c);
    case "add_tag":
    case "remove_tag":
      return texto(c.tag) ? `"${texto(c.tag)}"` : "sem tag definida";
    case "subscribe_list":
    case "unsubscribe_list":
      return texto(c.listId) ? nome(catalogo.lists, c.listId) : "sem lista definida";
    case "send_email":
      return texto(c.subject) || "sem assunto definido";
    case "send_whatsapp":
      return texto(c.whatsappTemplateId)
        ? nome(catalogo.waTemplates, c.whatsappTemplateId)
        : "sem modelo definido";
    case "if_else": {
      const conds = Array.isArray(c.conditions) ? c.conditions : [];
      if (conds.length === 0) return "sem condição definida";
      const juncao = c.match === "any" ? " ou " : " e ";
      return conds
        .map((cond) => resumoDaCondicao(cond as Record<string, unknown>, catalogo))
        .join(juncao);
    }
    case "end":
      return "encerra o percurso";
    default:
      return "";
  }
}

/**
 * O cartão do passo em duas partes, no formato do print de referência:
 * um selo com o "o quê" (assunto, tag, modelo) e uma linha de prévia embaixo.
 * O selo é o que o usuário lê primeiro para reconhecer o passo na coluna.
 */
export function cartaoDoPasso(
  step: StepDraft,
  catalogo: Catalogo = VAZIO
): { chip: string | null; texto: string | null } {
  const c = step.config ?? {};

  switch (step.type) {
    case "send_email": {
      const modelo = texto(c.templateId)
        ? `Modelo: ${nome(catalogo.templates, c.templateId)}`
        : c.mjmlContent
          ? "E-mail montado no Criador"
          : "Sem conteúdo montado";
      return {
        chip: texto(c.subject) || null,
        texto: texto(c.preheader) || modelo,
      };
    }

    case "send_whatsapp": {
      const modelo = catalogo.waTemplates.find(
        (t) => t.id === c.whatsappTemplateId
      );
      return {
        chip: modelo?.name ?? null,
        texto: modelo?.bodyText ?? "Escolha o modelo aprovado da mensagem",
      };
    }

    case "wait":
      return {
        chip: resumoDaEspera(c),
        texto: "O contato espera antes de seguir para o próximo passo",
      };

    case "add_tag":
    case "remove_tag":
      return {
        chip: texto(c.tag) || null,
        texto:
          step.type === "add_tag"
            ? "Marca o contato com esta tag"
            : "Tira esta tag do contato",
      };

    case "subscribe_list":
    case "unsubscribe_list":
      return {
        chip: texto(c.listId) ? nome(catalogo.lists, c.listId) : null,
        texto:
          step.type === "subscribe_list"
            ? "Inscreve o contato na lista"
            : "Cancela a inscrição do contato na lista",
      };

    case "if_else":
      return {
        chip: null,
        texto: resumoDoPasso(step, catalogo),
      };

    case "end":
      return { chip: null, texto: "Encerra o percurso deste contato" };

    default:
      return { chip: null, texto: resumoDoPasso(step, catalogo) };
  }
}

export function resumoDoGatilho(
  trigger: TriggerDraft,
  catalogo: Catalogo = VAZIO
): string {
  const rotulo = TRIGGER_LABEL[trigger.type] ?? trigger.type;
  const c = trigger.config ?? {};
  switch (trigger.type) {
    case "tag_added":
    case "tag_removed":
      return `${rotulo}: "${texto(c.tag) || "—"}"`;
    case "list_subscribed":
    case "list_unsubscribed":
      return `${rotulo}: ${nome(catalogo.lists, c.listId)}`;
    case "lead_score_changed": {
      const faixa = texto(c.para);
      // Sem faixa escolhida, o cartão precisa dizer que é QUALQUER mudança —
      // senão "Lead mudou de faixa" parece configuração pela metade.
      return faixa
        ? FAIXAS_DO_GATILHO.find((f) => f.valor === faixa)?.rotulo ??
            `${rotulo}: ${faixa}`
        : `${rotulo}: qualquer faixa`;
    }
    default:
      return rotulo;
  }
}
