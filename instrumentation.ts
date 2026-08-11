// Hook de inicialização do Next.js: roda uma vez, quando o servidor sobe.
//
// Serve para conferir configuração ANTES de a app aceitar tráfego. Canal mal
// configurado que só falha no primeiro disparo é o pior desfecho: a campanha
// sai pela metade e o erro aparece para o cliente, não para nós.

export async function register() {
  // O runtime edge não tem acesso ao mesmo process.env nem roda os workers.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertSmsEnv, isSmsEnabled } = await import("@/lib/sms/config");

  // Só valida o que está ligado. Canal desligado não impede a app de subir —
  // e-mail e WhatsApp não dependem disto.
  assertSmsEnv();

  if (isSmsEnabled()) {
    console.log("[SMS] Canal Twilio configurado.");
  }
}
