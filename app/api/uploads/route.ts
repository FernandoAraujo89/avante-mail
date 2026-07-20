import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import {
  ALLOWED_UPLOAD_TYPES,
  buildUploadName,
  getUploadsDir,
  MAX_UPLOAD_BYTES,
} from "@/lib/uploads";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Nenhum arquivo recebido." },
        { status: 400 }
      );
    }

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_UPLOAD_TYPES[ext]) {
      return NextResponse.json(
        { error: "Formato não suportado. Envie png, gif, jpg ou svg." },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "O arquivo está vazio." },
        { status: 400 }
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "A imagem excede o limite de 5MB." },
        { status: 400 }
      );
    }

    const dir = getUploadsDir();
    await fs.mkdir(dir, { recursive: true });

    const name = buildUploadName(file.name, ext);
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(dir, name), bytes);

    return NextResponse.json(
      { name, url: `/uploads/${name}`, size: file.size },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const dir = getUploadsDir();
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      // diretório ainda não existe: nenhuma imagem enviada
      return NextResponse.json([]);
    }

    const files = await Promise.all(
      names
        .filter((name) =>
          ALLOWED_UPLOAD_TYPES[name.split(".").pop()?.toLowerCase() ?? ""]
        )
        .map(async (name) => {
          const stat = await fs.stat(path.join(dir, name));
          return {
            name,
            url: `/uploads/${name}`,
            size: stat.size,
            modifiedAt: stat.mtimeMs,
          };
        })
    );

    files.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return NextResponse.json(files);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
