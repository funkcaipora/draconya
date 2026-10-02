// #836, OW-15 (ADR 0060 decisões 3.b, 6 e 10.f): a migração 0029 acrescenta o mundo e os vitais ao
// personagem — `world_id`, `world_x/y/z`, `town_id`, `health`, `mana` e `conditions`. Este teste
// aplica as migrações 0000–0028 (o schema como era ANTES da 0029), insere personagens que o Draconya
// de hoje conhece — todos em `state = 'city'`, o default —, roda só a 0029 e confere o que a issue
// promete: NENHUM dado é descartado nem reescrito (ADR 0014), as colunas `NOT NULL` nascem no default
// (`'main'`, `'thais'`) e as anuláveis nascem nulas — "cheio, sem condição, no templo" —, e o banco
// recusa as duas formas que o código garante (uma coordenada pela metade, vida ou mana negativa).
//
// Mora aqui pelo mesmo motivo de `durable-version-migration.postgres.test.ts`: teste de comportamento
// de uma migração de dado, não fixture de conteúdo.
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const migrationsDir = new URL('../../migrations/', import.meta.url);
const targetMigrationUrl = new URL('../../migrations/0029_836-world-vitals.sql', import.meta.url);

/** Tudo do personagem que a 0029 NÃO pode tocar, na ordem em que os testes o comparam. */
const UNTOUCHED_COLUMNS = `
  id, account_id, name, vocation, promoted, level, xp, gold, soul, blessings, fed_ms, stamina_ms,
  state, session_id, capacity, fight_mode, durable_version, skills::text as skills, charms::text as charms
`;

describe.runIf(databaseUrl !== undefined)('migração 0029: o mundo e os vitais do personagem (#836, ADR 0060)', () => {
  it('preserva todo personagem em `city` — nenhuma coluna muda, nenhum dado é descartado', async () => {
    const fixture = await schemaBeforeMigration0029(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', {
        vocation: 'knight', promoted: true, level: 210, xp: 12_345_678, gold: 900_000, blessings: 127,
      });
      await fixture.insertCharacter('c2', 'Rookie Two', {});
      await fixture.insertCharacter('c3', 'Hunting Three', { state: 'hunt', sessionId: 'sessao-antiga' });
      const before = await fixture.sql.unsafe(`select ${UNTOUCHED_COLUMNS} from character order by id`);
      expect(before).toHaveLength(3);
      // O ponto de partida do teste: o default de `state` é a cidade, e é nele que todos estão.
      expect(before.map((row) => row['state'])).toEqual(['city', 'city', 'hunt']);

      await runSqlFile(fixture.sql, targetMigrationUrl);

      const after = await fixture.sql.unsafe(`select ${UNTOUCHED_COLUMNS} from character order by id`);
      expect(after).toEqual(before);
      expect(await fixture.sql`select count(*)::int as total from character`).toMatchObject([{ total: 3 }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('quem já existia nasce no mundo `main`, na cidade `thais`, cheio e sem posição nem condição', async () => {
    const fixture = await schemaBeforeMigration0029(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', { vocation: 'knight', level: 40 });
      await fixture.insertCharacter('c2', 'Rookie Two', {});

      await runSqlFile(fixture.sql, targetMigrationUrl);

      const rows = await fixture.sql`
        select id, world_id, world_x, world_y, world_z, town_id, health, mana, conditions from character order by id
      `;
      expect(rows).toEqual([
        { id: 'c1', world_id: 'main', world_x: null, world_y: null, world_z: null, town_id: 'thais', health: null, mana: null, conditions: null },
        { id: 'c2', world_id: 'main', world_x: null, world_y: null, world_z: null, town_id: 'thais', health: null, mana: null, conditions: null },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('quem nasce depois da migração também entra nos defaults, sem as colunas no INSERT', async () => {
    const fixture = await schemaBeforeMigration0029(databaseUrl!);
    try {
      await runSqlFile(fixture.sql, targetMigrationUrl);
      await fixture.sql`insert into character (id, account_id, name) values ('c3', 'a1', 'Hero c3')`;
      const rows = await fixture.sql`
        select world_id, world_x, town_id, health, conditions from character where id = 'c3'
      `;
      expect(rows).toEqual([{ world_id: 'main', world_x: null, town_id: 'thais', health: null, conditions: null }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('guarda a coordenada absoluta do Tibia, a vida, a mana e as condições, e devolve o que guardou', async () => {
    const fixture = await schemaBeforeMigration0029(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', {});
      await runSqlFile(fixture.sql, targetMigrationUrl);
      const conditions = [{ key: 'poison', expiresAtMs: 4_000, tick: { amount: 3, intervalMs: 1_000, kind: 'damage' } }];
      await fixture.sql`
        update character
        set world_x = 32369, world_y = 32241, world_z = 7, health = 10, mana = 0,
            conditions = ${fixture.sql.json(conditions)}
        where id = 'c1'
      `;
      const rows = await fixture.sql`
        select world_x, world_y, world_z, health, mana, conditions from character where id = 'c1'
      `;
      expect(rows).toEqual([{ world_x: 32369, world_y: 32241, world_z: 7, health: 10, mana: 0, conditions }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('o banco recusa uma coordenada pela metade — os três juntos ou nenhum', async () => {
    const fixture = await schemaBeforeMigration0029(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', {});
      await runSqlFile(fixture.sql, targetMigrationUrl);
      await expect(fixture.sql`update character set world_x = 32369 where id = 'c1'`)
        .rejects.toThrow(/character_world_position_complete/);
      await expect(fixture.sql`update character set world_x = 1, world_y = 2 where id = 'c1'`)
        .rejects.toThrow(/character_world_position_complete/);
      // Os três nulos de novo (o templo) é uma linha válida, e a posição inteira também.
      await fixture.sql`update character set world_x = 32369, world_y = 32241, world_z = 7 where id = 'c1'`;
      await fixture.sql`update character set world_x = null, world_y = null, world_z = null where id = 'c1'`;
    } finally {
      await fixture.cleanup();
    }
  });

  it('o banco recusa vida ou mana negativa, e aceita zero e nulo', async () => {
    const fixture = await schemaBeforeMigration0029(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', {});
      await runSqlFile(fixture.sql, targetMigrationUrl);
      await expect(fixture.sql`update character set health = -1 where id = 'c1'`)
        .rejects.toThrow(/character_vitals_not_negative/);
      await expect(fixture.sql`update character set mana = -5 where id = 'c1'`)
        .rejects.toThrow(/character_vitals_not_negative/);
      await fixture.sql`update character set health = 0, mana = 0 where id = 'c1'`;
      await fixture.sql`update character set health = null, mana = null where id = 'c1'`;
    } finally {
      await fixture.cleanup();
    }
  });

  it('o mundo e a cidade recusam nulo — o default é o que existe, e nunca "sem mundo"', async () => {
    const fixture = await schemaBeforeMigration0029(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', {});
      await runSqlFile(fixture.sql, targetMigrationUrl);
      await expect(fixture.sql`update character set world_id = null where id = 'c1'`)
        .rejects.toThrow(/null value|not-null/i);
      await expect(fixture.sql`update character set town_id = null where id = 'c1'`)
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
  readonly state?: string;
  readonly sessionId?: string;
}

async function schemaBeforeMigration0029(url: string) {
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
    // As migrações como elas eram ANTES da 0029 — em ordem, pelo nome do arquivo, como o
    // `drizzle-orm/postgres-js/migrator` aplica de verdade.
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql') && name < '0029_')
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
      // `state` e `session_id` só entram quando o teste os pede: o default de `state` é `'city'`, que
      // é onde está todo personagem que a migração encontra.
      await sql`
        insert into character (id, account_id, name, vocation, promoted, level, xp, gold, blessings)
        values (
          ${id}, 'a1', ${name}, ${options.vocation ?? null}, ${options.promoted ?? false},
          ${options.level ?? 1}, ${options.xp ?? 0}, ${options.gold ?? 0}, ${options.blessings ?? 0}
        )
      `;
      if (options.state !== undefined) {
        await sql`update character set state = ${options.state}, session_id = ${options.sessionId ?? null} where id = ${id}`;
      }
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
