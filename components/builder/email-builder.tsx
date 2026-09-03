"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, Save } from "lucide-react";

import { DesignEditor } from "@/components/builder/design-editor";
import { TestSendButton } from "@/components/templates/test-send-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compileDesignToMjml } from "@/lib/email-builder/compile";
import { importarHtmlParaDesign } from "@/lib/email-builder/importar";
import { createDefaultDesign } from "@/lib/email-builder/presets";
import type { EmailDesign } from "@/lib/email-builder/types";

export function EmailBuilder({ templateId }: { templateId?: string }) {
  const router = useRouter();
  const isEditing = Boolean(templateId);

  const [design, setDesign] = useState<EmailDesign | null>(
    isEditing ? null : createDefaultDesign()
  );
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [saving, setSaving] = useState(false);

  const [previewHtml, setPreviewHtml] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  // Carrega o template em edição.
  useEffect(() => {
    if (!templateId) return;
    (async () => {
      try {
        const res = await fetch(`/api/templates/${templateId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao carregar template.");
        setName(json.name ?? "");
        setCategory(json.category ?? "");
        if (json.design) {
          setDesign(json.design);
          return;
        }

        // Template escrito como código: em vez de recusar a abrir, importa.
        // Compila no servidor (mesmo caminho do envio) mantendo as variáveis,
        // e quebra o resultado em seções editáveis.
        const res2 = await fetch("/api/templates/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mjml: json.mjmlContent ?? "",
            manterVariaveis: true,
          }),
        });
        const compilado = await res2.json();
        if (!res2.ok) {
          throw new Error(
            compilado.error ?? "Erro ao abrir o template no criador visual."
          );
        }
        setDesign(importarHtmlParaDesign(compilado.html));
        setAviso(
          "Este template foi criado como código e foi aberto no criador visual: cada seção do e-mail virou uma estrutura editável. Ao salvar, ele passa a ser um template do criador."
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setDesign(createDefaultDesign());
      }
    })();
  }, [templateId]);

  async function handlePreview() {
    if (!design) return;
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const res = await fetch("/api/templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mjml: compileDesignToMjml(design) }),
      });
      const json = await res.json();
      if (res.ok) {
        setPreviewHtml(json.html);
        setPreviewError("");
      } else {
        // Sem isto, a falha de compilação abre o dialog com um iframe em
        // branco — indistinguível de "e-mail vazio".
        setPreviewError(json.error ?? "Erro ao gerar a pré-visualização.");
      }
    } catch {
      setPreviewError("Erro de conexão ao gerar a pré-visualização.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSave() {
    if (!design) return;
    if (!name.trim()) {
      setError("Dê um nome ao template antes de salvar.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        isEditing ? `/api/templates/${templateId}` : "/api/templates",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            category: category || null,
            design,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar template.");
      router.push("/templates");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  if (!design) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Carregando template...
      </p>
    );
  }

  return (
    <>
      {/* Barra superior */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/templates" aria-label="Voltar para templates">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="flex min-w-56 flex-1 flex-wrap items-center gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do template *"
            className="max-w-xs font-medium"
          />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="novidade">Novidade</SelectItem>
              <SelectItem value="comunicado">Comunicado</SelectItem>
              <SelectItem value="fiscal">Fiscal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePreview}>
            <Eye />
            Pré-visualizar
          </Button>
          <TestSendButton design={design} name={name} />
          <Button onClick={handleSave} disabled={saving}>
            <Save />
            {saving ? "Salvando..." : "Salvar template"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      {aviso ? (
        <div className="mb-4 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary">
          {aviso}
        </div>
      ) : null}

      {/* Editor */}
      <DesignEditor value={design} onChange={setDesign} onError={setError} />

      {/* Dialog: pré-visualização */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Pré-visualização</DialogTitle>
            <DialogDescription>
              Renderizada pelo mesmo pipeline do envio real, com dados de
              exemplo.
            </DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Gerando pré-visualização...
            </p>
          ) : previewError ? (
            <p className="py-16 text-center text-sm text-destructive-hover">
              {previewError}
            </p>
          ) : (
            <iframe
              srcDoc={previewHtml}
              sandbox=""
              title="Pré-visualização do template"
              className="h-[70vh] w-full rounded-lg border border-border bg-white"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
