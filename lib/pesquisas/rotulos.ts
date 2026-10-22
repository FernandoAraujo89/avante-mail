// Rótulos e o formato que as telas recebem. Sem banco: as páginas importam daqui.
import type {
  SurveyInviteStatus,
  SurveyObjective,
  SurveyQuestionOptions,
  SurveyQuestionType,
  SurveyStatus,
} from "@/lib/db/schema";

export const OBJETIVO_LABEL: Record<SurveyObjective, string> = {
  dados_empresa: "Dados da empresa",
  nps: "Satisfação (NPS)",
  crescimento: "Crescimento",
};

export const OBJETIVO_DESCRICAO: Record<SurveyObjective, string> = {
  dados_empresa:
    "Entender a realidade e o estado atual da empresa do parceiro.",
  nps: "Medir o nível de satisfação do parceiro com a Avante.",
  crescimento:
    "Descobrir melhorias e ações que ajudem a empresa do parceiro a crescer.",
};

export const STATUS_LABEL: Record<SurveyStatus, string> = {
  draft: "Rascunho",
  active: "Ativa",
  closed: "Encerrada",
};

export const TIPO_LABEL: Record<SurveyQuestionType, string> = {
  section: "Seção (título)",
  short_text: "Texto curto",
  long_text: "Texto longo",
  number: "Número",
  single_choice: "Escolha única",
  multiple_choice: "Múltipla escolha",
  scale: "Escala",
  yes_no: "Sim ou não",
};

export const CONVITE_STATUS_LABEL: Record<SurveyInviteStatus, string> = {
  pending: "Convidado",
  opened: "Abriu",
  in_progress: "Respondendo",
  completed: "Concluída",
  closed: "Encerrado",
};

export type PerguntaDto = {
  id: string;
  position: number;
  type: SurveyQuestionType;
  label: string;
  help: string | null;
  required: boolean;
  options: SurveyQuestionOptions | null;
  isNps: boolean;
  /** Quantos convites já responderam esta pergunta (congela o tipo). */
  answerCount: number;
};

export type PesquisaResumoDto = {
  id: string;
  objective: SurveyObjective;
  name: string;
  status: SurveyStatus;
  /** Perguntas ativas que pedem resposta (seção não conta). */
  questionCount: number;
  inviteCount: number;
  completedCount: number;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PesquisaDto = PesquisaResumoDto & {
  intro: string | null;
  thanks: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  whatsappTemplateId: string | null;
  questions: PerguntaDto[];
};
