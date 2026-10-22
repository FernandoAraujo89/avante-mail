import type { WhatsAppButton, WhatsAppTemplateStatus } from "@/lib/whatsapp/types";
import { dynamicUrlButtonIndex } from "@/lib/whatsapp/types";

// O convite por WhatsApp sai pela linha da Expansão com um modelo UTILITY
// aprovado que tenha um botão de link dinâmico (…/pesquisa/{{1}}): o fim do
// link é o token do parceiro. Puro — a tela e a API dizem "pronto" ou o
// motivo de não.

export interface ModeloParaConvite {
  name: string;
  status: WhatsAppTemplateStatus;
  buttons: WhatsAppButton[] | null;
}

export interface Prontidao {
  pronto: boolean;
  motivo: string | null;
}

export function modeloTemLinkDinamico(buttons: WhatsAppButton[] | null): boolean {
  return dynamicUrlButtonIndex(buttons) !== null;
}

export function prontidaoDoWhatsApp(
  modelo: ModeloParaConvite | null,
  linhaConfigurada: boolean
): Prontidao {
  if (!modelo) {
    return { pronto: false, motivo: "Escolha o modelo de WhatsApp do convite (em Perguntas)." };
  }
  if (modelo.status !== "approved") {
    return {
      pronto: false,
      motivo: `O modelo "${modelo.name}" ainda não foi aprovado pela Meta.`,
    };
  }
  if (!modeloTemLinkDinamico(modelo.buttons)) {
    return {
      pronto: false,
      motivo: `O modelo "${modelo.name}" precisa de um botão de link terminando em {{1}} — é por ele que vai o link de cada parceiro.`,
    };
  }
  if (!linhaConfigurada) {
    return {
      pronto: false,
      motivo: "O número Avante Expansão ainda não está configurado neste servidor.",
    };
  }
  return { pronto: true, motivo: null };
}
