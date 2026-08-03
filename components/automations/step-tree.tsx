"use client";

import { Fragment, useState } from "react";
import {
  AlertTriangle,
  CheckCheck,
  Clock,
  Flag,
  GripVertical,
  Mail,
  MailOpen,
  MessageCircle,
  MousePointerClick,
  Plus,
  Send,
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
  cartaoDoPasso,
  STEP_LABEL,
  STEP_MENU,
  type Catalogo,
} from "./labels";

/** "16,6%" — taxa sobre o total, no formato do resto do sistema. */
function taxa(parte: number, total: number): string {
  if (total <= 0) return "0%";
  return `${((parte / total) * 100).toFixed(1).replace(".", ",")}%`;
}

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

/** Números do passo, quando a automação já rodou (fase 5). */
export interface MetricaDoCartao {
  agora: number;
  passaram: number;
  envios: {
    enviados: number;
    entregues: number;
    abertos: number;
    cliques: number;
  } | null;
}

interface TreeProps {
  steps: StepDraft[];
  selectedId: string | null;
  /** stepId → problemas do passo (mostra o alerta no cartão). */
  problemas: Map<string, string[]>;
  /** stepId → contadores; vazio enquanto ninguém percorreu o fluxo. */
  metricas: Map<string, MetricaDoCartao>;
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
      <div className="@container overflow-x-auto pb-2">
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

  // Nada roda depois de um Se/Então: o percurso entra no ramo e não volta. Por
  // isso não há "+" abaixo dele — mas o que JÁ estiver ali continua na tela,
  // marcado. Esconder um passo que a validação acusa deixaria o usuário sem
  // como consertar o que a mensagem de erro está pedindo.
  const corte = itens.findIndex((s) => s.type === "if_else");

  return (
    // w-full de propósito: é o que faz o Se/Então lá dentro enxergar a largura
    // REAL disponível. Coluna do tamanho do cartão faria a container query
    // medir 288px e empilhar os ramos mesmo com espaço de sobra na tela.
    <div className="flex w-full min-w-72 flex-col items-center">
      <Zona {...props} position={0} />
      {itens.map((step, i) => (
        <Fragment key={step.id}>
          <Cartao
            {...props}
            step={step}
            inalcancavel={corte >= 0 && i > corte}
          />
          {step.type === "if_else" ? <Ramos {...props} pai={step} /> : null}
          {step.type === "if_else" ? null : (
            <Zona {...props} position={i + 1} />
          )}
        </Fragment>
      ))}
      {itens.length === 0 ? (
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
          "my-1 h-3 w-56 rounded-full transition-colors",
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
  metricas,
  catalogo,
  onSelect,
  onRemove,
  setDragId,
  inalcancavel = false,
}: ColunaProps & { step: StepDraft; inalcancavel?: boolean }) {
  const Icone = ICONE[step.type];
  const problemasDoPasso = problemas.get(step.id) ?? [];
  const metrica = metricas.get(step.id);
  const selecionado = selectedId === step.id;
  const alerta = inalcancavel
    ? "Nada roda depois de um Se/Então — arraste este passo para dentro do lado Sim ou Não, ou remova-o."
    : problemasDoPasso[0];

  const { chip, texto } = cartaoDoPasso(step, catalogo);

  return (
    <div
      onClick={() => onSelect(step.id)}
      className={cn(
        "group relative w-72 overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-colors cursor-pointer",
        selecionado
          ? "border-primary ring-[3px] ring-ring/30"
          : "border-border hover:border-primary/60",
        alerta ? "border-destructive/60" : "",
        // Passo que não executa fica visivelmente apagado: ele está na tela
        // para ser consertado, não para parecer parte do fluxo.
        inalcancavel ? "opacity-70" : ""
      )}
    >
      {/* Pegar e apagar aparecem no hover, fora do fluxo do conteúdo: o cartão
          parado mostra só o que o passo faz. Mesmo padrão do Criador. */}
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
        className="absolute left-0.5 top-3 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </span>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(step.id);
        }}
        aria-label={`Remover passo ${STEP_LABEL[step.type]}`}
        className="absolute right-2 top-2.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100 cursor-pointer"
      >
        <Trash2 className="size-4" />
      </button>

      <div className="flex items-start gap-3 p-3.5 pl-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Icone className="size-4.5" />
        </span>

        <div className="min-w-0 flex-1 pr-5">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-semibold leading-snug">
            {STEP_LABEL[step.type]}
            {chip ? (
              <span className="max-w-full truncate rounded-sm bg-accent px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
                {chip}
              </span>
            ) : null}
          </p>
          {texto ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {texto}
            </p>
          ) : null}
        </div>
      </div>

      {/* Faixa de números: quantos estão parados AQUI e o que já saiu daqui.
          Fica no cartão porque é onde a pergunta aparece — "o fluxo está
          andando?" se responde olhando o desenho, não uma tabela à parte. */}
      {metrica && (metrica.agora > 0 || metrica.passaram > 0) ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/30 px-3.5 py-2 text-xs font-semibold text-primary">
          {metrica.agora > 0 ? (
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              {metrica.agora} aqui agora
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            <CheckCheck className="size-3.5" />
            {metrica.passaram === 1 ? "1 passou" : `${metrica.passaram} passaram`}
          </span>
          {metrica.envios && metrica.envios.enviados > 0 ? (
            <>
              <span className="flex items-center gap-1">
                <Send className="size-3.5" />
                {metrica.envios.enviados} enviados
              </span>
              <span className="flex items-center gap-1">
                <MailOpen className="size-3.5" />
                {taxa(metrica.envios.abertos, metrica.envios.enviados)} de
                abertura
              </span>
              {metrica.envios.cliques > 0 ? (
                <span className="flex items-center gap-1">
                  <MousePointerClick className="size-3.5" />
                  {taxa(metrica.envios.cliques, metrica.envios.enviados)} de
                  cliques
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {alerta ? (
        <p className="flex items-start gap-1.5 border-t border-destructive/30 bg-destructive/5 px-3.5 py-2 text-xs text-destructive-hover">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {alerta}
        </p>
      ) : null}
    </div>
  );
}

/** Os dois lados de um Se/Então, lado a lado — empilhados se não couberem. */
function Ramos(props: ColunaProps & { pai: StepDraft }) {
  return (
    // Cada Se/Então é um container próprio: um aninhado dentro de um ramo tem
    // metade do espaço, e é a largura DELE que decide se os dois lados cabem
    // lado a lado. Com breakpoint de janela, o de dentro ficaria espremido.
    <div className="@container w-full">
      <div className="mx-auto h-3 w-px bg-border" />
      <div className="flex flex-col gap-4 @min-[38rem]:flex-row @min-[38rem]:items-start @min-[38rem]:justify-center @min-[38rem]:gap-6">
        {(["yes", "no"] as const).map((ramo) => (
          // Empilhados (pouca largura), os dois lados viram um bloco só de
          // cartões — o fundo separa onde termina o "Sim" e começa o "Não".
          <div
            key={ramo}
            className="flex flex-col items-center rounded-xl bg-muted/40 p-3 @min-[38rem]:bg-transparent @min-[38rem]:p-0"
          >
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
