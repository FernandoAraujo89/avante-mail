import { NextResponse } from "next/server";

import { getDb, users } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Healthcheck público usado pelo monitor de uptime.
 * Confirma que o app responde E que o banco está acessível.
 */
export async function GET() {
  try {
    const db = getDb();
    await db.select({ id: users.id }).from(users).limit(1);
    return NextResponse.json(
      { ok: true, db: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { ok: false, db: false },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
