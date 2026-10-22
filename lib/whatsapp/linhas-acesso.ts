// As linhas que quem está logado alcança, e a conversa que ele pode abrir.
// Servidor: lê a sessão da requisição. As regras são de ./linhas.ts.
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { getDb, whatsappConversations, type WhatsAppConversation } from "@/lib/db";
import { sessionUserFromRequest } from "@/lib/session";

import { linhasDoPerfil, type Linha } from "./linhas";

export async function linhasDaRequisicao(request: NextRequest): Promise<Linha[]> {
  const user = await sessionUserFromRequest(request);
  return user ? linhasDoPerfil(user.role) : [];
}

/** A conversa, se existe e está numa linha que quem pede alcança; senão null. */
export async function conversaAlcancavel(
  request: NextRequest,
  conversationId: string
): Promise<WhatsAppConversation | null> {
  const [conversation] = await getDb()
    .select()
    .from(whatsappConversations)
    .where(eq(whatsappConversations.id, conversationId));
  if (!conversation) return null;
  const linhas = await linhasDaRequisicao(request);
  return linhas.includes(conversation.line) ? conversation : null;
}
