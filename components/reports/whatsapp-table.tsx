"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatInt, formatPctValue } from "@/lib/format";
import type { WaCampaignRow } from "@/lib/reports";
import { cn } from "@/lib/utils";

type SortKey =
  | "name"
  | "sentAt"
  | "sent"
  | "delivered"
  | "read"
  | "replied"
  | "failed";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "name", label: "Campanha", numeric: false },
  { key: "sentAt", label: "Data de envio", numeric: false },
  { key: "sent", label: "Enviadas", numeric: true },
  { key: "delivered", label: "Entregues", numeric: true },
  { key: "read", label: "Lidas", numeric: true },
  { key: "replied", label: "Respostas", numeric: true },
  { key: "failed", label: "Falhas", numeric: true },
];

export function WhatsAppTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: WaCampaignRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("sentAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? rows.filter((r) => r.name.toLowerCase().includes(term))
      : [...rows];

    list.sort((a, b) => {
      let cmp: number;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "sentAt") cmp = a.sentAt.localeCompare(b.sentAt);
      else cmp = a[sortKey] - b[sortKey];
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar campanha..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {selectedId ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-xs text-primary hover:underline"
          >
            Limpar seleção do gráfico
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma campanha de WhatsApp no período.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(col.numeric && "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={cn(
                      "inline-flex items-center gap-1 hover:text-foreground",
                      col.numeric && "flex-row-reverse"
                    )}
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : (
                      <ChevronsUpDown className="size-3 opacity-40" />
                    )}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onSelect(selectedId === row.id ? null : row.id)}
                className={cn(
                  "cursor-pointer",
                  selectedId === row.id && "bg-primary/5"
                )}
              >
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(row.sentAt)}
                </TableCell>
                <TableCell className="text-right">
                  {formatInt(row.sent)}
                </TableCell>
                <TableCell className="text-right">
                  {formatInt(row.delivered)}
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({formatPctValue(row.deliveryRate)})
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {formatInt(row.read)}
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({formatPctValue(row.readRate)})
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {formatInt(row.replied)}
                </TableCell>
                <TableCell className="text-right">
                  {formatInt(row.failed)}
                  {row.frequencyCapped > 0 ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({formatInt(row.frequencyCapped)} por limite)
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
