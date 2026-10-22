import type { Metadata } from "next";

import { AvanteLogo } from "@/components/avante-logo";
import { PaginaDeResposta } from "@/components/pesquisas/pagina-de-resposta";
import { Card } from "@/components/ui/card";
import { tokenBemFormado } from "@/lib/pesquisas/convites";
import {
  carregarConvitePorToken,
  marcarAberto,
} from "@/lib/pesquisas/resposta-publica";

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

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
        <div className="mb-6 flex items-center justify-center">
          <AvanteLogo type="horizontal" variant="blue" height={26} />
        </div>

        {convite ? (
          <PaginaDeResposta token={token} convite={convite} />
        ) : (
          <Card className="p-6 text-center">
            <h1 className="text-xl font-bold">Link inválido</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Este link de pesquisa não existe ou foi encerrado. Se você o recebeu da
              Avante, peça um novo à equipe que falou com você.
            </p>
          </Card>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Avante Soluções Digitais · Formiga, MG
        </p>
      </div>
    </div>
  );
}
