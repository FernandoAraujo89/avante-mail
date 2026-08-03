"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { SendStatusBadge, sendStatusLabel } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import {
  describeSendOutcome,
  describeWhatsAppError,
} from "@/lib/whatsapp/errors";
import type { SendStatus } from "@/lib/db";

type Data = Date | string | null;

export interface SendTableRow {
  id: string;
  contactId: string;
  status: string;
  sentAt: Data;
  openedAt: Data;
  clickedAt: Data;
  deliveredAt: Data;
  readAt: Data;
  repliedAt: Data;
  complainedAt: Data;
  errorCode: string | null;
  errorMessage: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  contactCompany: string | null;
}

const PAGE_SIZES = [50, 100];
const TODOS = "todos";

function tempo(valor: Data): number {
  return valor ? new Date(valor).getTime() : 0;
}

/**
 * Tabela de envios do relatório: busca, filtro por status, ordenação e
 * paginação, tudo no cliente — os envios de um disparo já vêm todos do
 * servidor, e assim filtrar não custa uma ida ao banco.
 */
export function SendsTable({
  sends,
  channel,
  vazio,
}: {
  sends: SendTableRow[];
  channel: "email" | "whatsapp";
  vazio: string;
}) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState(TODOS);
  const [ordem, setOrdem] = useState("nome-az");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const isWhats = channel === "whatsapp";
  /** Coluna de engajamento do canal: e-mail abre, WhatsApp lê. */
  const engajamento = (s: SendTableRow) => (isWhats ? s.readAt : s.openedAt);
  const rotuloEngajamento = isWhats ? "Lida em" : "Aberto em";

  // Só os status que existem neste disparo — filtro sem opção morta.
  const statusDisponiveis = useMemo(
    () => [...new Set(sends.map((s) => s.status))].sort(),
    [sends]
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return sends.filter((s) => {
      if (status !== TODOS && s.status !== status) return false;
      if (!termo) return true;
      return [
        s.contactName,
        s.contactEmail,
        s.contactPhone ?? "",
        s.contactCompany ?? "",
      ].some((campo) => campo.toLowerCase().includes(termo));
    });
  }, [sends, busca, status]);

  const ordenadas = useMemo(() => {
    const copia = [...filtradas];
    const porNome = (a: SendTableRow, b: SendTableRow) =>
      a.contactName.localeCompare(b.contactName, "pt-BR");
    switch (ordem) {
      case "nome-za":
        return copia.sort((a, b) => -porNome(a, b));
      case "engajamento":
        // Sem abertura/leitura vai para o fim, não para o topo.
        return copia.sort(
          (a, b) => tempo(engajamento(b)) - tempo(engajamento(a)) || porNome(a, b)
        );
      case "enviado":
        return copia.sort((a, b) => tempo(b.sentAt) - tempo(a.sentAt) || porNome(a, b));
      case "status":
        return copia.sort(
          (a, b) => a.status.localeCompare(b.status) || porNome(a, b)
        );
      default:
        return copia.sort(porNome);
    }
    // `engajamento` deriva de `channel`, que já está nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtradas, ordem, channel]);

  // Mexer nos filtros volta para a primeira página, senão a lista parece vazia.
  useEffect(() => {
    setPage(1);
  }, [busca, status, ordem, pageSize]);

  const totalPages = Math.max(1, Math.ceil(ordenadas.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const inicio = (currentPage - 1) * pageSize;
  const pagina = ordenadas.slice(inicio, inicio + pageSize);

  if (sends.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">{vazio}</p>
    );
  }

  return (
    <div className="grid gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={
              isWhats
                ? "Buscar por nome, telefone ou empresa"
                : "Buscar por nome, e-mail ou empresa"
            }
            className="pl-9"
          />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os status</SelectItem>
            {statusDisponiveis.map((s) => (
              <SelectItem key={s} value={s}>
                {sendStatusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ordem} onValueChange={setOrdem}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nome-az">Nome (A–Z)</SelectItem>
            <SelectItem value="nome-za">Nome (Z–A)</SelectItem>
            <SelectItem value="engajamento">
              {rotuloEngajamento} (mais recente)
            </SelectItem>
            <SelectItem value="enviado">Enviado em (mais recente)</SelectItem>
            <SelectItem value="status">Status</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Altura limitada: sem isto a página rola sem fim em disparos grandes. */}
      <div className="max-h-[65vh] overflow-y-auto rounded-lg border border-border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
            <TableRow>
              <TableHead>Contato</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Enviado em</TableHead>
              {isWhats ? <TableHead>Entregue em</TableHead> : null}
              <TableHead>{rotuloEngajamento}</TableHead>
              {isWhats ? (
                <TableHead>Respondeu</TableHead>
              ) : (
                <TableHead>Clicado em</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagina.map((send) => {
              const outcome = isWhats
                ? describeSendOutcome(
                    send.status,
                    send.errorCode,
                    send.errorMessage
                  )
                : null;
              const erro =
                isWhats && send.status === "failed"
                  ? describeWhatsAppError(send.errorCode, send.errorMessage)
                  : null;
              return (
                <TableRow key={send.id}>
                  <TableCell>
                    <Link
                      href={`/contacts/${send.contactId}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {send.contactName}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {isWhats
                        ? formatPhone(send.contactPhone)
                        : send.contactEmail}
                      {send.contactCompany ? ` · ${send.contactCompany}` : ""}
                    </p>
                  </TableCell>
                  <TableCell className={isWhats ? "max-w-sm" : undefined}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SendStatusBadge status={send.status as SendStatus} />
                      {erro ? (
                        <Badge variant={erro.tone}>{erro.label}</Badge>
                      ) : null}
                      {!isWhats && send.complainedAt ? (
                        <Badge variant="warning">Spam</Badge>
                      ) : null}
                    </div>
                    {outcome ? (
                      <p
                        className={
                          outcome.tone === "destructive"
                            ? "mt-1 text-xs text-destructive-hover"
                            : "mt-1 text-xs text-muted-foreground"
                        }
                      >
                        {outcome.text}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(send.sentAt)}
                  </TableCell>
                  {isWhats ? (
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(send.deliveredAt)}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(engajamento(send))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(isWhats ? send.repliedAt : send.clickedAt)}
                  </TableCell>
                </TableRow>
              );
            })}
            {pagina.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isWhats ? 6 : 5}>
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum envio corresponde à busca ou ao filtro.
                  </p>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Por página</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => setPageSize(Number(v))}
          >
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span>
            {ordenadas.length === 0
              ? "0 envios"
              : `${inicio + 1}–${inicio + pagina.length} de ${ordenadas.length}`}
            {ordenadas.length !== sends.length ? ` (de ${sends.length})` : ""}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Página anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tabular-nums">
            {currentPage}/{totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-label="Próxima página"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
