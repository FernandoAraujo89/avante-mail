"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { FAIXAS, faixaInfo } from "@/components/leads/estagios";
import { varianteDaQualificacao } from "@/components/leads/qualificacoes";
import { formatDateTime } from "@/lib/format";

/**
 * Relatório da gestão de leads — resumido, detalhado ou por seções à escolha.
 *
 * As decisões de visualização seguem o método do design system: forma antes
 * de cor; magnitude = barras de UM matiz (o azul Avante); escala ordenada do
 * funil = rampa ordinal do mesmo azul, VALIDADA (#9ab8f0→#1337a0, um matiz,
 * L monótona, ponta clara ≥2:1 no branco); identidade nunca só pela cor (os
 * chips de faixa/qualificação acompanham o texto); valores nas pontas em
 * tinta de texto, nunca na cor da série.
 */

// Rampa ordinal do funil, da etapa mais rasa à mais funda (validada no branco
// com --ordinal). Com mais etapas que degraus, etapas vizinhas dividem o
// degrau: esticar a rampa a 10 tons deixaria degraus que o olho não separa, e
// quem nomeia cada barra é o rótulo ao lado dela.
const RAMPA_FUNIL = ["#9ab8f0", "#5b82e8", "#1d50dc", "#1337a0"];
const AZUL = "#1d50dc";

// As mesmas cores da barra de calor do produto — usadas SÓ como chip de
// identidade ao lado do rótulo, nunca como única codificação.
const COR_DA_FAIXA: Record<string, string> = {
  frio: "#8AB4F8",
  morno: "#7A6BC4",
  aquecido: "#E09B0D",
  quente: "#F76A62",
};

interface Relatorio {
  geradoEm: string;
  config: {
    faixaMorno: number;
    faixaAquecido: number;
    faixaQuente: number;
    meiaVidaDias: number;
  };
  kpis: {
    total: number;
    novos30d: number;
    comQualificacao: number;
    quentes: number;
    convertidos: number;
    mediaScore: number | null;
  };
  funil: { slug: string; label: string; converte: boolean; passaram: number }[];
  /** Quem está em "Perdido" agora. Nulo quando a etapa não existe. */
  perdidos: number | null;
  qualificacoes: { slug: string; label: string; variant: string; total: number }[];
  semQualificacao: number;
  faixas: Record<string, number>;
  semFaixa: number;
  canais: { canal: string; total: number }[];
  outrosCanais: number;
  campanhas: { campanha: string; total: number }[];
  semanas: { semana: string; total: number }[];
  engajamento: Record<string, number>;
  topLeads: {
    id: string;
    name: string;
    email: string;
    score: number | null;
    faixa: string | null;
    qualification: string | null;
    stage: string | null;
  }[];
}

const SECOES = [
  { id: "visao", rotulo: "Visão geral" },
  { id: "funil", rotulo: "Funil de marketing" },
  { id: "qualificacoes", rotulo: "Qualificações (CRM)" },
  { id: "temperatura", rotulo: "Temperatura" },
  { id: "canais", rotulo: "Canais e campanhas" },
  { id: "evolucao", rotulo: "Entrada de leads" },
  { id: "engajamento", rotulo: "Engajamento (30 dias)" },
  { id: "quentes", rotulo: "Leads mais quentes" },
] as const;

type SecaoId = (typeof SECOES)[number]["id"];

const RESUMIDO: SecaoId[] = ["visao", "funil", "qualificacoes", "temperatura"];
const DETALHADO: SecaoId[] = SECOES.map((s) => s.id);

/** Barra horizontal genérica: rótulo, barra de UM matiz, valor na ponta. */
function BarraH({
  rotulo,
  chip,
  valor,
  maximo,
  cor = AZUL,
}: {
  rotulo: React.ReactNode;
  chip?: string;
  valor: number;
  maximo: number;
  cor?: string;
}) {
  const pct = maximo > 0 ? (valor / maximo) * 100 : 0;
  return (
    <div className="grid grid-cols-[minmax(96px,180px)_1fr_auto] items-center gap-3">
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        {chip ? (
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: chip }}
          />
        ) : null}
        <span className="truncate" title={typeof rotulo === "string" ? rotulo : undefined}>
          {rotulo}
        </span>
      </span>
      <span className="relative h-4 border-l border-border">
        <span
          className="absolute inset-y-0 left-0 rounded-r-[4px]"
          style={{
            width: `max(${pct}%, ${valor > 0 ? "3px" : "0px"})`,
            backgroundColor: cor,
          }}
        />
      </span>
      <span className="w-10 text-right text-sm font-medium tabular-nums">
        {valor}
      </span>
    </div>
  );
}

/** O funil: quantos PASSARAM por cada etapa, com a taxa entre elas. */
function Funil({ funil }: { funil: Relatorio["funil"] }) {
  const maximo = Math.max(1, ...funil.map((f) => f.passaram));
  return (
    <div className="grid gap-1.5">
      {funil.map((f, i) => {
        const anterior = i > 0 ? funil[i - 1].passaram : null;
        const taxa =
          anterior && anterior > 0
            ? Math.round((f.passaram / anterior) * 100)
            : null;
        return (
          <div key={f.slug} className="grid gap-1.5">
            {i > 0 ? (
              <p className="pl-1 text-xs text-muted-foreground">
                ↓ {taxa}% avançam
              </p>
            ) : null}
            {/* O rótulo quebra em vez de cortar: com as etapas do Pipedrive
                ("Agendar apresentação parte técnica") os 180px de antes
                viravam reticências até em monitor largo. O teto em 40% guarda
                espaço para a barra no celular. */}
            <div className="grid grid-cols-[minmax(96px,min(14rem,40%))_1fr_auto] items-center gap-3">
              <span className="text-sm leading-snug">{f.label}</span>
              <span className="relative h-6 border-l border-border">
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px]"
                  style={{
                    width: `max(${(f.passaram / maximo) * 100}%, ${f.passaram > 0 ? "3px" : "0px"})`,
                    backgroundColor:
                      RAMPA_FUNIL[
                        Math.min(
                          Math.floor((i * RAMPA_FUNIL.length) / funil.length),
                          RAMPA_FUNIL.length - 1
                        )
                      ],
                  }}
                />
              </span>
              <span className="w-10 text-right text-sm font-semibold tabular-nums">
                {f.passaram}
              </span>
            </div>
            {f.converte ? (
              <p className="pl-1 text-xs text-success-dark">
                quem chega aqui vira parceiro — contagem acumulada
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Série semanal: área + linha do azul Avante, com tooltip por ponto. */
function Evolucao({
  semanas,
  geradoEm,
}: {
  semanas: { semana: string; total: number }[];
  geradoEm: string;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);

  // As 12 semanas completas, com zero onde nada entrou — buracos na série
  // esconderiam exatamente as semanas ruins, que são a informação.
  const pontos = useMemo(() => {
    const porSemana = new Map(semanas.map((s) => [s.semana, s.total]));
    const base = new Date(geradoEm);
    const segunda = new Date(base);
    segunda.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    const lista: { chave: string; rotulo: string; total: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(segunda);
      d.setDate(segunda.getDate() - i * 7);
      const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      lista.push({
        chave,
        rotulo: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
        total: porSemana.get(chave) ?? 0,
      });
    }
    return lista;
  }, [semanas, geradoEm]);

  const maximo = Math.max(1, ...pontos.map((p) => p.total));
  // Teto "redondo" para as linhas de grade dizerem números limpos.
  const teto = Math.max(4, Math.ceil(maximo / 4) * 4);

  const x = (i: number) => (i / (pontos.length - 1)) * 100;
  const y = (v: number) => 100 - (v / teto) * 100;
  const caminho = pontos
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.total)}`)
    .join(" ");

  return (
    <div className="grid gap-1">
      <div className="grid grid-cols-[auto_1fr] gap-2">
        {/* Réguas — números limpos, tinta recessiva. */}
        <div className="relative w-8 text-right text-xs tabular-nums text-muted-foreground">
          <span className="absolute right-0 top-0 -translate-y-1/2">{teto}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2">
            {teto / 2}
          </span>
          <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
        </div>
        <div className="relative h-44">
          {[0, 50, 100].map((p) => (
            <span
              key={p}
              aria-hidden
              className="absolute inset-x-0 border-t border-border/60"
              style={{ top: `${p}%` }}
            />
          ))}
          <svg
            aria-hidden
            className="absolute inset-0 size-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <path
              d={`${caminho} L 100 100 L 0 100 Z`}
              fill={AZUL}
              opacity="0.1"
            />
            <path
              d={caminho}
              fill="none"
              stroke={AZUL}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {pontos.map((p, i) => (
            <span
              key={p.chave}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${x(i)}%`, top: `${y(p.total)}%` }}
            >
              <span
                className={`block rounded-full ring-2 ring-card ${
                  ativo === i ? "size-3" : "size-2"
                }`}
                style={{ backgroundColor: AZUL }}
              />
            </span>
          ))}
          {/* Alvos de hover em coluna cheia — maiores que a marca. */}
          {pontos.map((p, i) => (
            <button
              key={p.chave}
              type="button"
              aria-label={`Semana de ${p.rotulo}: ${p.total} lead${p.total === 1 ? "" : "s"}`}
              className="absolute inset-y-0 z-20 -translate-x-1/2"
              style={{ left: `${x(i)}%`, width: `${100 / pontos.length}%` }}
              onMouseEnter={() => setAtivo(i)}
              onMouseLeave={() => setAtivo(null)}
              onFocus={() => setAtivo(i)}
              onBlur={() => setAtivo(null)}
            />
          ))}
          {ativo !== null ? (
            <span
              className="pointer-events-none absolute z-30 -translate-x-1/2 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-md"
              style={{
                left: `clamp(3rem, ${x(ativo)}%, calc(100% - 3rem))`,
                top: `calc(${y(pontos[ativo].total)}% - 2.25rem)`,
              }}
            >
              <span className="text-muted-foreground">
                sem. {pontos[ativo].rotulo}:
              </span>{" "}
              <span className="font-semibold tabular-nums">
                {pontos[ativo].total}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="ml-10 flex justify-between text-xs text-muted-foreground">
        <span>{pontos[0]?.rotulo}</span>
        <span className="hidden sm:inline">{pontos[6]?.rotulo}</span>
        <span>{pontos[11]?.rotulo}</span>
      </div>
    </div>
  );
}

export default function RelatorioPage() {
  const [dados, setDados] = useState<Relatorio | null>(null);
  const [erro, setErro] = useState("");

  const [nivel, setNivel] = useState<"resumido" | "detalhado" | "personalizado">(
    "detalhado"
  );
  const [escolhidas, setEscolhidas] = useState<Set<SecaoId>>(
    new Set(DETALHADO)
  );

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch("/api/leads/relatorio");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao gerar o relatório.");
      setDados(json);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function mudarNivel(novo: string) {
    if (novo === "resumido" || novo === "detalhado" || novo === "personalizado") {
      setNivel(novo);
      if (novo === "resumido") setEscolhidas(new Set(RESUMIDO));
      if (novo === "detalhado") setEscolhidas(new Set(DETALHADO));
    }
  }

  function alternarSecao(id: SecaoId) {
    setEscolhidas((antes) => {
      const agora = new Set(antes);
      if (agora.has(id)) agora.delete(id);
      else agora.add(id);
      return agora;
    });
  }

  const mostra = (id: SecaoId) => escolhidas.has(id);

  const rotuloDaEtapa = (slug: string | null) =>
    dados?.funil.find((f) => f.slug === slug)?.label ?? slug ?? "—";
  const qualificacaoDe = (slug: string | null) =>
    dados?.qualificacoes.find((q) => q.slug === slug) ?? null;

  const maxQualificacao = Math.max(
    1,
    ...(dados?.qualificacoes.map((q) => q.total) ?? [0]),
    dados?.semQualificacao ?? 0
  );
  const maxFaixa = Math.max(
    1,
    ...FAIXAS.map((f) => dados?.faixas[f.valor] ?? 0),
    dados?.semFaixa ?? 0
  );
  const maxCanal = Math.max(
    1,
    ...(dados?.canais.map((c) => c.total) ?? [0]),
    dados?.outrosCanais ?? 0
  );

  return (
    <>
      <div className="print:hidden">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/leads">
            <ArrowLeft />
            Voltar para leads
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Relatório de leads"
        description={
          dados
            ? `Gerado em ${formatDateTime(dados.geradoEm)} — retrato da base neste momento.`
            : "Retrato da base neste momento."
        }
      >
        <div className="print:hidden">
          <Select value={nivel} onValueChange={mudarNivel}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="resumido">Resumido</SelectItem>
              <SelectItem value="detalhado">Detalhado</SelectItem>
              <SelectItem value="personalizado">Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          className="print:hidden"
          onClick={() => window.print()}
        >
          <Printer />
          Imprimir / PDF
        </Button>
      </PageHeader>

      {nivel === "personalizado" ? (
        <Card className="mb-6 print:hidden">
          <CardContent className="flex flex-wrap gap-x-5 gap-y-2 py-4">
            {SECOES.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={escolhidas.has(s.id)}
                  onChange={() => alternarSecao(s.id)}
                  className="size-4 accent-[#1D50DC]"
                />
                {s.rotulo}
              </label>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      {dados === null && !erro ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Gerando o relatório...
        </p>
      ) : null}

      {dados ? (
        <div className="grid gap-6">
          {mostra("visao") ? (
            <section className="break-inside-avoid">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { rotulo: "Leads na base", valor: dados.kpis.total },
                  { rotulo: "Novos (30 dias)", valor: dados.kpis.novos30d },
                  {
                    rotulo: "Qualificados no CRM",
                    valor: dados.kpis.comQualificacao,
                    sub:
                      dados.kpis.total > 0
                        ? `${Math.round((dados.kpis.comQualificacao / dados.kpis.total) * 100)}% da base`
                        : undefined,
                  },
                  {
                    rotulo: "Quentes e aquecidos",
                    valor: dados.kpis.quentes,
                  },
                  {
                    rotulo: "Compraram → parceiros",
                    valor: dados.kpis.convertidos,
                  },
                  {
                    rotulo: "Score médio",
                    valor: dados.kpis.mediaScore ?? "—",
                  },
                ].map((k) => (
                  <div
                    key={k.rotulo}
                    className="rounded-xl border border-border bg-card px-4 py-3"
                  >
                    <p className="text-xs text-muted-foreground">{k.rotulo}</p>
                    <p className="mt-1 text-2xl font-bold">{k.valor}</p>
                    {"sub" in k && k.sub ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {k.sub}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {mostra("funil") ? (
            <Card className="break-inside-avoid">
              <CardHeader>
                <CardTitle>Funil de marketing</CardTitle>
              </CardHeader>
              <CardContent>
                <Funil funil={dados.funil} />
                {/* Perdido é saída, não degrau: fora da sequência, contado à
                    parte — e quem perdeu segue contado nas etapas até onde
                    tinha chegado. */}
                {dados.perdidos !== null ? (
                  <p className="mt-4 border-t border-border pt-3 text-sm">
                    <span className="font-semibold tabular-nums">
                      {dados.perdidos}
                    </span>{" "}
                    {dados.perdidos === 1 ? "lead está" : "leads estão"} em{" "}
                    <span className="font-medium">Perdido</span>{" "}
                    <span className="text-muted-foreground">
                      — negócio perdido no Pipedrive. Eles contam nas etapas até
                      onde chegaram antes de perder.
                    </span>
                  </p>
                ) : null}
                <p className="mt-4 text-xs text-muted-foreground">
                  Quantos leads <span className="font-medium">chegaram</span>{" "}
                  pelo menos até cada etapa — quem avançou, pulou etapa ou virou
                  parceiro conta em todas as etapas até onde chegou.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            {mostra("qualificacoes") ? (
              <Card className="break-inside-avoid">
                <CardHeader>
                  <CardTitle>Qualificações (CRM)</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {dados.qualificacoes.map((q) => (
                    <BarraH
                      key={q.slug}
                      rotulo={
                        <span className="flex items-center gap-1.5">
                          <Badge
                            variant={varianteDaQualificacao(q)}
                            className="px-1.5 py-0.5"
                          >
                            {q.label}
                          </Badge>
                        </span>
                      }
                      valor={q.total}
                      maximo={maxQualificacao}
                    />
                  ))}
                  <BarraH
                    rotulo="Sem qualificação"
                    valor={dados.semQualificacao}
                    maximo={maxQualificacao}
                    cor="#95a7b5"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Preenchida pelo vendedor no Pipedrive; a sincronização traz.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {mostra("temperatura") ? (
              <Card className="break-inside-avoid">
                <CardHeader>
                  <CardTitle>Temperatura (Lead Score)</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {[...FAIXAS].reverse().map((f) => (
                    <BarraH
                      key={f.valor}
                      rotulo={f.rotulo}
                      chip={COR_DA_FAIXA[f.valor]}
                      valor={dados.faixas[f.valor] ?? 0}
                      maximo={maxFaixa}
                    />
                  ))}
                  {dados.semFaixa > 0 ? (
                    <BarraH
                      rotulo="Ainda sem cálculo"
                      valor={dados.semFaixa}
                      maximo={maxFaixa}
                      cor="#95a7b5"
                    />
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Frio &lt; {dados.config.faixaMorno} · Morno até{" "}
                    {dados.config.faixaAquecido - 1} · Aquecido até{" "}
                    {dados.config.faixaQuente - 1} · Quente{" "}
                    {dados.config.faixaQuente}+ · meia-vida de{" "}
                    {dados.config.meiaVidaDias} dias
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {mostra("canais") ? (
              <Card className="break-inside-avoid">
                <CardHeader>
                  <CardTitle>Canais de origem</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {dados.canais.length === 0 && dados.outrosCanais === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhum lead com canal registrado ainda.
                    </p>
                  ) : (
                    <>
                      {dados.canais.map((c) => (
                        <BarraH
                          key={c.canal}
                          rotulo={c.canal}
                          valor={c.total}
                          maximo={maxCanal}
                        />
                      ))}
                      {dados.outrosCanais > 0 ? (
                        <BarraH
                          rotulo="Outros / sem canal"
                          valor={dados.outrosCanais}
                          maximo={maxCanal}
                          cor="#95a7b5"
                        />
                      ) : null}
                    </>
                  )}
                  {dados.campanhas.length > 0 ? (
                    <div className="mt-3 border-t border-border pt-3">
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                        Campanhas (utm_campaign) que mais trouxeram
                      </p>
                      <ol className="grid gap-1 text-sm">
                        {dados.campanhas.map((c) => (
                          <li
                            key={c.campanha}
                            className="flex items-baseline justify-between gap-3"
                          >
                            <span className="truncate" title={c.campanha}>
                              {c.campanha}
                            </span>
                            <span className="shrink-0 font-medium tabular-nums">
                              {c.total}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {mostra("engajamento") ? (
              <Card className="break-inside-avoid">
                <CardHeader>
                  <CardTitle>Engajamento nos últimos 30 dias</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {[
                      { tipo: "email_opened", rotulo: "E-mails abertos" },
                      { tipo: "email_clicked", rotulo: "Cliques em e-mail" },
                      { tipo: "whatsapp_replied", rotulo: "Respostas no WhatsApp" },
                      { tipo: "site_visited", rotulo: "Visitas ao site" },
                      { tipo: "lead_qualified", rotulo: "Qualificações no CRM" },
                      { tipo: "lead_stage_changed", rotulo: "Movimentos no funil" },
                    ].map((e) => (
                      <div
                        key={e.tipo}
                        className="rounded-lg border border-border px-3 py-2"
                      >
                        <p className="text-xs text-muted-foreground">
                          {e.rotulo}
                        </p>
                        <p className="mt-0.5 text-xl font-bold">
                          {dados.engajamento[e.tipo] ?? 0}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {mostra("evolucao") ? (
            <Card className="break-inside-avoid">
              <CardHeader>
                <CardTitle>Entrada de leads por semana</CardTitle>
              </CardHeader>
              <CardContent>
                <Evolucao semanas={dados.semanas} geradoEm={dados.geradoEm} />
                <p className="mt-3 text-xs text-muted-foreground">
                  Leads atuais da base, pela semana em que entraram — últimas 12
                  semanas.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {mostra("quentes") ? (
            // min-w-0: item de grid herda o min-content da TABELA lá dentro e
            // alargaria a página inteira no mobile; com ele, quem rola é o
            // contêiner da tabela, como nas outras telas.
            <Card className="min-w-0 break-inside-avoid">
              <CardHeader>
                <CardTitle>Leads mais quentes</CardTitle>
              </CardHeader>
              {dados.topLeads.length === 0 ? (
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Nenhum lead pontuado ainda.
                  </p>
                </CardContent>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lead</TableHead>
                      <TableHead>Pontuação</TableHead>
                      <TableHead>Qualificação</TableHead>
                      <TableHead>Etapa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dados.topLeads.map((l) => {
                      const q = qualificacaoDe(l.qualification);
                      return (
                        <TableRow key={l.id}>
                          <TableCell>
                            <Link
                              href={`/leads/${l.id}`}
                              className="font-medium hover:underline"
                            >
                              {l.name}
                            </Link>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {l.email}
                            </p>
                          </TableCell>
                          <TableCell>
                            <BarraDeCalor
                              score={l.score}
                              faixa={l.faixa}
                              limiarMorno={dados.config.faixaMorno}
                              limiarAquecido={dados.config.faixaAquecido}
                              limiarQuente={dados.config.faixaQuente}
                            />
                            {faixaInfo(l.faixa) ? (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {faixaInfo(l.faixa)!.rotulo}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {q ? (
                              <Badge variant={varianteDaQualificacao(q)}>
                                {q.label}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                sem qualificação
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {rotuloDaEtapa(l.stage)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
