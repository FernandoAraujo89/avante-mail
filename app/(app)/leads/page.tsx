"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  ChartColumn,
  ChevronsUpDown,
  Gauge,
  ListChecks,
  Magnet,
  RefreshCw,
  Search,
  Trash2,
  Webhook,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import {
  CaixaDaPagina,
  Paginacao,
  usePaginacao,
} from "@/components/paginacao";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BarraDeCalor } from "@/components/leads/barra-de-calor";
import {
  etapaLabel,
  FAIXAS,
  faixaInfo,
  type EtapaDto,
  type LeadDto,
} from "@/components/leads/estagios";
import {
  qualificacaoInfo,
  varianteDaQualificacao,
  type QualificacaoDto,
} from "@/components/leads/qualificacoes";
import { formatDate, formatInt } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

interface Resposta {
  leads: LeadDto[];
  etapas: EtapaDto[];
  /** A lista cadastrada — espelho do campo do Pipedrive, vinda da tabela. */
  qualificacoesLista: QualificacaoDto[];
  funil: Record<string, number>;
  /** Etapas que convertem em parceiro: quantos JÁ chegaram nelas (histórico). */
  acumulado: Record<string, number>;
  qualificacoes: Record<string, number>;
  faixas: Record<string, number>;
  canais: { canal: string; total: number }[];
  config: {
    faixaQuente: number;
    faixaAquecido: number;
    faixaMorno: number;
    meiaVidaDias: number;
  };
}

type ChaveDeOrdenacao =
  | "lead"
  | "pontuacao"
  | "qualificacao"
  | "etapa"
  | "origem"
  | "entrada";

/**
 * As colunas ordenáveis, na ordem da tabela. O primeiro clique usa a direção
 * que responde a pergunta mais comum da coluna: texto em A→Z; pontuação e
 * data pelo maior/mais recente; etapa e qualificação na ordem do cadastro
 * (que espelha o funil e o campo do Pipedrive), não alfabética.
 */
const COLUNAS: {
  chave: ChaveDeOrdenacao;
  rotulo: string;
  inicial: "asc" | "desc";
}[] = [
  { chave: "lead", rotulo: "Lead", inicial: "asc" },
  { chave: "pontuacao", rotulo: "Pontuação", inicial: "desc" },
  { chave: "qualificacao", rotulo: "Qualificação", inicial: "asc" },
  { chave: "etapa", rotulo: "Etapa", inicial: "asc" },
  { chave: "origem", rotulo: "Origem", inicial: "asc" },
  { chave: "entrada", rotulo: "Entrou em", inicial: "desc" },
];

export default function LeadsPage() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [estagio, setEstagio] = useState("todos");
  const [canal, setCanal] = useState("todos");
  const [faixa, setFaixa] = useState("todas");
  const [qualificacao, setQualificacao] = useState("todas");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [excluirAberto, setExcluirAberto] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  // Separado do erro: `carregar` começa com setErro(""), e o resultado da
  // exclusão sobrevive ao recarregamento que vem logo depois dela.
  const [aviso, setAviso] = useState("");
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  // O padrão é o da API: mais quente primeiro, porque a lista existe para
  // dizer com quem falar AGORA.
  const [ordem, setOrdem] = useState<{
    chave: ChaveDeOrdenacao;
    direcao: "asc" | "desc";
  }>({ chave: "pontuacao", direcao: "desc" });

  const carregar = useCallback(
    async (silencioso = false) => {
      try {
        if (!silencioso) setErro("");
        const params = new URLSearchParams();
        if (busca.trim()) params.set("busca", busca.trim());
        if (estagio !== "todos") params.set("estagio", estagio);
        if (canal !== "todos") params.set("canal", canal);
        if (faixa !== "todas") params.set("faixa", faixa);
        if (qualificacao !== "todas") params.set("qualificacao", qualificacao);

        const res = await fetch(`/api/leads?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao carregar os leads.");
        setDados(json);
        setAtualizadoEm(new Date());
        if (silencioso) {
          // A atualização de fundo não pode roubar o trabalho de ninguém: a
          // seleção fica — só perde quem saiu da lista, senão o "excluir
          // selecionados" levaria junto alguém que ninguém está vendo.
          const visiveis = new Set(
            (json.leads as LeadDto[]).map((l) => l.id)
          );
          setSelecionados(
            (antes) => new Set([...antes].filter((id) => visiveis.has(id)))
          );
        } else {
          // A seleção não sobrevive ao filtro: marcado fora da tela é marcado
          // que ninguém vê, e a exclusão levaria junto quem sumiu da lista.
          setSelecionados(new Set());
        }
      } catch (err) {
        // Falha na atualização de fundo NÃO apaga a tela: um soluço de rede a
        // cada 30s viraria uma lista piscando em branco.
        if (silencioso) return;
        setDados({
          leads: [],
          etapas: [],
          qualificacoesLista: [],
          funil: {},
          acumulado: {},
          qualificacoes: {},
          faixas: {},
          canais: [],
          config: {
            faixaQuente: 100,
            faixaAquecido: 50,
            faixaMorno: 20,
            meiaVidaDias: 30,
          },
        });
        setErro(err instanceof Error ? err.message : String(err));
      }
    },
    [busca, estagio, canal, faixa, qualificacao]
  );

  useEffect(() => {
    const timer = setTimeout(carregar, 300);
    return () => clearTimeout(timer);
  }, [carregar]);

  // Tempo real, do jeito que o dado anda aqui (webhooks + sincronização de 5
  // min): a tela se atualiza sozinha a cada 30s enquanto está visível, e na
  // hora em que a pessoa volta para a aba — que é quando a foto velha engana.
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === "visible") carregar(true);
    };
    const timer = setInterval(aoVoltar, 30_000);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [carregar]);

  // O aviso da última exclusão some assim que a pessoa mexe nos filtros: senão
  // fica pendurado descrevendo uma ação que já saiu de vista.
  useEffect(() => {
    setAviso("");
  }, [busca, estagio, canal, faixa, qualificacao]);

  function alternarUm(id: string) {
    setSelecionados((antes) => {
      const agora = new Set(antes);
      if (agora.has(id)) agora.delete(id);
      else agora.add(id);
      return agora;
    });
  }

  async function excluirSelecionados() {
    if (selecionados.size === 0) return;
    setExcluindo(true);
    try {
      const res = await fetch("/api/leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selecionados] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao excluir os leads.");
      setExcluirAberto(false);
      await carregar();
      // Recusa não é silêncio: se algum id não era lead, a tela diz, senão
      // "5 selecionados" viraria "3 excluídos" sem explicação nenhuma.
      const excluidos = `${json.excluidos} lead${json.excluidos === 1 ? "" : "s"} excluído${json.excluidos === 1 ? "" : "s"}.`;
      setAviso(
        json.recusados > 0
          ? `${excluidos} ${json.recusados} não ${json.recusados === 1 ? "era lead e foi mantido" : "eram leads e foram mantidos"}.`
          : excluidos
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setExcluirAberto(false);
    } finally {
      setExcluindo(false);
    }
  }

  const totalNoFunil = useMemo(
    () => Object.values(dados?.funil ?? {}).reduce((a, b) => a + b, 0),
    [dados]
  );

  function alternarOrdem(chave: ChaveDeOrdenacao) {
    setOrdem((atual) =>
      atual.chave === chave
        ? { chave, direcao: atual.direcao === "asc" ? "desc" : "asc" }
        : { chave, direcao: COLUNAS.find((c) => c.chave === chave)!.inicial }
    );
  }

  // Ordenação no cliente, como nas tabelas de relatório: a lista já chega
  // inteira da API, e reordenar não pode custar uma ida ao servidor. O sort é
  // estável, então empates preservam o "mais quente primeiro" que vem de lá.
  const leads = useMemo(() => {
    if (!dados) return null;
    const posicaoDaEtapa = new Map(dados.etapas.map((e) => [e.slug, e.position]));
    const posicaoDaQualificacao = new Map(
      dados.qualificacoesLista.map((q) => [q.slug, q.position])
    );
    // Etapa e qualificação ordenam pela POSIÇÃO do cadastro: "onde no funil" e
    // "qual opção do campo", não ordem alfabética de rótulo. Etapa nula é quem
    // virou parceiro — além do fim do funil, não "sem dado".
    const valorDe = (l: LeadDto): string | number | null => {
      switch (ordem.chave) {
        case "lead":
          return l.name;
        case "pontuacao":
          return l.leadScore;
        case "qualificacao":
          return l.qualification
            ? (posicaoDaQualificacao.get(l.qualification) ??
                Number.MAX_SAFE_INTEGER)
            : null;
        case "etapa":
          return l.stage === null
            ? Number.MAX_SAFE_INTEGER
            : (posicaoDaEtapa.get(l.stage) ?? Number.MAX_SAFE_INTEGER);
        case "origem":
          return l.sourceChannel;
        case "entrada":
          return l.acquiredAt ?? l.createdAt;
      }
    };
    const dir = ordem.direcao === "asc" ? 1 : -1;
    const lista = [...dados.leads];
    lista.sort((a, b) => {
      const va = valorDe(a);
      const vb = valorDe(b);
      // Sem valor é sempre o fim da lista, nas duas direções: lead sem nota ou
      // sem qualificação não pode encabeçar nada só por estar em branco.
      if (va === null || vb === null) {
        return va === vb ? 0 : va === null ? 1 : -1;
      }
      const cmp =
        typeof va === "number"
          ? va - (vb as number)
          : va.localeCompare(vb as string, "pt-BR", { sensitivity: "base" });
      return cmp * dir;
    });
    return lista;
  }, [dados, ordem]);

  // Filtro ou ordem nova volta para a 1ª página; a atualização de fundo a cada
  // 30s traz os mesmos filtros e deixa a pessoa na página em que está.
  const { itensDaPagina, ancora, paginacao } = usePaginacao(leads ?? [], {
    chave: "leads",
    redefinirCom: [
      busca,
      estagio,
      canal,
      faixa,
      qualificacao,
      ordem.chave,
      ordem.direcao,
    ],
  });
  const idsDaPagina = itensDaPagina.map((l) => l.id);
  const paginaInteiraMarcada =
    idsDaPagina.length > 0 && idsDaPagina.every((id) => selecionados.has(id));
  // Marcado em outra página continua marcado — e a barra diz quantos, porque
  // é gente que a exclusão leva sem estar à vista.
  const marcadosForaDaPagina =
    selecionados.size - idsDaPagina.filter((id) => selecionados.has(id)).length;
  const totalFiltrado = leads?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Gestão de leads"
        description="Nutrição de quem chegou por formulário, anúncio ou integração. Aqui a gente esquenta e mede o interesse; a venda acontece no Pipedrive."
      >
        <Button variant="outline" asChild>
          <Link href="/leads/relatorio">
            <ChartColumn />
            Relatório
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/leads/pontuacao">
            <Gauge />
            Pontuação
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/leads/etapas">
            <ListChecks />
            Etapas do funil
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/leads/qualificacoes">
            <BadgeCheck />
            Qualificações
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/leads/origens">
            <Webhook />
            Origens (webhook)
          </Link>
        </Button>
      </PageHeader>

      {/* O funil do Pipedrive, espelhado. A contagem é da base inteira, não do
          filtro — é o "onde estão meus leads", e encolher junto com a busca não
          responderia isso.

          As colunas vêm da tabela de etapas, não de uma constante: quem manda
          no funil é o comercial, e a tela precisa acompanhar sem deploy.

          O rótulo reserva duas linhas (min-h-8): etapa de nome longo quebra, e
          sem a reserva o número dela desceria — os números precisam dividir a
          mesma linha de base para a comparação de relance funcionar.

          Com o funil inteiro do Pipedrive são uns 11 cartões: no celular, em
          grade, eles empurravam a lista para depois de seis linhas. Lá eles
          viram uma faixa que rola de lado, na ordem do funil; do sm para cima,
          uma grade que decide as colunas pela largura que sobra ao lado do
          menu (9,75rem é o mínimo que mantém em duas linhas o rótulo mais longo). */}
      <div className="-mx-4 mb-6 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(9.75rem,1fr))] sm:overflow-visible sm:px-0 sm:pb-0">
        <button
          type="button"
          onClick={() => setEstagio("todos")}
          className={`flex w-44 shrink-0 snap-start flex-col rounded-lg border px-4 py-3 text-left transition-colors sm:w-auto sm:px-3 ${
            estagio === "todos"
              ? "border-primary bg-accent"
              : "border-border bg-card hover:border-muted-foreground/40"
          }`}
        >
          <p className="min-h-8 text-xs text-muted-foreground">Todos</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{totalNoFunil}</p>
        </button>
        {(dados?.etapas ?? [])
          // Etapa desativada só aparece se ainda tiver alguém dentro — senão a
          // tela mostraria coluna vazia de um processo que não existe mais.
          .filter((e) => e.active || (dados?.funil[e.slug] ?? 0) > 0)
          .map((e) =>
            e.convertListId ? (
              // Etapa que converte em parceiro esvazia na hora — a contagem ao
              // vivo seria um zero eterno. A coluna mostra o ACUMULADO de quem
              // chegou, e o clique filtra por ELES (pela linha do tempo): quem
              // comprou saiu da lista de leads, mas não da pergunta.
              <button
                key={e.slug}
                type="button"
                onClick={() => setEstagio(e.slug)}
                className={`flex w-44 shrink-0 snap-start flex-col rounded-lg border px-4 py-3 text-left transition-colors sm:w-auto sm:px-3 ${
                  estagio === e.slug
                    ? "border-success-dark bg-success-light/30"
                    : "border-success-dark/30 bg-success-light/10 hover:border-success-dark/60"
                }`}
              >
                <p className="min-h-8 text-xs text-muted-foreground">
                  {e.label}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {dados?.acumulado[e.slug] ?? 0}
                </p>
                <p className="mt-0.5 text-xs text-success-dark">
                  chegaram e viraram parceiros
                </p>
              </button>
            ) : (
              <button
                key={e.slug}
                type="button"
                onClick={() => setEstagio(e.slug)}
                className={`flex w-44 shrink-0 snap-start flex-col rounded-lg border px-4 py-3 text-left transition-colors sm:w-auto sm:px-3 ${
                  estagio === e.slug
                    ? "border-primary bg-accent"
                    : "border-border bg-card hover:border-muted-foreground/40"
                }`}
              >
                <p className="min-h-8 text-xs text-muted-foreground">
                  {e.label}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {dados?.funil[e.slug] ?? 0}
                </p>
                {e.stopsNurturing ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    encerra a nutrição
                  </p>
                ) : null}
              </button>
            )
          )}
      </div>

      {/* Busca em cima, filtros embaixo em colunas IGUAIS: no flex com larguras
          fixas eles embrulhavam em linhas tortas — três numa linha, um sozinho
          na outra. A grade mantém as bordas alinhadas em qualquer largura, e no
          celular cada filtro ocupa a linha inteira. */}
      <div className="mb-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, e-mail, empresa ou telefone..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="hidden tabular-nums sm:inline">
              {atualizadoEm
                ? `Atualizado às ${atualizadoEm.toLocaleTimeString("pt-BR")}`
                : ""}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Atualizar agora"
              title="Atualizar agora — a lista também se atualiza sozinha a cada 30s"
              onClick={() => carregar(true)}
            >
              <RefreshCw className="size-4" />
            </Button>
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {/* O mesmo filtro dos cartões do funil, em forma de seletor: os
              cartões não se enxergam como controle, e o filtro por etapa
              precisa estar onde os outros filtros estão. Etapa que converte
              fica fora — quem chega nela vira parceiro e sai desta lista. */}
          <Select value={estagio} onValueChange={setEstagio}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Etapa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as etapas</SelectItem>
              {(dados?.etapas ?? [])
                .filter((e) => e.active || (dados?.funil[e.slug] ?? 0) > 0)
                .map((e) => (
                  <SelectItem key={e.slug} value={e.slug}>
                    {e.convertListId
                      ? `${e.label} — viraram parceiros (${dados?.acumulado[e.slug] ?? 0})`
                      : `${e.label} (${dados?.funil[e.slug] ?? 0})`}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={faixa} onValueChange={setFaixa}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pontuação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as pontuações</SelectItem>
              {FAIXAS.map((f) => (
                <SelectItem key={f.valor} value={f.valor}>
                  {f.rotulo} ({dados?.faixas?.[f.valor] ?? 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={qualificacao} onValueChange={setQualificacao}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Qualificação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as qualificações</SelectItem>
              {(dados?.qualificacoesLista ?? [])
                // Desativada só aparece se ainda tiver alguém dentro — mesma
                // regra do painel de etapas logo acima.
                .filter(
                  (q) => q.active || (dados?.qualificacoes?.[q.slug] ?? 0) > 0
                )
                .map((q) => (
                  <SelectItem key={q.slug} value={q.slug}>
                    {q.label} ({dados?.qualificacoes?.[q.slug] ?? 0})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={canal} onValueChange={setCanal}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Canal de origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os canais</SelectItem>
              {(dados?.canais ?? []).map((c) => (
                <SelectItem key={c.canal} value={c.canal}>
                  {c.canal} ({c.total})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      {aviso ? (
        <div className="mb-4 rounded-lg border bg-accent/50 px-4 py-3 text-sm">
          {aviso}
        </div>
      ) : null}

      {selecionados.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-accent/50 px-4 py-2">
          <span className="text-sm">
            <span className="font-medium">
              {formatInt(selecionados.size)} lead
              {selecionados.size === 1 ? "" : "s"} selecionado
              {selecionados.size === 1 ? "" : "s"}
            </span>
            {marcadosForaDaPagina > 0 ? (
              <span className="text-muted-foreground">
                {" "}
                · {formatInt(marcadosForaDaPagina)} em outras páginas
              </span>
            ) : null}
            {/* A caixa do cabeçalho marca só a página; a lista filtrada
                inteira é um convite explícito, com o número à vista. */}
            {paginaInteiraMarcada && selecionados.size < totalFiltrado ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto px-1.5 py-0 text-sm"
                onClick={() =>
                  setSelecionados(new Set((leads ?? []).map((l) => l.id)))
                }
              >
                Selecionar todos os {formatInt(totalFiltrado)}
              </Button>
            ) : null}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelecionados(new Set())}
            >
              Limpar seleção
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setExcluirAberto(true)}
            >
              <Trash2 />
              Excluir selecionados
            </Button>
          </div>
        </div>
      ) : null}

      <Card ref={ancora}>
        {leads === null ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando leads...
          </p>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Magnet className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {totalNoFunil === 0
                ? "Nenhum lead ainda. Ligue uma origem de webhook para começar a receber."
                : "Nenhum lead com os filtros atuais."}
            </p>
            {totalNoFunil === 0 ? (
              <Button variant="outline" asChild>
                <Link href="/leads/origens">
                  <Webhook />
                  Configurar origem
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <CaixaDaPagina
                    ids={idsDaPagina}
                    selecionados={selecionados}
                    onChange={setSelecionados}
                  />
                </TableHead>
                {COLUNAS.map((c) => (
                  <TableHead
                    key={c.chave}
                    aria-sort={
                      ordem.chave === c.chave
                        ? ordem.direcao === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      onClick={() => alternarOrdem(c.chave)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {c.rotulo}
                      {ordem.chave === c.chave ? (
                        ordem.direcao === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {itensDaPagina.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="w-10">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${lead.name}`}
                      className="size-4 cursor-pointer accent-primary align-middle"
                      checked={selecionados.has(lead.id)}
                      onChange={() => alternarUm(lead.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium hover:underline"
                    >
                      {lead.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {lead.email}
                      {lead.phone ? ` · ${formatPhone(lead.phone)}` : ""}
                      {lead.company ? ` · ${lead.company}` : ""}
                    </p>
                    {!lead.subscribed ? (
                      <p className="mt-1 text-xs text-warning-dark">
                        Sem aceite de e-mail
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {/* A barra dá a leitura de relance; o rótulo da faixa fica
                        embaixo porque é o que a pontuação e os gatilhos usam —
                        sem ele, a barra seria bonita e sem vocabulário. */}
                    <BarraDeCalor
                      score={lead.leadScore}
                      faixa={lead.leadScoreBand}
                      limiarMorno={dados?.config.faixaMorno ?? 20}
                      limiarAquecido={dados?.config.faixaAquecido ?? 50}
                      limiarQuente={dados?.config.faixaQuente ?? 100}
                    />
                    {faixaInfo(lead.leadScoreBand) ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {faixaInfo(lead.leadScoreBand)!.rotulo}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const q = qualificacaoInfo(
                        dados?.qualificacoesLista ?? [],
                        lead.qualification
                      );
                      return q ? (
                        <Badge variant={varianteDaQualificacao(q)}>
                          {q.label}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          sem qualificação
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {lead.stage === null ? (
                      // Só aparece no filtro por etapa que converte: o contato
                      // comprou e saiu do funil.
                      <Badge variant="success">Virou parceiro</Badge>
                    ) : (
                      <>
                        <span className="text-sm">
                          {etapaLabel(dados?.etapas ?? [], lead.stage)}
                        </span>
                        {lead.stageChangedAt ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            desde {formatDate(lead.stageChangedAt)}
                          </p>
                        ) : null}
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {lead.sourceChannel ?? "—"}
                    </span>
                    {lead.utmCampaign ? (
                      <p className="mt-0.5 max-w-56 truncate text-xs text-muted-foreground">
                        {lead.utmCampaign}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(lead.acquiredAt ?? lead.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Paginacao
          {...paginacao}
          totalSemFiltro={totalNoFunil}
          className="border-t border-border px-4 py-3"
        />
      </Card>

      <Dialog open={excluirAberto} onOpenChange={setExcluirAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir leads</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">
                {selecionados.size} lead{selecionados.size === 1 ? "" : "s"}
              </span>{" "}
              {selecionados.size === 1 ? "será apagado" : "serão apagados"} da
              base, junto com a origem, a pontuação, a linha do tempo e o
              histórico de envios. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          {/* A porta de entrada continua aberta: se o agente reenviar esses
              contatos, eles voltam com ficha nova. Dizer aqui evita a conclusão
              errada de que a exclusão falhou. */}
          <p className="text-xs text-muted-foreground">
            Se esses contatos entrarem de novo por uma origem de webhook, eles
            voltam a entrar como leads novos.
          </p>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExcluirAberto(false)}
              disabled={excluindo}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={excluirSelecionados}
              disabled={excluindo}
            >
              {excluindo ? "Excluindo..." : "Excluir selecionados"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
