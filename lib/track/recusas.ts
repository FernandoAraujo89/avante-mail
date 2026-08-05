import IORedis from "ioredis";

/**
 * As últimas recusas do endpoint de rastreio, para a tela de diagnóstico.
 *
 * Existe por um motivo operacional, não técnico: o script roda no site de
 * outra equipe, e o modo de falha mais provável desta fase inteira não é um
 * bug — é o rastreio **não chegar** (a tag não foi colada, foi colada errada,
 * o banner de cookies nunca chama o consentimento, o domínio de homologação
 * não está na allowlist). Sem isto, "não aparece lead nenhum" é indistinguível
 * de "está tudo certo e ninguém visitou", e a fase morre parecendo defeito
 * nosso.
 *
 * Anel de 50 no Redis, com validade: é registro de depuração, não histórico.
 * Tabela no Postgres para isso seria peso morto — e o Redis já está de pé.
 */

const CHAVE = "track:recusas";
const LIMITE = 50;
const VALIDADE_SEGUNDOS = 7 * 24 * 60 * 60;

let cliente: IORedis | undefined;

function redis(): IORedis {
  if (!cliente) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL não definida.");
    cliente = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (tentativas) => (tentativas > 3 ? null : 200),
    });
    cliente.on("error", () => {});
  }
  return cliente;
}

export type MotivoDaRecusa =
  | "origem-nao-permitida"
  | "sem-origem"
  | "corpo-invalido"
  | "corpo-grande"
  | "token-invalido"
  | "contato-suprimido"
  | "contato-inexistente"
  | "limite-por-ip"
  | "limite-por-contato"
  | "nada-aproveitavel";

export interface Recusa {
  motivo: MotivoDaRecusa;
  detalhe?: string;
  quando: string;
}

/** Nunca lança: registrar recusa não pode virar a causa de outra recusa. */
export async function registrarRecusa(
  motivo: MotivoDaRecusa,
  detalhe?: string
): Promise<void> {
  try {
    const item: Recusa = {
      motivo,
      // Truncado: o detalhe é para humano ler, não para guardar payload.
      detalhe: detalhe ? detalhe.slice(0, 200) : undefined,
      quando: new Date().toISOString(),
    };
    const r = redis();
    await r.lpush(CHAVE, JSON.stringify(item));
    await r.ltrim(CHAVE, 0, LIMITE - 1);
    await r.expire(CHAVE, VALIDADE_SEGUNDOS);
  } catch {
    // Redis fora: o endpoint segue funcionando sem o diário de recusas.
  }
}

export async function lerRecusas(): Promise<Recusa[]> {
  try {
    const brutas = await redis().lrange(CHAVE, 0, LIMITE - 1);
    return brutas
      .map((linha) => {
        try {
          return JSON.parse(linha) as Recusa;
        } catch {
          return null;
        }
      })
      .filter((r): r is Recusa => r !== null);
  } catch {
    return [];
  }
}

/**
 * Quantas vezes o script foi BAIXADO pelo site, por dia.
 *
 * É o sinal que separa os dois "não chega nada" que, sem ele, são
 * indistinguíveis: a tag não foi colada, ou a tag está lá e o site nunca chama
 * o consentimento. O primeiro se resolve com o time do site; o segundo é
 * decisão de quem responde pelo jurídico. Confundir os dois custa semanas.
 *
 * Contador por dia, sem nada de pessoal: nem IP, nem identificador, nem
 * referência a visitante. É só "a tag carregou N vezes hoje".
 */
function chaveDoDia(data = new Date()): string {
  return `track:script:${data.toISOString().slice(0, 10)}`;
}

export async function marcarScriptServido(): Promise<void> {
  try {
    const r = redis();
    const chave = chaveDoDia();
    const total = await r.incr(chave);
    // Só na primeira do dia: evita reescrever a validade a cada carga.
    if (total === 1) await r.expire(chave, 30 * 24 * 60 * 60);
  } catch {
    // Redis fora: o script continua sendo servido. É diagnóstico, não função.
  }
}

export interface CargasDoScript {
  ultimos7dias: number;
  hoje: number;
}

export async function lerCargasDoScript(): Promise<CargasDoScript> {
  try {
    const dias: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      dias.push(chaveDoDia(d));
    }
    const valores = await redis().mget(...dias);
    const numeros = valores.map((v) => Number(v) || 0);
    return {
      hoje: numeros[0],
      ultimos7dias: numeros.reduce((a, b) => a + b, 0),
    };
  } catch {
    return { hoje: 0, ultimos7dias: 0 };
  }
}

/** Marca a última visita ACEITA — o "está chegando?" da tela. */
const CHAVE_ULTIMA = "track:ultima-visita";

export async function marcarUltimaVisita(): Promise<void> {
  try {
    await redis().set(CHAVE_ULTIMA, new Date().toISOString());
  } catch {
    // idem
  }
}

export async function lerUltimaVisita(): Promise<string | null> {
  try {
    return await redis().get(CHAVE_ULTIMA);
  } catch {
    return null;
  }
}
