import { CampaignWizard } from "@/components/campaigns/campaign-wizard";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; duplicate?: string }>;
}) {
  const { id, duplicate } = await searchParams;

  return (
    <CampaignWizard
      key={id ?? duplicate ?? "new"}
      editId={id}
      duplicateId={duplicate}
    />
  );
}
