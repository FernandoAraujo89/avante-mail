import { Badge } from "@/components/ui/badge";
import type { WhatsAppTemplateStatus } from "@/lib/whatsapp/types";

const STATUS_CONFIG: Record<
  WhatsAppTemplateStatus,
  {
    label: string;
    variant: "secondary" | "outline" | "info" | "warning" | "success" | "destructive";
  }
> = {
  draft: { label: "Rascunho", variant: "secondary" },
  pending: { label: "Em análise", variant: "info" },
  approved: { label: "Aprovado", variant: "success" },
  rejected: { label: "Rejeitado", variant: "destructive" },
  paused: { label: "Pausado", variant: "warning" },
  disabled: { label: "Desativado", variant: "outline" },
};

export function WhatsAppTemplateStatusBadge({
  status,
}: {
  status: WhatsAppTemplateStatus;
}) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
