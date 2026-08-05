import { hkdfSync, createHmac } from "crypto";
import { lookup } from "dns/promises";

/**
 * Webhook de SAÍDA (docs/plano-webhooks-leads.md, fase F): avisa o Make/CRM
 * quando algo acontece com um lead.
 *
 * A diferença entre este arquivo e o de entrada é a direção do perigo. Na
 * entrada, o risco é o que chega. Aqui o risco é o SERVIDOR fazer a requisição:
 * a URL é digitada numa tela, e um servidor que chama qualquer endereço que lhe
 * mandarem é um SSRF — a porta para ler o Postgres e o Redis pela rede interna
 * do Docker, ou o serviço de metadados da nuvem.
 *
 * Três camadas, e nenhuma delas sozinha basta:
 *
 * 1. ALLOWLIST DE HOST (`WEBHOOK_SAIDA_HOSTS`). Vazia = nenhum webhook sai.
 *    É o controle principal: uma lista curta de destinos conhecidos é muito
 *    mais fácil de conferir do que uma lista de tudo que é proibido.
 * 2. BLOQUEIO POR IP depois de resolver o DNS. Protege do host permitido que um
 *    dia passe a apontar para dentro — e de quem cadastre um domínio próprio
 *    apontando para 127.0.0.1.
 * 3. SEM REDIRECIONAMENTO. Seguir um 302 é o jeito clássico de furar as duas
 *    camadas acima: a primeira requisição vai para o destino permitido, e a
 *    segunda para onde o destino mandar.
 */

/** Só https: todo serviço de integração sério oferece, e é um buraco a menos. */
const PROTOCOLO = "https:";

/** Tempo máximo esperando o destino. O percurso da automação não pode travar. */
export const TIMEOUT_MS = 5000;

/** Tentativas antes de desistir — absorve oscilação de rede, não erro real. */
export const TENTATIVAS = 2;

/** Teto do que lemos da resposta. Não usamos o corpo; só não podemos engasgar. */
const MAX_RESPOSTA_BYTES = 2048;

const ROTULO_DERIVACAO = "avante-webhook-saida-v1";

export function hostsPermitidos(): string[] {
  return (process.env.WEBHOOK_SAIDA_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean);
}

/**
 * Faixas que NUNCA podem ser destino. `169.254.169.254` merece destaque: é o
 * serviço de metadados das nuvens, de onde se leem credenciais da máquina.
 */
function ipPrivado(ip: string, familia: number): boolean {
  if (familia === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    // fc00::/7 (único local), fe80::/10 (link-local)
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
    // IPv4 mapeado em IPv6 (::ffff:10.0.0.1) — desembrulha e reavalia.
    const mapeado = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeado) return ipPrivado(mapeado[1], 4);
    return false;
  }

  const partes = ip.split(".").map(Number);
  if (partes.length !== 4 || partes.some((n) => Number.isNaN(n))) return true;
  const [a, b] = partes;

  if (a === 0) return true; // "este host"
  if (a === 10) return true; // privada
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local E metadados da nuvem
  if (a === 172 && b >= 16 && b <= 31) return true; // privada
  if (a === 192 && b === 168) return true; // privada
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // reservada (inclui 192.0.0.0/24)
  if (a >= 224) return true; // multicast e reservada
  return false;
}

export interface DestinoRecusado {
  ok: false;
  motivo: string;
}
export interface DestinoAceito {
  ok: true;
  url: URL;
}

/** Valida o destino ANTES de qualquer requisição. */
export async function validarDestino(
  cru: string
): Promise<DestinoAceito | DestinoRecusado> {
  let url: URL;
  try {
    url = new URL(cru);
  } catch {
    return { ok: false, motivo: "URL inválida." };
  }

  if (url.protocol !== PROTOCOLO) {
    return { ok: false, motivo: "Só endereços https são aceitos." };
  }
  // Usuário e senha na URL confundem a leitura do host ("https://ok.com@mau.com")
  // e não têm uso legítimo aqui.
  if (url.username || url.password) {
    return { ok: false, motivo: "A URL não pode conter usuário ou senha." };
  }

  const permitidos = hostsPermitidos();
  if (permitidos.length === 0) {
    return {
      ok: false,
      motivo:
        "Nenhum destino autorizado no servidor (WEBHOOK_SAIDA_HOSTS) — o webhook de saída está desligado.",
    };
  }

  const host = url.hostname.toLowerCase();
  // Igualdade ou subdomínio de um host permitido. `endsWith` puro deixaria
  // "make.com.evil.com" passar por "make.com".
  const permitido = permitidos.some(
    (p) => host === p || host.endsWith(`.${p}`)
  );
  if (!permitido) {
    return {
      ok: false,
      motivo: `O destino "${host}" não está entre os autorizados no servidor.`,
    };
  }

  // Segunda camada: para onde esse nome aponta AGORA.
  let enderecos: { address: string; family: number }[];
  try {
    enderecos = await lookup(host, { all: true });
  } catch {
    return { ok: false, motivo: `Não foi possível resolver "${host}".` };
  }
  if (enderecos.length === 0) {
    return { ok: false, motivo: `"${host}" não resolveu para nenhum endereço.` };
  }
  // TODOS precisam ser públicos: basta um interno para o destino ser recusado.
  const interno = enderecos.find((e) => ipPrivado(e.address, e.family));
  if (interno) {
    return {
      ok: false,
      motivo: `"${host}" aponta para um endereço de rede interna (${interno.address}).`,
    };
  }

  return { ok: true, url };
}

let chaveEmCache: Buffer | undefined;

/**
 * Chave da assinatura. Derivada do `JWT_SECRET`, como o token de rastreio —
 * assim quem recebe consegue verificar que a chamada é nossa, sem precisarmos
 * guardar mais um segredo. `WEBHOOK_SAIDA_SECRET` tem precedência.
 */
function chaveDaAssinatura(): Buffer {
  if (chaveEmCache) return chaveEmCache;
  const proprio = process.env.WEBHOOK_SAIDA_SECRET;
  if (proprio && proprio.trim()) {
    chaveEmCache = Buffer.from(proprio.trim());
    return chaveEmCache;
  }
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error("Sem JWT_SECRET nem WEBHOOK_SAIDA_SECRET.");
  chaveEmCache = Buffer.from(hkdfSync("sha256", base, "", ROTULO_DERIVACAO, 32));
  return chaveEmCache;
}

export function assinar(corpo: string): string {
  return createHmac("sha256", chaveDaAssinatura()).update(corpo).digest("hex");
}

export interface ResultadoDoEnvio {
  ok: boolean;
  status?: number;
  tentativas: number;
  ms: number;
  erro?: string;
}

/**
 * Entrega o corpo ao destino já validado.
 *
 * Sem redirecionamento (`redirect: "manual"`): um 302 é o jeito clássico de
 * escapar da allowlist, porque a validação valeu para a primeira URL e não
 * para o destino do desvio.
 */
export async function entregar(
  url: URL,
  corpo: string
): Promise<ResultadoDoEnvio> {
  const inicio = Date.now();
  let ultimoErro = "";

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const resposta = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "AvanteMail/1.0 (+webhook)",
          // Quem recebe confere isto com o mesmo segredo e sabe que é nosso.
          "X-Avante-Assinatura": `sha256=${assinar(corpo)}`,
        },
        body: corpo,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // Lê e descarta com teto: não usamos a resposta, mas deixar o corpo
      // aberto segura a conexão.
      try {
        const leitor = resposta.body?.getReader();
        if (leitor) {
          let lidos = 0;
          for (;;) {
            const { done, value } = await leitor.read();
            if (done) break;
            lidos += value?.length ?? 0;
            if (lidos > MAX_RESPOSTA_BYTES) {
              await leitor.cancel();
              break;
            }
          }
        }
      } catch {
        // corpo ilegível não invalida a entrega
      }

      // 3xx com redirect manual chega aqui como status opaco ou 3xx: recusa.
      if (resposta.status >= 300 && resposta.status < 400) {
        return {
          ok: false,
          status: resposta.status,
          tentativas: tentativa,
          ms: Date.now() - inicio,
          erro: "O destino respondeu com redirecionamento, que não é seguido.",
        };
      }

      if (resposta.ok) {
        return {
          ok: true,
          status: resposta.status,
          tentativas: tentativa,
          ms: Date.now() - inicio,
        };
      }

      ultimoErro = `o destino respondeu ${resposta.status}`;
      // 4xx é erro de configuração: repetir não conserta.
      if (resposta.status >= 400 && resposta.status < 500) {
        return {
          ok: false,
          status: resposta.status,
          tentativas: tentativa,
          ms: Date.now() - inicio,
          erro: ultimoErro,
        };
      }
    } catch (erro) {
      ultimoErro =
        erro instanceof Error && erro.name === "TimeoutError"
          ? `o destino não respondeu em ${TIMEOUT_MS / 1000}s`
          : erro instanceof Error
            ? erro.message
            : String(erro);
    }

    if (tentativa < TENTATIVAS) {
      await new Promise((r) => setTimeout(r, 500 * tentativa));
    }
  }

  return {
    ok: false,
    tentativas: TENTATIVAS,
    ms: Date.now() - inicio,
    erro: ultimoErro || "falha ao entregar",
  };
}
