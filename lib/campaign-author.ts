/**
 * Quem disparou a campanha, para exibição.
 *
 * São duas fontes porque cada uma cobre uma falha da outra: o vínculo com o
 * usuário dá o nome ATUAL (que pode ter sido corrigido depois do envio), e a
 * cópia guardada no disparo sobrevive à remoção da conta. Sem a cópia, apagar
 * um usuário apagaria junto o registro de quem enviou.
 *
 * Campanhas disparadas antes deste registro existir dizem "não registrado" —
 * é mais honesto que deixar em branco, o que pareceria "ninguém enviou".
 * Retorna null para o que ainda não foi disparado (rascunho, agendada).
 */
export function campaignSenderLabel(
  campaign: { sentByName: string | null; status: string },
  currentName?: string | null
): string | null {
  if (currentName?.trim()) return currentName.trim();
  if (campaign.sentByName?.trim()) return campaign.sentByName.trim();
  return ["sent", "sending"].includes(campaign.status)
    ? "não registrado"
    : null;
}
