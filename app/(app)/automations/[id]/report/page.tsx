import { AutomationReport } from "@/components/automations/automation-report";
import type { ParametrosDaUrl } from "@/lib/paginacao-servidor";

export const dynamic = "force-dynamic";

export default async function AutomationReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParametrosDaUrl>;
}) {
  const { id } = await params;
  return <AutomationReport id={id} parametros={await searchParams} />;
}
