// #631 (M44-13, ADR 0059 d.3): a migração 0023 acrescenta `character.training` — o registro `jsonb`
// do banco de offline training e da skill do livro, no padrão de `charms` (ADR 0052 d.1). Este
// teste aplica as migrações 0000–0022 (o schema como era ANTES da 0023), insere personagens com
// dado de verdade, roda só a 0023 e confere o que a issue promete: coluna NULÁVEL sem default,
// NENHUMA linha existente reescrita (ADR 0014), e o registro guardado e lido de volta inteiro.
//
// Mora aqui pelo mesmo motivo de `fight-mode-migration.postgres.test.ts`: teste de comportamento de
// uma migração de dado, não fixture de conteúdo.
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const migrationsDir = new URL('../../migrations/', import.meta.url);
const targetMigrationUrl = new URL('../../migrations/0023_631-training.sql', import.meta.url);

/** Tudo do personagem que a 0023 NÃO pode tocar, na ordem em que os testes o comparam. */
const UNTOUCHED_COLUMNS = `
  id, account_id, name, vocation, promoted, level, xp, gold, soul, blessings, fed_ms, stamina_ms,
  fight_mode, state, capacity, skills::text as skills, charms::text as charms
`;

describe.runIf(databaseUrl !== undefined)('migração 0023: o registro do Treino (#631, ADR 0059)', () => {
  it('preserva todo personagem existente — nenhuma coluna muda — e todos nascem SEM registro', async () => {
    const fixture = await schemaBeforeMigration0023(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', { vocation: 'knight', level: 210, xp: 12_345_678 });
      await fixture.insertCharacter('c2', 'Rookie Two', {});
      const before = await fixture.sql.unsafe(`select ${UNTOUCHED_COLUMNS} from character order by id`);
      expect(before).toHaveLength(2);

      await runSqlFile(fixture.sql, targetMigrationUrl);

      const after = await fixture.sql.unsafe(`select ${UNTOUCHED_COLUMNS} from character order by id`);
      expect(after).toEqual(before);
      // `null` é quem nunca caçou nem treinou: banco zerado, nenhuma skill escolhida.
      const registers = await fixture.sql`select id, training from character order by id`;
      expect(registers.map((row) => [row['id'], row['training']])).toEqual([['c1', null], ['c2', null]]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('guarda o registro inteiro e o lê de volta, e aceita voltar a nulo', async () => {
    const fixture = await schemaBeforeMigration0023(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', {});
      await runSqlFile(fixture.sql, targetMigrationUrl);
      const register = { offlineBankMs: 3_600_000, offlineSkill: 'sword', version: 1 };
      await fixture.sql`update character set training = ${fixture.sql.json(register)} where id = 'c1'`;
      const rows = await fixture.sql`select training from character where id = 'c1'`;
      expect(rows).toMatchObject([{ training: register }]);
      await fixture.sql`update character set training = null where id = 'c1'`;
      expect(await fixture.sql`select training from character where id = 'c1'`).toMatchObject([{ training: null }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('quem nasce depois da migração também entra sem registro, sem a coluna no INSERT', async () => {
    const fixture = await schemaBeforeMigration0023(databaseUrl!);
    try {
      await runSqlFile(fixture.sql, targetMigrationUrl);
      await fixture.sql`insert into character (id, account_id, name) values ('c3', 'a1', 'Hero c3')`;
      expect(await fixture.sql`select training from character where id = 'c3'`).toMatchObject([{ training: null }]);
    } finally {
      await fixture.cleanup();
    }
  });
});

interface SeedOptions {
  readonly vocation?: string;
  readonly level?: number;
  readonly xp?: number;
}

async function schemaBeforeMigration0023(url: string) {
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
    // As migrações como elas eram ANTES da 0023 — em ordem, pelo nome do arquivo, como o
    // `drizzle-orm/postgres-js/migrator` aplica de verdade.
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql') && name < '0023_')
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
        insert into character (id, account_id, name, vocation, level, xp)
        values (${id}, 'a1', ${name}, ${options.vocation ?? null}, ${options.level ?? 1}, ${options.xp ?? 0})
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
