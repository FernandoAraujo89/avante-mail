"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CloudOff, Loader2 } from "lucide-react";

import { FormularioPesquisa, type Respostas } from "@/components/pesquisas/formulario-pesquisa";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SurveyAnswerValue } from "@/lib/db/schema";
import { aceitaResposta } from "@/lib/pesquisas/convites";
import type { ConviteCarregado } from "@/lib/pesquisas/resposta-publica";
import { progresso } from "@/lib/pesquisas/respostas";

// A página do parceiro. Cada resposta é gravada sozinha, pouco depois de
// mudar: ele pode fechar o link e voltar outro dia que encontra tudo. O
// "Concluir" só trava a edição — não é o que salva.

const ATRASO_MS = 600;

type Gravacao = "parado" | "salvando" | "salvo" | "erro";

export function PaginaDeResposta({
  token,
  convite,
}: {
  token: string;
  convite: ConviteCarregado;
}) {
  const [respostas, setRespostas] = useState<Respostas>(convite.answers);
  const [concluido, setConcluido] = useState(convite.invite.status === "completed");
  const [agradecimento, setAgradecimento] = useState(convite.survey.thanks);
  const [gravacao, setGravacao] = useState<Gravacao>("parado");
  const [erroGeral, setErroGeral] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [concluindo, setConcluindo] = useState(false);

  // Gravações agendadas por pergunta: a última mudança vence, e "Concluir"
  // espera todas antes de seguir.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const emVoo = useRef(new Map<string, Promise<void>>());

  const enviar = useCallback(
    async (perguntaId: string, valor: SurveyAnswerValue | null) => {
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
    [token]
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

  async function concluir() {
    setConcluindo(true);
    setErroGeral("");
    try {
      await esvaziar();
      const res = await fetch(`/api/pesquisa/${token}/concluir`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const faltam: string[] = Array.isArray(json.faltam) ? json.faltam : [];
        if (faltam.length > 0) {
          setErros(Object.fromEntries(faltam.map((id) => [id, "Responda esta pergunta para concluir."])));
          document
            .getElementById(`pergunta-${faltam[0]}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        throw new Error(json.error ?? "Não foi possível concluir.");
      }
      setAgradecimento(json.thanks ?? convite.survey.thanks);
      setConcluido(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setErroGeral(err instanceof Error ? err.message : String(err));
    } finally {
      setConcluindo(false);
    }
  }

  const p = useMemo(() => progresso(convite.questions, respostas), [convite.questions, respostas]);
  const pct = p.total === 0 ? 0 : Math.round((p.respondidas / p.total) * 100);
  const fechada = !concluido && (!convite.survey.ativa || !aceitaResposta(convite.invite.status));

  if (concluido) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success-dark" aria-hidden />
          <h1 className="mt-3 text-xl font-bold">Respostas enviadas</h1>
          <p className="mt-2 text-sm whitespace-pre-line text-muted-foreground">
            {agradecimento ?? "Obrigado por responder!"}
          </p>
        </Card>
        <Card className="p-5 sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Suas respostas</h2>
          <FormularioPesquisa perguntas={convite.questions} respostas={respostas} somenteLeitura />
        </Card>
      </div>
    );
  }

  if (fechada) {
    return (
      <Card className="p-6 text-center">
        <h1 className="text-xl font-bold">Pesquisa encerrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Esta pesquisa não recebe mais respostas. Se precisar, fale com a equipe da Avante.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-28">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{convite.survey.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pesquisa para <strong className="text-foreground">{convite.contact.name}</strong>
          {convite.contact.company ? ` · ${convite.contact.company}` : ""}
        </p>
        {convite.survey.intro ? (
          <p className="mt-4 text-sm whitespace-pre-line">{convite.survey.intro}</p>
        ) : null}
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>
            {p.respondidas} de {p.total} respondidas
          </span>
          <span>{pct}%</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Progresso da pesquisa"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <Card className="p-5 sm:p-6">
        <FormularioPesquisa
          perguntas={convite.questions}
          respostas={respostas}
          onResposta={responder}
          erros={erros}
        />
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            {gravacao === "salvando" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Salvando...
              </>
            ) : gravacao === "salvo" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-success-dark" aria-hidden /> Salvo — pode voltar depois
              </>
            ) : gravacao === "erro" ? (
              <>
                <CloudOff className="h-3.5 w-3.5 text-destructive" aria-hidden /> {erroGeral || "Não salvou"}
              </>
            ) : (
              "Suas respostas são salvas automaticamente"
            )}
          </p>
          <Button onClick={concluir} disabled={concluindo}>
            {concluindo ? "Concluindo..." : "Concluir"}
          </Button>
        </div>
        {erroGeral && gravacao !== "erro" ? (
          <p className="mx-auto w-full max-w-xl px-4 pb-3 text-xs text-destructive">{erroGeral}</p>
        ) : null}
      </div>
    </div>
  );
}
