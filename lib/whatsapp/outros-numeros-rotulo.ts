import { formatPhone } from "@/lib/phone";

// Como mostrar um número de outro sistema na tela — puro, sem banco, para ser
// testado à parte. O registro mora em lib/whatsapp/outros-numeros.ts.

export interface OutroNumero {
  phoneNumberId: string;
  /** Só dígitos, como a Meta manda (ex.: 553798658302). */
  displayPhoneNumber: string | null;
  /** Nome verificado na Meta (ex.: "Sucesso Avante Hub"). */
  verifiedName: string | null;
}

/**
 * O número como o Gerenciador do WhatsApp mostra. Número brasileiro de
 * empresa pode não ter o nono dígito (+55 37 8803-8198), e a biblioteca de
 * telefone recusa esse formato — então o Brasil é formatado aqui.
 */
export function formatarNumeroDeExibicao(digitos: string): string {
  const d = digitos.replace(/\D/g, "");
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`;
  return formatPhone(`+${d}`);
}

/**
 * Nome e telefone do número. Sem registro (evento anterior ao registro, ou
 * banco sem a tabela), fica o id da Meta — feio, mas identifica.
 */
export function rotuloDoOutroNumero(
  phoneNumberId: string,
  numero: OutroNumero | undefined
): { nome: string; telefone: string | null } {
  const telefone = numero?.displayPhoneNumber
    ? formatarNumeroDeExibicao(numero.displayPhoneNumber)
    : null;
  return {
    nome: numero?.verifiedName || telefone || `Número ${phoneNumberId}`,
    telefone,
  };
}
