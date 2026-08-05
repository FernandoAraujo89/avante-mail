import { hkdfSync } from "crypto";
import { jwtVerify, SignJWT } from "jose";

/**
 * Token de rastreio do site (docs/plano-webhooks-leads.md, fase E).
 *
 * Este token vive no armazenamento local de um domínio que NÃO controlamos
 * (avantejuntos.com.br) e viaja na barra de endereço do visitante. Ou seja: é
 * a credencial mais exposta do sistema. Três defesas, em camadas:
 *
 * 1. CHAVE PRÓPRIA, não o `JWT_SECRET`. Hoje sessão (`lib/session.ts:15`) e
 *    descadastro (`lib/jwt.ts:4`) compartilham o mesmo segredo e só a claim
 *    `purpose` os separa — um token de rastreio assinado com aquela chave
 *    estaria a um descuido de virar token de sessão. Aqui a chave é OUTRA, então
 *    a confusão deixa de ser possível por construção, e não por conferência.
 *
 *    Sem `TRACK_SECRET`, a chave é DERIVADA do `JWT_SECRET` por HKDF com rótulo
 *    fixo. Derivar em vez de reusar dá a separação criptográfica de graça, sem
 *    exigir que uma variável nova exista no servidor antes do deploy — que seria
 *    o jeito mais fácil de derrubar a rota em produção. Definir `TRACK_SECRET`
 *    depois passa a valer e desacopla a rotação: girar só o rastreio devolve os
 *    visitantes ao anonimato até o próximo clique, enquanto girar o `JWT_SECRET`
 *    deslogaria todo mundo e invalidaria um ano de links de descadastro.
 *
 * 2. ESCOPO DE ESCRITA. O token só serve para gravar eventos do próprio
 *    contato. O endpoint nunca devolve dado nenhum — nem nome, nem e-mail, nem
 *    "este token é válido". Um token vazado é a capacidade de escrever evento
 *    falso, nunca de ler a base.
 *
 * 3. PRAZO CURTO E REVOGAÇÃO REAL. 30 dias, renovado a cada lote aceito. O
 *    prazo NÃO é o mecanismo de revogação — quem revoga é a consulta de
 *    supressão no endpoint, que é imediata. O prazo existe para o token
 *    esquecido num histórico de navegador não valer para sempre.
 */

/** Rótulo do HKDF. Mudar isto invalida todos os tokens de rastreio em campo. */
const ROTULO_DERIVACAO = "avante-rastreio-site-v1";

/** Prazo do token. Curto porque ele mora em armazenamento de terceiro. */
export const VALIDADE_TOKEN = "30d";

/** Renova quando falta menos que isto — mantém o visitante ativo identificado. */
export const RENOVAR_QUANDO_FALTAR_MS = 15 * 24 * 60 * 60 * 1000;

let chaveEmCache: Uint8Array | undefined;

function chave(): Uint8Array {
  if (chaveEmCache) return chaveEmCache;

  const proprio = process.env.TRACK_SECRET;
  if (proprio && proprio.trim()) {
    chaveEmCache = new TextEncoder().encode(proprio.trim());
    return chaveEmCache;
  }

  const base = process.env.JWT_SECRET;
  if (!base) {
    throw new Error(
      "Nem TRACK_SECRET nem JWT_SECRET definidos — o rastreio de site não pode assinar token."
    );
  }
  // HKDF-SHA256 com sal vazio e o rótulo como `info`: chave distinta e estável,
  // sem precisar guardar mais um segredo.
  const derivada = hkdfSync("sha256", base, "", ROTULO_DERIVACAO, 32);
  chaveEmCache = new Uint8Array(derivada);
  return chaveEmCache;
}

/** Só para teste: esquece a chave em cache depois de trocar a env. */
export function limparChaveEmCache(): void {
  chaveEmCache = undefined;
}

export async function signSiteToken(contactId: string): Promise<string> {
  return new SignJWT({ purpose: "site" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(contactId)
    .setIssuedAt()
    .setExpirationTime(VALIDADE_TOKEN)
    .sign(chave());
}

export interface TokenDeRastreio {
  contactId: string;
  /** Quando expira, em ms — usado para decidir a renovação. */
  expiraEm: number;
}

/**
 * Valida e devolve o contato. `algorithms` fixo em HS256 de propósito: sem
 * isso, `jwtVerify` aceitaria o algoritmo declarado no cabeçalho do token, que
 * é escolha de quem o enviou.
 */
export async function verifySiteToken(
  token: string
): Promise<TokenDeRastreio | null> {
  try {
    const { payload } = await jwtVerify(token, chave(), {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== "site" || !payload.sub) return null;
    return {
      contactId: payload.sub,
      expiraEm: (payload.exp ?? 0) * 1000,
    };
  } catch {
    // Assinatura errada, expirado, formato inválido — tudo vira o mesmo "não".
    return null;
  }
}

/** True quando vale a pena devolver um token novo ao script. */
export function precisaRenovar(expiraEm: number, agora = Date.now()): boolean {
  return expiraEm - agora < RENOVAR_QUANDO_FALTAR_MS;
}
