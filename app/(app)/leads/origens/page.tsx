"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  KeyRound,
  Plus,
  Radio,
  Settings2,
  Trash2,
  Webhook,
} from "lucide-react";

import { OrigemDialog } from "@/components/leads/origem-dialog";
import { TokenDialog } from "@/components/leads/token-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

export interface OrigemDto {
  id: string;
  name: string;
  slug: string;
  mapping: Record<string, string> | null;
  defaults: Record<string, unknown> | null;
  active: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  entregas: number;
}

export default function OrigensPage() {
  const [origens, setOrigens] = useState<OrigemDto[] | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [erro, setErro] = useState("");

  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<OrigemDto | null>(null);

  // Token cru: existe só na memória desta tela, logo após criar ou girar.
  const [token, setToken] = useState<{ token: string; url: string } | null>(
    null
  );

  const [apagarAlvo, setApagarAlvo] = useState<OrigemDto | null>(null);
  const [girarAlvo, setGirarAlvo] = useState<OrigemDto | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch("/api/leads/origens");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar as origens.");
      setOrigens(json.origens);
      setBaseUrl(json.baseUrl ?? "");
    } catch (err) {
      setOrigens([]);
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function apagar() {
    if (!apagarAlvo) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/leads/origens/${apagarAlvo.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao remover a origem.");
      setApagarAlvo(null);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setApagarAlvo(null);
    } finally {
      setOcupado(false);
    }
  }

  async function girarToken() {
    if (!girarAlvo) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/leads/origens/${girarAlvo.id}/token`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao gerar o token.");
      setGirarAlvo(null);
      setToken({ token: json.token, url: json.url });
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setGirarAlvo(null);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/leads">
            <ArrowLeft />
            Voltar para leads
          </Link>
        </Button>
        <PageHeader
          title="Origens de leads"
          description="Cada origem é uma URL e um token próprios — para revogar uma sem derrubar as outras e saber de onde cada lead veio."
        >
          <Button
            onClick={() => {
              setEditando(null);
              setFormAberto(true);
            }}
          >
            <Plus />
            Nova origem
          </Button>
        </PageHeader>
      </div>

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      <Card>
        {origens === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando origens...
          </p>
        ) : origens.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Webhook className="size-8 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              Nenhuma origem ainda. Crie uma para receber leads do Make, de um
              formulário do site, do Typeform, do n8n — qualquer serviço que
              saiba fazer um POST.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setEditando(null);
                setFormAberto(true);
              }}
            >
              <Plus />
              Nova origem
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Origem</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Recebeu</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {origens.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <span className="font-medium">{o.name}</span>
                    <p className="mt-0.5 break-all text-xs text-muted-foreground">
                      {baseUrl}/api/webhooks/entrada/{o.slug}
                    </p>
                  </TableCell>
                  <TableCell>
                    {o.active ? (
                      <Badge variant="success">Ativa</Badge>
                    ) : (
                      <Badge variant="secondary">Desligada</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="flex items-center gap-1.5 text-sm">
                      <Radio className="size-3.5" />
                      {o.entregas} entrega{o.entregas === 1 ? "" : "s"}
                    </span>
                    <p className="mt-0.5 text-xs">
                      {o.lastSeenAt
                        ? `último: ${formatDateTime(o.lastSeenAt)}`
                        : "nunca chamada"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditando(o);
                          setFormAberto(true);
                        }}
                        aria-label={`Configurar ${o.name}`}
                      >
                        <Settings2 className="text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setGirarAlvo(o)}
                        aria-label={`Gerar novo token de ${o.name}`}
                      >
                        <KeyRound className="text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setApagarAlvo(o)}
                        aria-label={`Remover ${o.name}`}
                      >
                        <Trash2 className="text-muted-foreground" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <OrigemDialog
        aberto={formAberto}
        origem={editando}
        baseUrl={baseUrl}
        onFechar={() => setFormAberto(false)}
        onSalvo={async (novoToken) => {
          setFormAberto(false);
          if (novoToken) setToken(novoToken);
          await carregar();
        }}
      />

      <TokenDialog dados={token} onFechar={() => setToken(null)} />

      <Dialog
        open={girarAlvo !== null}
        onOpenChange={(a) => {
          if (!a) setGirarAlvo(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar novo token</DialogTitle>
            <DialogDescription>
              O token atual de{" "}
              <span className="font-medium text-foreground">
                {girarAlvo?.name}
              </span>{" "}
              para de valer na hora. Quem chama esta URL vai receber 401 até o
              token novo ser colado do outro lado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGirarAlvo(null)}
              disabled={ocupado}
            >
              Cancelar
            </Button>
            <Button onClick={girarToken} disabled={ocupado}>
              {ocupado ? "Gerando..." : "Gerar novo token"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={apagarAlvo !== null}
        onOpenChange={(a) => {
          if (!a) setApagarAlvo(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover origem</DialogTitle>
            <DialogDescription>
              Remover{" "}
              <span className="font-medium text-foreground">
                {apagarAlvo?.name}
              </span>{" "}
              apaga a URL e o histórico de entregas dela. Os leads que já
              entraram por aqui continuam na base.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApagarAlvo(null)}
              disabled={ocupado}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={apagar} disabled={ocupado}>
              {ocupado ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
