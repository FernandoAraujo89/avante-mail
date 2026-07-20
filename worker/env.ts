// Carrega o .env.local antes de qualquer outro módulo do worker.
// (o Next.js faz isso sozinho; fora dele, precisamos do dotenv)
import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });
