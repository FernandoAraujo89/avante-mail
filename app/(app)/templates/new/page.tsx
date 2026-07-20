import { promises as fs } from "fs";
import path from "path";

import { TemplateForm } from "@/components/templates/template-form";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  const baseMjml = await fs.readFile(
    path.join(process.cwd(), "lib", "templates", "base.mjml"),
    "utf-8"
  );

  return <TemplateForm baseMjml={baseMjml} templateId={id} />;
}
