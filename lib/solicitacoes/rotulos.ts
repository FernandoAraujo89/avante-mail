// Rótulos e o formato que a tela recebe. Sem banco: a página importa daqui.
import type {
  CampaignRequestChannel,
  CampaignRequestStatus,
} from "@/lib/db/schema";

export const STATUS_LABEL: Record<CampaignRequestStatus, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  recusada: "Recusada",
};

export const CANAL_LABEL: Record<CampaignRequestChannel, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
};

export type SolicitacaoDto = {
  id: string;
  title: string;
  channels: CampaignRequestChannel[];
  lists: { id: string; name: string | null }[];
  briefing: string;
  desiredAt: string | null;
  status: CampaignRequestStatus;
  responseNote: string | null;
  requestedBy: { id: string; name: string } | null;
  handledBy: { id: string; name: string } | null;
  campaignId: string | null;
  createdAt: string;
  updatedAt: string;
};
