"use client";

import { useEffect, useState } from "react";
import { Code2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CodeEditor } from "@/components/ui/code-editor";
import { limparHtmlDoUsuario } from "@/lib/email-builder/codigo";
import type { BlockType, EmailDesign } from "@/lib/email-builder/types";

export type AlvoDoCodigo =
  | { tipo: "documento" }
  | { tipo: "linha"; id: string }
  | { tipo: "bloco"; id: string; rotulo: string; blockType: BlockType };

const TITULOS = {
  documento: "Código do e-mail",
  linha: "Código da estrutura",
  bloco: "Código do bloco",
} as const;

/**
 * Editor do HTML de um pedaço do e-mail — ou do e-mail inteiro.
 *
 * O texto que abre é sempre o HTML REAL, compilado no servidor pelo mesmo
 * caminho do envio. Mostrar um HTML aproximado seria pior que não mostrar:
 * a pessoa ajustaria um código que não é o que chega na caixa de entrada.
 *
 * Aplicar tem dois destinos, e a escolha é feita aqui, onde se vê o código:
 * transformar em blocos editáveis (o padrão — o HTML vira estruturas e blocos
 * do criador) ou guardar como HTML próprio. Neste segundo caso os controles
 * visuais daquele pedaço param de valer, e é isso que o texto do controle diz.
 * Voltar é apagar o campo, e o visual assume de novo; por isso o botão de
 * voltar fica aqui do lado, e não escondido.
 */
export function CodePanel({
  alvo,
  design,
  htmlProprio,
  onAplicar,
  onVoltarAoGerado,
  onFechar,
}: {
  alvo: AlvoDoCodigo | null;
  design: EmailDesign;
  /** HTML já salvo para este alvo, se houver. */
  htmlProprio: string | null;
  /** `emBlocos`: transformar o HTML em blocos editáveis, em vez de guardá-lo como próprio. */
  onAplicar: (html: string, emBlocos: boolean) => void;
  onVoltarAoGerado: () => void;
  onFechar: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [emBlocos, setEmBlocos] = useState(true);

  useEffect(() => {
    if (!alvo) return;
    setEmBlocos(true);
    // Com HTML próprio salvo, é ELE que abre — senão a tela ofereceria o código
    // gerado para quem já escreveu o seu, e salvar apagaria o trabalho.
    if (htmlProprio) {
      setCodigo(htmlProprio);
      setErro("");
      setAvisos([]);
      return;
    }
    setCarregando(true);
    setErro("");
    (async () => {
      try {
        const res = await fetch("/api/templates/codigo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ design, alvo }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao gerar o código.");
        setCodigo(json.html ?? "");
        setAvisos(Array.isArray(json.errors) ? json.errors : []);
      } catch (err) {
        setErro(err instanceof Error ? err.message : String(err));
      } finally {
        setCarregando(false);
      }
    })();
    // `design` de fora não entra: reabrir o painel a cada tecla digitada no
    // canvas jogaria fora o código que está sendo escrito aqui dentro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo, htmlProprio]);

  if (!alvo) return null;

  const titulo =
    alvo.tipo === "bloco"
      ? `${TITULOS.bloco}: ${alvo.rotulo}`
      : TITULOS[alvo.tipo];

  // Bloco de TEXTO absorve o código aplicado (conteúdo + moldura viram o
  // próprio bloco) — os controles seguem valendo. Os demais alvos viram
  // override: o código passa a mandar e os controles daquele pedaço param.
  const absorve = alvo.tipo === "bloco" && alvo.blockType === "text";
  // Texto absorve sempre; os demais escolhem entre blocos e HTML próprio.
  const podeConverter = !absorve;
  const converte = podeConverter && emBlocos;

  const descricao =
    alvo.tipo === "documento"
      ? "O e-mail inteiro, como sai do compilador."
      : alvo.tipo === "linha"
        ? "A tabela desta estrutura."
        : absorve
          ? "O <td> deste bloco. Ao aplicar, o bloco absorve o código — o conteúdo vira o texto do bloco e os controles visuais continuam valendo."
          : "O <td> deste bloco.";

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) onFechar();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code2 className="size-4" />
            {titulo}
          </DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>

        {erro ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
            {erro}
          </div>
        ) : null}

        {htmlProprio ? (
          <p className="rounded-lg border border-warning-dark/30 bg-warning-light/30 px-3 py-2 text-xs text-warning-dark">
            {absorve
              ? "Este bloco está com HTML próprio de uma versão antiga. Ao aplicar, ele volta a ser um bloco comum, com o código absorvido."
              : "Este pedaço já está com HTML próprio: os controles visuais dele estão desligados. Aplique como blocos para voltar a editá-lo no visual, ou volte ao gerado."}
          </p>
        ) : null}

        {carregando ? (
          <p className="py-24 text-center text-sm text-muted-foreground">
            Compilando o código...
          </p>
        ) : (
          <CodeEditor
            value={codigo}
            onChange={setCodigo}
            className="h-[52vh]"
            aria-label={titulo}
          />
        )}

        {podeConverter ? (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              checked={emBlocos}
              onChange={(e) => setEmBlocos(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              <span className="font-medium">Transformar em blocos editáveis</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Ao aplicar, o HTML vira{" "}
                {alvo.tipo === "bloco"
                  ? "blocos do criador"
                  : "estruturas e blocos do criador"}
                , com texto editável e imagens trocáveis. Desmarque para
                guardar o código como está: aí ele passa a mandar no que é
                enviado, e os controles visuais{" "}
                {alvo.tipo === "documento" ? "do e-mail" : "deste pedaço"} param
                de valer.
              </span>
            </span>
          </label>
        ) : null}

        {avisos.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Avisos do compilador: {avisos.join(" · ")}
          </p>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <div>
            {htmlProprio ? (
              <Button
                variant="outline"
                onClick={onVoltarAoGerado}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive-hover"
              >
                <RotateCcw />
                Voltar ao gerado
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <Button
              onClick={() => onAplicar(limparHtmlDoUsuario(codigo), converte)}
              disabled={carregando || !codigo.trim()}
            >
              {converte ? "Aplicar como blocos" : "Aplicar código"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
