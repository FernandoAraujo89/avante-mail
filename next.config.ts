import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mjml e pg dependem de módulos Node que não podem ser empacotados pelo bundler.
  serverExternalPackages: ["mjml", "pg"],
  // Fixa a raiz do projeto (há outros lockfiles acima na árvore de pastas).
  turbopack: {
    root: path.join(__dirname),
  },
  experimental: {
    // Toda rota passa pelo middleware de sessão, e o Next corta em 10MB o
    // corpo que chega a uma rota com middleware — o resto some sem erro e o
    // formData() falha com "Failed to parse body as FormData". O maior upload
    // é o vídeo do cabeçalho de modelo de WhatsApp (16MB, teto da Meta); o
    // nginx do VPS acompanha com client_max_body_size 20m.
    middlewareClientMaxBodySize: "20mb",
  },
};

export default nextConfig;
