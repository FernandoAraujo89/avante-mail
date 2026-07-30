"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { NewsAudience } from "@/lib/settings";
import { cn } from "@/lib/utils";

type ListOption = { id: string; name: string; contactCount: number };

/**
 * Destino fixo do Avante News. A lista é deduzida pelo nome na primeira vez
 * ("White Label Ativos") e precisa ser confirmada; depois disso só muda aqui.
 */
export function NewsAudienceCard({
  initialAudience,
}: {
  initialAudience: NewsAudience | null;
}) {
  const router = useRouter();
  const [audience, setAudience] = useState(initialAudience);
  const [editing, setEditing] = useState(!initialAudience);
  const [lists, setLists] = useState<ListOption[] | null>(null);
  const [selected, setSelected] = useState(initialAudience?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing || lists) return;
    (async () => {
      try {
        const res = await fetch("/api/lists");
        setLists(res.ok ? await res.json() : []);
      } catch {
        setLists([]);
      }
    })();
  }, [editing, lists]);

  async function save(listId: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/news/audience", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar a lista.");
      setAudience(json.audience);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      className={cn(
        audience?.auto || !audience ? "border-primary/40 bg-primary/5" : ""
      )}
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Users className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              Lista que recebe o Avante News
            </p>
            {audience ? (
              <p className="mt-0.5 font-medium">
                {audience.name}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {audience.contactCount} contato
                  {audience.contactCount === 1 ? "" : "s"}
                </span>
              </p>
            ) : (
              <p className="mt-0.5 font-medium">Ainda não definida</p>
            )}
            {audience?.auto ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Encontrada pelo nome — confirme para fixar esta lista.
              </p>
            ) : null}
          </div>
        </div>

        {editing ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="news-list"
                className="text-xs text-muted-foreground"
              >
                Escolher lista
              </Label>
              <select
                id="news-list"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="h-9 w-64 rounded-lg border border-input bg-transparent px-3 text-sm"
              >
                <option value="">
                  {lists === null ? "Carregando..." : "Selecione uma lista"}
                </option>
                {(lists ?? []).map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list.contactCount})
                  </option>
                ))}
              </select>
            </div>
            <Button
              onClick={() => save(selected)}
              disabled={saving || !selected}
              size="sm"
            >
              <Check />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
            {audience ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex gap-2">
            {audience?.auto ? (
              <Button
                size="sm"
                onClick={() => save(audience.id)}
                disabled={saving}
              >
                <Check />
                {saving ? "Confirmando..." : "Confirmar"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected(audience?.id ?? "");
                setEditing(true);
              }}
            >
              Trocar lista
            </Button>
          </div>
        )}
      </CardContent>

      {error ? (
        <p className="px-5 pb-4 text-sm text-destructive-hover">{error}</p>
      ) : null}

      {lists !== null && lists.length === 0 && editing ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground">
          Nenhuma lista cadastrada ainda. Crie a lista de parceiros White Label
          Ativos em <span className="font-medium">Listas</span>.
        </p>
      ) : null}
    </Card>
  );
}
