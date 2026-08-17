"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { WhatsAppTemplateStatusBadge } from "@/components/whatsapp/template-status-badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import {
  isMediaHeader,
  type WhatsAppHeaderType,
  type WhatsAppTemplateStatus,
} from "@/lib/whatsapp/types";

type TemplateDto = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: WhatsAppTemplateStatus;
  headerType: WhatsAppHeaderType;
  headerMediaFilename: string | null;
  bodyText: string;
  qualityScore: string | null;
  rejectionReason: string | null;
  updatedAt: string;
  createdAt: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

const QUALITY_LABELS: Record<string, { label: string; variant: "success" | "warning" | "destructive" }> = {
  GREEN: { label: "Alta", variant: "success" },
  YELLOW: { label: "Média", variant: "warning" },
  RED: { label: "Baixa", variant: "destructive" },
};

const EDITABLE = new Set<WhatsAppTemplateStatus>(["draft", "rejected"]);

export default function WhatsAppTemplatesPage() {
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await fetch("/api/whatsapp-templates");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar modelos.");
      setTemplates(json);
    } catch (err) {
      setTemplates([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/whatsapp-templates/sync", {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao sincronizar.");
      setNotice(
        `Sincronizado com a Meta: ${json.updated} atualizado(s), ${json.imported} importado(s).` +
          (json.skipped
            ? ` ${json.skipped} não importado(s): modelo com cabeçalho de arquivo ou sem corpo de texto tem de ser criado aqui.`
            : "")
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  async function handleSubmit(template: TemplateDto) {
    setSubmittingId(template.id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(
        `/api/whatsapp-templates/${template.id}/submit`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao enviar para análise.");
      setNotice(`Modelo "${template.name}" enviado para análise da Meta.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/whatsapp-templates/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao excluir modelo.");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Modelos de WhatsApp"
        description="Mensagens pré-aprovadas pela Meta usadas nas campanhas de WhatsApp."
      >
        <Button variant="outline" onClick={handleSync} disabled={syncing}>
          <RefreshCw className={syncing ? "animate-spin" : undefined} />
          {syncing ? "Sincronizando..." : "Sincronizar com a Meta"}
        </Button>
        <Button asChild>
          <Link href="/whatsapp-templates/new">
            <Plus />
            Novo modelo
          </Link>
        </Button>
      </PageHeader>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 rounded-lg border border-border bg-accent/50 px-4 py-3 text-sm">
          {notice}
        </div>
      ) : null}

      <Card>
        {templates === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando modelos...
          </p>
        ) : templates.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum modelo criado ainda. Campanhas de WhatsApp só saem com um
              modelo aprovado pela Meta.
            </p>
            <Button asChild className="mt-4">
              <Link href="/whatsapp-templates/new">
                <Plus />
                Criar o primeiro modelo
              </Link>
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Idioma</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Qualidade</TableHead>
                <TableHead>Atualizado</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => {
                const editable = EDITABLE.has(template.status);
                const quality = template.qualityScore
                  ? QUALITY_LABELS[template.qualityScore.toUpperCase()]
                  : null;
                return (
                  <TableRow key={template.id}>
                    <TableCell>
                      <Link
                        href={`/whatsapp-templates/${template.id}`}
                        className="font-mono text-sm font-medium hover:underline"
                      >
                        {template.name}
                      </Link>
                      <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
                        {template.bodyText}
                      </p>
                      {isMediaHeader(template.headerType) ? (
                        <p className="mt-0.5 flex max-w-md items-center gap-1 text-xs text-muted-foreground">
                          {template.headerType === "image" ? (
                            <ImageIcon className="size-3 shrink-0" />
                          ) : (
                            <FileText className="size-3 shrink-0" />
                          )}
                          <span className="truncate">
                            {template.headerType === "image"
                              ? "Imagem no cabeçalho"
                              : (template.headerMediaFilename ??
                                "PDF no cabeçalho")}
                          </span>
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {CATEGORY_LABELS[template.category] ?? template.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {template.language}
                    </TableCell>
                    <TableCell>
                      <span title={template.rejectionReason ?? undefined}>
                        <WhatsAppTemplateStatusBadge status={template.status} />
                      </span>
                    </TableCell>
                    <TableCell>
                      {quality ? (
                        <Badge variant={quality.variant}>{quality.label}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(template.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {editable ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleSubmit(template)}
                            disabled={submittingId === template.id}
                            title="Enviar para análise da Meta"
                            aria-label={`Enviar ${template.name} para análise`}
                          >
                            <Send className="text-muted-foreground" />
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="icon" asChild>
                          <Link
                            href={`/whatsapp-templates/${template.id}`}
                            aria-label={`${editable ? "Editar" : "Ver"} ${template.name}`}
                          >
                            <Pencil className="text-muted-foreground" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(template)}
                          aria-label={`Excluir ${template.name}`}
                        >
                          <Trash2 className="text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir modelo</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.name}
              </span>
              ?{" "}
              {deleteTarget && !EDITABLE.has(deleteTarget.status)
                ? "Ele também será excluído na Meta e deixará de valer para novas campanhas."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
