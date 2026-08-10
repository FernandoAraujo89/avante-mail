"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Canvas,
  type BlockAction,
  type DragState,
  type RowAction,
  type Selection,
} from "@/components/builder/canvas";
import {
  CodePanel,
  type AlvoDoCodigo,
} from "@/components/builder/code-panel";
import { BuilderSidebar } from "@/components/builder/sidebar";
import { Button } from "@/components/ui/button";
import { Code2, RotateCcw } from "lucide-react";
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
import { absorverHtmlEmBlocoDeTexto } from "@/lib/email-builder/absorver";
import {
  addBlock,
  addRow,
  cloneRowWithNewIds,
  createRow,
  duplicateBlock,
  duplicateRow,
  insertBlockAt,
  insertRowAt,
  moveBlock,
  moveBlockTo,
  moveRow,
  moveRowTo,
  comCustomHtml,
  removeBlock,
  removeRow,
  setBlockCustomHtml,
  setRowCustomHtml,
  updateBlock,
  updateRowAttrs,
} from "@/lib/email-builder/ops";
import { BLOCK_LABELS } from "@/lib/email-builder/presets";
import { createBlock } from "@/lib/email-builder/presets";
import type {
  Block,
  BlockType,
  DesignSettings,
  EmailDesign,
  Row,
  SavedModule,
} from "@/lib/email-builder/types";

/**
 * Superfície de edição do Criador de email (Canvas + paleta lateral),
 * controlada: recebe o design em `value` e emite o novo em `onChange`.
 *
 * Reaproveitada tanto na criação de templates (EmailBuilder) quanto na
 * edição do e-mail dentro do wizard de campanha.
 */
export function DesignEditor({
  value,
  onChange,
  onError,
}: {
  value: EmailDesign;
  onChange: (design: EmailDesign) => void;
  onError?: (message: string) => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [modules, setModules] = useState<SavedModule[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);

  const [alvoDoCodigo, setAlvoDoCodigo] = useState<AlvoDoCodigo | null>(null);

  const [moduleRowId, setModuleRowId] = useState<string | null>(null);
  const [moduleName, setModuleName] = useState("");
  const [savingModule, setSavingModule] = useState(false);

  // Carrega os módulos salvos (Header/Footer etc.).
  const loadModules = useCallback(async () => {
    try {
      const res = await fetch("/api/modules");
      const json = await res.json();
      if (res.ok && Array.isArray(json)) setModules(json);
    } catch {
      // módulos são opcionais; falha silenciosa
    }
  }, []);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  const apply = (fn: (design: EmailDesign) => EmailDesign) =>
    onChange(fn(value));

  // ─── Inserções da paleta ─────────────────────────────────────

  function handleAddStructure(widths: number[]) {
    const row = createRow(widths);
    apply((d) => addRow(d, row, selection?.rowId ?? null));
    setSelection({ rowId: row.id });
  }

  function handleAddBlock(type: BlockType) {
    const block = createBlock(type);

    let targetRowId = selection?.rowId ?? null;
    let targetColId = selection?.colId ?? null;
    const afterBlockId = selection?.blockId ?? null;

    if (!targetRowId) {
      const last = value.rows[value.rows.length - 1];
      if (last) {
        targetRowId = last.id;
        targetColId = last.columns[0].id;
      } else {
        const row = createRow([100]);
        targetRowId = row.id;
        targetColId = row.columns[0].id;
        apply((d) => addRow(d, row, null));
      }
    } else if (!targetColId) {
      const row = value.rows.find((r) => r.id === targetRowId);
      targetColId = row?.columns[0].id ?? null;
    }

    if (!targetRowId || !targetColId) return;
    const rowId = targetRowId;
    const colId = targetColId;
    apply((d) => addBlock(d, rowId, colId, block, afterBlockId));
    setSelection({ rowId, colId, blockId: block.id });
  }

  function handleInsertModule(module: SavedModule) {
    const row = cloneRowWithNewIds(module.design);
    apply((d) => addRow(d, row, selection?.rowId ?? null));
    setSelection({ rowId: row.id });
  }

  async function handleDeleteModule(id: string) {
    try {
      const res = await fetch(`/api/modules/${id}`, { method: "DELETE" });
      if (res.ok) setModules((m) => m.filter((mod) => mod.id !== id));
    } catch {
      // mantém a lista como está
    }
  }

  // ─── Ações do canvas ─────────────────────────────────────────

  function handleRowAction(rowId: string, action: RowAction) {
    if (action === "saveModule") {
      setModuleRowId(rowId);
      setModuleName("");
      return;
    }
    if (action === "delete") {
      apply((d) => removeRow(d, rowId));
      setSelection(null);
      return;
    }
    if (action === "duplicate") {
      apply((d) => duplicateRow(d, rowId));
      return;
    }
    apply((d) => moveRow(d, rowId, action === "up" ? -1 : 1));
  }

  function handleBlockAction(
    rowId: string,
    colId: string,
    blockId: string,
    action: BlockAction
  ) {
    if (action === "delete") {
      apply((d) => removeBlock(d, rowId, colId, blockId));
      setSelection({ rowId, colId });
      return;
    }
    if (action === "duplicate") {
      apply((d) => duplicateBlock(d, rowId, colId, blockId));
      return;
    }
    apply((d) => moveBlock(d, rowId, colId, blockId, action === "up" ? -1 : 1));
  }

  function handleAddBlockAt(rowId: string, colId: string, type: BlockType) {
    const block = createBlock(type);
    apply((d) => addBlock(d, rowId, colId, block, null));
    setSelection({ rowId, colId, blockId: block.id });
  }

  // Insere um bloco novo (arrastado da paleta) numa posição exata da coluna.
  function handleInsertBlockAt(
    rowId: string,
    colId: string,
    index: number,
    type: BlockType
  ) {
    const block = createBlock(type);
    apply((d) => insertBlockAt(d, rowId, colId, block, index));
    setSelection({ rowId, colId, blockId: block.id });
  }

  // Insere uma estrutura nova (arrastada da paleta) numa posição exata.
  function handleInsertStructureAt(index: number, widths: number[]) {
    const row = createRow(widths);
    apply((d) => insertRowAt(d, row, index));
    setSelection({ rowId: row.id });
  }

  function handleMoveBlockTo(
    blockId: string,
    targetRowId: string,
    targetColId: string,
    targetIndex: number
  ) {
    apply((d) => moveBlockTo(d, blockId, targetRowId, targetColId, targetIndex));
    setSelection({ rowId: targetRowId, colId: targetColId, blockId });
  }

  function handleMoveRowTo(rowId: string, targetIndex: number) {
    apply((d) => moveRowTo(d, rowId, targetIndex));
    setSelection({ rowId });
  }

  function handleUpdateBlock(blockId: string, updater: (b: Block) => Block) {
    apply((d) => updateBlock(d, blockId, updater));
  }

  function handleUpdateRowAttrs(rowId: string, patch: Partial<Row["attrs"]>) {
    apply((d) => updateRowAttrs(d, rowId, patch));
  }

  function handleUpdateSettings(patch: Partial<DesignSettings>) {
    apply((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }

  // ─── Código à mão ────────────────────────────────────────────

  /**
   * O que o botão "Código" abre depende do que está selecionado — bloco, ou a
   * estrutura, ou (sem seleção) o e-mail inteiro. É a mesma lógica que a pessoa
   * já usa para editar: clicou no pedaço, o painel fala daquele pedaço.
   */
  const alvoAtual: AlvoDoCodigo = (() => {
    if (selection?.blockId) {
      const achado = value.rows
        .flatMap((r) => r.columns.flatMap((c) => c.blocks))
        .find((b) => b.id === selection.blockId);
      if (achado) {
        return {
          tipo: "bloco",
          id: achado.id,
          rotulo: BLOCK_LABELS[achado.type],
          blockType: achado.type,
        };
      }
    }
    if (selection?.rowId) return { tipo: "linha", id: selection.rowId };
    return { tipo: "documento" };
  })();

  const acharBloco = (blockId: string) =>
    value.rows
      .flatMap((r) => r.columns.flatMap((c) => c.blocks))
      .find((b) => b.id === blockId);

  /**
   * HTML editado de um bloco: TEXTO absorve o código e segue bloco comum
   * (conteúdo vira `html`, moldura vira atributos — nada de override, os
   * controles do painel continuam valendo). Os demais tipos não têm para onde
   * absorver e ficam com o override de sempre.
   */
  function aplicarHtmlNoBloco(blockId: string, html: string | null) {
    const bloco = acharBloco(blockId);
    if (bloco?.type === "text" && html) {
      apply((d) =>
        updateBlock(d, blockId, (b) =>
          b.type === "text" ? absorverHtmlEmBlocoDeTexto(b, html) : b
        )
      );
      return;
    }
    apply((d) => setBlockCustomHtml(d, blockId, html));
  }

  const htmlProprioDoAlvo = (alvo: AlvoDoCodigo): string | null => {
    if (alvo.tipo === "documento") return value.customHtml ?? null;
    if (alvo.tipo === "linha") {
      return value.rows.find((r) => r.id === alvo.id)?.customHtml ?? null;
    }
    return (
      value.rows
        .flatMap((r) => r.columns.flatMap((c) => c.blocks))
        .find((b) => b.id === alvo.id)?.customHtml ?? null
    );
  };

  function aplicarCodigo(alvo: AlvoDoCodigo, html: string | null) {
    if (alvo.tipo === "documento") {
      apply((d) => comCustomHtml(d, html));
    } else if (alvo.tipo === "linha") {
      apply((d) => setRowCustomHtml(d, alvo.id, html));
    } else {
      aplicarHtmlNoBloco(alvo.id, html);
    }
    setAlvoDoCodigo(null);
  }

  // ─── Salvar módulo (linha reutilizável) ──────────────────────

  async function handleSaveModule() {
    if (!moduleRowId) return;
    const row = value.rows.find((r) => r.id === moduleRowId);
    if (!row || !moduleName.trim()) return;
    setSavingModule(true);
    try {
      const res = await fetch("/api/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: moduleName.trim(), design: row }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar módulo.");
      setModuleRowId(null);
      await loadModules();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
      setModuleRowId(null);
    } finally {
      setSavingModule(false);
    }
  }

  const rotuloDoBotao =
    alvoAtual.tipo === "bloco"
      ? `Código do bloco`
      : alvoAtual.tipo === "linha"
        ? "Código da estrutura"
        : "Código do e-mail";

  return (
    <>
      {/* Aviso do override de documento: enquanto ele existe, tudo o que se
          mexe no canvas fica guardado mas não é enviado. Dizer isso aqui, e não
          só dentro do painel, evita a pessoa editar meia hora à toa. */}
      {value.customHtml ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-dark/30 bg-warning-light/30 px-4 py-3 text-sm text-warning-dark">
          <span>
            Este e-mail está com <strong>HTML próprio</strong>. O criador visual
            continua guardando o que você monta, mas quem é enviado é o código.
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAlvoDoCodigo({ tipo: "documento" })}
            >
              <Code2 />
              Editar código
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => aplicarCodigo({ tipo: "documento" }, null)}
            >
              <RotateCcw />
              Voltar ao visual
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAlvoDoCodigo(alvoAtual)}
          title="Mostra o HTML do que está selecionado; sem seleção, o e-mail inteiro"
        >
          <Code2 />
          {rotuloDoBotao}
        </Button>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <Canvas
          design={value}
          selection={selection}
          drag={drag}
          onDragChange={setDrag}
          onSelect={setSelection}
          onTextCommit={(blockId, html) =>
            handleUpdateBlock(blockId, (b) =>
              b.type === "text" ? { ...b, html } : b
            )
          }
          // Edição inline de pedaços com HTML próprio: o canvas devolve o HTML
          // já saneado, e ele entra pelo mesmo caminho do painel de código —
          // bloco de texto com override antigo é absorvido no primeiro commit.
          // Vazio (tudo apagado) derruba o override e o visual volta a valer.
          onRowHtmlCommit={(rowId, html) =>
            apply((d) => setRowCustomHtml(d, rowId, html))
          }
          onBlockHtmlCommit={(blockId, html) =>
            aplicarHtmlNoBloco(blockId, html || null)
          }
          onRowAction={handleRowAction}
          onBlockAction={handleBlockAction}
          onMoveBlockTo={handleMoveBlockTo}
          onMoveRowTo={handleMoveRowTo}
          onAddBlockAt={handleAddBlockAt}
          onInsertBlockAt={handleInsertBlockAt}
          onInsertStructureAt={handleInsertStructureAt}
        />
        {/* O max-h/overflow que limita a altura fica no próprio BuilderSidebar
            (não aqui) — height percentual não resolve de forma confiável
            através de um ancestral position:sticky. */}
        <div className="lg:sticky lg:top-8">
          <BuilderSidebar
            design={value}
            selection={selection}
            modules={modules}
            onAddStructure={handleAddStructure}
            onAddBlock={handleAddBlock}
            onInsertModule={handleInsertModule}
            onDeleteModule={handleDeleteModule}
            onUpdateBlock={handleUpdateBlock}
            onUpdateRowAttrs={handleUpdateRowAttrs}
            onUpdateSettings={handleUpdateSettings}
            onClearSelection={() => setSelection(null)}
            onDragChange={setDrag}
          />
        </div>
      </div>

      <CodePanel
        alvo={alvoDoCodigo}
        design={value}
        htmlProprio={alvoDoCodigo ? htmlProprioDoAlvo(alvoDoCodigo) : null}
        onAplicar={(html) => alvoDoCodigo && aplicarCodigo(alvoDoCodigo, html)}
        onVoltarAoGerado={() =>
          alvoDoCodigo && aplicarCodigo(alvoDoCodigo, null)
        }
        onFechar={() => setAlvoDoCodigo(null)}
      />

      {/* Dialog: salvar linha como módulo reutilizável */}
      <Dialog
        open={moduleRowId !== null}
        onOpenChange={(open) => {
          if (!open) setModuleRowId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar como módulo</DialogTitle>
            <DialogDescription>
              A linha selecionada ficará disponível na aba Módulos para
              reutilizar em qualquer e-mail.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="module-name">Nome do módulo</Label>
            <Input
              id="module-name"
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              placeholder="Ex.: Header, Footer, CTA principal..."
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModuleRowId(null)}
              disabled={savingModule}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveModule}
              disabled={savingModule || !moduleName.trim()}
            >
              {savingModule ? "Salvando..." : "Salvar módulo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
