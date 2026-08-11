// Normalizador de celular brasileiro para SMS (E.164).
//
// Por que não reusar normalizePhone de lib/phone.ts: aquele aceita telefone
// FIXO, e com razão — serve para cadastro de contato. SMS enviado para fixo é
// dinheiro jogado fora (a Twilio devolve o erro 21614 e a mensagem morre), e
// número de fixo em base de marketing é comum. Aqui a regra é estrita: ou é
// celular brasileiro válido, ou é rejeitado com motivo.
//
// A base real tem de tudo: "(37) 99947-2264", "37999472264", "5537999472264",
// "+55 37 99947 2264", "037 9947-2264" (sem o nono dígito, anterior a 2016) e
// "37 99947-2264 / 37 3241-0000" (dois números na mesma célula). Todos esses
// casos entram aqui, porque é isso que chega de planilha.
//
// Funções puras: nada de I/O, nada de env. São o alicerce testável do canal.

import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * DDDs que existem no Plano Geral de Códigos Nacionais da Anatel. A lista é
 * fechada de propósito: sem ela, "01" e "99999999999" viram números plausíveis
 * e só a operadora descobre o erro — cobrando por isso.
 */
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, 47, 48, 49, // PR/SC
  51, 53, 54, 55, // RS
  61, 62, 63, 64, 65, 66, 67, 68, 69, // Centro-Oeste/Norte
  71, 73, 74, 75, 77, 79, // BA/SE
  81, 82, 83, 84, 85, 86, 87, 88, 89, // Nordeste
  91, 92, 93, 94, 95, 96, 97, 98, 99, // Norte/Nordeste
]);

export type MotivoRejeicao =
  /** Vazio, nulo ou sem dígito nenhum. */
  | "vazio"
  /** Veio com DDI explícito de outro país (+1, 0044…). */
  | "internacional"
  /** Quantidade de dígitos que não corresponde a nenhum formato brasileiro. */
  | "formato"
  /** DDD inexistente. */
  | "ddd"
  /** É telefone fixo — SMS não chega. */
  | "fixo"
  /** Formato certo, número impossível (prefixo inexistente). */
  | "invalido";

export type ResultadoTelefone =
  | { ok: true; e164: string }
  | { ok: false; motivo: MotivoRejeicao };

/** Descrição curta do motivo, para mostrar na importação e no relatório. */
export const MOTIVO_LABEL: Record<MotivoRejeicao, string> = {
  vazio: "Sem telefone",
  internacional: "Número de outro país",
  formato: "Quantidade de dígitos inválida",
  ddd: "DDD inexistente",
  fixo: "Telefone fixo (não recebe SMS)",
  invalido: "Número de celular inválido",
};

/**
 * Interpreta um texto qualquer como celular brasileiro e devolve E.164
 * (+55DDD9NNNNNNNN) ou o motivo da recusa.
 */
export function parseBrazilianMobile(value: unknown): ResultadoTelefone {
  if (typeof value !== "string") return { ok: false, motivo: "vazio" };
  const bruto = value.trim();
  if (!bruto) return { ok: false, motivo: "vazio" };

  // DDI explícito de outro país é recusado ANTES de olhar os dígitos: um
  // número americano como +1 991 234-5678 tem exatamente a cara de um celular
  // de Campinas (19 9…) e seria aceito por engano.
  const comMais = bruto.startsWith("+");
  let digitos = bruto.replace(/\D/g, "");
  if (!digitos) return { ok: false, motivo: "vazio" };

  if (digitos.startsWith("00")) {
    // Prefixo internacional discado (0055…).
    if (!digitos.startsWith("0055")) return { ok: false, motivo: "internacional" };
    digitos = digitos.slice(4);
  } else if (comMais && !digitos.startsWith("55")) {
    return { ok: false, motivo: "internacional" };
  } else if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    // Só remove o 55 quando o que sobra fecha um número nacional. Sem essa
    // trava, "55987654321" (celular do DDD 55, São Gabriel/RS) perderia o
    // próprio DDD e viraria lixo.
    digitos = digitos.slice(2);
  }

  // Prefixo de operadora/tronco: 011 98765-4321, 0 31 9999-9999.
  while (digitos.length > 10 && digitos.startsWith("0")) {
    digitos = digitos.slice(1);
  }

  if (digitos.length !== 10 && digitos.length !== 11) {
    return { ok: false, motivo: "formato" };
  }

  const ddd = Number(digitos.slice(0, 2));
  if (!DDDS_VALIDOS.has(ddd)) return { ok: false, motivo: "ddd" };

  let assinante = digitos.slice(2);

  if (assinante.length === 8) {
    // Formato antigo (antes do nono dígito). Celular começava com 6–9; 2–5 é
    // fixo e não recebe SMS.
    const primeiro = assinante[0];
    if (primeiro >= "2" && primeiro <= "5") return { ok: false, motivo: "fixo" };
    if (primeiro < "6") return { ok: false, motivo: "invalido" };
    assinante = `9${assinante}`;
  } else if (assinante[0] !== "9") {
    // 9 dígitos que não começam com 9 não é celular em lugar nenhum do país.
    return { ok: false, motivo: assinante[0] <= "5" ? "fixo" : "invalido" };
  }

  const e164 = `+55${ddd}${assinante}`;

  // Última peneira: a libphonenumber conhece os prefixos que cada DDD emite de
  // verdade, coisa que a regra de formato acima não cobre.
  //
  // O "BR" é obrigatório mesmo com o número já em E.164: a build `min` do
  // pacote anexa a metadata como ÚLTIMO argumento, então chamar com um
  // argumento só faz a metadata cair na vaga do país e a chamada explode.
  const parsed = parsePhoneNumberFromString(e164, "BR");
  if (!parsed || !parsed.isValid()) return { ok: false, motivo: "invalido" };

  return { ok: true, e164 };
}

/** Atalho para quando só interessa o número: E.164 ou null. */
export function toBrazilianMobile(value: unknown): string | null {
  const resultado = parseBrazilianMobile(value);
  return resultado.ok ? resultado.e164 : null;
}

/**
 * Primeiro celular válido de um texto com vários números na mesma célula
 * (planilha exportada costuma trazer "91 98121-9276, (91) 3241-0000").
 * Separadores: vírgula, ponto e vírgula, barra, barra vertical e quebra de
 * linha — hífen e parênteses ficam, porque fazem parte do número.
 */
export function firstBrazilianMobile(value: unknown): string | null {
  if (typeof value !== "string") return null;
  for (const candidato of value.split(/[,;/|\r\n]+/)) {
    const encontrado = toBrazilianMobile(candidato);
    if (encontrado) return encontrado;
  }
  return null;
}
