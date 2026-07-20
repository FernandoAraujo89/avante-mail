import type { Campaign, Contact } from "./db/schema";
import { signUnsubscribeToken } from "./jwt";
import { compileEmailContent } from "./mjml";
import { renderVariables, textToHtml, type TemplateVariables } from "./render";

export function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

/** Monta as variáveis Handlebars de um envio real.
 *
 * O conteúdo do e-mail vive no design da campanha (WYSIWYG), então só as
 * variáveis POR-DESTINATÁRIO são substituídas aqui. titulo/subtitulo abastecem
 * o <mj-title>/<mj-preview> do cabeçalho. corpo/cta_* são mantidos por
 * compatibilidade com e-mails/templates legados que ainda usem esses tokens.
 */
export async function buildCampaignVariables(
  campaign: Campaign,
  contact: Contact,
  sendId: string
): Promise<TemplateVariables> {
  const baseUrl = getBaseUrl();
  const unsubscribeToken = await signUnsubscribeToken(contact.id, sendId);

  return {
    nome_parceiro: contact.name,
    titulo: campaign.name,
    subtitulo: campaign.preheader ?? "",
    corpo: textToHtml(campaign.body ?? ""),
    cta_texto: campaign.ctaText ?? "",
    cta_url: campaign.ctaUrl ?? baseUrl,
    // Link visível no rodapé: página com confirmação (protege contra scanners).
    unsubscribe_url: `${baseUrl}/unsubscribe?token=${unsubscribeToken}`,
    // Endpoint de descadastro em UM clique (RFC 8058) usado no header
    // List-Unsubscribe: o provedor (Gmail/Yahoo) faz POST direto aqui.
    list_unsubscribe_url: `${baseUrl}/api/unsubscribe?token=${unsubscribeToken}`,
  };
}

/**
 * Redireciona todos os links http(s) do e-mail pelo rastreador de cliques,
 * exceto o descadastro e os próprios endpoints internos. Como os botões/links
 * agora são livres (WYSIWYG), o rastreio precisa cobrir qualquer link.
 */
function rewriteLinksForTracking(
  html: string,
  sendId: string,
  baseUrl: string
): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url: string) => {
    if (
      url.includes("/unsubscribe") ||
      url.includes("/api/track") ||
      url.includes("/api/unsubscribe")
    ) {
      return match;
    }
    const tracked = `${baseUrl}/api/track/click?sid=${sendId}&url=${encodeURIComponent(url)}`;
    return `href="${tracked}"`;
  });
}

/**
 * Variáveis para um e-mail de TESTE: usa o conteúdo real da campanha,
 * mas sem rastreamento (sem sendId) e com links neutros — o objetivo é
 * conferir a aparência antes do disparo real.
 */
export function buildTestVariables(campaign: Campaign): TemplateVariables {
  const baseUrl = getBaseUrl();
  return {
    nome_parceiro: "Parceiro (teste)",
    titulo: campaign.name,
    subtitulo: campaign.preheader ?? "",
    corpo: textToHtml(campaign.body ?? ""),
    cta_texto: campaign.ctaText ?? "Saiba mais",
    cta_url: campaign.ctaUrl || baseUrl,
    unsubscribe_url: `${baseUrl}/unsubscribe`,
  };
}

/**
 * Renderiza as variáveis no MJML, compila para HTML e injeta o
 * pixel de rastreamento de abertura no final do documento.
 */
export async function buildEmailHtml(
  mjmlContent: string,
  variables: TemplateVariables,
  sendId?: string
): Promise<{ html: string; errors: string[] }> {
  const rendered = renderVariables(mjmlContent, variables);
  const compiled = await compileEmailContent(rendered);
  const errors = compiled.errors;

  // Imagens hospedadas no servidor são salvas com caminho relativo
  // (/uploads/...); no e-mail final elas precisam de URL absoluta.
  const html = compiled.html.replace(
    /(src|href)="\/uploads\//g,
    `$1="${getBaseUrl()}/uploads/`
  );

  if (!sendId) return { html, errors };

  // Rastreio de cliques em todos os links + pixel de abertura.
  const tracked = rewriteLinksForTracking(html, sendId, getBaseUrl());
  const pixel = `<img src="${getBaseUrl()}/api/track/open?sid=${sendId}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
  const withPixel = tracked.includes("</body>")
    ? tracked.replace("</body>", `${pixel}</body>`)
    : tracked + pixel;

  return { html: withPixel, errors };
}
