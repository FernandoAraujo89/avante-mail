"use client";

import { Fragment, useState } from "react";
import {
  Bold,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Image as ImageIcon,
  Italic,
  Link2,
  Minus,
  MousePointerClick,
  MoveVertical,
  Share2,
  Trash2,
  Type,
  Underline,
} from "lucide-react";

import { BLOCK_LABELS } from "@/lib/email-builder/presets";
import type {
  Block,
  BlockType,
  Column,
  EmailDesign,
  Row,
} from "@/lib/email-builder/types";
import { cn } from "@/lib/utils";

const PICKER_ICONS: Record<BlockType, React.ElementType> = {
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  spacer: MoveVertical,
  divider: Minus,
  social: Share2,
};

export interface Selection {
  rowId: string;
  colId?: string;
  blockId?: string;
}

export type RowAction = "up" | "down" | "duplicate" | "delete" | "saveModule";
export type BlockAction = "up" | "down" | "duplicate" | "delete";

export type DragState =
  // Reordenação de itens já no layout.
  | { kind: "block"; blockId: string }
  | { kind: "row"; rowId: string }
  // Inserção de itens novos vindos da paleta (drag da sidebar).
  | { kind: "new-block"; blockType: BlockType }
  | { kind: "new-structure"; widths: number[] };

interface CanvasProps {
  design: EmailDesign;
  selection: Selection | null;
  drag: DragState | null;
  onDragChange: (drag: DragState | null) => void;
  onSelect: (selection: Selection | null) => void;
  onTextCommit: (blockId: string, html: string) => void;
  onRowAction: (rowId: string, action: RowAction) => void;
  onBlockAction: (
    rowId: string,
    colId: string,
    blockId: string,
    action: BlockAction
  ) => void;
  onMoveBlockTo: (
    blockId: string,
    targetRowId: string,
    targetColId: string,
    targetIndex: number
  ) => void;
  onMoveRowTo: (rowId: string, targetIndex: number) => void;
  onAddBlockAt: (rowId: string, colId: string, type: BlockType) => void;
  onInsertBlockAt: (
    rowId: string,
    colId: string,
    index: number,
    type: BlockType
  ) => void;
  onInsertStructureAt: (index: number, widths: number[]) => void;
}

function ToolbarButton({
  label,
  onClick,
  onMouseDown,
  children,
  danger,
}: {
  label: string;
  onClick?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={onMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={cn(
        "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground [&_svg]:size-3.5",
        danger && "hover:text-destructive"
      )}
    >
      {children}
    </button>
  );
}

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

/** Alça de arrastar (blocos e linhas). */
function DragHandle({
  label,
  visible,
  className,
  onStart,
  onEnd,
  dragImageSelector,
}: {
  label: string;
  visible: boolean;
  className?: string;
  onStart: () => void;
  onEnd: () => void;
  dragImageSelector: string;
}) {
  return (
    <button
      type="button"
      draggable
      title={label}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/plain", label);
        e.dataTransfer.effectAllowed = "move";
        const root = (e.currentTarget as HTMLElement).closest(
          dragImageSelector
        );
        if (root instanceof HTMLElement) {
          e.dataTransfer.setDragImage(root, 24, 16);
        }
        // Mudar o estado dentro do dragstart altera o DOM sob o elemento
        // arrastado e faz o Chrome CANCELAR o arraste nativo. Adiar um
        // tick deixa o navegador capturar o drag antes das zonas surgirem.
        window.setTimeout(onStart, 0);
      }}
      onDragEnd={() => onEnd()}
      className={cn(
        "absolute z-20 flex size-6 cursor-grab items-center justify-center rounded border border-border bg-card text-muted-foreground shadow-sm transition-opacity hover:text-foreground active:cursor-grabbing",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
        className
      )}
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}

/** Zona de soltura entre blocos de uma coluna. */
function BlockDropZone({
  active,
  onDropBlock,
}: {
  active: boolean;
  onDropBlock: () => void;
}) {
  const [over, setOver] = useState(false);

  if (!active) return null;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onDropBlock();
      }}
      className={cn(
        "mx-2 my-0.5 h-1.5 rounded-full transition-colors",
        over ? "bg-primary" : "bg-primary/20"
      )}
      aria-hidden="true"
    />
  );
}

/** Zona de soltura entre linhas do e-mail. */
function RowDropZone({
  active,
  onDropRow,
}: {
  active: boolean;
  onDropRow: () => void;
}) {
  const [over, setOver] = useState(false);

  if (!active) return null;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onDropRow();
      }}
      className={cn(
        "my-1 h-3 rounded-full transition-colors",
        over ? "bg-primary" : "bg-primary/20"
      )}
      aria-hidden="true"
    />
  );
}

function BlockToolbar({
  block,
  onAction,
}: {
  block: Block;
  onAction: (action: BlockAction) => void;
}) {
  return (
    <div className="absolute -top-3.5 right-1 z-20 flex items-center gap-0.5 rounded-md border border-border bg-card px-1 py-0.5 shadow-lg">
      {block.type === "text" ? (
        <>
          <ToolbarButton
            label="Negrito"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("bold");
            }}
          >
            <Bold />
          </ToolbarButton>
          <ToolbarButton
            label="Itálico"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("italic");
            }}
          >
            <Italic />
          </ToolbarButton>
          <ToolbarButton
            label="Sublinhado"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("underline");
            }}
          >
            <Underline />
          </ToolbarButton>
          <ToolbarButton
            label="Link"
            onMouseDown={(e) => {
              e.preventDefault();
              const url = window.prompt("URL do link:", "https://");
              if (url) exec("createLink", url);
            }}
          >
            <Link2 />
          </ToolbarButton>
          <span className="mx-0.5 h-4 w-px bg-border" />
        </>
      ) : null}
      <ToolbarButton label="Mover para cima" onClick={() => onAction("up")}>
        <ChevronUp />
      </ToolbarButton>
      <ToolbarButton label="Mover para baixo" onClick={() => onAction("down")}>
        <ChevronDown />
      </ToolbarButton>
      <ToolbarButton label="Duplicar" onClick={() => onAction("duplicate")}>
        <Copy />
      </ToolbarButton>
      <ToolbarButton label="Remover" onClick={() => onAction("delete")} danger>
        <Trash2 />
      </ToolbarButton>
    </div>
  );
}

function BlockView({
  block,
  design,
  selected,
  onSelect,
  onTextCommit,
  onAction,
  dragEnabled,
  onDragChange,
}: {
  block: Block;
  design: EmailDesign;
  selected: boolean;
  onSelect: () => void;
  onTextCommit: (html: string) => void;
  onAction: (action: BlockAction) => void;
  dragEnabled?: boolean;
  onDragChange?: (drag: DragState | null) => void;
}) {
  const { settings } = design;

  let content: React.ReactNode;
  switch (block.type) {
    case "text":
      content = (
        <div
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          style={{
            fontSize: block.attrs.fontSize,
            color: block.attrs.color || settings.textColor,
            textAlign: block.attrs.align,
            padding: block.attrs.padding,
            lineHeight: 1.6,
            fontFamily: settings.fontFamily,
            outline: "none",
            wordBreak: "break-word",
          }}
          onBlur={(e) => onTextCommit(e.currentTarget.innerHTML)}
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
      break;
    case "image":
      content = (
        <div
          style={{ padding: block.attrs.padding, textAlign: block.attrs.align }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.src}
            alt={block.alt}
            style={{
              width: block.attrs.width ? `${block.attrs.width}px` : "100%",
              maxWidth: "100%",
              borderRadius: block.attrs.borderRadius,
              display: "inline-block",
            }}
          />
        </div>
      );
      break;
    case "button":
      content = (
        <div
          style={{ padding: block.attrs.padding, textAlign: block.attrs.align }}
        >
          <span
            style={{
              display: "inline-block",
              backgroundColor: block.attrs.backgroundColor,
              color: block.attrs.color,
              fontSize: block.attrs.fontSize,
              fontWeight: 700,
              borderRadius: block.attrs.borderRadius,
              padding: "12px 32px",
              fontFamily: settings.fontFamily,
            }}
          >
            {block.text}
          </span>
        </div>
      );
      break;
    case "spacer":
      content = (
        <div
          style={{ height: block.attrs.height }}
          className={cn(
            selected &&
              "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(29,80,220,0.12)_6px,rgba(29,80,220,0.12)_12px)]"
          )}
        />
      );
      break;
    case "divider":
      content = (
        <div style={{ padding: block.attrs.padding }}>
          <div
            style={{
              borderTop: `${block.attrs.borderWidth}px solid ${block.attrs.borderColor}`,
            }}
          />
        </div>
      );
      break;
    case "social":
      content = (
        <div
          style={{ padding: block.attrs.padding, textAlign: block.attrs.align }}
        >
          {block.items.map((item, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={item.iconSrc}
              alt={item.label}
              style={{
                width: block.attrs.iconSize,
                height: block.attrs.iconSize,
                borderRadius: "50%",
                display: "inline-block",
                margin: "0 6px",
              }}
            />
          ))}
        </div>
      );
      break;
  }

  return (
    <div
      data-block-root
      className={cn(
        "group/block relative rounded-sm transition-shadow",
        selected
          ? "ring-2 ring-primary"
          : "hover:ring-1 hover:ring-primary/40"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {selected ? <BlockToolbar block={block} onAction={onAction} /> : null}
      {dragEnabled && onDragChange ? (
        <DragHandle
          label="Arrastar bloco"
          visible={selected}
          className={cn(
            "left-1 top-1",
            !selected && "group-hover/block:pointer-events-auto group-hover/block:opacity-100"
          )}
          dragImageSelector="[data-block-root]"
          onStart={() => onDragChange({ kind: "block", blockId: block.id })}
          onEnd={() => onDragChange(null)}
        />
      ) : null}
      {content}
    </div>
  );
}

function ColumnView({
  row,
  column,
  design,
  selection,
  drag,
  onSelect,
  onTextCommit,
  onBlockAction,
  onDragChange,
  onMoveBlockTo,
  onAddBlockAt,
  onInsertBlockAt,
}: {
  row: Row;
  column: Column;
  design: EmailDesign;
  selection: Selection | null;
  drag: DragState | null;
  onSelect: (selection: Selection) => void;
  onTextCommit: (blockId: string, html: string) => void;
  onBlockAction: CanvasProps["onBlockAction"];
  onDragChange: (drag: DragState | null) => void;
  onMoveBlockTo: CanvasProps["onMoveBlockTo"];
  onAddBlockAt: CanvasProps["onAddBlockAt"];
  onInsertBlockAt: CanvasProps["onInsertBlockAt"];
}) {
  const [overEmpty, setOverEmpty] = useState(false);

  const columnSelected =
    selection?.rowId === row.id &&
    selection?.colId === column.id &&
    !selection?.blockId;

  // Aceita tanto mover um bloco existente quanto inserir um bloco novo da paleta.
  const blockDragActive =
    drag?.kind === "block" || drag?.kind === "new-block";

  // Solta um bloco na posição `index` desta coluna (mover ou inserir novo).
  function dropBlockAt(index: number) {
    if (drag?.kind === "block") {
      onMoveBlockTo(drag.blockId, row.id, column.id, index);
    } else if (drag?.kind === "new-block") {
      onInsertBlockAt(row.id, column.id, index, drag.blockType);
    }
  }

  return (
    <div style={{ width: `${column.widthPct}%` }} className="min-w-0">
      {column.blocks.length === 0 && columnSelected && !blockDragActive ? (
        // Seletor de blocos direto na coluna: um clique escolhe e insere.
        <div
          className="m-1 grid grid-cols-2 gap-1.5 rounded border border-primary/60 bg-accent/50 p-2"
          onClick={(e) => e.stopPropagation()}
        >
          {(Object.keys(BLOCK_LABELS) as BlockType[]).map((type) => {
            const Icon = PICKER_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddBlockAt(row.id, column.id, type);
                }}
                className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                {BLOCK_LABELS[type]}
              </button>
            );
          })}
        </div>
      ) : column.blocks.length === 0 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect({ rowId: row.id, colId: column.id });
          }}
          onDragOver={
            blockDragActive
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }
              : undefined
          }
          onDragEnter={
            blockDragActive
              ? (e) => {
                  e.preventDefault();
                  setOverEmpty(true);
                }
              : undefined
          }
          onDragLeave={blockDragActive ? () => setOverEmpty(false) : undefined}
          onDrop={
            blockDragActive
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOverEmpty(false);
                  dropBlockAt(0);
                }
              : undefined
          }
          className={cn(
            "m-1 flex min-h-16 w-[calc(100%-8px)] items-center justify-center rounded border border-dashed text-xs",
            overEmpty
              ? "border-primary bg-accent text-primary"
              : "border-border text-muted-foreground hover:border-primary/50"
          )}
        >
          {blockDragActive ? "Soltar aqui" : "+ Adicionar bloco"}
        </button>
      ) : (
        <>
          <BlockDropZone
            active={blockDragActive}
            onDropBlock={() => dropBlockAt(0)}
          />
          {column.blocks.map((block, index) => (
            <Fragment key={block.id}>
              <BlockView
                block={block}
                design={design}
                selected={selection?.blockId === block.id}
                onSelect={() =>
                  onSelect({
                    rowId: row.id,
                    colId: column.id,
                    blockId: block.id,
                  })
                }
                onTextCommit={(html) => onTextCommit(block.id, html)}
                onAction={(action) =>
                  onBlockAction(row.id, column.id, block.id, action)
                }
                dragEnabled
                onDragChange={onDragChange}
              />
              <BlockDropZone
                active={blockDragActive}
                onDropBlock={() => dropBlockAt(index + 1)}
              />
            </Fragment>
          ))}
        </>
      )}
    </div>
  );
}

export function RowView({
  row,
  design,
  selection,
  drag,
  onSelect,
  onTextCommit,
  onRowAction,
  onBlockAction,
  onDragChange,
  onMoveBlockTo,
  onAddBlockAt,
  onInsertBlockAt,
  readOnly,
}: {
  row: Row;
  design: EmailDesign;
  selection?: Selection | null;
  drag?: DragState | null;
  onSelect?: (selection: Selection) => void;
  onTextCommit?: (blockId: string, html: string) => void;
  onRowAction?: (action: RowAction) => void;
  onBlockAction?: CanvasProps["onBlockAction"];
  onDragChange?: (drag: DragState | null) => void;
  onMoveBlockTo?: CanvasProps["onMoveBlockTo"];
  onAddBlockAt?: CanvasProps["onAddBlockAt"];
  onInsertBlockAt?: CanvasProps["onInsertBlockAt"];
  readOnly?: boolean;
}) {
  const rowSelected =
    !readOnly &&
    selection?.rowId === row.id &&
    !selection?.blockId &&
    !selection?.colId;

  return (
    <div
      data-row-root
      className={cn(
        "group/row relative",
        !readOnly && "rounded-sm",
        rowSelected
          ? "ring-2 ring-primary"
          : !readOnly && "hover:ring-1 hover:ring-primary/30"
      )}
      style={{
        backgroundColor:
          row.attrs.backgroundColor || design.settings.contentBackground,
        padding: row.attrs.padding,
      }}
      onClick={
        readOnly
          ? undefined
          : (e) => {
              e.stopPropagation();
              onSelect?.({ rowId: row.id });
            }
      }
    >
      {rowSelected && onRowAction ? (
        <div className="absolute -top-3.5 right-1 z-20 flex items-center gap-0.5 rounded-md border border-border bg-card px-1 py-0.5 shadow-lg">
          <ToolbarButton
            label="Mover para cima"
            onClick={() => onRowAction("up")}
          >
            <ChevronUp />
          </ToolbarButton>
          <ToolbarButton
            label="Mover para baixo"
            onClick={() => onRowAction("down")}
          >
            <ChevronDown />
          </ToolbarButton>
          <ToolbarButton
            label="Duplicar"
            onClick={() => onRowAction("duplicate")}
          >
            <Copy />
          </ToolbarButton>
          <ToolbarButton
            label="Salvar como módulo"
            onClick={() => onRowAction("saveModule")}
          >
            <Bookmark />
          </ToolbarButton>
          <ToolbarButton
            label="Remover linha"
            onClick={() => onRowAction("delete")}
            danger
          >
            <Trash2 />
          </ToolbarButton>
        </div>
      ) : null}

      {!readOnly && onDragChange ? (
        <DragHandle
          label="Arrastar linha"
          visible={rowSelected}
          className={cn(
            "-top-3.5 left-1",
            !rowSelected &&
              "group-hover/row:pointer-events-auto group-hover/row:opacity-100"
          )}
          dragImageSelector="[data-row-root]"
          onStart={() => onDragChange({ kind: "row", rowId: row.id })}
          onEnd={() => onDragChange(null)}
        />
      ) : null}

      <div className="flex flex-wrap">
        {row.columns.map((column) =>
          readOnly ? (
            <div
              key={column.id}
              style={{ width: `${column.widthPct}%` }}
              className="min-w-0"
            >
              {column.blocks.map((block) => (
                <BlockView
                  key={block.id}
                  block={block}
                  design={design}
                  selected={false}
                  onSelect={() => {}}
                  onTextCommit={() => {}}
                  onAction={() => {}}
                />
              ))}
            </div>
          ) : (
            <ColumnView
              key={column.id}
              row={row}
              column={column}
              design={design}
              selection={selection ?? null}
              drag={drag ?? null}
              onSelect={onSelect!}
              onTextCommit={onTextCommit!}
              onBlockAction={onBlockAction!}
              onDragChange={onDragChange!}
              onMoveBlockTo={onMoveBlockTo!}
              onAddBlockAt={onAddBlockAt!}
              onInsertBlockAt={onInsertBlockAt!}
            />
          )
        )}
      </div>
    </div>
  );
}

export function Canvas({
  design,
  selection,
  drag,
  onDragChange,
  onSelect,
  onTextCommit,
  onRowAction,
  onBlockAction,
  onMoveBlockTo,
  onMoveRowTo,
  onAddBlockAt,
  onInsertBlockAt,
  onInsertStructureAt,
}: CanvasProps) {
  // Zonas entre linhas aceitam reordenar linha OU inserir estrutura da paleta.
  const rowDragActive =
    drag?.kind === "row" || drag?.kind === "new-structure";
  const [overEmpty, setOverEmpty] = useState(false);

  // Solta uma linha na posição `index` (mover existente ou inserir estrutura).
  function dropRowAt(index: number) {
    if (drag?.kind === "row") onMoveRowTo(drag.rowId, index);
    else if (drag?.kind === "new-structure")
      onInsertStructureAt(index, drag.widths);
  }

  return (
    <div
      className="rounded-xl border border-border p-4 sm:p-8"
      style={{ backgroundColor: design.settings.bodyBackground }}
      onClick={() => onSelect(null)}
    >
      <div className="mx-auto w-[600px] max-w-full">
        {design.rows.length === 0 ? (
          <div
            onDragOver={
              rowDragActive
                ? (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }
                : undefined
            }
            onDragEnter={
              rowDragActive
                ? (e) => {
                    e.preventDefault();
                    setOverEmpty(true);
                  }
                : undefined
            }
            onDragLeave={rowDragActive ? () => setOverEmpty(false) : undefined}
            onDrop={
              rowDragActive
                ? (e) => {
                    e.preventDefault();
                    setOverEmpty(false);
                    dropRowAt(0);
                  }
                : undefined
            }
            className={cn(
              "rounded border border-dashed py-16 text-center text-sm transition-colors",
              overEmpty
                ? "border-primary bg-accent text-primary"
                : "border-border bg-white/50 text-muted-foreground"
            )}
          >
            {drag?.kind === "new-structure"
              ? "Solte aqui para adicionar a estrutura"
              : "E-mail vazio — arraste uma estrutura ou clique nela no painel ao lado."}
          </div>
        ) : (
          <>
            <RowDropZone active={rowDragActive} onDropRow={() => dropRowAt(0)} />
            {design.rows.map((row, index) => (
              <Fragment key={row.id}>
                <RowView
                  row={row}
                  design={design}
                  selection={selection}
                  drag={drag}
                  onSelect={onSelect}
                  onTextCommit={onTextCommit}
                  onRowAction={(action) => onRowAction(row.id, action)}
                  onBlockAction={onBlockAction}
                  onDragChange={onDragChange}
                  onMoveBlockTo={onMoveBlockTo}
                  onAddBlockAt={onAddBlockAt}
                  onInsertBlockAt={onInsertBlockAt}
                />
                <RowDropZone
                  active={rowDragActive}
                  onDropRow={() => dropRowAt(index + 1)}
                />
              </Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
