import type { SurveyMessageKind } from "@/lib/db/schema";

// O convite e o lembrete por e-mail: texto com variáveis, assunto e o HTML
// transacional (sem rastreio, sem descadastro — é pedido a um parceiro, não
// campanha). Puro: o worker monta a mensagem daqui.

export const VARIAVEIS_DA_MENSAGEM = ["nome", "empresa", "pesquisa"] as const;

export const LIMITES_DA_MENSAGEM = { assunto: 150, corpo: 3000 } as const;

export interface DadosDaMensagem {
  nome: string;
  empresa: string | null;
  pesquisa: string;
}

export function assuntoPadrao(nomeDaPesquisa: string): string {
  return `Pesquisa Avante: ${nomeDaPesquisa}`;
}

export function corpoPadrao(): string {
  return `Olá, {{nome}}!

A Avante quer ouvir você. Preparamos a pesquisa "{{pesquisa}}" para entender melhor a {{empresa}} e apoiar vocês do jeito certo.

Leva poucos minutos, e você pode responder no seu tempo: cada resposta fica salva, e o mesmo link abre de onde você parou.

Obrigado!`;
}

/** {{nome}}, {{empresa}} e {{pesquisa}}; empresa vazia vira "sua empresa". */
export function preencherVariaveis(texto: string, dados: DadosDaMensagem): string {
  const valores: Record<(typeof VARIAVEIS_DA_MENSAGEM)[number], string> = {
    nome: dados.nome.trim() || "parceiro",
    empresa: dados.empresa?.trim() || "sua empresa",
    pesquisa: dados.pesquisa,
  };
  return texto.replace(/\{\{\s*(nome|empresa|pesquisa)\s*\}\}/g, (_, v) => valores[v as keyof typeof valores]);
}

export function assuntoDaMensagem(assunto: string, tipo: SurveyMessageKind): string {
  return tipo === "reminder" ? `Lembrete: ${assunto}` : assunto;
}

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Texto simples → parágrafos HTML (linha em branco separa parágrafos). */
function paragrafos(texto: string): string {
  return texto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5;">${escaparHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function htmlDaMensagem(args: {
  corpo: string;
  link: string;
  tipo: SurveyMessageKind;
  nomeDaPesquisa: string;
}): string {
  const aviso =
    args.tipo === "reminder"
      ? `<p style="margin:0 0 16px;padding:12px;background:#FFF7E6;border-radius:8px;font-size:14px;">Você ainda não concluiu a pesquisa <strong>${escaparHtml(args.nomeDaPesquisa)}</strong>. O link abre de onde você parou.</p>`
      : "";
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#282E3F;font-size:15px;">
      <p style="margin:0 0 24px;color:#1D50DC;font-weight:bold;font-size:18px;">Avante</p>
      ${aviso}
      ${paragrafos(args.corpo)}
      <p style="text-align:center;margin:32px 0;">
        <a href="${escaparHtml(args.link)}" style="background:#1D50DC;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:bold;display:inline-block;">
          Responder pesquisa
        </a>
      </p>
      <p style="font-size:12px;color:#8A98A5;line-height:1.5;">Se o botão não abrir, copie este link: <a href="${escaparHtml(args.link)}" style="color:#1D50DC;">${escaparHtml(args.link)}</a></p>
      <p style="font-size:12px;color:#8A98A5;line-height:1.5;">Você recebe este e-mail porque é parceiro da Avante Soluções Digitais · Formiga, MG.</p>
    </div>`;
}
