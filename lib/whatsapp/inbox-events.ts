/**
 * Evento de janela disparado quando o número de conversas não lidas muda por
 * ação de quem está na tela (abriu uma conversa). O menu lateral escuta para
 * atualizar o contador na hora, sem esperar a próxima consulta periódica.
 * Mora aqui, e não na caixa de conversas, para o menu não carregar a caixa
 * inteira em todas as páginas.
 */
export const UNREAD_CHANGED_EVENT = "whatsapp:unread-changed";
