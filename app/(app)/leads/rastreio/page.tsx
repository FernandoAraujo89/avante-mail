"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Plus,
  Radio,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";

interface RegraDeSite {
  id: string;
  evento: string;
  matchType: string;
  valor: string;
  description: string | null;
  active: boolean;
}

interface Recusa {
  motivo: string;
  detalhe?: string;
  quando: string;
}

interface Dados {
  tag: string;
  origens: string[];
  ativo: boolean;
  regras: RegraDeSite[];
  ultimaVisita: string | null;
  recusas: Recusa[];
  visitasNaSemana: number;
  cargas: { hoje: number; ultimos7dias: number };
  baseLegal: "consentimento" | "legitimo_interesse";
}

/**
 * Os quatro estados possíveis, na ordem em que se resolvem. Cada um tem um dono
 * diferente — e é por isso que a tela não pode dizer só "nada chegou": quem
 * precisa agir muda conforme o estado.
 */
type Situacao =
  | "sem-origem"
  | "sem-tag"
  | "calado"
  | "esperando"
  | "recebendo";

function diagnosticar(d: Dados | null): Situacao | null {
  if (!d) return null;
  if (!d.ativo) return "sem-origem";
  if (d.cargas.ultimos7dias === 0) return "sem-tag";
  // "Calado" só faz sentido quando a coleta DEPENDE de uma autorização que
  // ninguém dá. Sob legítimo interesse, não ter visita significa outra coisa:
  // ninguém chegou por um link nosso ainda.
  if (!d.ultimaVisita) {
    return d.baseLegal === "consentimento" ? "calado" : "esperando";
  }
  return "recebendo";
}

/** O motivo técnico traduzido para quem vai consertar. */
const MOTIVOS: Record<string, string> = {
  "origem-nao-permitida":
    "O site que chamou não está na lista de origens (confira SITE_TRACK_ORIGINS no servidor).",
  "sem-origem": "Chamada sem identificação de site — provavelmente não veio de um navegador.",
  "corpo-invalido": "O corpo enviado não estava no formato esperado.",
  "corpo-grande": "Corpo maior que o teto.",
  "token-invalido": "Token ausente, expirado ou inválido — o visitante não está identificado.",
  "contato-suprimido": "O lead pediu para sair; o rastreio dele foi revogado.",
  "contato-inexistente": "O lead do token não existe mais na base.",
  "limite-por-ip": "Muitas chamadas do mesmo endereço.",
  "limite-por-contato": "Muitos eventos do mesmo lead na última hora.",
  "nada-aproveitavel": "A chamada chegou, mas nenhum evento dela era válido.",
};

export default function RastreioPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [evento, setEvento] = useState("");
  const [valor, setValor] = useState("");
  const [matchType, setMatchType] = useState("prefixo");

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch("/api/leads/rastreio");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar.");
      setDados(json);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function copiarTag() {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.tag);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // sem permissão: a tag está à vista para seleção manual
    }
  }

  async function adicionar() {
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch("/api/leads/rastreio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evento, valor, matchType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar.");
      setEvento("");
      setValor("");
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  async function mudarBaseLegal(baseLegal: string) {
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch("/api/leads/rastreio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseLegal }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar.");
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string) {
    try {
      await fetch(`/api/leads/rastreio/${id}`, { method: "DELETE" });
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }

  const situacao = diagnosticar(dados);

  // Cada estado com o texto de quem age nele. O erro que esta tela precisa
  // evitar é dizer "a tag pode não ter sido colada" quando a tag ESTÁ lá e o
  // problema é outro — manda o time do site procurar defeito onde não há.
  const TEXTO: Record<Situacao, { titulo: string; detalhe: string }> = {
    "sem-origem": {
      titulo: "Rastreio desligado",
      detalhe:
        "Nenhuma origem configurada no servidor (SITE_TRACK_ORIGINS). Nada é rastreado até isso existir.",
    },
    "sem-tag": {
      titulo: "A tag não está carregando",
      detalhe:
        "O script não foi baixado nenhuma vez nos últimos 7 dias — sinal de que a tag não está publicada no site. É com o time do site.",
    },
    calado: {
      titulo: "A tag está no ar, mas o rastreio está calado",
      detalhe: `O script carregou ${dados?.cargas.ultimos7dias ?? 0} vez(es) nos últimos 7 dias, e nenhuma visita chegou. O script só envia depois que o site chamar av('consentimento', true) — enquanto isso ele fica inerte de propósito.`,
    },
    esperando: {
      titulo: "Pronto, esperando o primeiro lead",
      detalhe: `O script carregou ${dados?.cargas.ultimos7dias ?? 0} vez(es) nos últimos 7 dias e está coletando. Só é rastreado quem chega por um link nosso — a primeira visita aparece quando um lead clicar num e-mail e navegar pelo site.`,
    },
    recebendo: {
      titulo: "Recebendo visitas",
      detalhe: `Última visita: ${
        dados?.ultimaVisita ? formatDateTime(dados.ultimaVisita) : "—"
      } · ${dados?.visitasNaSemana ?? 0} nos últimos 7 dias · o script carregou ${
        dados?.cargas.ultimos7dias ?? 0
      } vez(es) no período.`,
    },
  };

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/leads">
            <ArrowLeft />
            Voltar para leads
          </Link>
        </Button>
        <PageHeader
          title="Rastreio do site"
          description="Liga a visita ao site à ficha do lead. Só quem chegou por um link nosso é identificado — e só depois de aceitar o rastreio no site."
        />
      </div>

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      {/* Situação: o alarme de "parou de chegar e ninguém percebeu" — e, mais
          importante, de QUEM é o próximo passo. */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-3">
            <span
              className={`flex size-10 items-center justify-center rounded-full ${
                situacao === "recebendo" || situacao === "esperando"
                  ? "bg-success-light/40"
                  : situacao === "calado"
                    ? "bg-warning-light/40"
                    : "bg-muted"
              }`}
            >
              <Radio
                className={`size-5 ${
                  situacao === "recebendo" || situacao === "esperando"
                    ? "text-success-dark"
                    : situacao === "calado"
                      ? "text-warning-dark"
                      : "text-muted-foreground"
                }`}
              />
            </span>
            <div className="max-w-2xl">
              <p className="font-medium">
                {situacao ? TEXTO[situacao].titulo : "Carregando..."}
              </p>
              <p className="text-sm text-muted-foreground">
                {situacao ? TEXTO[situacao].detalhe : ""}
              </p>
            </div>
          </div>
          {dados?.origens.length ? (
            <div className="flex flex-wrap gap-1.5">
              {dados.origens.map((o) => (
                <Badge key={o} variant="secondary">
                  {o}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Só no estado "calado": é onde a decisão trava, e a tela precisa dizer
          exatamente o que falta em vez de deixar parecer defeito nosso. */}
      {situacao === "calado" ? (
        <Card className="mb-6 border-warning-dark/30 bg-warning-light/20">
          <CardContent className="p-6">
            <p className="font-medium text-warning-dark">
              O que falta para começar a receber
            </p>
            <p className="mt-1 text-sm text-warning-dark/90">
              A tag está publicada e funcionando — o script foi baixado{" "}
              {dados?.cargas.ultimos7dias} vez(es) nos últimos 7 dias. O que não
              existe é o consentimento: enquanto o site não chamar{" "}
              <code className="rounded bg-warning-light/60 px-1">
                av(&apos;consentimento&apos;, true)
              </code>
              , o script observa e não envia nada. É assim por decisão de
              projeto, não por defeito.
            </p>
            <p className="mt-2 text-sm text-warning-dark/90">
              Se o site ainda não tem banner de cookies, essa é uma decisão de
              base legal antes de ser técnica — o rastreio identifica a pessoa
              (nome e e-mail já estão na nossa base), o que é mais forte do que
              a analítica anônima que a maioria dos sites usa.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* A decisão mais séria desta tela fica À VISTA, e não escondida num
          arquivo de configuração do servidor: quem responder por ela um dia
          precisa conseguir ver o que está valendo sem pedir para ninguém. */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            Base legal do rastreio
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="base-legal">O que autoriza a coleta</Label>
            <Select
              value={dados?.baseLegal ?? "consentimento"}
              onValueChange={mudarBaseLegal}
              disabled={!dados || salvando}
            >
              <SelectTrigger id="base-legal" className="max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="consentimento">
                  Consentimento — só coleta depois do aceite no site
                </SelectItem>
                <SelectItem value="legitimo_interesse">
                  Legítimo interesse — coleta desde o carregamento
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {dados?.baseLegal === "legitimo_interesse" ? (
            <div className="grid gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                O que continua valendo neste modo
              </p>
              <p>
                Os sinais de privacidade do navegador (GPC e Do Not Track)
                bloqueiam a coleta, mesmo aqui. Um{" "}
                <code className="rounded bg-muted px-1">
                  av(&apos;consentimento&apos;, false)
                </code>{" "}
                continua funcionando e é lembrado naquele navegador para sempre.
                E o descadastro do e-mail revoga o rastreio na hora — ou seja, o
                direito de oposição já está em todo rodapé de e-mail que vocês
                mandam.
              </p>
              <p>
                Só é rastreado quem chegou por um link nosso e já é lead. Nunca
                parceiro, nunca visitante anônimo.
              </p>
              <p className="text-foreground">
                Isto precisa estar descrito no aviso de privacidade do site — o
                rastreio identifica a pessoa, não é analítica anônima.
              </p>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Trocar aqui muda o que o script faz no navegador dos visitantes. O
            efeito chega em até 1 hora, que é o cache do script.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1. Cole no site</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Antes do fechamento do <code className="rounded bg-muted px-1">&lt;/head&gt;</code>, em
              todas as páginas.
            </p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md border border-border bg-muted/50 px-3 py-2 text-xs">
                {dados?.tag ?? "..."}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={copiarTag}
                aria-label="Copiar a tag"
              >
                {copiado ? (
                  <Check className="text-success-dark" />
                ) : (
                  <Copy className="text-muted-foreground" />
                )}
              </Button>
            </div>

            <div className="rounded-lg border border-warning-dark/30 bg-warning-light/30 px-3 py-2 text-xs text-warning-dark">
              <p className="font-medium">2. Ligue ao banner de cookies</p>
              <p className="mt-1">
                O script não envia nada até o site autorizar. No “aceitar” do
                banner, chame{" "}
                <code className="rounded bg-warning-light/60 px-1">
                  av(&apos;consentimento&apos;, true)
                </code>
                ; no “recusar”,{" "}
                <code className="rounded bg-warning-light/60 px-1">
                  av(&apos;consentimento&apos;, false)
                </code>
                .
              </p>
              {/* As duas armadilhas reais, aprendidas na instalação. Quem lê
                  esta tela é quem vai passar a instrução ao time do site. */}
              <p className="mt-2">
                <span className="font-medium">Em toda página</span>, não só no
                clique do botão. Se o banner já sabe que a pessoa aceitou antes,
                ele precisa chamar de novo a cada carregamento — o script guarda
                o “não”, nunca o “sim”, para uma revogação feita no banner
                chegar até aqui.
              </p>
              <p className="mt-2">
                O valor tem que ser o booleano{" "}
                <code className="rounded bg-warning-light/60 px-1">true</code>.
                A string{" "}
                <code className="rounded bg-warning-light/60 px-1">
                  &apos;true&apos;
                </code>{" "}
                ou uma variável que chegue vazia contam como{" "}
                <span className="font-medium">recusa</span>, de propósito: erro
                de ligação aparece como “não coleta”, nunca como coleta
                silenciosa.
              </p>
              <p className="mt-2">
                Não bloqueie o script atrás do consentimento no gerenciador de
                tags. Ele precisa carregar sempre para capturar o identificador
                que vem na URL e limpá-lo da barra de endereço — já nasce
                calado.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Para marcar um clique específico, basta o atributo{" "}
              <code className="rounded bg-muted px-1">data-av-evento=&quot;demo&quot;</code> no
              botão ou link. Para conferir se está funcionando, abra o console
              do site e rode{" "}
              <code className="rounded bg-muted px-1">av(&apos;debug&apos;, true)</code>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Páginas que contam como intenção</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Visitar uma destas páginas vira um evento nomeado, que a{" "}
              <Link href="/leads/pontuacao" className="underline">
                pontuação
              </Link>{" "}
              usa para dar peso próprio.
            </p>

            <div className="grid gap-2">
              {(dados?.regras ?? []).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      <span className="font-medium">{r.valor}</span>
                      <span className="text-muted-foreground">
                        {r.matchType === "prefixo" ? " e subpáginas" : " (exato)"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      vira o evento{" "}
                      <span className="font-medium">{r.evento}</span>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remover(r.id)}
                    aria-label={`Remover a regra de ${r.valor}`}
                  >
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </div>
              ))}
              {dados && dados.regras.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma página cadastrada.
                </p>
              ) : null}
            </div>

            <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-[1fr_1fr_auto]">
              <div className="grid gap-1.5">
                <Label htmlFor="regra-valor">Caminho</Label>
                <Input
                  id="regra-valor"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="/planos"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="regra-evento">Evento</Label>
                <Input
                  id="regra-evento"
                  value={evento}
                  onChange={(e) => setEvento(e.target.value)}
                  placeholder="precos"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="regra-tipo">Casamento</Label>
                <Select value={matchType} onValueChange={setMatchType}>
                  <SelectTrigger id="regra-tipo" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prefixo">Começa com</SelectItem>
                    <SelectItem value="exato">Exato</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-3">
                <Button
                  variant="outline"
                  onClick={adicionar}
                  disabled={salvando || !evento.trim() || !valor.trim()}
                >
                  <Plus />
                  Adicionar página
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* As recusas são o que responde "por que não chegou". */}
      {dados && dados.recusas.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Chamadas recusadas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              O que bateu no endereço e não virou evento. Nem tudo aqui é
              problema: uma sonda de teste ou um token velho de visitante
              aparecem como recusa e é assim que deve ser.
            </p>
            <ul className="grid gap-2">
              {dados.recusas.slice(0, 15).map((r, i) => (
                <li
                  key={`${r.quando}-${i}`}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-2 text-sm last:border-b-0"
                >
                  <div className="min-w-0">
                    <p>{MOTIVOS[r.motivo] ?? r.motivo}</p>
                    {r.detalhe ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {r.detalhe}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(r.quando)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
