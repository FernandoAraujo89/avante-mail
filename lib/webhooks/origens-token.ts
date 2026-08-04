import { randomBytes } from "crypto";

import { hashToken } from "@/lib/webhooks/entrada";

/**
 * Geração de token — separada de `origens.ts` porque aquele arquivo é
 * importado pela TELA, e este puxa `crypto` e, por tabela, o driver do
 * Postgres. Misturar os dois quebra o build do navegador em `dns`.
 *
 * O token cru é devolvido UMA vez, para a tela mostrar; o banco recebe só o
 * hash — vazamento do banco não vira acesso ao endpoint.
 */
export function gerarToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}
