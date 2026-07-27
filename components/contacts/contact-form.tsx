"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ListOption = { id: string; name: string };

export function ContactForm({ contactId }: { contactId?: string }) {
  const router = useRouter();
  const isEditing = Boolean(contactId);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [tags, setTags] = useState("");
  const [subscribed, setSubscribed] = useState(true);
  const [whatsappSubscribed, setWhatsappSubscribed] = useState(false);
  const [availableLists, setAvailableLists] = useState<ListOption[]>([]);
  const [listIds, setListIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(isEditing);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Listas disponíveis para associar.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/lists");
        if (res.ok) setAvailableLists(await res.json());
      } catch {
        // silencioso: sem listas, o contato é criado sem associação
      }
    })();
  }, []);

  useEffect(() => {
    if (!contactId) return;
    (async () => {
      try {
        const res = await fetch(`/api/contacts/${contactId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao carregar contato.");
        setName(json.name ?? "");
        setEmail(json.email ?? "");
        setPhone(json.phone ?? "");
        setCompany(json.company ?? "");
        setTags(Array.isArray(json.tags) ? json.tags.join(", ") : "");
        setSubscribed(json.subscribed !== false);
        setWhatsappSubscribed(json.whatsappSubscribed === true);
        setListIds(Array.isArray(json.listIds) ? json.listIds : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [contactId]);

  function toggleList(id: string) {
    setListIds((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id]
    );
  }

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
            phone,
            company,
            tags,
            subscribed,
            whatsappSubscribed,
            listIds,
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
                <Label htmlFor="phone">Telefone (WhatsApp)</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(48) 99999-9999"
                />
                <p className="text-xs text-muted-foreground">
                  Com DDD. Usado nas campanhas de WhatsApp.
                </p>
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

              <div className="grid gap-2.5">
                <Label>Listas</Label>
                {availableLists.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma lista criada ainda.{" "}
                    <Link
                      href="/lists"
                      className="text-primary hover:underline"
                    >
                      Criar lista
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableLists.map((list) => {
                      const active = listIds.includes(list.id);
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

              {isEditing ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={subscribed}
                    onChange={(e) => setSubscribed(e.target.checked)}
                    className="size-4 accent-[#1D50DC]"
                  />
                  Inscrito — recebe campanhas por e-mail
                  {!subscribed ? (
                    <span className="text-xs text-muted-foreground">
                      (marque para reativar o recebimento)
                    </span>
                  ) : null}
                </label>
              ) : null}

              <label
                className={
                  phone.trim()
                    ? "flex cursor-pointer items-center gap-2 text-sm"
                    : "flex items-center gap-2 text-sm text-muted-foreground"
                }
              >
                <input
                  type="checkbox"
                  checked={whatsappSubscribed && Boolean(phone.trim())}
                  onChange={(e) => setWhatsappSubscribed(e.target.checked)}
                  disabled={!phone.trim()}
                  className="size-4 accent-[#1D50DC]"
                />
                Aceita campanhas por WhatsApp
                <span className="text-xs text-muted-foreground">
                  {phone.trim()
                    ? "(marque só com consentimento do contato — LGPD)"
                    : "(informe o telefone para habilitar)"}
                </span>
              </label>

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
