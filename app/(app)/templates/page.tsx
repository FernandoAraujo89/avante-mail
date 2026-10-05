import Link from "next/link";
import { Code2, Pencil } from "lucide-react";
import { count, desc } from "drizzle-orm";

import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { PaginacaoNaUrl } from "@/components/paginacao";
import { NewTemplateButton } from "@/components/templates/new-template-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDb, templates } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { compileEmailContent } from "@/lib/mjml";
import { recortar } from "@/lib/paginacao";
import {
  paginacaoDaUrl,
  type ParametrosDaUrl,
} from "@/lib/paginacao-servidor";
import { renderVariables, SAMPLE_VARIABLES } from "@/lib/render";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  novidade: "Novidade",
  comunicado: "Comunicado",
  fiscal: "Fiscal",
};

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<ParametrosDaUrl>;
}) {
  const db = getDb();
  const pedido = await paginacaoDaUrl(await searchParams, "templates");
  const [{ total }] = await db.select({ total: count() }).from(templates);
  const { pagina, inicio } = recortar(total, pedido.pagina, pedido.linhas);

  // Só a página vai para o MJML: compilar cada template da base a cada visita
  // era o que mais pesava nesta tela.
  const rows = await db
    .select()
    .from(templates)
    .orderBy(desc(templates.createdAt), desc(templates.id))
    .limit(pedido.linhas)
    .offset(inicio);

  const withPreview = await Promise.all(
    rows.map(async (template) => {
      const rendered = renderVariables(template.mjmlContent, SAMPLE_VARIABLES);
      const { html } = await compileEmailContent(rendered);
      return { ...template, previewHtml: html };
    })
  );

  return (
    <>
      <PageHeader
        title="Templates"
        description="Modelos reutilizados pelas campanhas — visuais ou em código."
      >
        <NewTemplateButton />
      </PageHeader>

      {withPreview.length === 0 ? (
        <Card>
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhum template ainda. Crie o primeiro para poder disparar
            campanhas.
          </p>
        </Card>
      ) : (
        <div
          id="lista-de-templates"
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {withPreview.map((template) => (
            <Card key={template.id} className="overflow-hidden">
              <iframe
                srcDoc={template.previewHtml}
                sandbox=""
                title={`Preview do template ${template.name}`}
                className="h-64 w-full border-b border-border bg-white"
                style={{ pointerEvents: "none" }}
              />
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate">{template.name}</CardTitle>
                  <div className="flex shrink-0 gap-1.5">
                    <Badge variant="outline">
                      {template.editorType === "builder" ? "Criador" : "Código"}
                    </Badge>
                    {template.category ? (
                      <Badge variant="warning">
                        {CATEGORY_LABELS[template.category] ??
                          template.category}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <CardDescription>
                  Criado em {formatDate(template.createdAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-1">
                {/* Editar abre sempre o criador visual — inclusive para os
                    templates de código, que são importados em seções
                    editáveis. Quem quer o código continua tendo o botão ao
                    lado. */}
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/templates/builder?id=${template.id}`}>
                    <Pencil />
                    Editar
                  </Link>
                </Button>
                {template.editorType === "builder" ? null : (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/templates/new?id=${template.id}`}>
                      <Code2 />
                      Código
                    </Link>
                  </Button>
                )}
                <DeleteButton
                  endpoint={`/api/templates/${template.id}`}
                  title="Excluir template"
                  description={`Tem certeza que deseja excluir o template "${template.name}"? Campanhas que o utilizam ficarão sem template (o histórico delas é mantido). Esta ação não pode ser desfeita.`}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <PaginacaoNaUrl
        chave="templates"
        idDaLista="lista-de-templates"
        total={total}
        pagina={pagina}
        linhas={pedido.linhas}
        rotulo="Itens por página"
        className="mt-6"
      />
    </>
  );
}
