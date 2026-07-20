"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/page-header";
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

export function ContactForm({ contactId }: { contactId?: string }) {
  const router = useRouter();
  const isEditing = Boolean(contactId);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [segment, setSegment] = useState("");
  const [tags, setTags] = useState("");
  const [subscribed, setSubscribed] = useState(true);
  const [loading, setLoading] = useState(isEditing);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    (async () => {
      try {
        const res = await fetch(`/api/contacts/${contactId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao carregar contato.");
        setName(json.name ?? "");
        setEmail(json.email ?? "");
        setCompany(json.company ?? "");
        setSegment(json.segment ?? "");
        setTags(Array.isArray(json.tags) ? json.tags.join(", ") : "");
        setSubscribed(json.subscribed !== false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [contactId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        isEditing ? `/api/contacts/${contactId}` : "/api/contacts",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            company,
            segment: segment || null,
            tags,
            subscribed,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar contato.");
      router.push("/contacts");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={isEditing ? "Editar contato" : "Novo contato"}
        description={
          isEditing
            ? "Atualize os dados do parceiro."
            : "Cadastre um parceiro manualmente na base."
        }
      />

      <Card className="max-w-2xl">
        <CardContent className="p-6">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Carregando contato...
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="grid gap-5">
              {error ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
                  {error}
                </div>
              ) : null}

              <div className="grid gap-2">
                <Label htmlFor="name">Nome *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: João da Silva"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="email">E-mail *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="parceiro@empresa.com.br"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="company">Empresa</Label>
                <Input
                  id="company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Ex.: Mercadinho São José"
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="grid gap-2">
                  <Label>Segmento</Label>
                  <Select value={segment} onValueChange={setSegment}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="white_label">White Label</SelectItem>
                      <SelectItem value="indicador">Indicador</SelectItem>
                      <SelectItem value="revenda_fiscal">
                        Revenda Fiscal
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tags">Tags</Label>
                  <Input
                    id="tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="food, pdv, nfe"
                  />
                  <p className="text-xs text-muted-foreground">
                    Separadas por vírgula.
                  </p>
                </div>
              </div>

              {isEditing ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={subscribed}
                    onChange={(e) => setSubscribed(e.target.checked)}
                    className="size-4 accent-[#1D50DC]"
                  />
                  Inscrito — recebe campanhas
                  {!subscribed ? (
                    <span className="text-xs text-muted-foreground">
                      (marque para reativar o recebimento)
                    </span>
                  ) : null}
                </label>
              ) : null}

              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={saving}>
                  {saving
                    ? "Salvando..."
                    : isEditing
                      ? "Salvar alterações"
                      : "Salvar contato"}
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link href="/contacts">Cancelar</Link>
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </>
  );
}
