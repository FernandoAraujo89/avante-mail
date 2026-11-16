import { EmailEnviado } from "@/components/reports/email-enviado";

export const dynamic = "force-dynamic";

export default async function CampaignEmailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <EmailEnviado
      id={id}
      kind="campaign"
      reportHref={`/campaigns/${id}/report`}
    />
  );
}
