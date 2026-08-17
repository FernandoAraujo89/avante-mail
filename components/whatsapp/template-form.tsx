"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Upload, X } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { WhatsAppBubblePreview } from "@/components/whatsapp/bubble-preview";
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
import {
  extractVariables,
  fillVariables,
  isMediaHeader,
  parseHeaderType,
  WHATSAPP_LIMITS,
  WHATSAPP_MEDIA_HEADERS,
  type WhatsAppButton,
  type WhatsAppHeaderType,
} from "@/lib/whatsapp/types";

// Rodapé sugerido por padrão: instrução de descadastro protege a qualidade
// do número (menos bloqueios/denúncias — ver plano, seção de riscos).
const DEFAULT_FOOTER = "Responda SAIR para não receber mais";

type ButtonRow = { type: "QUICK_REPLY" | "URL"; text: string; url: string };

interface TemplateDto {
  id: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  status: string;
  headerType: WhatsAppHeaderType;
  headerText: string | null;
  headerMediaUrl: string | null;
  headerMediaFilename: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: WhatsAppButton[] | null;
  variableExamples: Record<string, string> | null;
  rejectionReason: string | null;
}

function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function WhatsAppTemplateForm({ templateId }: { templateId?: string }) {
  const router = useRouter();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const isEditing = Boolean(templateId);

  // Depois de criar (POST), passa a editar (PATCH) sem trocar de rota.
  const [id, setId] = useState<string | undefined>(templateId);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("pt_BR");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [headerType, setHeaderType] = useState<WhatsAppHeaderType>("none");
  const [headerText, setHeaderText] = useState("");
  // Arquivo do cabeçalho já hospedado (a Meta baixa por esta URL no envio).
  const [headerMedia, setHeaderMedia] = useState<{
    url: string;
    filename: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState(DEFAULT_FOOTER);
  const [buttons, setButtons] = useState<ButtonRow[]>([]);
  const [examples, setExamples] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("draft");
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const readOnly = status !== "draft" && status !== "rejected";
  const variables = extractVariables(bodyText);
  const mediaSpec = isMediaHeader(headerType)
    ? WHATSAPP_MEDIA_HEADERS[headerType]
    : null;

  useEffect(() => {
    if (!templateId) return;
    (async () => {
      try {
        const res = await fetch(`/api/whatsapp-templates/${templateId}`);
        const json: TemplateDto = await res.json();
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error ?? "Erro ao carregar o modelo."
          );
        }
        setName(json.name);
        setLanguage(json.language);
        setCategory(json.category === "UTILITY" ? "UTILITY" : "MARKETING");
        setHeaderType(parseHeaderType(json.headerType));
        setHeaderText(json.headerText ?? "");
        setHeaderMedia(
          json.headerMediaUrl
            ? {
                url: json.headerMediaUrl,
                filename: json.headerMediaFilename ?? "arquivo",
              }
            : null
        );
        setBodyText(json.bodyText);
        setFooterText(json.footerText ?? "");
        setButtons(
          (json.buttons ?? []).map((b) => ({
            type: b.type,
            text: b.text,
            url: b.type === "URL" ? b.url : "",
          }))
        );
        setExamples(json.variableExamples ?? {});
        setStatus(json.status);
        setRejectionReason(json.rejectionReason);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [templateId]);

  function insertVariable() {
    const next = variables.length + 1;
    const token = `{{${next}}}`;
    const el = bodyRef.current;
    if (el) {
      const start = el.selectionStart ?? bodyText.length;
      const end = el.selectionEnd ?? bodyText.length;
      setBodyText(bodyText.slice(0, start) + token + bodyText.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      setBodyText(bodyText + token);
    }
  }

  async function handleMediaFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // permite reenviar o mesmo arquivo
    if (!file || !isMediaHeader(headerType)) return;

    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("kind", headerType);
      form.append("file", file);
      const res = await fetch("/api/whatsapp-templates/media", {
        method: "POST",
        body: form,
      });
      // Arquivo grande pode ser barrado pelo proxy antes de chegar na rota —
      // aí a resposta não é JSON e só o status conta.
      const json = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        throw new Error(
          json.error ??
            `O servidor recusou o arquivo (HTTP ${res.status}). Se o arquivo for grande, o limite pode estar no servidor web.`
        );
      }
      setHeaderMedia({ url: json.url, filename: json.filename });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function updateButton(index: number, patch: Partial<ButtonRow>) {
    setButtons((current) =>
      current.map((b, i) => (i === index ? { ...b, ...patch } : b))
    );
  }

  async function save(submitAfter: boolean) {
    setSaving(true);
    setError("");
    try {
      if (isMediaHeader(headerType) && !headerMedia) {
        throw new Error(
          headerType === "image"
            ? "Envie a imagem do cabeçalho (ou troque o cabeçalho para texto)."
            : "Envie o PDF do cabeçalho (ou troque o cabeçalho para texto)."
        );
      }

      const payload = {
        name,
        language,
        category,
        headerType,
        headerText: headerType === "text" ? headerText : null,
        headerMediaUrl: isMediaHeader(headerType)
          ? (headerMedia?.url ?? null)
          : null,
        headerMediaFilename: isMediaHeader(headerType)
          ? (headerMedia?.filename ?? null)
          : null,
        bodyText,
        footerText,
        buttons: buttons.map((b) =>
          b.type === "URL"
            ? { type: "URL", text: b.text, url: b.url }
            : { type: "QUICK_REPLY", text: b.text }
        ),
        variableExamples: examples,
      };

      const res = await fetch(
        id ? `/api/whatsapp-templates/${id}` : "/api/whatsapp-templates",
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar o modelo.");
      setId(json.id);

      if (submitAfter) {
        const submitRes = await fetch(
          `/api/whatsapp-templates/${json.id}/submit`,
          { method: "POST" }
        );
        const submitJson = await submitRes.json();
        if (!submitRes.ok) {
          throw new Error(
            submitJson.error ?? "Rascunho salvo, mas o envio à Meta falhou."
          );
        }
      }

      router.push("/whatsapp-templates");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  const previewBody = fillVariables(bodyText, examples);

  return (
    <>
      <PageHeader
        title={isEditing ? "Editar modelo" : "Novo modelo de WhatsApp"}
        description="Modelos precisam ser aprovados pela Meta antes de serem usados em campanhas."
      />

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Carregando modelo...
        </p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardContent className="p-6">
              <div className="grid gap-5">
                {error ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
                    {error}
                  </div>
                ) : null}

                {readOnly ? (
                  <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                    Este modelo já foi enviado à Meta e não pode ser editado.
                    Para mudar o conteúdo, crie um novo modelo.
                  </div>
                ) : null}

                {status === "rejected" && rejectionReason ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
                    Rejeitado pela Meta: {rejectionReason}
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="wa-name">Nome do modelo *</Label>
                    <Input
                      id="wa-name"
                      value={name}
                      onChange={(e) => setName(slugifyName(e.target.value))}
                      placeholder="promo_julho_2026"
                      disabled={readOnly}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Só letras minúsculas, números e _ (regra da Meta). Não
                      pode mudar depois do envio.
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label>Categoria *</Label>
                    <Select
                      value={category}
                      onValueChange={(v) =>
                        setCategory(v === "UTILITY" ? "UTILITY" : "MARKETING")
                      }
                      disabled={readOnly}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MARKETING">
                          Marketing (promoções e novidades)
                        </SelectItem>
                        <SelectItem value="UTILITY">
                          Utilidade (avisos transacionais)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Conteúdo promocional em modelo Utilidade é reclassificado
                      pela Meta.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Idioma *</Label>
                    <Select
                      value={language}
                      onValueChange={setLanguage}
                      disabled={readOnly}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pt_BR">Português (Brasil)</SelectItem>
                        <SelectItem value="en_US">Inglês (EUA)</SelectItem>
                        <SelectItem value="es_ES">Espanhol</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Cabeçalho</Label>
                    <Select
                      value={headerType}
                      onValueChange={(v) => setHeaderType(parseHeaderType(v))}
                      disabled={readOnly}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem cabeçalho</SelectItem>
                        <SelectItem value="text">Texto</SelectItem>
                        <SelectItem value="image">
                          Imagem (JPG ou PNG)
                        </SelectItem>
                        <SelectItem value="document">
                          Documento (PDF)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {headerType === "text" ? (
                  <div className="grid gap-2">
                    <Label htmlFor="wa-header">Texto do cabeçalho *</Label>
                    <Input
                      id="wa-header"
                      value={headerText}
                      onChange={(e) => setHeaderText(e.target.value)}
                      maxLength={WHATSAPP_LIMITS.headerText}
                      placeholder="Novidade para sua empresa"
                      disabled={readOnly}
                    />
                  </div>
                ) : null}

                {mediaSpec ? (
                  <div className="grid gap-2">
                    <Label>
                      {headerType === "image"
                        ? "Imagem do cabeçalho *"
                        : "PDF do cabeçalho *"}
                    </Label>
                    <input
                      ref={mediaRef}
                      type="file"
                      accept={mediaSpec.accept}
                      className="hidden"
                      onChange={handleMediaFile}
                    />
                    {headerMedia ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {headerMedia.filename}
                        </span>
                        {!readOnly ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => mediaRef.current?.click()}
                              disabled={uploading}
                            >
                              {uploading ? "Enviando..." : "Trocar"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setHeaderMedia(null)}
                              aria-label="Remover arquivo"
                              disabled={uploading}
                            >
                              <X className="text-muted-foreground" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="justify-self-start"
                        onClick={() => mediaRef.current?.click()}
                        disabled={readOnly || uploading}
                      >
                        <Upload />
                        {uploading
                          ? "Enviando..."
                          : headerType === "image"
                            ? "Enviar imagem"
                            : "Enviar PDF"}
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {headerType === "image"
                        ? "JPG ou PNG"
                        : "PDF (o nome do arquivo aparece no card da conversa)"}
                      , até {Math.round(mediaSpec.maxBytes / (1024 * 1024))}MB.
                      O arquivo fica hospedado aqui e a Meta baixa em cada
                      envio.
                    </p>
                  </div>
                ) : null}

                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="wa-body">Corpo da mensagem *</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={insertVariable}
                      disabled={readOnly}
                    >
                      <Plus />
                      Inserir variável
                    </Button>
                  </div>
                  <Textarea
                    id="wa-body"
                    ref={bodyRef}
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    maxLength={WHATSAPP_LIMITS.body}
                    rows={6}
                    placeholder={"Olá {{1}}! Temos uma condição especial para a {{2}}…"}
                    disabled={readOnly}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    {bodyText.length}/{WHATSAPP_LIMITS.body} caracteres.
                    Variáveis ({"{{1}}"}, {"{{2}}"}…) são preenchidas por
                    contato no envio.
                  </p>
                </div>

                {variables.length > 0 ? (
                  <div className="grid gap-2.5">
                    <Label>Exemplos das variáveis *</Label>
                    <p className="-mt-1 text-xs text-muted-foreground">
                      A Meta exige um exemplo por variável para analisar o
                      modelo.
                    </p>
                    {variables.map((n) => (
                      <div key={n} className="flex items-center gap-2">
                        <span className="w-14 shrink-0 rounded bg-muted px-2 py-1 text-center font-mono text-xs">
                          {`{{${n}}}`}
                        </span>
                        <Input
                          value={examples[String(n)] ?? ""}
                          onChange={(e) =>
                            setExamples((cur) => ({
                              ...cur,
                              [String(n)]: e.target.value,
                            }))
                          }
                          placeholder={n === 1 ? "Fernando" : "exemplo"}
                          disabled={readOnly}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="grid gap-2">
                  <Label htmlFor="wa-footer">Rodapé</Label>
                  <Input
                    id="wa-footer"
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                    maxLength={WHATSAPP_LIMITS.footerText}
                    disabled={readOnly}
                  />
                  <p className="text-xs text-muted-foreground">
                    Manter a instrução de descadastro protege a qualidade do
                    número.
                  </p>
                </div>

                <div className="grid gap-2.5">
                  <div className="flex items-center justify-between">
                    <Label>Botões</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setButtons((cur) => [
                          ...cur,
                          { type: "QUICK_REPLY", text: "", url: "" },
                        ])
                      }
                      disabled={readOnly || buttons.length >= WHATSAPP_LIMITS.buttons}
                    >
                      <Plus />
                      Adicionar botão
                    </Button>
                  </div>
                  {buttons.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Opcional — até {WHATSAPP_LIMITS.buttons} botões de
                      resposta rápida ou link.
                    </p>
                  ) : (
                    buttons.map((button, index) => (
                      <div
                        key={index}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <Select
                          value={button.type}
                          onValueChange={(v) =>
                            updateButton(index, {
                              type: v === "URL" ? "URL" : "QUICK_REPLY",
                            })
                          }
                          disabled={readOnly}
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="QUICK_REPLY">
                              Resposta rápida
                            </SelectItem>
                            <SelectItem value="URL">Link</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={button.text}
                          onChange={(e) =>
                            updateButton(index, { text: e.target.value })
                          }
                          maxLength={WHATSAPP_LIMITS.buttonText}
                          placeholder="Texto do botão"
                          className="w-44"
                          disabled={readOnly}
                        />
                        {button.type === "URL" ? (
                          <Input
                            value={button.url}
                            onChange={(e) =>
                              updateButton(index, { url: e.target.value })
                            }
                            placeholder="https://…"
                            className="min-w-48 flex-1"
                            disabled={readOnly}
                          />
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setButtons((cur) =>
                              cur.filter((_, i) => i !== index)
                            )
                          }
                          aria-label="Remover botão"
                          disabled={readOnly}
                        >
                          <X className="text-muted-foreground" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  {!readOnly ? (
                    <>
                      <Button
                        type="button"
                        onClick={() => save(false)}
                        disabled={saving}
                        variant="outline"
                      >
                        {saving ? "Salvando..." : "Salvar rascunho"}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => save(true)}
                        disabled={saving}
                      >
                        {saving
                          ? "Enviando..."
                          : "Salvar e enviar para análise"}
                      </Button>
                    </>
                  ) : null}
                  <Button type="button" variant="ghost" asChild>
                    <Link href="/whatsapp-templates">Voltar</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="lg:sticky lg:top-6">
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              Prévia
            </p>
            <WhatsAppBubblePreview
              headerText={headerType === "text" ? headerText : null}
              headerMedia={
                isMediaHeader(headerType) && headerMedia
                  ? { kind: headerType, ...headerMedia }
                  : null
              }
              bodyText={previewBody || "O corpo da mensagem aparece aqui…"}
              footerText={footerText}
              buttons={buttons}
            />
          </div>
        </div>
      )}
    </>
  );
}
