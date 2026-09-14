import { CampaignWizard } from "@/components/campaigns/campaign-wizard";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{
    id?: string;
    duplicate?: string;
    /** Campanha de origem e grupo de resposta ("Nova campanha para este grupo"). */
    origem?: string;
    grupo?: string;
  }>;
}) {
  const { id, duplicate, origem, grupo } = await searchParams;
  const replyGroup =
    !id && !duplicate && origem && grupo
      ? { campaignId: origem, group: grupo }
      : undefined;

  return (
    <CampaignWizard
      key={id ?? duplicate ?? (replyGroup ? `${origem}:${grupo}` : "new")}
      editId={id}
      duplicateId={duplicate}
      replyGroup={replyGroup}
    />
  );
}
