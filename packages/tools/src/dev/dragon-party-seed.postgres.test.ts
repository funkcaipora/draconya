// A parte que grava o banco da semente da party de dragões (#526), contra um Postgres de
// verdade (FUN-102: por isso o sufixo `.postgres.test.ts`). Não sobe o `api` nem o `game` — só
// confere o que `seedCharacterStats` grava a partir de um personagem já criado pelo repositório,
// exatamente como o runner o entrega depois de `POST /api/characters`.
//
// O conteúdo é o REAL deste branch (`packages/content/data`), não um placeholder: o que este
// teste prova é que o kit level 200 (#524), as skills (#521) e o bot config apontam para coisa
// que existe NESTA branch — um placeholder provaria só que a forma está certa.

import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '@draconya/content/load';
import { validateBotConfigV2 } from '@draconya/content';
import { totalXpForLevel } from '@draconya/sim';
import {
  createDatabase, DrizzleGameRepository, schema, type DatabaseHandle,
} from '@draconya/server';
import { DRAGON_PARTY_LEVEL, DRAGON_PARTY_MEMBERS } from './dragon-party-plan.js';
import { seedCharacterStats } from './dragon-party-seed.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(HERE, '..', '..', '..', 'content', 'data');
const MIGRATIONS_DIR = join(HERE, '..', '..', '..', 'server', 'migrations');

const databaseAvailable = process.env['DATABASE_TEST_URL'] !== undefined;
const content = loadContent(CONTENT_DIR);

describe.runIf(databaseAvailable)('a semente da party de dragões grava o Postgres (#526)', () => {
  let administrator: ReturnType<typeof postgres>;
  let schemaName: string;
  let database: DatabaseHandle;
  let repository: DrizzleGameRepository;

  beforeAll(async () => {
    const url = process.env['DATABASE_TEST_URL'] as string;
    schemaName = `test_${randomUUID().replaceAll('-', '')}`;
    administrator = postgres(url, { max: 1, onnotice: () => undefined });
    await administrator.unsafe(`create schema "${schemaName}"`);

    const scopedUrl = new URL(url);
    scopedUrl.searchParams.set('options', `-c search_path=${schemaName} -c client_min_messages=warning`);
    database = createDatabase(scopedUrl.toString());
    await migrate(database.db, { migrationsFolder: MIGRATIONS_DIR, migrationsSchema: schemaName });
    repository = new DrizzleGameRepository(database.db);
  });

  afterAll(async () => {
    await database.close();
    await administrator.unsafe(`drop schema "${schemaName}" cascade`);
    await administrator.end({ timeout: 5 });
  });

  async function createBareCharacter(name: string): Promise<string> {
    const account = await repository.ensureAccount({
      externalAuthId: randomUUID(), email: `${randomUUID()}@dragon-party.test`,
    });
    const character = await repository.createCharacter(account.id, name);
    return character.id;
  }

  it('sobe os quatro para level 200 com xp coerente, skills, kit e bot válidos', async () => {
    const expectedXp = totalXpForLevel(DRAGON_PARTY_LEVEL, content.progression);

    for (const member of DRAGON_PARTY_MEMBERS) {
      const characterId = await createBareCharacter(member.characterName);
      const result = await seedCharacterStats(database.db, content, characterId, member.vocationId);

      expect(result.level).toBe(DRAGON_PARTY_LEVEL);
      expect(result.xp).toBe(expectedXp);
      expect(result.gold).toBeGreaterThan(0);
      expect(result.equippedItemIds.length).toBeGreaterThan(0);

      const [row] = await database.db
        .select().from(schema.characters).where(eq(schema.characters.id, characterId));
      expect(row).toBeDefined();
      expect(row?.vocation).toBe(member.vocationId);
      expect(row?.level).toBe(DRAGON_PARTY_LEVEL);
      // level ↔ xp coerente: a curva do Tibia (#521) devolve o MESMO level a partir do xp gravado.
      expect(row?.xp).toBe(expectedXp);
      expect(row?.gold).toBe(result.gold);

      const botConfig = row?.botConfig;
      expect(botConfig).toBeTruthy();
      const problems = validateBotConfigV2(
        botConfig as Parameters<typeof validateBotConfigV2>[0], content,
      );
      expect(problems).toEqual([]);

      const items = await database.db
        .select().from(schema.itemInstances).where(eq(schema.itemInstances.ownerCharacterId, characterId));
      expect(items.length).toBe(result.equippedItemIds.length);
      for (const item of items) {
        expect(item.equippedSlot).not.toBeNull();
        expect(result.equippedItemIds).toContain(item.itemId);
      }

      if (member.vocationId === 'paladin') {
        expect(row?.ammo).toEqual({ bolt: 'power-bolt' });
      } else {
        expect(row?.ammo).toBeNull();
      }
    }
  });

  it('é idempotente: reroda sobre o mesmo personagem sem duplicar ou perder equipamento', async () => {
    const characterId = await createBareCharacter('Reroda Knight');

    const first = await seedCharacterStats(database.db, content, characterId, 'knight');
    const second = await seedCharacterStats(database.db, content, characterId, 'knight');

    expect(second.level).toBe(first.level);
    expect(second.xp).toBe(first.xp);
    expect(second.gold).toBe(first.gold);
    expect([...second.equippedItemIds].sort()).toEqual([...first.equippedItemIds].sort());

    const items = await database.db
      .select().from(schema.itemInstances).where(eq(schema.itemInstances.ownerCharacterId, characterId));
    expect(items.length).toBe(first.equippedItemIds.length);

    // Um item por slot — o mesmo índice único que o kit de nascimento usa (`item_instance_one_per_slot`).
    const slots = items.map((item) => item.equippedSlot);
    expect(new Set(slots).size).toBe(slots.length);
  });
});
