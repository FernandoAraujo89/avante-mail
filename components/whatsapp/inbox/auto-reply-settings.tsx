"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, ExternalLink, LoaderCircle } from "lucide-react";

import { WhatsAppText } from "@/components/whatsapp/whatsapp-text";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { formatPhone, normalizePhone } from "@/lib/phone";
import {
  AUTO_REPLY_LIMITS,
  AUTO_REPLY_PHONE_PLACEHOLDER,
  buildAutoReply,
  formatBrazilianPhone,
  type AutoReplySettings,
} from "@/lib/whatsapp/auto-reply";
import { cn } from "@/lib/utils";

/**
 * Botão "Resposta automática" da caixa de conversas, com o estado à mostra, e
 * a janela que edita o aviso de que o número não é canal de atendimento.
 */
export function AutoReplySettingsButton() {
  const [settings, setSettings] = useState<AutoReplySettings | null>(null);
  const [draft, setDraft] = useState<AutoReplySettings | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/auto-reply", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar a resposta automática.");
      setSettings(json.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openDialog() {
    if (!settings) return;
    setError("");
    // O telefone é guardado em E.164; na tela aparece como se escreve.
    setDraft({
      ...settings,
      phone: formatBrazilianPhone(settings.phone) ?? formatPhone(settings.phone),
    });
    setOpen(true);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/whatsapp/auto-reply", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar.");
      setSettings(json.settings);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const update = (patch: Partial<AutoReplySettings>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  // Prévia com o número no formato do envio; enquanto o telefone digitado não
  // é válido, mostra o que foi digitado.
  const normalizedPhone = draft ? normalizePhone(draft.phone) : null;
  const preview = draft
    ? buildAutoReply({ ...draft, phone: normalizedPhone ?? draft.phone }, (value) =>
        normalizedPhone ? formatPhone(value) : value
      )
    : null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openDialog}
        disabled={!settings}
        title="O aviso que o contato recebe quando escreve para este número"
      >
        <Bot />
        Resposta automática
        <span
          className={cn(
            "rounded-sm px-1.5 py-0.5 text-[11px] font-semibold leading-none",
            settings?.enabled
              ? "bg-success-light text-success-dark"
              : "bg-secondary text-secondary-foreground"
          )}
        >
          {settings ? (settings.enabled ? "ligada" : "desligada") : error ? "erro" : "…"}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resposta automática</DialogTitle>
            <DialogDescription>
              O aviso que o contato recebe quando escreve para o número de
              comunicados, com um botão que abre a conversa com o atendimento.
            </DialogDescription>
          </DialogHeader>

          {draft && preview ? (
            <div className="grid gap-6 md:grid-cols-[1fr_17rem]">
              <div className="grid content-start gap-4">
                <label className="flex cursor-pointer items-start gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => update({ enabled: e.target.checked })}
                    className="mt-0.5 size-4 accent-[#1D50DC]"
                  />
                  Responder automaticamente quem escrever para este número
                </label>

                <div className="grid gap-2">
                  <Label htmlFor="auto-reply-text">Mensagem</Label>
                  <Textarea
                    id="auto-reply-text"
                    value={draft.text}
                    onChange={(e) => update({ text: e.target.value })}
                    rows={6}
                    maxLength={AUTO_REPLY_LIMITS.text}
                  />
                  <p className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
                    <span>
                      Use {AUTO_REPLY_PHONE_PLACEHOLDER} onde o número do
                      atendimento deve aparecer.
                    </span>
                    <span>
                      {draft.text.length}/{AUTO_REPLY_LIMITS.text}
                    </span>
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="auto-reply-button">Texto do botão</Label>
                    <Input
                      id="auto-reply-button"
                      value={draft.buttonText}
                      onChange={(e) => update({ buttonText: e.target.value })}
                      maxLength={AUTO_REPLY_LIMITS.buttonText}
                    />
                    <p className="text-xs text-muted-foreground">
                      Até {AUTO_REPLY_LIMITS.buttonText} caracteres (limite do
                      WhatsApp).
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="auto-reply-phone">WhatsApp do atendimento</Label>
                    <Input
                      id="auto-reply-phone"
                      value={draft.phone}
                      onChange={(e) => update({ phone: e.target.value })}
                      inputMode="tel"
                      placeholder="+55 37 99856-8320"
                    />
                    <p className="text-xs text-muted-foreground">
                      O botão abre a conversa com este número.
                    </p>
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.afterButtonTaps}
                    onChange={(e) => update({ afterButtonTaps: e.target.checked })}
                    className="mt-0.5 size-4 accent-[#1D50DC]"
                  />
                  <span>
                    Responder também quando o contato só toca num botão do
                    modelo
                    <span className="block text-xs text-muted-foreground">
                      Desligado, quem tocou “Sim, vou participar” não recebe o
                      aviso de que aqui não é atendimento.
                    </span>
                  </span>
                </label>

                <div className="rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">Quando o aviso não vai</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    <li>Mais de uma vez na mesma conversa em 24h.</li>
                    <li>
                      Na conversa em que alguém da equipe respondeu nas últimas
                      24h — o atendimento especial não é interrompido.
                    </li>
                    <li>Para quem mandou SAIR (recebe a confirmação do descadastro).</li>
                  </ul>
                </div>
              </div>

              <div className="grid content-start gap-2">
                <p className="text-sm font-medium">Prévia</p>
                <div className="rounded-xl bg-[#efeae2] p-3">
                  <div className="rounded-lg rounded-tr-none bg-[#d9fdd3] text-sm shadow-sm">
                    <p className="whitespace-pre-wrap break-words px-2.5 pb-1 pt-1.5 text-[#111b21]">
                      <WhatsAppText text={preview.body} links={false} />
                    </p>
                    <p className="border-t border-black/10 px-2.5 py-2 text-center text-sm font-medium text-[#027eb5]">
                      <ExternalLink className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
                      {preview.buttonText || "Botão"}
                    </p>
                  </div>
                </div>
                <p className="break-all text-xs text-muted-foreground">
                  O botão abre {preview.url}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-8 text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" aria-label="Carregando" />
            </div>
          )}

          {error ? (
            <p role="alert" className="text-sm text-destructive-hover">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={save} disabled={saving || !draft}>
              {saving ? <LoaderCircle className="animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
