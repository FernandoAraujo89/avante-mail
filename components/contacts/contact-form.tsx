"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Check, Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MOTIVO_LABEL, parseBrazilianMobile } from "@/lib/sms/phone";
import { cn } from "@/lib/utils";

type ListOption = { id: string; name: string };

// Um contato tem VÁRIOS e-mails e VÁRIOS telefones, cada um com o próprio
// consentimento (lib/db/schema.ts, contact_emails/contact_phones). O
// primeiro de cada lista é o principal — o que aparece na lista de contatos.
type EmailRow = { email: string; subscribed: boolean };
type PhoneRow = {
  phone: string;
  whatsappSubscribed: boolean;
  smsSubscribed: boolean;
};

const EMAIL_VAZIO: EmailRow = { email: "", subscribed: true };
// Contato novo já entra com consentimento de WhatsApp e SMS; quem não
// autorizou é que precisa ser desmarcado. Na edição, o valor salvo manda.
const PHONE_VAZIO: PhoneRow = {
  phone: "",
  whatsappSubscribed: true,
  smsSubscribed: true,
};

export function ContactForm({ contactId }: { contactId?: string }) {
  const router = useRouter();
  const isEditing = Boolean(contactId);

  const [name, setName] = useState("");
  const [emails, setEmails] = useState<EmailRow[]>([EMAIL_VAZIO]);
  const [phones, setPhones] = useState<PhoneRow[]>([PHONE_VAZIO]);
  const [company, setCompany] = useState("");
  const [tags, setTags] = useState("");
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
        const emailsSalvos: EmailRow[] = (
          Array.isArray(json.emails) ? json.emails : []
        ).map((e: { email: string; subscribed: boolean }) => ({
          email: e.email,
          subscribed: e.subscribed !== false,
        }));
        const phonesSalvos: PhoneRow[] = (
          Array.isArray(json.phones) ? json.phones : []
        ).map(
          (p: {
            phone: string;
            whatsappSubscribed: boolean;
            smsSubscribed: boolean;
          }) => ({
            phone: p.phone,
            whatsappSubscribed: p.whatsappSubscribed === true,
            smsSubscribed: p.smsSubscribed === true,
          })
        );
        // Sem endereço salvo, uma linha vazia convida a preencher.
        setEmails(emailsSalvos.length > 0 ? emailsSalvos : [EMAIL_VAZIO]);
        setPhones(phonesSalvos.length > 0 ? phonesSalvos : [PHONE_VAZIO]);
        setCompany(json.company ?? "");
        setTags(Array.isArray(json.tags) ? json.tags.join(", ") : "");
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
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }

  function atualizarEmail(indice: number, patch: Partial<EmailRow>) {
    setEmails((atual) =>
      atual.map((row, i) => (i === indice ? { ...row, ...patch } : row))
    );
  }

  function atualizarTelefone(indice: number, patch: Partial<PhoneRow>) {
    setPhones((atual) =>
      atual.map((row, i) => (i === indice ? { ...row, ...patch } : row))
    );
  }

  /** Move a linha para o topo: o primeiro é o principal. */
  function tornarPrincipal<T>(lista: T[], indice: number): T[] {
    return [lista[indice], ...lista.filter((_, i) => i !== indice)];
  }

  function remover<T>(lista: T[], indice: number, vazio: T): T[] {
    const resto = lista.filter((_, i) => i !== indice);
    return resto.length > 0 ? resto : [vazio];
  }

  // Motivo pelo qual um número não recebe SMS, ou "" quando recebe. Só avalia
  // número com cara de completo: reclamar a cada tecla, enquanto a pessoa
  // ainda está digitando o DDD, seria só barulho.
  function motivoSemSms(phone: string): string {
    if (phone.replace(/\D/g, "").length < 10) return "";
    const checagem = parseBrazilianMobile(phone);
    return checagem.ok ? "" : MOTIVO_LABEL[checagem.motivo];
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const emailsPreenchidos = emails.filter((e) => e.email.trim());
    const phonesPreenchidos = phones.filter((p) => p.phone.trim());
    if (emailsPreenchidos.length === 0 && phonesPreenchidos.length === 0) {
      setError("Informe pelo menos um e-mail ou um telefone.");
      return;
    }
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
            company,
            tags,
            listIds,
            emails: emailsPreenchidos,
            phones: phonesPreenchidos,
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

              {/* ── E-mails ─────────────────────────────────────────── */}
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">
                  E-mails{" "}
                  <span className="font-normal text-muted-foreground">
                    (o primeiro é o principal)
                  </span>
                </legend>
                {emails.map((row, indice) => (
                  <div
                    key={indice}
                    className="grid gap-2 rounded-lg border border-border p-3 @container"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        type="email"
                        value={row.email}
                        onChange={(e) =>
                          atualizarEmail(indice, { email: e.target.value })
                        }
                        placeholder="parceiro@empresa.com.br"
                        aria-label={`E-mail ${indice + 1}`}
                      />
                      {indice > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="Tornar principal"
                          aria-label="Tornar este e-mail o principal"
                          onClick={() =>
                            setEmails((atual) => tornarPrincipal(atual, indice))
                          }
                        >
                          <ArrowUp />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="Remover"
                        aria-label="Remover este e-mail"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setEmails((atual) =>
                            remover(atual, indice, EMAIL_VAZIO)
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <label
                      className={cn(
                        "flex items-center gap-2 text-sm",
                        row.email.trim()
                          ? "cursor-pointer"
                          : "text-muted-foreground"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={row.subscribed && Boolean(row.email.trim())}
                        onChange={(e) =>
                          atualizarEmail(indice, {
                            subscribed: e.target.checked,
                          })
                        }
                        disabled={!row.email.trim()}
                        className="size-4 accent-[#1D50DC]"
                      />
                      Recebe campanhas por e-mail
                      {row.email.trim() && !row.subscribed ? (
                        <span className="text-xs text-muted-foreground">
                          (marque para reativar)
                        </span>
                      ) : null}
                    </label>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => setEmails((atual) => [...atual, EMAIL_VAZIO])}
                >
                  <Plus />
                  Adicionar e-mail
                </Button>
              </fieldset>

              {/* ── Telefones ───────────────────────────────────────── */}
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">
                  Telefones{" "}
                  <span className="font-normal text-muted-foreground">
                    (com DDD; o primeiro é o principal)
                  </span>
                </legend>
                {phones.map((row, indice) => {
                  const temNumero = Boolean(row.phone.trim());
                  const semSms = motivoSemSms(row.phone);
                  return (
                    <div
                      key={indice}
                      className="grid gap-2 rounded-lg border border-border p-3"
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          type="tel"
                          value={row.phone}
                          onChange={(e) =>
                            atualizarTelefone(indice, { phone: e.target.value })
                          }
                          placeholder="(48) 99999-9999"
                          aria-label={`Telefone ${indice + 1}`}
                        />
                        {indice > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="Tornar principal"
                            aria-label="Tornar este telefone o principal"
                            onClick={() =>
                              setPhones((atual) =>
                                tornarPrincipal(atual, indice)
                              )
                            }
                          >
                            <ArrowUp />
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="Remover"
                          aria-label="Remover este telefone"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            setPhones((atual) =>
                              remover(atual, indice, PHONE_VAZIO)
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-1">
                        <label
                          className={cn(
                            "flex items-center gap-2 text-sm",
                            temNumero
                              ? "cursor-pointer"
                              : "text-muted-foreground"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={row.whatsappSubscribed && temNumero}
                            onChange={(e) =>
                              atualizarTelefone(indice, {
                                whatsappSubscribed: e.target.checked,
                              })
                            }
                            disabled={!temNumero}
                            className="size-4 accent-[#1D50DC]"
                          />
                          Aceita WhatsApp
                        </label>
                        <label
                          className={cn(
                            "flex items-center gap-2 text-sm",
                            temNumero
                              ? "cursor-pointer"
                              : "text-muted-foreground"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={row.smsSubscribed && temNumero}
                            onChange={(e) =>
                              atualizarTelefone(indice, {
                                smsSubscribed: e.target.checked,
                              })
                            }
                            disabled={!temNumero}
                            className="size-4 accent-[#1D50DC]"
                          />
                          Aceita SMS
                        </label>
                      </div>
                      {/* SMS não chega em fixo. O aviso é aqui e não no
                          salvamento porque o custo aparece só na primeira
                          campanha: a mensagem é cobrada, a Twilio devolve
                          21614 e o número sai do canal. */}
                      {semSms ? (
                        <p className="text-xs text-amber-700 dark:text-amber-500">
                          Este número não recebe SMS ({semSms}). O WhatsApp
                          funciona normalmente.
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => setPhones((atual) => [...atual, PHONE_VAZIO])}
                >
                  <Plus />
                  Adicionar telefone
                </Button>
                <p className="text-xs text-muted-foreground">
                  A campanha vai para todos os telefones e e-mails que aceitam o
                  canal. Desmarque o que o contato não autorizou (LGPD).
                </p>
              </fieldset>

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
