"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Quem recebe a cópia de acompanhamento de toda campanha (lib/acompanhamento):
 * um botão no cabeçalho de Campanhas, com a contagem, que abre a lista.
 */
export function AcompanhamentoDialog() {
  const [emails, setEmails] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function carregar(): Promise<string[] | null> {
    try {
      const res = await fetch("/api/campaigns/acompanhamento");
      if (!res.ok) return null;
      const lista: string[] = (await res.json()).emails ?? [];
      setEmails(lista);
      return lista;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    // Só a contagem do botão; a lista que vai para a caixa é relida ao abrir.
    void carregar();
  }, []);

  // Abre com a lista ATUAL: a carga da contagem pode não ter terminado (a
  // caixa abriria vazia e salvar apagaria a lista), e outra pessoa pode tê-la
  // mudado desde que a página abriu.
  async function abrir() {
    setError("");
    setTexto("");
    setOpen(true);
    setCarregando(true);
    const lista = await carregar();
    setCarregando(false);
    if (lista) setTexto(lista.join("\n"));
    else setError("Não consegui carregar a lista. Feche e tente de novo.");
  }

  async function salvar(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/campaigns/acompanhamento", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: texto }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar a lista.");
      setEmails(json.emails);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const quantos = emails?.length ?? 0;

  return (
    <>
      <Button variant="outline" onClick={abrir}>
        <Eye />
        Acompanhamento
        {emails !== null ? (
          <Badge variant={quantos > 0 ? "info" : "secondary"}>{quantos}</Badge>
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cópia de acompanhamento</DialogTitle>
            <DialogDescription>
              Estes e-mails recebem uma cópia de toda campanha disparada —
              e-mail, WhatsApp e SMS — no momento em que ela sai. A cópia não
              entra nos relatórios nem nos custos, e quem já está entre os
              destinatários de uma campanha de e-mail não a recebe duas vezes.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={salvar} className="grid gap-4">
            {error ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
                {error}
              </p>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="acompanhamento-emails">
                E-mails (um por linha)
              </Label>
              <Textarea
                id="acompanhamento-emails"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={10}
                placeholder={
                  carregando
                    ? "Carregando a lista..."
                    : "fernando@avantejuntos.com.br\nlider@avantejuntos.com.br"
                }
                disabled={carregando}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Vale para as próximas campanhas disparadas. Testes e automações
                não geram cópia.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || carregando}>
                {saving ? "Salvando..." : "Salvar lista"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
