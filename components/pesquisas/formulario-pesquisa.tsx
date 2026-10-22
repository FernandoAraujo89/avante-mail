"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SurveyAnswerValue } from "@/lib/db/schema";
import {
  OUTRO_PREFIXO,
  type PerguntaDoFormulario,
} from "@/lib/pesquisas/respostas";
import { cn } from "@/lib/utils";

// O formulário como o parceiro o vê. Serve à página pública de resposta e à
// pré-visualização do construtor — é o mesmo componente, para o que a
// profissional vê ser exatamente o que o parceiro recebe. Feito para o
// celular primeiro: a maioria chega pelo link do WhatsApp.

export type Respostas = Record<string, SurveyAnswerValue | null | undefined>;

function escolhasDe(valor: SurveyAnswerValue | null | undefined): string[] {
  return Array.isArray(valor) ? valor : [];
}

function outroDe(escolhas: string[]): { marcado: boolean; texto: string } {
  const item = escolhas.find((e) => e.toLowerCase().startsWith(OUTRO_PREFIXO));
  return item
    ? { marcado: true, texto: item.slice(OUTRO_PREFIXO.length) }
    : { marcado: false, texto: "" };
}

const opcaoClasse =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:cursor-default";

export function FormularioPesquisa({
  perguntas,
  respostas,
  onResposta,
  somenteLeitura = false,
  erros,
}: {
  perguntas: PerguntaDoFormulario[];
  respostas: Respostas;
  onResposta?: (perguntaId: string, valor: SurveyAnswerValue | null) => void;
  somenteLeitura?: boolean;
  /** Mensagens por pergunta (ex.: obrigatória sem resposta ao concluir). */
  erros?: Record<string, string>;
}) {
  const responder = (id: string, valor: SurveyAnswerValue | null) => {
    if (!somenteLeitura) onResposta?.(id, valor);
  };

  let numero = 0;

  return (
    <div className="flex flex-col gap-6">
      {perguntas.map((p) => {
        if (p.type === "section") {
          return (
            <div key={p.id} className="border-b border-border pb-2 pt-2 first:pt-0">
              <h2 className="text-base font-semibold">{p.label}</h2>
              {p.help ? (
                <p className="mt-1 text-sm text-muted-foreground">{p.help}</p>
              ) : null}
            </div>
          );
        }

        numero += 1;
        const valor = respostas[p.id];
        const erro = erros?.[p.id];
        const o = p.options ?? {};
        const rotuloId = `pergunta-${p.id}`;

        return (
          <div key={p.id} className="flex flex-col gap-2">
            <div>
              <p id={rotuloId} className="text-sm font-medium">
                <span className="text-muted-foreground">{numero}.</span>{" "}
                {p.label}
                {p.required ? (
                  <span className="text-destructive" aria-label="obrigatória">
                    {" "}
                    *
                  </span>
                ) : null}
              </p>
              {p.help ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{p.help}</p>
              ) : null}
            </div>

            {p.type === "short_text" ? (
              <Input
                aria-labelledby={rotuloId}
                value={typeof valor === "string" ? valor : ""}
                maxLength={4000}
                disabled={somenteLeitura}
                onChange={(e) => responder(p.id, e.target.value)}
              />
            ) : null}

            {p.type === "long_text" ? (
              <Textarea
                aria-labelledby={rotuloId}
                rows={4}
                value={typeof valor === "string" ? valor : ""}
                maxLength={4000}
                disabled={somenteLeitura}
                onChange={(e) => responder(p.id, e.target.value)}
              />
            ) : null}

            {p.type === "number" ? (
              <div className="flex items-center gap-2">
                <Input
                  aria-labelledby={rotuloId}
                  type="number"
                  inputMode="decimal"
                  className="max-w-48"
                  value={typeof valor === "number" ? String(valor) : ""}
                  disabled={somenteLeitura}
                  onChange={(e) =>
                    responder(
                      p.id,
                      e.target.value === "" ? null : Number(e.target.value)
                    )
                  }
                />
                {o.unit ? (
                  <span className="text-sm text-muted-foreground">{o.unit}</span>
                ) : null}
              </div>
            ) : null}

            {p.type === "yes_no" ? (
              <div className="flex gap-2" role="group" aria-labelledby={rotuloId}>
                {(
                  [
                    [true, "Sim"],
                    [false, "Não"],
                  ] as const
                ).map(([v, rotulo]) => (
                  <button
                    key={rotulo}
                    type="button"
                    disabled={somenteLeitura}
                    aria-pressed={valor === v}
                    onClick={() => responder(p.id, valor === v ? null : v)}
                    className={cn(
                      "min-h-11 min-w-24 rounded-lg border border-border px-4 text-sm font-medium",
                      valor === v
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    )}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            ) : null}

            {p.type === "scale" ? (
              <div>
                <div
                  className="flex flex-wrap gap-1.5"
                  role="group"
                  aria-labelledby={rotuloId}
                >
                  {Array.from(
                    { length: (o.max ?? 10) - (o.min ?? 0) + 1 },
                    (_, i) => (o.min ?? 0) + i
                  ).map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={somenteLeitura}
                      aria-pressed={valor === n}
                      onClick={() => responder(p.id, valor === n ? null : n)}
                      className={cn(
                        "h-11 w-11 rounded-lg border border-border text-sm font-medium",
                        valor === n
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted"
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {o.minLabel || o.maxLabel ? (
                  <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                    <span>{o.minLabel}</span>
                    <span>{o.maxLabel}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {p.type === "single_choice" || p.type === "multiple_choice" ? (
              <EscolhasCampo
                pergunta={p}
                valor={escolhasDe(valor)}
                somenteLeitura={somenteLeitura}
                onChange={(lista) => responder(p.id, lista.length ? lista : null)}
              />
            ) : null}

            {erro ? <p className="text-xs text-destructive">{erro}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function EscolhasCampo({
  pergunta,
  valor,
  somenteLeitura,
  onChange,
}: {
  pergunta: PerguntaDoFormulario;
  valor: string[];
  somenteLeitura: boolean;
  onChange: (lista: string[]) => void;
}) {
  const unica = pergunta.type === "single_choice";
  const o = pergunta.options ?? {};
  const escolhas = (o.choices ?? []).map((c) => c.trim()).filter(Boolean);
  const outro = outroDe(valor);
  const fixas = valor.filter((v) => !v.toLowerCase().startsWith(OUTRO_PREFIXO));

  function alternar(escolha: string) {
    if (unica) {
      onChange(fixas.includes(escolha) ? [] : [escolha]);
      return;
    }
    onChange(
      fixas.includes(escolha)
        ? valor.filter((v) => v !== escolha)
        : [...valor, escolha]
    );
  }

  function marcarOutro(marcado: boolean, texto = outro.texto) {
    const semOutro = unica ? [] : fixas;
    onChange(marcado ? [...semOutro, `${OUTRO_PREFIXO}${texto}`] : semOutro);
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={`pergunta-${pergunta.id}`}>
      {escolhas.map((escolha) => (
        <label key={escolha} className={opcaoClasse}>
          <input
            type={unica ? "radio" : "checkbox"}
            name={pergunta.id}
            className="h-4 w-4 accent-primary"
            checked={fixas.includes(escolha)}
            disabled={somenteLeitura}
            onChange={() => alternar(escolha)}
            // Rádio nativo não desmarca ao clicar de novo; aqui desmarca.
            onClick={unica && fixas.includes(escolha) ? () => alternar(escolha) : undefined}
          />
          <span>{escolha}</span>
        </label>
      ))}
      {o.other ? (
        <label className={cn(opcaoClasse, "flex-wrap")}>
          <input
            type={unica ? "radio" : "checkbox"}
            name={pergunta.id}
            className="h-4 w-4 accent-primary"
            checked={outro.marcado}
            disabled={somenteLeitura}
            onChange={() => marcarOutro(!outro.marcado)}
            onClick={unica && outro.marcado ? () => marcarOutro(false) : undefined}
          />
          <span>Outro</span>
          {outro.marcado ? (
            <Input
              aria-label="Qual?"
              placeholder="Qual?"
              className="h-8 w-full sm:ml-2 sm:w-auto sm:flex-1"
              value={outro.texto}
              maxLength={200}
              disabled={somenteLeitura}
              onChange={(e) => marcarOutro(true, e.target.value)}
            />
          ) : null}
        </label>
      ) : null}
    </div>
  );
}
