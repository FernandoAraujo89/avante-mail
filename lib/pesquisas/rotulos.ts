// Rótulos e o formato que as telas recebem. Sem banco: as páginas importam daqui.
import type {
  SurveyInviteStatus,
  SurveyObjective,
  SurveyQuestionOptions,
  SurveyQuestionType,
  SurveyStatus,
} from "@/lib/db/schema";
import type { WhatsAppVariableMap } from "@/lib/whatsapp/types";

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

/** A chamada do painel azul da página de resposta, por frente. */
export const OBJETIVO_CHAMADA: Record<SurveyObjective, string> = {
  dados_empresa: "Vamos conhecer melhor a sua empresa",
  nps: "Sua opinião orienta o que a Avante faz em seguida",
  crescimento: "Vamos fazer a sua empresa crescer",
};

/** O que a página diz quando a pesquisa não tem texto de abertura. */
export const OBJETIVO_CONVITE: Record<SurveyObjective, string> = {
  dados_empresa:
    "Com a realidade da sua empresa em mãos, a Avante consegue apoiar você do jeito certo.",
  nps: "Poucas perguntas, respostas sinceras: é assim que a Avante melhora.",
  crescimento:
    "Conte onde quer chegar e onde a Avante pode ajudar — a Expansão volta a falar com você.",
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
  whatsappVariables: WhatsAppVariableMap | null;
  /** O convite por WhatsApp pode sair? (modelo pronto + linha configurada) */
  whatsapp: { pronto: boolean; motivo: string | null };
  questions: PerguntaDto[];
};
