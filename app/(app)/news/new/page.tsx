import Link from "next/link";

import { NewsWizard } from "@/components/news/news-wizard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { resolveNewsList } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function NewNewsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; duplicate?: string }>;
}) {
  const { id, duplicate } = await searchParams;
  const audience = await resolveNewsList();

  // Sem lista de parceiros White Label Ativos não existe Avante News.
  if (!audience) {
    return (
      <>
        <PageHeader
          title="Nova edição do Avante News"
          description="Boletim semanal dos parceiros White Label."
        />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">
              Defina a lista de parceiros White Label Ativos
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              O Avante News vai sempre para essa lista. Escolha qual das suas
              listas é a dos parceiros ativos para liberar a criação de edições.
            </p>
            <Button asChild className="mt-5">
              <Link href="/news">Escolher a lista</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <NewsWizard
      key={id ?? duplicate ?? "new"}
      audience={audience}
      editId={id}
      duplicateId={duplicate}
    />
  );
}
