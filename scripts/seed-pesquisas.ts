// Cria as 3 pesquisas sugeridas (uma por frente) como RASCUNHO, com perguntas
// para o time da Expansão editar em vez de começar do zero. Só cria a frente
// que ainda não tem nenhuma pesquisa — rodar de novo não duplica.
//
// NÃO é migração (o nome não casa com `migrate-*`): roda à mão, uma vez por
// ambiente: `npx tsx scripts/seed-pesquisas.ts`
import { config } from "dotenv";
import path from "path";
config({ path: path.join(process.cwd(), ".env.local") });

import { eq } from "drizzle-orm";

import {
  getDb,
  surveyQuestions,
  surveys,
  type NewSurveyQuestion,
  type SurveyObjective,
} from "../lib/db";

type Pergunta = Omit<NewSurveyQuestion, "surveyId" | "position">;

const SUGERIDAS: Record<
  SurveyObjective,
  { name: string; intro: string; thanks: string; perguntas: Pergunta[] }
> = {
  dados_empresa: {
    name: "Raio-X da empresa",
    intro:
      "Queremos conhecer melhor a sua empresa para apoiar você do jeito certo. Leva uns 5 minutos, e você pode parar e voltar depois pelo mesmo link.",
    thanks: "Obrigado! Suas respostas ajudam a Avante a entender a sua realidade e a trabalhar junto com você.",
    perguntas: [
      { type: "section", label: "Sobre a empresa" },
      { type: "short_text", label: "Nome da empresa (como os clientes conhecem)", required: true },
      { type: "short_text", label: "Cidade e estado", required: true },
      { type: "number", label: "Ano de fundação" },
      {
        type: "single_choice",
        label: "Quantas pessoas trabalham na empresa hoje?",
        required: true,
        options: { choices: ["Só eu", "2 a 5", "6 a 10", "11 a 30", "31 a 100", "Mais de 100"] },
      },
      {
        type: "single_choice",
        label: "Faixa de faturamento mensal",
        options: {
          choices: [
            "Até R$ 10 mil",
            "R$ 10 mil a R$ 50 mil",
            "R$ 50 mil a R$ 200 mil",
            "R$ 200 mil a R$ 1 milhão",
            "Acima de R$ 1 milhão",
            "Prefiro não informar",
          ],
        },
      },
      {
        type: "multiple_choice",
        label: "Segmentos que a empresa atende",
        options: {
          choices: ["Varejo", "Alimentação", "Serviços", "Indústria", "Saúde", "Educação"],
          other: true,
        },
      },
      { type: "section", label: "Clientes e mercado" },
      { type: "number", label: "Quantos clientes ativos a empresa tem hoje?", options: { unit: "clientes" } },
      { type: "short_text", label: "Principais concorrentes na sua região" },
      {
        type: "single_choice",
        label: "Como a empresa conquista a maior parte dos clientes?",
        options: {
          choices: ["Indicação", "Redes sociais", "Anúncios", "Equipe de vendas", "Parcerias"],
          other: true,
        },
      },
      { type: "long_text", label: "O que mais você quer que a Avante saiba sobre a sua empresa?" },
    ],
  },
  nps: {
    name: "Satisfação com a Avante",
    intro:
      "Sua opinião orienta o que a Avante faz em seguida. São poucas perguntas — a primeira é a mais importante.",
    thanks: "Obrigado pela sinceridade. Vamos usar isso para melhorar.",
    perguntas: [
      {
        type: "scale",
        label: "De 0 a 10, o quanto você recomendaria a Avante para outro empresário?",
        required: true,
        isNps: true,
        options: { min: 0, max: 10, minLabel: "Não recomendaria", maxLabel: "Recomendaria com certeza" },
      },
      { type: "long_text", label: "O que motivou a sua nota?", required: true },
      {
        type: "scale",
        label: "Como você avalia o suporte da Avante?",
        options: { min: 1, max: 5, minLabel: "Ruim", maxLabel: "Excelente" },
      },
      {
        type: "scale",
        label: "Como você avalia o produto?",
        options: { min: 1, max: 5, minLabel: "Ruim", maxLabel: "Excelente" },
      },
      { type: "yes_no", label: "A Avante atendeu o que você esperava neste período?" },
      { type: "long_text", label: "O que a Avante poderia fazer para merecer uma nota maior?" },
    ],
  },
  crescimento: {
    name: "Plano de crescimento",
    intro:
      "Queremos entender o que faria a sua empresa crescer mais — e onde a Avante pode ajudar de verdade.",
    thanks: "Obrigado! A Expansão vai ler suas respostas e voltar a falar com você.",
    perguntas: [
      {
        type: "single_choice",
        label: "Qual é o principal objetivo da sua empresa para os próximos 12 meses?",
        required: true,
        options: {
          choices: [
            "Conquistar mais clientes",
            "Aumentar o faturamento com os clientes atuais",
            "Organizar processos internos",
            "Contratar e formar equipe",
            "Lançar novos produtos ou serviços",
          ],
          other: true,
        },
      },
      {
        type: "multiple_choice",
        label: "Em que áreas a Avante pode ajudar mais a sua empresa a crescer?",
        required: true,
        options: {
          choices: [
            "Marketing e divulgação",
            "Vendas e prospecção",
            "Treinamento da equipe",
            "Suporte técnico",
            "Material comercial",
            "Precificação e planos",
            "Parcerias locais",
          ],
          other: true,
        },
      },
      {
        type: "scale",
        label: "Quanto a Avante contribui hoje para o crescimento da sua empresa?",
        options: { min: 1, max: 5, minLabel: "Quase nada", maxLabel: "Muito" },
      },
      { type: "long_text", label: "Qual é o maior obstáculo para a sua empresa crescer hoje?", required: true },
      { type: "long_text", label: "Que ação concreta da Avante faria diferença nos próximos 3 meses?" },
      {
        type: "yes_no",
        label: "Você gostaria de uma conversa com a Expansão para montar um plano de crescimento?",
      },
    ],
  },
};

async function main() {
  const db = getDb();
  for (const objective of Object.keys(SUGERIDAS) as SurveyObjective[]) {
    const [existente] = await db
      .select({ id: surveys.id })
      .from(surveys)
      .where(eq(surveys.objective, objective))
      .limit(1);
    if (existente) {
      console.log(`[SEED] ${objective}: já tem pesquisa, pulando.`);
      continue;
    }
    const s = SUGERIDAS[objective];
    const [criada] = await db
      .insert(surveys)
      .values({ objective, name: s.name, intro: s.intro, thanks: s.thanks, createdByName: "Sugestão inicial" })
      .returning({ id: surveys.id });
    await db.insert(surveyQuestions).values(
      s.perguntas.map((p, position) => ({ ...p, surveyId: criada.id, position }))
    );
    console.log(`[SEED] ${objective}: "${s.name}" com ${s.perguntas.length} itens.`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("[SEED] Falhou:", error);
  process.exit(1);
});
