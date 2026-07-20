"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, Save } from "lucide-react";

import { DesignEditor } from "@/components/builder/design-editor";
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
  const [saving, setSaving] = useState(false);

  const [previewHtml, setPreviewHtml] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

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
        } else {
          throw new Error(
            "Este template foi criado como código e não pode ser aberto no criador visual."
          );
        }
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
      if (res.ok) setPreviewHtml(json.html);
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
