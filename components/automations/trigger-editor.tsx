"use client";

import { Plus, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TriggerDraft } from "@/lib/automations/arvore";
import type { AutomationTriggerType } from "@/lib/db/schema";

import { TRIGGER_LABEL, TRIGGER_TYPES_DISPONIVEIS, type Catalogo } from "./labels";

// Gatilhos de entrada: vários por automação. Um contato entra UMA vez (a
// reentrada é barrada no banco), então gatilho repetido não duplica percurso.

export function TriggerEditor({
  triggers,
  catalogo,
  onChange,
}: {
  triggers: TriggerDraft[];
  catalogo: Catalogo;
  onChange: (triggers: TriggerDraft[]) => void;
}) {
  const atualizar = (i: number, patch: Partial<TriggerDraft>) =>
    onChange(triggers.map((t, j) => (i === j ? { ...t, ...patch } : t)));

  return (
    <div className="grid gap-3">
      {triggers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sem gatilho, ninguém entra na automação.
        </p>
      ) : null}

      {triggers.map((trigger, i) => (
        <div
          key={i}
          className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <div className="grid gap-1.5">
            <Label>Quando</Label>
            <Select
              value={trigger.type}
              onValueChange={(type) =>
                atualizar(i, { type: type as AutomationTriggerType, config: {} })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPES_DISPONIVEIS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {trigger.type === "tag_added" || trigger.type === "tag_removed" ? (
            <div className="grid gap-1.5">
              <Label>Tag</Label>
              <Input
                value={String(trigger.config?.tag ?? "")}
                onChange={(e) =>
                  atualizar(i, { config: { tag: e.target.value.toLowerCase() } })
                }
                placeholder="Ex.: lead-quente"
              />
            </div>
          ) : null}

          {trigger.type === "list_subscribed" ||
          trigger.type === "list_unsubscribed" ? (
            <div className="grid gap-1.5">
              <Label>Lista</Label>
              <Select
                value={String(trigger.config?.listId ?? "")}
                onValueChange={(listId) => atualizar(i, { config: { listId } })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a lista" />
                </SelectTrigger>
                <SelectContent>
                  {catalogo.lists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {trigger.type === "contact_created" ? (
            <p className="text-sm text-muted-foreground">
              Vale para qualquer contato novo.
            </p>
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(triggers.filter((_, j) => j !== i))}
            aria-label={`Remover gatilho ${i + 1}`}
          >
            <Trash2 className="text-muted-foreground" />
          </Button>
        </div>
      ))}

      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([...triggers, { type: "tag_added", config: { tag: "" } }])
          }
        >
          <Plus />
          Adicionar gatilho
        </Button>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Zap className="mt-px size-3.5 shrink-0" />
        Cada contato entra uma única vez, mesmo que o gatilho aconteça de novo.
      </p>
    </div>
  );
}
