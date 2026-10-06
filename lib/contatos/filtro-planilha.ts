// Filtro de destinatários por planilha: o usuário cola ou envia um CSV com os
// dados que tiver (nome, e-mail, telefone, empresa…) e o sistema seleciona,
// entre os contatos JÁ CADASTRADOS e elegíveis, os que casam por qualquer um
// deles. Nada é criado: linha que não casa volta na lista de "não encontradas".
//
// Puro (sem banco, sem DOM): roda no navegador, dentro do assistente de
// campanha, e é testado sem Postgres.
//
// O que identifica um contato:
//   - e-mail: qualquer célula com @ válido — se identifica sozinho;
//   - telefone: célula com 8+ dígitos, comparada de trás para frente
//     (DDI, DDD e o 9 do celular variam — ver samePhone em lib/phone.ts).
//     Com cabeçalho reconhecido, só as colunas de telefone são lidas: um CNPJ
//     ou um CEP também têm 8+ dígitos e casariam com telefone por acidente;
//   - nome: SÓ quando a planilha tem cabeçalho com a coluna de nome
//     reconhecida. Sem isso, qualquer célula de texto (cidade, empresa)
//     viraria nome e puxaria gente errada.
import Papa from "papaparse";

import { chaveDeNome } from "@/lib/contatos/casamento";
import { commonSuffixDigits, MIN_COMMON_DIGITS } from "@/lib/phone";
import { parseEmailList } from "@/lib/utils";

const CABECALHOS_DE_NOME = [
  "nome",
  "name",
  "contato",
  "cliente",
  "parceiro",
  "responsavel",
  "responsável",
  "razao social",
  "razão social",
  "razao_social",
  "nome completo",
  "nome_completo",
];
const CABECALHOS_DE_TELEFONE = [
  "telefone",
  "telefones",
  "phone",
  "celular",
  "whatsapp",
  "fone",
  "numero",
  "número",
  "tel",
  "contato",
  "telefone 2",
  "telefone2",
  "celular 2",
];
const CABECALHOS_DE_EMAIL = ["email", "e-mail", "e_mail", "emails", "e-mails"];

function normalizarCabecalho(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface LinhaDaPlanilha {
  /** Número da linha no arquivo (1 = primeira linha de dados). */
  numero: number;
  /** Como a linha aparece para quem for conferir. */
  texto: string;
  emails: string[];
  /** Só os dígitos de cada telefone candidato. */
  telefones: string[];
  nome: string | null;
}

export interface PlanilhaLida {
  linhas: LinhaDaPlanilha[];
  /** A primeira linha foi tratada como cabeçalho. */
  comCabecalho: boolean;
  /** Havia cabeçalho, mas sem coluna de nome reconhecida: nomes não entram. */
  semColunaDeNome: boolean;
}

function digitosDeTelefone(celula: string): string[] {
  // Mesma divisão de parsePhoneList: vários números numa célula.
  const achados: string[] = [];
  for (const pedaco of celula.split(/[\n\r,;\t|/]+/)) {
    const digitos = pedaco.replace(/\D/g, "");
    if (digitos.length >= 8 && !achados.includes(digitos))
      achados.push(digitos);
  }
  return achados;
}

/**
 * Lê o texto colado ou o conteúdo de um .csv. Decide sozinho se a primeira
 * linha é cabeçalho: é, se alguma célula dela for um cabeçalho conhecido.
 */
export function lerPlanilha(texto: string): PlanilhaLida {
  const bruto = Papa.parse<string[]>(texto.trim(), {
    skipEmptyLines: true,
  });
  const matriz = bruto.data.map((linha) =>
    linha.map((celula) => String(celula ?? "").trim())
  );
  if (matriz.length === 0) {
    return { linhas: [], comCabecalho: false, semColunaDeNome: false };
  }

  const primeira = matriz[0].map(normalizarCabecalho);
  const colunaDeNome = primeira.findIndex((h) =>
    CABECALHOS_DE_NOME.includes(h)
  );
  const colunasDeTelefone = primeira
    .map((h, i) => (CABECALHOS_DE_TELEFONE.includes(h) ? i : -1))
    .filter((i) => i >= 0);
  const colunasDeEmail = primeira
    .map((h, i) => (CABECALHOS_DE_EMAIL.includes(h) ? i : -1))
    .filter((i) => i >= 0);
  const comCabecalho =
    colunaDeNome >= 0 ||
    colunasDeTelefone.length > 0 ||
    colunasDeEmail.length > 0;

  const dados = comCabecalho ? matriz.slice(1) : matriz;
  const linhas: LinhaDaPlanilha[] = dados.map((celulas, indice) => {
    const emails = [...new Set(celulas.flatMap((c) => parseEmailList(c)))];
    // Com cabeçalho e coluna de telefone reconhecida, só ela conta; sem
    // cabeçalho (lista colada), qualquer célula com cara de telefone conta.
    const fontesDeTelefone =
      comCabecalho && colunasDeTelefone.length > 0
        ? colunasDeTelefone.map((i) => celulas[i] ?? "")
        : celulas.filter((c) => !c.includes("@"));
    const telefones = [...new Set(fontesDeTelefone.flatMap(digitosDeTelefone))];
    const nome =
      colunaDeNome >= 0 ? (celulas[colunaDeNome] ?? "").trim() || null : null;
    return {
      numero: indice + 1,
      texto: celulas.filter(Boolean).join(" · "),
      emails,
      telefones,
      nome,
    };
  });

  return {
    linhas: linhas.filter(
      (l) => l.emails.length > 0 || l.telefones.length > 0 || l.nome
    ),
    comCabecalho,
    semColunaDeNome: comCabecalho && colunaDeNome < 0,
  };
}

export interface ContatoParaFiltro {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
}

export interface ResultadoDoFiltro {
  /** Linhas com algum dado utilizável. */
  total: number;
  encontradas: number;
  porEmail: number;
  porTelefone: number;
  porNome: number;
  /** Nomes que casaram com mais de um contato (todos entram; vale conferir). */
  nomesAmbiguos: string[];
  /** Quantos contatos foram selecionados. */
  contatos: number;
  naoEncontradas: string[];
  comCabecalho: boolean;
  semColunaDeNome: boolean;
}

/** Casa cada linha com os contatos e devolve os ids selecionados. */
export function filtrarContatos(
  planilha: PlanilhaLida,
  contatos: ContatoParaFiltro[]
): { ids: string[]; resultado: ResultadoDoFiltro } {
  const porEmail = new Map<string, string[]>();
  const porNome = new Map<string, string[]>();
  const telefones: { digitos: string; id: string }[] = [];
  for (const c of contatos) {
    for (const e of c.emails) {
      porEmail.set(e, [...(porEmail.get(e) ?? []), c.id]);
    }
    const chave = chaveDeNome(c.name);
    if (chave) porNome.set(chave, [...(porNome.get(chave) ?? []), c.id]);
    for (const p of c.phones) {
      telefones.push({ digitos: p.replace(/\D/g, ""), id: c.id });
    }
  }

  const ids = new Set<string>();
  const naoEncontradas: string[] = [];
  const nomesAmbiguos = new Set<string>();
  let encontradas = 0;
  let porEmailN = 0;
  let porTelefoneN = 0;
  let porNomeN = 0;

  for (const linha of planilha.linhas) {
    const achados = new Set<string>();
    let como: "email" | "telefone" | "nome" | null = null;

    for (const e of linha.emails) {
      for (const id of porEmail.get(e) ?? []) {
        achados.add(id);
        como ??= "email";
      }
    }
    for (const d of linha.telefones) {
      for (const t of telefones) {
        if (commonSuffixDigits(d, t.digitos) >= MIN_COMMON_DIGITS) {
          achados.add(t.id);
          como ??= "telefone";
        }
      }
    }
    if (linha.nome) {
      const candidatos = porNome.get(chaveDeNome(linha.nome)) ?? [];
      if (candidatos.length > 1) nomesAmbiguos.add(linha.nome);
      for (const id of candidatos) {
        achados.add(id);
        como ??= "nome";
      }
    }

    if (achados.size === 0) {
      naoEncontradas.push(linha.texto);
      continue;
    }
    encontradas++;
    if (como === "email") porEmailN++;
    else if (como === "telefone") porTelefoneN++;
    else porNomeN++;
    for (const id of achados) ids.add(id);
  }

  return {
    ids: [...ids],
    resultado: {
      total: planilha.linhas.length,
      encontradas,
      porEmail: porEmailN,
      porTelefone: porTelefoneN,
      porNome: porNomeN,
      nomesAmbiguos: [...nomesAmbiguos],
      contatos: ids.size,
      naoEncontradas,
      comCabecalho: planilha.comCabecalho,
      semColunaDeNome: planilha.semColunaDeNome,
    },
  };
}
