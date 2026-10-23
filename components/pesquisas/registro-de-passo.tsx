"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { SURVEY_FOLLOWUP_KINDS, type SurveyFollowupKind } from "@/lib/db/schema";
import { PASSO_LABEL } from "@/lib/pesquisas/mapeamento";

/**
 * Registrar um passo da régua feito à mão pela Expansão (mensagem pessoal,
 * ligação, reunião, resposta assistida) — ou "sem resposta", que encerra o
 * convite. Fica no histórico do convite e alimenta a régua.
 */
export function RegistroDePasso({
  surveyId,
  inviteId,
  parceiro,
  aberto,
  onFechar,
  onRegistrado,
}: {
  surveyId: string;
  inviteId: string;
  parceiro: string;
  aberto: boolean;
  onFechar: () => void;
  onRegistrado: (mensagem: string) => void;
}) {
  const [kind, setKind] = useState<SurveyFollowupKind>("mensagem");
  const [note, setNote] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (aberto) {
      setKind("mensagem");
      setNote("");
      setErro("");
    }
  }, [aberto]);

  async function registrar() {
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch(`/api/pesquisas/${surveyId}/convites/${inviteId}/passos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível registrar o passo.");
      onRegistrado(
        kind === "sem_resposta"
          ? `${parceiro}: convite encerrado sem resposta.`
          : `${parceiro}: ${PASSO_LABEL[kind].toLowerCase()} registrada.`
      );
      onFechar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(open) => !open && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar passo · {parceiro}</DialogTitle>
          <DialogDescription>
            O que a Expansão fez com este parceiro. Entra no histórico do convite e move a régua de follow-up.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="passo-tipo">Passo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as SurveyFollowupKind)}>
              <SelectTrigger id="passo-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SURVEY_FOLLOWUP_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {PASSO_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {kind === "sem_resposta" ? (
              <p className="text-xs text-warning-dark">
                Fim da régua (D+14): o convite é encerrado e o link deixa de aceitar resposta. Dá para reabrir no
                acompanhamento da pesquisa.
              </p>
            ) : kind === "resposta_assistida" ? (
              <p className="text-xs text-muted-foreground">
                Responda junto com o parceiro pelo link dele (Copiar link) e registre aqui que foi assistida.
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="passo-nota">
              Observação <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="passo-nota"
              rows={3}
              maxLength={2000}
              value={note}
              placeholder="ex.: Falei com a Ana, vai responder até sexta."
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={registrar} disabled={salvando}>
            {salvando ? "Registrando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
