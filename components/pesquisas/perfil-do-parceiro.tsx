"use client";

import { useEffect, useState } from "react";

import { SaudeBadge, TierBadge } from "@/components/pesquisas/saude";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PARTNER_TIERS, type PartnerTier } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { TIER_LABEL, type Saude } from "@/lib/pesquisas/mapeamento";
import type { PerfilDto } from "@/lib/pesquisas/mapeamento-db";

const NENHUM = "__nenhum__";

/**
 * O que a Expansão sabe do parceiro além das respostas: classificação
 * (Diamante e Ouro recebem contato pessoal antes da campanha), responsável
 * (faz o D+7 em diante) e notas. O Sucesso do cliente só lê.
 */
export function PerfilDoParceiro({
  contactId,
  perfil,
  saude,
  alertasAbertos,
  podeEditar,
  onSalvo,
}: {
  contactId: string;
  perfil: PerfilDto | null;
  saude: Saude;
  alertasAbertos: number;
  podeEditar: boolean;
  onSalvo: (mensagem: string) => void;
}) {
  const [tier, setTier] = useState<string>(perfil?.tier ?? NENHUM);
  const [owner, setOwner] = useState<string>(perfil?.ownerUserId ?? NENHUM);
  const [notes, setNotes] = useState(perfil?.notes ?? "");
  const [responsaveis, setResponsaveis] = useState<{ id: string; name: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    setTier(perfil?.tier ?? NENHUM);
    setOwner(perfil?.ownerUserId ?? NENHUM);
    setNotes(perfil?.notes ?? "");
  }, [perfil]);

  useEffect(() => {
    if (!podeEditar) return;
    let ativo = true;
    fetch("/api/pesquisas/responsaveis")
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: { id: string; name: string }[]) => {
        if (ativo) setResponsaveis(lista);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [podeEditar]);

  const sujo =
    tier !== (perfil?.tier ?? NENHUM) || owner !== (perfil?.ownerUserId ?? NENHUM) || notes !== (perfil?.notes ?? "");

  async function salvar() {
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch(`/api/pesquisas/parceiros/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: tier === NENHUM ? null : (tier as PartnerTier),
          ownerUserId: owner === NENHUM ? null : owner,
          notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar.");
      onSalvo("Perfil do parceiro salvo.");
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-medium">Acompanhamento da Expansão</h2>
          <p className="text-xs text-muted-foreground">Classificação, responsável e a saúde da parceria.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaudeBadge saude={saude} />
          {alertasAbertos > 0 ? (
            <span className="text-xs text-destructive">
              {alertasAbertos} alerta{alertasAbertos === 1 ? "" : "s"} em aberto
            </span>
          ) : null}
        </div>
      </div>

      {podeEditar ? (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="perfil-tier">Classificação</Label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger id="perfil-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NENHUM}>Sem classificação</SelectItem>
                  {PARTNER_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIER_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="perfil-owner">Responsável na Expansão</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger id="perfil-owner">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NENHUM}>Sem responsável</SelectItem>
                  {responsaveis.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                  {perfil?.ownerUserId && !responsaveis.some((r) => r.id === perfil.ownerUserId) ? (
                    <SelectItem value={perfil.ownerUserId}>{perfil.ownerName ?? "Responsável atual"}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="perfil-notas">
              Notas <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="perfil-notas"
              rows={2}
              maxLength={2000}
              value={notes}
              placeholder="ex.: Pediu reunião em novembro para falar de migração."
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {perfil?.updatedAt ? `Atualizado em ${formatDateTime(perfil.updatedAt)}` : "Ainda sem classificação nem responsável."}
            </p>
            <div className="flex items-center gap-2">
              {erro ? <span className="text-sm text-destructive">{erro}</span> : null}
              <Button size="sm" onClick={salvar} disabled={!sujo || salvando}>
                {salvando ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-2">
            <span className="text-muted-foreground">Classificação</span>
            <TierBadge tier={perfil?.tier} />
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="text-muted-foreground">Responsável</span>
            {perfil?.ownerName ?? <span className="text-xs text-muted-foreground">sem responsável</span>}
          </span>
          {perfil?.notes ? <p className="basis-full text-sm">{perfil.notes}</p> : null}
        </div>
      )}
    </Card>
  );
}
