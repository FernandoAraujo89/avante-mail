"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao redefinir a senha.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <Card>
        <CardContent className="grid gap-4 p-6 text-center">
          <p className="text-sm">
            Link de redefinição inválido. Solicite um novo pelo
            &quot;Esqueci minha senha&quot;.
          </p>
          <Button variant="outline" asChild>
            <Link href="/forgot-password">Solicitar novo link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        {done ? (
          <div className="grid gap-4 text-center">
            <p className="text-sm font-medium">Senha redefinida com sucesso.</p>
            <Button asChild>
              <Link href="/login">
                <LogIn />
                Entrar com a senha nova
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

            <div className="grid gap-2">
              <Label htmlFor="reset-password">Senha nova</Label>
              <Input
                id="reset-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                required
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="reset-confirm">Confirmar senha nova</Label>
              <Input
                id="reset-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repita a senha"
                autoComplete="new-password"
                required
              />
            </div>

            <Button type="submit" disabled={loading} className="mt-2">
              <KeyRound />
              {loading ? "Salvando..." : "Redefinir senha"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
