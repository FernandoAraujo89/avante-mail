import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let cached: NodePgDatabase<typeof schema> | undefined;
let pool: Pool | undefined;

/**
 * Cria a conexão com o Postgres de forma lazy para que o build e as
 * páginas que não tocam o banco funcionem mesmo sem .env.local.
 *
 * Usa node-postgres (pool TCP) — o banco fica no próprio VPS (localhost),
 * então cada query é local, sem o overhead de HTTP por consulta do Neon.
 * SSL só é ligado quando a connection string exige (ex.: banco remoto).
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL não definida. Copie o .env.local.example para .env.local e preencha a connection string do Postgres."
      );
    }
    const needsSsl = /sslmode=require|neon\.tech/.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
    cached = drizzle(pool, { schema });
  }
  return cached;
}

export * from "./schema";
