import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { getUploadsDir, sanitizeUploadName } from "@/lib/uploads";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { name } = await context.params;
    const safe = sanitizeUploadName(name);
    if (!safe) {
      return NextResponse.json(
        { error: "Nome de arquivo inválido." },
        { status: 400 }
      );
    }

    try {
      await fs.unlink(path.join(getUploadsDir(), safe));
    } catch {
      return NextResponse.json(
        { error: "Imagem não encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
