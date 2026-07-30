// Tradução dos códigos da Cloud API para a linguagem de quem opera a campanha.
// Sem isto o relatório mostra "Erro 131049", que não diz o que houve nem o que
// fazer. É também a fonte única do que pode ser reenviado mais tarde: o botão
// de reenvio e a API usam `retriableLater` daqui.

export interface WhatsAppErrorInfo {
  /** Rótulo curto, para o selo na tabela. */
  label: string;
  /** O que aconteceu e, quando cabe, o que fazer a respeito. */
  explanation: string;
  /** Reenviar depois tem chance real de dar certo (nada mudou na conta). */
  retriableLater: boolean;
  tone: "warning" | "destructive";
}

const ERRORS: Record<number, WhatsAppErrorInfo> = {
  // ── A Meta segurou; tentar de novo mais tarde costuma resolver ──────────
  131049: {
    label: "Limite do destinatário",
    explanation:
      "A Meta segurou a mensagem para não sobrecarregar este contato com marketing. Não é falha técnica nem custou nada: reenvie mais tarde ou use um modelo de Utilidade.",
    retriableLater: true,
    tone: "warning",
  },
  131056: {
    label: "Muitas mensagens ao contato",
    explanation:
      "Mensagens demais para este mesmo contato em pouco tempo. Reenvie mais tarde.",
    retriableLater: true,
    tone: "warning",
  },
  130429: {
    label: "Vazão excedida",
    explanation:
      "A Meta limitou a velocidade de envio no momento. Reenvie mais tarde.",
    retriableLater: true,
    tone: "warning",
  },
  131016: {
    label: "Serviço sobrecarregado",
    explanation:
      "O serviço da Meta estava sobrecarregado. Reenvie mais tarde.",
    retriableLater: true,
    tone: "warning",
  },
  131000: {
    label: "Erro temporário da Meta",
    explanation:
      "A Meta devolveu um erro genérico, normalmente passageiro. Reenvie mais tarde.",
    retriableLater: true,
    tone: "warning",
  },

  // ── Problema do número do destinatário ─────────────────────────────────
  131026: {
    label: "Número não recebe",
    explanation:
      "O número não pode receber: pode não ter WhatsApp, estar inativo ou ter bloqueado a empresa. Confira o telefone do contato.",
    retriableLater: false,
    tone: "warning",
  },
  131021: {
    label: "Destinatário inválido",
    explanation:
      "O destinatário é o próprio número que envia as campanhas.",
    retriableLater: false,
    tone: "warning",
  },
  131047: {
    label: "Fora da janela de 24h",
    explanation:
      "Passaram-se mais de 24 horas desde a última mensagem do contato — nesse caso só um modelo aprovado pode ser enviado.",
    retriableLater: false,
    tone: "warning",
  },

  // ── Exige ação na conta da Meta ou no sistema ──────────────────────────
  0: {
    label: "Falha de autenticação",
    explanation:
      "A Meta recusou a autenticação. O token do WhatsApp no servidor precisa ser renovado.",
    retriableLater: false,
    tone: "destructive",
  },
  3: {
    label: "Sem permissão",
    explanation:
      "O aplicativo não tem permissão para enviar por esta conta do WhatsApp.",
    retriableLater: false,
    tone: "destructive",
  },
  10: {
    label: "Permissão negada",
    explanation: "A Meta negou permissão para esta operação.",
    retriableLater: false,
    tone: "destructive",
  },
  190: {
    label: "Token expirado",
    explanation:
      "O token de acesso do WhatsApp expirou ou foi revogado. Gere um novo token permanente e atualize o servidor.",
    retriableLater: false,
    tone: "destructive",
  },
  368: {
    label: "Conta bloqueada",
    explanation:
      "A conta está temporariamente bloqueada pela Meta por violação de política.",
    retriableLater: false,
    tone: "destructive",
  },
  100: {
    label: "Parâmetro inválido",
    explanation: "A Meta recusou um dos dados enviados.",
    retriableLater: false,
    tone: "destructive",
  },
  131005: {
    label: "Acesso negado",
    explanation: "A Meta negou o acesso para este envio.",
    retriableLater: false,
    tone: "destructive",
  },
  131008: {
    label: "Dado obrigatório ausente",
    explanation: "Faltou um dado obrigatório no envio.",
    retriableLater: false,
    tone: "destructive",
  },
  131009: {
    label: "Dado inválido",
    explanation: "Um dos valores enviados à Meta é inválido.",
    retriableLater: false,
    tone: "destructive",
  },
  131031: {
    label: "Conta bloqueada",
    explanation:
      "A conta do WhatsApp Business está bloqueada pela Meta.",
    retriableLater: false,
    tone: "destructive",
  },
  131042: {
    label: "Problema de pagamento",
    explanation:
      "Há um problema com a forma de pagamento da conta do WhatsApp. Revise a cobrança no Gerenciador da Meta.",
    retriableLater: false,
    tone: "destructive",
  },
  131045: {
    label: "Número não registrado",
    explanation:
      "O número de envio não está registrado corretamente na Cloud API.",
    retriableLater: false,
    tone: "destructive",
  },
  133010: {
    label: "Número não registrado",
    explanation: "O número de envio não está registrado na Cloud API.",
    retriableLater: false,
    tone: "destructive",
  },
  131048: {
    label: "Limite por qualidade",
    explanation:
      "O número de envio atingiu o limite da Meta por qualidade ou denúncias de spam.",
    retriableLater: false,
    tone: "destructive",
  },
  131051: {
    label: "Tipo não suportado",
    explanation: "Este tipo de mensagem não é suportado.",
    retriableLater: false,
    tone: "destructive",
  },

  // ── Problema no modelo da mensagem ─────────────────────────────────────
  132000: {
    label: "Variáveis não batem",
    explanation:
      "A quantidade de variáveis enviadas é diferente da que o modelo aprovado espera.",
    retriableLater: false,
    tone: "destructive",
  },
  132001: {
    label: "Modelo não existe",
    explanation:
      "O modelo não existe nesse idioma na conta da Meta. Sincronize os modelos.",
    retriableLater: false,
    tone: "destructive",
  },
  132005: {
    label: "Texto longo demais",
    explanation:
      "Com os valores das variáveis, o texto final ficou maior que o permitido.",
    retriableLater: false,
    tone: "destructive",
  },
  132007: {
    label: "Conteúdo recusado",
    explanation: "O conteúdo viola as políticas da Meta.",
    retriableLater: false,
    tone: "destructive",
  },
  132012: {
    label: "Formato inválido",
    explanation:
      "O formato de uma variável não é o esperado pelo modelo.",
    retriableLater: false,
    tone: "destructive",
  },
  132015: {
    label: "Modelo pausado",
    explanation:
      "A Meta pausou este modelo por baixa qualidade. Use outro modelo.",
    retriableLater: false,
    tone: "destructive",
  },
  132016: {
    label: "Modelo desativado",
    explanation: "A Meta desativou este modelo.",
    retriableLater: false,
    tone: "destructive",
  },
};

/** Descrição de um código de erro; desconhecidos caem num texto genérico. */
export function describeWhatsAppError(
  code: string | number | null,
  providerMessage?: string | null
): WhatsAppErrorInfo {
  const numeric = typeof code === "string" ? Number(code) : code;
  if (numeric !== null && !Number.isNaN(numeric) && ERRORS[numeric]) {
    return ERRORS[numeric];
  }
  return {
    label: code ? `Erro ${code}` : "Falha no envio",
    explanation:
      providerMessage?.trim() ||
      "A Meta recusou o envio e não detalhou o motivo.",
    retriableLater: false,
    tone: "destructive",
  };
}

/** Códigos em que vale reenviar mais tarde — usado pela API de reenvio. */
export const RESENDABLE_ERROR_CODES = Object.entries(ERRORS)
  .filter(([, info]) => info.retriableLater)
  .map(([code]) => code);

export function isResendableErrorCode(code: string | null): boolean {
  return code !== null && RESENDABLE_ERROR_CODES.includes(code);
}

/**
 * O que aconteceu com a mensagem, em uma frase — para o relatório nunca
 * deixar o usuário adivinhando.
 */
export function describeSendOutcome(
  status: string,
  errorCode: string | null,
  errorMessage: string | null
): { text: string; tone: "muted" | "warning" | "destructive" } {
  switch (status) {
    case "pending":
      return { text: "Na fila, aguardando o envio.", tone: "muted" };
    case "sent":
      return {
        text: "Enviada: a Meta aceitou e ainda não confirmou a entrega.",
        tone: "muted",
      };
    case "delivered":
      return { text: "Entregue no aparelho do contato.", tone: "muted" };
    case "read":
      return { text: "Lida pelo contato.", tone: "muted" };
    case "failed": {
      const info = describeWhatsAppError(errorCode, errorMessage);
      return { text: info.explanation, tone: info.tone };
    }
    default:
      return { text: "Situação desconhecida.", tone: "muted" };
  }
}
