"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type Preset = "7d" | "30d" | "custom";

export interface CampaignOption {
  id: string;
  name: string;
}

export function ReportsFilters({
  preset,
  onPreset,
  from,
  to,
  onCustomFrom,
  onCustomTo,
  options,
  selectedIds,
  onToggleCampaign,
  onClearCampaigns,
  compare,
  onCompare,
  label = "Campanha",
  allLabel = "Todas as campanhas",
}: {
  preset: Preset;
  onPreset: (p: Preset) => void;
  from: string;
  to: string;
  onCustomFrom: (v: string) => void;
  onCustomTo: (v: string) => void;
  options: CampaignOption[];
  selectedIds: string[];
  onToggleCampaign: (id: string) => void;
  onClearCampaigns: () => void;
  compare: boolean;
  onCompare: (v: boolean) => void;
  /** Rótulo do filtro — "Campanha" ou "Edição" (Avante News). */
  label?: string;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const plural = allLabel.replace(/^Tod[ao]s as /, "");
  const selectedLabel =
    selectedIds.length === 0
      ? allLabel
      : selectedIds.length === 1
        ? (options.find((o) => o.id === selectedIds[0])?.name ??
          `1 ${label.toLowerCase()}`)
        : `${selectedIds.length} ${plural}`;

  return (
    <div className="mb-6 flex flex-wrap items-end gap-4">
      {/* Presets de período */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Período</Label>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          {(
            [
              { key: "7d", label: "7 dias" },
              { key: "30d", label: "30 dias" },
              { key: "custom", label: "Personalizado" },
            ] as const
          ).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPreset(p.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                preset === p.key
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Datas personalizadas */}
      {preset === "custom" ? (
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from" className="text-xs text-muted-foreground">
              De
            </Label>
            <Input
              id="from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => onCustomFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to" className="text-xs text-muted-foreground">
              Até
            </Label>
            <Input
              id="to"
              type="date"
              value={to}
              min={from}
              onChange={(e) => onCustomTo(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
      ) : null}

      {/* Multisseleção de campanhas/edições */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex h-9 w-56 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            <span className="truncate">{selectedLabel}</span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </button>
          {open ? (
            <div className="absolute z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
              <button
                type="button"
                onClick={onClearCampaigns}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
              >
                <span className="flex size-4 items-center justify-center">
                  {selectedIds.length === 0 ? (
                    <Check className="size-4 text-primary" />
                  ) : null}
                </span>
                {allLabel}
              </button>
              {options.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Nenhum envio registrado ainda.
                </p>
              ) : (
                options.map((option) => {
                  const checked = selectedIds.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onToggleCampaign(option.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        {checked ? (
                          <Check className="size-4 text-primary" />
                        ) : null}
                      </span>
                      <span className="truncate">{option.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Comparação */}
      <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
        <input
          type="checkbox"
          checked={compare}
          onChange={(e) => onCompare(e.target.checked)}
          className="size-4 accent-[#1D50DC]"
        />
        Comparar com período anterior
      </label>
    </div>
  );
}
