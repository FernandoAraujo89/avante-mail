// Geração de CSV para abrir no Excel (em português) e no Google Sheets sem
// nenhum ajuste — três detalhes decidem isso, e errar qualquer um deles
// devolve o clássico "abri e ficou tudo espremido numa coluna só":
//
//  - separador ";" — no Excel em pt-BR a vírgula é o separador DECIMAL, então
//    um arquivo com vírgula não é dividido em colunas. O Sheets detecta os dois.
//  - BOM no começo — sem ele o Excel abre como Latin-1 e os acentos viram
//    símbolo (Araújo → Araújo).
//  - CRLF no fim da linha, como manda o RFC 4180.

// Escapado de propósito: um BOM literal no fonte é invisível no editor.
const BOM = "\uFEFF";
const SEPARADOR = ";";

/**
 * Célula que começa com =, +, - ou @ é interpretada como FÓRMULA ao abrir a
 * planilha. Como o conteúdo vem de nome e empresa digitados por gente, o
 * apóstrofo à frente força texto — o Excel e o Sheets não o exibem.
 */
const COMECA_COMO_FORMULA = /^[=+\-@\t\r]/;

/** Precisa de aspas: separador, aspas, quebra de linha ou espaço nas pontas. */
const PRECISA_ASPAS = /[";\n\r]|^\s|\s$/;

function celula(valor: string): string {
  const texto = valor ?? "";
  const seguro = COMECA_COMO_FORMULA.test(texto) ? `'${texto}` : texto;
  return PRECISA_ASPAS.test(seguro)
    ? `"${seguro.replace(/"/g, '""')}"`
    : seguro;
}

/** Monta o CSV completo (cabeçalho + linhas), pronto para virar arquivo. */
export function toCsv(headers: string[], rows: string[][]): string {
  const linhas = [headers, ...rows].map((linha) =>
    linha.map(celula).join(SEPARADOR)
  );
  return BOM + linhas.join("\r\n") + "\r\n";
}

/** Nome de arquivo seguro a partir de pedaços legíveis ("Campanha X", "Lida"). */
export function csvFilename(...partes: (string | null | undefined)[]): string {
  const slug = partes
    .filter((p): p is string => Boolean(p?.trim()))
    .join("-")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "exportacao"}.csv`;
}
