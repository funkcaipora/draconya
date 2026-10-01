// #550 (M30-03, ADR 0040): a migração 0022 acrescenta `character.fight_mode` — a postura de luta
// do Canary — com `DEFAULT 'attack'` e um CHECK de vocabulário fechado. Este teste aplica as
// migrações 0000–0021 (o schema como era ANTES da 0022), insere personagens com dado de verdade,
// roda só a 0022 e confere o que a issue promete: NENHUMA linha existente é reescrita nem perde
// nada (ADR 0014), todas nascem na ofensiva — o `FIGHTMODE_ATTACK` de quem nunca escolheu —, e o
// banco recusa um modo que não é um dos três.
//
// Mora aqui pelo mesmo motivo de `stamina-cap-migration.postgres.test.ts`: teste de comportamento
// de uma migração de dado, não fixture de conteúdo.
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const migrationsDir = new URL('../../migrations/', import.meta.url);
const targetMigrationUrl = new URL('../../migrations/0022_550-fight-mode.sql', import.meta.url);

/** Tudo do personagem que a 0022 NÃO pode tocar, na ordem em que os testes o comparam. */
const UNTOUCHED_COLUMNS = `
  id, account_id, name, vocation, promoted, level, xp, gold, soul, blessings, fed_ms, stamina_ms,
  state, capacity, skills::text as skills
`;

describe.runIf(databaseUrl !== undefined)('migração 0022: a postura de luta (#550, ADR 0040)', () => {
  it('preserva todo personagem existente — nenhuma coluna muda — e todos nascem na ofensiva', async () => {
    const fixture = await schemaBeforeMigration0022(databaseUrl!);
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
      const modes = await fixture.sql`select id, fight_mode from character order by id`;
      expect(modes.map((row) => [row['id'], row['fight_mode']])).toEqual([
        ['c1', 'attack'], ['c2', 'attack'],
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('quem nasce depois da migração também entra na ofensiva, sem a coluna no INSERT', async () => {
    const fixture = await schemaBeforeMigration0022(databaseUrl!);
    try {
      await runSqlFile(fixture.sql, targetMigrationUrl);
      await fixture.sql`insert into character (id, account_id, name) values ('c3', 'a1', 'Hero c3')`;
      const rows = await fixture.sql`select fight_mode from character where id = 'c3'`;
      expect(rows).toMatchObject([{ fight_mode: 'attack' }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('o banco aceita os três modos do Canary e recusa qualquer outro valor', async () => {
    const fixture = await schemaBeforeMigration0022(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', {});
      await runSqlFile(fixture.sql, targetMigrationUrl);
      for (const mode of ['defense', 'balanced', 'attack']) {
        await fixture.sql`update character set fight_mode = ${mode} where id = 'c1'`;
        const rows = await fixture.sql`select fight_mode from character where id = 'c1'`;
        expect(rows).toMatchObject([{ fight_mode: mode }]);
      }
      // Vocabulário FECHADO do protocolo e do Canary: `aggressive` (o nome do Huntera), o número
      // do `FightMode_t` e o vazio são lixo — e a coluna não é nulável.
      for (const bad of ['aggressive', '2', '', 'ATTACK']) {
        await expect(fixture.sql`update character set fight_mode = ${bad} where id = 'c1'`)
          .rejects.toThrow(/character_fight_mode/);
      }
      await expect(fixture.sql`update character set fight_mode = null where id = 'c1'`)
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

async function schemaBeforeMigration0022(url: string) {
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
    // As migrações como elas eram ANTES da 0022 — em ordem, pelo nome do arquivo, como o
    // `drizzle-orm/postgres-js/migrator` aplica de verdade.
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql') && name < '0022_')
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
