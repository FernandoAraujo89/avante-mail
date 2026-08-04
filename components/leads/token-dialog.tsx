"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * O token cru aparece uma vez só — o banco guarda apenas o hash. Por isso esta
 * janela é insistente: se for fechada sem copiar, o único caminho é gerar
 * outro, e aí o cenário do outro lado cai até ser atualizado.
 */
export function TokenDialog({
  dados,
  onFechar,
}: {
  dados: { token: string; url: string } | null;
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState<"url" | "token" | "cabecalho" | null>(
    null
  );

  async function copiar(valor: string, qual: "url" | "token" | "cabecalho") {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(qual);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      // Sem permissão de área de transferência: o valor está à vista para
      // seleção manual, então não vale interromper com erro.
    }
  }

  const linhas = dados
    ? [
        { rotulo: "URL (método POST)", valor: dados.url, qual: "url" as const },
        {
          rotulo: "Cabeçalho de autorização",
          valor: `Bearer ${dados.token}`,
          qual: "cabecalho" as const,
        },
        { rotulo: "Token", valor: dados.token, qual: "token" as const },
      ]
    : [];

  return (
    <Dialog
      open={dados !== null}
      onOpenChange={(aberto) => {
        if (!aberto) onFechar();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dados da conexão</DialogTitle>
          <DialogDescription>
            Cole isto no módulo HTTP do Make (ou no serviço que vai enviar os
            leads). O corpo é <span className="font-medium">application/json</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {linhas.map((l) => (
            <div key={l.qual} className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {l.rotulo}
              </span>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted/50 px-3 py-2 text-xs">
                  {l.valor}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copiar(l.valor, l.qual)}
                  aria-label={`Copiar ${l.rotulo}`}
                >
                  {copiado === l.qual ? (
                    <Check className="text-success-dark" />
                  ) : (
                    <Copy className="text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <p className="rounded-lg border border-warning-dark/30 bg-warning-light/30 px-3 py-2 text-xs text-warning-dark">
          O token aparece só agora — o sistema guarda apenas um resumo dele.
          Copie antes de fechar; para ter outro, é preciso gerar um novo, e o
          atual deixa de funcionar.
        </p>

        <DialogFooter>
          <Button onClick={onFechar}>Já copiei</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
