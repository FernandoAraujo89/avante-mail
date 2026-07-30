import { SendReport } from "@/components/reports/send-report";

export const dynamic = "force-dynamic";

export default async function NewsReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <SendReport
      id={id}
      kind="news"
      backHref="/news"
      backLabel="Voltar para o Avante News"
    />
  );
}
