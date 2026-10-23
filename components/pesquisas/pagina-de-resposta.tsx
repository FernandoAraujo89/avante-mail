"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CloudOff, Loader2 } from "lucide-react";

import { FormularioPesquisa, type Respostas } from "@/components/pesquisas/formulario-pesquisa";
import { IndicadorDeEtapas } from "@/components/pesquisas/indicador-de-etapas";
import { Button } from "@/components/ui/button";
import type { SurveyAnswerValue } from "@/lib/db/schema";
import { aceitaResposta } from "@/lib/pesquisas/convites";
import {
  faltamNaEtapa,
  minutosEstimados,
  montarEtapas,
  primeiraEtapaPendente,
} from "@/lib/pesquisas/etapas";
import type { ConviteCarregado } from "@/lib/pesquisas/resposta-publica";
import { progresso } from "@/lib/pesquisas/respostas";
import { OBJETIVO_CONVITE } from "@/lib/pesquisas/rotulos";

// A coluna branca da página do parceiro, em etapas: boas-vindas, as perguntas
// (por seção) e a conclusão. Cada resposta é gravada sozinha pouco depois de
// mudar — ele pode fechar o link e voltar outro dia que encontra tudo. O
// "Concluir" só trava a edição; não é o que salva.

const ATRASO_MS = 600;

type Gravacao = "parado" | "salvando" | "salvo" | "erro";

export function PaginaDeResposta({
  token,
  convite,
  modoPrevia = false,
}: {
  token: string;
  convite: ConviteCarregado;
  /**
   * Pré-visualização da Expansão (/pesquisa/previa/[id]): mesma tela, mas
   * nada vai ao servidor — as respostas ficam na memória e "Concluir" só
   * confere as obrigatórias e mostra o agradecimento. Padrão: desligado.
   */
  modoPrevia?: boolean;
}) {
  const etapas = useMemo(() => montarEtapas(convite.questions), [convite.questions]);
  // 0 = boas-vindas; 1..n = perguntas; n+1 = concluído.
  const ultimaEtapa = etapas.length + 1;

  const [respostas, setRespostas] = useState<Respostas>(convite.answers);
  const [etapa, setEtapa] = useState(convite.invite.status === "completed" ? ultimaEtapa : 0);
  const [agradecimento, setAgradecimento] = useState(convite.survey.thanks);
  const [gravacao, setGravacao] = useState<Gravacao>("parado");
  const [erroGeral, setErroGeral] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const topo = useRef<HTMLDivElement>(null);

  // Gravações agendadas por pergunta: a última mudança vence, e "Continuar"
  // espera todas antes de seguir.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const emVoo = useRef(new Map<string, Promise<void>>());

  const enviar = useCallback(
    async (perguntaId: string, valor: SurveyAnswerValue | null) => {
      // Prévia: a resposta já está no estado; só mostra "Salvo", como na vida real.
      if (modoPrevia) {
        setGravacao("salvo");
        return;
      }
      setGravacao("salvando");
      const promessa = (async () => {
        try {
          const res = await fetch(`/api/pesquisa/${token}/respostas/${perguntaId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ valor }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar.");
          setErros((e) => {
            if (!e[perguntaId]) return e;
            const copia = { ...e };
            delete copia[perguntaId];
            return copia;
          });
          setErroGeral("");
        } catch (err) {
          setGravacao("erro");
          setErroGeral(
            err instanceof Error ? err.message : "Sem conexão — a última resposta não foi salva."
          );
          throw err;
        } finally {
          emVoo.current.delete(perguntaId);
          if (emVoo.current.size === 0) {
            setGravacao((g) => (g === "erro" ? g : "salvo"));
          }
        }
      })();
      emVoo.current.set(perguntaId, promessa.catch(() => {}));
      await promessa.catch(() => {});
    },
    [token, modoPrevia]
  );

  const responder = useCallback(
    (perguntaId: string, valor: SurveyAnswerValue | null) => {
      setRespostas((r) => ({ ...r, [perguntaId]: valor }));
      const anterior = timers.current.get(perguntaId);
      if (anterior) clearTimeout(anterior);
      timers.current.set(
        perguntaId,
        setTimeout(() => {
          timers.current.delete(perguntaId);
          void enviar(perguntaId, valor);
        }, ATRASO_MS)
      );
    },
    [enviar]
  );

  useEffect(() => {
    const atuais = timers.current;
    return () => atuais.forEach((t) => clearTimeout(t));
  }, []);

  /** Dispara o que está agendado e espera o que está no ar. */
  async function esvaziar() {
    for (const [perguntaId, timer] of timers.current) {
      clearTimeout(timer);
      timers.current.delete(perguntaId);
      void enviar(perguntaId, respostas[perguntaId] ?? null);
    }
    await Promise.all([...emVoo.current.values()]);
  }

  function irPara(n: number) {
    setEtapa(n);
    setErros({});
    setErroGeral("");
    topo.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function marcarFaltantes(ids: string[]) {
    setErros(Object.fromEntries(ids.map((id) => [id, "Responda esta pergunta para continuar."])));
    setErroGeral(
      ids.length === 1
        ? "Falta responder uma pergunta obrigatória nesta etapa."
        : `Faltam ${ids.length} perguntas obrigatórias nesta etapa.`
    );
    document.getElementById(`pergunta-${ids[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function continuar() {
    const atual = etapas[etapa - 1];
    if (!atual) return;
    setOcupado(true);
    try {
      await esvaziar();
      const faltam = faltamNaEtapa(atual, respostas);
      if (faltam.length > 0) {
        marcarFaltantes(faltam);
        return;
      }
      if (etapa < etapas.length) {
        irPara(etapa + 1);
        return;
      }
      await concluir();
    } finally {
      setOcupado(false);
    }
  }

  async function concluir() {
    setErroGeral("");
    if (modoPrevia) {
      // A mesma regra do servidor (todas as obrigatórias), sem gravar nada.
      const faltam = progresso(convite.questions, respostas).faltamObrigatorias;
      if (faltam.length > 0) {
        const i = etapas.findIndex((e) => e.perguntas.some((p) => faltam.includes(p.id)));
        if (i >= 0 && i + 1 !== etapa) irPara(i + 1);
        setTimeout(() => marcarFaltantes(faltam), 50);
        return;
      }
      setAgradecimento(convite.survey.thanks);
      irPara(ultimaEtapa);
      return;
    }
    const res = await fetch(`/api/pesquisa/${token}/concluir`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const faltam: string[] = Array.isArray(json.faltam) ? json.faltam : [];
      if (faltam.length > 0) {
        // Obrigatória de outra etapa: leva a pessoa até ela.
        const i = etapas.findIndex((e) => e.perguntas.some((p) => faltam.includes(p.id)));
        if (i >= 0 && i + 1 !== etapa) irPara(i + 1);
        setTimeout(() => marcarFaltantes(faltam), 50);
        return;
      }
      setErroGeral(json.error ?? "Não foi possível concluir.");
      return;
    }
    setAgradecimento(json.thanks ?? convite.survey.thanks);
    irPara(ultimaEtapa);
  }

  const p = useMemo(() => progresso(convite.questions, respostas), [convite.questions, respostas]);
  const concluido = etapa === ultimaEtapa;
  const fechada = !concluido && (!convite.survey.ativa || !aceitaResposta(convite.invite.status));
  const rotulos = ["Início", ...etapas.map((e) => e.titulo), "Conclusão"];

  if (fechada) {
    return (
      <div className="my-auto">
        <h2 className="text-2xl font-normal tracking-tight">Pesquisa encerrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Esta pesquisa não recebe mais respostas. Se precisar, fale com a equipe da Avante.
        </p>
      </div>
    );
  }

  return (
    <div ref={topo} className="flex min-h-full flex-col">
      <div className="mb-8">
        <IndicadorDeEtapas total={rotulos.length} atual={etapa} rotulos={rotulos} />
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {concluido
            ? "Concluída"
            : `${rotulos[etapa]} · ${p.respondidas} de ${p.total} respondidas`}
        </p>
      </div>

      {etapa === 0 ? (
        <BoasVindas
          convite={convite}
          respondidas={p.respondidas}
          total={p.total}
          onComecar={() =>
            irPara(p.respondidas > 0 ? primeiraEtapaPendente(etapas, respostas) + 1 : 1)
          }
          semPerguntas={etapas.length === 0}
        />
      ) : concluido ? (
        <Conclusao convite={convite} respostas={respostas} agradecimento={agradecimento} />
      ) : (
        <div className="flex flex-1 flex-col">
          <h2 className="text-2xl font-normal tracking-tight">{etapas[etapa - 1].titulo}</h2>
          {etapas[etapa - 1].descricao ? (
            <p className="mt-1 text-sm text-muted-foreground">{etapas[etapa - 1].descricao}</p>
          ) : null}

          <div className="mt-6">
            <FormularioPesquisa
              perguntas={etapas[etapa - 1].perguntas}
              respostas={respostas}
              onResposta={responder}
              erros={erros}
              numeroInicial={etapas[etapa - 1].numeroInicial}
            />
          </div>

          {erroGeral ? <p className="mt-4 text-sm text-destructive">{erroGeral}</p> : null}

          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-3 sm:justify-start">
              <Button type="button" variant="ghost" className="font-medium" onClick={() => irPara(etapa - 1)} disabled={ocupado}>
                <ArrowLeft />
                Voltar
              </Button>
              <EstadoDaGravacao gravacao={gravacao} erro={erroGeral} />
            </div>
            <Button type="button" onClick={continuar} disabled={ocupado} className="font-medium sm:min-w-44">
              {ocupado ? "Aguarde..." : etapa < etapas.length ? "Continuar" : "Concluir"}
              {!ocupado ? <ArrowRight /> : null}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EstadoDaGravacao({ gravacao, erro }: { gravacao: Gravacao; erro: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      {gravacao === "salvando" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Salvando...
        </>
      ) : gravacao === "salvo" ? (
        <>
          <CheckCircle2 className="size-3.5 text-success-dark" aria-hidden /> Salvo
        </>
      ) : gravacao === "erro" ? (
        <>
          <CloudOff className="size-3.5 text-destructive" aria-hidden /> {erro || "Não salvou"}
        </>
      ) : (
        "Salvamento automático"
      )}
    </p>
  );
}

function BoasVindas({
  convite,
  respondidas,
  total,
  onComecar,
  semPerguntas,
}: {
  convite: ConviteCarregado;
  respondidas: number;
  total: number;
  onComecar: () => void;
  semPerguntas: boolean;
}) {
  const retomando = respondidas > 0 && respondidas < total;
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-2xl font-normal tracking-tight">
        {retomando ? "Bem-vindo de volta" : "Vamos começar"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Olá, <strong className="font-medium text-foreground">{convite.contact.name}</strong>
        {convite.contact.company ? ` · ${convite.contact.company}` : ""}
      </p>

      <p className="mt-6 max-w-prose text-sm leading-relaxed whitespace-pre-line">
        {convite.survey.intro ?? OBJETIVO_CONVITE[convite.survey.objective]}
      </p>

      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Perguntas</dt>
          <dd className="mt-0.5 text-lg font-normal tabular-nums">{total}</dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Tempo estimado</dt>
          <dd className="mt-0.5 text-lg font-normal tabular-nums">~{minutosEstimados(total)} min</dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Pode parar e voltar</dt>
          <dd className="mt-0.5 text-sm font-normal">Suas respostas ficam salvas</dd>
        </div>
      </dl>

      {retomando ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Você já respondeu {respondidas} de {total}. Continue de onde parou.
        </p>
      ) : null}

      <div className="mt-8 border-t border-border pt-5">
        <Button type="button" onClick={onComecar} disabled={semPerguntas} className="w-full font-medium sm:w-auto sm:min-w-44">
          {retomando ? "Continuar de onde parei" : "Começar"}
          <ArrowRight />
        </Button>
        {semPerguntas ? (
          <p className="mt-2 text-xs text-muted-foreground">Esta pesquisa ainda não tem perguntas.</p>
        ) : null}
      </div>
    </div>
  );
}

function Conclusao({
  convite,
  respostas,
  agradecimento,
}: {
  convite: ConviteCarregado;
  respostas: Respostas;
  agradecimento: string | null;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex size-12 items-center justify-center rounded-full bg-success/15">
        <CheckCircle2 className="size-7 text-success-dark" aria-hidden />
      </div>
      <h2 className="mt-4 text-2xl font-normal tracking-tight">Respostas enviadas</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
        {agradecimento ?? "Obrigado por responder!"}
      </p>

      <details className="group mt-8 border-t border-border pt-5">
        <summary className="cursor-pointer text-sm font-normal text-primary underline-offset-4 hover:underline">
          Ver minhas respostas
        </summary>
        <div className="mt-4">
          <FormularioPesquisa perguntas={convite.questions} respostas={respostas} somenteLeitura />
        </div>
      </details>
    </div>
  );
}
