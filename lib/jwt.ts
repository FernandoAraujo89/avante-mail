import { jwtVerify, SignJWT } from "jose";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET não definido no .env.local.");
  }
  return new TextEncoder().encode(secret);
}

export interface UnsubscribePayload {
  contactId: string;
  // Envio que originou o clique — permite atribuir o descadastro à campanha.
  sendId?: string;
}

/**
 * Gera o token de descadastro de um contato (válido por 1 ano).
 * Opcionalmente carrega o sendId para atribuir o cancelamento à campanha.
 */
export async function signUnsubscribeToken(
  contactId: string,
  sendId?: string
): Promise<string> {
  const jwt = new SignJWT({ purpose: "unsubscribe", sid: sendId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(contactId)
    .setIssuedAt()
    .setExpirationTime("365d");
  return jwt.sign(getSecret());
}

/** Valida o token de descadastro e retorna contactId + sendId, ou null. */
export async function verifyUnsubscribeToken(
  token: string
): Promise<UnsubscribePayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== "unsubscribe" || !payload.sub) return null;
    return {
      contactId: payload.sub,
      sendId: typeof payload.sid === "string" ? payload.sid : undefined,
    };
  } catch {
    return null;
  }
}
