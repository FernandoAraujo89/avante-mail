"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { slugDaEtapa, type EtapaDto } from "@/components/leads/estagios";

interface Resposta {
  etapas: EtapaDto[];
  uso: Record<string, number>;
}

export default function EtapasPage() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [nova, setNova] = useState("");
  const [novaPara, setNovaPara] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch("/api/leads/etapas");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar as etapas.");
      setDados(json);
    } catch (err) {
      setDados({ etapas: [], uso: {} });
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function chamar(
    metodo: "POST" | "PATCH" | "DELETE",
    corpo: Record<string, unknown>
  ) {
    setSalvando(true);
    setErro("");
    try {
      const url =
        metodo === "DELETE"
          ? `/api/leads/etapas?id=${encodeURIComponent(String(corpo.id))}`
          : "/api/leads/etapas";
      const res = await fetch(url, {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        ...(metodo === "DELETE" ? {} : { body: JSON.stringify(corpo) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar.");
      await carregar();
      return json;
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSalvando(false);
    }
  }

  async function criar() {
    if (!nova.trim()) return;
    const posicao = (dados?.etapas.length ?? 0) * 10 + 10;
    const ok = await chamar("POST", {
      label: nova.trim(),
      position: posicao,
      stopsNurturing: novaPara,
    });
    if (ok) {
      setNova("");
      setNovaPara(false);
    }
  }

  const etapas = dados?.etapas ?? [];

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
        <Link href="/leads">
          <ArrowLeft />
          Voltar para leads
        </Link>
      </Button>

      <PageHeader
        title="Etapas do funil"
        description="Espelho do funil do Pipedrive. O agente acompanha o lead lá e avisa por webhook quando ele anda — é por estes nomes que o webhook chega."
      />

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      {/* Só as etapas que o usuário nomeou vieram semeadas. Dizer isso na tela
          evita que uma lista curta pareça a lista completa. */}
      <Card className="mb-6">
        <CardContent className="grid gap-3 py-4 text-sm">
          <p className="text-muted-foreground">
            O sistema começa só com as etapas que você citou. Cadastre aqui as
            demais do seu funil no Pipedrive — o webhook aceita tanto o nome por
            extenso (&ldquo;Passou por apresentação de produto&rdquo;) quanto o
            identificador gerado a partir dele.
          </p>
          <p className="text-muted-foreground">
            Marcar <span className="font-medium">encerra a nutrição</span> faz o
            lead sair de todos os fluxos em andamento ao chegar nessa etapa. Tudo
            mais que a etapa deva provocar — marcar tag, trocar de trilha, avisar
            alguém — se monta em Automações, com o gatilho{" "}
            <span className="font-medium">Lead andou no funil</span>.
          </p>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="grid gap-3 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="nova-etapa">Nome da etapa no Pipedrive</Label>
            <Input
              id="nova-etapa"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              placeholder="Ex.: Proposta enviada"
              onKeyDown={(e) => {
                if (e.key === "Enter") criar();
              }}
            />
            {nova.trim() ? (
              <p className="text-xs text-muted-foreground">
                Identificador: <code>{slugDaEtapa(nova)}</code>
              </p>
            ) : null}
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={novaPara}
              onChange={(e) => setNovaPara(e.target.checked)}
              className="size-4 accent-[#1D50DC]"
            />
            Encerra a nutrição
          </label>
          <Button onClick={criar} disabled={salvando || !nova.trim()}>
            <Plus />
            Adicionar
          </Button>
        </CardContent>
      </Card>

      <Card>
        {dados === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando...
          </p>
        ) : etapas.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma etapa cadastrada. Sem elas, o webhook do agente não consegue
            mover o lead no funil.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Etapa</TableHead>
                <TableHead>Identificador</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Encerra a nutrição</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {etapas.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.label}</span>
                      {!e.active ? (
                        <Badge variant="secondary">Desativada</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <code>{e.slug}</code>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {dados.uso[e.slug] ?? 0}
                  </TableCell>
                  <TableCell>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={e.stopsNurturing}
                        disabled={salvando}
                        onChange={(ev) =>
                          chamar("PATCH", {
                            id: e.id,
                            stopsNurturing: ev.target.checked,
                          })
                        }
                        className="size-4 accent-[#1D50DC]"
                      />
                      {e.stopsNurturing ? "Sim" : "Não"}
                    </label>
                  </TableCell>
                  <TableCell className="text-right">
                    {e.active ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={salvando}
                        aria-label={`Remover ${e.label}`}
                        onClick={() => chamar("DELETE", { id: e.id })}
                      >
                        <Trash2 className="text-muted-foreground" />
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={salvando}
                        onClick={() =>
                          chamar("PATCH", { id: e.id, active: true })
                        }
                      >
                        Reativar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
        Etapa com leads dentro não é apagada, só desativada: apagá-la deixaria
        esses contatos apontando para um identificador que não existe mais, e
        eles sumiriam de toda contagem do funil sem erro nenhum.
      </p>
    </>
  );
}
