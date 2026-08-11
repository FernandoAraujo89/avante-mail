// Configuração do canal SMS (Twilio), lida só de variáveis de ambiente.
//
// REGRA DE OURO: nenhum segredo aparece em log, em mensagem de erro ou em
// resposta de API. As funções daqui falam sobre os NOMES das variáveis, nunca
// sobre os valores.
//
// Duas credenciais, dois papéis — trocá-los é o erro clássico:
//  · API Key SID + Secret  → autenticam as CHAMADAS à API (envio).
//  · Auth Token            → valida a ASSINATURA dos webhooks que chegam.
// O Auth Token não autentica chamada nenhuma aqui: a API Key é Restricted
// (Read/List/Create só em "messages"), que é o mínimo necessário para o canal.

const PREFIXOS: Record<string, string> = {
  TWILIO_ACCOUNT_SID: "AC",
  TWILIO_API_KEY_SID: "SK",
  TWILIO_SMS_MESSAGING_SERVICE_SID: "MG",
};

/** Obrigatórias quando o canal está ligado. */
const OBRIGATORIAS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_SMS_MESSAGING_SERVICE_SID",
  "TWILIO_STATUS_CALLBACK_URL",
] as const;

export interface SmsConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  /** Só para validar assinatura de webhook — nunca para chamar a API. */
  authToken: string;
  messagingServiceSid: string;
  statusCallbackUrl: string;
  /**
   * Número do pool, informativo. O envio usa SEMPRE o Messaging Service: é
   * ele que dá o pool de remetentes, o opt-out avançado e a troca de número
   * sem mexer no código.
   */
  from: string | null;
  /** Mensagens por segundo do worker. Long code entrega ~1/s na prática. */
  maxSendRate: number;
}

function valor(nome: string): string {
  return (process.env[nome] ?? "").trim();
}

/** O canal só existe quando explicitamente ligado. */
export function isSmsEnabled(): boolean {
  return valor("TWILIO_SMS_ENABLED").toLowerCase() === "true";
}

/**
 * Confere as variáveis do canal. Devolve a lista de problemas (vazia = tudo
 * certo) sem nunca citar valores.
 */
export function validateSmsEnv(): string[] {
  if (!isSmsEnabled()) return [];

  const problemas: string[] = [];

  for (const nome of OBRIGATORIAS) {
    if (!valor(nome)) {
      problemas.push(`${nome} não definida`);
      continue;
    }
    const prefixo = PREFIXOS[nome];
    if (prefixo && !valor(nome).startsWith(prefixo)) {
      // Pega o erro mais comum do setup: colar o Account SID no lugar do
      // Messaging Service, ou o SID da API Key no lugar do Secret.
      problemas.push(`${nome} deveria começar com "${prefixo}"`);
    }
  }

  const callback = valor("TWILIO_STATUS_CALLBACK_URL");
  if (callback && !callback.startsWith("https://")) {
    // A Twilio recusa callback em http — o erro apareceria só no primeiro
    // envio real, como status que nunca atualiza.
    problemas.push("TWILIO_STATUS_CALLBACK_URL precisa ser https://");
  }

  return problemas;
}

/**
 * Falha rápido na inicialização. Mensagem nomeia o que falta e diz como
 * desligar o canal — derrubar a app inteira sem explicação seria pior do que
 * o problema que estamos evitando.
 */
export function assertSmsEnv(): void {
  const problemas = validateSmsEnv();
  if (problemas.length === 0) return;

  throw new Error(
    [
      "Canal SMS (Twilio) está ligado mas mal configurado:",
      ...problemas.map((p) => `  · ${p}`),
      "",
      "Preencha as variáveis no .env.local (ou no .env.local do servidor, em",
      "produção) ou defina TWILIO_SMS_ENABLED=false para desligar o canal.",
    ].join("\n")
  );
}

/**
 * Configuração pronta para uso. Lança se o canal estiver desligado ou
 * incompleto — quem chama já deve ter passado por isSmsEnabled().
 */
export function getSmsConfig(): SmsConfig {
  if (!isSmsEnabled()) {
    throw new Error("Canal SMS desligado (TWILIO_SMS_ENABLED != true).");
  }
  assertSmsEnv();

  const taxa = Number(valor("TWILIO_SMS_MAX_SEND_RATE"));

  return {
    accountSid: valor("TWILIO_ACCOUNT_SID"),
    apiKeySid: valor("TWILIO_API_KEY_SID"),
    apiKeySecret: valor("TWILIO_API_KEY_SECRET"),
    authToken: valor("TWILIO_AUTH_TOKEN"),
    messagingServiceSid: valor("TWILIO_SMS_MESSAGING_SERVICE_SID"),
    statusCallbackUrl: valor("TWILIO_STATUS_CALLBACK_URL"),
    from: valor("TWILIO_SMS_FROM") || null,
    maxSendRate: Number.isFinite(taxa) && taxa > 0 ? taxa : 1,
  };
}
