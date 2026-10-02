// #823, OW-02 (ADR 0060 decisão 10e): a migração 0028 acrescenta `character.durable_version` — a
// versão do último extrato de estado absoluto que o ledger aplicou — com `DEFAULT 0`. Este teste
// aplica as migrações 0000–0027 (o schema como era ANTES da 0028), insere personagens com dado de
// verdade, roda só a 0028 e confere o que a issue promete: NENHUMA linha existente é reescrita nem
// perde nada (ADR 0014), todas nascem na versão 0 — "nenhum extrato versionado aplicado ainda", e
// o primeiro extrato versionado (>= 1) é sempre mais novo —, e a coluna não aceita nulo.
//
// Mora aqui pelo mesmo motivo de `fight-mode-migration.postgres.test.ts`: teste de comportamento
// de uma migração de dado, não fixture de conteúdo.
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const migrationsDir = new URL('../../migrations/', import.meta.url);
const targetMigrationUrl = new URL('../../migrations/0028_823-durable-version.sql', import.meta.url);

/** Tudo do personagem que a 0028 NÃO pode tocar, na ordem em que os testes o comparam. */
const UNTOUCHED_COLUMNS = `
  id, account_id, name, vocation, promoted, level, xp, gold, soul, blessings, fed_ms, stamina_ms,
  state, capacity, fight_mode, skills::text as skills
`;

describe.runIf(databaseUrl !== undefined)('migração 0028: a versão durável do personagem (#823, ADR 0060)', () => {
  it('preserva todo personagem existente — nenhuma coluna muda — e todos nascem na versão 0', async () => {
    const fixture = await schemaBeforeMigration0028(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', {
        vocation: 'knight', promoted: true, level: 210, xp: 12_345_678, gold: 900_000, blessings: 127,
      });
      await fixture.insertCharacter('c2', 'Rookie Two', {});
      const before = await fixture.sql.unsafe(`select ${UNTOUCHED_COLUMNS} from character order by id`);
      expect(before).toHaveLength(2);

      await runSqlFile(fixture.sql, targetMigrationUrl);

      const after = await fixture.sql.unsafe(`select ${UNTOUCHED_COLUMNS} from character order by id`);
      expect(after).toEqual(before);
      const versions = await fixture.sql`select id, durable_version from character order by id`;
      expect(versions.map((row) => [row['id'], Number(row['durable_version'])])).toEqual([
        ['c1', 0], ['c2', 0],
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('quem nasce depois da migração também entra na versão 0, sem a coluna no INSERT', async () => {
    const fixture = await schemaBeforeMigration0028(databaseUrl!);
    try {
      await runSqlFile(fixture.sql, targetMigrationUrl);
      await fixture.sql`insert into character (id, account_id, name) values ('c3', 'a1', 'Hero c3')`;
      const rows = await fixture.sql`select durable_version from character where id = 'c3'`;
      expect(rows.map((row) => Number(row['durable_version']))).toEqual([0]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('a coluna guarda versões altas e recusa nulo — o ledger sobe a versão, nunca a apaga', async () => {
    const fixture = await schemaBeforeMigration0028(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', {});
      await runSqlFile(fixture.sql, targetMigrationUrl);
      // `bigint`: um contador por extrato, com checkpoint de minuto em minuto, passa de 2^31.
      await fixture.sql`update character set durable_version = 4294967296 where id = 'c1'`;
      const rows = await fixture.sql`select durable_version from character where id = 'c1'`;
      expect(rows.map((row) => Number(row['durable_version']))).toEqual([4_294_967_296]);
      await expect(fixture.sql`update character set durable_version = null where id = 'c1'`)
        .rejects.toThrow(/null value|not-null/i);
    } finally {
      await fixture.cleanup();
    }
  });
});

interface SeedOptions {
  readonly vocation?: string;
  readonly promoted?: boolean;
  readonly level?: number;
  readonly xp?: number;
  readonly gold?: number;
  readonly blessings?: number;
}

async function schemaBeforeMigration0028(url: string) {
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
    // As migrações como elas eram ANTES da 0028 — em ordem, pelo nome do arquivo, como o
    // `drizzle-orm/postgres-js/migrator` aplica de verdade.
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql') && name < '0028_')
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
    async insertCharacter(id: string, name: string, options: SeedOptions): Promise<void> {
      await sql`
        insert into character (id, account_id, name, vocation, promoted, level, xp, gold, blessings)
        values (
          ${id}, 'a1', ${name}, ${options.vocation ?? null}, ${options.promoted ?? false},
          ${options.level ?? 1}, ${options.xp ?? 0}, ${options.gold ?? 0}, ${options.blessings ?? 0}
        )
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
