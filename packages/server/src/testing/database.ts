import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase, type DatabaseHandle } from '../db/client.js';

export interface TestDatabase {
  readonly database: DatabaseHandle;
  readonly url: string;
  cleanup(): Promise<void>;
}

export async function connectTestDatabase(baseUrl?: string): Promise<TestDatabase> {
  const url = baseUrl ?? process.env['DATABASE_TEST_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_TEST_URL is required for PostgreSQL integration tests');
  }

  const schemaName = `test_${randomUUID().replaceAll('-', '')}`;
  const administrator = postgres(url, { max: 1, onnotice: () => {} });
  await administrator.unsafe(`create schema "${schemaName}"`);

  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set(
    'options',
    `-c search_path=${schemaName} -c client_min_messages=warning`,
  );
  const database = createDatabase(scopedUrl.toString());

  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
      migrationsSchema: schemaName,
    });
  } catch (error) {
    await database.close();
    await administrator.unsafe(`drop schema "${schemaName}" cascade`);
    await administrator.end({ timeout: 5 });
    throw error;
  }

  let cleanedUp = false;
  return {
    database,
    url: scopedUrl.toString(),
    async cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      await database.close();
      await administrator.unsafe(`drop schema "${schemaName}" cascade`);
      await administrator.end({ timeout: 5 });
    },
  };
}
