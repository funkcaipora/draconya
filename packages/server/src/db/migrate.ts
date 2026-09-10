import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required to run migrations');

// Conexão única mantém a trava na mesma sessão PostgreSQL que executa as migrações.
// Dois deploys concorrentes não podem observar o mesmo journal antigo e repetir o DDL.
const client = postgres(url, { max: 1 });
try {
  await client`select pg_advisory_lock(731947120)`;
  try {
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
    });
  } finally {
    await client`select pg_advisory_unlock(731947120)`;
  }
} finally {
  await client.end({ timeout: 5 });
}
