/**
 * Rótulos dos status de envio. Fonte única para o selo da tabela, o filtro do
 * relatório e a coluna do CSV — se cada tela escrevesse o seu, "Entregue" e
 * "entregue" apareceriam lado a lado no mesmo relatório.
 */
export const SEND_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  sent: "Enviado",
  failed: "Falhou",
  opened: "Aberto",
  clicked: "Clicado",
  bounced: "Devolvido",
  // Canal WhatsApp (confirmações da Cloud API).
  delivered: "Entregue",
  read: "Lida",
};

export function sendStatusLabel(status: string): string {
  return SEND_STATUS_LABELS[status] ?? status;
}

/** Ordem em que os status aparecem nos filtros: do melhor desfecho ao pior. */
const ORDEM: string[] = [
  "read",
  "clicked",
  "opened",
  "delivered",
  "sent",
  "pending",
  "failed",
  "bounced",
];

export function compareSendStatus(a: string, b: string): number {
  const ia = ORDEM.indexOf(a);
  const ib = ORDEM.indexOf(b);
  return (ia === -1 ? ORDEM.length : ia) - (ib === -1 ? ORDEM.length : ib);
}
