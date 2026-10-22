import type { Metadata } from "next";

import { CartaoDoPainel, MolduraPublica } from "@/components/pesquisas/moldura-publica";
import { PaginaDeResposta } from "@/components/pesquisas/pagina-de-resposta";
import { tokenBemFormado } from "@/lib/pesquisas/convites";
import { minutosEstimados } from "@/lib/pesquisas/etapas";
import {
  carregarConvitePorToken,
  marcarAberto,
} from "@/lib/pesquisas/resposta-publica";
import { OBJETIVO_CHAMADA, OBJETIVO_CONVITE } from "@/lib/pesquisas/rotulos";

export const dynamic = "force-dynamic";

// Página PÚBLICA: o parceiro chega pelo link do convite, sem conta. Fora dos
// buscadores — o link é dele.
export const metadata: Metadata = {
  title: "Pesquisa",
  robots: { index: false, follow: false },
};

export default async function PesquisaPublicaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const convite = tokenBemFormado(token) ? await carregarConvitePorToken(token) : null;
  // Abriu o link: "convidado" vira "abriu" (só na primeira vez).
  if (convite) await marcarAberto(convite.invite.id, convite.invite.status);

  if (!convite) {
    return (
      <MolduraPublica
        titulo="Pesquisa Avante"
        subtitulo="Ouvimos os nossos parceiros para apoiar cada um do jeito certo."
      >
        <div className="my-auto">
          <h2 className="text-2xl font-bold tracking-tight">Link inválido</h2>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Este link de pesquisa não existe ou foi encerrado. Se você o recebeu da Avante,
            peça um novo à equipe que falou com você.
          </p>
        </div>
      </MolduraPublica>
    );
  }

  const total = convite.questions.filter((q) => q.type !== "section").length;

  return (
    // O painel fala da frente (texto fixo por objetivo); o texto de abertura
    // da pesquisa fica na coluna de resposta — sem repetir os dois lados.
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
      <PaginaDeResposta token={token} convite={convite} />
    </MolduraPublica>
  );
}
