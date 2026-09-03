"use client";

import { useState } from "react";
import { Send } from "lucide-react";

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
import type { EmailDesign } from "@/lib/email-builder/types";

const MAX_EMAILS = 5;

/**
 * Envia o template para caixas de teste sem criar campanha.
 *
 * O que vai é o que está na TELA (design ou código), não o que está salvo:
 * conferir a aparência é parte de criar e de editar, e não algo que só se pode
 * fazer depois de salvar.
 */
export function TestSendButton({
  design,
  mjmlContent,
  name,
  variant = "outline",
  size,
}: {
  design?: EmailDesign | null;
  mjmlContent?: string;
  name: string;
  variant?: "outline" | "secondary" | "ghost";
  size?: "sm";
}) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const parsed = [
    ...new Set(
      emails
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean)
    ),
  ];

  async function handleSend() {
    setMessage("");
    setFailed(false);

    if (parsed.length === 0) {
      setFailed(true);
      setMessage("Informe ao menos um e-mail de teste.");
      return;
    }
    if (parsed.length > MAX_EMAILS) {
      setFailed(true);
      setMessage(`Máximo de ${MAX_EMAILS} e-mails de teste.`);
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/templates/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails: parsed,
          name,
          ...(design ? { design } : { mjmlContent }),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao enviar o teste.");
      const naoForam: string[] = Array.isArray(json.failed) ? json.failed : [];
      setFailed(naoForam.length > 0);
      setMessage(
        naoForam.length > 0
          ? `Enviado para ${json.sent}. Falhou: ${naoForam.join(", ")}`
          : `E-mail de teste enviado para ${json.recipients.join(", ")}. Confira a caixa de entrada.`
      );
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Send />
        Enviar teste
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar e-mail de teste</DialogTitle>
            <DialogDescription>
              Manda este template, como ele está agora, para conferir a
              aparência na caixa de entrada. Não cria campanha nem registra
              envio.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="template-test-emails">
              E-mails (até {MAX_EMAILS}, separados por vírgula)
            </Label>
            <Input
              id="template-test-emails"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="voce@empresa.com.br, colega@empresa.com.br"
            />
            <p className="text-xs text-muted-foreground">
              As variáveis ({"{{nome_parceiro}}"} e afins) chegam preenchidas
              com dados de exemplo.
            </p>
          </div>

          {message ? (
            <div
              className={
                failed
                  ? "rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive-hover"
                  : "rounded-lg border border-success-dark/30 bg-success-light/20 px-4 py-2.5 text-sm text-success-dark"
              }
            >
              {message}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button onClick={handleSend} disabled={sending}>
              <Send />
              {sending ? "Enviando..." : "Enviar teste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
