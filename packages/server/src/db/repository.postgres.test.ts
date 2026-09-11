import { randomUUID } from 'node:crypto';
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

  it('o bot padrão entra na linha ao criar, e sem padrão a coluna nasce nula (FUN-114)', async () => {
    const account = await repository.ensureAccount({ externalAuthId: 'ext-bot', email: 'bot@example.com' });
    const config = { version: 1, heal: [], potion: [], attack: [], rune: [], support: [] };
    const withBot = await repository.createCharacter(account.id, 'Com Bot', { botConfig: config });
    expect(withBot.botConfig).toEqual(config);
    expect((await repository.getCharacter(account.id, withBot.id))?.botConfig).toEqual(config);
    const without = await repository.createCharacter(account.id, 'Sem Bot');
    expect(without.botConfig).toBeNull();
  });

  it('as cores do outfit nascem nulas e voltam como foram gravadas (FUN-104)', async () => {
    // Sem método de escrita ainda — a escolha (§7.4) não tem tela —, então a linha é escrita
    // por SQL, como a tela um dia vai escrever. O que se afirma é o caminho de LEITURA que o
    // ticket usa: `null` para quem nunca escolheu, e o documento inteiro, sem o repositório
    // opinar sobre a forma — quem valida contra a paleta é quem monta o ticket.
    const account = await repository.ensureAccount({
      externalAuthId: 'user_colors', email: 'colors@example.com',
    });
    const character = await repository.createCharacter(account.id, 'Painted Hero');
    expect(character.outfitColors).toBeNull();
    expect((await repository.getCharacter(account.id, character.id))?.outfitColors).toBeNull();

    const colors = { head: 78, body: 69, legs: 58, feet: 76 };
    await testDatabase.database.db.execute(
      sql`update ${characters} set outfit_colors = ${JSON.stringify(colors)}::jsonb where id = ${character.id}`,
    );

    expect((await repository.getCharacter(account.id, character.id))?.outfitColors).toEqual(colors);
    const locked = await repository.withOwnedCharacter(
      account.id, character.id, async (row) => row.outfitColors,
    );
    expect(locked).toEqual(colors);
    expect((await repository.listCharacters(account.id))[0]?.outfitColors).toEqual(colors);
  });

  it('o Bestiário nasce nulo e volta como foi gravado (FUN-113)', async () => {
    // O repositório não escreve a coluna — quem escreve é o ledger, na transação do extrato —,
    // então a linha é escrita por SQL, como o ledger escreve. O que se afirma é o caminho de
    // LEITURA que o ticket usa: `null` para quem nunca abateu nada, e o documento inteiro, sem
    // o repositório opinar sobre a forma — quem valida é quem monta o ticket.
    const account = await repository.ensureAccount({
      externalAuthId: 'user_bestiary', email: 'bestiary@example.com',
    });
    const character = await repository.createCharacter(account.id, 'Hunter Hero');
    expect(character.bestiary).toBeNull();
    expect((await repository.getCharacter(account.id, character.id))?.bestiary).toBeNull();

    const counts = { rat: 10_000, bat: 3 };
    await testDatabase.database.db.execute(
      sql`update ${characters} set bestiary = ${JSON.stringify(counts)}::jsonb where id = ${character.id}`,
    );

    expect((await repository.getCharacter(account.id, character.id))?.bestiary).toEqual(counts);
    const locked = await repository.withOwnedCharacter(
      account.id, character.id, async (row) => row.bestiary,
    );
    expect(locked).toEqual(counts);
    expect((await repository.listCharacters(account.id))[0]?.bestiary).toEqual(counts);
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

  describe('instância de item (FUN-76)', () => {
    const seed = async () => {
      const account = await repository.ensureAccount({
        externalAuthId: `user_${randomUUID()}`, email: `${randomUUID()}@example.com`,
      });
      return repository.createCharacter(account.id, `Hero ${randomUUID().slice(0, 8)}`);
    };

    it('cada instância nasce com IDENTIDADE própria e proveniência', async () => {
      // §9 da arquitetura: sem identidade, lendário não tem proveniência. Duas espadas do
      // mesmo id são duas linhas, e cada uma sabe de onde veio — a alternativa (um contador
      // por tipo) é barata até o dia em que alguém pergunta, e nesse dia a resposta não existe
      // para item nenhum, retroativamente.
      const character = await seed();
      const uma = await repository.createItemInstance({
        itemId: 'spike-sword', ownerCharacterId: character.id, origin: 'loot',
      });
      const outra = await repository.createItemInstance({
        itemId: 'spike-sword', ownerCharacterId: character.id, origin: 'boss',
      });

      expect(uma.id).not.toBe(outra.id);
      expect(uma.origin).toBe('loot');
      expect(outra.origin).toBe('boss');
      expect(uma.quantity).toBe(1);
    });

    it('item empilhável guarda a quantidade na mesma linha', async () => {
      const character = await seed();
      const flechas = await repository.createItemInstance({
        itemId: 'arrow', ownerCharacterId: character.id, origin: 'market', quantity: 100,
      });
      expect(flechas.quantity).toBe(100);
    });

    it('quantidade zero é recusada pelo BANCO, não só por código', async () => {
      // A restrição mora no schema: uma linha com quantidade zero é um item que existe e não
      // existe ao mesmo tempo, e a checagem no banco é a que continua valendo quando alguém
      // escrever um caminho novo de inserção.
      const character = await seed();
      await expect(repository.createItemInstance({
        itemId: 'arrow', ownerCharacterId: character.id, origin: 'loot', quantity: 0,
      })).rejects.toThrow();
    });

    it('lista o que é do personagem, em ordem estável, e só o dele', async () => {
      // Sem ordem estável, duas aberturas do inventário desenham a mesma coisa em ordens
      // diferentes e o jogador vê os itens dançando sem ter mexido em nada.
      const meu = await seed();
      const outro = await seed();
      await repository.createItemInstance({
        itemId: 'spike-sword', ownerCharacterId: meu.id, origin: 'loot',
      });
      await repository.createItemInstance({
        itemId: 'leather-armor', ownerCharacterId: meu.id, origin: 'quest',
      });
      await repository.createItemInstance({
        itemId: 'arrow', ownerCharacterId: outro.id, origin: 'market',
      });

      const meus = await repository.listItemInstances(meu.id);
      expect(meus.map((i) => i.itemId)).toEqual(['spike-sword', 'leather-armor']);
      expect(await repository.listItemInstances(meu.id)).toEqual(meus);
      expect(await repository.listItemInstances(outro.id)).toHaveLength(1);
    });

    it('recusa instância de personagem que não existe', async () => {
      // A chave estrangeira é sobre o DONO, não sobre o item: o catálogo é conteúdo e não tem
      // tabela para apontar.
      await expect(repository.createItemInstance({
        itemId: 'spike-sword', ownerCharacterId: randomUUID(), origin: 'loot',
      })).rejects.toThrow();
    });
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
