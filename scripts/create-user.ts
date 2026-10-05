// Cria (ou redefine a senha de) um usuário do sistema.
// Uso: npx tsx scripts/create-user.ts "Nome Completo" email@dominio.com senha [perfil]
// perfil: admin (padrão) ou sucesso_cliente — ver lib/perfis.ts.
import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

import { getDb, users } from "../lib/db";
import { hashPassword } from "../lib/passwords";
import { ehPerfil, PERFIS } from "../lib/perfis";

async function main() {
  const [name, emailRaw, password, roleRaw = "admin"] = process.argv.slice(2);
  if (!name || !emailRaw || !password) {
    console.error(
      'Uso: npx tsx scripts/create-user.ts "Nome" email@dominio.com senha [perfil]'
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("A senha precisa ter pelo menos 8 caracteres.");
    process.exit(1);
  }

  if (!ehPerfil(roleRaw)) {
    console.error(`Perfil inválido. Use um de: ${PERFIS.join(", ")}.`);
    process.exit(1);
  }
  const role = roleRaw;

  const email = emailRaw.trim().toLowerCase();
  const db = getDb();

  const [user] = await db
    .insert(users)
    .values({ name, email, role, passwordHash: hashPassword(password) })
    .onConflictDoUpdate({
      target: users.email,
      set: { name, role, passwordHash: hashPassword(password) },
    })
    .returning({ id: users.id, email: users.email, role: users.role });

  console.log(`✓ Usuário pronto: ${user.email} (${user.role}, ${user.id})`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("erro:", error);
    process.exit(1);
  });
