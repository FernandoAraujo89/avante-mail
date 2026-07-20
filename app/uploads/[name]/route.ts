import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import {
  ALLOWED_UPLOAD_TYPES,
  getUploadsDir,
  sanitizeUploadName,
} from "@/lib/uploads";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string }> };

/** Serve as imagens hospedadas (usadas dentro dos e-mails). */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { name } = await context.params;
  const safe = sanitizeUploadName(name);
  if (!safe) {
    return new NextResponse("Not found", { status: 404 });
  }

  let data: Buffer;
  try {
    data = await fs.readFile(path.join(getUploadsDir(), safe));
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const ext = safe.split(".").pop()!.toLowerCase();
  const headers: Record<string, string> = {
    "Content-Type": ALLOWED_UPLOAD_TYPES[ext],
    "Content-Length": String(data.length),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  // SVG pode conter scripts; o CSP impede execução se aberto diretamente.
  if (ext === "svg") {
    headers["Content-Security-Policy"] =
      "default-src 'none'; style-src 'unsafe-inline'";
  }

  return new NextResponse(new Uint8Array(data), { status: 200, headers });
}
