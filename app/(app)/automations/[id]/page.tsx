import { AutomationEditor } from "@/components/automations/automation-editor";

export const dynamic = "force-dynamic";

export default async function AutomationEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AutomationEditor automationId={id} />;
}
