"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Save } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

export function TemplateForm({
  baseMjml,
  templateId,
}: {
  baseMjml: string;
  templateId?: string;
}) {
  const router = useRouter();
  const isEditing = Boolean(templateId);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [mjml, setMjml] = useState(baseMjml);
  const [loading, setLoading] = useState(isEditing);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!templateId) return;
    (async () => {
      try {
        const res = await fetch(`/api/templates/${templateId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao carregar template.");
        setName(json.name ?? "");
        setCategory(json.category ?? "");
        setMjml(json.mjmlContent ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [templateId]);

  async function handlePreview() {
    setPreviewLoading(true);
    setError("");
    try {
      const res = await fetch("/api/templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mjml }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao gerar preview.");
      setPreviewHtml(json.html);
      setPreviewErrors(json.errors ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSave() {
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
            mjmlContent: mjml,
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

  return (
    <>
      <PageHeader
        title={isEditing ? "Editar template" : "HTML personalizado"}
        description="Escreva MJML ou cole HTML puro. Variáveis: {{nome_parceiro}}, {{titulo}}, {{subtitulo}}, {{corpo}}, {{cta_texto}}, {{cta_url}} e {{unsubscribe_url}}."
      >
        <Button variant="outline" asChild>
          <Link href="/templates">Cancelar</Link>
        </Button>
        <Button onClick={handleSave} disabled={saving || loading}>
          <Save />
          {saving ? "Salvando..." : "Salvar template"}
        </Button>
      </PageHeader>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Carregando template...
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Card>
              <CardContent className="grid gap-4 p-6">
                <div className="grid gap-2">
                  <Label htmlFor="template-name">Nome *</Label>
                  <Input
                    id="template-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex.: Novidade de produto"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Categoria</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="novidade">Novidade</SelectItem>
                      <SelectItem value="comunicado">Comunicado</SelectItem>
                      <SelectItem value="fiscal">Fiscal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="template-mjml">Código (MJML ou HTML) *</Label>
                  <Textarea
                    id="template-mjml"
                    value={mjml}
                    onChange={(e) => setMjml(e.target.value)}
                    spellCheck={false}
                    className="min-h-[480px] font-mono text-xs leading-relaxed"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Preview
              </h2>
              <Button
                variant="secondary"
                size="sm"
                onClick={handlePreview}
                disabled={previewLoading}
              >
                <Eye />
                {previewLoading ? "Gerando..." : "Gerar preview"}
              </Button>
            </div>

            {previewErrors.length > 0 ? (
              <div className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-xs text-primary">
                <p className="mb-1 font-semibold">Avisos do compilador MJML:</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {previewErrors.map((message, index) => (
                    <li key={index}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Card className="overflow-hidden">
              {previewHtml ? (
                <iframe
                  srcDoc={previewHtml}
                  sandbox=""
                  title="Preview do template"
                  className="h-[600px] w-full bg-white"
                />
              ) : (
                <p className="py-24 text-center text-sm text-muted-foreground">
                  Clique em &quot;Gerar preview&quot; para renderizar o MJML.
                </p>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
