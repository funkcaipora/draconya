// #562 (M32-01, ADR 0043 emenda 2026-09-25): a migração 0011 troca o teto default de
// `stamina_ms` de 24 h (86.400.000 ms) para 12 h (43.200.000 ms) e CLAMPA quem já tinha mais
// persistido — nunca inventa stamina para quem tem menos. Este teste aplica as migrações
// 0000–0010 (o schema como era ANTES da 0011), insere personagens nos três casos (acima, igual
// e abaixo do novo teto), roda só a 0011, e confere o clamp — mais o novo default para quem
// nasce depois dela.
//
// Mora aqui, e não em `packages/server/migrations/`, pelo mesmo motivo do
// `xp-curve-migration.postgres.test.ts`: teste de comportamento de uma migração de dado, não
// fixture de conteúdo.
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const migrationsDir = new URL('../../migrations/', import.meta.url);
const targetMigrationUrl = new URL('../../migrations/0011_562-huntera-stamina-cap.sql', import.meta.url);

const OLD_CAP_MS = 86_400_000;
const NEW_CAP_MS = 43_200_000;

describe.runIf(databaseUrl !== undefined)('migração 0011: o teto de stamina do Huntera (#562, ADR 0043)', () => {
  it('personagem ACIMA do novo teto (cheio na régua antiga) é CLAMPADO para 12 h', async () => {
    const fixture = await schemaBeforeMigration0011(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'a1', OLD_CAP_MS);
      await runSqlFile(fixture.sql, targetMigrationUrl);
      const rows = await fixture.sql`select stamina_ms from character where id = 'c1'`;
      expect(rows).toMatchObject([{ stamina_ms: String(NEW_CAP_MS) }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('personagem ABAIXO do novo teto mantém o valor exato — nenhuma stamina é inventada nem cortada', async () => {
    const fixture = await schemaBeforeMigration0011(databaseUrl!);
    try {
      const belowNewCap = 20_000_000;
      await fixture.insertCharacter('c1', 'a1', belowNewCap);
      await runSqlFile(fixture.sql, targetMigrationUrl);
      const rows = await fixture.sql`select stamina_ms from character where id = 'c1'`;
      expect(rows).toMatchObject([{ stamina_ms: String(belowNewCap) }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('personagem EXATAMENTE no novo teto não muda — a borda não é clampada por engano', async () => {
    const fixture = await schemaBeforeMigration0011(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'a1', NEW_CAP_MS);
      await runSqlFile(fixture.sql, targetMigrationUrl);
      const rows = await fixture.sql`select stamina_ms from character where id = 'c1'`;
      expect(rows).toMatchObject([{ stamina_ms: String(NEW_CAP_MS) }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('o DEFAULT da coluna passa a ser 12 h — quem nasce depois da migração já entra no teto novo', async () => {
    const fixture = await schemaBeforeMigration0011(databaseUrl!);
    try {
      await runSqlFile(fixture.sql, targetMigrationUrl);
      await fixture.sql`
        insert into character (id, account_id, name)
        values ('c2', 'a1', 'Hero c2')
      `;
      const rows = await fixture.sql`select stamina_ms from character where id = 'c2'`;
      expect(rows).toMatchObject([{ stamina_ms: String(NEW_CAP_MS) }]);
    } finally {
      await fixture.cleanup();
    }
  });
});

async function schemaBeforeMigration0011(url: string) {
  const schemaName = `test_${randomUUID().replaceAll('-', '')}`;
  const administrator = postgres(url, { max: 1, onnotice: () => {} });
  await administrator.unsafe(`create schema "${schemaName}"`);
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set(
    'options',
    `-c search_path=${schemaName} -c client_min_messages=warning`,
  );
  const sql = postgres(scopedUrl.toString(), { max: 1 });

  try {
    // As migrações como elas eram ANTES da 0011 — em ordem, pelo nome do arquivo, como o
    // `drizzle-orm/postgres-js/migrator` aplica de verdade.
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql') && name < '0011_')
      .sort();
    for (const name of files) await runSqlFile(sql, new URL(name, migrationsDir));

    await sql`insert into account (id, email, external_auth_id) values ('a1', 'hero@example.com', 'user_1')`;
  } catch (error) {
    await sql.end({ timeout: 5 });
    await administrator.unsafe(`drop schema "${schemaName}" cascade`);
    await administrator.end({ timeout: 5 });
    throw error;
  }

  return {
    sql,
    async insertCharacter(id: string, accountId: string, staminaMs: number): Promise<void> {
      await sql`
        insert into character (id, account_id, name, stamina_ms)
        values (${id}, ${accountId}, ${`Hero ${id}`}, ${staminaMs})
      `;
    },
    async cleanup() {
      await sql.end({ timeout: 5 });
      await administrator.unsafe(`drop schema "${schemaName}" cascade`);
      await administrator.end({ timeout: 5 });
    },
  };
}

async function runSqlFile(sql: ReturnType<typeof postgres>, file: URL): Promise<void> {
  const contents = await readFile(file, 'utf8');
  await sql.unsafe(contents);
}
