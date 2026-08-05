import type { Contact } from "@/lib/db";

import { entregar, validarDestino } from "./webhook-saida";

/**
 * O passo "Webhook" de uma automação: avisa um sistema de fora sobre este lead.
 *
 * O corpo é ESTÁVEL e documentado. Quem monta um cenário no Make casa os campos
 * uma vez e não quer vê-los mudar de nome — então este formato é contrato, não
 * detalhe de implementação. Campos novos podem ser acrescentados; os que estão
 * aqui não mudam de nome nem de tipo.
 */
export interface CorpoDoWebhook {
  /** Nome dado ao passo na tela — o que o cenário usa para se ramificar. */
  evento: string;
  enviadoEm: string;
  contato: {
    id: string;
    nome: string;
    email: string;
    telefone: string | null;
    empresa: string | null;
    estagio: string | null;
    tags: string[];
    pontuacao: number | null;
    faixa: string | null;
    canalDeOrigem: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    aceitaEmail: boolean;
    aceitaWhatsapp: boolean;
  };
  automacao: { percursoId: string };
}

export function montarCorpo(
  evento: string,
  contato: Contact,
  runId: string
): CorpoDoWebhook {
  return {
    evento,
    enviadoEm: new Date().toISOString(),
    contato: {
      id: contato.id,
      nome: contato.name,
      email: contato.email,
      telefone: contato.phone,
      empresa: contato.company,
      estagio: contato.stage,
      tags: contato.tags ?? [],
      pontuacao: contato.leadScore,
      faixa: contato.leadScoreBand,
      canalDeOrigem: contato.sourceChannel,
      utmSource: contato.utmSource,
      utmMedium: contato.utmMedium,
      utmCampaign: contato.utmCampaign,
      // O consentimento vai junto porque o CRM do outro lado precisa dele para
      // decidir se pode falar com a pessoa. Mandar o contato sem essa
      // informação é convidar o outro sistema a errar por nossa causa.
      aceitaEmail: contato.subscribed && !contato.emailOptOutAt,
      aceitaWhatsapp: contato.whatsappSubscribed,
    },
    automacao: { percursoId: runId },
  };
}

export async function chamarWebhookDoPasso(args: {
  config: Record<string, unknown> | null;
  contato: Contact;
  runId: string;
}): Promise<Record<string, unknown>> {
  const config = args.config ?? {};
  const cru = typeof config.url === "string" ? config.url.trim() : "";
  if (!cru) throw new Error("passo de webhook sem URL configurada");

  const evento =
    typeof config.evento === "string" && config.evento.trim()
      ? config.evento.trim().slice(0, 60)
      : "lead";

  // A validação acontece A CADA execução, não só ao salvar o passo: o DNS do
  // destino pode ter mudado desde então, e a allowlist do servidor também.
  const destino = await validarDestino(cru);
  if (!destino.ok) {
    throw new Error(`webhook recusado: ${destino.motivo}`);
  }

  const corpo = JSON.stringify(montarCorpo(evento, args.contato, args.runId));
  const resultado = await entregar(destino.url, corpo);

  if (!resultado.ok) {
    throw new Error(
      `webhook falhou (${resultado.tentativas} tentativa${
        resultado.tentativas === 1 ? "" : "s"
      }): ${resultado.erro}`
    );
  }

  // Vai para o log do passo e aparece no relatório da automação. O host, e não
  // a URL inteira: caminhos de webhook do Make carregam a chave da integração.
  return {
    evento,
    destino: destino.url.host,
    status: resultado.status,
    ms: resultado.ms,
    tentativas: resultado.tentativas,
  };
}
