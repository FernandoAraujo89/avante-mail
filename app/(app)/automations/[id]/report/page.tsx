import { AutomationReport } from "@/components/automations/automation-report";

export const dynamic = "force-dynamic";

export default async function AutomationReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AutomationReport id={id} />;
}
