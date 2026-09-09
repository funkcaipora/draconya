import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { accounts, characters } from './schema.js';
import {
  AccountIdentityConflictError,
  CharacterNameTakenError,
  DrizzleGameRepository,
} from './repository.js';

const databaseAvailable = process.env['DATABASE_TEST_URL'] !== undefined;

describe.runIf(databaseAvailable)('PostgreSQL game repository', () => {
  let testDatabase: TestDatabase;
  let repository: DrizzleGameRepository;

  beforeAll(async () => {
    testDatabase = await connectTestDatabase();
    repository = new DrizzleGameRepository(testDatabase.database.db);
  });

  beforeEach(async () => {
    await testDatabase.database.db.execute(sql`truncate table ${accounts} cascade`);
  });

  afterAll(async () => {
    await testDatabase.cleanup();
  });

  it('creates accounts and characters with the persisted initial values', async () => {
    const account = await repository.ensureAccount({
      externalAuthId: 'user_initial',
      email: ' Hero@Example.com ',
    });
    const character = await repository.createCharacter(account.id, 'New Hero');

    expect(account).toMatchObject({
      email: 'hero@example.com',
      externalAuthId: 'user_initial',
      coins: 0,
    });
    expect(character).toMatchObject({
      accountId: account.id,
      name: 'New Hero',
      vocation: null,
      level: 1,
      xp: 0,
      gold: 0,
      capacity: 400,
      premiumUntil: null,
      staminaMs: 86_400_000,
      state: 'city',
      sessionId: null,
    });
    expect(character.staminaUpdatedAt).toBeInstanceOf(Date);
    expect(character.createdAt).toBeInstanceOf(Date);
  });

  it('uses the external identity as the account key under concurrent login', async () => {
    const results = await Promise.all([
      repository.ensureAccount({ externalAuthId: 'user_same', email: 'same@example.com' }),
      repository.ensureAccount({ externalAuthId: 'user_same', email: 'same@example.com' }),
    ]);

    expect(results[0]?.id).toBe(results[1]?.id);
    const rows = await testDatabase.database.db.select().from(accounts);
    expect(rows).toHaveLength(1);
  });

  it('rejects imprecise bigint values at the domain boundary', async () => {
    const account = await repository.ensureAccount({ externalAuthId: 'user_bigint', email: 'bigint@example.com' });
    const character = await repository.createCharacter(account.id, 'Big Hero');
    await testDatabase.database.db.execute(sql`update ${characters} set gold = 9007199254740993 where id = ${character.id}`);
    await expect(repository.getCharacter(account.id, character.id)).rejects.toThrow('safe integer range');
  });

  it('enforces Unicode normalization and case-insensitive uniqueness in PostgreSQL', async () => {
    const account = await repository.ensureAccount({ externalAuthId: 'user_unicode', email: 'unicode@example.com' });
    await repository.createCharacter(account.id, 'Ártemis');
    await expect(repository.createCharacter(account.id, 'ÁRTEMIS')).rejects.toBeInstanceOf(CharacterNameTakenError);
    await expect(testDatabase.database.db.insert(characters).values({
      id: 'invalid-nfc', accountId: account.id, name: 'A\u0301rtemis',
    })).rejects.toThrow();
  });

  it('does not transfer an email between different external identities', async () => {
    const original = await repository.ensureAccount({
      externalAuthId: 'user_original',
      email: 'owner@example.com',
    });

    await expect(repository.ensureAccount({
      externalAuthId: 'user_attacker',
      email: 'owner@example.com',
    })).rejects.toBeInstanceOf(AccountIdentityConflictError);

    const rows = await testDatabase.database.db.select().from(accounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: original.id, externalAuthId: 'user_original' });
  });

  it('lets the database arbitrate concurrent case-insensitive name creation', async () => {
    const account = await repository.ensureAccount({
      externalAuthId: 'user_names',
      email: 'names@example.com',
    });
    const results = await Promise.allSettled([
      repository.createCharacter(account.id, 'Dragon Knight'),
      repository.createCharacter(account.id, 'dragon knight'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(CharacterNameTakenError) });
    expect(await repository.listCharacters(account.id)).toHaveLength(1);
  });

  it('enforces ownership, hides soft-deleted rows and releases their names', async () => {
    const owner = await repository.ensureAccount({
      externalAuthId: 'user_owner',
      email: 'owner@example.com',
    });
    const other = await repository.ensureAccount({
      externalAuthId: 'user_other',
      email: 'other@example.com',
    });
    const character = await repository.createCharacter(owner.id, 'Retired Hero');

    expect(await repository.getCharacter(other.id, character.id)).toBeNull();
    expect(await repository.softDeleteCharacter(other.id, character.id)).toBe('not-found');
    expect(await repository.softDeleteCharacter(owner.id, character.id)).toBe('deleted');
    expect(await repository.getCharacter(owner.id, character.id)).toBeNull();
    expect(await repository.listCharacters(owner.id)).toEqual([]);
    const deletedRows = await testDatabase.database.db
      .select({ deletedAt: characters.deletedAt })
      .from(characters)
      .where(sql`${characters.id} = ${character.id}`);
    expect(deletedRows[0]?.deletedAt).toBeInstanceOf(Date);

    const replacement = await repository.createCharacter(other.id, 'retired hero');
    expect(replacement.accountId).toBe(other.id);
  });

  it('refuses deletion when a persisted session owns the character', async () => {
    const account = await repository.ensureAccount({
      externalAuthId: 'user_session',
      email: 'session@example.com',
    });
    const character = await repository.createCharacter(account.id, 'Session Hero');
    await testDatabase.database.db
      .update(characters)
      .set({ sessionId: 'session-1' })
      .where(sql`${characters.id} = ${character.id}`);

    expect(await repository.softDeleteCharacter(account.id, character.id)).toBe('active');
    expect(await repository.getCharacter(account.id, character.id)).not.toBeNull();
  });

  it('serializes ticket reservation and deletion through the same row lock', async () => {
    const account = await repository.ensureAccount({
      externalAuthId: 'user_race',
      email: 'race@example.com',
    });
    const character = await repository.createCharacter(account.id, 'Race Hero');
    const operationEntered = deferred<void>();
    const releaseOperation = deferred<void>();
    const activeCheckCalled = deferred<void>();
    let active = false;

    const issuance = repository.withOwnedCharacter(account.id, character.id, async () => {
      operationEntered.resolve();
      await releaseOperation.promise;
      active = true;
      return 'issued';
    });
    await operationEntered.promise;

    const deletion = repository.softDeleteCharacter(account.id, character.id, async () => {
      activeCheckCalled.resolve();
      return active;
    });
    // A ÚNICA espera real que sobra na suíte, e com motivo (FUN-62): o que se afirma é que
    // a exclusão está BLOQUEADA numa trava de linha do Postgres enquanto a emissão a segura, e
    // "continua bloqueada" só se observa deixando passar tempo — não há relógio a injetar na
    // trava do banco. 75 ms é folga sobre um `await` que, sem a trava, resolveria em menos de
    // um; se vier a falhar sob carga, é a trava que sumiu, não o número que apertou.
    expect(await Promise.race([
      activeCheckCalled.promise.then(() => 'called'),
      delay(75).then(() => 'blocked'),
    ])).toBe('blocked');

    releaseOperation.resolve();
    await expect(issuance).resolves.toBe('issued');
    await expect(deletion).resolves.toBe('active');
    expect(await repository.getCharacter(account.id, character.id)).not.toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
