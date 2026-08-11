// Sanitização e contagem de SMS no alfabeto GSM 03.38 (GSM-7).
//
// Duas razões para existir, ambas caras:
//
// 1. DINHEIRO. O SMS cobra por SEGMENTO. Em GSM-7 cabem 160 caracteres por
//    segmento; basta UM caractere fora do alfabeto (um emoji, um travessão
//    colado do Word) para a mensagem inteira virar UCS-2 e o segmento cair
//    para 70. Um texto de 150 caracteres passa de 1 para 3 segmentos — três
//    vezes o custo, sem aviso nenhum.
// 2. ENTREGA. Parte das operadoras brasileiras ainda entrega acento como lixo.
//    Transliterar fica feio no editor e correto no aparelho de quem recebe.
//
// Funções puras: entra texto, sai texto e números. Sem I/O, sem env.

import {
  GSM7_CONCAT_LIMIT,
  GSM7_SINGLE_LIMIT,
  SMS_BRAZIL_PRICE_PER_SEGMENT_USD,
  UCS2_CONCAT_LIMIT,
  UCS2_SINGLE_LIMIT,
  type SmsEncoding,
} from "./types";

/**
 * Alfabeto básico do GSM 03.38 — 1 septeto por caractere.
 */
const GSM7_BASICO = new Set(
  [
    "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./",
    "0123456789:;<=>?",
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§",
    "¿abcdefghijklmnopqrstuvwxyzäöñüà",
    "\n\r",
  ]
    .join("")
    .split("")
);

/**
 * Tabela de extensão — cada um custa 2 septetos (ESC + caractere). Não são
 * proibidos, mas o editor precisa saber que "[oferta]" gasta o dobro do que
 * parece.
 */
const GSM7_EXTENDIDO = new Set(["^", "{", "}", "\\", "[", "~", "]", "|", "€", "\f"]);

/**
 * Substituições que a decomposição Unicode não resolve sozinha. O grosso dos
 * acentos do português sai por NFD (á → a + acento, ç → c + cedilha); aqui
 * ficam os caracteres sem decomposição — quase todos vindos de texto colado
 * do Word ou do Google Docs.
 */
const SUBSTITUICOES: Record<string, string> = {
  "ø": "o", "Ø": "O",
  "æ": "ae", "Æ": "AE",
  "œ": "oe", "Œ": "OE",
  "ß": "ss",
  "đ": "d", "Đ": "D",
  "ł": "l", "Ł": "L",
  "ª": "a", "º": "o",
  // Aspas e travessões "inteligentes": campeões de mensagem em UCS-2, porque
  // entram sozinhos em qualquer texto colado.
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-",
  "—": "-", "―": "-", "−": "-",
  "…": "...",
  "•": "-", "·": "-",
  "‹": "<", "›": ">",
  "«": "<<", "»": ">>",
  "`": "'", "´": "'",
  "⁄": "/",
  "½": "1/2", "¼": "1/4", "¾": "3/4",
  "™": "TM", "®": "(R)", "©": "(C)",
  // Espaços exóticos viram espaço comum; os de largura zero somem — invisíveis,
  // só serviriam para estourar o segmento sem ninguém entender por quê.
  " ": " ", " ": " ", " ": " ", " ": " ", "　": " ",
  "​": "", "‌": "", "‍": "", "﻿": "",
  "\t": " ",
};

/** Emoji e pictogramas — bloqueiam o envio, não são transliterados. */
const EMOJI = /\p{Extended_Pictographic}/u;

/** Acentos combinantes que sobram depois do NFD. */
const COMBINANTES = /[̀-ͯ]/g;

export interface SanitizacaoSms {
  /** Texto pronto para enviar, já transliterado. */
  texto: string;
  /** Emojis encontrados (sem repetição). Presente = envio bloqueado. */
  emojis: string[];
  /** Caracteres que sobraram fora do GSM-7 e não são emoji. */
  foraDoGsm7: string[];
  /** true quando o texto pode ser enviado como GSM-7. */
  ok: boolean;
}

/**
 * Transliterra o texto para GSM-7 e relata o que não coube.
 *
 * O que é acento vira letra sem acento; o que é emoji é DENUNCIADO, não
 * apagado em silêncio — sumir com um caractere muda a mensagem que a pessoa
 * escreveu, e ela precisa decidir o que fazer.
 */
export function sanitizeGsm7(entrada: string): SanitizacaoSms {
  const original = typeof entrada === "string" ? entrada : "";

  const emojis: string[] = [];
  let texto = "";

  for (const caractere of original) {
    if (EMOJI.test(caractere)) {
      if (!emojis.includes(caractere)) emojis.push(caractere);
      continue;
    }
    const substituto = SUBSTITUICOES[caractere];
    if (substituto !== undefined) {
      texto += substituto;
      continue;
    }
    texto += caractere.normalize("NFD").replace(COMBINANTES, "");
  }

  const foraDoGsm7: string[] = [];
  for (const caractere of texto) {
    if (GSM7_BASICO.has(caractere) || GSM7_EXTENDIDO.has(caractere)) continue;
    if (!foraDoGsm7.includes(caractere)) foraDoGsm7.push(caractere);
  }

  return {
    texto,
    emojis,
    foraDoGsm7,
    ok: emojis.length === 0 && foraDoGsm7.length === 0,
  };
}

export interface ContagemSms {
  /** Caracteres visíveis (pontos de código). */
  caracteres: number;
  /** Custo real: caractere da tabela de extensão conta 2. */
  unidades: number;
  segmentos: number;
  encoding: SmsEncoding;
  /** Capacidade de cada segmento no encoding e na contagem atual. */
  limiteDoSegmento: number;
  /** Quanto ainda cabe antes de estourar para o próximo segmento. */
  restante: number;
}

/**
 * Conta caracteres, unidades e segmentos como a operadora conta.
 *
 * Aceita texto NÃO sanitizado de propósito: é assim que o editor mostra "com
 * esse emoji, 3 segmentos; sem ele, 1".
 */
export function countSms(texto: string): ContagemSms {
  const conteudo = typeof texto === "string" ? texto : "";
  const caracteres = [...conteudo].length;

  const precisaUcs2 = [...conteudo].some(
    (c) => !GSM7_BASICO.has(c) && !GSM7_EXTENDIDO.has(c)
  );
  const encoding: SmsEncoding = precisaUcs2 ? "ucs2" : "gsm7";

  // Em UCS-2 a operadora conta unidades UTF-16 — emoji fora do BMP ocupa 2.
  const unidades = precisaUcs2
    ? conteudo.length
    : [...conteudo].reduce(
        (soma, c) => soma + (GSM7_EXTENDIDO.has(c) ? 2 : 1),
        0
      );

  const limiteUnico = precisaUcs2 ? UCS2_SINGLE_LIMIT : GSM7_SINGLE_LIMIT;
  const limiteConcat = precisaUcs2 ? UCS2_CONCAT_LIMIT : GSM7_CONCAT_LIMIT;

  if (unidades === 0) {
    return {
      caracteres: 0,
      unidades: 0,
      segmentos: 0,
      encoding,
      limiteDoSegmento: limiteUnico,
      restante: limiteUnico,
    };
  }

  const segmentos =
    unidades <= limiteUnico ? 1 : Math.ceil(unidades / limiteConcat);
  const limiteDoSegmento = segmentos === 1 ? limiteUnico : limiteConcat;

  return {
    caracteres,
    unidades,
    segmentos,
    encoding,
    limiteDoSegmento,
    restante: segmentos * limiteDoSegmento - unidades,
  };
}

/**
 * Custo estimado em US$. `destinatarios` multiplica porque a Twilio cobra por
 * segmento POR destinatário — o susto da campanha grande mora aqui.
 */
export function estimateSmsCostUsd(
  segmentos: number,
  destinatarios = 1,
  precoPorSegmento = SMS_BRAZIL_PRICE_PER_SEGMENT_USD
): number {
  if (segmentos <= 0 || destinatarios <= 0) return 0;
  return segmentos * destinatarios * precoPorSegmento;
}
