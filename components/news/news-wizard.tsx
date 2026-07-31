"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  LayoutTemplate,
  Mail,
  Plus,
  RotateCcw,
  Save,
  Send,
  Users,
} from "lucide-react";

import { DesignEditor } from "@/components/builder/design-editor";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { compileDesignToMjml } from "@/lib/email-builder/compile";
import { materializeDesignForEditing } from "@/lib/email-builder/materialize";
import { createDefaultDesign } from "@/lib/email-builder/presets";
import type { EmailDesign } from "@/lib/email-builder/types";
import type { NewsAudience } from "@/lib/settings";
import { cn } from "@/lib/utils";

type TemplateDto = {
  id: string;
  name: string;
  category: string | null;
  design: EmailDesign | null;
  editorType: string;
};

type WizardData = {
  name: string;
  subject: string;
  preheader: string;
  scheduledAt: string;
  templateId: string;
  design: EmailDesign | null;
  /** Manda também para a lista de colaboradores, além dos parceiros. */
  newsIncludeTeam: boolean;
};

const EMPTY_DATA: WizardData = {
  name: "",
  subject: "",
  preheader: "",
  scheduledAt: "",
  templateId: "",
  design: null,
  newsIncludeTeam: false,
};

// Sem passo de destinatários: o Avante News vai sempre para a lista de
// parceiros White Label Ativos, definida uma vez em /news.
const STEPS = [
  { number: 1, title: "Configurar" },
  { number: 2, title: "E-mail" },
  { number: 3, title: "Revisar" },
];

const MAX_TEST_EMAILS = 3;

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function NewsWizard({
  audience,
  team,
  editId,
  duplicateId,
}: {
  audience: NewsAudience;
  /** Lista de colaboradores; null = não existe, e a opção não aparece. */
  team: NewsAudience | null;
  editId?: string;
  duplicateId?: string;
}) {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(EMPTY_DATA);
  const [initializing, setInitializing] = useState(
    Boolean(editId || duplicateId)
  );
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testEmails, setTestEmails] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testMessage, setTestMessage] = useState("");

  // "Salvar como novo modelo"
  const [saveModelOpen, setSaveModelOpen] = useState(false);
  const [modelName, setModelName] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [modelMessage, setModelMessage] = useState("");

  // Modelos salvos — o Avante News parte de qualquer um deles.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/templates");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao carregar modelos.");
        setTemplates(json);
      } catch (err) {
        setTemplates([]);
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  // Carrega a edição em edição ou duplicação.
  useEffect(() => {
    const sourceId = editId ?? duplicateId;
    if (!sourceId) return;
    (async () => {
      try {
        const res = await fetch(`/api/campaigns/${sourceId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao carregar a edição.");

        let design: EmailDesign | null = json.design ?? null;
        if (!design && json.templateId) {
          try {
            const tRes = await fetch(`/api/templates/${json.templateId}`);
            const tJson = await tRes.json();
            if (tRes.ok && tJson.design) {
              design = materializeDesignForEditing(tJson.design);
            }
          } catch {
            // sem design de origem: o usuário escolhe um modelo no passo E-mail
          }
        }

        setData({
          name: duplicateId ? `${json.name} (cópia)` : (json.name ?? ""),
          subject: json.subject ?? "",
          preheader: json.preheader ?? "",
          scheduledAt: duplicateId ? "" : toLocalInputValue(json.scheduledAt),
          templateId: json.templateId ?? "",
          design,
          newsIncludeTeam: json.newsIncludeTeam === true,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setInitializing(false);
      }
    })();
  }, [editId, duplicateId]);

  const originTemplate = useMemo(
    () => templates?.find((t) => t.id === data.templateId) ?? null,
    [templates, data.templateId]
  );

  const editableModels = useMemo(
    () => (templates ?? []).filter((t) => t.editorType === "builder" && t.design),
    [templates]
  );

  const previewVariables = useMemo(
    () => ({
      nome_parceiro: "Parceiro Exemplo",
      titulo: data.name || "Avante News",
      subtitulo: data.preheader,
      unsubscribe_url: "#",
    }),
    [data.name, data.preheader]
  );

  // Preview final compilado a partir do e-mail da edição.
  useEffect(() => {
    if (step !== 3 || !data.design) return;
    let cancelled = false;
    setPreviewLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/templates/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mjml: compileDesignToMjml(data.design as EmailDesign),
            variables: previewVariables,
          }),
        });
        const json = await res.json();
        if (!cancelled && res.ok) setPreviewHtml(json.html);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, data.design, previewVariables]);

  // Quantos parceiros da lista estão realmente inscritos.
  useEffect(() => {
    if (step !== 3) return;
    let cancelled = false;
    setRecipientCount(null);

    (async () => {
      try {
        // Com os colaboradores marcados, a contagem soma as duas listas —
        // quem está nas duas é contado uma vez só (o filtro é por contato).
        const params = new URLSearchParams({
          count: "true",
          subscribed: "true",
          lists: [
            audience.id,
            ...(data.newsIncludeTeam && team ? [team.id] : []),
          ].join(","),
        });
        const res = await fetch(`/api/contacts?${params.toString()}`);
        const json = await res.json();
        if (!cancelled && res.ok) setRecipientCount(json.count);
      } catch {
        // Silencioso: a contagem é informativa.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, audience.id, data.newsIncludeTeam, team]);

  function update(patch: Partial<WizardData>) {
    setData((current) => ({ ...current, ...patch }));
  }

  // O modelo salvo é o ponto de partida — a partir daqui o conteúdo é livre.
  function pickModel(model: TemplateDto) {
    if (!model.design) return;
    update({
      design: materializeDesignForEditing(model.design),
      templateId: model.id,
    });
    setError("");
  }

  function startFromScratch() {
    update({ design: createDefaultDesign(), templateId: "" });
    setError("");
  }

  function changeModel() {
    update({ design: null, templateId: "" });
    setError("");
  }

  function validateStep(current: number): string {
    if (current === 1 && (!data.name.trim() || !data.subject.trim())) {
      return "Preencha o nome da edição e o assunto do e-mail.";
    }
    if (current === 2 && !data.design) {
      return "Monte o e-mail da edição: escolha um modelo salvo ou comece do zero.";
    }
    return "";
  }

  function goNext() {
    const message = validateStep(step);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    setStep((s) => Math.min(s + 1, 3));
  }

  function goBack() {
    setError("");
    setStep((s) => Math.max(s - 1, 1));
  }

  function buildPayload() {
    return {
      name: data.name.trim(),
      subject: data.subject.trim(),
      preheader: data.preheader,
      templateId: data.templateId || null,
      design: data.design,
      scheduledAt: data.scheduledAt
        ? new Date(data.scheduledAt).toISOString()
        : null,
      newsIncludeTeam: data.newsIncludeTeam,
    };
  }

  async function persist(): Promise<{ id: string }> {
    // Criação passa por /api/news (marca kind = news e fixa a lista);
    // edição usa a rota comum de campanhas, que preserva ambos.
    const res = await fetch(editId ? `/api/campaigns/${editId}` : "/api/news", {
      method: editId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Erro ao salvar a edição.");
    return json;
  }

  async function handleSaveDraft() {
    const message = validateStep(1);
    if (message) {
      setError(message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await persist();
      router.push("/news");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  async function handleDispatch() {
    setDispatching(true);
    setError("");
    try {
      const edition = await persist();
      const res = await fetch(`/api/campaigns/${edition.id}/send`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao enviar a edição.");
      router.push(json.scheduled ? "/news" : `/news/${edition.id}/report`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDispatching(false);
      setConfirmOpen(false);
    }
  }

  async function handlePreview() {
    if (!data.design) return;
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const res = await fetch("/api/templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mjml: compileDesignToMjml(data.design),
          variables: previewVariables,
        }),
      });
      const json = await res.json();
      if (res.ok) setPreviewHtml(json.html);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSaveAsModel() {
    if (!data.design || !modelName.trim()) return;
    setSavingModel(true);
    setModelMessage("");
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName.trim(), design: data.design }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar o modelo.");
      const listRes = await fetch("/api/templates");
      if (listRes.ok) setTemplates(await listRes.json());
      update({ templateId: json.id });
      setSaveModelOpen(false);
      setModelName("");
      setModelMessage(`Modelo "${json.name}" salvo. Já disponível para reuso.`);
    } catch (err) {
      setModelMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingModel(false);
    }
  }

  const parsedTestEmails = useMemo(
    () =>
      [
        ...new Set(
          testEmails
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean)
        ),
      ].slice(0, MAX_TEST_EMAILS + 1),
    [testEmails]
  );

  async function handleSendTest() {
    setTestMessage("");
    if (!data.design) {
      setTestMessage("Monte o e-mail da edição antes de enviar o teste.");
      return;
    }
    if (parsedTestEmails.length === 0) {
      setTestMessage("Informe ao menos um e-mail de teste.");
      return;
    }
    if (parsedTestEmails.length > MAX_TEST_EMAILS) {
      setTestMessage(`Máximo de ${MAX_TEST_EMAILS} e-mails de teste.`);
      return;
    }
    setSendingTest(true);
    try {
      // Persiste o rascunho para garantir um id (o teste usa a edição salva).
      const edition = await persist();
      const res = await fetch(`/api/campaigns/${edition.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: parsedTestEmails }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao enviar o teste.");
      const failed = Array.isArray(json.failed) ? json.failed : [];
      setTestMessage(
        failed.length > 0
          ? `Enviado para ${json.sent}. Falhou: ${failed.join(", ")}`
          : `E-mail de teste enviado para ${json.recipients.join(", ")}. Confira a caixa de entrada.`
      );
    } catch (err) {
      setTestMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingTest(false);
    }
  }

  const isScheduled =
    Boolean(data.scheduledAt) &&
    new Date(data.scheduledAt).getTime() > Date.now();

  // Para onde a edição vai, em texto — usado na confirmação do disparo.
  const destinoLabel =
    data.newsIncludeTeam && team
      ? `${audience.name} e ${team.name}`
      : audience.name;

  if (initializing) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Carregando edição...
      </p>
    );
  }

  return (
    <>
      {/* Espaço no fim para nada ficar escondido atrás da barra fixa. */}
      <div className="pb-24">
        <PageHeader
          title={editId ? "Editar edição do Avante News" : "Nova edição do Avante News"}
          description="Monte o boletim a partir de um modelo salvo, ajuste o conteúdo e revise antes de enviar aos parceiros White Label Ativos."
        />

        {/* Stepper */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          {STEPS.map((s, index) => (
            <div key={s.number} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (s.number < step) {
                    setError("");
                    setStep(s.number);
                  }
                }}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors",
                  step === s.number
                    ? "bg-primary/10 font-medium text-primary"
                    : s.number < step
                      ? "cursor-pointer text-success-dark hover:bg-muted"
                      : "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border text-xs",
                    step === s.number
                      ? "border-primary"
                      : s.number < step
                        ? "border-success-dark bg-success-light/30"
                        : "border-border"
                  )}
                >
                  {s.number < step ? <Check className="size-3" /> : s.number}
                </span>
                {s.title}
              </button>
              {index < STEPS.length - 1 ? (
                <div className="h-px w-6 bg-border" />
              ) : null}
            </div>
          ))}
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
            {error}
          </div>
        ) : null}

        {/* Passo 1 — Configurar */}
        {step === 1 ? (
          <Card className="max-w-3xl">
            <CardContent className="grid gap-5 p-6">
              <div className="grid gap-2">
                <Label htmlFor="news-name">Nome da edição *</Label>
                <Input
                  id="news-name"
                  value={data.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder="Ex.: Avante News — semana de 03/08"
                />
                <p className="text-xs text-muted-foreground">
                  Uso interno e título do e-mail (aba do navegador / cliente).
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="news-subject">Assunto do e-mail *</Label>
                <Input
                  id="news-subject"
                  value={data.subject}
                  onChange={(e) => update({ subject: e.target.value })}
                  placeholder="Ex.: Avante News: as novidades da semana"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="news-preheader">Preheader</Label>
                <Input
                  id="news-preheader"
                  value={data.preheader}
                  onChange={(e) => update({ preheader: e.target.value })}
                  placeholder="Texto curto exibido após o assunto na caixa de entrada"
                />
              </div>

              <div className="grid gap-2 sm:max-w-xs">
                <Label htmlFor="news-scheduled">Agendar para</Label>
                <Input
                  id="news-scheduled"
                  type="datetime-local"
                  value={data.scheduledAt}
                  onChange={(e) => update({ scheduledAt: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Deixe vazio para enviar imediatamente.
                </p>
              </div>

              <div className="flex items-start gap-3 rounded-lg bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
                <Users className="mt-0.5 size-4 shrink-0" />
                <span>
                  Esta edição vai para{" "}
                  <span className="font-medium text-foreground">
                    {audience.name}
                  </span>{" "}
                  ({audience.contactCount} contato
                  {audience.contactCount === 1 ? "" : "s"}) — a lista de
                  parceiros White Label Ativos é o público padrão do Avante
                  News.
                </span>
              </div>

              {team ? (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={data.newsIncludeTeam}
                    onChange={(e) =>
                      update({ newsIncludeTeam: e.target.checked })
                    }
                    className="mt-0.5 size-4 accent-[#1D50DC]"
                  />
                  <span>
                    Enviar também para{" "}
                    <span className="font-medium">{team.name}</span> (
                    {team.contactCount} contato
                    {team.contactCount === 1 ? "" : "s"})
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Os colaboradores recebem a mesma edição. Quem estiver nas
                      duas listas recebe uma vez só.
                    </span>
                  </span>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Para enviar também aos colaboradores, crie uma lista com
                  &quot;colaboradores&quot; no nome em{" "}
                  <span className="font-medium">Listas</span>.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Passo 2 — E-mail */}
        {step === 2 ? (
          !data.design ? (
            templates === null ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Carregando modelos...
              </p>
            ) : (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">
                    Escolha um modelo salvo para começar
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    O modelo é o ponto de partida — no passo seguinte você edita
                    todo o conteúdo desta edição, sem alterar o modelo salvo.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <button
                    type="button"
                    onClick={startFromScratch}
                    className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card p-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
                  >
                    <Plus className="size-6 text-primary" />
                    <span className="font-medium">Começar do zero</span>
                    <span className="text-xs text-muted-foreground">
                      E-mail em branco no Criador
                    </span>
                  </button>

                  {editableModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => pickModel(model)}
                      className="flex min-h-32 flex-col justify-between rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      <div className="flex items-start gap-2">
                        <LayoutTemplate className="mt-0.5 size-5 shrink-0 text-primary" />
                        <p className="font-medium">{model.name}</p>
                      </div>
                      {model.category ? (
                        <Badge variant="outline" className="mt-3 w-fit">
                          {model.category}
                        </Badge>
                      ) : null}
                    </button>
                  ))}
                </div>

                {editableModels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum modelo editável cadastrado ainda — comece do zero
                    acima, ou crie modelos em Templates.
                  </p>
                ) : null}
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  {originTemplate ? (
                    <>
                      Editando a partir de{" "}
                      <span className="font-medium text-foreground">
                        {originTemplate.name}
                      </span>
                    </>
                  ) : (
                    "E-mail próprio desta edição"
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={handlePreview}>
                    <Eye />
                    Pré-visualizar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setModelName(data.name ? `${data.name}` : "");
                      setModelMessage("");
                      setSaveModelOpen(true);
                    }}
                  >
                    <Save />
                    Salvar como novo modelo
                  </Button>
                  <Button variant="ghost" size="sm" onClick={changeModel}>
                    <RotateCcw />
                    Trocar modelo
                  </Button>
                </div>
              </div>

              {modelMessage ? (
                <div className="rounded-lg border border-success-dark/30 bg-success-light/20 px-4 py-2.5 text-sm text-success-dark">
                  {modelMessage}
                </div>
              ) : null}

              <DesignEditor
                value={data.design}
                onChange={(design) => update({ design })}
                onError={setError}
              />
            </div>
          )
        ) : null}

        {/* Passo 3 — Revisar */}
        {step === 3 ? (
          <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Resumo da edição</CardTitle>
                  <CardDescription>
                    Confira tudo antes de enviar.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-3 text-sm">
                    {[
                      { label: "Nome", value: data.name },
                      { label: "Assunto", value: data.subject },
                      { label: "Preheader", value: data.preheader || "—" },
                      {
                        label: "Modelo de origem",
                        value: originTemplate?.name ?? "Começado do zero",
                      },
                      {
                        label: "Listas",
                        value:
                          data.newsIncludeTeam && team
                            ? `${audience.name} + ${team.name}`
                            : audience.name,
                      },
                      {
                        label: "Envio",
                        value: isScheduled
                          ? `Agendado para ${new Date(
                              data.scheduledAt
                            ).toLocaleString("pt-BR")}`
                          : "Imediato",
                      },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between gap-4">
                        <dt className="shrink-0 text-muted-foreground">
                          {row.label}
                        </dt>
                        <dd className="truncate text-right font-medium">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                    <div className="flex justify-between gap-4 border-t border-border pt-3">
                      <dt className="text-muted-foreground">Destinatários</dt>
                      <dd className="text-right font-bold text-primary">
                        {recipientCount === null ? "..." : recipientCount}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {data.newsIncludeTeam && team
                      ? `Contatos de ${audience.name} e ${team.name} que continuam inscritos`
                      : `Parceiros da lista ${audience.name} que continuam inscritos`}{" "}
                    — descadastrados são excluídos automaticamente.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Mail className="size-4 text-primary" />
                    Enviar e-mail de teste
                  </CardTitle>
                  <CardDescription>
                    Envie para você antes do envio real. Até {MAX_TEST_EMAILS}{" "}
                    e-mails, separados por vírgula.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <Input
                    value={testEmails}
                    onChange={(e) => {
                      setTestEmails(e.target.value);
                      setTestMessage("");
                    }}
                    placeholder="voce@empresa.com, colega@empresa.com"
                  />
                  {parsedTestEmails.length > MAX_TEST_EMAILS ? (
                    <p className="text-xs text-destructive-hover">
                      Máximo de {MAX_TEST_EMAILS} e-mails.
                    </p>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={handleSendTest}
                    disabled={
                      sendingTest ||
                      !data.design ||
                      parsedTestEmails.length === 0 ||
                      parsedTestEmails.length > MAX_TEST_EMAILS
                    }
                  >
                    <Send />
                    {sendingTest ? "Enviando teste..." : "Enviar teste"}
                  </Button>
                  {testMessage ? (
                    <p className="text-xs text-muted-foreground">
                      {testMessage}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <Card className="overflow-hidden">
              {!data.design ? (
                <p className="py-24 text-center text-sm text-muted-foreground">
                  Nenhum e-mail montado.
                </p>
              ) : previewLoading && !previewHtml ? (
                <p className="py-24 text-center text-sm text-muted-foreground">
                  Gerando preview...
                </p>
              ) : (
                <iframe
                  srcDoc={previewHtml}
                  sandbox=""
                  title="Preview final do Avante News"
                  className="h-[560px] w-full bg-white"
                />
              )}
            </Card>
          </div>
        ) : null}
      </div>

      {/* Navegação — fixa na viewport, como no assistente de campanhas. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-2 border-t border-border bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-6 md:left-60 md:px-8">
        <div className="flex gap-2">
          {step > 1 ? (
            <Button variant="outline" onClick={goBack}>
              <ArrowLeft />
              Voltar
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={handleSaveDraft}
            disabled={saving || dispatching}
          >
            <Save />
            {saving ? "Salvando..." : "Salvar rascunho"}
          </Button>
          {step < 3 ? (
            <Button onClick={goNext}>
              Continuar
              <ArrowRight />
            </Button>
          ) : (
            <Button
              onClick={() => {
                const message = validateStep(2);
                if (message) {
                  setError(message);
                  return;
                }
                setConfirmOpen(true);
              }}
              disabled={dispatching || recipientCount === 0}
            >
              <Send />
              {isScheduled ? "Agendar envio" : "Enviar"}
            </Button>
          )}
        </div>
      </div>

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
              title="Pré-visualização do Avante News"
              className="h-[70vh] w-full rounded-lg border border-border bg-white"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: salvar como novo modelo */}
      <Dialog open={saveModelOpen} onOpenChange={setSaveModelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar como novo modelo</DialogTitle>
            <DialogDescription>
              O e-mail atual desta edição será salvo como um modelo reutilizável
              nas próximas edições e campanhas.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="news-model-name">Nome do modelo</Label>
            <Input
              id="news-model-name"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="Ex.: Avante News — layout padrão"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSaveModelOpen(false)}
              disabled={savingModel}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveAsModel}
              disabled={savingModel || !modelName.trim()}
            >
              {savingModel ? "Salvando..." : "Salvar modelo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: confirmar envio */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isScheduled ? "Confirmar agendamento" : "Confirmar envio"}
            </DialogTitle>
            <DialogDescription>
              {isScheduled
                ? `"${data.name}" será enviada para ${
                    recipientCount ?? "—"
                  } contatos de ${destinoLabel} em ${new Date(
                    data.scheduledAt
                  ).toLocaleString("pt-BR")}.`
                : `O Avante News será enviado agora para ${
                    recipientCount ?? "—"
                  } contatos de ${destinoLabel}. Essa ação não pode ser desfeita.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={dispatching}
            >
              Cancelar
            </Button>
            <Button onClick={handleDispatch} disabled={dispatching}>
              {dispatching
                ? "Enviando para a fila..."
                : isScheduled
                  ? "Confirmar agendamento"
                  : "Confirmar envio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
