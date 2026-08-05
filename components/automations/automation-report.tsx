import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  Pencil,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { AutomationStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  contatosDaAutomacao,
  relatorioDaAutomacao,
  type MetricaDoPasso,
} from "@/lib/automations/relatorio";
import { automations, getDb, lists, templates, whatsappTemplates } from "@/lib/db";
import { listarEtapas } from "@/lib/leads/etapas";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { resumoDoPasso, STEP_LABEL, type Catalogo } from "./labels";

// Relatório da automação (fase 5): o que já aconteceu e ONDE os contatos estão
// agora. A pergunta "quantos estão em cada etapa" é a que a tela responde
// primeiro — é o que diz se o fluxo está andando ou preso em algum ponto.

const RUN_STATUS: Record<
  string,
  { label: string; variant: "secondary" | "info" | "success" | "warning" | "destructive" }
> = {
  running: { label: "Em andamento", variant: "info" },
  waiting: { label: "Aguardando", variant: "warning" },
  done: { label: "Concluído", variant: "success" },
  stopped: { label: "Parado", variant: "secondary" },
  failed: { label: "Falhou", variant: "destructive" },
};

function pct(parte: number, total: number): string {
  if (total <= 0) return "—";
  return `${((parte / total) * 100).toFixed(1).replace(".", ",")}%`;
}

function moeda(usd: number, brl: number): string {
  return `US$ ${usd.toFixed(4)} · R$ ${brl.toFixed(2).replace(".", ",")}`;
}

/** Nome do ramo a que o passo pertence, para a tabela não virar sopa de linhas. */
function caminhoDoPasso(passo: MetricaDoPasso): string | null {
  if (!passo.parentId) return null;
  return passo.branch === "yes" ? "Sim" : "Não";
}

export async function AutomationReport({ id }: { id: string }) {
  const db = getDb();

  const [automacao] = await db
    .select()
    .from(automations)
    .where(eq(automations.id, id));
  if (!automacao) notFound();

  const relatorio = await relatorioDaAutomacao(id);
  if (!relatorio) notFound();

  const pessoas = await contatosDaAutomacao(id);

  // Nomes para os resumos dos passos (lista, modelo de e-mail e de WhatsApp).
  const catalogo: Catalogo = {
    lists: await db.select({ id: lists.id, name: lists.name }).from(lists),
    templates: await db
      .select({ id: templates.id, name: templates.name })
      .from(templates),
    waTemplates: await db
      .select({ id: whatsappTemplates.id, name: whatsappTemplates.name })
      .from(whatsappTemplates),
    etapas: await listarEtapas(true),
  };

  const { resumo, passos } = relatorio;
  const noFluxo = resumo.noFluxo;
  const maiorFila = Math.max(1, ...passos.map((p) => p.agora));
  const nomeDoPasso = new Map(
    passos.map((p) => [p.stepId, STEP_LABEL[p.type]])
  );

  const passosDeEnvio = passos.filter((p) => p.envios !== null);

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/automations">
            <ArrowLeft />
            Voltar para automações
          </Link>
        </Button>
        <PageHeader
          title={automacao.name}
          description={
            automacao.description ??
            `Relatório da automação · versão v${relatorio.versao}`
          }
        >
          <AutomationStatusBadge status={automacao.status} />
          <Button variant="outline" asChild>
            <Link href={`/automations/${id}`}>
              <Pencil />
              Editar fluxo
            </Link>
          </Button>
        </PageHeader>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Entraram"
          value={String(resumo.entraram)}
          hint="Contatos que já iniciaram o fluxo"
          icon={UserPlus}
        />
        <MetricCard
          label="No fluxo agora"
          value={String(noFluxo)}
          hint={
            noFluxo > 0
              ? "Percorrendo os passos neste momento"
              : "Ninguém em andamento"
          }
          icon={Users}
        />
        <MetricCard
          label="Concluíram"
          value={String(resumo.concluidos)}
          hint={`${pct(resumo.concluidos, resumo.entraram)} de quem entrou`}
          icon={CheckCircle2}
        />
        <MetricCard
          label="Custo da automação"
          value={`R$ ${relatorio.custoBrl.toFixed(2).replace(".", ",")}`}
          hint={`US$ ${relatorio.custoUsd.toFixed(4)} · e-mails aceitos + WhatsApp entregue`}
          icon={Wallet}
        />
      </div>

      {resumo.parados > 0 || resumo.falhos > 0 ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {resumo.parados > 0 ? (
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <CircleSlash className="size-5 shrink-0 text-muted-foreground" />
                <p className="text-sm">
                  <span className="font-semibold">{resumo.parados}</span>{" "}
                  percurso(s) parado(s) — o contato descadastrou ou saiu da base
                  no meio do fluxo.
                </p>
              </CardContent>
            </Card>
          ) : null}
          {resumo.falhos > 0 ? (
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <TriangleAlert className="size-5 shrink-0 text-destructive" />
                <p className="text-sm">
                  <span className="font-semibold">{resumo.falhos}</span>{" "}
                  percurso(s) com falha — veja o motivo na tabela de contatos.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* ─── Onde os contatos estão agora ─────────────────────── */}
      <Card className="mt-8">
        <CardContent className="p-5 @container">
          <div className="mb-4">
            <h2 className="text-base font-semibold">Onde os contatos estão</h2>
            <p className="text-sm text-muted-foreground">
              Quantos contatos estão parados em cada passo neste momento.
              {relatorio.percursosDeOutrasVersoes > 0
                ? ` ${relatorio.percursosDeOutrasVersoes} percurso(s) entraram por versões anteriores e seguem pelo fluxo daquela versão.`
                : ""}
            </p>
          </div>

          {passos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Esta automação ainda não tem passos.
            </p>
          ) : noFluxo === 0 ? (
            <p className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              Nenhum contato em andamento agora
              {resumo.entraram > 0
                ? " — todos os que entraram já terminaram."
                : "."}
            </p>
          ) : (
            <div className="grid gap-2">
              {passos.map((passo) => {
                const ramo = caminhoDoPasso(passo);
                return (
                  <div
                    key={passo.stepId}
                    className="grid items-center gap-x-3 gap-y-1 @md:grid-cols-[1fr_8rem_3rem]"
                  >
                    <div
                      className="min-w-0"
                      // Indentação = profundidade na árvore: o ramo fica
                      // visivelmente pendurado no Se/Então que o abriu.
                      style={{ paddingLeft: `${passo.nivel * 1.25}rem` }}
                    >
                      <p className="truncate text-sm font-medium">
                        {ramo ? (
                          <Badge
                            variant={ramo === "Sim" ? "success" : "secondary"}
                            className="mr-2"
                          >
                            {ramo}
                          </Badge>
                        ) : null}
                        {STEP_LABEL[passo.type]}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {resumoDoPasso(
                          {
                            id: passo.stepId,
                            parentId: passo.parentId,
                            branch: "main",
                            position: passo.position,
                            type: passo.type,
                            config: passo.config ?? {},
                          },
                          catalogo
                        )}
                      </p>
                    </div>
                    {/* Barra proporcional à maior fila: o gargalo salta à vista. */}
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-2 rounded-full",
                          passo.agora > 0 ? "bg-primary" : "bg-transparent"
                        )}
                        style={{
                          width: `${Math.round((passo.agora / maiorFila) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-sm font-semibold @md:text-right">
                      {passo.agora}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Desempenho por passo ─────────────────────────────── */}
      <Card className="mt-6">
        <CardContent className="p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold">Desempenho por passo</h2>
            <p className="text-sm text-muted-foreground">
              O que já rodou na versão v{relatorio.versao} do fluxo.
            </p>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Passo</TableHead>
                  <TableHead className="text-right">Passaram</TableHead>
                  <TableHead className="text-right">Aqui agora</TableHead>
                  <TableHead className="text-right">Enviados</TableHead>
                  <TableHead className="text-right">Entregues</TableHead>
                  <TableHead className="text-right">Abertos</TableHead>
                  <TableHead className="text-right">Cliques</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {passos.map((passo) => {
                  const ramo = caminhoDoPasso(passo);
                  const e = passo.envios;
                  return (
                    <TableRow key={passo.stepId}>
                      <TableCell>
                        <div
                          className="flex items-center gap-2"
                          style={{ paddingLeft: `${passo.nivel * 1.25}rem` }}
                        >
                          {ramo ? (
                            <Badge
                              variant={ramo === "Sim" ? "success" : "secondary"}
                            >
                              {ramo}
                            </Badge>
                          ) : null}
                          <div className="min-w-0">
                            <p className="font-medium">
                              {STEP_LABEL[passo.type]}
                            </p>
                            <p className="max-w-64 truncate text-xs text-muted-foreground">
                              {resumoDoPasso(
                                {
                                  id: passo.stepId,
                                  parentId: passo.parentId,
                                  branch: "main",
                                  position: passo.position,
                                  type: passo.type,
                                  config: passo.config ?? {},
                                },
                                catalogo
                              )}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {passo.passaram}
                      </TableCell>
                      <TableCell className="text-right">
                        {passo.agora > 0 ? (
                          <span className="font-semibold">{passo.agora}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {e ? e.enviados : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {e
                          ? passo.type === "send_whatsapp"
                            ? e.entregues
                            : "—"
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {e ? (
                          <>
                            {e.abertos}
                            <span className="ml-1 text-xs">
                              (
                              {pct(
                                e.abertos,
                                passo.type === "send_whatsapp"
                                  ? e.entregues
                                  : e.enviados
                              )}
                              )
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {e ? e.cliques : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {passo.custoUsd > 0
                          ? `US$ ${passo.custoUsd.toFixed(4)}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {passosDeEnvio.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Base de cobrança: e-mail conta os aceitos pelo SES; WhatsApp, as
              mensagens entregues. Total da automação:{" "}
              {moeda(relatorio.custoUsd, relatorio.custoBrl)}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ─── Contatos ─────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardContent className="p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold">Contatos</h2>
            <p className="text-sm text-muted-foreground">
              Quem passou pela automação, do mais recente ao mais antigo
              {pessoas.length >= 300 ? " (300 mais recentes)" : ""}.
            </p>
          </div>

          {pessoas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum contato entrou nesta automação ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contato</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Passo atual</TableHead>
                    <TableHead>Entrou</TableHead>
                    <TableHead>Terminou</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pessoas.map((p) => {
                    const situacao = RUN_STATUS[p.status] ?? RUN_STATUS.running;
                    return (
                      <TableRow key={p.runId}>
                        <TableCell>
                          <Link
                            href={`/contacts/${p.contactId}`}
                            className="font-medium hover:underline"
                          >
                            {p.nome}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {p.email}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant={situacao.variant}>
                            {situacao.label}
                          </Badge>
                          {p.motivo ? (
                            <p className="mt-1 max-w-64 text-xs text-muted-foreground">
                              {p.motivo}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.status === "running" || p.status === "waiting"
                            ? ((p.currentStepId
                                ? nomeDoPasso.get(p.currentStepId)
                                : null) ?? "—")
                            : p.status === "done"
                              ? "—"
                              : `Parou após ${p.passosExecutados} passo(s)`}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(p.entrouEm)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.terminouEm ? formatDateTime(p.terminouEm) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
