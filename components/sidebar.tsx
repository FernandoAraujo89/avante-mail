"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  FileCode2,
  Gauge,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Magnet,
  Menu,
  MessageCircle,
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
import { cn } from "@/lib/utils";

// O menu é agrupado por ÁREA, e não uma lista corrida, porque as áreas têm
// públicos diferentes: "Relacionamento" fala com parceiro, cliente e
// colaborador; "Leads" é a captação, que não recebe campanha (as travas da
// fase B — docs/plano-webhooks-leads.md). Ver os dois grupos separados no menu
// é o que impede alguém tratar lead como se fosse parceiro.
const NAV_GROUPS: {
  label: string | null;
  items: { href: string; label: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Relacionamento",
    items: [
      { href: "/campaigns", label: "Campanhas", icon: Send },
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
  return (
    <Link href="/dashboard" aria-label="Campanhas Avante — início">
      <AvanteLogo type="horizontal" variant="blue" height={24} />
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<{ name: string; email: string } | null>(null);

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
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
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
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card transition-transform duration-200 ease-out md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-6">
          <Brand />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {NAV_GROUPS.map((group, indice) => (
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
