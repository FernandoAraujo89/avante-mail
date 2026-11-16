import { existsSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { SURVEY_OBJECTIVES } from "@/lib/db/schema";

import { VIDEO_POR_FASE, videoDaFase } from "./video";

describe("vídeo de boas-vindas", () => {
  it("só a Fase 1 tem vídeo; as outras ficam como antes", () => {
    expect(videoDaFase("dados_empresa")?.src).toMatch(/\.mp4$/);
    expect(videoDaFase("nps")).toBeNull();
    expect(videoDaFase("crescimento")).toBeNull();
  });

  it("os arquivos citados existem em public/", () => {
    for (const objetivo of SURVEY_OBJECTIVES) {
      const video = VIDEO_POR_FASE[objetivo];
      if (!video) continue;
      for (const url of [video.src, video.poster, video.legendas]) {
        expect(url.startsWith("/videos/"), url).toBe(true);
        expect(existsSync(path.join(process.cwd(), "public", url)), url).toBe(true);
      }
    }
  });
});
