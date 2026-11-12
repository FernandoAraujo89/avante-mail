"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Paginacao, usePaginacao } from "@/components/paginacao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatInt } from "@/lib/format";

interface TagDePerda {
  tag: string;
  /** Os motivos do CRM que dão esta tag (variações de pontuação somam). */
  motivos: string[];
  total: number;
}

interface Resumo {
  ligadoEm: string | null;
  tags: TagDePerda[];
  leadsComMotivo: number;
  perdidosSemMotivo: number;
  leadsComTag: number;
  /** Só na resposta do PUT: quantos leads tiveram a tag gravada ou tirada. */
  alterados?: number;
}

/**
 * Motivos de perda do CRM → tags de remarketing.
 *
 * A tela existe para a ORDEM certa: o motor de automações reage a cada evento
 * uma vez só, contra as automações ativas naquele momento. Então primeiro a
 * automação (com a tag copiada daqui), depois o interruptor — que marca os
 * leads já perdidos na hora e faz eles entrarem nela.
 */
export default function MotivosDePerdaPage() {
  const [dados, setDados] = useState<Resumo | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [confirmar, setConfirmar] = useState<"ligar" | "desligar" | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [copiada, setCopiada] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch("/api/leads/motivos-de-perda");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar os motivos.");
      setDados(json);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function alternar(ligado: boolean) {
    setSalvando(true);
    setErro("");
    setAviso("");
    try {
      const res = await fetch("/api/leads/motivos-de-perda", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ligado }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar.");
      setDados(json);
      setAviso(
        ligado
          ? `Tags ligadas. ${formatInt(json.alterados ?? 0)} lead${json.alterados === 1 ? "" : "s"} ${json.alterados === 1 ? "recebeu" : "receberam"} a tag agora.`
          : "Tags desligadas. As tags já aplicadas ficam nos leads."
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
      setConfirmar(null);
    }
  }

  async function copiar(tag: string) {
    try {
      await navigator.clipboard.writeText(tag);
      setCopiada(tag);
      setTimeout(() => setCopiada((atual) => (atual === tag ? null : atual)), 2500);
    } catch {
      setErro("Não deu para copiar: selecione a tag na tabela e copie à mão.");
    }
  }

  const tags = dados?.tags ?? [];
  const { itensDaPagina, ancora, paginacao } = usePaginacao(tags, {
    chave: "motivos-de-perda",
  });
  const ligado = Boolean(dados?.ligadoEm);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
        <Link href="/leads">
          <ArrowLeft />
          Voltar para leads
        </Link>
      </Button>

      <PageHeader
        title="Motivos de perda"
        description="Por que os leads foram perdidos no CRM (NRG Hub) e as tags que levam cada motivo às automações de remarketing."
      />

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      {aviso ? (
        <div className="mb-4 rounded-lg border border-success-dark/30 bg-success-light/20 px-4 py-3 text-sm text-success-dark">
          {aviso}
        </div>
      ) : null}

      <Card className="mb-6">
        <CardContent className="grid gap-4 py-4 text-sm sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Tags de motivo de perda</span>
              {dados === null ? null : ligado ? (
                <Badge variant="success">Ligadas</Badge>
              ) : (
                <Badge variant="secondary">Desligadas</Badge>
              )}
            </div>
            {ligado ? (
              <p className="text-muted-foreground">
                Ligadas desde {formatDateTime(dados?.ligadoEm ?? null)}. Cada
                lead perdido carrega a tag do motivo dele, mantida pela
                sincronização com o CRM (a cada 5 minutos): entra quando o lead
                é perdido, troca se o motivo mudar e sai se ele voltar a ter
                negócio aberto ou comprar. {formatInt(dados?.leadsComTag ?? 0)}{" "}
                lead{dados?.leadsComTag === 1 ? "" : "s"} com tag agora.
              </p>
            ) : (
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>
                  Crie a automação de remarketing com o gatilho{" "}
                  <span className="font-medium text-foreground">
                    Tag adicionada
                  </span>{" "}
                  e a tag do motivo (copie da tabela abaixo; para vários
                  motivos, um gatilho por tag) e ative.
                </li>
                <li>
                  Ligue aqui. Os {formatInt(dados?.leadsComMotivo ?? 0)} leads
                  perdidos com motivo recebem a tag na hora e entram nas
                  automações ativas; daí em diante, cada lead perdido recebe a
                  sua.
                </li>
              </ol>
            )}
            <p className="text-xs text-muted-foreground">
              A ordem importa: a automação só reage a tag adicionada depois de
              estar ativa. Automação criada depois de ligar só recebe quem for
              perdido dali em diante.
            </p>
          </div>
          {dados === null ? null : ligado ? (
            <Button variant="outline" onClick={() => setConfirmar("desligar")} disabled={salvando}>
              Desligar
            </Button>
          ) : (
            <Button onClick={() => setConfirmar("ligar")} disabled={salvando}>
              Ligar as tags
            </Button>
          )}
        </CardContent>
      </Card>

      <Card ref={ancora}>
        {dados === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando...
          </p>
        ) : tags.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhum lead perdido com motivo informado no CRM ainda.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Motivo no CRM</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead className="text-right">Leads</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itensDaPagina.map((t) => (
                <TableRow key={t.tag}>
                  <TableCell className="max-w-72 text-sm">
                    {t.motivos.join(" · ")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">
                        {t.tag}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label={`Copiar a tag ${t.tag}`}
                        title="Copiar a tag"
                        onClick={() => copiar(t.tag)}
                      >
                        {copiada === t.tag ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatInt(t.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Paginacao {...paginacao} className="border-t border-border px-4 py-3" />
      </Card>

      {(dados?.perdidosSemMotivo ?? 0) > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {formatInt(dados?.perdidosSemMotivo ?? 0)} lead
          {dados?.perdidosSemMotivo === 1 ? " perdido está" : "s perdidos estão"}{" "}
          sem motivo no CRM e não recebe{dados?.perdidosSemMotivo === 1 ? "" : "m"} tag.
        </p>
      ) : null}

      <Dialog open={confirmar !== null} onOpenChange={(aberto) => !aberto && setConfirmar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmar === "ligar" ? "Ligar as tags de motivo de perda" : "Desligar as tags"}
            </DialogTitle>
            <DialogDescription>
              {confirmar === "ligar" ? (
                <>
                  <span className="font-medium text-foreground">
                    {formatInt(dados?.leadsComMotivo ?? 0)} leads perdidos
                  </span>{" "}
                  recebem a tag do motivo agora. As automações ativas com
                  gatilho nessas tags disparam para todos eles de uma vez.
                </>
              ) : (
                <>
                  Os leads perdidos daqui em diante deixam de receber a tag. As
                  tags já aplicadas ficam nos leads, e nenhuma automação é
                  disparada.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {confirmar === "ligar" ? (
            <p className="text-xs text-muted-foreground">
              Confira antes se as automações de remarketing já estão ativas
              e com as tags certas: lead que receber a tag agora não volta a
              disparar automação criada depois.
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmar(null)} disabled={salvando}>
              Cancelar
            </Button>
            <Button
              variant={confirmar === "ligar" ? "default" : "destructive"}
              onClick={() => alternar(confirmar === "ligar")}
              disabled={salvando}
            >
              {salvando
                ? "Salvando..."
                : confirmar === "ligar"
                  ? `Ligar e marcar ${formatInt(dados?.leadsComMotivo ?? 0)} leads`
                  : "Desligar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
