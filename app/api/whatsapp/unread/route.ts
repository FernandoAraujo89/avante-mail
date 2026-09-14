import { NextResponse } from "next/server";

import { errorMessage } from "@/lib/utils";
import { countUnreadConversations } from "@/lib/whatsapp/conversations";

export const dynamic = "force-dynamic";

// Conversas com mensagem por ler — o número ao lado de "Conversas" no menu.
export async function GET() {
  try {
    return NextResponse.json({ unread: await countUnreadConversations() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
