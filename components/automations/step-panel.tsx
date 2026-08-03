"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { DesignEditor } from "@/components/builder/design-editor";
import {
  WhatsAppMessageStep,
  type WaTemplateOption,
} from "@/components/campaigns/whatsapp-message-step";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StepDraft } from "@/lib/automations/arvore";
import { compileDesignToMjml } from "@/lib/email-builder/compile";
import { createDefaultDesign } from "@/lib/email-builder/presets";
import type { EmailDesign } from "@/lib/email-builder/types";
import type { WhatsAppVariableMap } from "@/lib/whatsapp/types";

import {
  CONDITION_LABEL,
  FIELD_LABEL,
  STEP_LABEL,
  type Catalogo,
} from "./labels";

// Painel lateral do passo selecionado — mesmo padrão do Criador de e-mails:
// a árvore mostra o fluxo, o painel configura o passo em foco.

const CONDITION_TYPES = Object.keys(CONDITION_LABEL);

export function StepPanel({
  step,
  catalogo,
  waTemplates,
  problemas,
  onChange,
}: {
  step: StepDraft | null;
  catalogo: Catalogo;
  waTemplates: WaTemplateOption[] | null;
  problemas: string[];
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [emailAberto, setEmailAberto] = useState(false);
  const [design, setDesign] = useState<EmailDesign | null>(null);
  const [erroDoDesign, setErroDoDesign] = useState("");

  if (!step) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Escolha um passo do fluxo para configurá-lo aqui.
      </div>
    );
  }

  const c = step.config ?? {};
  const set = (patch: Record<string, unknown>) => onChange({ ...c, ...patch });

  function abrirCriador() {
    const atual = (c.design as EmailDesign | undefined) ?? createDefaultDesign();
    setDesign(atual);
    setErroDoDesign("");
    setEmailAberto(true);
  }

  function salvarEmail() {
    if (!design) return;
    // O MJML compilado é o que o worker envia; o design fica para reabrir no
    // Criador. Guardar os dois evita ter que recompilar na hora do disparo.
    set({ design, mjmlContent: compileDesignToMjml(design), templateId: "" });
    setEmailAberto(false);
  }

  return (
    // O painel é estreito no desktop e largo no celular — os campos aqui
    // dentro respondem à largura DELE, não à da janela.
    <div className="@container grid gap-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Passo selecionado
        </p>
        <h3 className="text-base font-semibold">{STEP_LABEL[step.type]}</h3>
      </div>

      {problemas.length > 0 ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-hover">
          {problemas.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : null}

      {step.type === "wait" ? (
        <div className="grid grid-cols-2 gap-2 @xs:grid-cols-3">
          {(
            [
              ["days", "Dias"],
              ["hours", "Horas"],
              ["minutes", "Minutos"],
            ] as const
          ).map(([chave, rotulo]) => (
            <div key={chave} className="grid gap-1.5">
              <Label htmlFor={`wait-${chave}`}>{rotulo}</Label>
              <Input
                id={`wait-${chave}`}
                type="number"
                min={0}
                value={String(c[chave] ?? 0)}
                onChange={(e) =>
                  set({ [chave]: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </div>
          ))}
        </div>
      ) : null}

      {step.type === "add_tag" || step.type === "remove_tag" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="step-tag">Tag</Label>
          <Input
            id="step-tag"
            value={String(c.tag ?? "")}
            onChange={(e) => set({ tag: e.target.value.toLowerCase() })}
            placeholder="Ex.: lead-quente"
          />
        </div>
      ) : null}

      {step.type === "subscribe_list" || step.type === "unsubscribe_list" ? (
        <div className="grid gap-1.5">
          <Label>Lista</Label>
          <Select
            value={String(c.listId ?? "")}
            onValueChange={(listId) => set({ listId })}
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

      {step.type === "send_email" ? (
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="step-subject">Assunto *</Label>
            <Input
              id="step-subject"
              value={String(c.subject ?? "")}
              onChange={(e) => set({ subject: e.target.value })}
              placeholder="Ex.: Bem-vindo à Avante"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="step-preheader">Prévia (preheader)</Label>
            <Input
              id="step-preheader"
              value={String(c.preheader ?? "")}
              onChange={(e) => set({ preheader: e.target.value })}
              placeholder="Opcional — primeira linha na caixa de entrada"
            />
          </div>

          <div className="grid gap-2">
            <Label>Conteúdo</Label>
            <div className="grid gap-2">
              <Button variant="outline" onClick={abrirCriador}>
                {c.mjmlContent ? "Editar o e-mail" : "Montar o e-mail"}
              </Button>
              <p className="text-xs text-muted-foreground">ou use um modelo:</p>
              <Select
                value={String(c.templateId ?? "")}
                onValueChange={(templateId) =>
                  // O modelo é resolvido no envio; escolher um descarta o
                  // conteúdo próprio para não haver duas fontes da verdade.
                  set({ templateId, mjmlContent: "", design: undefined })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum modelo" />
                </SelectTrigger>
                <SelectContent>
                  {catalogo.templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ) : null}

      {step.type === "send_whatsapp" ? (
        <div className="grid gap-3">
          <WhatsAppMessageStep
            templates={waTemplates}
            selectedId={String(c.whatsappTemplateId ?? "")}
            variables={(c.variables as WhatsAppVariableMap) ?? {}}
            onSelect={(whatsappTemplateId) => set({ whatsappTemplateId })}
            onVariablesChange={(variables) => set({ variables })}
          />
        </div>
      ) : null}

      {step.type === "if_else" ? (
        <CondicoesDoPasso config={c} catalogo={catalogo} onChange={onChange} />
      ) : null}

      {step.type === "end" ? (
        <p className="text-sm text-muted-foreground">
          Encerra o percurso deste contato. Sem passos seguintes.
        </p>
      ) : null}

      <Dialog open={emailAberto} onOpenChange={setEmailAberto}>
        <DialogContent className="max-h-[92vh] max-w-[95vw] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>E-mail do passo</DialogTitle>
            <DialogDescription>
              Mesmo Criador das campanhas. O conteúdo fica salvo neste passo.
            </DialogDescription>
          </DialogHeader>
          {erroDoDesign ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
              {erroDoDesign}
            </div>
          ) : null}
          {design ? (
            <DesignEditor
              value={design}
              onChange={setDesign}
              onError={setErroDoDesign}
            />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={salvarEmail}>Usar este e-mail</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Editor das condições do Se/Então. */
function CondicoesDoPasso({
  config,
  catalogo,
  onChange,
}: {
  config: Record<string, unknown>;
  catalogo: Catalogo;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const conditions = (
    Array.isArray(config.conditions) ? config.conditions : []
  ) as Record<string, unknown>[];

  const atualizar = (i: number, patch: Record<string, unknown>) => {
    const novas = conditions.map((c, j) => (i === j ? { ...c, ...patch } : c));
    onChange({ ...config, conditions: novas });
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label>Combinação</Label>
        <Select
          value={config.match === "any" ? "any" : "all"}
          onValueChange={(match) => onChange({ ...config, match })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as condições (e)</SelectItem>
            <SelectItem value="any">Qualquer condição (ou)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {conditions.map((cond, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <Label>Condição {i + 1}</Label>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...config,
                  conditions: conditions.filter((_, j) => j !== i),
                })
              }
              aria-label={`Remover condição ${i + 1}`}
              className="text-muted-foreground hover:text-destructive cursor-pointer"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          <Select
            value={String(cond.type ?? "has_tag")}
            onValueChange={(type) => atualizar(i, { type })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONDITION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {CONDITION_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {cond.type === "has_tag" || cond.type === undefined ? (
            <Input
              value={String(cond.tag ?? "")}
              onChange={(e) =>
                atualizar(i, { tag: e.target.value.toLowerCase() })
              }
              placeholder="Tag"
            />
          ) : null}

          {cond.type === "in_list" ? (
            <Select
              value={String(cond.listId ?? "")}
              onValueChange={(listId) => atualizar(i, { listId })}
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
          ) : null}

          {cond.type === "field_equals" ? (
            <div className="grid gap-2">
              <Select
                value={String(cond.field ?? "company")}
                onValueChange={(field) => atualizar(i, { field })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FIELD_LABEL).map(([valor, rotulo]) => (
                    <SelectItem key={valor} value={valor}>
                      {rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={String(cond.value ?? "")}
                onChange={(e) => atualizar(i, { value: e.target.value })}
                placeholder="Valor"
              />
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={cond.negate === true}
              onChange={(e) => atualizar(i, { negate: e.target.checked })}
              className="size-4 cursor-pointer accent-[var(--primary)]"
            />
            Inverter (quando NÃO for verdade)
          </label>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            ...config,
            conditions: [...conditions, { type: "has_tag", tag: "" }],
          })
        }
      >
        <Plus />
        Adicionar condição
      </Button>
    </div>
  );
}
