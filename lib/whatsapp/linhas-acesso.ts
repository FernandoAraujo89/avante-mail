// As linhas que quem está logado alcança, e a conversa que ele pode abrir.
// Servidor: lê a sessão da requisição. As regras são de ./linhas.ts.
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { getDb, whatsappConversations, type WhatsAppConversation } from "@/lib/db";
import { sessionUserFromRequest } from "@/lib/session";

import { caixaDaLinha, caixasDoPerfil, type Caixa } from "./linhas";

/** As caixas da tela de conversas (linhas nossas e outros números) de quem pede. */
export async function caixasDaRequisicao(request: NextRequest): Promise<Caixa[]> {
  const user = await sessionUserFromRequest(request);
  return user ? caixasDoPerfil(user.role) : [];
}

/** A conversa, se existe e está numa caixa que quem pede alcança; senão null. */
export async function conversaAlcancavel(
  request: NextRequest,
  conversationId: string
): Promise<WhatsAppConversation | null> {
  const [conversation] = await getDb()
    .select()
    .from(whatsappConversations)
    .where(eq(whatsappConversations.id, conversationId));
  if (!conversation) return null;
  const caixas = await caixasDaRequisicao(request);
  return caixas.includes(caixaDaLinha(conversation.line)) ? conversation : null;
}
