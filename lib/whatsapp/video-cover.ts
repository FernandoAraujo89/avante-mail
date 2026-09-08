import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

import { VIDEO_COVER_STILL_SECONDS } from "./types";

// Regravação do vídeo do cabeçalho com a capa escolhida: o quadro do instante
// pedido entra parado no início do arquivo (o porquê está em
// VIDEO_COVER_STILL_SECONDS, em types.ts). Roda ffmpeg/ffprobe como processo,
// então é só servidor — a tela usa o resultado por /uploads.

const execFileAsync = promisify(execFile);

/** ffmpeg/ffprobe ausentes no servidor (a imagem Docker os instala). */
export class VideoToolMissingError extends Error {}

export interface VideoInfo {
  width: number;
  height: number;
  /** Taxa de quadros como fração do ffprobe ("24/1", "30000/1001"). */
  frameRate: string;
  /** Segundos. */
  duration: number;
  hasAudio: boolean;
  /** Bitrate do fluxo de vídeo em bits/s (null quando o contêiner não diz). */
  videoBitrate: number | null;
}

const AUDIO_BITRATE = 128_000;
// Abaixo disso 1080p vira mosaico; se nem assim couber, o vídeo é longo demais
// para o teto da Meta e o erro é o caminho honesto.
const MIN_VIDEO_BITRATE = 200_000;

function tool(name: "ffmpeg" | "ffprobe"): string {
  const configured =
    name === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  return configured?.trim() || name;
}

async function run(name: "ffmpeg" | "ffprobe", args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(tool(name), args, {
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      throw new VideoToolMissingError(
        `${name} não está instalado no servidor — a capa do vídeo depende dele.`
      );
    }
    const tail = (err.stderr ?? "").trim().split("\n").slice(-3).join(" ");
    throw new Error(`${name} falhou: ${tail || err.message}`);
  }
}

/** Lê o JSON do ffprobe (-show_streams -show_format). */
export function parseProbe(raw: unknown): VideoInfo {
  const data = (raw ?? {}) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("O arquivo não tem fluxo de vídeo.");

  const width = Number(video.width);
  const height = Number(video.height);
  const duration = Number(video.duration ?? data.format?.duration);
  if (!(width > 0 && height > 0) || !(duration > 0)) {
    throw new Error("Não foi possível ler as dimensões ou a duração do vídeo.");
  }
  const rate = video.avg_frame_rate;
  const frameRate =
    typeof rate === "string" && /^\d+\/[1-9]\d*$/.test(rate) ? rate : "30/1";
  const bitrate = Number(video.bit_rate);

  return {
    width,
    height,
    frameRate,
    duration,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    videoBitrate: bitrate > 0 ? bitrate : null,
  };
}

export async function probeVideo(file: string): Promise<VideoInfo> {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    file,
  ]);
  return parseProbe(JSON.parse(out));
}

/**
 * Bitrate de vídeo (bits/s) para o resultado caber em maxBytes: o do original
 * quando cabe, senão o orçamento — com 8% de folga para o contêiner e a
 * variação do controle de taxa.
 */
export function targetVideoBitrate(info: VideoInfo, maxBytes: number): number {
  const seconds = info.duration + VIDEO_COVER_STILL_SECONDS;
  const budget =
    Math.floor((maxBytes * 8 * 0.92) / seconds) -
    (info.hasAudio ? AUDIO_BITRATE : 0);
  const target = info.videoBitrate ? Math.min(info.videoBitrate, budget) : budget;
  return Math.max(target, MIN_VIDEO_BITRATE);
}

/**
 * Argumentos do ffmpeg que monta capa + vídeo. Sem `scale`: o quadro foi
 * extraído pelo mesmo decodificador do fluxo principal, então já tem o
 * tamanho e a rotação certos (vídeo de celular gravado "em pé" incluso).
 * H.264 + AAC, os únicos codecs que a Meta aceita no cabeçalho.
 */
export function coverRenderArgs(opts: {
  framePath: string;
  sourcePath: string;
  outPath: string;
  info: VideoInfo;
  videoBitrate: number;
}): string[] {
  const { framePath, sourcePath, outPath, info, videoBitrate } = opts;
  const stillMs = Math.round(VIDEO_COVER_STILL_SECONDS * 1000);
  const filters = [
    "[0:v]setsar=1,format=yuv420p[c]",
    "[1:v]setpts=PTS-STARTPTS,setsar=1,format=yuv420p[m]",
    "[c][m]concat=n=2:v=1:a=0[v]",
  ];
  // O áudio ganha silêncio do tamanho da capa, para continuar em sincronia.
  if (info.hasAudio) filters.push(`[1:a]adelay=${stillMs}:all=1[a]`);

  return [
    "-v", "error", "-y",
    "-loop", "1", "-framerate", info.frameRate,
    "-t", String(VIDEO_COVER_STILL_SECONDS), "-i", framePath,
    "-i", sourcePath,
    "-filter_complex", filters.join(";"),
    "-map", "[v]",
    ...(info.hasAudio
      ? ["-map", "[a]", "-c:a", "aac", "-b:a", String(AUDIO_BITRATE)]
      : ["-an"]),
    "-c:v", "libx264", "-preset", "veryfast",
    "-b:v", String(videoBitrate),
    "-maxrate", String(videoBitrate),
    "-bufsize", String(videoBitrate * 2),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outPath,
  ];
}

/**
 * Regrava `sourcePath` em `outPath` com o quadro do instante `at` (segundos)
 * parado no início. Se o resultado passar de maxBytes, tenta de novo com
 * menos bitrate (até duas vezes) antes de desistir.
 */
export async function renderVideoWithCover(opts: {
  sourcePath: string;
  at: number;
  outPath: string;
  maxBytes: number;
}): Promise<{ size: number; duration: number; coverAt: number }> {
  const info = await probeVideo(opts.sourcePath);
  // Dentro do vídeo, com folga do fim para o último quadro sempre existir.
  const at = Math.min(Math.max(opts.at, 0), Math.max(info.duration - 0.05, 0));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wa-capa-"));
  try {
    const framePath = path.join(tmp, "capa.png");
    // -ss antes de -i: pula rápido até o keyframe e decodifica até o instante
    // exato — o PNG sai com a rotação já aplicada, como o fluxo principal.
    await run("ffmpeg", [
      "-v", "error", "-y",
      "-ss", at.toFixed(3), "-i", opts.sourcePath,
      "-frames:v", "1", "-update", "1", framePath,
    ]);

    let videoBitrate = targetVideoBitrate(info, opts.maxBytes);
    for (let attempt = 0; attempt < 3; attempt++) {
      await run(
        "ffmpeg",
        coverRenderArgs({
          framePath,
          sourcePath: opts.sourcePath,
          outPath: opts.outPath,
          info,
          videoBitrate,
        })
      );
      const { size } = await fs.stat(opts.outPath);
      if (size <= opts.maxBytes) {
        return {
          size,
          duration: info.duration + VIDEO_COVER_STILL_SECONDS,
          coverAt: at,
        };
      }
      videoBitrate = Math.floor(videoBitrate * 0.8);
    }
    await fs.rm(opts.outPath, { force: true });
    throw new Error(
      "Não foi possível regravar o vídeo dentro do limite de tamanho da Meta — encurte o vídeo ou reduza a resolução."
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
