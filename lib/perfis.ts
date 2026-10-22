// Perfis de acesso. Roda também no Edge (middleware): nada de banco aqui.
//
// "admin" vê o sistema inteiro — é o perfil de todo usuário que já existia.
// "sucesso_cliente" cuida só da base de parceiros: cadastra, importa, edita e
// remove contatos e organiza as listas (Diamante, Ouro, Avante Core…). Pode
// PEDIR campanha para as listas (Solicitações), mas quem cria e dispara é
// sempre o marketing. Não mexe em leads, automações nem configurações.
// "expansao" acompanha os parceiros de perto (docs/plano-expansao.md): mexe na
// mesma base de parceiros que o Sucesso do cliente, monta e acompanha as
// pesquisas com eles e, nas partes seguintes do plano, ganha a caixa de
// conversas da própria linha de WhatsApp. Também não dispara campanha.
//
// Dentro das telas, todo perfil que não é admin enxerga só parceiros
// (lib/escopo-parceiros.ts): nem os leads nem a lista de leads.

export const PERFIS = ["admin", "sucesso_cliente", "expansao"] as const;
export type Perfil = (typeof PERFIS)[number];

export const PERFIL_LABEL: Record<Perfil, string> = {
  admin: "Administrador",
  sucesso_cliente: "Sucesso do cliente",
  expansao: "Expansão",
};

export const PERFIL_DESCRICAO: Record<Perfil, string> = {
  admin: "Acesso a tudo.",
  sucesso_cliente:
    "Contatos e listas, e pede campanhas ao marketing — não dispara.",
  expansao:
    "Pesquisas com os parceiros, contatos e listas — não dispara campanha.",
};

export function ehPerfil(valor: unknown): valor is Perfil {
  return (
    typeof valor === "string" && (PERFIS as readonly string[]).includes(valor)
  );
}

/** Para onde o perfil vai ao entrar (e quando cai numa tela que não é dele). */
export function paginaInicial(perfil: Perfil): string {
  if (perfil === "sucesso_cliente") return "/lists";
  if (perfil === "expansao") return "/pesquisas";
  return "/dashboard";
}

// O que cada perfil restrito alcança. Telas e APIs andam juntas. Dentro
// delas, o que ele vê é só parceiro: lib/escopo-parceiros.ts tira os leads e
// a lista de leads.
type PerfilRestrito = Exclude<Perfil, "admin">;

const PREFIXOS_POR_PERFIL: Record<PerfilRestrito, readonly string[]> = {
  sucesso_cliente: [
    "/contacts",
    "/lists",
    "/solicitacoes",
    "/api/contacts",
    "/api/lists",
    "/api/solicitacoes",
    "/api/auth/",
  ],
  expansao: [
    "/pesquisas",
    "/contacts",
    "/lists",
    "/api/pesquisas",
    "/api/contacts",
    "/api/lists",
    "/api/auth/",
  ],
};

/** Prefixos que o perfil só LÊ (GET). */
const LEITURAS_POR_PERFIL: Record<PerfilRestrito, readonly string[]> = {
  // O painel das 3 frentes e a ficha de cada parceiro (decisão 4 do plano
  // da Expansão): quem atende o parceiro vê como ele respondeu, sem editar.
  sucesso_cliente: ["/pesquisas/parceiros", "/api/pesquisas/parceiros"],
  expansao: [],
};

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
  if (PREFIXOS_POR_PERFIL[perfil].some((p) => casa(pathname, p))) return true;
  return (
    method === "GET" && LEITURAS_POR_PERFIL[perfil].some((p) => casa(pathname, p))
  );
}
