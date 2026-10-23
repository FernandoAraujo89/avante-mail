"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
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
  Table,
  TableActionsCell,
  TableActionsHead,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { rotaPermitida, type Perfil } from "@/lib/perfis";
import {
  ALERTA_MOTIVO_LABEL,
  PRAZO_ALERTA_HORAS,
  SITUACAO_ALERTA_LABEL,
  type SituacaoDoAlerta,
} from "@/lib/pesquisas/mapeamento";
import type { AlertaDto, EstadoDosAlertas } from "@/lib/pesquisas/mapeamento-db";
import { OBJETIVO_LABEL } from "@/lib/pesquisas/rotulos";
import { cn } from "@/lib/utils";

const SITUACAO_VARIANT: Record<SituacaoDoAlerta, "info" | "destructive" | "success" | "warning"> = {
  no_prazo: "info",
  vencido: "destructive",
  tratado_no_prazo: "success",
  tratado_atrasado: "warning",
};

export default function AlertasPage() {
  const [estado, setEstado] = useState<EstadoDosAlertas>("abertos");
  const [alertas, setAlertas] = useState<AlertaDto[] | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [podeTratar, setPodeTratar] = useState(false);
  const [tratando, setTratando] = useState<AlertaDto | null>(null);
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [formError, setFormError] = useState("");

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const [res, resMe] = await Promise.all([fetch(`/api/pesquisas/alertas?estado=${estado}`), fetch("/api/auth/me")]);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar os alertas.");
      setAlertas(json);
      if (resMe.ok) {
        const me = (await resMe.json()) as { role: Perfil };
        setPodeTratar(rotaPermitida(me.role, "/api/pesquisas/alertas", "PATCH"));
      }
    } catch (err) {
      setAlertas([]);
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, [estado]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function tratar() {
    if (!tratando) return;
    setSalvando(true);
    setFormError("");
    try {
      const res = await fetch(`/api/pesquisas/alertas/${tratando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "tratar", note: nota }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível tratar o alerta.");
      setAviso(`Alerta de ${tratando.contact.name} tratado.`);
      setTratando(null);
      await carregar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Alertas de risco"
        description={`NPS de 0 a 6 ou risco de continuidade assinalado: a Expansão faz contato em até ${PRAZO_ALERTA_HORAS}h e registra aqui.`}
      />

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}
      {aviso ? (
        <div className="mb-4 rounded-lg border border-success-dark/30 bg-success-soft px-4 py-3 text-sm text-success-dark">
          {aviso}
        </div>
      ) : null}

      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-muted p-1 sm:w-fit" role="tablist" aria-label="Alertas">
        {(
          [
            ["abertos", "Em aberto"],
            ["tratados", "Tratados"],
            ["todos", "Todos"],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            aria-selected={estado === valor}
            onClick={() => setEstado(valor)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none",
              estado === valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <Card>
        {alertas === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Carregando alertas...</p>
        ) : alertas.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            {estado === "abertos" ? (
              <CheckCircle2 className="h-6 w-6 text-success-dark" />
            ) : (
              <AlertTriangle className="h-6 w-6 text-muted-foreground" />
            )}
            <p className="text-sm text-muted-foreground">
              {estado === "abertos" ? "Nenhum alerta em aberto." : "Nenhum alerta aqui."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parceiro</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Fase</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Situação</TableHead>
                  {podeTratar ? <TableActionsHead>Ações</TableActionsHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertas.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/pesquisas/parceiros/${a.contact.id}`} className="font-medium hover:underline">
                        {a.contact.name}
                      </Link>
                      {a.contact.company ? <p className="text-xs text-muted-foreground">{a.contact.company}</p> : null}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{ALERTA_MOTIVO_LABEL[a.reason]}</p>
                      <p className="max-w-md text-xs text-muted-foreground">{a.detail}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link href={`/pesquisas/${a.survey.id}`} className="text-sm hover:underline">
                        {OBJETIVO_LABEL[a.survey.objective]}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {a.ownerName ?? <span className="text-xs text-muted-foreground">sem responsável</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDateTime(a.dueAt)}
                      <p className="text-xs text-muted-foreground">nasceu {formatDateTime(a.createdAt)}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={SITUACAO_VARIANT[a.situacao]}>{SITUACAO_ALERTA_LABEL[a.situacao]}</Badge>
                      {a.handledAt ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {a.handledByName ?? "Alguém"} · {formatDateTime(a.handledAt)}
                          {a.note ? ` · ${a.note}` : ""}
                        </p>
                      ) : null}
                    </TableCell>
                    {podeTratar ? (
                      <TableActionsCell>
                        {!a.handledAt ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setTratando(a);
                              setNota("");
                              setFormError("");
                            }}
                          >
                            <CheckCircle2 />
                            Tratar
                          </Button>
                        ) : null}
                      </TableActionsCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={tratando !== null} onOpenChange={(open) => !open && setTratando(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tratar alerta · {tratando?.contact.name}</DialogTitle>
            <DialogDescription>
              {tratando ? `${ALERTA_MOTIVO_LABEL[tratando.reason]} — ${tratando.detail}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="alerta-nota">
              O que foi feito <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="alerta-nota"
              rows={3}
              maxLength={2000}
              value={nota}
              placeholder="ex.: Liguei, o problema era o suporte fiscal; chamado aberto e reunião marcada."
              onChange={(e) => setNota(e.target.value)}
            />
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTratando(null)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={tratar} disabled={salvando}>
              {salvando ? "Salvando..." : "Marcar como tratado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
