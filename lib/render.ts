export type TemplateVariables = Record<string, string>;

/** Valores de exemplo usados nos previews de template. */
export const SAMPLE_VARIABLES: TemplateVariables = {
  nome_parceiro: "Parceiro Exemplo",
  titulo: "Título da campanha",
  subtitulo: "Subtítulo de apoio que resume a novidade.",
  corpo:
    "Este é o corpo do e-mail. Aqui você conta a novidade com detalhes, benefícios e o que o parceiro precisa fazer.",
  cta_texto: "Saiba mais",
  cta_url: "https://avantejuntos.com.br",
  unsubscribe_url: "#descadastro",
};

/**
 * Substitui variáveis no formato Handlebars ({{variavel}}).
 * Variáveis sem valor definido são removidas do resultado.
 */
export function renderVariables(
  content: string,
  variables: TemplateVariables
): string {
  return content.replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    (_match, key: string) => variables[key] ?? ""
  );
}

/** Converte texto simples em HTML preservando quebras de linha. */
export function textToHtml(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, "<br/>");
}
