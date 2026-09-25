// #521 (ADR 0037): a migração 0009 troca a curva de XP antiga (`round(20 × level²)`) pela
// cúbica do Tibia, e precisa PRESERVAR quem já existe — mesmo level, mesma fração de progresso
// dentro dele, só recalculada na curva nova. Este teste aplica as migrações 0000–0008 (o schema
// como ele era ANTES da 0009), insere personagens com XP da curva ANTIGA, roda só a 0009, e
// confere que o level e a fração sobrevivem — não o valor absoluto de `xp`, que muda de
// significado com a curva.
//
// Mora aqui, e não em `packages/server/migrations/`, pelo mesmo motivo do
// `upgrade-existing-schema.test.ts`: é teste de comportamento de uma migração de dado, não
// fixture de conteúdo — `packages/sim` não faz I/O e não pode afirmar nada sobre uma linha do
// Postgres.
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const migrationsDir = new URL('../../migrations/', import.meta.url);
const targetMigrationUrl = new URL('../../migrations/0009_521-tibia-xp-curve.sql', import.meta.url);

/** Soma de quadrados fechada: a curva ANTIGA (`round(20 × level²)`, sem arredondar — o termo já
 * é inteiro para qualquer level inteiro), acumulada de 1 a `level - 1`. */
function oldTotalXpForLevel(level: number): number {
  return 20 * (level - 1) * level * (2 * level - 1) / 6;
}

/** A cúbica do Tibia (`Player::getExpForLevel`, Canary/TFS — `packages/sim/src/progression.ts`). */
function newTotalXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return ((level ** 3 - 6 * level ** 2 + 17 * level - 12) / 6) * 100;
}

describe.runIf(databaseUrl !== undefined)('migração 0009: a curva de XP do Tibia (#521, ADR 0037)', () => {
  it('personagem level 9 na METADE do level continua level 9 na METADE, na curva nova', async () => {
    const fixture = await schemaBeforeMigration0009(databaseUrl!);
    try {
      const level = 9;
      // Metade exata do progresso do level 9 na curva ANTIGA: total(9) + 50% de completar(9).
      const oldTotal = oldTotalXpForLevel(level);
      const oldToComplete = 20 * level * level;
      const oldXp = oldTotal + Math.round(0.5 * oldToComplete);
      await fixture.insertCharacter('c1', 'a1', level, oldXp);

      await runSqlFile(fixture.sql, targetMigrationUrl);

      const rows = await fixture.sql`select level, xp from character where id = 'c1'`;
      const newTotal = newTotalXpForLevel(level);
      const newToComplete = newTotalXpForLevel(level + 1) - newTotal;
      const expectedXp = Math.round(newTotal + 0.5 * newToComplete);

      expect(rows).toMatchObject([{ level, xp: String(expectedXp) }]);
      // A fração dentro do level bate meio a meio na curva NOVA — é a propriedade que a
      // migração existe para preservar, não o valor absoluto de `xp`.
      const fractionAfter = (Number(rows[0]?.xp) - newTotal) / newToComplete;
      expect(fractionAfter).toBeCloseTo(0.5, 9);
    } finally {
      await fixture.cleanup();
    }
  });

  it('level 1 com XP zero continua zero — onde todo mundo nasce, nas duas curvas', async () => {
    const fixture = await schemaBeforeMigration0009(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'a1', 1, 0);
      await runSqlFile(fixture.sql, targetMigrationUrl);
      const rows = await fixture.sql`select level, xp from character where id = 'c1'`;
      expect(rows).toMatchObject([{ level: 1, xp: '0' }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('personagem exatamente no início de um level (sem fração) fica exatamente no início do mesmo level', async () => {
    const fixture = await schemaBeforeMigration0009(databaseUrl!);
    try {
      const level = 20;
      await fixture.insertCharacter('c1', 'a1', level, oldTotalXpForLevel(level));
      await runSqlFile(fixture.sql, targetMigrationUrl);
      const rows = await fixture.sql`select level, xp from character where id = 'c1'`;
      expect(rows).toMatchObject([{ level, xp: String(newTotalXpForLevel(level)) }]);
    } finally {
      await fixture.cleanup();
    }
  });
});

async function schemaBeforeMigration0009(url: string) {
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
    // As migrações como elas eram ANTES da 0009 — em ordem, pelo nome do arquivo, como o
    // `drizzle-orm/postgres-js/migrator` aplica de verdade.
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql') && name < '0009_')
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
    async insertCharacter(id: string, accountId: string, level: number, xp: number): Promise<void> {
      await sql`
        insert into character (id, account_id, name, level, xp)
        values (${id}, ${accountId}, ${`Hero ${id}`}, ${level}, ${xp})
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
