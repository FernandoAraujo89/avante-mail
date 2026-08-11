import path from "path";
import { defineConfig } from "vitest/config";

// Testes de unidade das funções puras (normalizador de telefone, sanitizador
// GSM-7 e, nas próximas fases, o client da Twilio mockado). Ambiente node: não
// há DOM envolvido, e o que depende de banco/rede fica de fora por princípio.
//
// Extensão .mts de propósito: o package.json não é "type": "module", e um
// vitest.config.ts com sintaxe ESM cai no carregador CommonJS do Vite.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
});
