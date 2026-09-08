import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { buildUploadName, getUploadsDir, uploadNameFromUrl } from "@/lib/uploads";
import { errorMessage } from "@/lib/utils";
import { WHATSAPP_MEDIA_HEADERS } from "@/lib/whatsapp/types";
import {
  renderVideoWithCover,
  VideoToolMissingError,
} from "@/lib/whatsapp/video-cover";

export const dynamic = "force-dynamic";

/**
 * Regrava o vídeo do cabeçalho com o quadro do instante `at` parado no início
 * (é dele que o WhatsApp tira a capa). Recebe { sourceUrl, at }: sourceUrl é
 * o vídeo ORIGINAL em /uploads — nunca uma regravação, senão as capas se
 * acumulariam. Gera um arquivo novo e devolve a URL; o original fica para o
 * usuário trocar a capa depois.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sourceUrl?: unknown;
      at?: unknown;
    };
    const spec = WHATSAPP_MEDIA_HEADERS.video;

    const sourceName =
      typeof body.sourceUrl === "string" ? uploadNameFromUrl(body.sourceUrl) : null;
    const ext = sourceName?.split(".").pop()?.toLowerCase() ?? "";
    if (!sourceName || !spec.types[ext]) {
      return NextResponse.json(
        { error: "Envie o vídeo antes de escolher a capa." },
        { status: 400 }
      );
    }
    const at = Number(body.at);
    if (!Number.isFinite(at) || at < 0) {
      return NextResponse.json(
        { error: "Instante da capa inválido." },
        { status: 400 }
      );
    }

    const dir = getUploadsDir();
    const sourcePath = path.join(dir, sourceName);
    try {
      await fs.access(sourcePath);
    } catch {
      return NextResponse.json(
        { error: "O vídeo não está mais no servidor — envie o arquivo novamente." },
        { status: 400 }
      );
    }

    // Nome derivado do original; se por acaso vier uma regravação, o sufixo
    // "-capa-xxxxxx" dela não se acumula.
    const base = sourceName
      .replace(/\.[^.]+$/, "")
      .replace(/-capa-[a-z0-9]{6}$/, "");
    const outName = buildUploadName(`${base}-capa`, ext);
    const result = await renderVideoWithCover({
      sourcePath,
      at,
      outPath: path.join(dir, outName),
      maxBytes: spec.maxBytes,
    });

    return NextResponse.json(
      { url: `/uploads/${outName}`, size: result.size, coverAt: result.coverAt },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof VideoToolMissingError) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 503 });
    }
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
