import { Badge } from "@/components/ui/badge";
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
  // Canal WhatsApp (confirmações da Cloud API).
  delivered: { label: "Entregue", variant: "info" },
  read: { label: "Lida", variant: "success" },
};

/** Rótulo do status fora do selo (filtros, listas). Mesma fonte do badge. */
export function sendStatusLabel(status: string): string {
  return (
    (SEND_STATUS as Record<string, { label: string } | undefined>)[status]
      ?.label ?? status
  );
}

export function SendStatusBadge({ status }: { status: SendStatus }) {
  const config = SEND_STATUS[status] ?? SEND_STATUS.pending;
  return <Badge variant={config.variant}>{config.label}</Badge>;
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
