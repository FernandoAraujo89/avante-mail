"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Plus, Radio, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";

interface RegraDeSite {
  id: string;
  evento: string;
  matchType: string;
  valor: string;
  description: string | null;
  active: boolean;
}

interface Recusa {
  motivo: string;
  detalhe?: string;
  quando: string;
}

interface Dados {
  tag: string;
  origens: string[];
  ativo: boolean;
  regras: RegraDeSite[];
  ultimaVisita: string | null;
  recusas: Recusa[];
  visitasNaSemana: number;
}

/** O motivo técnico traduzido para quem vai consertar. */
const MOTIVOS: Record<string, string> = {
  "origem-nao-permitida":
    "O site que chamou não está na lista de origens (confira SITE_TRACK_ORIGINS no servidor).",
  "sem-origem": "Chamada sem identificação de site — provavelmente não veio de um navegador.",
  "corpo-invalido": "O corpo enviado não estava no formato esperado.",
  "corpo-grande": "Corpo maior que o teto.",
  "token-invalido": "Token ausente, expirado ou inválido — o visitante não está identificado.",
  "contato-suprimido": "O lead pediu para sair; o rastreio dele foi revogado.",
  "contato-inexistente": "O lead do token não existe mais na base.",
  "limite-por-ip": "Muitas chamadas do mesmo endereço.",
  "limite-por-contato": "Muitos eventos do mesmo lead na última hora.",
  "nada-aproveitavel": "A chamada chegou, mas nenhum evento dela era válido.",
};

export default function RastreioPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [evento, setEvento] = useState("");
  const [valor, setValor] = useState("");
  const [matchType, setMatchType] = useState("prefixo");

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch("/api/leads/rastreio");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar.");
      setDados(json);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function copiarTag() {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.tag);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // sem permissão: a tag está à vista para seleção manual
    }
  }

  async function adicionar() {
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch("/api/leads/rastreio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evento, valor, matchType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar.");
      setEvento("");
      setValor("");
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string) {
    try {
      await fetch(`/api/leads/rastreio/${id}`, { method: "DELETE" });
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }

  const chegando = dados?.ultimaVisita
    ? Date.now() - new Date(dados.ultimaVisita).getTime() < 7 * 24 * 3600 * 1000
    : false;

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/leads">
            <ArrowLeft />
            Voltar para leads
          </Link>
        </Button>
        <PageHeader
          title="Rastreio do site"
          description="Liga a visita ao site à ficha do lead. Só quem chegou por um link nosso é identificado — e só depois de aceitar o rastreio no site."
        />
      </div>

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      {/* Situação: é o alarme de "a tag caiu e ninguém percebeu". */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-3">
            <span
              className={`flex size-10 items-center justify-center rounded-full ${
                chegando ? "bg-success-light/40" : "bg-muted"
              }`}
            >
              <Radio
                className={`size-5 ${chegando ? "text-success-dark" : "text-muted-foreground"}`}
              />
            </span>
            <div>
              <p className="font-medium">
                {!dados
                  ? "Carregando..."
                  : !dados.ativo
                    ? "Rastreio inerte"
                    : chegando
                      ? "Recebendo visitas"
                      : "Nenhuma visita recebida ainda"}
              </p>
              <p className="text-sm text-muted-foreground">
                {!dados
                  ? ""
                  : !dados.ativo
                    ? "Nenhuma origem configurada no servidor (SITE_TRACK_ORIGINS) — nada é rastreado até isso existir."
                    : dados.ultimaVisita
                      ? `Última visita: ${formatDateTime(dados.ultimaVisita)} · ${dados.visitasNaSemana} nos últimos 7 dias`
                      : "A tag pode não ter sido colada, ou o site ainda não chamou o consentimento."}
              </p>
            </div>
          </div>
          {dados?.origens.length ? (
            <div className="flex flex-wrap gap-1.5">
              {dados.origens.map((o) => (
                <Badge key={o} variant="secondary">
                  {o}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1. Cole no site</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Antes do fechamento do <code className="rounded bg-muted px-1">&lt;/head&gt;</code>, em
              todas as páginas.
            </p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md border border-border bg-muted/50 px-3 py-2 text-xs">
                {dados?.tag ?? "..."}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={copiarTag}
                aria-label="Copiar a tag"
              >
                {copiado ? (
                  <Check className="text-success-dark" />
                ) : (
                  <Copy className="text-muted-foreground" />
                )}
              </Button>
            </div>

            <div className="rounded-lg border border-warning-dark/30 bg-warning-light/30 px-3 py-2 text-xs text-warning-dark">
              <p className="font-medium">2. Ligue ao banner de cookies</p>
              <p className="mt-1">
                O script não envia nada até o site autorizar. No “aceitar” do
                banner, chame{" "}
                <code className="rounded bg-warning-light/60 px-1">
                  av(&apos;consentimento&apos;, true)
                </code>
                ; no “recusar”,{" "}
                <code className="rounded bg-warning-light/60 px-1">
                  av(&apos;consentimento&apos;, false)
                </code>
                . Sem isso o rastreio fica calado — e é assim mesmo que deve
                ser.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Para marcar um clique específico, basta o atributo{" "}
              <code className="rounded bg-muted px-1">data-av-evento=&quot;demo&quot;</code> no
              botão ou link. Para conferir se está funcionando, abra o console
              do site e rode{" "}
              <code className="rounded bg-muted px-1">av(&apos;debug&apos;, true)</code>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Páginas que contam como intenção</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Visitar uma destas páginas vira um evento nomeado, que a{" "}
              <Link href="/leads/pontuacao" className="underline">
                pontuação
              </Link>{" "}
              usa para dar peso próprio.
            </p>

            <div className="grid gap-2">
              {(dados?.regras ?? []).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      <span className="font-medium">{r.valor}</span>
                      <span className="text-muted-foreground">
                        {r.matchType === "prefixo" ? " e subpáginas" : " (exato)"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      vira o evento{" "}
                      <span className="font-medium">{r.evento}</span>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remover(r.id)}
                    aria-label={`Remover a regra de ${r.valor}`}
                  >
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </div>
              ))}
              {dados && dados.regras.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma página cadastrada.
                </p>
              ) : null}
            </div>

            <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-[1fr_1fr_auto]">
              <div className="grid gap-1.5">
                <Label htmlFor="regra-valor">Caminho</Label>
                <Input
                  id="regra-valor"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="/planos"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="regra-evento">Evento</Label>
                <Input
                  id="regra-evento"
                  value={evento}
                  onChange={(e) => setEvento(e.target.value)}
                  placeholder="precos"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="regra-tipo">Casamento</Label>
                <Select value={matchType} onValueChange={setMatchType}>
                  <SelectTrigger id="regra-tipo" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prefixo">Começa com</SelectItem>
                    <SelectItem value="exato">Exato</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-3">
                <Button
                  variant="outline"
                  onClick={adicionar}
                  disabled={salvando || !evento.trim() || !valor.trim()}
                >
                  <Plus />
                  Adicionar página
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* As recusas são o que responde "por que não chegou". */}
      {dados && dados.recusas.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Chamadas recusadas</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {dados.recusas.slice(0, 15).map((r, i) => (
                <li
                  key={`${r.quando}-${i}`}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-2 text-sm last:border-b-0"
                >
                  <div className="min-w-0">
                    <p>{MOTIVOS[r.motivo] ?? r.motivo}</p>
                    {r.detalhe ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {r.detalhe}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(r.quando)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
