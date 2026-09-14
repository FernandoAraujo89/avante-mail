import { redirect } from "next/navigation";

import { ConversationsInbox } from "@/components/whatsapp/inbox/conversations-inbox";
import { UUID_REGEX } from "@/lib/utils";
import { conversationIdsByContact } from "@/lib/whatsapp/conversations";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; contato?: string }>;
}) {
  const { c, contato } = await searchParams;

  // Atalho da ficha do contato e do relatório: chegam pelo contato, e a
  // conversa é a mais recente dele.
  if (!c && contato && UUID_REGEX.test(contato)) {
    const conversationId = (await conversationIdsByContact([contato])).get(contato);
    redirect(conversationId ? `/conversations?c=${conversationId}` : "/conversations");
  }

  return (
    // Altura da janela menos o respiro do layout (e a barra do topo no
    // celular): a conversa rola por dentro, e a caixa de resposta fica à vista.
    <div className="flex h-[calc(100dvh-6.5rem)] min-h-[32rem] flex-col md:h-[calc(100dvh-4rem)]">
      <ConversationsInbox />
    </div>
  );
}
