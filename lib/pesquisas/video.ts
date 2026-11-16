import type { SurveyObjective } from "@/lib/db/schema";

// O vídeo de boas-vindas da página do parceiro, por fase do Mapeamento da
// Parceria. Os arquivos ficam em public/videos (com versão no nome: trocar o
// vídeo = arquivo novo, sem cache velho). Fase sem vídeo aqui = página como
// antes. O mesmo .mp4 (H.264 + AAC, abaixo de 16 MB) serve de cabeçalho do
// modelo de WhatsApp do convite.

export interface VideoDeBoasVindas {
  src: string;
  /** Quadro mostrado antes de tocar (e quando o aparelho não deixa tocar sozinho). */
  poster: string;
  /** Legenda em WebVTT: aparece enquanto o vídeo toca sem som. */
  legendas: string;
  /** Quem fala, para o texto abaixo do vídeo e o rótulo acessível. */
  autora: string;
  /** Duração em segundos (texto abaixo do vídeo). */
  duracao: number;
}

export const VIDEO_POR_FASE: Partial<Record<SurveyObjective, VideoDeBoasVindas>> = {
  // Mayra, da Expansão, explica o formulário da Fase 1 (empresa, clientes e
  // soluções que o parceiro vende). Gravado em 11/2026.
  dados_empresa: {
    src: "/videos/pesquisa-boas-vindas-v1.mp4",
    poster: "/videos/pesquisa-boas-vindas-v1.jpg",
    legendas: "/videos/pesquisa-boas-vindas-v1.vtt",
    autora: "Mayra, da Expansão",
    duracao: 31,
  },
};

export function videoDaFase(objetivo: SurveyObjective): VideoDeBoasVindas | null {
  return VIDEO_POR_FASE[objetivo] ?? null;
}
