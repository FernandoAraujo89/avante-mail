// Perfis de acesso. Roda também no Edge (middleware): nada de banco aqui.
//
// "admin" vê o sistema inteiro — é o perfil de todo usuário que já existia.
// "sucesso_cliente" cuida só da base de parceiros: cadastra, importa, edita e
// remove contatos e organiza as listas (Diamante, Ouro, Avante Core…). Pode
// PEDIR campanha para as listas (Solicitações), mas quem cria e dispara é
// sempre o marketing. Não mexe em leads, automações nem configurações.

export const PERFIS = ["admin", "sucesso_cliente"] as const;
export type Perfil = (typeof PERFIS)[number];

export const PERFIL_LABEL: Record<Perfil, string> = {
  admin: "Administrador",
  sucesso_cliente: "Sucesso do cliente",
};

export const PERFIL_DESCRICAO: Record<Perfil, string> = {
  admin: "Acesso a tudo.",
  sucesso_cliente:
    "Contatos e listas, e pede campanhas ao marketing — não dispara.",
};

export function ehPerfil(valor: unknown): valor is Perfil {
  return (
    typeof valor === "string" && (PERFIS as readonly string[]).includes(valor)
  );
}

/** Para onde o perfil vai ao entrar (e quando cai numa tela que não é dele). */
export function paginaInicial(perfil: Perfil): string {
  return perfil === "sucesso_cliente" ? "/lists" : "/dashboard";
}

// O que o Sucesso do cliente alcança. Telas e APIs andam juntas. Dentro
// delas, o que ele vê é só parceiro: lib/escopo-parceiros.ts tira os leads e
// a lista de leads.
const PREFIXOS_SUCESSO_CLIENTE = [
  "/contacts",
  "/lists",
  "/solicitacoes",
  "/api/contacts",
  "/api/lists",
  "/api/solicitacoes",
  "/api/auth/",
];
const LEITURAS_SUCESSO_CLIENTE: string[] = [];

function casa(pathname: string, prefixo: string): boolean {
  return (
    pathname === prefixo ||
    pathname.startsWith(prefixo.endsWith("/") ? prefixo : `${prefixo}/`)
  );
}

/** A rota (já autenticada) está liberada para este perfil? */
export function rotaPermitida(
  perfil: Perfil,
  pathname: string,
  method: string
): boolean {
  if (perfil === "admin") return true;
  if (PREFIXOS_SUCESSO_CLIENTE.some((p) => casa(pathname, p))) return true;
  return (
    method === "GET" && LEITURAS_SUCESSO_CLIENTE.some((p) => casa(pathname, p))
  );
}
