import mjml2html from "mjml";

export interface MjmlCompileResult {
  html: string;
  errors: string[];
}

/** Compila código MJML para HTML pronto para e-mail (mjml v5 é assíncrono). */
export async function compileMjml(source: string): Promise<MjmlCompileResult> {
  const { html, errors } = await mjml2html(source, {
    validationLevel: "soft",
  });
  return {
    html,
    errors: errors.map((e) => e.formattedMessage),
  };
}

export function looksLikeMjml(source: string): boolean {
  return /<\s*mjml[\s>]/i.test(source);
}

/**
 * Compila o conteúdo de um template: MJML é compilado;
 * HTML puro (opção "HTML personalizado") é usado como está.
 */
export async function compileEmailContent(
  source: string
): Promise<MjmlCompileResult> {
  if (!looksLikeMjml(source)) {
    return { html: source, errors: [] };
  }
  return compileMjml(source);
}
