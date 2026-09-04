/**
 * A FONTE de um ponto de contato: de qual rede ou canal a pessoa veio.
 *
 * Fase E.3 (docs/plano-webhooks-leads.md). O que as redes expõem com
 * identidade é pouco — curtida e visita ao perfil não têm dono para ninguém —
 * mas quem CLICA num link nosso chega ao site com uma pista: o `utm_source` do
 * link ou, na falta dele, o referrer. Este arquivo transforma essa pista, que
 * chega em dezenas de grafias ("Instagram", "ig", "l.instagram.com"), numa
 * chave fixa que a regra de pontuação consegue comparar por igualdade estrita
 * (`casaGatilho` compara chave por chave, sem tolerância).
 *
 * Puro de propósito: é importado pela rota de coleta, pelo webhook de entrada
 * e pela ficha do lead, e precisa ser conferível de cabeça. Errar aqui não
 * vaza dado — mas pontua a pessoa errada, e ninguém percebe olhando o número.
 */

export const FONTES = [
  "instagram",
  "facebook",
  "tiktok",
  "linkedin",
  "youtube",
  "google",
  "whatsapp",
] as const;
export type Fonte = (typeof FONTES)[number];

const ROTULOS: Record<Fonte, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  google: "Google",
  whatsapp: "WhatsApp",
};

/**
 * Apelidos do `utm_source`, casados contra o valor inteiro E contra cada
 * palavra dele ("instagram_bio", "ig-stories", "fb_ads").
 *
 * `ig`, `fb` e `msg` importam mais do que parecem: são o que o Meta Ads manda
 * quando o parâmetro de URL do anúncio usa `{{site_source_name}}`. Sem eles,
 * todo lead vindo de anúncio chegaria sem fonte.
 */
const APELIDOS: Record<string, Fonte> = {
  instagram: "instagram",
  insta: "instagram",
  ig: "instagram",
  facebook: "facebook",
  fb: "facebook",
  msg: "facebook",
  messenger: "facebook",
  tiktok: "tiktok",
  tt: "tiktok",
  linkedin: "linkedin",
  li: "linkedin",
  youtube: "youtube",
  yt: "youtube",
  google: "google",
  adwords: "google",
  whatsapp: "whatsapp",
  wa: "whatsapp",
  zap: "whatsapp",
};

/**
 * Apelidos curtos demais para valer como PALAVRA dentro de um valor maior:
 * "li" em "li-post" pode ser LinkedIn ou pode ser qualquer coisa. Valem só
 * quando são o valor inteiro.
 */
const SO_INTEIROS = new Set(["li", "tt", "wa", "zap", "msg"]);

/** Domínios do referrer, casados por sufixo de domínio (`x.instagram.com`). */
const DOMINIOS: [string, Fonte][] = [
  ["instagram.com", "instagram"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["fb.me", "facebook"],
  ["messenger.com", "facebook"],
  ["tiktok.com", "tiktok"],
  ["linkedin.com", "linkedin"],
  ["lnkd.in", "linkedin"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["whatsapp.com", "whatsapp"],
  ["wa.me", "whatsapp"],
];

function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** A fonte a partir do `utm_source` (ou de um canal escrito à mão). */
export function fonteDoUtm(cru: string | null | undefined): Fonte | null {
  if (typeof cru !== "string") return null;
  const valor = normalizar(cru);
  if (!valor) return null;

  const inteiro = APELIDOS[valor];
  if (inteiro) return inteiro;

  // Um domínio escrito no utm_source ("l.instagram.com") também conta — é
  // comum em ferramenta que preenche a UTM com o referrer.
  const porDominio = fonteDoReferrer(valor);
  if (porDominio) return porDominio;

  for (const palavra of valor.split(/[^a-z0-9]+/)) {
    const fonte = APELIDOS[palavra];
    if (fonte && !SO_INTEIROS.has(palavra)) return fonte;
  }

  // "instagramstories", "facebookads": o nome inteiro colado em outra palavra.
  // Só o nome inteiro — "ig" colado ("igshopping") é ambíguo demais.
  for (const fonte of FONTES) {
    if (valor.includes(fonte)) return fonte;
  }
  return null;
}

/**
 * A fonte a partir do referrer — aceita o host puro (`l.instagram.com`, como
 * a rota de coleta guarda) ou a URL inteira (como o formulário costuma
 * mandar). Só o domínio decide; caminho e query são ignorados.
 */
export function fonteDoReferrer(cru: string | null | undefined): Fonte | null {
  if (typeof cru !== "string") return null;
  let host = normalizar(cru);
  if (!host) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
    try {
      host = new URL(host).host;
    } catch {
      return null;
    }
  }
  host = host.split("/")[0].split(":")[0];
  if (!host) return null;

  for (const [dominio, fonte] of DOMINIOS) {
    if (host === dominio || host.endsWith(`.${dominio}`)) return fonte;
  }
  // google.com, google.com.br, www.google.pt — o TLD varia por país.
  if (/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) return "google";
  return null;
}

/**
 * A regra de precedência: UTM vence referrer.
 *
 * O referrer some quando o aplicativo abre o link no navegador de fora (o
 * caso mais comum no Instagram), e é o site de origem quem decide se o manda.
 * A UTM é a única pista que sobrevive a isso — e é a que o time controla.
 */
export function fonteDe(
  utmSource: string | null | undefined,
  referrer: string | null | undefined
): Fonte | null {
  return fonteDoUtm(utmSource) ?? fonteDoReferrer(referrer);
}

/** O nome como a tela mostra. Chave desconhecida volta como veio. */
export function rotuloDaFonte(fonte: string): string {
  return (ROTULOS as Record<string, string>)[fonte] ?? fonte;
}
