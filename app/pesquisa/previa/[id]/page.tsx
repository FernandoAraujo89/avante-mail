import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye } from "lucide-react";

import { CartaoDoPainel, MolduraPublica } from "@/components/pesquisas/moldura-publica";
import { PaginaDeResposta } from "@/components/pesquisas/pagina-de-resposta";
import { usuarioDaSessao } from "@/lib/escopo-parceiros";
import { paginaInicial } from "@/lib/perfis";
import { minutosEstimados } from "@/lib/pesquisas/etapas";
import { PARCEIRO_DE_EXEMPLO } from "@/lib/pesquisas/previa";
import { carregarPesquisaParaPrevia } from "@/lib/pesquisas/resposta-publica";
import { OBJETIVO_CHAMADA, OBJETIVO_CONVITE } from "@/lib/pesquisas/rotulos";

export const dynamic = "force-dynamic";

// A pesquisa com o layout REAL do parceiro, para a Expansão conferir antes de
// convidar. Mora sob /pesquisa/ (prefixo público no middleware, por causa do
// link do parceiro), então a própria página exige a sessão: admin e expansão.
// Nada aqui é gravado — não há convite, e a página de resposta roda em
// `modoPrevia`.
export const metadata: Metadata = {
  title: "Pré-visualização da pesquisa",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PreviaDaPesquisaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const usuario = await usuarioDaSessao();
  if (!usuario) redirect("/login");
  if (usuario.role !== "admin" && usuario.role !== "expansao") redirect(paginaInicial(usuario.role));

  const { id } = await params;
  const convite = UUID.test(id) ? await carregarPesquisaParaPrevia(id, PARCEIRO_DE_EXEMPLO) : null;

  if (!convite) {
    return (
      <MolduraPublica titulo="Pesquisa Avante" subtitulo="Pré-visualização">
        <div className="my-auto">
          <h2 className="text-2xl font-normal tracking-tight">Pesquisa não encontrada</h2>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Esta pesquisa não existe mais.{" "}
            <Link href="/pesquisas" className="text-primary underline-offset-4 hover:underline">
              Voltar para as pesquisas
            </Link>
            .
          </p>
        </div>
      </MolduraPublica>
    );
  }

  const total = convite.questions.filter((q) => q.type !== "section").length;

  return (
    <>
      {/* A faixa de prévia: a única coisa que o parceiro não vê. */}
      <div className="sticky top-0 z-30 bg-inverse text-inverse-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs sm:text-sm">
          <p className="flex min-w-0 flex-1 items-center gap-2">
            <Eye className="size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">Pré-visualização.</span>{" "}
              <span className="hidden sm:inline">É assim que o parceiro vê a pesquisa. Pode responder para testar — </span>
              nada é gravado.
            </span>
          </p>
          <nav className="flex items-center gap-4" aria-label="Voltar ao sistema">
            <Link href={`/pesquisas/${id}/editar`} className="whitespace-nowrap underline underline-offset-4 hover:text-inverse-muted">
              Editar pesquisa
            </Link>
            <Link href={`/pesquisas/${id}`} className="whitespace-nowrap underline underline-offset-4 hover:text-inverse-muted">
              Acompanhamento
            </Link>
          </nav>
        </div>
      </div>

      <MolduraPublica
        titulo={OBJETIVO_CHAMADA[convite.survey.objective]}
        subtitulo={OBJETIVO_CONVITE[convite.survey.objective]}
        rodape={
          <CartaoDoPainel
            titulo={convite.survey.name}
            linhas={[
              `Pesquisa para ${convite.contact.name}${convite.contact.company ? ` · ${convite.contact.company}` : ""}`,
              `${total} pergunta${total === 1 ? "" : "s"} · cerca de ${minutosEstimados(total)} min`,
              "Suas respostas ficam salvas — pode parar e voltar pelo mesmo link.",
            ]}
          />
        }
      >
        <PaginaDeResposta token="previa" convite={convite} modoPrevia />
      </MolduraPublica>
    </>
  );
}
