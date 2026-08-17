import { promises as fs } from "fs";
import path from "path";

/** Limite de tamanho por imagem: 5MB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Extensões aceitas no banco de imagens do editor de e-mail. */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  png: "image/png",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
};

/**
 * Tudo que /uploads entrega: as imagens do e-mail mais o PDF do cabeçalho de
 * modelo de WhatsApp (a Meta baixa esse arquivo a cada envio). A listagem do
 * editor de e-mail segue filtrando só ALLOWED_UPLOAD_TYPES — PDF não aparece
 * como imagem para inserir no e-mail.
 */
export const SERVED_UPLOAD_TYPES: Record<string, string> = {
  ...ALLOWED_UPLOAD_TYPES,
  pdf: "application/pdf",
};

/**
 * Diretório onde as imagens ficam gravadas.
 * Em produção aponte UPLOADS_DIR para fora da pasta do projeto,
 * assim os deploys (rsync) nunca tocam nos arquivos enviados.
 */
export function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
}

/** Valida um nome de arquivo salvo (bloqueia path traversal e extensões estranhas). */
export function sanitizeUploadName(name: string): string | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes("..")) return null;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!SERVED_UPLOAD_TYPES[ext]) return null;
  return name;
}

/** Nome do arquivo a partir da URL pública (/uploads/nome), já validado. */
export function uploadNameFromUrl(url: string): string | null {
  const match = /^\/uploads\/([^/?#]+)$/.exec(url.trim());
  if (!match) return null;
  try {
    return sanitizeUploadName(decodeURIComponent(match[1]));
  } catch {
    return null; // sequência percent-encoded inválida
  }
}

/**
 * Lê um arquivo enviado a partir da URL pública. Usado para subir a amostra do
 * cabeçalho de mídia à Meta com os mesmos bytes que ela vai baixar no envio.
 */
export async function readUpload(url: string): Promise<{
  bytes: Uint8Array;
  mimeType: string;
  name: string;
}> {
  const name = uploadNameFromUrl(url);
  if (!name) {
    throw new Error(`Arquivo enviado inválido: ${url}`);
  }
  const ext = name.split(".").pop()!.toLowerCase();
  const bytes = await fs.readFile(path.join(getUploadsDir(), name));
  return { bytes, mimeType: SERVED_UPLOAD_TYPES[ext], name };
}

/** Gera um nome de arquivo seguro a partir do nome original. */
export function buildUploadName(originalName: string, ext: string): string {
  const base = originalName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  const cleanExt = ext === "jpeg" ? "jpg" : ext;
  return `${base || "imagem"}-${suffix}.${cleanExt}`;
}
