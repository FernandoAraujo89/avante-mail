// Relatório de imagens externas trazidas para o servidor, e como contá-lo a
// quem está editando. Fica fora de lib/uploads-externas.ts porque este texto é
// montado na TELA, e aquele arquivo é de servidor (fs, dns).

export interface RelatorioImagens {
  /** Quantas imagens externas passaram a ser servidas por nós. */
  baixadas: number;
  /** As que continuam apontando para fora, e por quê. */
  falhas: { url: string; motivo: string }[];
}

function encurtar(url: string): string {
  return url.length > 60 ? `${url.slice(0, 57)}...` : url;
}

/**
 * Frase para a tela, ou vazio quando não houve imagem externa nenhuma.
 * A falha é dita por inteiro: uma imagem que continua vindo de fora é um
 * e-mail que pode chegar quebrado, e isso a pessoa precisa saber agora.
 */
export function descreverRelatorioDeImagens(
  relatorio: RelatorioImagens | undefined | null
): string {
  if (!relatorio) return "";
  const { baixadas, falhas } = relatorio;
  if (!baixadas && falhas.length === 0) return "";

  const partes: string[] = [];
  if (baixadas > 0) {
    partes.push(
      baixadas === 1
        ? "1 imagem que vinha de outro site foi salva no servidor."
        : `${baixadas} imagens que vinham de outros sites foram salvas no servidor.`
    );
  }
  if (falhas.length > 0) {
    partes.push(
      `Não foi possível baixar ${falhas.length === 1 ? "1 imagem" : `${falhas.length} imagens`}, que seguem apontando para fora e podem quebrar no e-mail: ${falhas
        .map((f) => `${encurtar(f.url)} (${f.motivo})`)
        .join("; ")}.`
    );
  }
  return partes.join(" ");
}
