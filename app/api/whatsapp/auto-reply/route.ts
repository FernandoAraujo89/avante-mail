import { NextRequest, NextResponse } from "next/server";

import { normalizePhone } from "@/lib/phone";
import { getSetting, setSetting } from "@/lib/settings";
import { errorMessage } from "@/lib/utils";
import {
  AUTO_REPLY_SETTING_KEY,
  parseAutoReplyInput,
  readAutoReplySettings,
} from "@/lib/whatsapp/auto-reply";

export const dynamic = "force-dynamic";

// Configuração da resposta automática do número de comunicados. Mora em
// app_settings, e não no código, porque o texto e o número do atendimento são
// do time de Sucesso do Cliente — trocar um deles não pode esperar deploy.

export async function GET() {
  try {
    return NextResponse.json({
      settings: readAutoReplySettings(await getSetting(AUTO_REPLY_SETTING_KEY)),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = parseAutoReplyInput(body, (value) => normalizePhone(value));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    await setSetting(AUTO_REPLY_SETTING_KEY, JSON.stringify(parsed.data));
    return NextResponse.json({ settings: parsed.data });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
