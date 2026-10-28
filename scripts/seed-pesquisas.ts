// As 3 pesquisas do projeto "Mapeamento da Parceria" (perguntas do documento
// da Expansão, composição das fases da apresentação de 23/10/2026), uma por
// fase, em RASCUNHO:
//   dados_empresa — Fase 1 · Diagnóstico e organização: identificação,
//                   carteira de clientes, produtos Avante
//   nps           — Fase 2 · Nível de satisfação: operação, implantação e
//                   suporte; relacionamento e percepção (a 0–10 é o NPS;
//                   "risco de continuidade" gera alerta para a Expansão)
//   crescimento   — Fase 3 · Melhorias: estratégia comercial e crescimento;
//                   prioridades e plano de acompanhamento
//
// Sem argumento: cria só a frente que ainda não tem pesquisa (não duplica).
// Com `--substituir`: nas frentes que já têm pesquisa SEM convites, troca o
// nome, os textos e todas as perguntas pelas daqui; com convites, não mexe.
// Com `--frente <objetivo>` (dados_empresa | nps | crescimento): só essa
// frente — para corrigir uma fase sem encostar nas outras.
//
// NÃO é migração (o nome não casa com `migrate-*`): roda à mão —
//   npx tsx scripts/seed-pesquisas.ts [--substituir] [--frente dados_empresa]
import { config } from "dotenv";
import path from "path";
config({ path: path.join(process.cwd(), ".env.local") });

import { eq, sql } from "drizzle-orm";

import {
  getDb,
  surveyQuestions,
  surveys,
  type NewSurveyQuestion,
  type SurveyObjective,
} from "../lib/db";

type Pergunta = Omit<NewSurveyQuestion, "surveyId" | "position">;

const secao = (label: string, help: string): Pergunta => ({ type: "section", label, help });
const curta = (label: string, extra: Partial<Pergunta> = {}): Pergunta => ({ type: "short_text", label, ...extra });
const longa = (label: string, extra: Partial<Pergunta> = {}): Pergunta => ({ type: "long_text", label, ...extra });
const numero = (label: string, extra: Partial<Pergunta> = {}): Pergunta => ({ type: "number", label, ...extra });
const unica = (
  label: string,
  choices: string[],
  extra: Partial<Pergunta> & { other?: boolean; alertOn?: string[] } = {}
): Pergunta => {
  const { other, alertOn, ...resto } = extra;
  return {
    type: "single_choice",
    label,
    options: { choices, ...(other ? { other: true } : {}), ...(alertOn ? { alertOn } : {}) },
    ...resto,
  };
};
const multipla = (label: string, choices: string[], extra: Partial<Pergunta> & { other?: boolean } = {}): Pergunta => {
  const { other, ...resto } = extra;
  return { type: "multiple_choice", label, options: { choices, ...(other ? { other: true } : {}) }, ...resto };
};
const escala1a5 = (label: string, extra: Partial<Pergunta> = {}): Pergunta => ({
  type: "scale",
  label,
  options: { min: 1, max: 5, minLabel: "Muito baixo", maxLabel: "Muito alto" },
  ...extra,
});

const SIM_PARCIAL_NAO = ["Sim", "Parcialmente", "Não"];
const SEGMENTOS = ["Varejo", "Alimentação", "Agro", "Saúde", "Beleza", "Pet", "Serviços"];

const SUGERIDAS: Record<
  SurveyObjective,
  { name: string; intro: string; thanks: string; perguntas: Pergunta[] }
> = {
  dados_empresa: {
    name: "Fase 1 · Diagnóstico e organização",
    intro:
      "Queremos saber quem é a sua empresa e o tamanho da operação. Leva uns 10 minutos — e dá para parar e voltar depois pelo mesmo link.",
    thanks:
      "Obrigado! Com a realidade da sua empresa em mãos, a Expansão consegue apoiar você do jeito certo.",
    perguntas: [
      secao("Identificação e estrutura da empresa", "Entender quem é o parceiro e como a empresa está organizada."),
      curta("Nome da empresa / razão social", { required: true }),
      curta("CNPJ ou identificador interno do parceiro", { required: true }),
      curta("Nome do responsável principal e cargo", { required: true }),
      curta("Contato profissional: e-mail e telefone", { required: true }),
      unica("Há quanto tempo a empresa atua no mercado?", ["Até 2 anos", "3 a 5 anos", "6 a 10 anos", "Mais de 10 anos"]),
      unica(
        "Qual é a principal atividade da empresa?",
        ["Software house", "Revenda de software", "Contabilidade", "Consultoria", "Serviços de TI"],
        { other: true }
      ),
      unica("Quantas pessoas trabalham na empresa?", ["1 a 5", "6 a 10", "11 a 30", "31 a 100", "Mais de 100"]),
      curta("Quantas pessoas atuam em vendas, implantação, suporte e gestão?", {
        help: "Ex.: vendas 2 · implantação 1 · suporte 2 · gestão 1",
      }),
      unica("A empresa depende de uma única pessoa para decisões ou operação?", SIM_PARCIAL_NAO),

      secao("Perfil e carteira de clientes", "Medir o tamanho da operação e o mercado em que o parceiro atua."),
      unica("Quantos clientes ativos a empresa atende atualmente?", ["Até 20", "21 a 50", "51 a 100", "101 a 300", "Mais de 300"]),
      numero("Quantos desses clientes utilizam soluções Avante?", { options: { unit: "clientes" }, help: "Número aproximado." }),
      unica("A empresa possui sistema próprio ou de outro fornecedor?", ["Sim", "Não"]),
      curta("Se sim, qual sistema?"),
      numero("Quantos clientes ainda utilizam o sistema próprio ou de terceiros?", { options: { unit: "clientes" }, help: "Número aproximado." }),
      multipla("Quais segmentos representam a maior parte da carteira?", SEGMENTOS, { other: true }),
      curta("Qual é a principal região de atuação?"),
      multipla(
        "Como a empresa conquista novos clientes?",
        ["Indicação", "Prospecção ativa", "Marketing digital", "Carteira existente", "Parcerias"],
        { other: true }
      ),
      unica("Existe uma carteira com potencial de migração para soluções Avante?", ["Sim", "Não", "Em avaliação"]),
      numero("Se sim, quantos clientes ou licenças poderiam ser migrados nos próximos 12 meses?", {
        options: { unit: "clientes ou licenças" },
        help: "Número estimado.",
      }),
      curta("Em qual prazo essa migração poderia acontecer?"),

      // Correção da Mayra (28/10/2026): soluções contratadas/comercializadas/com
      // clientes e licenças ativas já estão no Avante Gestão; cidade/regiões e
      // identidade visual também saíram.
      secao("Produtos Avante e utilização", "Entender o interesse em novos produtos, o domínio da equipe e o que falta no produto."),
      longa("Quais produtos o parceiro ainda não vende, mas tem interesse em comercializar?"),
      escala1a5("Como você avalia o domínio técnico dos produtos pela sua equipe?"),
      escala1a5("Como você avalia o conhecimento comercial da sua equipe para demonstrar e vender as soluções?"),
      longa("Quais funcionalidades ou integrações são essenciais para sua operação?"),
      longa("Existem limitações de produto que impedem ou dificultam vendas?"),

    ],
  },

  nps: {
    name: "Fase 2 · Nível de satisfação",
    intro:
      "Queremos medir como você avalia a parceria, a operação e o suporte — e onde estão os riscos. Respostas sinceras são o que faz a Avante melhorar.",
    thanks: "Obrigado pela sinceridade. Se algo pediu atenção, a Expansão entra em contato em até 48 horas.",
    perguntas: [
      secao("Operação, implantação e suporte", "Identificar gargalos que comprometem a entrega e a experiência do cliente final."),
      unica(
        "Como é realizada a implantação dos sistemas para os clientes finais?",
        ["Processo interno", "Equipe dedicada", "Atuação conjunta com a Avante"],
        { other: true }
      ),
      numero("Quantas pessoas estão preparadas para implantar as soluções Avante?", { options: { unit: "pessoas" } }),
      unica("A equipe recebeu os treinamentos necessários?", SIM_PARCIAL_NAO),
      curta("Se faltam treinamentos, quais?"),
      unica(
        "Como é feito o acompanhamento dos clientes após a implantação?",
        ["Contato periódico", "Sob demanda", "Não existe processo formal"],
        { other: true }
      ),
      longa("Qual é a principal dificuldade na implantação ou migração?"),
      unica("Existem chamados recorrentes ou problemas que impactam muitos clientes?", ["Sim", "Não"]),
      longa("Se sim, descreva os chamados ou problemas recorrentes."),
      multipla(
        "Quais demandas mais exigem esforço da equipe do parceiro?",
        ["Treinamento", "Parametrização", "Suporte", "Migração", "Fiscal", "Integrações"],
        { other: true }
      ),
      escala1a5("Como o parceiro avalia o suporte e o retorno das áreas da Avante?"),
      longa("Justifique a avaliação do suporte e do retorno das áreas da Avante."),
      longa("Quais demandas estão pendentes e precisam de acompanhamento?", {
        help: "Descreva e, se houver, informe os números dos tickets.",
      }),

      secao("Relacionamento e percepção da parceria", "Entender a qualidade da relação e o risco de insatisfação."),
      {
        type: "scale",
        label: "De 0 a 10, quanto você recomendaria a parceria Avante a outra software house?",
        required: true,
        isNps: true,
        options: { min: 0, max: 10, minLabel: "Não recomendaria", maxLabel: "Recomendaria com certeza" },
      },
      longa("Quais são os principais pontos positivos da parceria?"),
      longa("O que mais precisa melhorar na parceria?"),
      unica("Você sente que tem clareza sobre a quem recorrer para cada tipo de demanda?", SIM_PARCIAL_NAO),
      escala1a5("Você considera que a Avante compreende as necessidades do seu negócio?", {
        options: { min: 1, max: 5, minLabel: "Não compreende", maxLabel: "Compreende totalmente" },
      }),
      // "Risco de continuidade" gera alerta para a Expansão (contato em 48h).
      unica(
        "Existe alguma situação que esteja colocando a continuidade da parceria em risco?",
        ["Não", "Sim", "Prefiro conversar em reunião"],
        { alertOn: ["Sim", "Prefiro conversar em reunião"] }
      ),
      unica("Você considera ampliar, manter ou reduzir a operação com a Avante?", ["Ampliar", "Manter", "Reduzir", "Ainda não decidi"]),
      longa("Qual é sua principal expectativa em relação ao Sucesso do Cliente?"),
    ],
  },

  crescimento: {
    name: "Fase 3 · Melhorias",
    intro:
      "Queremos identificar o potencial real de expansão da sua empresa, os recursos necessários para realizá-lo e as prioridades dos próximos meses — para transformar o diagnóstico em ações concretas.",
    thanks: "Obrigado! A Expansão vai ler suas respostas e voltar a falar com você com um plano.",
    perguntas: [
      secao("Estratégia comercial e crescimento", "Identificar o potencial real de expansão e os recursos necessários para realizá-lo."),
      longa("Qual é a principal meta de crescimento da empresa para os próximos 12 meses?"),
      numero("Quantas novas licenças Avante pretende comercializar nos próximos 3 meses?", { options: { unit: "licenças" } }),
      numero("E nos próximos 6 meses?", { options: { unit: "licenças" } }),
      numero("E nos próximos 12 meses?", { options: { unit: "licenças" } }),
      numero("Quantas novas licenças dependem de melhorias ou desenvolvimentos no produto?", { options: { unit: "licenças" } }),
      longa("Quais funcionalidades seriam necessárias para essas licenças?"),
      unica("Existe uma base de clientes que poderia migrar para a Avante?", ["Sim", "Não", "Em avaliação"]),
      numero("Qual seria o volume estimado de migração?", { options: { unit: "clientes ou licenças" } }),
      curta("Em qual prazo?"),
      longa("Quais são hoje os três principais obstáculos ao crescimento?"),
      unica("A empresa tem processo comercial definido, metas e acompanhamento de vendas?", SIM_PARCIAL_NAO),
      multipla("Quais produtos ou segmentos deseja priorizar?", SEGMENTOS, { other: true }),
      longa("Por que esses produtos ou segmentos?"),
      multipla(
        "Que tipo de apoio da Avante mais ajudaria a atingir as metas?",
        ["Treinamento", "Material comercial", "Demonstrações", "Apoio técnico", "Produto", "Migração", "Planejamento"],
        { other: true }
      ),

      secao("Prioridades e plano de acompanhamento", "Transformar o diagnóstico em ações concretas."),
      longa("Quais são as três prioridades mais importantes para os próximos 90 dias?"),
      longa("Quais resultados você espera alcançar com o apoio da Avante?"),
      longa("Há alguma data, migração ou projeto importante já previsto?", { help: "Informe a data e descreva." }),
      curta("Quem será o contato principal para o acompanhamento?", { help: "Nome, cargo e contato profissional." }),
      unica("Qual frequência de acompanhamento faz mais sentido para sua operação?", [
        "Mensal",
        "Bimestral",
        "Trimestral",
        "Conforme necessidade",
      ]),
      longa("Existe alguma informação importante que não foi contemplada?"),
    ],
  },
};

async function main() {
  const substituir = process.argv.includes("--substituir");
  const frenteIdx = process.argv.indexOf("--frente");
  const frente = frenteIdx >= 0 ? process.argv[frenteIdx + 1] : undefined;
  if (frenteIdx >= 0 && !(frente && frente in SUGERIDAS)) {
    console.error(`[SEED] --frente precisa de um destes: ${Object.keys(SUGERIDAS).join(", ")}.`);
    process.exit(1);
  }
  const frentes = (frente ? [frente] : Object.keys(SUGERIDAS)) as SurveyObjective[];
  const db = getDb();

  for (const objective of frentes) {
    const s = SUGERIDAS[objective];
    const existentes = await db
      .select({
        id: surveys.id,
        name: surveys.name,
        convites: sql<number>`(select count(*) from survey_invites i where i.survey_id = surveys.id)`.mapWith(Number),
      })
      .from(surveys)
      .where(eq(surveys.objective, objective));

    if (existentes.length === 0) {
      const [criada] = await db
        .insert(surveys)
        .values({ objective, name: s.name, intro: s.intro, thanks: s.thanks, createdByName: "Mapeamento da parceria" })
        .returning({ id: surveys.id });
      await db.insert(surveyQuestions).values(s.perguntas.map((p, position) => ({ ...p, surveyId: criada.id, position })));
      console.log(`[SEED] ${objective}: criada "${s.name}" com ${s.perguntas.length} itens.`);
      continue;
    }

    if (!substituir) {
      console.log(`[SEED] ${objective}: já tem pesquisa ("${existentes[0].name}"), pulando. Use --substituir para trocar as perguntas.`);
      continue;
    }

    for (const e of existentes) {
      if (e.convites > 0) {
        console.log(`[SEED] ${objective}: "${e.name}" tem ${e.convites} convite(s) — não mexo.`);
        continue;
      }
      await db.transaction(async (tx) => {
        await tx.delete(surveyQuestions).where(eq(surveyQuestions.surveyId, e.id));
        await tx
          .update(surveys)
          .set({ name: s.name, intro: s.intro, thanks: s.thanks, updatedAt: new Date() })
          .where(eq(surveys.id, e.id));
        await tx.insert(surveyQuestions).values(s.perguntas.map((p, position) => ({ ...p, surveyId: e.id, position })));
      });
      console.log(`[SEED] ${objective}: "${e.name}" → "${s.name}" com ${s.perguntas.length} itens.`);
    }
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("[SEED] Falhou:", error);
  process.exit(1);
});
