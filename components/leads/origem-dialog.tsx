"use client";

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Inbox } from "lucide-react";

import type { OrigemDto } from "@/app/(app)/leads/origens/page";
import { ESTAGIOS } from "@/components/leads/estagios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import {
  CAMPOS_MAPEAVEIS,
  MAPEAMENTO_PADRAO,
  normalizarSlug,
  PAYLOAD_DE_EXEMPLO,
} from "@/lib/webhooks/origens";

interface EntregaDto {
  id: string;
  status: string;
  erro: string | null;
  createdAt: string;
  contactId: string | null;
  contactName: string | null;
  payload: unknown;
}

interface Ensaio {
  campos: Record<string, unknown>;
  valido: boolean;
  problemas: string[];
}

const EXEMPLO_FORMATADO = JSON.stringify(PAYLOAD_DE_EXEMPLO, null, 2);

/**
 * Configuração da origem sem tocar em código: nome, mapeamento e padrões.
 *
 * O mapeamento é o coração — o payload vem de plataforma de terceiro e muda de
 * formato sem aviso. Por isso a janela traz o ENSAIO: cola-se o corpo real e o
 * sistema mostra o que sairia dele, antes de o lead de verdade depender disso.
 */
export function OrigemDialog({
  aberto,
  origem,
  baseUrl,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  origem: OrigemDto | null;
  baseUrl: string;
  onFechar: () => void;
  onSalvo: (token: { token: string; url: string } | null) => void;
}) {
  const editando = origem !== null;

  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [ativa, setAtiva] = useState(true);
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [tags, setTags] = useState("lead");
  const [estagio, setEstagio] = useState("novo");
  const [consentimento, setConsentimento] = useState(true);

  const [payload, setPayload] = useState(EXEMPLO_FORMATADO);
  const [ensaio, setEnsaio] = useState<Ensaio | null>(null);
  const [ensaiando, setEnsaiando] = useState(false);

  const [entregas, setEntregas] = useState<EntregaDto[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Reabrir a janela recomeça do estado da origem — sem isto, editar uma
  // origem depois de outra mostraria o mapeamento da anterior.
  useEffect(() => {
    if (!aberto) return;
    setErro("");
    setEnsaio(null);
    setEntregas(null);
    setPayload(EXEMPLO_FORMATADO);
    setSlugTocado(false);

    if (origem) {
      const padroes = (origem.defaults ?? {}) as {
        tags?: unknown;
        stage?: unknown;
        consentimento?: unknown;
      };
      setNome(origem.name);
      setSlug(origem.slug);
      setAtiva(origem.active);
      setMapa(origem.mapping ?? {});
      setTags(
        Array.isArray(padroes.tags) ? (padroes.tags as string[]).join(", ") : ""
      );
      setEstagio(
        typeof padroes.stage === "string" ? padroes.stage : "novo"
      );
      setConsentimento(padroes.consentimento !== false);
    } else {
      setNome("");
      setSlug("");
      setAtiva(true);
      setMapa({ ...MAPEAMENTO_PADRAO });
      setTags("lead");
      setEstagio("novo");
      setConsentimento(true);
    }
  }, [aberto, origem]);

  // Enquanto ninguém mexer no endereço, ele acompanha o nome.
  const slugEfetivo = useMemo(
    () => (slugTocado || editando ? slug : normalizarSlug(nome)),
    [slug, slugTocado, editando, nome]
  );

  async function carregarEntregas() {
    if (!origem) return;
    try {
      const res = await fetch(`/api/leads/origens/${origem.id}/entregas`);
      const json = await res.json();
      if (res.ok) setEntregas(json.entregas);
    } catch {
      // O histórico é auxiliar: falhar aqui não pode travar a configuração.
    }
  }

  async function ensaiar() {
    setEnsaiando(true);
    setErro("");
    try {
      const res = await fetch("/api/leads/origens/testar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping: mapa, payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro no ensaio.");
      setEnsaio(json);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setEnsaio(null);
    } finally {
      setEnsaiando(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    setErro("");
    try {
      const corpo = {
        name: nome,
        slug: slugEfetivo,
        active: ativa,
        mapping: mapa,
        defaults: { tags, stage: estagio, consentimento },
      };

      const res = await fetch(
        editando ? `/api/leads/origens/${origem.id}` : "/api/leads/origens",
        {
          method: editando ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar a origem.");

      // Só a criação devolve token — na edição não há o que mostrar.
      onSalvo(json.token ? { token: json.token, url: json.url } : null);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(a) => {
        if (!a) onFechar();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editando ? `Configurar ${origem.name}` : "Nova origem de leads"}
          </DialogTitle>
          <DialogDescription>
            Uma origem por plataforma: Make, formulário do site, Typeform, n8n.
            O mapeamento diz de onde tirar cada campo do corpo enviado — e muda
            aqui, sem depender de programação.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          {/* ── Identificação ───────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="origem-nome">Nome</Label>
              <Input
                id="origem-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Make — formulário do site"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="origem-slug">Endereço</Label>
              <Input
                id="origem-slug"
                value={slugEfetivo}
                onChange={(e) => {
                  setSlugTocado(true);
                  setSlug(normalizarSlug(e.target.value));
                }}
                placeholder="make-site"
                disabled={editando}
              />
              <p className="break-all text-xs text-muted-foreground">
                {editando
                  ? "O endereço não muda: ele já está colado do outro lado."
                  : `${baseUrl}/api/webhooks/entrada/${slugEfetivo || "…"}`}
              </p>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={ativa}
              onChange={(e) => setAtiva(e.target.checked)}
              className="mt-0.5 size-4 accent-[#1D50DC]"
            />
            <span>
              Origem ativa
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Desligada, a URL responde como se não existisse — útil para
                cortar uma integração sem apagar o histórico.
              </span>
            </span>
          </label>

          {/* ── Mapeamento ──────────────────────────────────────────── */}
          <div className="grid gap-2">
            <div>
              <Label>Mapeamento dos campos</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                À esquerda, o campo do sistema; à direita, onde ele está no
                corpo enviado. Aceita caminho com ponto:{" "}
                <code className="rounded bg-muted px-1">data.contato.email</code>
                . Deixe em branco o que a plataforma não manda.
              </p>
            </div>
            <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
              {CAMPOS_MAPEAVEIS.map((campo) => (
                <div
                  key={campo.campo}
                  className="grid grid-cols-[7.5rem_1fr] items-center gap-2"
                >
                  <span className="truncate text-xs text-muted-foreground">
                    {campo.rotulo}
                  </span>
                  <Input
                    value={mapa[campo.campo] ?? ""}
                    onChange={(e) =>
                      setMapa((atual) => ({
                        ...atual,
                        [campo.campo]: e.target.value,
                      }))
                    }
                    placeholder={campo.exemplo}
                    className="h-9"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* ── Padrões ─────────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="origem-tags">Tags aplicadas na entrada</Label>
              <Input
                id="origem-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="lead, site"
              />
              <p className="text-xs text-muted-foreground">
                Separadas por vírgula. Servem de gatilho de automação.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="origem-estagio">Estágio inicial</Label>
              <Select value={estagio} onValueChange={setEstagio}>
                <SelectTrigger id="origem-estagio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTAGIOS.map((e) => (
                    <SelectItem key={e.valor} value={e.valor}>
                      {e.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={consentimento}
              onChange={(e) => setConsentimento(e.target.checked)}
              className="mt-0.5 size-4 accent-[#1D50DC]"
            />
            <span>
              Esta origem capta consentimento de comunicação
              {/* Formulário preenchido não é, juridicamente, aceite de
                  marketing — por isso a origem declara isso explicitamente. */}
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Desmarque quando o formulário não avisa que a pessoa vai receber
                comunicação (ou quando a lista foi comprada): o lead entra e é
                gerido, mas não recebe e-mail até o aceite existir.
              </span>
            </span>
          </label>

          {/* ── Ensaio do mapeamento ────────────────────────────────── */}
          <div className="grid gap-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="origem-payload">Ensaiar com um corpo real</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={ensaiar}
                disabled={ensaiando}
              >
                <FlaskConical />
                {ensaiando ? "Ensaiando..." : "Ensaiar"}
              </Button>
            </div>
            <Textarea
              id="origem-payload"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={6}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Nada é gravado: o ensaio só mostra o que o mapeamento extrairia.
            </p>

            {ensaio ? (
              <div className="grid gap-2 border-t border-border pt-3">
                <div className="flex flex-wrap gap-1.5">
                  {ensaio.valido ? (
                    <Badge variant="success">Este corpo criaria um lead</Badge>
                  ) : (
                    <Badge variant="destructive">
                      Este corpo seria recusado
                    </Badge>
                  )}
                </div>
                {ensaio.problemas.map((p) => (
                  <p key={p} className="text-xs text-destructive-hover">
                    {p}
                  </p>
                ))}
                <dl className="grid gap-1 text-xs sm:grid-cols-2">
                  {Object.entries(ensaio.campos)
                    .filter(
                      ([, v]) =>
                        v !== null && v !== "" && !(Array.isArray(v) && !v.length)
                    )
                    .map(([campo, valor]) => (
                      <div key={campo} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{campo}</dt>
                        <dd className="truncate font-medium">
                          {Array.isArray(valor)
                            ? valor.join(", ")
                            : String(valor)}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : null}
          </div>

          {/* ── Entregas recebidas ──────────────────────────────────── */}
          {editando ? (
            <div className="grid gap-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Últimas entregas</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={carregarEntregas}
                >
                  <Inbox />
                  {entregas === null ? "Ver o que chegou" : "Atualizar"}
                </Button>
              </div>
              {entregas === null ? (
                <p className="text-xs text-muted-foreground">
                  O que a plataforma enviou, cru — é aqui que se descobre por que
                  um lead não entrou.
                </p>
              ) : entregas.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nada chegou nesta origem ainda.
                </p>
              ) : (
                <ul className="grid max-h-56 gap-2 overflow-y-auto">
                  {entregas.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-start justify-between gap-3 border-b border-border pb-2 text-xs last:border-b-0"
                    >
                      <div className="min-w-0">
                        <span className="font-medium">{e.status}</span>
                        {e.contactName ? ` · ${e.contactName}` : ""}
                        {e.erro ? (
                          <p className="mt-0.5 text-destructive-hover">
                            {e.erro}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-muted-foreground">
                        {formatDateTime(e.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando || !nome.trim()}>
            {salvando
              ? "Salvando..."
              : editando
                ? "Salvar"
                : "Criar e mostrar o token"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
