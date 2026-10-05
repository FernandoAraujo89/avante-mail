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
    /** Solicitação do Sucesso do cliente e o canal a montar a partir dela. */
    solicitacao?: string;
    canal?: string;
  }>;
}) {
  const { id, duplicate, origem, grupo, solicitacao, canal } =
    await searchParams;
  const replyGroup =
    !id && !duplicate && origem && grupo
      ? { campaignId: origem, group: grupo }
      : undefined;
  const fromRequest =
    !id && !duplicate && !replyGroup && solicitacao
      ? {
          id: solicitacao,
          channel:
            canal === "whatsapp" ? ("whatsapp" as const) : ("email" as const),
        }
      : undefined;

  return (
    <CampaignWizard
      key={
        id ??
        duplicate ??
        (replyGroup
          ? `${origem}:${grupo}`
          : fromRequest
            ? `pedido:${solicitacao}:${fromRequest.channel}`
            : "new")
      }
      editId={id}
      duplicateId={duplicate}
      replyGroup={replyGroup}
      fromRequest={fromRequest}
    />
  );
}
