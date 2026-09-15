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
import { slugDaEtapa } from "@/components/leads/estagios";
import {
  varianteDaQualificacao,
  VARIANTES_DE_QUALIFICACAO,
  type QualificacaoDto,
} from "@/components/leads/qualificacoes";

interface Resposta {
  qualificacoes: QualificacaoDto[];
  uso: Record<string, number>;
  pontos: Record<string, number>;
}

/** O que o diálogo de detalhes edita — tudo texto, do jeito que o form fala. */
interface Detalhes {
  id: string;
  label: string;
  variant: string;
  potential: string;
  quemSao: string;
  perfil: string;
  motivacoes: string;
  dores: string;
}

export default function QualificacoesPage() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [nova, setNova] = useState("");
  const [novosPontos, setNovosPontos] = useState("");

  // Rascunho dos pontos por linha: o valor digitado só vai ao servidor no
  // Enter/blur — cada tecla disparando um recálculo geral seria um desastre.
  const [pontosDraft, setPontosDraft] = useState<Record<string, string>>({});

  const [detalhes, setDetalhes] = useState<Detalhes | null>(null);
  const [removerAlvo, setRemoverAlvo] = useState<QualificacaoDto | null>(null);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch("/api/leads/qualificacoes");
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Erro ao carregar as qualificações.");
      }
      setDados(json);
      setPontosDraft({});
    } catch (err) {
      setDados({ qualificacoes: [], uso: {}, pontos: {} });
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
          ? `/api/leads/qualificacoes?id=${encodeURIComponent(String(corpo.id))}`
          : "/api/leads/qualificacoes";
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
    const posicao = (dados?.qualificacoes.length ?? 0) * 10 + 10;
    const ok = await chamar("POST", {
      label: nova.trim(),
      position: posicao,
      ...(novosPontos.trim() !== "" ? { pontos: Number(novosPontos) } : {}),
    });
    if (ok) {
      setNova("");
      setNovosPontos("");
    }
  }

  async function salvarPontos(q: QualificacaoDto) {
    const texto = pontosDraft[q.id];
    if (texto === undefined) return;
    const atual = dados?.pontos[q.slug];
    if (texto.trim() === "" || Number(texto) === atual) return;
    if (!Number.isFinite(Number(texto))) return;
    const ok = await chamar("PATCH", { id: q.id, pontos: Number(texto) });
    if (ok && typeof ok.recalculados === "number") {
      setAviso(
        `Pontos de "${q.label}" salvos — a pontuação de ${ok.recalculados} lead${ok.recalculados === 1 ? "" : "s"} foi recalculada.`
      );
    }
  }

  async function salvarDetalhes() {
    if (!detalhes) return;
    const ok = await chamar("PATCH", { ...detalhes });
    if (ok) setDetalhes(null);
  }

  async function confirmarRemocao() {
    if (!removerAlvo) return;
    const alvo = removerAlvo;
    const emUso = dados?.uso[alvo.slug] ?? 0;
    const ok = await chamar("DELETE", { id: alvo.id });
    if (ok) {
      setAviso(
        emUso > 0
          ? `"${alvo.label}" tinha ${emUso} lead${emUso === 1 ? "" : "s"} e foi desativada em vez de apagada — os leads continuam com a qualificação na ficha.`
          : `Qualificação "${alvo.label}" removida.`
      );
    }
    setRemoverAlvo(null);
  }

  function abrirDetalhes(q: QualificacaoDto) {
    setDetalhes({
      id: q.id,
      label: q.label,
      variant: varianteDaQualificacao(q),
      potential: q.potential ?? "",
      quemSao: q.quemSao ?? "",
      perfil: q.perfil ?? "",
      motivacoes: q.motivacoes ?? "",
      dores: q.dores ?? "",
    });
  }

  const qualificacoes = dados?.qualificacoes ?? [];

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
        <Link href="/leads">
          <ArrowLeft />
          Voltar para leads
        </Link>
      </Button>

      <PageHeader
        title="Qualificações"
        description="Espelho do campo &ldquo;Lead qualificado&rdquo; do Pipedrive. O vendedor (SDR) qualifica o lead lá; a sincronização traz por estes nomes."
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

      <Card className="mb-6">
        <CardContent className="grid gap-3 py-4 text-sm">
          <p className="text-muted-foreground">
            Mantenha esta lista igual às opções do campo no Pipedrive: o webhook
            aceita tanto o nome por extenso (&ldquo;Promissor: Alto
            potencial&rdquo;) quanto o identificador gerado a partir dele — mas
            uma opção que só existe lá é recusada aqui, e o lead fica sem
            qualificação.
          </p>
          <p className="text-muted-foreground">
            Os <span className="font-medium">pontos</span> entram no Lead Score
            no momento em que o vendedor qualifica: quem chega mais maduro
            começa mais quente. Vale só a qualificação atual — requalificado,
            o lead troca os pontos da antiga pelos da nova. São as mesmas
            regras da tela de{" "}
            <Link href="/leads/pontuacao" className="underline">
              Pontuação
            </Link>
            , editadas daqui por conveniência — mudar um peso recalcula a base
            inteira na hora.
          </p>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="grid gap-3 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="nova-qualificacao">
              Nome da opção no Pipedrive
            </Label>
            <Input
              id="nova-qualificacao"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              placeholder="Ex.: Promissor: Baixo potencial"
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
          <div className="grid gap-1.5">
            <Label htmlFor="novos-pontos">Pontos</Label>
            <Input
              id="novos-pontos"
              type="number"
              inputMode="numeric"
              className="w-full sm:w-24"
              value={novosPontos}
              onChange={(e) => setNovosPontos(e.target.value)}
              placeholder="0"
              onKeyDown={(e) => {
                if (e.key === "Enter") criar();
              }}
            />
          </div>
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
        ) : qualificacoes.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma qualificação cadastrada. Sem elas, nem a sincronização nem
            o webhook conseguem qualificar o lead.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Qualificação</TableHead>
                <TableHead>Identificador</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Pontos</TableHead>
                <TableActionsHead>Ações</TableActionsHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {qualificacoes.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant={varianteDaQualificacao(q)}>
                        {q.label}
                      </Badge>
                      {q.potential ? (
                        <span className="text-xs text-muted-foreground">
                          potencial {q.potential.toLowerCase()}
                        </span>
                      ) : null}
                      {!q.active ? (
                        <Badge variant="secondary">Desativada</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <code>{q.slug}</code>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {dados.uso[q.slug] ?? 0}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      inputMode="numeric"
                      className="w-20"
                      aria-label={`Pontos de ${q.label}`}
                      disabled={salvando}
                      value={pontosDraft[q.id] ?? dados.pontos[q.slug] ?? ""}
                      placeholder="0"
                      onChange={(e) =>
                        setPontosDraft((d) => ({
                          ...d,
                          [q.id]: e.target.value,
                        }))
                      }
                      onBlur={() => salvarPontos(q)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                  </TableCell>
                  <TableActionsCell className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={salvando}
                        aria-label={`Editar ${q.label}`}
                        title={`Editar ${q.label}`}
                        onClick={() => abrirDetalhes(q)}
                      >
                        <Pencil className="text-muted-foreground" />
                      </Button>
                      {q.active ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={salvando}
                          aria-label={`Remover ${q.label}`}
                          title={`Remover ${q.label}`}
                          onClick={() => setRemoverAlvo(q)}
                        >
                          <Trash2 className="text-muted-foreground" />
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={salvando}
                          onClick={() =>
                            chamar("PATCH", { id: q.id, active: true })
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
        Qualificação com leads dentro não é apagada, só desativada: apagá-la
        deixaria esses contatos apontando para um identificador que não existe
        mais, e eles virariam &ldquo;sem qualificação&rdquo; sem erro nenhum.
      </p>

      <Dialog
        open={detalhes !== null}
        onOpenChange={(open) => {
          if (!open && !salvando) setDetalhes(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar qualificação</DialogTitle>
            <DialogDescription>
              O identificador não muda — é ele que o webhook resolve e que os
              leads já carregam. O texto do playbook aparece na ficha do lead,
              para quem escreve a nutrição saber o que o rótulo quer dizer.
            </DialogDescription>
          </DialogHeader>
          {detalhes ? (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="det-label">Nome (como no Pipedrive)</Label>
                <Input
                  id="det-label"
                  value={detalhes.label}
                  onChange={(e) =>
                    setDetalhes({ ...detalhes, label: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Cor da etiqueta</Label>
                  <Select
                    value={detalhes.variant}
                    onValueChange={(v) =>
                      setDetalhes({ ...detalhes, variant: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VARIANTES_DE_QUALIFICACAO.map((v) => (
                        <SelectItem key={v.valor} value={v.valor}>
                          {v.rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="det-potencial">Potencial</Label>
                  <Input
                    id="det-potencial"
                    value={detalhes.potential}
                    onChange={(e) =>
                      setDetalhes({ ...detalhes, potential: e.target.value })
                    }
                    placeholder="Ex.: Alto, Médio a alto"
                  />
                </div>
              </div>
              {(
                [
                  ["quemSao", "Quem são"],
                  ["perfil", "Perfil"],
                  ["motivacoes", "Motivações"],
                  ["dores", "Dores"],
                ] as const
              ).map(([campo, rotulo]) => (
                <div key={campo} className="grid gap-1.5">
                  <Label htmlFor={`det-${campo}`}>{rotulo}</Label>
                  <Textarea
                    id={`det-${campo}`}
                    rows={3}
                    value={detalhes[campo]}
                    onChange={(e) =>
                      setDetalhes({ ...detalhes, [campo]: e.target.value })
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDetalhes(null)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button onClick={salvarDetalhes} disabled={salvando}>
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
            <DialogTitle>Remover qualificação</DialogTitle>
            <DialogDescription>
              {removerAlvo
                ? (dados?.uso[removerAlvo.slug] ?? 0) > 0
                  ? `"${removerAlvo.label}" tem ${dados?.uso[removerAlvo.slug]} lead${(dados?.uso[removerAlvo.slug] ?? 0) === 1 ? "" : "s"} dentro, então será apenas desativada — os leads continuam com ela na ficha e a qualificação pode ser reativada depois.`
                  : `Remover a qualificação "${removerAlvo.label}"? A sincronização e o webhook deixam de reconhecer este nome, e a regra de pontos dela é removida junto.`
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
                  ? "Desativar qualificação"
                  : "Remover qualificação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
