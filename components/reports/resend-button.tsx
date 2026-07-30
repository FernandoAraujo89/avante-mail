"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Reenvia os envios que a Meta segurou por limite de frequência. Confirma
 * antes porque cada reenvio entregue é cobrado de novo.
 */
export function ResendButton({
  endpoint,
  count,
  costHint,
}: {
  endpoint: string;
  count: number;
  costHint: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function handleResend() {
    setSending(true);
    setError("");
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao reenviar.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RotateCcw />
        Reenviar aos bloqueados ({count})
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!sending) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reenviar aos bloqueados pelo limite</DialogTitle>
            <DialogDescription>
              {count === 1
                ? "1 contato não recebeu porque a Meta segurou a mensagem por limite de frequência."
                : `${count} contatos não receberam porque a Meta segurou as mensagens por limite de frequência.`}{" "}
              A mensagem será enfileirada de novo só para eles — quem já
              recebeu não é incomodado, e quem pediu para sair fica de fora.
              Cada reenvio entregue é cobrado: {costHint}.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={sending}
            >
              Cancelar
            </Button>
            <Button onClick={handleResend} disabled={sending}>
              {sending ? "Reenfileirando..." : "Reenviar agora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
