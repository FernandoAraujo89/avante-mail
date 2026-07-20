import Link from "next/link";
import { Pencil } from "lucide-react";
import { desc } from "drizzle-orm";

import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
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
import { renderVariables, SAMPLE_VARIABLES } from "@/lib/render";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  novidade: "Novidade",
  comunicado: "Comunicado",
  fiscal: "Fiscal",
};

export default async function TemplatesPage() {
  const db = getDb();
  const rows = await db
    .select()
    .from(templates)
    .orderBy(desc(templates.createdAt));

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
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
              <CardContent className="flex items-center gap-1">
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={
                      template.editorType === "builder"
                        ? `/templates/builder?id=${template.id}`
                        : `/templates/new?id=${template.id}`
                    }
                  >
                    <Pencil />
                    Editar
                  </Link>
                </Button>
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
    </>
  );
}
