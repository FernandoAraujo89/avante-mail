"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ChevronDown,
  Image as ImageIcon,
  Images,
  Minus,
  MousePointerClick,
  MoveVertical,
  Plus,
  Search,
  Share2,
  Trash2,
  Type,
  Upload,
} from "lucide-react";

import {
  RowView,
  type DragState,
  type Selection,
} from "@/components/builder/canvas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { findBlock } from "@/lib/email-builder/ops";
import {
  BLOCK_LABELS,
  FONT_OPTIONS,
  STRUCTURES,
} from "@/lib/email-builder/presets";
import type {
  Block,
  BlockType,
  DesignSettings,
  EmailDesign,
  Row,
  SavedModule,
} from "@/lib/email-builder/types";
import { cn } from "@/lib/utils";

// ─── Campos reutilizáveis ────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  allowInherit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowInherit?: boolean;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1"
          aria-label={label}
        />
        <Input
          value={value}
          placeholder={allowInherit ? "herdar" : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
        />
        {allowInherit && value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-muted-foreground hover:text-foreground"
            title="Herdar da configuração global"
          >
            ×
          </button>
        ) : null}
      </div>
    </Field>
  );
}

function AlignField({
  value,
  onChange,
}: {
  value: "left" | "center" | "right";
  onChange: (value: "left" | "center" | "right") => void;
}) {
  const options = [
    { key: "left" as const, icon: AlignLeft },
    { key: "center" as const, icon: AlignCenter },
    { key: "right" as const, icon: AlignRight },
  ];
  return (
    <Field label="Alinhamento">
      <div className="flex gap-1 rounded-lg border border-input p-0.5">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center rounded-md [&_svg]:size-4",
              value === option.key
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <option.icon />
          </button>
        ))}
      </div>
    </Field>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  suffix = "px",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <Field label={`${label} (${suffix})`}>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </Field>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-secondary/40"
      >
        {title}
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </div>
  );
}

// ─── Upload de imagens ───────────────────────────────────────────

const MAX_UPLOAD_MB = 5;

interface UploadedImage {
  name: string;
  url: string;
  size: number;
}

function ImageUploadControl({
  onPick,
}: {
  onPick: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [gallery, setGallery] = useState<UploadedImage[] | null>(null);

  async function loadGallery() {
    try {
      const res = await fetch("/api/uploads");
      const json = await res.json();
      if (res.ok && Array.isArray(json)) setGallery(json);
      else setGallery([]);
    } catch {
      setGallery([]);
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");

    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`A imagem excede o limite de ${MAX_UPLOAD_MB}MB.`);
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao enviar a imagem.");
      onPick(json.url);
      if (galleryOpen) await loadGallery();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(name: string) {
    try {
      const res = await fetch(`/api/uploads/${name}`, { method: "DELETE" });
      if (res.ok) {
        setGallery((g) => (g ?? []).filter((img) => img.name !== name));
      }
    } catch {
      // mantém a galeria como está
    }
  }

  return (
    <div className="grid gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".png,.gif,.jpg,.jpeg,.svg"
        className="hidden"
        onChange={handleFile}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border-[1.5px] border-primary bg-transparent px-2 py-1.5 text-xs font-semibold text-primary hover:bg-accent disabled:opacity-50"
        >
          <Upload className="size-3.5" />
          {uploading ? "Enviando..." : "Enviar do computador"}
        </button>
        <button
          type="button"
          onClick={async () => {
            const next = !galleryOpen;
            setGalleryOpen(next);
            if (next && gallery === null) await loadGallery();
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:border-primary/60",
            galleryOpen && "border-primary text-primary"
          )}
          title="Imagens já enviadas"
        >
          <Images className="size-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        png, gif, jpg ou svg · até {MAX_UPLOAD_MB}MB · hospedada no servidor
      </p>
      {error ? (
        <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive-hover">
          {error}
        </p>
      ) : null}
      {galleryOpen ? (
        gallery === null ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            Carregando...
          </p>
        ) : gallery.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            Nenhuma imagem enviada ainda.
          </p>
        ) : (
          <div className="grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto">
            {gallery.map((img) => (
              <div key={img.name} className="group relative">
                <button
                  type="button"
                  onClick={() => onPick(img.url)}
                  className="block w-full overflow-hidden rounded border border-border bg-white hover:border-primary"
                  title={img.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.name}
                    className="h-14 w-full object-contain"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(img.name)}
                  aria-label={`Excluir ${img.name}`}
                  className="absolute right-0.5 top-0.5 hidden rounded bg-card/90 p-0.5 text-muted-foreground shadow-sm hover:text-destructive group-hover:block"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

// ─── Inspetores ──────────────────────────────────────────────────

const BLOCK_ICONS: Record<BlockType, React.ElementType> = {
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  spacer: MoveVertical,
  divider: Minus,
  social: Share2,
};

function BlockInspector({
  block,
  onUpdate,
}: {
  block: Block;
  onUpdate: (updater: (block: Block) => Block) => void;
}) {
  const patchAttrs = (patch: Record<string, unknown>) =>
    onUpdate((b) => ({ ...b, attrs: { ...b.attrs, ...patch } }) as Block);

  return (
    <div className="grid gap-4">
      {block.type === "text" ? (
        <>
          <p className="text-xs text-muted-foreground">
            Edite o texto direto no e-mail. Selecione um trecho e use
            negrito/itálico/link na barra do bloco. Variáveis:{" "}
            {"{{nome_parceiro}}, {{titulo}}, {{subtitulo}}, {{corpo}}"}.
          </p>
          <NumberField
            label="Tamanho da fonte"
            value={block.attrs.fontSize}
            min={8}
            max={60}
            onChange={(v) => patchAttrs({ fontSize: v })}
          />
          <AlignField
            value={block.attrs.align}
            onChange={(v) => patchAttrs({ align: v })}
          />
          <ColorField
            label="Cor do texto"
            value={block.attrs.color}
            onChange={(v) => patchAttrs({ color: v })}
            allowInherit
          />
        </>
      ) : null}

      {block.type === "image" ? (
        <>
          <ImageUploadControl
            onPick={(url) => onUpdate((b) => ({ ...b, src: url }))}
          />
          <Field label="URL da imagem">
            <Input
              value={block.src}
              onChange={(e) => onUpdate((b) => ({ ...b, src: e.target.value }))}
            />
          </Field>
          <Field label="Texto alternativo">
            <Input
              value={block.alt}
              onChange={(e) => onUpdate((b) => ({ ...b, alt: e.target.value }))}
            />
          </Field>
          <Field label="Link ao clicar (opcional)">
            <Input
              value={block.href}
              placeholder="https://..."
              onChange={(e) =>
                onUpdate((b) => ({ ...b, href: e.target.value }))
              }
            />
          </Field>
          <NumberField
            label="Largura fixa (0 = total)"
            value={block.attrs.width ?? 0}
            max={600}
            onChange={(v) => patchAttrs({ width: v > 0 ? v : null })}
          />
          <NumberField
            label="Arredondamento"
            value={block.attrs.borderRadius}
            max={60}
            onChange={(v) => patchAttrs({ borderRadius: v })}
          />
          <AlignField
            value={block.attrs.align}
            onChange={(v) => patchAttrs({ align: v })}
          />
        </>
      ) : null}

      {block.type === "button" ? (
        <>
          <Field label="Texto do botão">
            <Input
              value={block.text}
              onChange={(e) =>
                onUpdate((b) => ({ ...b, text: e.target.value }))
              }
            />
          </Field>
          <Field label="Link (href)">
            <Input
              value={block.href}
              placeholder="https://... ou {{cta_url}}"
              onChange={(e) =>
                onUpdate((b) => ({ ...b, href: e.target.value }))
              }
            />
          </Field>
          <ColorField
            label="Cor de fundo"
            value={block.attrs.backgroundColor}
            onChange={(v) => patchAttrs({ backgroundColor: v })}
          />
          <ColorField
            label="Cor do texto"
            value={block.attrs.color}
            onChange={(v) => patchAttrs({ color: v })}
          />
          <NumberField
            label="Tamanho da fonte"
            value={block.attrs.fontSize}
            min={10}
            max={30}
            onChange={(v) => patchAttrs({ fontSize: v })}
          />
          <NumberField
            label="Arredondamento"
            value={block.attrs.borderRadius}
            max={40}
            onChange={(v) => patchAttrs({ borderRadius: v })}
          />
          <AlignField
            value={block.attrs.align}
            onChange={(v) => patchAttrs({ align: v })}
          />
        </>
      ) : null}

      {block.type === "spacer" ? (
        <NumberField
          label="Altura"
          value={block.attrs.height}
          min={4}
          max={200}
          onChange={(v) => patchAttrs({ height: v })}
        />
      ) : null}

      {block.type === "divider" ? (
        <>
          <ColorField
            label="Cor da linha"
            value={block.attrs.borderColor}
            onChange={(v) => patchAttrs({ borderColor: v })}
          />
          <NumberField
            label="Espessura"
            value={block.attrs.borderWidth}
            min={1}
            max={10}
            onChange={(v) => patchAttrs({ borderWidth: v })}
          />
        </>
      ) : null}

      {block.type === "social" ? (
        <>
          <NumberField
            label="Tamanho dos ícones"
            value={block.attrs.iconSize}
            min={20}
            max={64}
            onChange={(v) => patchAttrs({ iconSize: v })}
          />
          <AlignField
            value={block.attrs.align}
            onChange={(v) => patchAttrs({ align: v })}
          />
          <div className="grid gap-3">
            <Label className="text-xs text-muted-foreground">Redes</Label>
            {block.items.map((item, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{item.label}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate((b) =>
                        b.type === "social"
                          ? {
                              ...b,
                              items: b.items.filter((_, i) => i !== index),
                            }
                          : b
                      )
                    }
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remover ${item.label}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <Input
                  value={item.href}
                  placeholder="https://..."
                  onChange={(e) =>
                    onUpdate((b) =>
                      b.type === "social"
                        ? {
                            ...b,
                            items: b.items.map((it, i) =>
                              i === index ? { ...it, href: e.target.value } : it
                            ),
                          }
                        : b
                    )
                  }
                  className="text-xs"
                />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {"padding" in block.attrs ? (
        <Field label="Espaçamento (padding CSS)">
          <Input
            value={(block.attrs as { padding: string }).padding}
            placeholder="10px 24px"
            onChange={(e) => patchAttrs({ padding: e.target.value })}
            className="font-mono text-xs"
          />
        </Field>
      ) : null}
    </div>
  );
}

function RowInspector({
  row,
  onUpdate,
}: {
  row: Row;
  onUpdate: (patch: Partial<Row["attrs"]>) => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        Linha com {row.columns.length} coluna
        {row.columns.length > 1 ? "s" : ""}. Selecione uma coluna vazia no
        e-mail e clique num bloco abaixo para inseri-lo nela.
      </p>
      <ColorField
        label="Cor de fundo da linha"
        value={row.attrs.backgroundColor}
        onChange={(v) => onUpdate({ backgroundColor: v })}
        allowInherit
      />
      <Field label="Espaçamento (padding CSS)">
        <Input
          value={row.attrs.padding}
          placeholder="0px 0px"
          onChange={(e) => onUpdate({ padding: e.target.value })}
          className="font-mono text-xs"
        />
      </Field>
    </div>
  );
}

// ─── Painel lateral ──────────────────────────────────────────────

export function BuilderSidebar({
  design,
  selection,
  modules,
  onAddStructure,
  onAddBlock,
  onInsertModule,
  onDeleteModule,
  onUpdateBlock,
  onUpdateRowAttrs,
  onUpdateSettings,
  onClearSelection,
  onDragChange,
}: {
  design: EmailDesign;
  selection: Selection | null;
  modules: SavedModule[];
  onAddStructure: (widths: number[]) => void;
  onAddBlock: (type: BlockType) => void;
  onInsertModule: (module: SavedModule) => void;
  onDeleteModule: (id: string) => void;
  onUpdateBlock: (blockId: string, updater: (block: Block) => Block) => void;
  onUpdateRowAttrs: (rowId: string, patch: Partial<Row["attrs"]>) => void;
  onUpdateSettings: (patch: Partial<DesignSettings>) => void;
  onClearSelection: () => void;
  onDragChange: (drag: DragState | null) => void;
}) {
  const [tab, setTab] = useState<"content" | "settings">("content");
  const [openSections, setOpenSections] = useState({
    structures: true,
    blocks: true,
    modules: true,
  });
  const [moduleSearch, setModuleSearch] = useState("");

  const selectedBlock = selection?.blockId
    ? findBlock(design, selection.blockId)
    : null;
  const selectedRow =
    selection && !selection.blockId
      ? (design.rows.find((r) => r.id === selection.rowId) ?? null)
      : null;

  const filteredModules = useMemo(() => {
    const term = moduleSearch.trim().toLowerCase();
    if (!term) return modules;
    return modules.filter((m) => m.name.toLowerCase().includes(term));
  }, [modules, moduleSearch]);

  const toggle = (key: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));

  return (
    // max-h em vh (não h-full/%) porque a porcentagem de altura não resolve
    // de forma confiável através de um ancestral position:sticky — vh
    // independe da altura de qualquer contêiner pai. 13rem reserva espaço
    // pro topo (sticky top-8) e pro rodapé (ex.: barra fixa do wizard).
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card lg:max-h-[calc(100vh-13rem)]">
      {/* Abas */}
      <div className="flex border-b border-border">
        {(
          [
            { key: "content", label: "Conteúdo" },
            { key: "settings", label: "Configurações globais" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 border-b-2 px-3 py-2.5 text-sm font-medium",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "settings" ? (
          <div className="grid gap-4 p-4">
            <ColorField
              label="Fundo da página"
              value={design.settings.bodyBackground}
              onChange={(v) => onUpdateSettings({ bodyBackground: v })}
            />
            <ColorField
              label="Fundo do conteúdo"
              value={design.settings.contentBackground}
              onChange={(v) => onUpdateSettings({ contentBackground: v })}
            />
            <ColorField
              label="Cor padrão do texto"
              value={design.settings.textColor}
              onChange={(v) => onUpdateSettings({ textColor: v })}
            />
            <ColorField
              label="Cor dos links"
              value={design.settings.linkColor}
              onChange={(v) => onUpdateSettings({ linkColor: v })}
            />
            <Field label="Fonte">
              <Select
                value={design.settings.fontFamily}
                onValueChange={(v) => onUpdateSettings({ fontFamily: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((font) => (
                    <SelectItem key={font.value} value={font.value}>
                      {font.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        ) : selectedBlock ? (
          <div>
            <button
              type="button"
              onClick={onClearSelection}
              className="flex w-full items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold hover:bg-secondary/40"
            >
              <ArrowLeft className="size-4" />
              Bloco: {BLOCK_LABELS[selectedBlock.block.type]}
            </button>
            <div className="p-4">
              <BlockInspector
                block={selectedBlock.block}
                onUpdate={(updater) =>
                  onUpdateBlock(selectedBlock.block.id, updater)
                }
              />
            </div>
          </div>
        ) : selectedRow ? (
          <div>
            <button
              type="button"
              onClick={onClearSelection}
              className="flex w-full items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold hover:bg-secondary/40"
            >
              <ArrowLeft className="size-4" />
              Linha selecionada
            </button>
            <div className="p-4">
              <RowInspector
                row={selectedRow}
                onUpdate={(patch) => onUpdateRowAttrs(selectedRow.id, patch)}
              />
            </div>
            <div className="border-t border-border">
              <Section
                title="Blocos"
                open={openSections.blocks}
                onToggle={() => toggle("blocks")}
              >
                <BlockPalette onAddBlock={onAddBlock} onDragChange={onDragChange} />
              </Section>
            </div>
          </div>
        ) : (
          <>
            <Section
              title="Estruturas"
              open={openSections.structures}
              onToggle={() => toggle("structures")}
            >
              <div className="grid gap-2">
                {STRUCTURES.map((structure) => (
                  <button
                    key={structure.label}
                    type="button"
                    draggable
                    onClick={() => onAddStructure(structure.widths)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", structure.label);
                      e.dataTransfer.effectAllowed = "move";
                      // Adiar evita o Chrome cancelar o arraste ao re-renderizar.
                      window.setTimeout(
                        () =>
                          onDragChange({
                            kind: "new-structure",
                            widths: structure.widths,
                          }),
                        0
                      );
                    }}
                    onDragEnd={() => onDragChange(null)}
                    title={`${structure.label} — clique ou arraste para o e-mail`}
                    className="flex cursor-grab gap-1.5 rounded-lg border border-border p-2.5 hover:border-primary/60 active:cursor-grabbing"
                  >
                    {structure.widths.map((width, index) => (
                      <span
                        key={index}
                        style={{ width: `${width}%` }}
                        className="h-7 rounded border border-dashed border-info/60 bg-info/10"
                      />
                    ))}
                  </button>
                ))}
              </div>
            </Section>

            <Section
              title="Blocos"
              open={openSections.blocks}
              onToggle={() => toggle("blocks")}
            >
              <BlockPalette onAddBlock={onAddBlock} onDragChange={onDragChange} />
            </Section>

            <Section
              title="Módulos"
              open={openSections.modules}
              onToggle={() => toggle("modules")}
            >
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={moduleSearch}
                  onChange={(e) => setModuleSearch(e.target.value)}
                  placeholder="Nome do módulo..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
              {filteredModules.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {modules.length === 0
                    ? "Nenhum módulo salvo. Selecione uma linha no e-mail e use o ícone de marcador para salvá-la."
                    : "Nenhum módulo com esse nome."}
                </p>
              ) : (
                <div className="grid gap-2">
                  {filteredModules.map((module) => (
                    <div
                      key={module.id}
                      className="overflow-hidden rounded-lg border border-border"
                    >
                      <button
                        type="button"
                        onClick={() => onInsertModule(module)}
                        title="Inserir módulo"
                        className="block w-full bg-white"
                      >
                        <div className="pointer-events-none origin-top-left scale-50 [width:200%]">
                          <RowView row={module.design} design={design} readOnly />
                        </div>
                      </button>
                      <div className="flex items-center justify-between border-t border-border px-2.5 py-1.5">
                        <span className="truncate text-xs font-medium">
                          {module.name}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onInsertModule(module)}
                            className="text-muted-foreground hover:text-primary"
                            aria-label={`Inserir ${module.name}`}
                          >
                            <Plus className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteModule(module.id)}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Excluir ${module.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function BlockPalette({
  onAddBlock,
  onDragChange,
}: {
  onAddBlock: (type: BlockType) => void;
  onDragChange: (drag: DragState | null) => void;
}) {
  return (
    <div className="grid gap-2">
      {(Object.keys(BLOCK_LABELS) as BlockType[]).map((type) => {
        const Icon = BLOCK_ICONS[type];
        return (
          <button
            key={type}
            type="button"
            draggable
            onClick={() => onAddBlock(type)}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", BLOCK_LABELS[type]);
              e.dataTransfer.effectAllowed = "move";
              // Adiar evita o Chrome cancelar o arraste ao re-renderizar.
              window.setTimeout(
                () => onDragChange({ kind: "new-block", blockType: type }),
                0
              );
            }}
            onDragEnd={() => onDragChange(null)}
            title={`${BLOCK_LABELS[type]} — clique ou arraste para o e-mail`}
            className="flex cursor-grab items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm font-medium hover:border-primary/60 active:cursor-grabbing"
          >
            <Icon className="size-4 text-muted-foreground" />
            {BLOCK_LABELS[type]}
          </button>
        );
      })}
    </div>
  );
}
