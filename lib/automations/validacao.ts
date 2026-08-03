import {
  AUTOMATION_STEP_TYPES,
  type AutomationStepType,
  type AutomationTriggerType,
} from "@/lib/db";
import { getSetting } from "@/lib/settings";

import { lerCondicoes } from "./condicoes";
import { esperaEmMs } from "./engine";
import { lerConfigDeEmail, lerConfigDeWhatsApp } from "./envios";

// Validação do fluxo (docs/plano-automacoes.md, fases 4 e 8).
//
// Rascunho pela metade PODE ser salvo — quem edita um fluxo grande não vai
// terminá-lo de uma vez. O que não pode é ATIVAR com problema: automação erra
// em silêncio e em escala, então a hora de barrar é a de ligar.

/** Teto de automações ativas ao mesmo tempo (app_settings, para mudar sem deploy). */
export const AUTOMATIONS_MAX_ACTIVE_KEY = "automations_max_active";
const TETO_PADRAO = 5;

export async function tetoDeAtivas(): Promise<number> {
  const bruto = await getSetting(AUTOMATIONS_MAX_ACTIVE_KEY);
  const valor = Number(bruto);
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : TETO_PADRAO;
}

export interface GatilhoDoFluxo {
  type: AutomationTriggerType;
  config: Record<string, unknown> | null;
}

export interface PassoDoFluxo {
  id: string;
  parentId: string | null;
  branch: string;
  position: number;
  type: AutomationStepType;
  config: Record<string, unknown> | null;
}

export interface Problema {
  /** Passo a que o problema se refere; ausente = problema do fluxo inteiro. */
  stepId?: string;
  mensagem: string;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function erro(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Laço infinito: a automação dispara pela tag que ela mesma adiciona.
 * É o erro mais fácil de cometer e o mais caro — manda mensagem em looping e
 * gasta dinheiro real. O teto de passos por percurso segura o estrago; esta
 * checagem evita que o estrago comece.
 */
function problemasDeLaco(
  gatilhos: GatilhoDoFluxo[],
  passos: PassoDoFluxo[]
): Problema[] {
  const pares: [AutomationTriggerType, AutomationStepType, string][] = [
    ["tag_added", "add_tag", "tag"],
    ["tag_removed", "remove_tag", "tag"],
    ["list_subscribed", "subscribe_list", "listId"],
    ["list_unsubscribed", "unsubscribe_list", "listId"],
  ];

  const problemas: Problema[] = [];
  for (const [tipoGatilho, tipoPasso, chave] of pares) {
    for (const gatilho of gatilhos.filter((g) => g.type === tipoGatilho)) {
      const alvo = texto(gatilho.config?.[chave]).toLowerCase();
      if (!alvo) continue;
      for (const passo of passos.filter((p) => p.type === tipoPasso)) {
        if (texto(passo.config?.[chave]).toLowerCase() !== alvo) continue;
        problemas.push({
          stepId: passo.id,
          mensagem:
            `Este passo refaz o que dispara a automação (${alvo}) — ela entraria ` +
            `em laço. Remova o passo ou troque o gatilho.`,
        });
      }
    }
  }
  return problemas;
}

/** Todos os problemas do fluxo. Vazio = pode ativar. */
export function validarFluxo(
  gatilhos: GatilhoDoFluxo[],
  passos: PassoDoFluxo[]
): Problema[] {
  const problemas: Problema[] = [];

  if (gatilhos.length === 0) {
    problemas.push({ mensagem: "Escolha ao menos um gatilho de entrada." });
  }
  for (const gatilho of gatilhos) {
    if (
      (gatilho.type === "tag_added" || gatilho.type === "tag_removed") &&
      !texto(gatilho.config?.tag)
    ) {
      problemas.push({ mensagem: "Há um gatilho de tag sem a tag definida." });
    }
    if (
      (gatilho.type === "list_subscribed" ||
        gatilho.type === "list_unsubscribed") &&
      !texto(gatilho.config?.listId)
    ) {
      problemas.push({ mensagem: "Há um gatilho de lista sem a lista definida." });
    }
  }

  if (passos.length === 0) {
    problemas.push({ mensagem: "Adicione ao menos um passo ao fluxo." });
  }

  const porId = new Map(passos.map((p) => [p.id, p]));

  for (const passo of passos) {
    if (!AUTOMATION_STEP_TYPES.includes(passo.type)) {
      problemas.push({
        stepId: passo.id,
        mensagem: `Tipo de passo desconhecido: ${passo.type}.`,
      });
      continue;
    }

    // Estrutura da árvore: filho só existe embaixo de um Se/Então.
    if (passo.parentId) {
      const pai = porId.get(passo.parentId);
      if (!pai) {
        problemas.push({
          stepId: passo.id,
          mensagem: "Passo solto: o passo do qual ele depende não existe mais.",
        });
      } else if (pai.type !== "if_else") {
        problemas.push({
          stepId: passo.id,
          mensagem: "Só um Se/Então pode ter passos embaixo dele.",
        });
      } else if (passo.branch !== "yes" && passo.branch !== "no") {
        problemas.push({
          stepId: passo.id,
          mensagem: "Passo dentro de um Se/Então sem lado definido.",
        });
      }
    }

    try {
      switch (passo.type) {
        case "wait":
          if (esperaEmMs(passo.config) <= 0) {
            throw new Error("Defina quanto tempo esperar.");
          }
          break;
        case "add_tag":
        case "remove_tag":
          if (!texto(passo.config?.tag)) throw new Error("Escolha a tag deste passo.");
          break;
        case "subscribe_list":
        case "unsubscribe_list":
          if (!texto(passo.config?.listId)) throw new Error("Escolha a lista deste passo.");
          break;
        case "send_email":
          lerConfigDeEmail(passo.config);
          break;
        case "send_whatsapp":
          lerConfigDeWhatsApp(passo.config);
          break;
        case "if_else": {
          lerCondicoes(passo.config);
          const filhos = passos.filter((p) => p.parentId === passo.id);
          if (filhos.length === 0) {
            throw new Error("Nenhum dos dois lados tem passos — o percurso terminaria aqui.");
          }
          break;
        }
        case "end":
        case "update_field":
        case "webhook":
          break;
      }
    } catch (e) {
      problemas.push({ stepId: passo.id, mensagem: erro(e) });
    }
  }

  // Nada roda depois de um Se/Então: o percurso entra no ramo e não volta.
  // Um passo abaixo dele no mesmo grupo é código morto — a tela não deixa
  // criar, mas um fluxo importado ou editado por API pode ter.
  for (const passo of passos.filter((p) => p.type === "if_else")) {
    const irmaosDepois = passos.filter(
      (p) =>
        p.parentId === passo.parentId &&
        p.branch === passo.branch &&
        p.position > passo.position
    );
    for (const morto of irmaosDepois) {
      problemas.push({
        stepId: morto.id,
        mensagem:
          "Passo inalcançável: nada roda depois de um Se/Então — mova-o para dentro de um dos lados.",
      });
    }
  }

  problemas.push(...problemasDeLaco(gatilhos, passos));

  return problemas;
}
