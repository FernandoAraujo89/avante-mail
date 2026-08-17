import { Badge } from "@/components/ui/badge";
import { sendStatusLabel } from "@/lib/send-status";
import type {
  AutomationStatus,
  CampaignStatus,
  SendStatus,
} from "@/lib/db/schema";

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

// Só a cor mora aqui; o rótulo vem de lib/send-status.ts, que o filtro do
// relatório e a exportação em planilha também usam.
const SEND_STATUS_VARIANT: Record<
  SendStatus,
  "secondary" | "outline" | "success" | "info" | "destructive" | "warning"
> = {
  pending: "outline",
  sent: "secondary",
  failed: "destructive",
  opened: "info",
  clicked: "success",
  bounced: "destructive",
  // Canal WhatsApp (confirmações da Cloud API).
  delivered: "info",
  read: "success",
};

/** Rótulo do status fora do selo (filtros, listas, planilha). */
export { sendStatusLabel };

export function SendStatusBadge({ status }: { status: SendStatus }) {
  return (
    <Badge variant={SEND_STATUS_VARIANT[status] ?? "outline"}>
      {sendStatusLabel(status)}
    </Badge>
  );
}

const AUTOMATION_STATUS: Record<
  AutomationStatus,
  { label: string; variant: "secondary" | "success" | "warning" | "outline" }
> = {
  draft: { label: "Rascunho", variant: "secondary" },
  active: { label: "Ativa", variant: "success" },
  paused: { label: "Pausada", variant: "warning" },
  archived: { label: "Arquivada", variant: "outline" },
};

export function AutomationStatusBadge({ status }: { status: AutomationStatus }) {
  const config = AUTOMATION_STATUS[status] ?? AUTOMATION_STATUS.draft;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
