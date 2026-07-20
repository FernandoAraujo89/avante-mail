// Cria (ou redefine a senha de) um usuário do sistema.
// Uso: npx tsx scripts/create-user.ts "Nome Completo" email@dominio.com senha
import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

import { getDb, users } from "../lib/db";
import { hashPassword } from "../lib/passwords";

async function main() {
  const [name, emailRaw, password] = process.argv.slice(2);
  if (!name || !emailRaw || !password) {
    console.error(
      'Uso: npx tsx scripts/create-user.ts "Nome" email@dominio.com senha'
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("A senha precisa ter pelo menos 8 caracteres.");
    process.exit(1);
  }

  const email = emailRaw.trim().toLowerCase();
  const db = getDb();

  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash: hashPassword(password) })
    .onConflictDoUpdate({
      target: users.email,
      set: { name, passwordHash: hashPassword(password) },
    })
    .returning({ id: users.id, email: users.email });

  console.log(`✓ Usuário pronto: ${user.email} (${user.id})`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("erro:", error);
    process.exit(1);
  });
