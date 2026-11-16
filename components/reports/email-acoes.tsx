"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Forward, Printer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  lerDestinatarios,
  MAX_REENVIO,
  type EnderecoConferido,
} from "@/lib/reenvio/regras";

type Variante = "default" | "outline" | "secondary" | "ghost";

const ID_DO_QUADRO_DE_IMPRESSAO = "impressao-do-email";

/**
 * Imprime o e-mail da campanha — e é pela impressão que se salva o PDF
 * ("Salvar como PDF" no destino da impressora). Carrega a versão de papel
 * (com a faixa do disparo no topo) num quadro fora da tela e manda imprimir
 * SÓ o quadro: o que sai é o e-mail, sem o menu nem os botões do sistema.
 */
export function ImprimirEmailButton({
  campaignId,
  variant = "outline",
  size,
}: {
  campaignId: string;
  variant?: Variante;
  size?: "sm";
}) {
  const [preparando, setPreparando] = useState(false);
  const [erro, setErro] = useState("");

  async function imprimir() {
    setPreparando(true);
    setErro("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/email?impressao=1`);
      if (!res.ok) throw new Error("Não foi possível montar o e-mail.");
      const html = await res.text();

      document.getElementById(ID_DO_QUADRO_DE_IMPRESSAO)?.remove();
      const quadro = document.createElement("iframe");
      quadro.id = ID_DO_QUADRO_DE_IMPRESSAO;
      quadro.title = "E-mail para impressão";
      quadro.setAttribute("aria-hidden", "true");
      quadro.tabIndex = -1;
      // Sem allow-scripts: o HTML do e-mail não roda nada aqui dentro.
      // allow-modals é o que deixa a janela de impressão abrir.
      quadro.setAttribute("sandbox", "allow-same-origin allow-modals");
      // Fora da tela, mas com tamanho de verdade: quadro de 0×0 ou escondido
      // com display:none sai em branco em alguns navegadores.
      quadro.style.cssText =
        "position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;";
      // O load espera as imagens: imprimir antes disso deixaria buracos.
      quadro.addEventListener(
        "load",
        () => {
          setPreparando(false);
          quadro.contentWindow?.focus();
          quadro.contentWindow?.print();
        },
        { once: true }
      );
      quadro.srcdoc = html;
      document.body.appendChild(quadro);
    } catch (err) {
      setPreparando(false);
      setErro(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={imprimir}
        disabled={preparando}
        title="Abre a impressão do navegador — escolha “Salvar como PDF” para gerar o arquivo"
      >
        <Printer />
        {preparando ? "Preparando..." : "Imprimir / salvar em PDF"}
      </Button>
      {erro ? (
        <span role="alert" className="text-xs text-destructive-hover">
          {erro}
        </span>
      ) : null}
    </>
  );
}

interface Resultado {
  enviados: string[];
  falhas: { email: string; motivo: string }[];
  bloqueados: string[];
}

/**
 * Reenvia o e-mail da campanha para endereços digitados. Em dois passos, de
 * propósito: e-mail enviado não volta, então antes de sair a tela mostra o que
 * o sistema sabe de cada endereço — quem é contato, quem está fora da base
 * (e precisa de um nome, se o e-mail chama pelo nome) e quem está
 * descadastrado e não vai receber.
 */
export function ReenviarEmailButton({
  campaignId,
  assunto,
  variant = "outline",
  size,
}: {
  campaignId: string;
  assunto: string;
  variant?: Variante;
  size?: "sm";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [etapa, setEtapa] = useState<"digitar" | "conferir" | "feito">(
    "digitar"
  );
  const [texto, setTexto] = useState("");
  const [enderecos, setEnderecos] = useState<EnderecoConferido[]>([]);
  const [emailUsaNome, setEmailUsaNome] = useState(false);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const endpoint = `/api/campaigns/${campaignId}/reenvio`;
  const recebem = enderecos.filter((e) => e.situacao !== "descadastrado");
  const faltaNome = recebem.some(
    (e) =>
      e.situacao === "fora_da_base" &&
      emailUsaNome &&
      !(nomes[e.email] ?? "").trim()
  );

  function recomecar() {
    setEtapa("digitar");
    setTexto("");
    setEnderecos([]);
    setNomes({});
    setErro("");
    setResultado(null);
  }

  async function chamar(corpo: unknown) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Não foi possível reenviar.");
    return json;
  }

  async function conferir() {
    setErro("");
    const { destinatarios, invalidos } = lerDestinatarios(texto);
    if (invalidos.length > 0) {
      setErro(`Não é e-mail: ${invalidos.join(", ")}`);
      return;
    }
    if (destinatarios.length === 0) {
      setErro("Informe ao menos um e-mail.");
      return;
    }
    if (destinatarios.length > MAX_REENVIO) {
      setErro(
        `Máximo de ${MAX_REENVIO} e-mails por reenvio. Para mais gente, duplique a campanha e escolha os destinatários.`
      );
      return;
    }
    setOcupado(true);
    try {
      const json = await chamar({ destinatarios, conferir: true });
      const conferidos: EnderecoConferido[] = json.enderecos ?? [];
      setEnderecos(conferidos);
      setEmailUsaNome(Boolean(json.emailUsaNome));
      setNomes(
        Object.fromEntries(
          conferidos
            .filter((e) => e.situacao === "fora_da_base")
            .map((e) => [e.email, e.nome ?? ""])
        )
      );
      setEtapa("conferir");
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  async function reenviar() {
    setErro("");
    setOcupado(true);
    try {
      const json: Resultado = await chamar({
        destinatarios: recebem.map((e) => ({
          email: e.email,
          nome:
            e.situacao === "fora_da_base"
              ? (nomes[e.email] ?? "").trim() || null
              : null,
        })),
      });
      setResultado(json);
      setEtapa("feito");
      // O histórico de reenvios da página vem do servidor.
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Forward />
        Reenviar para e-mails
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (ocupado) return;
          setOpen(next);
          if (!next && etapa === "feito") recomecar();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reenviar este e-mail</DialogTitle>
            <DialogDescription>
              Manda o e-mail da campanha, com o assunto original (
              <span className="font-medium text-foreground">{assunto}</span>),
              só para os endereços que você indicar. O reenvio não muda as
              métricas do relatório; fica registrado em “Reenvios avulsos”.
            </DialogDescription>
          </DialogHeader>

          {etapa === "digitar" ? (
            <div className="grid gap-2">
              <Label htmlFor="reenvio-emails">
                E-mails (até {MAX_REENVIO})
              </Label>
              <Textarea
                id="reenvio-emails"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={4}
                placeholder={"parceiro@empresa.com.br\noutro@empresa.com.br"}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Um por linha, ou separados por vírgula. Antes de enviar você
                confere quem é cada um.
              </p>
            </div>
          ) : null}

          {etapa === "conferir" ? (
            <ul className="grid max-h-[50vh] gap-2 overflow-y-auto">
              {enderecos.map((e) => (
                <li
                  key={e.email}
                  className="rounded-lg border border-border px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={
                        e.situacao === "descadastrado"
                          ? "break-all text-sm text-muted-foreground line-through"
                          : "break-all text-sm font-medium"
                      }
                    >
                      {e.email}
                    </span>
                    {e.situacao === "contato" ? (
                      <Badge variant="success">Contato</Badge>
                    ) : e.situacao === "fora_da_base" ? (
                      <Badge variant="outline">Fora da base</Badge>
                    ) : (
                      <Badge variant="destructive">Descadastrado</Badge>
                    )}
                  </div>
                  {e.situacao === "contato" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Recebe como {e.nome}, com o link de descadastro dele.
                    </p>
                  ) : e.situacao === "descadastrado" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Não recebe: este endereço de {e.nome} pediu para sair,
                      devolveu ou marcou como spam.
                    </p>
                  ) : emailUsaNome ? (
                    <div className="mt-2 grid gap-1.5">
                      <Label
                        htmlFor={`reenvio-nome-${e.email}`}
                        className="text-xs"
                      >
                        Nome para a saudação do e-mail
                      </Label>
                      <Input
                        id={`reenvio-nome-${e.email}`}
                        value={nomes[e.email] ?? ""}
                        onChange={(ev) =>
                          setNomes((atual) => ({
                            ...atual,
                            [e.email]: ev.target.value,
                          }))
                        }
                        placeholder="Como o e-mail deve chamar esta pessoa"
                      />
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Não está nos contatos: recebe o e-mail como ele é.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {etapa === "feito" && resultado ? (
            <div className="grid gap-2">
              {resultado.enviados.length > 0 ? (
                <p className="rounded-lg border border-success-dark/30 bg-success-light/20 px-4 py-2.5 text-sm text-success-dark">
                  Reenviado para {resultado.enviados.join(", ")}.
                </p>
              ) : null}
              {resultado.falhas.length > 0 ? (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive-hover">
                  Não saiu para{" "}
                  {resultado.falhas
                    .map((f) => `${f.email} (${f.motivo})`)
                    .join(", ")}
                  .
                </p>
              ) : null}
            </div>
          ) : null}

          {erro ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive-hover"
            >
              {erro}
            </p>
          ) : null}

          <DialogFooter>
            {etapa === "digitar" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={ocupado}
                >
                  Cancelar
                </Button>
                <Button onClick={conferir} disabled={ocupado}>
                  {ocupado ? "Conferindo..." : "Conferir endereços"}
                </Button>
              </>
            ) : null}
            {etapa === "conferir" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setErro("");
                    setEtapa("digitar");
                  }}
                  disabled={ocupado}
                >
                  Voltar
                </Button>
                <Button
                  onClick={reenviar}
                  disabled={ocupado || recebem.length === 0 || faltaNome}
                  title={
                    faltaNome
                      ? "Preencha o nome de quem está fora da base"
                      : undefined
                  }
                >
                  <Forward />
                  {ocupado
                    ? "Reenviando..."
                    : recebem.length === 0
                      ? "Ninguém para receber"
                      : `Reenviar para ${recebem.length}`}
                </Button>
              </>
            ) : null}
            {etapa === "feito" ? (
              <>
                <Button variant="outline" onClick={recomecar}>
                  Reenviar para outros
                </Button>
                <Button
                  onClick={() => {
                    setOpen(false);
                    recomecar();
                  }}
                >
                  Fechar
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
