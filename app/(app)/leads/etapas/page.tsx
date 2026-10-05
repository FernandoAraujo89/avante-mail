"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Paginacao, usePaginacao } from "@/components/paginacao";
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
import { formatDateTime } from "@/lib/format";

interface Resposta {
  etapas: EtapaDto[];
  uso: Record<string, number>;
  /** Pontos da regra de cada etapa, por slug. Sem chave = etapa sem regra. */
  pontos: Record<string, number>;
  sincronizacao: {
    ligada: boolean;
    funis: { id: number; nome: string }[];
    ausentes: string[];
    quando: string | null;
  };
}

const SEM_DADOS: Resposta = {
  etapas: [],
  uso: {},
  pontos: {},
  sincronizacao: { ligada: false, funis: [], ausentes: [], quando: null },
};

interface ListaOpcao {
  id: string;
  name: string;
  kind: string | null;
}

/**
 * Onde a etapa nova entra no funil: logo antes da etapa final (a que encerra a
 * nutrição ou converte), e não depois dela. A tela não reordena, e o funil do
 * relatório conta pela posição — uma etapa depois de "Comprou" viraria um
 * degrau depois da compra.
 */
function posicaoDaNova(etapas: EtapaDto[]): number {
  const finais = etapas.filter(
    (e) => e.active && (e.stopsNurturing || e.convertListId)
  );
  const fim = finais.length > 0 ? Math.min(...finais.map((e) => e.position)) : null;
  const antes = etapas.filter((e) => fim === null || e.position < fim);
  const ultima = antes.length > 0 ? Math.max(...antes.map((e) => e.position)) : 0;
  return fim === null ? ultima + 10 : ultima + 1;
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
  const [novosPontos, setNovosPontos] = useState("");

  // Rascunho dos pontos por linha: o valor digitado só vai ao servidor no
  // Enter/blur — cada tecla disparando um recálculo geral seria um desastre.
  const [pontosDraft, setPontosDraft] = useState<Record<string, string>>({});

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
      setPontosDraft({});
      // Destinos possíveis da conversão automática — lista de leads fica fora.
      setListas(
        Array.isArray(listasRes)
          ? listasRes.filter((l: ListaOpcao) => l.kind !== "leads")
          : []
      );
    } catch (err) {
      setDados(SEM_DADOS);
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
    const ok = await chamar("POST", {
      label: nova.trim(),
      position: posicaoDaNova(dados?.etapas ?? []),
      stopsNurturing: novaPara,
      ...(novosPontos.trim() !== "" ? { pontos: Number(novosPontos) } : {}),
    });
    if (ok) {
      setNova("");
      setNovaPara(false);
      setNovosPontos("");
    }
  }

  async function salvarPontos(e: EtapaDto) {
    const texto = pontosDraft[e.id];
    if (texto === undefined) return;
    if (texto.trim() === "" || Number(texto) === dados?.pontos[e.slug]) return;
    if (!Number.isFinite(Number(texto))) return;
    const ok = await chamar("PATCH", { id: e.id, pontos: Number(texto) });
    if (ok && typeof ok.recalculados === "number") {
      setAviso(
        `Pontos de "${e.label}" salvos — a pontuação de ${ok.recalculados} lead${ok.recalculados === 1 ? "" : "s"} foi recalculada.`
      );
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
  const { itensDaPagina, ancora, paginacao } = usePaginacao(etapas, {
    chave: "etapas",
  });

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
        description="Espelho dos funis do Pipedrive, etapa por etapa. O comercial move o deal lá; a sincronização (e o webhook) trazem a mudança por estes nomes."
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
          <SincronizacaoDosFunis
            sincronizacao={dados?.sincronizacao ?? null}
          />
          <p className="text-muted-foreground">
            Mantenha esta lista igual às etapas do Pipedrive: uma etapa que só
            existe lá é recusada pela sincronização, e o lead fica parado na
            anterior. Se a mesma etapa tem outro nome em outro funil — ou foi
            renomeada lá —, cadastre o nome no lápis, como{" "}
            <span className="font-medium">apelido</span>. Comprou e Perdido são
            a exceção: vêm do status do negócio (ganho ou perdido), não de uma
            coluna de lá.
          </p>
          <p className="text-muted-foreground">
            Os <span className="font-medium">pontos</span> entram no Lead Score
            e valem só para a etapa em que o lead está agora: quem avança troca
            os pontos da etapa anterior pelos da nova, e quem volta perde a
            diferença. Com o tempo eles perdem valor, como toda ação — lead
            parado numa etapa esfria. São as mesmas regras da tela de{" "}
            <Link href="/leads/pontuacao" className="underline">
              Pontuação
            </Link>
            , editadas daqui por conveniência.
          </p>
          <p className="text-muted-foreground">
            Marcar <span className="font-medium">encerra a nutrição</span> faz o
            lead sair de todos os fluxos em andamento ao chegar nessa etapa. Tudo
            mais que a etapa deva provocar — marcar tag, trocar de trilha, avisar
            alguém — se monta em Automações, com o gatilho{" "}
            <span className="font-medium">Lead andou no funil</span>. No lápis
            também se liga a{" "}
            <span className="font-medium">conversão automática</span>: ao chegar
            na etapa, o lead vira parceiro na lista escolhida.
          </p>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="grid gap-3 py-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
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

      <Card ref={ancora}>
        {dados === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando...
          </p>
        ) : etapas.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma etapa cadastrada. Sem elas, nem a sincronização nem o
            webhook conseguem mover o lead no funil.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Etapa</TableHead>
                {/* Com a coluna de pontos, a tabela deixava de caber ao lado
                    do menu em notebook: abaixo de xl o identificador desce
                    para baixo do nome, e as colunas de ação continuam à vista. */}
                <TableHead className="hidden xl:table-cell">
                  Identificador
                </TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Pontos</TableHead>
                <TableHead>Encerra a nutrição</TableHead>
                <TableActionsHead>Ações</TableActionsHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itensDaPagina.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    {/* No celular a coluna de ações fica fixa por cima da
                        tabela: sem o teto, o nome longo ("Agendar apresentação
                        parte técnica") correria por baixo dela, cortado. */}
                    <div className="max-w-44 sm:max-w-none">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{e.label}</span>
                        {!e.active ? (
                          <Badge variant="secondary">Desativada</Badge>
                        ) : null}
                      </span>
                      <p className="mt-0.5 break-words text-xs text-muted-foreground xl:hidden">
                        <code>{e.slug}</code>
                      </p>
                      {(e.aliases ?? []).length > 0 ? (
                        <p
                          className="mt-0.5 max-w-72 truncate text-xs text-muted-foreground"
                          title={(e.aliases ?? []).join(" · ")}
                        >
                          Também: {(e.aliases ?? []).join(" · ")}
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
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                    <code>{e.slug}</code>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {dados.uso[e.slug] ?? 0}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      inputMode="numeric"
                      className="w-20"
                      aria-label={`Pontos de ${e.label}`}
                      disabled={salvando}
                      value={pontosDraft[e.id] ?? dados.pontos[e.slug] ?? ""}
                      placeholder="—"
                      onChange={(ev) =>
                        setPontosDraft((d) => ({
                          ...d,
                          [e.id]: ev.target.value,
                        }))
                      }
                      onBlur={() => salvarPontos(e)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") {
                          (ev.target as HTMLInputElement).blur();
                        }
                      }}
                    />
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
        <Paginacao
          {...paginacao}
          className="border-t border-border px-4 py-3"
        />
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
                  Outros nomes desta etapa no Pipedrive
                </Label>
                <Textarea
                  id="ed-aliases"
                  rows={4}
                  value={edicao.aliases}
                  onChange={(e) =>
                    setEdicao({ ...edicao, aliases: e.target.value })
                  }
                  placeholder={"Um por linha. Ex.:\nEm análise/Agendar apresentação"}
                />
                <p className="text-xs text-muted-foreground">
                  O nome que a mesma etapa tem em outro funil acompanhado, ou o
                  nome antigo depois de renomeá-la lá. A sincronização e o
                  webhook aceitam qualquer um deles como a própria etapa.
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
                  : `Remover a etapa "${removerAlvo.label}"? A sincronização e o webhook deixam de reconhecer este nome, e a regra de pontos dela é removida junto.`
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

/**
 * De quais funis do Pipedrive esta lista é o espelho. Sem isto a tela diria
 * "espelho do Pipedrive" sem dizer de onde — e um funil que sumiu (excluído,
 * ou a sincronização desligada) pararia os leads sem ninguém ver o porquê.
 */
function SincronizacaoDosFunis({
  sincronizacao,
}: {
  sincronizacao: Resposta["sincronizacao"] | null;
}) {
  if (!sincronizacao) return null;

  if (!sincronizacao.ligada) {
    return (
      <p className="rounded-lg border border-warning-dark/30 bg-warning-light/30 px-3 py-2 text-warning-dark">
        A sincronização com o Pipedrive está desligada neste ambiente (falta o
        token da API). As etapas só mudam pelo webhook.
      </p>
    );
  }

  const nomes = sincronizacao.funis.map((f) => f.nome);
  return (
    <div className="grid gap-2">
      {nomes.length > 0 ? (
        <p>
          Acompanhando no Pipedrive:{" "}
          {nomes.map((nome, i) => (
            <span key={nome}>
              {i > 0 ? (i === nomes.length - 1 ? " e " : ", ") : null}
              <span className="font-medium">{nome}</span>
            </span>
          ))}
          {sincronizacao.quando ? (
            <span className="text-muted-foreground">
              {" "}
              · última leitura em {formatDateTime(sincronizacao.quando)}
            </span>
          ) : null}
          . Os funis têm as mesmas etapas; a lista abaixo serve aos dois.
        </p>
      ) : (
        <p className="text-muted-foreground">
          A sincronização com o Pipedrive ainda não rodou neste ambiente.
        </p>
      )}
      {sincronizacao.ausentes.length > 0 ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive-hover">
          Funil {sincronizacao.ausentes.join(", ")} não foi encontrado no
          Pipedrive — ele pode ter sido excluído. Os leads dele pararam de
          andar aqui.
        </p>
      ) : null}
    </div>
  );
}
