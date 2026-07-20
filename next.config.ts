import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mjml e pg dependem de módulos Node que não podem ser empacotados pelo bundler.
  serverExternalPackages: ["mjml", "pg"],
  // Fixa a raiz do projeto (há outros lockfiles acima na árvore de pastas).
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
