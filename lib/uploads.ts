import path from "path";

/** Limite de tamanho por imagem: 5MB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Extensões aceitas e seus content-types. */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  png: "image/png",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
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
  if (!ALLOWED_UPLOAD_TYPES[ext]) return null;
  return name;
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
