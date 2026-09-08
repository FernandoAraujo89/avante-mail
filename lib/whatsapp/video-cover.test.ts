import { execFile, execFileSync } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VIDEO_COVER_STILL_SECONDS, WHATSAPP_MEDIA_HEADERS } from "./types";
import {
  coverRenderArgs,
  parseProbe,
  probeVideo,
  renderVideoWithCover,
  targetVideoBitrate,
  type VideoInfo,
} from "./video-cover";

// O que estes testes protegem: a capa escolhida tem que ser o PRIMEIRO quadro
// do arquivo regravado (é dele que o WhatsApp tira a miniatura), o áudio não
// pode sair de sincronia, e o resultado tem que caber no teto da Meta.

const execFileAsync = promisify(execFile);

const INFO: VideoInfo = {
  width: 1920,
  height: 1080,
  frameRate: "24/1",
  duration: 94.5,
  hasAudio: true,
  videoBitrate: 1_204_424,
};

describe("parseProbe", () => {
  it("lê dimensões, duração, taxa de quadros, áudio e bitrate", () => {
    const info = parseProbe({
      streams: [
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          avg_frame_rate: "24/1",
          duration: "94.541667",
          bit_rate: "1204424",
        },
        { codec_type: "audio" },
      ],
      format: { duration: "94.6" },
    });
    expect(info).toEqual({
      width: 1920,
      height: 1080,
      frameRate: "24/1",
      duration: 94.541667,
      hasAudio: true,
      videoBitrate: 1_204_424,
    });
  });

  it("cai para 30/1 quando a taxa de quadros vem inválida (0/0)", () => {
    const info = parseProbe({
      streams: [
        { codec_type: "video", width: 640, height: 360, avg_frame_rate: "0/0" },
      ],
      format: { duration: "3" },
    });
    expect(info.frameRate).toBe("30/1");
    expect(info.hasAudio).toBe(false);
    expect(info.videoBitrate).toBeNull();
  });

  it("recusa arquivo sem vídeo", () => {
    expect(() => parseProbe({ streams: [{ codec_type: "audio" }] })).toThrow(
      /fluxo de vídeo/
    );
  });
});

describe("targetVideoBitrate", () => {
  it("mantém o bitrate do original quando ele cabe", () => {
    expect(targetVideoBitrate(INFO, 100 * 1024 * 1024)).toBe(INFO.videoBitrate);
  });

  it("reduz para o orçamento quando o original não caberia", () => {
    // 16MB para 95s: ~1,26 Mb/s de orçamento total, menos o áudio.
    const target = targetVideoBitrate(INFO, 16 * 1024 * 1024);
    expect(target).toBeLessThan(INFO.videoBitrate!);
    expect(target).toBeGreaterThan(1_000_000);
  });

  it("nunca desce do mínimo", () => {
    expect(targetVideoBitrate({ ...INFO, duration: 3600 }, 1024)).toBe(200_000);
  });
});

describe("coverRenderArgs", () => {
  it("atrasa o áudio pelo tamanho da capa e recodifica em H.264/AAC", () => {
    const args = coverRenderArgs({
      framePath: "/tmp/capa.png",
      sourcePath: "/tmp/in.mp4",
      outPath: "/tmp/out.mp4",
      info: INFO,
      videoBitrate: 1_000_000,
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=2:v=1:a=0[v]");
    expect(filter).toContain(
      `adelay=${VIDEO_COVER_STILL_SECONDS * 1000}:all=1[a]`
    );
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args[args.indexOf("-t") + 1]).toBe(String(VIDEO_COVER_STILL_SECONDS));
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });

  it("sem áudio no original, sai sem áudio (a Meta aceita)", () => {
    const args = coverRenderArgs({
      framePath: "/tmp/capa.png",
      sourcePath: "/tmp/in.mp4",
      outPath: "/tmp/out.mp4",
      info: { ...INFO, hasAudio: false },
      videoBitrate: 1_000_000,
    });
    expect(args).toContain("-an");
    expect(args[args.indexOf("-filter_complex") + 1]).not.toContain("adelay");
  });
});

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Cor média (RGB) do primeiro quadro de um vídeo. */
async function firstFrameColor(file: string): Promise<[number, number, number]> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }
  );
  const sums = [0, 0, 0];
  for (let i = 0; i < stdout.length; i++) sums[i % 3] += stdout[i];
  const pixels = stdout.length / 3;
  return [sums[0] / pixels, sums[1] / pixels, sums[2] / pixels];
}

describe.skipIf(!hasFfmpeg())("renderVideoWithCover (com ffmpeg)", () => {
  let dir: string;
  let source: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "wa-capa-test-"));
    source = path.join(dir, "in.mp4");
    // 2s: 1s vermelho, depois 1s azul, com um tom de áudio.
    await execFileAsync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=red:s=64x64:d=1:r=10",
      "-f", "lavfi", "-i", "color=blue:s=64x64:d=1:r=10",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      source,
    ]);
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("coloca o quadro escolhido no início e mantém a duração + capa", async () => {
    const out = path.join(dir, "out.mp4");
    const result = await renderVideoWithCover({
      sourcePath: source,
      at: 1.5,
      outPath: out,
      maxBytes: WHATSAPP_MEDIA_HEADERS.video.maxBytes,
    });

    expect(result.size).toBeGreaterThan(0);
    expect(result.coverAt).toBe(1.5);

    // Original começa vermelho; com a capa em 1,5s, começa azul.
    const [r0, , b0] = await firstFrameColor(source);
    expect(r0).toBeGreaterThan(150);
    expect(b0).toBeLessThan(100);
    const [r, , b] = await firstFrameColor(out);
    expect(b).toBeGreaterThan(150);
    expect(r).toBeLessThan(100);

    const info = await probeVideo(out);
    expect(info.hasAudio).toBe(true);
    expect(info.duration).toBeGreaterThanOrEqual(2 + VIDEO_COVER_STILL_SECONDS - 0.15);
    expect(info.duration).toBeLessThanOrEqual(2 + VIDEO_COVER_STILL_SECONDS + 0.15);
  }, 60_000);

  it("falha com clareza quando não cabe no limite", async () => {
    await expect(
      renderVideoWithCover({
        sourcePath: source,
        at: 0,
        outPath: path.join(dir, "small.mp4"),
        maxBytes: 100,
      })
    ).rejects.toThrow(/limite de tamanho/);
  }, 60_000);
});
