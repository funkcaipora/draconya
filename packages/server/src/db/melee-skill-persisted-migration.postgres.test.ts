// #568 (ADR 0014): a #567 (PR #736) separou a skill única `melee` em quatro —
// `fist`/`club`/`sword`/`axe` — mas não migrou o dado já gravado. A migração 0013 copia o
// progresso de `skills.melee` para `club`/`sword`/`axe` (a mesma curva que `melee` tinha antes
// da separação), deixa `fist` no inicial (sem entrada — a issue pede isso explicitamente: não há
// como saber, olhando só o total acumulado em `melee`, quanto veio de golpe desarmado) e NUNCA
// apaga `melee` (ADR 0014, nunca descartar dado persistido). Este teste aplica as migrações
// 0000–0012 (o schema como ele era ANTES da 0013), insere personagens com `skills.melee` já
// gravado, roda só a 0013, e confere as quatro propriedades: cópia correta, `fist` ausente,
// `melee` preservada, e — a mais importante — que a migração NUNCA sobrescreve progresso REAL
// já gravado em `club`/`sword`/`axe` por alguém que treinou de verdade entre o deploy do #567 e
// o desta migração.
//
// Mora aqui, e não em `packages/server/migrations/`, pelo mesmo motivo do
// `xp-curve-migration.postgres.test.ts`: é teste de comportamento de uma migração de dado, não
// fixture de conteúdo — `packages/sim` não faz I/O e não pode afirmar nada sobre uma linha do
// Postgres.
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const migrationsDir = new URL('../../migrations/', import.meta.url);
const targetMigrationUrl = new URL(
  '../../migrations/0013_568-melee-skill-persisted-migration.sql', import.meta.url,
);

interface SkillEntry {
  readonly level: number;
  readonly points: number;
}

describe.runIf(databaseUrl !== undefined)('migração 0013: skills.melee órfã migra para club/sword/axe (#568, ADR 0014)', () => {
  it('personagem com melee treinado ganha club/sword/axe iguais, fist continua no inicial, melee não é apagada', async () => {
    const fixture = await schemaBeforeMigration0013(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'a1', { melee: { level: 35, points: 120 } });
      await runSqlFile(fixture.sql, targetMigrationUrl);

      const skills = await fixture.skillsOf('c1');
      expect(skills['melee']).toEqual({ level: 35, points: 120 });
      expect(skills['club']).toEqual({ level: 35, points: 120 });
      expect(skills['sword']).toEqual({ level: 35, points: 120 });
      expect(skills['axe']).toEqual({ level: 35, points: 120 });
      expect(skills['fist']).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it('não sobrescreve progresso REAL já gravado em sword depois do #567', async () => {
    const fixture = await schemaBeforeMigration0013(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'a1', {
        melee: { level: 35, points: 120 },
        // Treinado DE VERDADE após o deploy do #567, antes de esta migração rodar.
        sword: { level: 41, points: 7 },
      });
      await runSqlFile(fixture.sql, targetMigrationUrl);

      const skills = await fixture.skillsOf('c1');
      expect(skills['sword']).toEqual({ level: 41, points: 7 }); // não foi atropelado
      expect(skills['club']).toEqual({ level: 35, points: 120 }); // este SIM veio de melee
      expect(skills['axe']).toEqual({ level: 35, points: 120 });
    } finally {
      await fixture.cleanup();
    }
  });

  it('é idempotente: rodar duas vezes não altera o resultado da primeira', async () => {
    const fixture = await schemaBeforeMigration0013(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'a1', { melee: { level: 10, points: 0 } });
      await runSqlFile(fixture.sql, targetMigrationUrl);
      await runSqlFile(fixture.sql, targetMigrationUrl);

      const skills = await fixture.skillsOf('c1');
      expect(skills['club']).toEqual({ level: 10, points: 0 });
      expect(skills['sword']).toEqual({ level: 10, points: 0 });
      expect(skills['axe']).toEqual({ level: 10, points: 0 });
    } finally {
      await fixture.cleanup();
    }
  });

  it('personagem sem melee não é tocado', async () => {
    const fixture = await schemaBeforeMigration0013(databaseUrl!);
    try {
      await fixture.insertCharacter('c1', 'a1', {});
      await runSqlFile(fixture.sql, targetMigrationUrl);
      const skills = await fixture.skillsOf('c1');
      expect(skills).toEqual({});
    } finally {
      await fixture.cleanup();
    }
  });
});

async function schemaBeforeMigration0013(url: string) {
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
    // As migrações como elas eram ANTES da 0013 — em ordem, pelo nome do arquivo, como o
    // `drizzle-orm/postgres-js/migrator` aplica de verdade.
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql') && name < '0013_')
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
    async insertCharacter(
      id: string, accountId: string, skills: Readonly<Record<string, SkillEntry>>,
    ): Promise<void> {
      await sql`
        insert into character (id, account_id, name, skills)
        values (${id}, ${accountId}, ${`Hero ${id}`}, ${JSON.stringify(skills)}::jsonb)
      `;
    },
    async skillsOf(id: string): Promise<Record<string, SkillEntry>> {
      const rows = await sql`select skills from character where id = ${id}`;
      return rows[0]?.['skills'] as Record<string, SkillEntry>;
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
