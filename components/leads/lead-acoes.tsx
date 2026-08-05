"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";

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
 * A única ação da ficha: converter em parceiro.
 *
 * A ETAPA do funil não se muda aqui. Ela espelha o Pipedrive e chega pelo
 * webhook do agente — um controle manual seria uma segunda fonte da verdade
 * sobre o mesmo fato, e as duas divergiriam no primeiro dia em que alguém
 * mexesse só de um lado.
 *
 * Converter é a porta que devolve o contato ao público das campanhas (limpa a
 * etapa), então ela pede confirmação e diz, na própria janela, o que vai mudar
 * — inclusive quando o lead nunca deu aceite de e-mail.
 */
export function LeadAcoes({
  leadId,
  subscribed,
  listas,
}: {
  leadId: string;
  subscribed: boolean;
  listas: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [converterAberto, setConverterAberto] = useState(false);
  const [destino, setDestino] = useState(listas[0]?.id ?? "");

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
        <CardTitle>Converter em parceiro</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
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

        {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
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
