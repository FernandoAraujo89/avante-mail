"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableActionsCell,
  TableActionsHead,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { slugDaEtapa, type EtapaDto } from "@/components/leads/estagios";

interface Resposta {
  etapas: EtapaDto[];
  uso: Record<string, number>;
}

interface ListaOpcao {
  id: string;
  name: string;
  kind: string | null;
}

/** O que o diálogo de edição mexe — apelidos como texto, um por linha. */
interface Edicao {
  id: string;
  label: string;
  aliases: string;
  convertListId: string;
}

export default function EtapasPage() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [listas, setListas] = useState<ListaOpcao[]>([]);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [nova, setNova] = useState("");
  const [novaPara, setNovaPara] = useState(false);

  const [edicao, setEdicao] = useState<Edicao | null>(null);

  // Confirmação de remoção + aviso do que de fato aconteceu (apagada ×
  // desativada — a regra fica no rodapé, mas o resultado precisa ser dito).
  const [removerAlvo, setRemoverAlvo] = useState<EtapaDto | null>(null);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const [res, listasRes] = await Promise.all([
        fetch("/api/leads/etapas"),
        fetch("/api/lists").then((r) => r.json()),
      ]);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar as etapas.");
      setDados(json);
      // Destinos possíveis da conversão automática — lista de leads fica fora.
      setListas(
        Array.isArray(listasRes)
          ? listasRes.filter((l: ListaOpcao) => l.kind !== "leads")
          : []
      );
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
    setAviso("");
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

  function abrirEdicao(e: EtapaDto) {
    setEdicao({
      id: e.id,
      label: e.label,
      aliases: (e.aliases ?? []).join("\n"),
      convertListId: e.convertListId ?? "nao",
    });
  }

  async function salvarEdicao() {
    if (!edicao) return;
    const ok = await chamar("PATCH", {
      id: edicao.id,
      label: edicao.label,
      aliases: edicao.aliases
        .split("\n")
        .map((a) => a.trim())
        .filter(Boolean),
      convertListId: edicao.convertListId === "nao" ? null : edicao.convertListId,
    });
    if (ok) setEdicao(null);
  }

  async function confirmarRemocao() {
    if (!removerAlvo) return;
    const alvo = removerAlvo;
    const emUso = dados?.uso[alvo.slug] ?? 0;
    const ok = await chamar("DELETE", { id: alvo.id });
    if (ok) {
      setAviso(
        emUso > 0
          ? `"${alvo.label}" tinha ${emUso} lead${emUso === 1 ? "" : "s"} e foi desativada em vez de apagada — os leads continuam contados no funil.`
          : `Etapa "${alvo.label}" removida.`
      );
    }
    setRemoverAlvo(null);
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

      {aviso ? (
        <div className="mb-4 rounded-lg border border-success-dark/30 bg-success-light/20 px-4 py-3 text-sm text-success-dark">
          {aviso}
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
          <p className="text-muted-foreground">
            O funil do Pipedrive é mais detalhado que os marcos daqui. No lápis
            de cada etapa, os <span className="font-medium">apelidos</span>{" "}
            dizem quais etapas de lá caem neste marco — é assim que a
            sincronização traduz &ldquo;Analisando proposta&rdquo; para
            &ldquo;Passou por apresentação de produto&rdquo;. Lá também se liga
            a <span className="font-medium">conversão automática</span>: ao
            chegar na etapa, o lead vira parceiro na lista escolhida e passa a
            receber as campanhas de parceiro.
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
                <TableActionsHead>Ações</TableActionsHead>
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
                    {(e.aliases ?? []).length > 0 ? (
                      <p
                        className="mt-0.5 max-w-72 truncate text-xs text-muted-foreground"
                        title={(e.aliases ?? []).join(" · ")}
                      >
                        No Pipedrive: {(e.aliases ?? []).join(" · ")}
                      </p>
                    ) : null}
                    {e.convertListId ? (
                      <p className="mt-0.5 text-xs text-success-dark">
                        Ao chegar, vira parceiro em &ldquo;
                        {listas.find((l) => l.id === e.convertListId)?.name ??
                          "lista removida"}
                        &rdquo;
                      </p>
                    ) : null}
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
                  <TableActionsCell className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={salvando}
                        aria-label={`Editar ${e.label}`}
                        title={`Editar ${e.label}`}
                        onClick={() => abrirEdicao(e)}
                      >
                        <Pencil className="text-muted-foreground" />
                      </Button>
                      {e.active ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={salvando}
                          aria-label={`Remover ${e.label}`}
                          title={`Remover ${e.label}`}
                          onClick={() => setRemoverAlvo(e)}
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
                    </span>
                  </TableActionsCell>
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

      <Dialog
        open={edicao !== null}
        onOpenChange={(open) => {
          if (!open && !salvando) setEdicao(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar etapa</DialogTitle>
            <DialogDescription>
              O identificador não muda — é ele que o webhook resolve e que os
              leads já carregam.
            </DialogDescription>
          </DialogHeader>
          {edicao ? (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="ed-label">Nome</Label>
                <Input
                  id="ed-label"
                  value={edicao.label}
                  onChange={(e) =>
                    setEdicao({ ...edicao, label: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ed-aliases">
                  Etapas do Pipedrive que caem neste marco
                </Label>
                <Textarea
                  id="ed-aliases"
                  rows={4}
                  value={edicao.aliases}
                  onChange={(e) =>
                    setEdicao({ ...edicao, aliases: e.target.value })
                  }
                  placeholder={"Uma por linha. Ex.:\nApresentar parte técnica\nAnalisando proposta"}
                />
                <p className="text-xs text-muted-foreground">
                  A sincronização e o webhook aceitam qualquer um destes nomes
                  como se fosse a própria etapa.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label>Ao chegar nesta etapa</Label>
                <Select
                  value={edicao.convertListId}
                  onValueChange={(v) =>
                    setEdicao({ ...edicao, convertListId: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nao">
                      Continuar como lead (conversão manual)
                    </SelectItem>
                    {listas.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        Converter em parceiro: {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Convertido, o lead sai do funil e passa a receber as campanhas
                  da lista escolhida. O consentimento de e-mail não muda.
                </p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEdicao(null)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button onClick={salvarEdicao} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removerAlvo !== null}
        onOpenChange={(open) => {
          if (!open && !salvando) setRemoverAlvo(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover etapa</DialogTitle>
            <DialogDescription>
              {removerAlvo
                ? (dados?.uso[removerAlvo.slug] ?? 0) > 0
                  ? `"${removerAlvo.label}" tem ${dados?.uso[removerAlvo.slug]} lead${(dados?.uso[removerAlvo.slug] ?? 0) === 1 ? "" : "s"} dentro, então será apenas desativada — os leads continuam contados no funil e a etapa pode ser reativada depois.`
                  : `Remover a etapa "${removerAlvo.label}"? O webhook do agente deixa de reconhecer este nome.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoverAlvo(null)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmarRemocao}
              disabled={salvando}
            >
              {salvando
                ? "Removendo..."
                : (dados?.uso[removerAlvo?.slug ?? ""] ?? 0) > 0
                  ? "Desativar etapa"
                  : "Remover etapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
