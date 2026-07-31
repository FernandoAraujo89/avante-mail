"use client";

import { useRef, useState } from "react";
import { ListFilter, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MIN_COMMON_DIGITS, parsePhoneList, samePhone } from "@/lib/phone";

export interface NumberFilterResult {
  /** Quantos números vieram na lista (sem repetições). */
  total: number;
  /** Quantos casaram com algum contato. */
  encontrados: number;
  /** Quantos contatos foram selecionados (um número pode casar com mais de um). */
  contatos: number;
  naoEncontrados: string[];
}

interface NumberFilterDialogProps {
  /** Contatos elegíveis já carregados; null enquanto carrega. */
  contacts: { id: string; phone: string | null }[] | null;
  onApply: (ids: string[], resultado: NumberFilterResult) => void;
}

/**
 * Filtra os contatos JÁ CADASTRADOS a partir de uma lista de números colada de
 * uma planilha ou de um .csv. Não cria destinatário novo: o que não casar com
 * um contato é devolvido na lista de "não encontrados".
 */
export function NumberFilterDialog({
  contacts,
  onApply,
}: NumberFilterDialogProps) {
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<NumberFilterResult | null>(null);
  const [erro, setErro] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function lerArquivo(file: File) {
    setErro("");
    try {
      const conteudo = await file.text();
      setTexto((atual) => (atual.trim() ? `${atual}\n${conteudo}` : conteudo));
    } catch {
      setErro("Não consegui ler o arquivo. Salve como CSV ou cole os números.");
    }
  }

  function aplicar() {
    if (!contacts) return;
    const numeros = parsePhoneList(texto);
    if (numeros.length === 0) {
      setErro(
        "Nenhum número encontrado no texto. Cole uma coluna de telefones ou envie um .csv."
      );
      setResultado(null);
      return;
    }

    const ids = new Set<string>();
    const naoEncontrados: string[] = [];
    for (const numero of numeros) {
      const casaram = contacts.filter(
        (c) => c.phone && samePhone(c.phone, numero)
      );
      if (casaram.length === 0) naoEncontrados.push(numero);
      else for (const c of casaram) ids.add(c.id);
    }

    const res: NumberFilterResult = {
      total: numeros.length,
      encontrados: numeros.length - naoEncontrados.length,
      contatos: ids.size,
      naoEncontrados,
    };
    setErro("");
    setResultado(res);
    onApply([...ids], res);
  }

  function limpar() {
    setTexto("");
    setResultado(null);
    setErro("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={contacts === null}
      >
        <ListFilter />
        Filtrar por lista de números
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Filtrar por lista de números</DialogTitle>
            <DialogDescription>
              Cole uma coluna de telefones da sua planilha ou envie um .csv. O
              sistema seleciona os contatos <strong>já cadastrados</strong> que
              correspondem — nenhum número novo é criado nem recebe mensagem.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={"31 99565-0622\n(11) 98888-7777\n5548999990001"}
              rows={7}
              className="font-mono text-sm"
            />

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void lerArquivo(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <Upload />
                Enviar .csv
              </Button>
              {texto.trim() ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={limpar}
                >
                  Limpar
                </Button>
              ) : null}
              <span className="text-xs text-muted-foreground">
                Aceita qualquer formato: com ou sem DDI, DDD e máscara.
              </span>
            </div>

            {erro ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
                {erro}
              </p>
            ) : null}

            {resultado ? (
              <div className="grid gap-3 rounded-lg border border-border p-4">
                <p className="text-sm">
                  <span className="font-medium">
                    {resultado.encontrados} de {resultado.total}
                  </span>{" "}
                  números encontrados, selecionando{" "}
                  <span className="font-medium">{resultado.contatos}</span>{" "}
                  contato{resultado.contatos === 1 ? "" : "s"}.
                </p>

                {resultado.naoEncontrados.length > 0 ? (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium text-destructive-hover">
                      {resultado.naoEncontrados.length} não encontrado
                      {resultado.naoEncontrados.length === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Não estão cadastrados, não têm consentimento de WhatsApp,
                      ou estão fora das listas escolhidas nesta campanha.
                    </p>
                    <div className="max-h-40 overflow-y-auto rounded border border-border bg-muted/40 p-2 font-mono text-xs">
                      {resultado.naoEncontrados.map((n) => (
                        <div key={n}>{n}</div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="justify-self-start"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          resultado.naoEncontrados.join("\n")
                        )
                      }
                    >
                      Copiar não encontrados
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Todos os números da lista foram encontrados.
                  </p>
                )}
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Como o casamento é feito: comparando os números de trás para
              frente, porque DDI, DDD e o 9 do celular variam. São necessários{" "}
              {MIN_COMMON_DIGITS} dígitos finais iguais — o que garante os 4
              últimos idênticos.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {resultado ? "Fechar" : "Cancelar"}
            </Button>
            <Button onClick={aplicar} disabled={!contacts || !texto.trim()}>
              {resultado ? "Filtrar de novo" : "Filtrar contatos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
