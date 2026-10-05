"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LoaderCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatInt } from "@/lib/format";
import {
  botoesDePagina,
  COOKIE_DE_LINHAS,
  gravarPreferencia,
  LINHAS_PADRAO,
  lerLinhas,
  lerPreferencias,
  OPCOES_DE_LINHAS,
  paginaDoItem,
  recortar,
  valorDoCookie,
  type LinhasPorPagina,
} from "@/lib/paginacao";
import { cn } from "@/lib/utils";

// Paginação das listas (regras em lib/paginacao.ts). Três peças:
// - usePaginacao: lista que já chegou inteira ao navegador; fatia no cliente.
// - PaginacaoNaUrl: lista renderizada no servidor; cada página é uma URL.
// - Paginacao: a barra em si, igual nas duas.

// ─── Escolha de linhas guardada ─────────────────────────────────────────

const UM_ANO_EM_SEGUNDOS = 60 * 60 * 24 * 365;

const ouvintes = new Set<() => void>();

function inscrever(avisar: () => void) {
  ouvintes.add(avisar);
  return () => {
    ouvintes.delete(avisar);
  };
}

function linhasDoCookie(chave: string): LinhasPorPagina {
  const preferencias = lerPreferencias(
    valorDoCookie(document.cookie, COOKIE_DE_LINHAS)
  );
  return preferencias[chave] ?? LINHAS_PADRAO;
}

function guardarLinhas(chave: string, linhas: LinhasPorPagina) {
  const valor = gravarPreferencia(
    valorDoCookie(document.cookie, COOKIE_DE_LINHAS),
    chave,
    linhas
  );
  document.cookie = valor
    ? `${COOKIE_DE_LINHAS}=${valor}; path=/; max-age=${UM_ANO_EM_SEGUNDOS}; samesite=lax`
    : `${COOKIE_DE_LINHAS}=; path=/; max-age=0; samesite=lax`;
  for (const avisar of ouvintes) avisar();
}

/**
 * Quantas linhas por página a lista mostra, guardado no cookie. Na hidratação
 * vale `inicial` — o que o servidor leu do mesmo cookie para renderizar — e
 * assim a tabela não muda de tamanho logo depois de aparecer.
 */
function useLinhasPorPagina(chave: string, inicial?: LinhasPorPagina) {
  const linhas = useSyncExternalStore(
    inscrever,
    () => linhasDoCookie(chave),
    () => inicial ?? LINHAS_PADRAO
  );
  const mudar = useCallback(
    (novas: LinhasPorPagina) => guardarLinhas(chave, novas),
    [chave]
  );
  return [linhas, mudar] as const;
}

/**
 * Traz o começo da lista para a tela depois de trocar de página: quem clica
 * em "próxima" lá no rodapé não pode continuar olhando o fim da página nova.
 */
function levarAoComeco(lista: HTMLElement | null) {
  if (!lista) return;
  // Lista com rolagem própria (tabela de altura limitada, janela de diálogo).
  lista.scrollTop = 0;
  // No celular a barra do topo é fixa (3,5rem) e cobriria o começo da lista.
  const folga = window.matchMedia("(min-width: 768px)").matches ? 16 : 72;
  const topo = lista.getBoundingClientRect().top;
  if (topo < folga) window.scrollBy({ top: topo - folga });
}

// ─── Lista que já está no navegador ─────────────────────────────────────

/**
 * Página e fatia de uma lista que já chegou inteira ao navegador.
 *
 * `redefinirCom` recebe busca, filtros e ordem (valores simples — vão para
 * JSON): mudou algum, a lista volta para a 1ª página já nesta renderização,
 * sem um efeito que mostraria por um instante a página errada. Recarregar os
 * mesmos filtros (a atualização a cada 30s dos leads) mantém a página.
 */
export function usePaginacao<T>(
  itens: readonly T[],
  {
    chave,
    redefinirCom = [],
    linhasIniciais,
  }: {
    /** Nome da lista, para lembrar a escolha de linhas (ex.: "contatos"). */
    chave: string;
    redefinirCom?: readonly unknown[];
    /** O que o servidor leu do cookie, quando a lista vem renderizada de lá. */
    linhasIniciais?: LinhasPorPagina;
  }
) {
  const [linhas, guardar] = useLinhasPorPagina(chave, linhasIniciais);
  const marca = JSON.stringify(redefinirCom);
  const [pedido, setPedido] = useState({ pagina: 1, marca, linhas });
  const paginaPedida =
    pedido.marca === marca && pedido.linhas === linhas ? pedido.pagina : 1;
  const recorte = recortar(itens.length, paginaPedida, linhas);
  const { inicio, fim } = recorte;
  const itensDaPagina = useMemo(
    () => itens.slice(inicio, fim),
    [itens, inicio, fim]
  );

  const lista = useRef<HTMLElement | null>(null);
  /** Ref do contêiner da lista: é ele que volta à tela ao trocar de página. */
  const ancora = useCallback((elemento: HTMLElement | null) => {
    lista.current = elemento;
  }, []);

  const irPara = useCallback(
    (pagina: number) => {
      setPedido({ pagina, marca, linhas });
      levarAoComeco(lista.current);
    },
    [marca, linhas]
  );

  const mudarLinhas = useCallback(
    (novas: LinhasPorPagina) => {
      setPedido({ pagina: paginaDoItem(inicio, novas), marca, linhas: novas });
      guardar(novas);
      levarAoComeco(lista.current);
    },
    [inicio, marca, guardar]
  );

  return {
    ...recorte,
    itensDaPagina,
    ancora,
    /** Para espalhar na barra: `<Paginacao {...paginacao} />`. */
    paginacao: {
      total: itens.length,
      pagina: recorte.pagina,
      linhas,
      onPagina: irPara,
      onLinhas: mudarLinhas,
    },
  };
}

// ─── A barra ────────────────────────────────────────────────────────────

export interface PaginacaoProps {
  total: number;
  pagina: number;
  linhas: LinhasPorPagina;
  onPagina: (pagina: number) => void;
  onLinhas: (linhas: LinhasPorPagina) => void;
  /** Total antes da busca e dos filtros, para dizer quanto ficou de fora. */
  totalSemFiltro?: number;
  /** Nas grades de cartões a unidade não é linha: "Itens por página". */
  rotulo?: string;
  /** Página do servidor a caminho: trava os botões e mostra o carregamento. */
  ocupado?: boolean;
  className?: string;
}

/**
 * A barra de paginação: linhas por página (20, 50, 100 ou 200), onde se está
 * ("21–40 de 1.532") e os botões de página. Mede o espaço do próprio
 * contêiner (@container), não da janela — ela aparece em tabela larga, em
 * cartão estreito e em janela de diálogo.
 */
export function Paginacao({
  total,
  pagina,
  linhas,
  onPagina,
  onLinhas,
  totalSemFiltro,
  rotulo = "Linhas por página",
  ocupado = false,
  className,
}: PaginacaoProps) {
  const idDoSeletor = useId();
  if (total <= 0) return null;

  const {
    pagina: atual,
    totalPaginas,
    inicio,
    fim,
  } = recortar(total, pagina, linhas);
  const seta = "size-8 p-0";

  return (
    <nav
      aria-label="Paginação"
      className={cn("@container text-sm text-muted-foreground", className)}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor={idDoSeletor} className="whitespace-nowrap">
            <span className="@md:hidden">{rotulo.split(" ")[0]}</span>
            <span className="hidden @md:inline">{rotulo}</span>
          </label>
          <Select
            value={String(linhas)}
            onValueChange={(valor) => onLinhas(lerLinhas(valor) ?? LINHAS_PADRAO)}
            disabled={ocupado}
          >
            <SelectTrigger id={idDoSeletor} className="h-8 w-[4.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPCOES_DE_LINHAS.map((opcao) => (
                <SelectItem key={opcao} value={String(opcao)}>
                  {opcao}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p
          className="ml-auto flex items-center gap-1.5 tabular-nums"
          aria-live="polite"
        >
          {ocupado ? (
            <LoaderCircle
              className="size-3.5 animate-spin"
              aria-label="Carregando a página"
            />
          ) : null}
          <span>
            <span className="font-medium text-foreground">
              {formatInt(inicio + 1)}–{formatInt(fim)}
            </span>{" "}
            de {formatInt(total)}
            {totalSemFiltro !== undefined && totalSemFiltro > total ? (
              <span className="hidden @md:inline">
                {" "}
                (filtrados de {formatInt(totalSemFiltro)})
              </span>
            ) : null}
          </span>
        </p>

        {totalPaginas > 1 ? (
          <div className="flex w-full items-center justify-center gap-1 @2xl:w-auto">
            {/* Sem os números (cabem só de @xl para cima), primeira e última
                viram setas duplas — senão ir ao fim seriam dezenas de cliques. */}
            <Button
              type="button"
              variant="outline"
              className={cn(seta, "@xl:hidden")}
              onClick={() => onPagina(1)}
              disabled={ocupado || atual <= 1}
              aria-label="Primeira página"
              title="Primeira página"
            >
              <ChevronsLeft />
            </Button>
            <Button
              type="button"
              variant="outline"
              className={seta}
              onClick={() => onPagina(atual - 1)}
              disabled={ocupado || atual <= 1}
              aria-label="Página anterior"
              title="Página anterior"
            >
              <ChevronLeft />
            </Button>

            <span className="px-2 tabular-nums @xl:hidden">
              Página {formatInt(atual)} de {formatInt(totalPaginas)}
            </span>
            <span className="hidden items-center gap-1 @xl:flex">
              {botoesDePagina(atual, totalPaginas).map((botao) =>
                typeof botao === "number" ? (
                  <Button
                    key={botao}
                    type="button"
                    variant={botao === atual ? "default" : "ghost"}
                    className={cn(
                      "h-8 min-w-8 px-2 tabular-nums",
                      botao !== atual && "font-medium text-foreground"
                    )}
                    onClick={() => {
                      if (botao !== atual) onPagina(botao);
                    }}
                    disabled={ocupado && botao !== atual}
                    aria-label={`Página ${botao}`}
                    aria-current={botao === atual ? "page" : undefined}
                  >
                    {formatInt(botao)}
                  </Button>
                ) : (
                  <span key={botao} aria-hidden="true" className="w-5 text-center">
                    …
                  </span>
                )
              )}
            </span>

            <Button
              type="button"
              variant="outline"
              className={seta}
              onClick={() => onPagina(atual + 1)}
              disabled={ocupado || atual >= totalPaginas}
              aria-label="Próxima página"
              title="Próxima página"
            >
              <ChevronRight />
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn(seta, "@xl:hidden")}
              onClick={() => onPagina(totalPaginas)}
              disabled={ocupado || atual >= totalPaginas}
              aria-label="Última página"
              title="Última página"
            >
              <ChevronsRight />
            </Button>
          </div>
        ) : null}
      </div>
    </nav>
  );
}

// ─── Lista renderizada no servidor ──────────────────────────────────────

/**
 * A barra para uma lista que o servidor renderiza (campanhas, templates...):
 * cada troca vira URL (`?pagina=2&linhas=50`) e o servidor consulta só a
 * página pedida. A página anterior fica à vista, com o carregamento na barra,
 * até a nova chegar.
 */
export function PaginacaoNaUrl({
  chave,
  idDaLista,
  ...props
}: Omit<PaginacaoProps, "onPagina" | "onLinhas" | "ocupado"> & {
  /** Nome da lista, para lembrar a escolha de linhas. */
  chave: string;
  /** id do elemento da lista, que volta à tela quando a página nova chega. */
  idDaLista?: string;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const [ocupado, iniciar] = useTransition();
  const estavaOcupado = useRef(false);

  useEffect(() => {
    if (estavaOcupado.current && !ocupado) {
      levarAoComeco(idDaLista ? document.getElementById(idDaLista) : null);
    }
    estavaOcupado.current = ocupado;
  }, [ocupado, idDaLista]);

  function navegar(pagina: number, linhas?: LinhasPorPagina) {
    // Lê a URL da hora do clique, e não um useSearchParams: assim a barra não
    // exige Suspense em volta nem arrasta outros parâmetros velhos.
    const parametros = new URLSearchParams(window.location.search);
    if (pagina > 1) parametros.set("pagina", String(pagina));
    else parametros.delete("pagina");
    if (linhas) parametros.set("linhas", String(linhas));
    const busca = parametros.toString();
    iniciar(() => {
      router.push(busca ? `${caminho}?${busca}` : caminho, { scroll: false });
    });
  }

  return (
    <Paginacao
      {...props}
      ocupado={ocupado}
      onPagina={(pagina) => navegar(pagina)}
      onLinhas={(linhas) => {
        guardarLinhas(chave, linhas);
        const { inicio } = recortar(props.total, props.pagina, props.linhas);
        navegar(paginaDoItem(inicio, linhas), linhas);
      }}
    />
  );
}

// ─── Seleção numa lista paginada ────────────────────────────────────────

/**
 * A caixa do cabeçalho numa tabela paginada: marca e desmarca só a página à
 * vista — marcar o que ninguém está vendo levaria gente escondida junto numa
 * exclusão. Com parte da página marcada, fica no meio-termo (indeterminada).
 */
export function CaixaDaPagina({
  ids,
  selecionados,
  onChange,
}: {
  ids: readonly string[];
  selecionados: ReadonlySet<string>;
  onChange: (proximos: Set<string>) => void;
}) {
  const marcados = ids.filter((id) => selecionados.has(id)).length;
  const todos = ids.length > 0 && marcados === ids.length;
  const rotulo = todos
    ? "Desmarcar todos desta página"
    : "Selecionar todos desta página";

  return (
    <input
      type="checkbox"
      aria-label={rotulo}
      title={rotulo}
      className="size-4 cursor-pointer accent-primary align-middle"
      checked={todos}
      ref={(caixa) => {
        if (caixa) caixa.indeterminate = marcados > 0 && !todos;
      }}
      onChange={() => {
        const proximos = new Set(selecionados);
        for (const id of ids) {
          if (todos) proximos.delete(id);
          else proximos.add(id);
        }
        onChange(proximos);
      }}
    />
  );
}
