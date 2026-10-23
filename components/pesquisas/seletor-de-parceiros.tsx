"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import type { ParceiroEncontrado } from "@/lib/pesquisas/envios";
import { PARTNER_TIERS } from "@/lib/db/schema";
import { TIER_LABEL } from "@/lib/pesquisas/mapeamento";
import { OBJETIVO_LABEL, type PesquisaResumoDto } from "@/lib/pesquisas/rotulos";

// Escolher parceiros um a um para o convite: busca por nome, empresa ou
// e-mail, dentro de uma lista ou em todas; quem já está convidado nesta
// pesquisa aparece, mas não entra. A escolha sobrevive a buscas seguintes.

const TODAS = "__todas__";

export function SeletorDeParceiros({
  surveyId,
  listas,
  selecionados,
  onChange,
}: {
  surveyId: string;
  listas: { id: string; name: string }[];
  /** id → nome, para mostrar quem já foi escolhido. */
  selecionados: Map<string, string>;
  onChange: (proximo: Map<string, string>) => void;
}) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState(TODAS);
  // Projeto: "quem conclui a fase recebe a próxima" e abordagem por classificação.
  const [concluiram, setConcluiram] = useState(TODAS);
  const [tier, setTier] = useState(TODAS);
  const [pesquisas, setPesquisas] = useState<PesquisaResumoDto[]>([]);

  useEffect(() => {
    let ativo = true;
    fetch("/api/pesquisas")
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: PesquisaResumoDto[]) => {
        if (ativo) setPesquisas(lista.filter((p) => p.id !== surveyId));
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [surveyId]);
  const [resultado, setResultado] = useState<{ parceiros: ParceiroEncontrado[]; total: number } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    const timer = setTimeout(async () => {
      setCarregando(true);
      try {
        const p = new URLSearchParams();
        if (q.trim()) p.set("q", q.trim());
        if (lista !== TODAS) p.set("lista", lista);
        if (concluiram !== TODAS) p.set("concluiram", concluiram);
        if (tier !== TODAS) p.set("classificacao", tier);
        const res = await fetch(`/api/pesquisas/${surveyId}/parceiros?${p.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao buscar parceiros.");
        if (ativo) {
          setResultado(json);
          setErro("");
        }
      } catch (err) {
        if (ativo) setErro(err instanceof Error ? err.message : String(err));
      } finally {
        if (ativo) setCarregando(false);
      }
    }, 300);
    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [q, lista, concluiram, tier, surveyId]);

  const elegiveis = (resultado?.parceiros ?? []).filter((p) => !p.convidado);

  function alternar(p: ParceiroEncontrado) {
    const proximo = new Map(selecionados);
    if (proximo.has(p.id)) proximo.delete(p.id);
    else proximo.set(p.id, p.name);
    onChange(proximo);
  }

  function selecionarTodos() {
    const proximo = new Map(selecionados);
    elegiveis.forEach((p) => proximo.set(p.id, p.name));
    onChange(proximo);
  }

  const nomes = [...selecionados.values()];

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="grid gap-1.5">
          <Label htmlFor="busca-lista">Lista</Label>
          <Select value={lista} onValueChange={setLista}>
            <SelectTrigger id="busca-lista">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todos os parceiros</SelectItem>
              {listas.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="busca-parceiro">Buscar</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="busca-parceiro"
              className="pl-9"
              placeholder="Nome, empresa ou e-mail"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="busca-concluiram">Que concluíram a fase</Label>
          <Select value={concluiram} onValueChange={setConcluiram}>
            <SelectTrigger id="busca-concluiram">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Qualquer parceiro</SelectItem>
              {pesquisas.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {OBJETIVO_LABEL[p.objective]} · {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="busca-tier">Classificação</Label>
          <Select value={tier} onValueChange={setTier}>
            <SelectTrigger id="busca-tier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Qualquer classificação</SelectItem>
              {PARTNER_TIERS.map((t) => (
                <SelectItem key={t} value={t}>
                  {TIER_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span aria-live="polite">
          {carregando ? (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="size-3 animate-spin" /> Buscando...
            </span>
          ) : resultado ? (
            resultado.total > resultado.parceiros.length
              ? `Mostrando ${resultado.parceiros.length} de ${resultado.total} — refine a busca para ver o resto.`
              : `${resultado.total} parceiro${resultado.total === 1 ? "" : "s"}`
          ) : (
            ""
          )}
        </span>
        <span className="flex gap-3">
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={selecionarTodos} disabled={elegiveis.length === 0}>
            Selecionar os {elegiveis.length} da busca
          </Button>
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onChange(new Map())} disabled={selecionados.size === 0}>
            Limpar
          </Button>
        </span>
      </div>

      {erro ? <p className="text-sm text-destructive">{erro}</p> : null}

      <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
        {resultado && resultado.parceiros.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum parceiro encontrado.</p>
        ) : (
          (resultado?.parceiros ?? []).map((p) => (
            <label
              key={p.id}
              className={`flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0 ${
                p.convidado ? "text-muted-foreground" : "cursor-pointer hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={selecionados.has(p.id)}
                disabled={p.convidado}
                onChange={() => alternar(p)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[p.company, p.email ?? p.phone ?? "sem e-mail nem telefone"].filter(Boolean).join(" · ")}
                </span>
              </span>
              {p.convidado ? <Badge variant="secondary">já convidado</Badge> : null}
            </label>
          ))
        )}
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {selecionados.size === 0
          ? "Nenhum parceiro escolhido."
          : `${selecionados.size} escolhido${selecionados.size === 1 ? "" : "s"}: ${nomes.slice(0, 4).join(", ")}${
              nomes.length > 4 ? ` e mais ${nomes.length - 4}` : ""
            }`}
      </p>
    </div>
  );
}
