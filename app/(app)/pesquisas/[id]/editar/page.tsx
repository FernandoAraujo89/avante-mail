"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Eye, Heading, Plus, Save } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import {
  EditorPergunta,
  type PerguntaLocal,
} from "@/components/pesquisas/editor-pergunta";
import {
  FormularioPesquisa,
  type Respostas,
} from "@/components/pesquisas/formulario-pesquisa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import type { SurveyAnswerValue, SurveyStatus } from "@/lib/db/schema";
import { modeloTemLinkDinamico } from "@/lib/pesquisas/whatsapp";
import {
  extractVariables,
  type WhatsAppButton,
  type WhatsAppTemplateStatus,
  type WhatsAppVariableMap,
  type WhatsAppVariableSource,
} from "@/lib/whatsapp/types";
import { assuntoPadrao, corpoPadrao } from "@/lib/pesquisas/mensagens";
import { opcoesPadrao } from "@/lib/pesquisas/perguntas";
import { progresso } from "@/lib/pesquisas/respostas";
import {
  OBJETIVO_LABEL,
  STATUS_LABEL,
  type PesquisaDto,
} from "@/lib/pesquisas/rotulos";

const STATUS_VARIANT: Record<SurveyStatus, "secondary" | "success" | "warning"> = {
  draft: "secondary",
  active: "success",
  closed: "warning",
};

/** O que a tela precisa de um modelo de WhatsApp para o convite. */
type ModeloDto = {
  id: string;
  name: string;
  status: WhatsAppTemplateStatus;
  bodyText: string;
  buttons: WhatsAppButton[] | null;
};

const SEM_MODELO = "__nenhum__";

function chaveNova(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `nova-${Date.now()}-${Math.random()}`;
}

/** O que vai para a API, sem a chave local. */
function paraEnvio(perguntas: PerguntaLocal[]) {
  return perguntas.map((p) => ({
    id: p.id,
    type: p.type,
    label: p.label,
    help: p.help,
    required: p.required,
    options: p.options,
    isNps: p.isNps,
  }));
}

export default function EditarPesquisaPage() {
  const { id } = useParams<{ id: string }>();

  const [pesquisa, setPesquisa] = useState<PesquisaDto | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const [nome, setNome] = useState("");
  const [intro, setIntro] = useState("");
  const [agradecimento, setAgradecimento] = useState("");
  const [assuntoEmail, setAssuntoEmail] = useState("");
  const [corpoEmail, setCorpoEmail] = useState("");
  const [modelos, setModelos] = useState<ModeloDto[]>([]);
  const [modeloId, setModeloId] = useState<string>(SEM_MODELO);
  const [variaveis, setVariaveis] = useState<WhatsAppVariableMap>({});
  const [perguntas, setPerguntas] = useState<PerguntaLocal[]>([]);
  const [salvando, setSalvando] = useState(false);

  const [previa, setPrevia] = useState(false);
  const [respostasPrevia, setRespostasPrevia] = useState<Respostas>({});

  const aplicar = useCallback((p: PesquisaDto) => {
    setPesquisa(p);
    setNome(p.name);
    setIntro(p.intro ?? "");
    setAgradecimento(p.thanks ?? "");
    setAssuntoEmail(p.emailSubject ?? "");
    setCorpoEmail(p.emailBody ?? "");
    setModeloId(p.whatsappTemplateId ?? SEM_MODELO);
    setVariaveis(p.whatsappVariables ?? {});
    setPerguntas(
      p.questions.map((q) => ({
        chave: q.id,
        id: q.id,
        type: q.type,
        label: q.label,
        help: q.help ?? "",
        required: q.required,
        options: q.options,
        isNps: q.isNps,
        answerCount: q.answerCount,
      }))
    );
  }, []);

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch(`/api/pesquisas/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar a pesquisa.");
      aplicar(json);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, [id, aplicar]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Os modelos da WABA, para o convite por WhatsApp.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/whatsapp-templates");
        if (res.ok) {
          const lista = (await res.json()) as ModeloDto[];
          setModelos(Array.isArray(lista) ? lista : []);
        }
      } catch {
        // sem a lista, o seletor fica vazio e a tela avisa
      }
    })();
  }, []);

  // "Sujo" = difere do que foi carregado. Guia o botão Salvar e o aviso ao sair.
  const sujo = useMemo(() => {
    if (!pesquisa) return false;
    const original = JSON.stringify({
      nome: pesquisa.name,
      intro: pesquisa.intro ?? "",
      thanks: pesquisa.thanks ?? "",
      emailSubject: pesquisa.emailSubject ?? "",
      emailBody: pesquisa.emailBody ?? "",
      whatsappTemplateId: pesquisa.whatsappTemplateId ?? SEM_MODELO,
      whatsappVariables: pesquisa.whatsappVariables ?? {},
      perguntas: paraEnvio(
        pesquisa.questions.map((q) => ({
          chave: q.id,
          id: q.id,
          type: q.type,
          label: q.label,
          help: q.help ?? "",
          required: q.required,
          options: q.options,
          isNps: q.isNps,
          answerCount: q.answerCount,
        }))
      ),
    });
    const atual = JSON.stringify({
      nome,
      intro,
      thanks: agradecimento,
      emailSubject: assuntoEmail,
      emailBody: corpoEmail,
      whatsappTemplateId: modeloId,
      whatsappVariables: modeloId === SEM_MODELO ? {} : variaveis,
      perguntas: paraEnvio(perguntas),
    });
    return original !== atual;
  }, [pesquisa, nome, intro, agradecimento, assuntoEmail, corpoEmail, modeloId, variaveis, perguntas]);

  useEffect(() => {
    if (!sujo) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  function alterar(chave: string, patch: Partial<PerguntaLocal>) {
    setPerguntas((lista) =>
      lista.map((p) => (p.chave === chave ? { ...p, ...patch } : p))
    );
  }

  function mover(chave: string, direcao: -1 | 1) {
    setPerguntas((lista) => {
      const i = lista.findIndex((p) => p.chave === chave);
      const j = i + direcao;
      if (i < 0 || j < 0 || j >= lista.length) return lista;
      const copia = [...lista];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
  }

  function adicionar(type: PerguntaLocal["type"]) {
    setPerguntas((lista) => [
      ...lista,
      {
        chave: chaveNova(),
        id: null,
        type,
        label: "",
        help: "",
        required: false,
        options: opcoesPadrao(type),
        isNps: false,
        answerCount: 0,
      },
    ]);
  }

  async function salvar() {
    setSalvando(true);
    setErro("");
    setAviso("");
    try {
      const resCampos = await fetch(`/api/pesquisas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nome,
          intro,
          thanks: agradecimento,
          emailSubject: assuntoEmail,
          emailBody: corpoEmail,
          whatsappTemplateId: modeloId === SEM_MODELO ? null : modeloId,
          whatsappVariables: modeloId === SEM_MODELO ? null : variaveis,
        }),
      });
      const jsonCampos = await resCampos.json();
      if (!resCampos.ok) throw new Error(jsonCampos.error ?? "Erro ao salvar.");

      const resPerguntas = await fetch(`/api/pesquisas/${id}/perguntas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: paraEnvio(perguntas) }),
      });
      const jsonPerguntas = await resPerguntas.json();
      if (!resPerguntas.ok) throw new Error(jsonPerguntas.error ?? "Erro ao salvar as perguntas.");
      aplicar(jsonPerguntas);
      setAviso("Pesquisa salva.");
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  async function mudarStatus(status: SurveyStatus) {
    setErro("");
    setAviso("");
    try {
      const res = await fetch(`/api/pesquisas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao atualizar a pesquisa.");
      aplicar(json);
      setAviso(`Pesquisa ${STATUS_LABEL[json.status as SurveyStatus].toLowerCase()}.`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }

  const modelo = modelos.find((m) => m.id === modeloId) ?? null;
  const indicesDoModelo = modelo ? extractVariables(modelo.bodyText) : [];

  function definirFonte(n: number, tipo: "name" | "company" | "static") {
    setVariaveis((atual) => {
      const chave = String(n);
      const anterior = atual[chave];
      const fonte: WhatsAppVariableSource =
        tipo === "static"
          ? { source: "static", value: anterior?.source === "static" ? (anterior.value ?? "") : "" }
          : { source: tipo };
      return { ...atual, [chave]: fonte };
    });
  }

  // A pré-visualização usa a lista local: o que ainda não foi salvo também
  // aparece. Pergunta nova usa a chave como id, só para o React.
  const perguntasDaPrevia = perguntas.map((p) => ({
    id: p.chave,
    type: p.type,
    label: p.label || (p.type === "section" ? "Seção sem título" : "Pergunta sem enunciado"),
    help: p.help || null,
    required: p.required,
    options: p.options,
  }));
  const progressoPrevia = progresso(perguntasDaPrevia, respostasPrevia);

  let numero = 0;

  if (!pesquisa && !erro) {
    return (
      <Card>
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando pesquisa...</p>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/pesquisas">
            <ArrowLeft />
            Voltar para pesquisas
          </Link>
        </Button>
        {pesquisa ? (
          <PageHeader
            title={pesquisa.name}
            description={`${OBJETIVO_LABEL[pesquisa.objective]} · ${pesquisa.inviteCount} convidado${
              pesquisa.inviteCount === 1 ? "" : "s"
            } · ${pesquisa.completedCount} concluída${pesquisa.completedCount === 1 ? "" : "s"}`}
          >
            <Badge variant={STATUS_VARIANT[pesquisa.status]}>{STATUS_LABEL[pesquisa.status]}</Badge>
            <Button variant="outline" onClick={() => setPrevia(true)}>
              <Eye />
              Pré-visualizar
            </Button>
            {pesquisa.status === "draft" ? (
              <Button variant="outline" disabled={sujo} onClick={() => mudarStatus("active")}>
                Ativar
              </Button>
            ) : pesquisa.status === "active" ? (
              <Button variant="outline" disabled={sujo} onClick={() => mudarStatus("closed")}>
                Encerrar
              </Button>
            ) : (
              <Button variant="outline" disabled={sujo} onClick={() => mudarStatus("active")}>
                Reabrir
              </Button>
            )}
            <Button onClick={salvar} disabled={salvando || !sujo}>
              <Save />
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </PageHeader>
        ) : null}
      </div>

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
      {sujo && pesquisa ? (
        <p className="mb-4 text-xs text-muted-foreground">
          Há alterações não salvas. Ativar, encerrar e reabrir ficam disponíveis depois de salvar.
        </p>
      ) : null}

      {pesquisa ? (
        <div className="grid gap-6">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">A pesquisa</h2>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="pesquisa-nome">Nome</Label>
                <Input
                  id="pesquisa-nome"
                  value={nome}
                  maxLength={120}
                  onChange={(e) => setNome(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pesquisa-intro">
                  Texto de abertura{" "}
                  <span className="font-normal text-muted-foreground">
                    (o parceiro lê antes das perguntas)
                  </span>
                </Label>
                <Textarea
                  id="pesquisa-intro"
                  rows={3}
                  value={intro}
                  maxLength={2000}
                  onChange={(e) => setIntro(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pesquisa-thanks">
                  Agradecimento{" "}
                  <span className="font-normal text-muted-foreground">(depois de concluir)</span>
                </Label>
                <Textarea
                  id="pesquisa-thanks"
                  rows={2}
                  value={agradecimento}
                  maxLength={1000}
                  onChange={(e) => setAgradecimento(e.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="mb-1 text-sm font-semibold text-muted-foreground">Convite por e-mail</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              O botão &quot;Responder pesquisa&quot; com o link de cada parceiro entra sozinho no fim.
              Pode usar {"{{nome}}"}, {"{{empresa}}"} e {"{{pesquisa}}"}. Em branco, vale o texto padrão.
            </p>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pesquisa-email-assunto">Assunto</Label>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => setAssuntoEmail(assuntoPadrao(nome || "Pesquisa"))}
                  >
                    Usar o padrão
                  </Button>
                </div>
                <Input
                  id="pesquisa-email-assunto"
                  value={assuntoEmail}
                  maxLength={150}
                  placeholder={assuntoPadrao(nome || "Pesquisa")}
                  onChange={(e) => setAssuntoEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pesquisa-email-corpo">Texto</Label>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => setCorpoEmail(corpoPadrao())}
                  >
                    Usar o padrão
                  </Button>
                </div>
                <Textarea
                  id="pesquisa-email-corpo"
                  rows={6}
                  value={corpoEmail}
                  maxLength={3000}
                  placeholder={corpoPadrao()}
                  onChange={(e) => setCorpoEmail(e.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="mb-1 text-sm font-semibold text-muted-foreground">Convite por WhatsApp</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Sai pelo número Avante Expansão com um modelo aprovado pela Meta que tenha um botão de
              link terminando em {"{{1}}"} — é por ele que vai o link de cada parceiro.
            </p>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="pesquisa-modelo">Modelo</Label>
                <Select value={modeloId} onValueChange={setModeloId}>
                  <SelectTrigger id="pesquisa-modelo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_MODELO}>Sem convite por WhatsApp</SelectItem>
                    {modelos.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                        {m.status !== "approved"
                          ? " (não aprovado)"
                          : modeloTemLinkDinamico(m.buttons)
                            ? ""
                            : " (sem botão de link dinâmico)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pesquisa.whatsapp && !pesquisa.whatsapp.pronto && modeloId !== SEM_MODELO && !sujo ? (
                  <p className="text-xs text-warning-dark">{pesquisa.whatsapp.motivo}</p>
                ) : null}
              </div>
              {modelo ? (
                <div className="grid gap-3">
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-line">{modelo.bodyText}</p>
                  {indicesDoModelo.length > 0 ? (
                    <div className="grid gap-2">
                      {indicesDoModelo.map((n) => {
                        const fonte = variaveis[String(n)];
                        return (
                          <div key={n} className="grid gap-2 sm:grid-cols-[6rem_12rem_minmax(0,1fr)] sm:items-center">
                            <Label htmlFor={`var-${n}`}>{`{{${n}}}`}</Label>
                            <Select
                              value={fonte?.source ?? ""}
                              onValueChange={(v) => definirFonte(n, v as "name" | "company" | "static")}
                            >
                              <SelectTrigger id={`var-${n}`}>
                                <SelectValue placeholder="Escolha a fonte" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="name">Nome do parceiro</SelectItem>
                                <SelectItem value="company">Empresa do parceiro</SelectItem>
                                <SelectItem value="static">Texto fixo</SelectItem>
                              </SelectContent>
                            </Select>
                            {fonte?.source === "static" ? (
                              <Input
                                aria-label={`Texto fixo de {{${n}}}`}
                                value={fonte.value ?? ""}
                                onChange={(e) =>
                                  setVariaveis((atual) => ({
                                    ...atual,
                                    [String(n)]: { source: "static", value: e.target.value },
                                  }))
                                }
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>

          <section aria-labelledby="perguntas-titulo">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="perguntas-titulo" className="text-sm font-semibold text-muted-foreground">
                Perguntas ({perguntasDaPrevia.filter((p) => p.type !== "section").length})
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => adicionar("section")}>
                  <Heading />
                  Adicionar seção
                </Button>
                <Button size="sm" onClick={() => adicionar("short_text")}>
                  <Plus />
                  Adicionar pergunta
                </Button>
              </div>
            </div>

            {perguntas.length === 0 ? (
              <Card>
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nenhuma pergunta ainda. Adicione a primeira.
                </p>
              </Card>
            ) : (
              <div className="grid gap-3">
                {perguntas.map((p, i) => {
                  if (p.type !== "section") numero += 1;
                  return (
                    <EditorPergunta
                      key={p.chave}
                      pergunta={p}
                      numero={p.type === "section" ? null : numero}
                      ehPrimeira={i === 0}
                      ehUltima={i === perguntas.length - 1}
                      onChange={(patch) => alterar(p.chave, patch)}
                      onMover={(direcao) => mover(p.chave, direcao)}
                      onRemover={() =>
                        setPerguntas((lista) => lista.filter((q) => q.chave !== p.chave))
                      }
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}

      <Dialog open={previa} onOpenChange={setPrevia}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{nome || "Pesquisa"}</DialogTitle>
            <DialogDescription>
              É assim que o parceiro vê. Pode responder aqui para testar — nada é gravado.
            </DialogDescription>
          </DialogHeader>
          {intro ? <p className="text-sm whitespace-pre-line">{intro}</p> : null}
          <p className="text-xs text-muted-foreground">
            {progressoPrevia.respondidas} de {progressoPrevia.total} respondidas
          </p>
          <FormularioPesquisa
            perguntas={perguntasDaPrevia}
            respostas={respostasPrevia}
            onResposta={(pid: string, valor: SurveyAnswerValue | null) =>
              setRespostasPrevia((r) => ({ ...r, [pid]: valor }))
            }
          />
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <Button disabled>Concluir (na página real)</Button>
            {agradecimento ? (
              <p className="text-xs text-muted-foreground">Ao concluir: &quot;{agradecimento}&quot;</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
