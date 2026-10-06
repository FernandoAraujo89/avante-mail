// Casamento de uma linha de planilha com a base de contatos — a regra pura
// da importação/atualização por CSV (decisão de 06/10/2026):
//
//   1. e-mail já cadastrado          → é aquele contato;
//   2. telefone já cadastrado        → é aquele contato;
//   3. nome igual a UM contato só    → é aquele (acrescenta o telefone/e-mail);
//      nome igual a vários           → fica pendente, para uma pessoa decidir;
//   4. ninguém                       → contato novo.
//
// Se os endereços da linha apontam para contatos DIFERENTES (o e-mail é de
// um, o telefone é de outro), ninguém é fundido: fica pendente. Fundir
// contatos é decisão de gente, não de script.
//
// Sem banco: quem chama monta o índice da base e vai atualizando-o conforme
// cria contatos, para a segunda linha do mesmo nome achar o que a primeira
// criou. Testável de ponta a ponta sem Postgres.

export interface LinhaDoArquivo {
  /** Número da linha na planilha (a primeira linha de dados é a 2). */
  linha: number;
  nome: string;
  /** Já normalizados (minúsculo, válidos). */
  emails: string[];
  /** Já em E.164. */
  telefones: string[];
}

export interface IndiceDaBase {
  porEmail: Map<string, string>;
  porTelefone: Map<string, string>;
  /** chaveDeNome → ids. Só quem pode ser casado pelo nome (parceiros). */
  porNome: Map<string, string[]>;
}

export type Decisao =
  | { tipo: "atualizar"; contactId: string; por: "email" | "telefone" | "nome" }
  | { tipo: "criar" }
  | { tipo: "ambiguo"; candidatos: string[] }
  | { tipo: "conflito"; contactIds: string[] };

/**
 * O nome como chave de comparação: sem acento, sem caixa, sem espaço a mais.
 * "José  da Silva" e "jose da silva" são a mesma pessoa; a comparação é
 * EXATA depois disso — nada de "parecido".
 */
export function chaveDeNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function indiceVazio(): IndiceDaBase {
  return { porEmail: new Map(), porTelefone: new Map(), porNome: new Map() };
}

/** Registra um contato (novo ou da base) no índice. */
export function indexar(
  indice: IndiceDaBase,
  contato: {
    id: string;
    nome: string;
    emails: string[];
    telefones: string[];
    /** Entra na busca por nome? (Lead não: a planilha é de parceiros.) */
    porNome: boolean;
  }
): void {
  for (const e of contato.emails) indice.porEmail.set(e, contato.id);
  for (const t of contato.telefones) indice.porTelefone.set(t, contato.id);
  if (contato.porNome) {
    const chave = chaveDeNome(contato.nome);
    if (!chave) return;
    const ids = indice.porNome.get(chave) ?? [];
    if (!ids.includes(contato.id)) ids.push(contato.id);
    indice.porNome.set(chave, ids);
  }
}

export function decidir(linha: LinhaDoArquivo, indice: IndiceDaBase): Decisao {
  const porEndereco = new Set<string>();
  let por: "email" | "telefone" | null = null;
  for (const e of linha.emails) {
    const id = indice.porEmail.get(e);
    if (id) {
      porEndereco.add(id);
      por ??= "email";
    }
  }
  for (const t of linha.telefones) {
    const id = indice.porTelefone.get(t);
    if (id) {
      porEndereco.add(id);
      por ??= "telefone";
    }
  }
  if (porEndereco.size > 1) {
    return { tipo: "conflito", contactIds: [...porEndereco] };
  }
  if (porEndereco.size === 1 && por) {
    return { tipo: "atualizar", contactId: [...porEndereco][0], por };
  }

  const chave = chaveDeNome(linha.nome);
  const pelosNomes = chave ? (indice.porNome.get(chave) ?? []) : [];
  if (pelosNomes.length === 1) {
    return { tipo: "atualizar", contactId: pelosNomes[0], por: "nome" };
  }
  if (pelosNomes.length > 1) {
    return { tipo: "ambiguo", candidatos: pelosNomes };
  }
  return { tipo: "criar" };
}
