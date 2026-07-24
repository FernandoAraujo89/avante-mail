"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MailQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao solicitar.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        {sent ? (
          <div className="grid gap-4 text-center">
            <p className="text-sm">
              Se <span className="font-medium">{email}</span> estiver
              cadastrado, você receberá um e-mail com o link para redefinir a
              senha. O link vale por 1 hora.
            </p>
            <p className="text-xs text-muted-foreground">
              Não chegou? Confira a caixa de spam ou tente de novo em alguns
              minutos.
            </p>
            <Button variant="outline" asChild>
              <Link href="/login">
                <ArrowLeft />
                Voltar para o login
              </Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4">
            {error ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
                {error}
              </div>
            ) : null}

            <p className="text-sm text-muted-foreground">
              Informe o e-mail da sua conta e enviaremos um link para você
              escolher uma senha nova.
            </p>

            <div className="grid gap-2">
              <Label htmlFor="forgot-email">E-mail</Label>
              <Input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@avantejuntos.com.br"
                autoComplete="email"
                required
                autoFocus
              />
            </div>

            <Button type="submit" disabled={loading} className="mt-2">
              <MailQuestion />
              {loading ? "Enviando..." : "Enviar link de redefinição"}
            </Button>

            <Link
              href="/login"
              className="text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Voltar para o login
            </Link>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
