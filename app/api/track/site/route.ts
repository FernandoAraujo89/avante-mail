import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { contactEvents, contacts, getDb, siteEventRules } from "@/lib/db";
import { clientIp, rateLimitAllow } from "@/lib/rate-limit";
import {
  marcarUltimaVisita,
  registrarRecusa,
  type MotivoDaRecusa,
} from "@/lib/track/recusas";
import {
  hostDoReferrer,
  MAX_EVENTOS_POR_LOTE,
  MAX_TITULO,
  normalizarPath,
  origemPermitida,
  sessaoSegura,
  slugEvento,
  TAMANHO_MAXIMO_BYTES,
  textoSeguro,
} from "@/lib/track/site";
import { precisaRenovar, signSiteToken, verifySiteToken } from "@/lib/track/token";

export const dynamic = "force-dynamic";

/**
 * Recebe os eventos do site (docs/plano-webhooks-leads.md, fase E).
 *
 * Esta é a rota mais exposta do sistema: pública, chamada pelo navegador de um
 * domínio que não controlamos, carregando um token que identifica uma PESSOA.
 * Três regras governam o arquivo inteiro:
 *
 * 1. O `contactId` vem SEMPRE do `sub` do token assinado. A rota nunca lê
 *    contato, e-mail nem qualquer identificador de pessoa do corpo — se lesse,
 *    qualquer um escreveria na ficha de qualquer um.
 *
 * 2. A resposta não é um oráculo. Token inválido, token expirado e contato
 *    suprimido respondem a MESMA coisa. Nada da base sai daqui: nem nome, nem
 *    e-mail, nem "este token é válido". Se um XSS no site colher tokens, o
 *    estrago fica em "eventos falsos", e não em de-anonimizar a base.
 *
 * 3. Nada toca o banco antes de origem, limite, tamanho e assinatura passarem.
 *    A verificação do token é HMAC puro, sem I/O: token ruim custa micro-
 *    segundos e morre aqui.
 */

/** Cabeçalhos de CORS para uma origem já validada contra a allowlist. */
function cabecalhosCors(origem: string): Record<string, string> {
  return {
    // A origem EXATA, nunca "*": com "*" qualquer site do mundo poderia
    // mandar eventos e ler a resposta.
    "Access-Control-Allow-Origin": origem,
    // Sem isto, um cache intermediário serviria a resposta de uma origem para
    // outra — e a allowlist deixaria de valer no caminho.
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    // NUNCA Allow-Credentials: o token vai no corpo, e mandar cookie para cá
    // exporia a sessão do sistema num fluxo iniciado por outro domínio.
  };
}

/**
 * Resposta padrão. `esquecer` manda o script apagar o token — usado para token
 * inválido E para contato suprimido, de propósito: uniformes, não dão pista.
 */
function resposta(
  origem: string | null,
  corpo?: { esquecer?: true; t?: string }
): NextResponse {
  const cabecalhos = origem ? cabecalhosCors(origem) : {};
  if (!corpo) {
    return new NextResponse(null, { status: 204, headers: cabecalhos });
  }
  return NextResponse.json(corpo, { status: 200, headers: cabecalhos });
}

async function recusar(
  origem: string | null,
  motivo: MotivoDaRecusa,
  detalhe?: string,
  esquecer = false
): Promise<NextResponse> {
  await registrarRecusa(motivo, detalhe);
  return resposta(origem, esquecer ? { esquecer: true } : undefined);
}

export async function OPTIONS(request: NextRequest) {
  const origem = origemPermitida(request.headers.get("origin"));
  return new NextResponse(null, {
    status: 204,
    headers: origem ? cabecalhosCors(origem) : {},
  });
}

interface EventoRecebido {
  tipo?: unknown;
  path?: unknown;
  titulo?: unknown;
  ref?: unknown;
  nome?: unknown;
}

export async function POST(request: NextRequest) {
  // ── 1. Origem ────────────────────────────────────────────────────────
  const cabecalhoOrigem = request.headers.get("origin");
  const origem = origemPermitida(cabecalhoOrigem);
  if (!origem) {
    // Sem cabeçalho de CORS na resposta: o navegador do chamador não lê nada.
    return recusar(
      null,
      cabecalhoOrigem ? "origem-nao-permitida" : "sem-origem",
      cabecalhoOrigem ?? undefined
    );
  }

  // ── 2. Limite por IP, antes de qualquer trabalho ─────────────────────
  const ip = clientIp(request);
  if (!(await rateLimitAllow(`track-site-ip:${ip}`, 120, 60, true))) {
    // O IP NÃO vai para o diário de recusas: ele é dado pessoal de visitante, e
    // o diário é lido na tela e vive 7 dias no Redis. Para o operador, "muitas
    // chamadas de um mesmo endereço" já diz o que precisa ser dito.
    return recusar(origem, "limite-por-ip");
  }

  // ── 3. Tamanho e formato ─────────────────────────────────────────────
  const cru = await request.text();
  if (Buffer.byteLength(cru, "utf8") > TAMANHO_MAXIMO_BYTES) {
    return recusar(origem, "corpo-grande", `${cru.length} bytes`);
  }

  let corpo: { t?: unknown; s?: unknown; e?: unknown };
  try {
    corpo = JSON.parse(cru || "{}");
  } catch {
    return recusar(origem, "corpo-invalido");
  }

  // ── 4. Token (HMAC puro, zero I/O) ───────────────────────────────────
  //
  // A resposta é ADIADA de propósito. Responder aqui faria a rota virar um
  // oráculo: duas sondas (uma com lote vazio, outra com evento) separariam
  // "assinatura inválida" de "contato suprimido", e a segunda é um dado do
  // titular. Todas as recusas que um token VÁLIDO consegue alcançar precisam
  // vir antes do primeiro `esquecer` — só então os dois casos ficam
  // indistinguíveis.
  const token = typeof corpo.t === "string" ? corpo.t : "";
  const dono = token ? await verifySiteToken(token) : null;

  // ── 5. Limite por TOKEN, válido ou não ───────────────────────────────
  // Pelo token, e não pelo contato: um token inválido não tem contato, e
  // limitar só os válidos deixaria o próprio limite denunciar quais são.
  const chaveDoToken = createHash("sha256")
    .update(token || "sem-token")
    .digest("base64url")
    .slice(0, 32);
  if (!(await rateLimitAllow(`track-site-token:${chaveDoToken}`, 60, 3600, true))) {
    return recusar(origem, "limite-por-contato");
  }

  const sessao = sessaoSegura(corpo.s);
  if (!sessao) return recusar(origem, "corpo-invalido", "sessão inválida");

  // Só objetos. Um `[null]` no lote derrubaria o handler com 500 no acesso a
  // `.path` — e o corpo vem do navegador, então "malformado" é o normal, não o
  // excepcional.
  const recebidos = Array.isArray(corpo.e)
    ? (corpo.e as unknown[])
        .filter(
          (item): item is EventoRecebido =>
            typeof item === "object" && item !== null
        )
        .slice(0, MAX_EVENTOS_POR_LOTE)
    : [];
  if (recebidos.length === 0) {
    return recusar(origem, "nada-aproveitavel", "lote vazio");
  }

  // Aqui, e só aqui, o primeiro `esquecer`: daqui para baixo todas as saídas
  // são idênticas para token inválido e para contato suprimido.
  if (!dono) {
    // Um token que não vale é lixo no armazenamento do visitante; some em vez
    // de virar tentativa eterna.
    return recusar(origem, "token-invalido", undefined, true);
  }

  const db = getDb();

  // ── 6. O contato ainda pode ser rastreado? ───────────────────────────
  const [contato] = await db
    .select({
      id: contacts.id,
      optOut: contacts.emailOptOutAt,
    })
    .from(contacts)
    .where(eq(contacts.id, dono.contactId));

  if (!contato) {
    return recusar(origem, "contato-inexistente", undefined, true);
  }
  // A revogação de verdade: quem pediu para sair para de ser rastreado na
  // hora, sem depender do token expirar. Por isso o prazo do token não é o
  // mecanismo de revogação — esta consulta é.
  if (contato.optOut) {
    return recusar(origem, "contato-suprimido", undefined, true);
  }

  // ── 7. Traduz caminho → evento nomeado (lista fechada, no servidor) ──
  const regras = await db
    .select({
      evento: siteEventRules.evento,
      matchType: siteEventRules.matchType,
      valor: siteEventRules.valor,
    })
    .from(siteEventRules)
    .where(eq(siteEventRules.active, true));

  /**
   * O prefixo casa por SEGMENTO, não por texto. `startsWith` puro faria
   * `/planos` casar com `/planos-encerrados` e `/planosaurus` — uma página que
   * não é de intenção nenhuma ganharia 10 pontos, e ninguém entenderia por quê
   * olhando a regra.
   */
  function casaPrefixo(path: string, prefixo: string): boolean {
    if (prefixo === "/") return true;
    if (path === prefixo) return true;
    return path.startsWith(prefixo + "/");
  }

  function eventoDoCaminho(path: string): string | null {
    // Exato primeiro: uma regra específica vence o prefixo que a contém.
    const exata = regras.find((r) => r.matchType === "exato" && r.valor === path);
    if (exata) return exata.evento;
    const prefixos = regras
      .filter((r) => r.matchType === "prefixo" && casaPrefixo(path, r.valor))
      // O prefixo mais longo vence: /planos/pro é mais específico que /planos.
      .sort((a, b) => b.valor.length - a.valor.length);
    return prefixos[0]?.evento ?? null;
  }

  const nomesValidos = new Set(regras.map((r) => r.evento));

  // ── 8. Monta as linhas ───────────────────────────────────────────────
  // `processedAt` já preenchido: nesta fase os eventos de site NÃO são gatilho
  // de automação (nenhum está em AUTOMATION_TRIGGER_TYPES), e o motor varre
  // `processed_at IS NULL` com teto de 100 por ciclo de 10s. Deixá-los pendentes
  // faria o rastreio do site competir com tag e clique pelo mesmo orçamento —
  // atrasando automação de verdade para marcar como lido um evento que nenhum
  // gatilho quer. Quando a §6.5 do plano for implementada, esta linha sai.
  const agora = new Date();
  const linhas: {
    contactId: string;
    type: "site_visited" | "site_event";
    payload: Record<string, unknown>;
    processedAt: Date;
  }[] = [];

  for (const bruto of recebidos) {
    const path = normalizarPath(bruto.path);
    if (!path) continue;

    const titulo = textoSeguro(bruto.titulo, MAX_TITULO);
    const refHost = hostDoReferrer(bruto.ref);

    if (bruto.tipo === "visita") {
      linhas.push({
        contactId: contato.id,
        type: "site_visited",
        processedAt: agora,
        // O índice de deduplicação casa por (contato, tipo, sessão): uma visita
        // por sessão, e não uma por página. Sem isso, quem abre 20 páginas
        // ganharia 20x os pontos e passaria na frente de quem pediu demo.
        payload: {
          sessao,
          path,
          ...(titulo ? { titulo } : {}),
          ...(refHost ? { refHost } : {}),
        },
      });

      // A PÁGINA visitada também vira ato nomeado quando o mapa diz que ela é
      // de intenção. É isto que faz "viu a página de preços" valer 10 pontos:
      // no plano essa é uma VISITA a /planos, não um clique em botão. Sem esta
      // parte, o mapa caminho → evento só serviria para cliques marcados, e a
      // regra mais óbvia do modelo nunca dispararia.
      const daPagina = eventoDoCaminho(path);
      if (daPagina) {
        linhas.push({
          contactId: contato.id,
          type: "site_event",
          processedAt: agora,
          payload: { sessao, evento: daPagina, path, ...(titulo ? { titulo } : {}) },
        });
      }
      continue;
    }

    // Evento nomeado: o nome vem do mapa do servidor ou de um `nome` explícito
    // — e o explícito é validado contra a MESMA lista fechada, porque o script
    // é código do cliente e um POST forjado manda o que quiser.
    const explicito = slugEvento(bruto.nome);
    const nome =
      explicito && nomesValidos.has(explicito)
        ? explicito
        : eventoDoCaminho(path);
    if (!nome) continue;

    linhas.push({
      contactId: contato.id,
      type: "site_event",
      processedAt: agora,
      payload: { sessao, evento: nome, path, ...(titulo ? { titulo } : {}) },
    });
  }

  if (linhas.length === 0) {
    return recusar(origem, "nada-aproveitavel", "nenhum evento válido no lote");
  }

  // Deduplica DENTRO do lote antes de inserir. O índice único do banco resolve
  // a repetição entre requisições; dentro de um mesmo INSERT o comportamento
  // depende do motor, e um lote com duas visitas da mesma sessão é o caso
  // comum (duas abas, retentativa somada à fila).
  const vistas = new Set<string>();
  const unicas = linhas.filter((l) => {
    const chave = `${l.type}|${l.payload.sessao}|${l.payload.evento ?? ""}`;
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });

  // ── 9. Grava ─────────────────────────────────────────────────────────
  // onConflictDoNothing casa com o índice parcial de deduplicação: repetição
  // da mesma sessão é ignorada pelo banco, não pela nossa memória — o que
  // sobrevive a duas abas e a duas instâncias do app.
  await db.insert(contactEvents).values(unicas).onConflictDoNothing();
  await marcarUltimaVisita();

  // ── 10. Renova o token quando estiver perto do fim ───────────────────
  if (precisaRenovar(dono.expiraEm)) {
    return resposta(origem, { t: await signSiteToken(contato.id) });
  }
  return resposta(origem);
}
