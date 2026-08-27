/**
 * Vocabulário das qualificações — espelho do campo "Lead qualificado" do
 * Pipedrive, que vive na tabela `lead_qualifications` (editável em
 * /leads/qualificacoes) e chega às telas por /api/leads/qualificacoes.
 *
 * Este arquivo já foi a lista inteira, hardcoded, "porque o playbook é nosso e
 * estável" — até o Pipedrive ter opções que o código não conhecia e o webhook
 * recusar cada uma delas. Hoje ele é só o tipo e os helpers, como
 * `estagios.ts` é para as etapas.
 *
 * Arquivo puro, sem import de servidor: ele é lido pelas telas. Um import de
 * banco aqui arrastaria o driver do Postgres para o pacote do navegador.
 */

/** Uma qualificação, do jeito que a API a entrega. */
export interface QualificacaoDto {
  id: string;
  slug: string;
  /** O nome exato da opção no Pipedrive ("Sim: Experiente"). */
  label: string;
  position: number;
  /** Leitura rápida do playbook ("Alto", "Médio a alto"). */
  potential: string | null;
  variant: string;
  quemSao: string | null;
  perfil: string | null;
  motivacoes: string | null;
  dores: string | null;
  active: boolean;
}

/** As variantes de Badge que a tela oferece, com nome de gente. */
export const VARIANTES_DE_QUALIFICACAO = [
  { valor: "destructive", rotulo: "Vermelho" },
  { valor: "warning", rotulo: "Âmbar" },
  { valor: "info", rotulo: "Azul" },
  { valor: "success", rotulo: "Verde" },
  { valor: "secondary", rotulo: "Cinza" },
] as const;

export type QualificacaoVariante =
  (typeof VARIANTES_DE_QUALIFICACAO)[number]["valor"];

/**
 * A variante que o Badge aceita. O banco guarda texto livre; um valor fora da
 * lista (linha antiga, edição à mão) cai no cinza em vez de quebrar a tela.
 */
export function varianteDaQualificacao(
  q: Pick<QualificacaoDto, "variant"> | null
): QualificacaoVariante {
  const achada = VARIANTES_DE_QUALIFICACAO.find((v) => v.valor === q?.variant);
  return achada?.valor ?? "secondary";
}

export function qualificacaoInfo(
  lista: QualificacaoDto[],
  valor: string | null
): QualificacaoDto | null {
  if (!valor) return null;
  return lista.find((q) => q.slug === valor) ?? null;
}

/** O rótulo de um slug — o próprio slug quando a lista não o conhece. */
export function qualificacaoLabel(
  lista: QualificacaoDto[],
  valor: string | null
): string {
  return qualificacaoInfo(lista, valor)?.label ?? valor ?? "—";
}
