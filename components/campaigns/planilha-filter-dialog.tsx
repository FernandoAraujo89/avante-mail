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
import {
  filtrarContatos,
  lerPlanilha,
  type ContatoParaFiltro,
  type ResultadoDoFiltro,
} from "@/lib/contatos/filtro-planilha";
import { MIN_COMMON_DIGITS } from "@/lib/phone";

export type PlanilhaFilterResult = ResultadoDoFiltro;

interface PlanilhaFilterDialogProps {
  channel: "email" | "whatsapp" | "sms";
  /** Contatos elegíveis já carregados; null enquanto carrega. */
  contacts: ContatoParaFiltro[] | null;
  onApply: (ids: string[], resultado: PlanilhaFilterResult) => void;
}

/**
 * Filtra os contatos JÁ CADASTRADOS a partir de uma planilha (colada ou .csv)
 * com o que ela tiver: nome, e-mail, telefone, e o resto que vier junto. A
 * linha casa por qualquer um dos três. Não cria destinatário novo: o que não
 * casar volta na lista de "não encontradas". A regra mora em
 * lib/contatos/filtro-planilha.ts.
 */
export function PlanilhaFilterDialog({
  channel,
  contacts,
  onApply,
}: PlanilhaFilterDialogProps) {
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<PlanilhaFilterResult | null>(null);
  const [erro, setErro] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function lerArquivo(file: File) {
    setErro("");
    try {
      const conteudo = await file.text();
      // Arquivo entra no lugar do que estava: dois cabeçalhos no mesmo texto
      // confundiriam a leitura.
      setTexto(conteudo);
    } catch {
      setErro("Não consegui ler o arquivo. Salve como CSV ou cole os dados.");
    }
  }

  function aplicar() {
    if (!contacts) return;
    const planilha = lerPlanilha(texto);
    if (planilha.linhas.length === 0) {
      setErro(
        "Nenhum e-mail, telefone ou nome encontrado. Cole uma coluna da sua planilha ou envie um .csv com cabeçalho (nome, email, telefone)."
      );
      setResultado(null);
      return;
    }
    const { ids, resultado: res } = filtrarContatos(planilha, contacts);
    setErro("");
    setResultado(res);
    onApply(ids, res);
  }

  function limpar() {
    setTexto("");
    setResultado(null);
    setErro("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const motivoNaoEncontradas =
    channel === "email"
      ? "Não estão cadastradas, não têm e-mail inscrito, ou estão fora das listas escolhidas nesta campanha."
      : channel === "sms"
        ? "Não estão cadastradas, não têm celular com consentimento de SMS, ou estão fora das listas escolhidas nesta campanha."
        : "Não estão cadastradas, não têm telefone com consentimento de WhatsApp, ou estão fora das listas escolhidas nesta campanha.";

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
        Filtrar por planilha
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Filtrar por planilha</DialogTitle>
            <DialogDescription>
              Cole uma coluna (telefones ou e-mails) ou envie um .csv com o que
              tiver: nome, e-mail, telefone e o resto. A linha entra se casar
              por <strong>qualquer um</strong> deles. O sistema seleciona só
              contatos <strong>já cadastrados</strong> — ninguém novo é criado
              nem recebe mensagem.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={
                "nome,email,telefone\nAna Souza,ana@loja.com.br,31 99565-0622\n\nou só uma coluna:\n(11) 98888-7777\nbruno@loja.com.br"
              }
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
                Telefone em qualquer formato; e-mail em qualquer caixa.
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
                    {resultado.encontradas} de {resultado.total}
                  </span>{" "}
                  linha{resultado.total === 1 ? "" : "s"} encontrada
                  {resultado.encontradas === 1 ? "" : "s"}
                  {resultado.encontradas > 0
                    ? ` (${[
                        resultado.porEmail > 0
                          ? `${resultado.porEmail} por e-mail`
                          : null,
                        resultado.porTelefone > 0
                          ? `${resultado.porTelefone} por telefone`
                          : null,
                        resultado.porNome > 0
                          ? `${resultado.porNome} por nome`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(", ")})`
                    : ""}
                  , selecionando{" "}
                  <span className="font-medium">{resultado.contatos}</span>{" "}
                  contato{resultado.contatos === 1 ? "" : "s"}.
                </p>

                {resultado.semColunaDeNome ? (
                  <p className="text-xs text-muted-foreground">
                    A planilha tem cabeçalho, mas nenhuma coluna de nome
                    reconhecida (nome, name, contato, cliente, razão social): o
                    casamento foi só por e-mail e telefone.
                  </p>
                ) : null}

                {resultado.nomesAmbiguos.length > 0 ? (
                  <p className="rounded border border-warning/40 bg-warning-light/30 px-3 py-2 text-xs">
                    {resultado.nomesAmbiguos.length} nome
                    {resultado.nomesAmbiguos.length === 1 ? "" : "s"} bate
                    {resultado.nomesAmbiguos.length === 1 ? "" : "m"} com mais
                    de um contato (
                    {resultado.nomesAmbiguos.slice(0, 5).join(", ")}
                    {resultado.nomesAmbiguos.length > 5 ? "…" : ""}). Todos
                    entraram — confira na lista e desmarque quem não for.
                  </p>
                ) : null}

                {resultado.naoEncontradas.length > 0 ? (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium text-destructive-hover">
                      {resultado.naoEncontradas.length} não encontrada
                      {resultado.naoEncontradas.length === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {motivoNaoEncontradas}
                    </p>
                    <div className="max-h-40 overflow-y-auto rounded border border-border bg-muted/40 p-2 font-mono text-xs">
                      {resultado.naoEncontradas.map((n, i) => (
                        <div key={`${i}-${n}`}>{n}</div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="justify-self-start"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          resultado.naoEncontradas.join("\n")
                        )
                      }
                    >
                      Copiar não encontradas
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Todas as linhas da planilha foram encontradas.
                  </p>
                )}
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Como o casamento é feito: e-mail igual; telefone comparado de trás
              para frente (DDI, DDD e o 9 do celular variam —{" "}
              {MIN_COMMON_DIGITS} dígitos finais iguais); nome igual, só quando
              a planilha tem a coluna de nome no cabeçalho. Com cabeçalho, só a
              coluna de telefone é lida como telefone — CNPJ e CEP não entram
              por engano.
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
