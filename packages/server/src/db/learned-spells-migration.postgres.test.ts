// #624 (M44-06, ADR 0058 d.4, ADR 0014): a migração 0024 acrescenta `character.learned_spells` e
// CONCEDE, a quem já existe, todas as magias da vocação com `minLevel` menor ou igual ao level.
// Este teste aplica as migrações 0000–0023 (o schema como era ANTES da 0024), insere personagens
// com dado de verdade, roda só a 0024 e confere o que a issue promete: quem já existia NÃO perde
// a capacidade de lançar o que lançava ontem, nenhuma outra coluna muda, e quem nasce depois
// começa sem magia nenhuma — como no Tibia.
//
// Mora aqui pelo mesmo motivo de `fight-mode-migration.postgres.test.ts`: teste de comportamento
// de uma migração de dado, não fixture de conteúdo — o retrato do catálogo mora no SQL, e o
// conteúdo pode mudar depois sem que este teste (que descreve o dia da migração) tenha de mudar.
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const migrationsDir = new URL('../../migrations/', import.meta.url);
const targetMigrationUrl = new URL('../../migrations/0024_624-learned-spells.sql', import.meta.url);

/** Tudo do personagem que a 0024 NÃO pode tocar, na ordem em que os testes o comparam. */
const UNTOUCHED_COLUMNS = `
  id, account_id, name, vocation, promoted, level, xp, gold, soul, blessings, fed_ms, stamina_ms,
  state, capacity, fight_mode, skills::text as skills, charms::text as charms
`;

interface LearnedSpellsRow {
  readonly spellIds: string[];
  readonly version: number;
}

describe.runIf(databaseUrl !== undefined)('migração 0024: as magias aprendidas (#624, ADR 0058 d.4)', () => {
  it('concede ao Knight level 35 o que a vocação dele já lançava — e nada acima do level nem de outra vocação', async () => {
    const fixture = await schemaBeforeMigration0024(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Knight One', { vocation: 'knight', level: 35 });
      await runSqlFile(fixture.sql, targetMigrationUrl);

      const learned = await fixture.learnedOf('c1');
      expect(learned.version).toBe(1);
      // Até o level 35: Berserk (35), Wound Cleansing (8), Bruise Bane (1), Whirlwind Throw (28)…
      expect(learned.spellIds).toEqual(expect.arrayContaining([
        'berserk', 'wound-cleansing', 'bruise-bane', 'whirlwind-throw', 'groundshaker', 'charge',
        // Sem vocação no catálogo (Cure Poison): vale para quem já tem o level (10).
        'cure-poison',
      ]));
      // Level acima do dele: Front Sweep (70), Annihilation (110), Blood Rage (60).
      expect(learned.spellIds).not.toContain('front-sweep');
      expect(learned.spellIds).not.toContain('annihilation');
      expect(learned.spellIds).not.toContain('blood-rage');
      // Outra vocação, mesmo num level que ele alcança: Haste do Druid (14) e Death Strike (16).
      expect(learned.spellIds).not.toContain('haste-druid');
      expect(learned.spellIds).not.toContain('death-strike');
      // Sem repetição e em ordem estável.
      expect(learned.spellIds).toEqual([...new Set(learned.spellIds)].sort());
    } finally {
      await fixture.cleanup();
    }
  });

  it('o level é o limite exato: no level do requisito entra, um abaixo não', async () => {
    const fixture = await schemaBeforeMigration0024(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Druid Eight', { vocation: 'druid', level: 8 });
      await fixture.insertCharacter('c2', 'Druid Fourteen', { vocation: 'druid', level: 14 });
      await fixture.insertCharacter('c3', 'Druid Thirteen', { vocation: 'druid', level: 13 });
      await runSqlFile(fixture.sql, targetMigrationUrl);

      // Level 8: só o que pede até 8 — Apprentice's Strike (8), Light Healing (8), Mud Attack (1).
      const eight = (await fixture.learnedOf('c1')).spellIds;
      expect(eight).toEqual(expect.arrayContaining(['apprentices-strike-druid', 'light-healing-druid', 'mud-attack']));
      expect(eight).not.toContain('haste-druid');
      // Haste do Druid pede 14: fora no 13, dentro no 14.
      expect((await fixture.learnedOf('c3')).spellIds).not.toContain('haste-druid');
      expect((await fixture.learnedOf('c2')).spellIds).toContain('haste-druid');
    } finally {
      await fixture.cleanup();
    }
  });

  it('promoção é estado, não outra vocação: o Elite Knight recebe o catálogo do Knight', async () => {
    const fixture = await schemaBeforeMigration0024(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Elite Knight', { vocation: 'knight', promoted: true, level: 150 });
      await runSqlFile(fixture.sql, targetMigrationUrl);
      const learned = (await fixture.learnedOf('c1')).spellIds;
      expect(learned).toEqual(expect.arrayContaining(['annihilation', 'fierce-berserk', 'chivalrous-challenge']));
    } finally {
      await fixture.cleanup();
    }
  });

  it('quem ainda não escolheu vocação recebe só o que não exige uma — ou nada, abaixo do level da magia', async () => {
    const fixture = await schemaBeforeMigration0024(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Rookie Five', { level: 5 });
      await fixture.insertCharacter('c2', 'Rookie Twelve', { level: 12 });
      await runSqlFile(fixture.sql, targetMigrationUrl);
      // A linha ganha o registro (vazio), e nunca `NULL`: quem existia foi CONSIDERADO pela migração.
      expect(await fixture.learnedOf('c1')).toEqual({ spellIds: [], version: 1 });
      expect((await fixture.learnedOf('c2')).spellIds).toEqual(['cure-poison']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('não muda NENHUMA outra coluna de quem já existe (ADR 0014)', async () => {
    const fixture = await schemaBeforeMigration0024(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'Paladin One', {
        vocation: 'paladin', promoted: true, level: 210, xp: 12_345_678, gold: 900_000, blessings: 127,
      });
      await fixture.insertCharacter('c2', 'Rookie Two', {});
      const before = await fixture.sql.unsafe(`select ${UNTOUCHED_COLUMNS} from character order by id`);
      expect(before).toHaveLength(2);

      await runSqlFile(fixture.sql, targetMigrationUrl);

      const after = await fixture.sql.unsafe(`select ${UNTOUCHED_COLUMNS} from character order by id`);
      expect(after).toEqual(before);
    } finally {
      await fixture.cleanup();
    }
  });

  it('quem nasce DEPOIS da migração começa sem magia nenhuma: a coluna é `NULL`, como no Tibia', async () => {
    const fixture = await schemaBeforeMigration0024(databaseUrl!);
    try {
      await runSqlFile(fixture.sql, targetMigrationUrl);
      await fixture.sql`insert into character (id, account_id, name) values ('c9', 'a1', 'Hero c9')`;
      const rows = await fixture.sql`select learned_spells from character where id = 'c9'`;
      expect(rows).toMatchObject([{ learned_spells: null }]);
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

async function schemaBeforeMigration0024(url: string) {
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
    // As migrações como elas eram ANTES da 0024 — em ordem, pelo nome do arquivo, como o
    // `drizzle-orm/postgres-js/migrator` aplica de verdade.
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql') && name < '0024_')
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
    async learnedOf(id: string): Promise<LearnedSpellsRow> {
      const rows = await sql`select learned_spells from character where id = ${id}`;
      return rows[0]?.['learned_spells'] as LearnedSpellsRow;
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
