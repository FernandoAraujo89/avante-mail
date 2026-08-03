"use client";

import { Fragment, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Flag,
  GripVertical,
  Mail,
  MessageCircle,
  Plus,
  Split,
  Tag,
  Trash2,
  Users,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  filhosDe,
  podeSoltar,
  type Branch,
  type Destino,
  type StepDraft,
} from "@/lib/automations/arvore";
import type { AutomationStepType } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

import {
  resumoDoPasso,
  STEP_LABEL,
  STEP_MENU,
  type Catalogo,
} from "./labels";

// Árvore do fluxo: uma coluna vertical com "+" entre os passos, e o Se/Então
// abrindo duas colunas (docs/plano-automacoes.md, seção 7).
//
// Nada de canvas livre: o fluxo é um trilho, não um grafo espalhado. Isso
// dispensa dependência nova, posições x/y para guardar e zoom — e funciona no
// celular, que um canvas não faria.

const ICONE: Record<AutomationStepType, typeof Mail> = {
  send_email: Mail,
  send_whatsapp: MessageCircle,
  wait: Clock,
  if_else: Split,
  add_tag: Tag,
  remove_tag: Tag,
  subscribe_list: Users,
  unsubscribe_list: Users,
  update_field: Tag,
  webhook: Split,
  end: Flag,
};

interface TreeProps {
  steps: StepDraft[];
  selectedId: string | null;
  /** stepId → problemas do passo (mostra o alerta no cartão). */
  problemas: Map<string, string[]>;
  catalogo: Catalogo;
  onSelect: (id: string) => void;
  onInsert: (destino: Destino, type: AutomationStepType) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, destino: Destino) => void;
}

export function StepTree(props: TreeProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [inserindoEm, setInserindoEm] = useState<Destino | null>(null);

  return (
    <>
      <div className="overflow-x-auto pb-2">
        <Coluna
          {...props}
          parentId={null}
          branch="main"
          dragId={dragId}
          setDragId={setDragId}
          abrirMenu={setInserindoEm}
        />
      </div>

      <Dialog
        open={inserindoEm !== null}
        onOpenChange={(open) => {
          if (!open) setInserindoEm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar passo</DialogTitle>
            <DialogDescription>
              O que o contato encontra neste ponto do fluxo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {STEP_MENU.map((grupo) => (
              <div key={grupo.grupo} className="grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {grupo.grupo}
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {grupo.tipos.map((tipo) => {
                    const Icone = ICONE[tipo];
                    return (
                      <button
                        key={tipo}
                        type="button"
                        onClick={() => {
                          if (inserindoEm) props.onInsert(inserindoEm, tipo);
                          setInserindoEm(null);
                        }}
                        className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm font-medium transition-colors hover:border-primary hover:bg-accent cursor-pointer"
                      >
                        <Icone className="size-4 text-primary" />
                        {STEP_LABEL[tipo]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ColunaProps extends TreeProps {
  parentId: string | null;
  branch: Branch;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  abrirMenu: (destino: Destino) => void;
}

function Coluna(props: ColunaProps) {
  const { steps, parentId, branch } = props;
  const itens = filhosDe(steps, parentId, branch);

  // Nada roda depois de um Se/Então: o percurso entra no ramo e não volta.
  // A coluna termina nele, e é por isso que não há "+" abaixo.
  const corte = itens.findIndex((s) => s.type === "if_else");
  const visiveis = corte >= 0 ? itens.slice(0, corte + 1) : itens;
  const fechada = corte >= 0;

  return (
    <div className="flex min-w-56 flex-col items-center">
      <Zona {...props} position={0} />
      {visiveis.map((step, i) => (
        <Fragment key={step.id}>
          <Cartao {...props} step={step} />
          {step.type === "if_else" ? <Ramos {...props} pai={step} /> : null}
          {step.type === "if_else" ? null : (
            <Zona {...props} position={i + 1} />
          )}
        </Fragment>
      ))}
      {visiveis.length === 0 && !fechada ? (
        <p className="py-2 text-xs text-muted-foreground">Nenhum passo aqui</p>
      ) : null}
    </div>
  );
}

/** Ponto de inserção: "+" parado, alvo de soltura durante o arraste. */
function Zona({
  parentId,
  branch,
  position,
  dragId,
  steps,
  abrirMenu,
  onMove,
}: ColunaProps & { position: number }) {
  const [over, setOver] = useState(false);
  const destino: Destino = { parentId, branch, position };

  if (dragId) {
    const permitido = podeSoltar(steps, dragId, destino);
    return (
      <div
        onDragOver={(e) => {
          if (!permitido) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragEnter={(e) => {
          if (!permitido) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!permitido) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          onMove(dragId, destino);
        }}
        className={cn(
          "my-1 h-3 w-40 rounded-full transition-colors",
          !permitido
            ? "bg-transparent"
            : over
              ? "bg-primary"
              : "bg-primary/20"
        )}
        aria-hidden="true"
      />
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="h-3 w-px bg-border" />
      <button
        type="button"
        onClick={() => abrirMenu(destino)}
        aria-label="Adicionar passo aqui"
        className="flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary cursor-pointer"
      >
        <Plus className="size-3.5" />
      </button>
      <div className="h-3 w-px bg-border" />
    </div>
  );
}

function Cartao({
  step,
  selectedId,
  problemas,
  catalogo,
  onSelect,
  onRemove,
  setDragId,
}: ColunaProps & { step: StepDraft }) {
  const Icone = ICONE[step.type];
  const problemasDoPasso = problemas.get(step.id) ?? [];
  const selecionado = selectedId === step.id;

  return (
    <div
      onClick={() => onSelect(step.id)}
      className={cn(
        "group relative w-56 rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition-colors cursor-pointer",
        selecionado
          ? "border-primary ring-[3px] ring-ring/30"
          : "border-border hover:border-primary/60",
        problemasDoPasso.length > 0 ? "border-destructive/60" : ""
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", step.id);
            e.dataTransfer.effectAllowed = "move";
            // Mudar o estado dentro do dragstart altera o DOM sob o elemento
            // arrastado e faz o Chrome CANCELAR o arraste. Adiar um tick deixa
            // o navegador capturar o drag antes das zonas aparecerem.
            window.setTimeout(() => setDragId(step.id), 0);
          }}
          onDragEnd={() => setDragId(null)}
          onClick={(e) => e.stopPropagation()}
          title="Arrastar para reordenar"
          className="mt-0.5 cursor-grab text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>

        <Icone className="mt-0.5 size-4 shrink-0 text-primary" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {STEP_LABEL[step.type]}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {resumoDoPasso(step, catalogo)}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(step.id);
          }}
          aria-label={`Remover passo ${STEP_LABEL[step.type]}`}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {problemasDoPasso.length > 0 ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive-hover">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {problemasDoPasso[0]}
        </p>
      ) : null}
    </div>
  );
}

/** Os dois lados de um Se/Então, lado a lado. */
function Ramos(props: ColunaProps & { pai: StepDraft }) {
  return (
    <div className="w-full">
      <div className="mx-auto h-3 w-px bg-border" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-center sm:gap-6">
        {(["yes", "no"] as const).map((ramo) => (
          <div key={ramo} className="flex flex-col items-center">
            <span
              className={cn(
                "rounded-sm px-2 py-1 text-xs font-semibold",
                ramo === "yes"
                  ? "bg-success-light text-success-dark"
                  : "bg-secondary text-secondary-foreground"
              )}
            >
              {ramo === "yes" ? "Sim" : "Não"}
            </span>
            <Coluna {...props} parentId={props.pai.id} branch={ramo} />
          </div>
        ))}
      </div>
    </div>
  );
}
