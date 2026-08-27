import { config } from "dotenv";
import { Client } from "pg";

// A QUALIFICAÇÃO sai do código e vira tabela, como as etapas já eram.
//
// A lista era constante ("vocabulário nosso, do playbook") até o campo "Lead
// qualificado" do Pipedrive ter opções que o código não conhecia — "Promissor:
// Baixo potencial", "Não", "Não identificado" — e toda entrega do agente com
// elas ser recusada. A lista é do comercial; agora vive em
// `lead_qualifications` e se edita em /leads/qualificacoes, sem deploy.
//
// A semente espelha as 7 opções do campo no Pipedrive (funil White Label -
// Inbound, lidas em 27/08/2026). As quatro que já existiam MANTÊM o slug
// antigo (`experiente`, `alto_potencial`...): é ele que `contacts.qualification`
// guarda e que as regras de pontuação e gatilhos de automação carregam —
// trocar o slug deixaria tudo isso órfão. Só o rótulo passa a ser o do
// Pipedrive, e o texto do playbook vai junto para a tabela.
//
// Rode uma vez: `npx tsx scripts/migrate-qualificacoes.ts`

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[MIGRATE] DATABASE_URL não definida no .env.local.");
  process.exit(1);
}

const needsSsl = /sslmode=require|neon\.tech/.test(url);
const client = new Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

const MARCADOR = "lead_qualificacoes_editaveis";

interface Semente {
  slug: string;
  label: string;
  position: number;
  potential: string | null;
  variant: string;
  quemSao: string | null;
  perfil: string | null;
  motivacoes: string | null;
  dores: string | null;
}

const SEMENTES: Semente[] = [
  {
    slug: "iniciante",
    label: "Sim: Iniciante",
    position: 10,
    potential: "Médio",
    variant: "info",
    quemSao:
      "Revendas começando na área (menos de 1 ano ou poucos clientes), software houses iniciando sem ERP, empresas começando com software sem experiência e contabilidades se inserindo na área.",
    perfil:
      "Em fase de estruturação da empresa, com poucos clientes e equipe enxuta.",
    motivacoes:
      "Crescer rápido construindo marca própria forte e se diferenciar com sistemas web. Precisam de apoio em capacitação, vendas e suporte.",
    dores:
      "Sobrecarga da equipe pequena, suporte ineficiente nas soluções atuais e falta de uma parceria próxima e colaborativa.",
  },
  {
    slug: "intermediario",
    label: "Sim: Intermediário",
    position: 20,
    potential: "Médio a alto",
    variant: "warning",
    quemSao: "Revendas de software com mais de 2 anos de mercado.",
    perfil:
      "Costumam ter boa base de clientes (de 50 a 150), mas ainda sem a experiência profunda e madura em desenvolvimento e estratégia de software do perfil Experiente.",
    motivacoes: null,
    dores: null,
  },
  {
    slug: "experiente",
    label: "Sim: Experiente",
    position: 30,
    potential: "Alto",
    variant: "destructive",
    quemSao:
      "Revendas de software com mais de 10 anos de mercado, base sólida de clientes e muito conhecimento técnico. Software houses desenvolvedoras de ERP há muitos anos no mercado.",
    perfil:
      "Software House ERP: soluções próprias em versões locais/desktop, equipe estruturada de comercial e suporte, carteira ativa e experiência técnica. Revenda Experiente: revendem sistemas instalados, com frequência sem marca própria, e têm domínio comercial/operacional estabelecido.",
    motivacoes:
      "Modernizar para nuvem, escalar sem reescrever do zero, fortalecer a marca própria e expandir para novos nichos.",
    dores:
      "Custo alto de reescrita e manutenção, dificuldade com tecnologias em nuvem, dependência dos fornecedores atuais e concorrência de soluções web modernas.",
  },
  {
    slug: "alto_potencial",
    label: "Promissor: Alto potencial",
    position: 40,
    potential: "Alto a médio",
    variant: "success",
    quemSao:
      "Empresas sem experiência direta com venda de software, mas com mercado amplo e grande capacidade de oferecer o produto à própria rede. Ex.: ARs de certificado digital com grandes bases, grandes agências de marketing, empresas de tecnologia de alto potencial, lojas de informática estruturadas e contabilidades em geral.",
    perfil:
      "Profissionais ou empresas com referência e influência no nicho, com estrutura adaptável para ERP. Buscam evitar o custo de desenvolvimento próprio.",
    motivacoes:
      "Iniciar um negócio com produto pronto (white-label), gerar receita recorrente, monetizar o networking/carteira e fidelizar clientes.",
    dores:
      "Pouco conhecimento técnico do mercado de software/ERP, necessidade de estrutura pronta (suporte completo) e receio inicial do setor.",
  },
  // As três abaixo eram as opções do Pipedrive que o código NÃO conhecia — o
  // motivo desta migração. Entram sem pontos: peso é decisão do time, na tela.
  {
    slug: "promissor-baixo-potencial",
    label: "Promissor: Baixo potencial",
    position: 50,
    potential: null,
    variant: "secondary",
    quemSao: null,
    perfil: null,
    motivacoes: null,
    dores: null,
  },
  {
    slug: "nao",
    label: "Não",
    position: 60,
    potential: null,
    variant: "secondary",
    quemSao: null,
    perfil: null,
    motivacoes: null,
    dores: null,
  },
  {
    slug: "nao-identificado",
    label: "Não identificado",
    position: 70,
    potential: null,
    variant: "secondary",
    quemSao: null,
    perfil: null,
    motivacoes: null,
    dores: null,
  },
];

async function main() {
  await client.connect();

  const { rows: feito } = await client.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [MARCADOR]
  );
  if (feito.length > 0) {
    console.log("[MIGRATE] Qualificações já migradas.");
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");

  console.log("[MIGRATE] lead_qualifications...");
  await client.query(
    `CREATE TABLE IF NOT EXISTS lead_qualifications (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       slug text NOT NULL UNIQUE,
       label text NOT NULL,
       position integer NOT NULL DEFAULT 0,
       potential text,
       variant text NOT NULL DEFAULT 'secondary',
       quem_sao text,
       perfil text,
       motivacoes text,
       dores text,
       active boolean NOT NULL DEFAULT true,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  for (const s of SEMENTES) {
    await client.query(
      `INSERT INTO lead_qualifications
         (slug, label, position, potential, variant, quem_sao, perfil, motivacoes, dores)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (slug) DO NOTHING`,
      [
        s.slug,
        s.label,
        s.position,
        s.potential,
        s.variant,
        s.quemSao,
        s.perfil,
        s.motivacoes,
        s.dores,
      ]
    );
  }
  console.log(`[MIGRATE]   ${SEMENTES.length} qualificações semeadas`);

  // As regras de pontuação existentes (lead_qualified por slug) continuam
  // valendo como estão: os slugs não mudaram. Nada a fazer nelas.

  await client.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, 'true')
     ON CONFLICT (key) DO UPDATE SET value = 'true'`,
    [MARCADOR]
  );

  await client.query("COMMIT");
  console.log("[MIGRATE] Concluído.");

  await client.end();
  process.exit(0);
}

main().catch(async (error) => {
  await client.query("ROLLBACK").catch(() => {});
  console.error("[MIGRATE] Falhou:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
