"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  FileCode2,
  Gauge,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Magnet,
  Menu,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  Radar,
  Send,
  UserCog,
  Users,
  Webhook,
  Workflow,
  X,
} from "lucide-react";

import { AvanteLogo } from "@/components/avante-logo";
import { rotaPermitida, type Perfil } from "@/lib/perfis";
import { cn } from "@/lib/utils";
import { UNREAD_CHANGED_EVENT } from "@/lib/whatsapp/inbox-events";

/** De quanto em quanto tempo o menu confere se chegou resposta no WhatsApp. */
const UNREAD_POLL_MS = 30_000;

// O menu é agrupado por ÁREA, e não uma lista corrida, porque as áreas têm
// públicos diferentes: "Relacionamento" fala com parceiro, cliente e
// colaborador; "Leads" é a captação, que não recebe campanha (as travas da
// fase B — docs/plano-webhooks-leads.md). Ver os dois grupos separados no menu
// é o que impede alguém tratar lead como se fosse parceiro.
const NAV_GROUPS: {
  label: string | null;
  items: {
    href: string;
    label: string;
    icon: typeof LayoutDashboard;
    /** Mostra o número de conversas com mensagem por ler. */
    unreadBadge?: boolean;
    /** Mostra o número de solicitações de campanha pendentes. */
    pendingBadge?: boolean;
  }[];
}[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Relacionamento",
    items: [
      { href: "/campaigns", label: "Campanhas", icon: Send },
      {
        href: "/solicitacoes",
        label: "Solicitações",
        icon: ClipboardList,
        pendingBadge: true,
      },
      {
        href: "/conversations",
        label: "Conversas",
        icon: MessagesSquare,
        unreadBadge: true,
      },
      { href: "/automations", label: "Automações", icon: Workflow },
      { href: "/news", label: "Avante News", icon: Newspaper },
      { href: "/reports", label: "Relatórios", icon: BarChart3 },
      { href: "/contacts", label: "Contatos", icon: Users },
      { href: "/lists", label: "Listas", icon: ListChecks },
    ],
  },
  {
    label: "Leads",
    items: [
      { href: "/leads", label: "Gestão de leads", icon: Magnet },
      { href: "/leads/pontuacao", label: "Pontuação", icon: Gauge },
      { href: "/leads/etapas", label: "Etapas do funil", icon: GitBranch },
      { href: "/leads/rastreio", label: "Rastreio do site", icon: Radar },
      { href: "/leads/origens", label: "Origens (webhook)", icon: Webhook },
    ],
  },
  {
    label: "Configuração",
    items: [
      { href: "/templates", label: "Templates", icon: FileCode2 },
      { href: "/whatsapp-templates", label: "WhatsApp", icon: MessageCircle },
      { href: "/users", label: "Usuários", icon: UserCog },
    ],
  },
];

function Brand() {
  // O middleware leva cada perfil ao seu início a partir do /dashboard.
  return (
    <Link href="/dashboard" aria-label="Campanhas Avante — início">
      <AvanteLogo type="horizontal" variant="blue" height={24} />
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<{
    name: string;
    email: string;
    role: Perfil;
  } | null>(null);
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(0);
  // No mobile o drawer fechado fica no DOM (deslocado): `inert` tira os ~15
  // links dele da ordem de tabulação. No desktop (md+) a sidebar é fixa.
  const [isMobile, setIsMobile] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // ESC fecha o drawer e devolve o foco ao botão que o abriu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) setMe(await res.json());
      } catch {
        // sem sessão: o middleware cuida do redirecionamento
      }
    })();
  }, []);

  const isAdmin = me?.role === "admin";

  // Menu do perfil: só os itens que ele alcança (a trava de verdade é o
  // middleware; aqui é só não mostrar porta fechada). Grupo vazio some.
  const grupos = NAV_GROUPS.map((group) => ({
    ...group,
    items: me
      ? group.items.filter((item) => rotaPermitida(me.role, item.href, "GET"))
      : [],
  })).filter((group) => group.items.length > 0);

  // Resposta nova no WhatsApp precisa ser vista de qualquer tela, não só de
  // quem está com a caixa de conversas aberta.
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/whatsapp/unread", { cache: "no-store" });
        if (res.ok && active) setUnread((await res.json()).unread ?? 0);
      } catch {
        // Sem rede: o número fica como estava até a próxima tentativa.
      }
    };
    load();
    const timer = setInterval(load, UNREAD_POLL_MS);
    document.addEventListener("visibilitychange", load);
    window.addEventListener(UNREAD_CHANGED_EVENT, load);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener(UNREAD_CHANGED_EVENT, load);
    };
  }, [isAdmin]);

  // Pedido de campanha novo, para o marketing ver de qualquer tela.
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/solicitacoes?contagem=pendentes", {
          cache: "no-store",
        });
        if (res.ok && active) setPending((await res.json()).pendentes ?? 0);
      } catch {
        // Sem rede: o número fica como estava até a próxima tentativa.
      }
    };
    load();
    const timer = setInterval(load, UNREAD_POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [isAdmin, pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // Fecha o drawer ao navegar (mobile).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Trava o scroll do body enquanto o drawer estiver aberto.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  return (
    <>
      {/* Top bar — só no mobile */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden print:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          aria-expanded={open}
          className="-ml-1 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Menu className="size-5" />
        </button>
        <Brand />
      </header>

      {/* Backdrop — só no mobile com drawer aberto */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-[#131820]/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Sidebar / drawer */}
      <aside
        inert={isMobile && !open ? true : undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card transition-transform duration-200 ease-out md:translate-x-0 print:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-6">
          <Brand />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              menuButtonRef.current?.focus();
            }}
            aria-label="Fechar menu"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {grupos.map((group, indice) => (
            <div key={group.label ?? "inicio"} className="grid gap-1">
              {group.label ? (
                <p
                  className={cn(
                    "px-3 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground/70",
                    indice > 0 ? "mt-3" : ""
                  )}
                >
                  {group.label}
                </p>
              ) : null}
              {group.items.map((item) => {
                // Igualdade exata para /leads: sem isso "Gestão de leads"
                // ficaria aceso junto com "Origens", que é filha na URL.
                const active =
                  pathname === item.href ||
                  (pathname.startsWith(`${item.href}/`) &&
                    !group.items.some(
                      (outro) =>
                        outro.href !== item.href &&
                        outro.href.startsWith(`${item.href}/`) &&
                        pathname.startsWith(outro.href)
                    ));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-accent text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                    {item.unreadBadge && unread > 0 ? (
                      <span
                        className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground"
                        aria-label={`${unread} conversa(s) com mensagem não lida`}
                      >
                        {unread > 99 ? "99+" : unread}
                      </span>
                    ) : null}
                    {item.pendingBadge && isAdmin && pending > 0 ? (
                      <span
                        className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[11px] font-bold text-foreground"
                        aria-label={`${pending} solicitação(ões) de campanha pendente(s)`}
                      >
                        {pending > 99 ? "99+" : pending}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-4">
          {me ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{me.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {me.email}
                </p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="Sair"
                aria-label="Sair do sistema"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Avante Soluções Digitais
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
