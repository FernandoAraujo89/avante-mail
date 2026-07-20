import { Badge } from "@/components/ui/badge";
import type { CampaignStatus, SendStatus } from "@/lib/db/schema";

const CAMPAIGN_STATUS: Record<
  CampaignStatus,
  { label: string; variant: "secondary" | "info" | "warning" | "success" }
> = {
  draft: { label: "Rascunho", variant: "secondary" },
  scheduled: { label: "Agendada", variant: "info" },
  sending: { label: "Enviando", variant: "warning" },
  sent: { label: "Enviada", variant: "success" },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const config = CAMPAIGN_STATUS[status] ?? CAMPAIGN_STATUS.draft;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

const SEND_STATUS: Record<
  SendStatus,
  {
    label: string;
    variant: "secondary" | "outline" | "success" | "info" | "destructive" | "warning";
  }
> = {
  pending: { label: "Pendente", variant: "outline" },
  sent: { label: "Enviado", variant: "secondary" },
  failed: { label: "Falhou", variant: "destructive" },
  opened: { label: "Aberto", variant: "info" },
  clicked: { label: "Clicado", variant: "success" },
  bounced: { label: "Devolvido", variant: "destructive" },
};

export function SendStatusBadge({ status }: { status: SendStatus }) {
  const config = SEND_STATUS[status] ?? SEND_STATUS.pending;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
