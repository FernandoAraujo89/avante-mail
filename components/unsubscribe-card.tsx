"use client";

import { useState } from "react";
import { CheckCircle2, MailX } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Status = "idle" | "loading" | "success" | "error";

export function UnsubscribeCard({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>(token ? "idle" : "error");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(
    token ? "" : "Link de descadastro inválido: token ausente."
  );

  async function handleUnsubscribe() {
    setStatus("loading");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao processar o descadastro.");
      setEmail(json.email ?? "");
      setStatus("success");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-success-light/40">
            <CheckCircle2 className="size-6 text-success-dark" />
          </div>
          <CardTitle>Descadastro confirmado</CardTitle>
          <CardDescription>
            {email ? (
              <>
                O e-mail <span className="text-foreground">{email}</span> não
                receberá mais nossas campanhas.
              </>
            ) : (
              "Você não receberá mais nossas campanhas."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-center text-sm text-muted-foreground">
            Mudou de ideia? É só falar com o time da Avante para voltar a
            receber as novidades.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-secondary">
          <MailX className="size-6 text-muted-foreground" />
        </div>
        <CardTitle>Descadastro de e-mails</CardTitle>
        <CardDescription>
          Ao confirmar, você deixará de receber as novidades, comunicados e
          campanhas da Avante neste e-mail.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        {status === "error" ? (
          <p className="w-full rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive-hover">
            {message}
          </p>
        ) : null}
        <Button
          onClick={handleUnsubscribe}
          disabled={!token || status === "loading"}
          className="w-full"
        >
          {status === "loading" ? "Processando..." : "Confirmar descadastro"}
        </Button>
      </CardContent>
    </Card>
  );
}
