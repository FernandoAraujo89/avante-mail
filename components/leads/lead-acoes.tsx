"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, CheckCircle2, Send, Undo2 } from "lucide-react";

import { ESTAGIOS } from "@/components/leads/estagios";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * As ações da ficha: entregar ao comercial, registrar o desfecho e converter em
 * parceiro.
 *
 * "Enviar ao comercial" é o botão principal porque é o que esta área existe
 * para produzir — a nutrição roda sozinha, e a decisão humana é só esta.
 *
 * Converter é a única porta que devolve o contato ao público das campanhas
 * (limpa o estágio), então ela pede confirmação e diz, na própria janela, o que
 * vai mudar — inclusive quando o lead nunca deu aceite de e-mail.
 */
export function LeadAcoes({
  leadId,
  estagio,
  faixa,
  enviadoEm,
  subscribed,
  listas,
}: {
  leadId: string;
  estagio: string;
  faixa: string | null;
  enviadoEm: string | null;
  subscribed: boolean;
  listas: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [converterAberto, setConverterAberto] = useState(false);
  const [destino, setDestino] = useState(listas[0]?.id ?? "");

  async function mudarEstagio(novo: string) {
    if (novo === estagio) return;
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: novo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao mudar o estágio.");
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  async function converter() {
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ converter: true, listId: destino }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao converter o lead.");
      setConverterAberto(false);
      router.push("/leads");
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  const nomeDoDestino =
    listas.find((l) => l.id === destino)?.name ?? "a lista escolhida";

  return (
    <Card>
      <CardHeader>
        <CardTitle>O que fazer com este lead</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* O botão só aparece enquanto o lead está em nutrição: depois de
            entregue, "enviar" de novo é ruído, e o estágio abaixo continua
            disponível para quem precisar corrigir. */}
        {estagio === "nutrindo" ? (
          <div className="grid gap-2">
            <Button
              onClick={() => mudarEstagio("enviado")}
              disabled={salvando}
              variant={faixa === "quente" ? "default" : "outline"}
            >
              <Send />
              Enviar ao comercial
            </Button>
            <p className="text-xs text-muted-foreground">
              {faixa === "quente"
                ? "Este lead está quente. Registrar a entrega guarda a data e dispara as automações com gatilho de mudança de estágio."
                : "Registra a data da entrega e dispara as automações com gatilho de mudança de estágio. A passagem em si você faz no Pipedrive."}
            </p>
          </div>
        ) : null}

        {estagio === "enviado" ? (
          <div className="grid gap-2 rounded-lg border border-warning-dark/30 bg-warning-light/30 px-3 py-2">
            <p className="text-xs text-warning-dark">
              Entregue ao comercial
              {enviadoEm ? ` em ${formatDate(enviadoEm)}` : ", sem data registrada"}
              . Confira no Pipedrive se fechou e registre o desfecho aqui.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => mudarEstagio("cliente")}
                disabled={salvando}
              >
                <CheckCircle2 />
                Virou cliente
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => mudarEstagio("nutrindo")}
                disabled={salvando}
              >
                <Undo2 />
                Voltar para nutrição
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="estagio-do-lead">Estágio</Label>
          <Select
            value={estagio}
            onValueChange={mudarEstagio}
            disabled={salvando}
          >
            <SelectTrigger id="estagio-do-lead">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESTAGIOS.map((e) => (
                <SelectItem key={e.valor} value={e.valor}>
                  {e.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Descreve o que nós fazemos com o lead. O andamento da venda fica no
            Pipedrive.
          </p>
        </div>

        <div className="grid gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => setConverterAberto(true)}
            disabled={salvando || listas.length === 0}
          >
            <ArrowRightLeft />
            Converter em parceiro
          </Button>
          <p className="text-xs text-muted-foreground">
            {listas.length === 0
              ? "Crie uma lista de parceiros para poder converter."
              : "Encerra a nutrição e move o contato para uma lista de relacionamento — a partir daí ele passa a receber campanhas."}
          </p>
        </div>

        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : null}
      </CardContent>

      <Dialog open={converterAberto} onOpenChange={setConverterAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Converter em parceiro</DialogTitle>
            <DialogDescription>
              O contato deixa de ser lead, sai da lista de leads e passa a fazer
              parte da base de relacionamento — recebendo campanhas como
              qualquer parceiro.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="lista-destino">Lista de destino</Label>
            <Select value={destino} onValueChange={setDestino}>
              <SelectTrigger id="lista-destino">
                <SelectValue placeholder="Escolha a lista" />
              </SelectTrigger>
              <SelectContent>
                {listas.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Converter NÃO concede consentimento: quem nunca aceitou continua
              sem aceitar, e entraria numa lista de campanha sem poder receber
              e-mail. Melhor dizer isso aqui do que virar dúvida depois. */}
          {!subscribed ? (
            <p className="rounded-lg border border-warning-dark/30 bg-warning-light/30 px-3 py-2 text-xs text-warning-dark">
              Este lead nunca deu aceite de e-mail. Convertê-lo o move para{" "}
              <span className="font-medium">{nomeDoDestino}</span>, mas ele
              continuará sem receber e-mail até o aceite ser registrado na ficha
              do contato.
            </p>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConverterAberto(false)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button onClick={converter} disabled={salvando || !destino}>
              {salvando ? "Convertendo..." : "Converter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
