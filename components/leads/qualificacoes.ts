/**
 * As qualificações do playbook do SDR, do jeito que o agente as manda.
 *
 * Arquivo puro, sem import de servidor: ele é lido pela tela e por
 * `lib/webhooks/entrada.ts`. Um import de banco aqui arrastaria o driver do
 * Postgres para o pacote do navegador.
 *
 * O texto completo fica aqui, e não só o rótulo, porque quem olha a ficha
 * precisa saber o que "Alto Potencial" quer dizer sem abrir outro documento —
 * é o que separa uma etiqueta de uma informação.
 */
export const QUALIFICACOES = [
  {
    valor: "experiente",
    rotulo: "Experiente",
    potencial: "Alto",
    variante: "destructive" as const,
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
    valor: "intermediario",
    rotulo: "Intermediário",
    potencial: "Médio a alto",
    variante: "warning" as const,
    quemSao: "Revendas de software com mais de 2 anos de mercado.",
    perfil:
      "Costumam ter boa base de clientes (de 50 a 150), mas ainda sem a experiência profunda e madura em desenvolvimento e estratégia de software do perfil Experiente.",
    motivacoes: null,
    dores: null,
  },
  {
    valor: "iniciante",
    rotulo: "Iniciante",
    potencial: "Médio",
    variante: "info" as const,
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
    valor: "alto_potencial",
    rotulo: "Alto Potencial",
    potencial: "Alto a médio",
    variante: "success" as const,
    quemSao:
      "Empresas sem experiência direta com venda de software, mas com mercado amplo e grande capacidade de oferecer o produto à própria rede. Ex.: ARs de certificado digital com grandes bases, grandes agências de marketing, empresas de tecnologia de alto potencial, lojas de informática estruturadas e contabilidades em geral.",
    perfil:
      "Profissionais ou empresas com referência e influência no nicho, com estrutura adaptável para ERP. Buscam evitar o custo de desenvolvimento próprio.",
    motivacoes:
      "Iniciar um negócio com produto pronto (white-label), gerar receita recorrente, monetizar o networking/carteira e fidelizar clientes.",
    dores:
      "Pouco conhecimento técnico do mercado de software/ERP, necessidade de estrutura pronta (suporte completo) e receio inicial do setor.",
  },
] as const;

export type QualificacaoInfo = (typeof QUALIFICACOES)[number];

export function qualificacaoInfo(valor: string | null): QualificacaoInfo | null {
  return QUALIFICACOES.find((q) => q.valor === valor) ?? null;
}

export function qualificacaoLabel(valor: string | null): string {
  return qualificacaoInfo(valor)?.rotulo ?? valor ?? "—";
}
