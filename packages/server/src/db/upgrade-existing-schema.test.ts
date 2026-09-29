import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const initialMigrationUrl = new URL('../../migrations/0000_fun-11-accounts-and-characters.sql', import.meta.url);
const upgradeMigrationUrl = new URL('./upgrade-existing-schema.sql', import.meta.url);

describe.runIf(databaseUrl !== undefined)('existing English schema FUN-11 upgrade', () => {
  it('preserves character and ledger rows while adding soft delete uniqueness', async () => {
    const fixture = await createExistingSchema(databaseUrl!);
    try {
      await fixture.sql`
        insert into account (id, email, external_auth_id) values ('a1', 'hero@example.com', 'user_1')
      `;
      await fixture.sql`
        insert into character (id, account_id, name, premium_until)
        values ('c1', 'a1', 'Hero', '2026-10-01T00:00:00Z')
      `;
      await fixture.sql`
        insert into ledger (id, character_id, session_id, seq, type, delta)
        values ('l1', 'c1', 's1', 1, 'initial', 25)
      `;

      await runSqlFile(fixture.sql, upgradeMigrationUrl);

      const characterRows = await fixture.sql`
        select id, name, premium_until, deleted_at from character where id = 'c1'
      `;
      const ledgerRows = await fixture.sql`
        select id, character_id, delta from ledger where id = 'l1'
      `;
      expect(characterRows).toMatchObject([{
        id: 'c1', name: 'Hero', premium_until: new Date('2026-10-01T00:00:00Z'), deleted_at: null,
      }]);
      expect(ledgerRows).toMatchObject([{ id: 'l1', character_id: 'c1', delta: '25' }]);

      await expect(fixture.sql`
        insert into character (id, account_id, name) values ('c2', 'a1', 'hero')
      `).rejects.toMatchObject({ code: '23505', constraint_name: 'character_name_unique' });

      await fixture.sql`update character set deleted_at = now() where id = 'c1'`;
      await fixture.sql`
        insert into character (id, account_id, name) values ('c2', 'a1', 'hero')
      `;
      expect(await fixture.sql`select count(*)::int as count from character`).toMatchObject([{ count: 2 }]);
    } finally {
      await fixture.cleanup();
    }
  }, 20_000);

  it('rolls back completely when existing names collide after case folding', async () => {
    const fixture = await createExistingSchema(databaseUrl!);
    try {
      await fixture.sql`
        insert into account (id, email, external_auth_id) values ('a1', 'hero@example.com', 'user_1')
      `;
      await fixture.sql`
        insert into character (id, account_id, name)
        values ('c1', 'a1', 'Hero'), ('c2', 'a1', 'hero')
      `;

      await expect(runSqlFile(fixture.sql, upgradeMigrationUrl)).rejects.toMatchObject({
        code: '23505',
      });
      await fixture.sql.unsafe('rollback');

      const columns = await fixture.sql`
        select column_name
        from information_schema.columns
        where table_schema = current_schema() and table_name = 'character' and column_name = 'deleted_at'
      `;
      const indexes = await fixture.sql`
        select indexdef from pg_indexes
        where schemaname = current_schema() and indexname = 'character_name_unique'
      `;
      expect(columns).toHaveLength(0);
      expect(indexes[0]?.indexdef).toContain('USING btree (name)');
      expect(await fixture.sql`select count(*)::int as count from character`).toMatchObject([{ count: 2 }]);
    } finally {
      await fixture.cleanup();
    }
  }, 20_000);
});

async function createExistingSchema(url: string) {
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
    await runSqlFile(sql, initialMigrationUrl);
    await sql.unsafe([
      'drop index character_name_unique',
      'alter table character drop constraint character_name_nfc',
      'alter table character drop column deleted_at',
      'create unique index character_name_unique on character (name)',
    ].join(';'));
  } catch (error) {
    await sql.end({ timeout: 5 });
    await administrator.unsafe(`drop schema "${schemaName}" cascade`);
    await administrator.end({ timeout: 5 });
    throw error;
  }

  return {
    sql,
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
