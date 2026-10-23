"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Copy, ExternalLink, Send, UserRound } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { FormularioPesquisa } from "@/components/pesquisas/formulario-pesquisa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SURVEY_OBJECTIVES, type SurveyInviteStatus, type SurveyObjective } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import { rotaPermitida, type Perfil } from "@/lib/perfis";
import type { ResultadoConvite } from "@/lib/pesquisas/envios";
import type { ParceiroDto } from "@/lib/pesquisas/relatorio-db";
import {
  CONVITE_STATUS_LABEL,
  OBJETIVO_DESCRICAO,
  OBJETIVO_LABEL,
  type PesquisaDto,
  type PesquisaResumoDto,
} from "@/lib/pesquisas/rotulos";

const CONVITE_VARIANT: Record<SurveyInviteStatus, "secondary" | "info" | "warning" | "success" | "outline"> = {
  pending: "secondary",
  opened: "info",
  in_progress: "warning",
  completed: "success",
  closed: "outline",
};

const ABERTOS: SurveyInviteStatus[] = ["pending", "opened", "in_progress"];

export default function ParceiroPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const [dados, setDados] = useState<ParceiroDto | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [podeConvidar, setPodeConvidar] = useState(false);
  const [pesquisas, setPesquisas] = useState<PesquisaResumoDto[]>([]);

  // Convite individual: a frente escolhida, a pesquisa ativa dela e os canais.
  const [convidando, setConvidando] = useState<SurveyObjective | null>(null);
  const [pesquisaId, setPesquisaId] = useState("");
  const [detalhe, setDetalhe] = useState<PesquisaDto | null>(null);
  const [porEmail, setPorEmail] = useState(true);
  const [porWhatsApp, setPorWhatsApp] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [formError, setFormError] = useState("");

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const [res, resMe, resP] = await Promise.all([
        fetch(`/api/pesquisas/parceiros/${contactId}`),
        fetch("/api/auth/me"),
        fetch("/api/pesquisas"),
      ]);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar o parceiro.");
      setDados(json);
      // O Sucesso do cliente só lê o painel; convidar é da Expansão e do admin.
      if (resMe.ok) {
        const me = (await resMe.json()) as { role: Perfil };
        setPodeConvidar(rotaPermitida(me.role, "/api/pesquisas", "POST"));
      }
      if (resP.ok) setPesquisas(await resP.json());
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, [contactId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Prontidão do WhatsApp vem da pesquisa escolhida.
  useEffect(() => {
    if (!pesquisaId) {
      setDetalhe(null);
      return;
    }
    let ativo = true;
    (async () => {
      const res = await fetch(`/api/pesquisas/${pesquisaId}`);
      if (res.ok && ativo) {
        const d = (await res.json()) as PesquisaDto;
        setDetalhe(d);
        setPorWhatsApp(d.whatsapp.pronto);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [pesquisaId]);

  function abrirConvite(objective: SurveyObjective) {
    const ativas = pesquisas.filter((p) => p.objective === objective && p.status === "active");
    setConvidando(objective);
    setPesquisaId(ativas[0]?.id ?? "");
    setPorEmail(true);
    setPorWhatsApp(false);
    setFormError("");
  }

  async function convidar() {
    if (!pesquisaId) return;
    setEnviando(true);
    setFormError("");
    const canais = [porEmail ? "email" : null, porWhatsApp && detalhe?.whatsapp.pronto ? "whatsapp" : null].filter(Boolean);
    try {
      const res = await fetch(`/api/pesquisas/${pesquisaId}/convites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: [contactId], channels: canais }),
      });
      const json = (await res.json()) as ResultadoConvite & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Não foi possível convidar.");
      if (json.jaConvidados > 0) throw new Error("Este parceiro já tem um convite em aberto nesta pesquisa.");
      setAviso(
        [
          "Convite criado",
          json.enfileirados.email ? "e-mail na fila" : null,
          json.enfileirados.whatsapp ? "WhatsApp na fila" : null,
          json.semEndereco ? "sem endereço nos canais escolhidos — copie o link" : null,
        ]
          .filter(Boolean)
          .join(" · ") + "."
      );
      setConvidando(null);
      await carregar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  async function copiarLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setAviso("Link copiado.");
    } catch {
      setAviso(`Link: ${link}`);
    }
  }

  const ativasDaFrente = convidando
    ? pesquisas.filter((p) => p.objective === convidando && p.status === "active")
    : [];

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/pesquisas/parceiros">
            <ArrowLeft />
            Voltar para o painel
          </Link>
        </Button>
        <PageHeader
          title={dados?.contact.name ?? "Parceiro"}
          description={dados ? (dados.contact.company ?? "sem empresa informada") : undefined}
        >
          {dados ? (
            <Button variant="outline" asChild>
              <Link href={`/contacts/${dados.contact.id}`}>
                <UserRound />
                Ficha do contato
              </Link>
            </Button>
          ) : null}
        </PageHeader>
      </div>

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}
      {aviso ? (
        <div className="mb-4 rounded-lg border border-success-dark/30 bg-success-light/20 px-4 py-3 text-sm break-all text-success-dark">
          {aviso}
        </div>
      ) : null}

      {!dados ? (
        <Card>
          <p className="py-12 text-center text-sm text-muted-foreground">
            {erro ? "Sem dados." : "Carregando..."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {SURVEY_OBJECTIVES.map((o) => {
            const f = dados.frentes[o];
            return (
              <Card key={o} className="p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{OBJETIVO_LABEL[o]}</h2>
                    <p className="text-xs text-muted-foreground">{OBJETIVO_DESCRICAO[o]}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {f ? (
                      <>
                        <Badge variant={CONVITE_VARIANT[f.status]}>{CONVITE_STATUS_LABEL[f.status]}</Badge>
                        {f.nps !== null ? <Badge variant="info">NPS {f.nps}</Badge> : null}
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/pesquisas/${f.surveyId}`}>
                            <ExternalLink />
                            {f.surveyName}
                          </Link>
                        </Button>
                        {ABERTOS.includes(f.status) ? (
                          <Button variant="outline" size="sm" onClick={() => copiarLink(f.link)}>
                            <Copy />
                            Copiar link
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                    {podeConvidar && (!f || !ABERTOS.includes(f.status)) ? (
                      <Button size="sm" onClick={() => abrirConvite(o)}>
                        <Send />
                        {f ? "Convidar de novo" : "Convidar"}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {!f ? (
                  <p className="text-sm text-muted-foreground">Ainda não foi convidado nesta frente.</p>
                ) : (
                  <>
                    <p className="mb-4 text-xs text-muted-foreground">
                      Convidado em {formatDate(f.createdAt)}
                      {f.completedAt ? ` · concluiu em ${formatDate(f.completedAt)}` : ` · ${f.respondidas} de ${f.total} respondidas`}
                    </p>
                    {f.respondidas === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma resposta ainda.</p>
                    ) : (
                      <FormularioPesquisa perguntas={f.perguntas} respostas={f.respostas} somenteLeitura />
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={convidando !== null} onOpenChange={(open) => !open && setConvidando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Convidar {dados?.contact.name} · {convidando ? OBJETIVO_LABEL[convidando] : ""}
            </DialogTitle>
            <DialogDescription>
              O parceiro ganha o próprio link. Concluído ou encerrado, um convite novo abre a rodada seguinte.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {ativasDaFrente.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma pesquisa ativa nesta frente. Ative uma em Pesquisas antes de convidar.
              </p>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="convite-pesquisa">Pesquisa</Label>
                <Select value={pesquisaId} onValueChange={setPesquisaId}>
                  <SelectTrigger id="convite-pesquisa">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ativasDaFrente.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Enviar o convite por</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={porEmail} onChange={(e) => setPorEmail(e.target.checked)} />
                E-mail <span className="text-xs text-muted-foreground">(endereço principal)</span>
              </label>
              <label className={`flex items-center gap-2 text-sm ${detalhe?.whatsapp.pronto ? "" : "text-muted-foreground"}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={porWhatsApp && Boolean(detalhe?.whatsapp.pronto)}
                  disabled={!detalhe?.whatsapp.pronto}
                  onChange={(e) => setPorWhatsApp(e.target.checked)}
                />
                WhatsApp{detalhe && !detalhe.whatsapp.pronto ? ` — ${detalhe.whatsapp.motivo ?? ""}` : ""}
              </label>
              <p className="text-xs text-muted-foreground">Sem canal marcado, só cria o link para você copiar.</p>
            </fieldset>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvidando(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={convidar} disabled={enviando || !pesquisaId}>
              {enviando ? "Convidando..." : "Convidar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
