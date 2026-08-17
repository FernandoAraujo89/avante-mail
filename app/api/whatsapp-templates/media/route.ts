import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { buildUploadName, getUploadsDir } from "@/lib/uploads";
import { errorMessage } from "@/lib/utils";
import {
  isMediaHeader,
  parseHeaderType,
  WHATSAPP_MEDIA_HEADERS,
} from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

/** Nome exibido no card do documento no WhatsApp — vem do arquivo original. */
function displayFilename(original: string): string {
  const clean = original
    .replace(/[\\/]/g, "") // separador de caminho
    .replace(/\p{C}/gu, "") // caracteres de controle
    .trim()
    .slice(0, 120);
  return clean || "arquivo";
}

function limitLabel(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * Recebe a imagem ou o PDF do cabeçalho de um modelo e guarda em /uploads —
 * é de lá que a Meta baixa o arquivo em cada envio.
 *
 * Só grava o arquivo: a amostra exigida na análise sobe no submit do modelo,
 * então montar um rascunho continua não dependendo da conta Meta configurada.
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();

    const kind = parseHeaderType(form.get("kind"));
    if (!isMediaHeader(kind)) {
      return NextResponse.json(
        { error: "Tipo de cabeçalho inválido. Use image ou document." },
        { status: 400 }
      );
    }
    const spec = WHATSAPP_MEDIA_HEADERS[kind];

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Nenhum arquivo recebido." },
        { status: 400 }
      );
    }

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!spec.types[ext]) {
      return NextResponse.json(
        {
          error:
            kind === "image"
              ? "No cabeçalho de imagem a Meta aceita só JPG ou PNG."
              : "No cabeçalho de documento a Meta aceita só PDF.",
        },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "O arquivo está vazio." },
        { status: 400 }
      );
    }
    if (file.size > spec.maxBytes) {
      return NextResponse.json(
        {
          error: `O arquivo tem ${limitLabel(file.size)} e o limite da Meta para este formato é ${limitLabel(spec.maxBytes)}.`,
        },
        { status: 400 }
      );
    }

    const dir = getUploadsDir();
    await fs.mkdir(dir, { recursive: true });

    const name = buildUploadName(file.name, ext);
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(dir, name), bytes);

    return NextResponse.json(
      {
        url: `/uploads/${name}`,
        filename: displayFilename(file.name),
        size: file.size,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
