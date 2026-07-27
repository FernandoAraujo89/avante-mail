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
  MessageCircle,
  Plus,
  RotateCcw,
  Save,
  Send,
  Users,
} from "lucide-react";

import { DesignEditor } from "@/components/builder/design-editor";
import {
  WhatsAppMessageStep,
  type WaTemplateOption,
} from "@/components/campaigns/whatsapp-message-step";
import { WhatsAppBubblePreview } from "@/components/whatsapp/bubble-preview";
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
import type { EditorType, EmailDesign } from "@/lib/email-builder/types";
import { listsLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  extractVariables,
  fillVariables,
  WHATSAPP_BRAZIL_PRICE_USD,
  type WhatsAppVariableMap,
} from "@/lib/whatsapp/types";
import { resolveVariables } from "@/lib/whatsapp/variables";

type ListRef = { id: string; name: string };

type TemplateDto = {
  id: string;
  name: string;
  category: string | null;
  mjmlContent: string;
  design: EmailDesign | null;
  editorType: EditorType;
};

type CampaignChannel = "email" | "whatsapp";

type WaConfig = {
  configured: boolean;
  dailyLimit: number | null;
  pricesUsd: Record<string, number>;
};

type WizardData = {
  name: string;
  subject: string;
  preheader: string;
  scheduledAt: string;
  templateId: string;
  design: EmailDesign | null;
  editorType: EditorType;
  lists: string[];
  tagsFilter: string;
  channel: CampaignChannel;
  whatsappTemplateId: string;
  whatsappVariables: WhatsAppVariableMap;
};

const EMPTY_DATA: WizardData = {
  name: "",
  subject: "",
  preheader: "",
  scheduledAt: "",
  templateId: "",
  design: null,
  editorType: "builder",
  lists: [],
  tagsFilter: "",
  channel: "email",
  whatsappTemplateId: "",
  whatsappVariables: {},
};

const STEPS = [
  { number: 1, title: "Configurar" },
  { number: 2, title: "E-mail" },
  { number: 3, title: "Destinatários" },
  { number: 4, title: "Revisar" },
];

const MAX_TEST_EMAILS = 3;

/** Divide a string de tags em uma lista limpa e sem duplicatas. */
function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function CampaignWizard({
  editId,
  duplicateId,
}: {
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
  const [waTemplates, setWaTemplates] = useState<WaTemplateOption[] | null>(
    null
  );
  const [waConfig, setWaConfig] = useState<WaConfig | null>(null);
  const [testPhones, setTestPhones] = useState("");
  const [availableLists, setAvailableLists] = useState<ListRef[]>([]);
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

  // Carrega os modelos disponíveis (templates com design editável).
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

  // Carrega as listas disponíveis para segmentar os destinatários.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/lists");
        if (res.ok) setAvailableLists(await res.json());
      } catch {
        // silencioso: sem listas, a campanha vai para todos
      }
    })();
  }, []);

  // Modelos de WhatsApp e estado do canal (para o passo Mensagem e o Revisar).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/whatsapp-templates");
        setWaTemplates(res.ok ? await res.json() : []);
      } catch {
        setWaTemplates([]);
      }
      try {
        const res = await fetch("/api/whatsapp/config");
        if (res.ok) setWaConfig(await res.json());
      } catch {
        // silencioso: sem config, o Revisar mostra o aviso de não configurado
      }
    })();
  }, []);

  // Carrega a campanha em edição ou duplicação.
  useEffect(() => {
    const sourceId = editId ?? duplicateId;
    if (!sourceId) return;
    (async () => {
      try {
        const res = await fetch(`/api/campaigns/${sourceId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao carregar campanha.");

        let design: EmailDesign | null = json.design ?? null;
        // Campanha antiga (sem e-mail próprio): parte do design do modelo de origem.
        if (!design && json.templateId) {
          try {
            const tRes = await fetch(`/api/templates/${json.templateId}`);
            const tJson = await tRes.json();
            if (tRes.ok && tJson.design) {
              design = materializeDesignForEditing(tJson.design);
            }
          } catch {
            // sem design de origem: usuário escolhe um modelo no passo E-mail
          }
        }

        setData({
          name: duplicateId ? `${json.name} (cópia)` : (json.name ?? ""),
          subject: json.subject ?? "",
          preheader: json.preheader ?? "",
          scheduledAt: duplicateId ? "" : toLocalInputValue(json.scheduledAt),
          templateId: json.templateId ?? "",
          design,
          editorType: json.editorType ?? "builder",
          lists: Array.isArray(json.lists) ? json.lists : [],
          tagsFilter: Array.isArray(json.tagsFilter)
            ? json.tagsFilter.join(", ")
            : "",
          channel: json.channel === "whatsapp" ? "whatsapp" : "email",
          whatsappTemplateId: json.whatsappTemplateId ?? "",
          whatsappVariables:
            json.whatsappVariables && typeof json.whatsappVariables === "object"
              ? json.whatsappVariables
              : {},
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

  const selectedWaTemplate = useMemo(
    () => waTemplates?.find((t) => t.id === data.whatsappTemplateId) ?? null,
    [waTemplates, data.whatsappTemplateId]
  );

  // Variáveis do modelo ainda sem fonte definida (bloqueiam o avanço).
  const waMissingVariables = useMemo(() => {
    if (!selectedWaTemplate) return [];
    return extractVariables(selectedWaTemplate.bodyText).filter((n) => {
      const source = data.whatsappVariables[String(n)];
      if (!source) return true;
      return source.source === "static" && !source.value?.trim();
    });
  }, [selectedWaTemplate, data.whatsappVariables]);

  // Valores da prévia do Revisar (contato de exemplo).
  const waPreviewValues = useMemo(() => {
    if (!selectedWaTemplate) return {};
    return resolveVariables({
      bodyText: selectedWaTemplate.bodyText,
      variables: data.whatsappVariables,
      examples: selectedWaTemplate.variableExamples,
      contact: { name: "Parceiro Exemplo", company: "Empresa Exemplo" },
    });
  }, [selectedWaTemplate, data.whatsappVariables]);

  // Modelos que podem ser abertos no Criador (têm design).
  const editableModels = useMemo(
    () => (templates ?? []).filter((t) => t.editorType === "builder" && t.design),
    [templates]
  );

  const previewVariables = useMemo(
    () => ({
      nome_parceiro: "Parceiro Exemplo",
      titulo: data.name || "Título da campanha",
      subtitulo: data.preheader,
      unsubscribe_url: "#",
    }),
    [data.name, data.preheader]
  );

  // Preview final (passo 4) compilado a partir do e-mail da campanha.
  useEffect(() => {
    if (step !== 4 || !data.design) return;
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

  // Contagem de destinatários elegíveis nos passos 3 e 4.
  useEffect(() => {
    if (step !== 3 && step !== 4) return;
    let cancelled = false;
    setRecipientCount(null);

    (async () => {
      try {
        // Elegibilidade por canal: e-mail = inscritos; WhatsApp = telefone +
        // consentimento do canal.
        const params = new URLSearchParams({ count: "true" });
        if (data.channel === "whatsapp") {
          params.set("whatsappEligible", "true");
        } else {
          params.set("subscribed", "true");
        }
        if (data.lists.length > 0) {
          params.set("lists", data.lists.join(","));
        }
        const tags = parseTags(data.tagsFilter);
        if (tags.length > 0) params.set("tags", tags.join(","));

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
  }, [step, data.lists, data.tagsFilter, data.channel]);

  function update(patch: Partial<WizardData>) {
    setData((current) => ({ ...current, ...patch }));
  }

  function toggleList(value: string) {
    setData((current) => ({
      ...current,
      lists: current.lists.includes(value)
        ? current.lists.filter((s) => s !== value)
        : [...current.lists, value],
    }));
  }

  // Usa um modelo como ponto de partida: copia o design (materializado).
  function pickModel(model: TemplateDto) {
    if (!model.design) return;
    update({
      design: materializeDesignForEditing(model.design),
      templateId: model.id,
      editorType: "builder",
    });
    setError("");
  }

  function startFromScratch() {
    update({ design: createDefaultDesign(), templateId: "", editorType: "builder" });
    setError("");
  }

  function changeModel() {
    update({ design: null, templateId: "" });
    setError("");
  }

  function validateStep(current: number): string {
    if (current === 1) {
      if (data.channel === "whatsapp") {
        if (!data.name.trim()) return "Preencha o nome da campanha.";
      } else if (!data.name.trim() || !data.subject.trim()) {
        return "Preencha ao menos o nome da campanha e o assunto do e-mail.";
      }
    }
    if (current === 2) {
      if (data.channel === "whatsapp") {
        if (!data.whatsappTemplateId || !selectedWaTemplate) {
          return "Escolha um modelo aprovado para a mensagem.";
        }
        if (waMissingVariables.length > 0) {
          return `Defina o valor das variáveis ${waMissingVariables
            .map((n) => `{{${n}}}`)
            .join(", ")}.`;
        }
      } else if (!data.design) {
        return "Monte o e-mail da campanha: escolha um modelo ou comece do zero.";
      }
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
    setStep((s) => Math.min(s + 1, 4));
  }

  function goBack() {
    setError("");
    setStep((s) => Math.max(s - 1, 1));
  }

  function buildPayload() {
    return {
      name: data.name.trim(),
      // No WhatsApp não há assunto — o nome preenche a coluna (não aparece).
      subject:
        data.channel === "whatsapp" ? data.name.trim() : data.subject.trim(),
      preheader: data.preheader,
      templateId: data.templateId || null,
      design: data.design,
      editorType: data.editorType,
      lists: data.lists,
      tagsFilter: data.tagsFilter,
      scheduledAt: data.scheduledAt
        ? new Date(data.scheduledAt).toISOString()
        : null,
      channel: data.channel,
      whatsappTemplateId: data.whatsappTemplateId || null,
      whatsappVariables: data.whatsappVariables,
    };
  }

  async function persist(): Promise<{ id: string }> {
    const res = await fetch(
      editId ? `/api/campaigns/${editId}` : "/api/campaigns",
      {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Erro ao salvar a campanha.");
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
      router.push("/campaigns");
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
      const campaign = await persist();
      const res = await fetch(`/api/campaigns/${campaign.id}/send`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao disparar a campanha.");
      router.push(
        json.scheduled ? "/campaigns" : `/campaigns/${campaign.id}/report`
      );
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
      // Recarrega a lista de modelos para o novo aparecer na galeria.
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

  const parsedTestPhones = useMemo(
    () =>
      [
        ...new Set(
          testPhones
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean)
        ),
      ].slice(0, MAX_TEST_EMAILS + 1),
    [testPhones]
  );

  async function handleSendTest() {
    setTestMessage("");

    if (data.channel === "whatsapp") {
      if (!data.whatsappTemplateId) {
        setTestMessage("Escolha o modelo da mensagem antes de enviar o teste.");
        return;
      }
      if (parsedTestPhones.length === 0) {
        setTestMessage("Informe ao menos um telefone de teste.");
        return;
      }
      if (parsedTestPhones.length > MAX_TEST_EMAILS) {
        setTestMessage(`Máximo de ${MAX_TEST_EMAILS} telefones de teste.`);
        return;
      }
      setSendingTest(true);
      try {
        const campaign = await persist();
        const res = await fetch(`/api/campaigns/${campaign.id}/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phones: parsedTestPhones }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao enviar o teste.");
        const failed = Array.isArray(json.failed) ? json.failed : [];
        setTestMessage(
          failed.length > 0
            ? `Enviado para ${json.sent}. Falhou: ${failed.join(", ")}`
            : `Mensagem de teste enviada para ${json.recipients.join(", ")}. Confira o WhatsApp.`
        );
      } catch (err) {
        setTestMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setSendingTest(false);
      }
      return;
    }

    if (!data.design) {
      setTestMessage("Monte o e-mail da campanha antes de enviar o teste.");
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
      // Persiste o rascunho para garantir um id (o teste usa a campanha salva).
      const campaign = await persist();
      const res = await fetch(`/api/campaigns/${campaign.id}/test`, {
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

  if (initializing) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Carregando campanha...
      </p>
    );
  }

  return (
    <>
      {/* Espaço no fim para nada ficar escondido atrás da barra fixa. */}
      <div className="pb-24">
      <PageHeader
        title={editId ? "Editar campanha" : "Nova campanha"}
        description={
          data.channel === "whatsapp"
            ? "Configure, escolha o modelo aprovado da mensagem, selecione os destinatários e revise antes de disparar."
            : "Configure, monte o e-mail a partir de um modelo, selecione os destinatários e revise antes de disparar."
        }
      />

      {/* Stepper */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        {STEPS.map((raw) =>
          raw.number === 2 && data.channel === "whatsapp"
            ? { ...raw, title: "Mensagem" }
            : raw
        ).map((s, index) => (
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
              <Label>Canal de envio</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    {
                      value: "email",
                      label: "E-mail",
                      description: "Newsletter montada no Criador de e-mails",
                      icon: Mail,
                    },
                    {
                      value: "whatsapp",
                      label: "WhatsApp",
                      description: "Modelo aprovado pela Meta, via Cloud API",
                      icon: MessageCircle,
                    },
                  ] as const
                ).map((option) => {
                  const active = data.channel === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={Boolean(editId)}
                      onClick={() => update({ channel: option.value })}
                      aria-pressed={active}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:border-muted-foreground/40",
                        editId ? "cursor-not-allowed opacity-60" : ""
                      )}
                    >
                      <option.icon
                        className={cn(
                          "mt-0.5 size-5 shrink-0",
                          active ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                      <span>
                        <span className="block font-medium">{option.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {editId ? (
                <p className="text-xs text-muted-foreground">
                  O canal não pode ser alterado depois que a campanha é criada.
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="campaign-name">Nome da campanha *</Label>
              <Input
                id="campaign-name"
                value={data.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Ex.: Lançamento do módulo financeiro"
              />
              <p className="text-xs text-muted-foreground">
                {data.channel === "whatsapp"
                  ? "Uso interno — não aparece na mensagem."
                  : "Uso interno e título do e-mail (aba do navegador / cliente)."}
              </p>
            </div>

            {data.channel === "email" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="campaign-subject">Assunto do e-mail *</Label>
                  <Input
                    id="campaign-subject"
                    value={data.subject}
                    onChange={(e) => update({ subject: e.target.value })}
                    placeholder="Ex.: Chegou o novo módulo financeiro do seu sistema"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="campaign-preheader">Preheader</Label>
                  <Input
                    id="campaign-preheader"
                    value={data.preheader}
                    onChange={(e) => update({ preheader: e.target.value })}
                    placeholder="Texto curto exibido após o assunto na caixa de entrada"
                  />
                </div>
              </>
            ) : null}

            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="campaign-scheduled">Agendar para</Label>
              <Input
                id="campaign-scheduled"
                type="datetime-local"
                value={data.scheduledAt}
                onChange={(e) => update({ scheduledAt: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Deixe vazio para disparar imediatamente.
              </p>
            </div>

            <p className="rounded-lg bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
              {data.channel === "whatsapp"
                ? "O conteúdo da mensagem é um modelo pré-aprovado pela Meta, escolhido no próximo passo."
                : "O conteúdo do e-mail (textos, imagens, botões) é montado no próximo passo, no Criador de e-mails."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Passo 2 — Mensagem (WhatsApp) */}
      {step === 2 && data.channel === "whatsapp" ? (
        <WhatsAppMessageStep
          templates={waTemplates}
          selectedId={data.whatsappTemplateId}
          variables={data.whatsappVariables}
          onSelect={(id) => update({ whatsappTemplateId: id })}
          onVariablesChange={(whatsappVariables) =>
            update({ whatsappVariables })
          }
        />
      ) : null}

      {/* Passo 2 — E-mail */}
      {step === 2 && data.channel === "email" ? (
        !data.design ? (
          // Galeria de modelos
          templates === null ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Carregando modelos...
            </p>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">
                  Escolha um modelo para começar
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  O modelo é só o ponto de partida — no passo seguinte você edita
                  todo o layout livremente.
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
                  Nenhum modelo editável cadastrado ainda — comece do zero acima,
                  ou crie modelos em Templates.
                </p>
              ) : null}
            </div>
          )
        ) : (
          // Criador de e-mail embutido
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
                  "E-mail personalizado desta campanha"
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

      {/* Passo 3 — Destinatários */}
      {step === 3 ? (
        <div className="grid max-w-3xl gap-6">
          <Card>
            <CardContent className="grid gap-6 p-6">
              <div className="grid gap-2.5">
                <Label>Listas</Label>
                {availableLists.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma lista criada ainda. Crie listas em{" "}
                    <span className="font-medium">Listas</span> para segmentar os
                    envios.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableLists.map((list) => {
                      const active = data.lists.includes(list.id);
                      return (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => toggleList(list.id)}
                          aria-pressed={active}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                            active
                              ? "border-primary bg-primary/10 font-medium text-primary"
                              : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40"
                          )}
                        >
                          {active ? <Check className="size-3.5" /> : null}
                          {list.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Selecione uma ou mais listas. Nenhuma selecionada = todas as
                  listas.
                </p>
              </div>

              <div className="grid gap-2.5">
                <Label htmlFor="campaign-tags">Filtrar por tags</Label>
                <Input
                  id="campaign-tags"
                  value={data.tagsFilter}
                  onChange={(e) => update({ tagsFilter: e.target.value })}
                  placeholder="food, pdv, nfe"
                />
                {parseTags(data.tagsFilter).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {parseTags(data.tagsFilter).map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Separadas por vírgula. O contato entra se tiver qualquer uma
                  delas.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10">
                <Users className="size-6 text-primary" />
              </div>
              <div>
                <p className="text-3xl font-bold tracking-tight">
                  {recipientCount === null ? "..." : recipientCount}
                </p>
                <p className="text-sm text-muted-foreground">
                  {data.channel === "whatsapp"
                    ? "destinatários elegíveis (apenas contatos com telefone e consentimento de WhatsApp)"
                    : "destinatários elegíveis (contatos descadastrados são excluídos automaticamente)"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Passo 4 — Revisar */}
      {step === 4 ? (
        <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Resumo da campanha</CardTitle>
                <CardDescription>
                  Confira tudo antes de disparar.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  {[
                    { label: "Nome", value: data.name },
                    ...(data.channel === "whatsapp"
                      ? [
                          {
                            label: "Modelo",
                            value: selectedWaTemplate?.name ?? "—",
                          },
                          {
                            label: "Categoria",
                            value:
                              selectedWaTemplate?.category === "UTILITY"
                                ? "Utilidade"
                                : "Marketing",
                          },
                        ]
                      : [
                          { label: "Assunto", value: data.subject },
                          { label: "Preheader", value: data.preheader || "—" },
                          {
                            label: "Modelo de origem",
                            value: originTemplate?.name ?? "Começado do zero",
                          },
                        ]),
                    {
                      label: "Listas",
                      value: listsLabel(
                        data.lists.map(
                          (id) =>
                            availableLists.find((l) => l.id === id)?.name ?? id
                        )
                      ),
                    },
                    {
                      label: "Tags",
                      value: parseTags(data.tagsFilter).join(", ") || "Sem filtro",
                    },
                    {
                      label: "Disparo",
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
                  {data.channel === "whatsapp" ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-muted-foreground">
                        Custo estimado (Meta)
                      </dt>
                      <dd className="text-right font-medium">
                        {recipientCount === null
                          ? "..."
                          : `~US$ ${(
                              recipientCount *
                              ((waConfig?.pricesUsd ??
                                WHATSAPP_BRAZIL_PRICE_USD)[
                                selectedWaTemplate?.category ?? "MARKETING"
                              ] ?? WHATSAPP_BRAZIL_PRICE_USD.MARKETING)
                            ).toFixed(2)}`}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>

            {data.channel === "whatsapp" && waConfig && !waConfig.configured ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
                O canal WhatsApp ainda não foi configurado no servidor (Fase 0
                do plano). Salve como rascunho — o disparo fica bloqueado até
                lá.
              </div>
            ) : null}

            {data.channel === "whatsapp" &&
            waConfig?.dailyLimit != null &&
            recipientCount !== null &&
            recipientCount > waConfig.dailyLimit ? (
              <div className="rounded-lg border border-border bg-accent/50 px-4 py-3 text-sm">
                Atenção: seu limite atual é de{" "}
                <span className="font-medium">
                  {waConfig.dailyLimit} conversas/24h
                </span>{" "}
                e a campanha tem {recipientCount} destinatários — o excedente
                pode falhar no envio. Considere dividir por listas ou aguardar
                o limite subir.
              </div>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {data.channel === "whatsapp" ? (
                    <MessageCircle className="size-4 text-primary" />
                  ) : (
                    <Mail className="size-4 text-primary" />
                  )}
                  {data.channel === "whatsapp"
                    ? "Enviar teste por WhatsApp"
                    : "Enviar e-mail de teste"}
                </CardTitle>
                <CardDescription>
                  {data.channel === "whatsapp"
                    ? `Envia o modelo real (cobrado pela Meta) para até ${MAX_TEST_EMAILS} números, separados por vírgula.`
                    : `Envie para você antes do disparo real. Até ${MAX_TEST_EMAILS} e-mails, separados por vírgula.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {data.channel === "whatsapp" ? (
                  <>
                    <Input
                      value={testPhones}
                      onChange={(e) => {
                        setTestPhones(e.target.value);
                        setTestMessage("");
                      }}
                      placeholder="(48) 99999-9999, (11) 98888-7777"
                    />
                    {parsedTestPhones.length > MAX_TEST_EMAILS ? (
                      <p className="text-xs text-destructive-hover">
                        Máximo de {MAX_TEST_EMAILS} telefones.
                      </p>
                    ) : null}
                    <Button
                      variant="outline"
                      onClick={handleSendTest}
                      disabled={
                        sendingTest ||
                        !waConfig?.configured ||
                        parsedTestPhones.length === 0 ||
                        parsedTestPhones.length > MAX_TEST_EMAILS
                      }
                    >
                      <Send />
                      {sendingTest ? "Enviando teste..." : "Enviar teste"}
                    </Button>
                    {waConfig && !waConfig.configured ? (
                      <p className="text-xs text-muted-foreground">
                        Disponível depois de configurar o canal (Fase 0).
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
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
                  </>
                )}
                {testMessage ? (
                  <p className="text-xs text-muted-foreground">{testMessage}</p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden">
            {data.channel === "whatsapp" ? (
              selectedWaTemplate ? (
                <div className="mx-auto w-full max-w-md p-6">
                  <WhatsAppBubblePreview
                    headerText={
                      selectedWaTemplate.headerType === "text"
                        ? selectedWaTemplate.headerText
                        : null
                    }
                    bodyText={fillVariables(
                      selectedWaTemplate.bodyText,
                      waPreviewValues
                    )}
                    footerText={selectedWaTemplate.footerText}
                    buttons={selectedWaTemplate.buttons ?? []}
                  />
                </div>
              ) : (
                <p className="py-24 text-center text-sm text-muted-foreground">
                  Nenhum modelo selecionado.
                </p>
              )
            ) : !data.design ? (
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
                title="Preview final do e-mail"
                className="h-[560px] w-full bg-white"
              />
            )}
          </Card>
        </div>
      ) : null}
      </div>

      {/* Navegação — fixa na viewport, sempre visível independente da altura da página.
          "fixed" (não "sticky") porque o conteúdo do passo E-mail tem colunas de
          alturas diferentes (canvas x painel lateral) e o sticky ficava preso ao
          contêiner mais alto, no meio da tela em vez do rodapé real. */}
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
          {step < 4 ? (
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
              disabled={
                dispatching ||
                recipientCount === 0 ||
                (data.channel === "whatsapp" &&
                  waConfig !== null &&
                  !waConfig.configured)
              }
            >
              <Send />
              {isScheduled ? "Agendar disparo" : "Disparar"}
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
              title="Pré-visualização do e-mail"
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
              O e-mail atual desta campanha será salvo como um modelo
              reutilizável em outras campanhas.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="model-name">Nome do modelo</Label>
            <Input
              id="model-name"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="Ex.: Novidade de produto — v2"
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

      {/* Dialog: confirmar disparo */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isScheduled ? "Confirmar agendamento" : "Confirmar disparo"}
            </DialogTitle>
            <DialogDescription>
              {isScheduled
                ? `A campanha "${data.name}" será enviada para ${
                    recipientCount ?? "—"
                  } contatos em ${new Date(data.scheduledAt).toLocaleString(
                    "pt-BR"
                  )}.`
                : `${
                    data.channel === "whatsapp"
                      ? "A mensagem de WhatsApp será enviada"
                      : "O e-mail será enviado"
                  } agora para ${
                    recipientCount ?? "—"
                  } contatos. Essa ação não pode ser desfeita.`}
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
                  : "Confirmar disparo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
