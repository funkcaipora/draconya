import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from './client.js';
import { accounts, characters } from './schema.js';

export interface AccountRecord {
  readonly id: string;
  readonly email: string;
  readonly externalAuthId: string;
  readonly coins: number;
}

export interface CharacterRecord {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly vocation: string | null;
  readonly level: number;
  readonly xp: number;
  readonly gold: number;
  readonly capacity: number;
  readonly premiumUntil: Date | null;
  readonly staminaMs: number;
  readonly staminaUpdatedAt: Date;
  readonly state: string;
  readonly sessionId: string | null;
  readonly createdAt: Date;
}

export type DeleteCharacterResult = 'deleted' | 'not-found' | 'active';
export type CharacterActiveCheck = (
  accountId: string,
  characterId: string,
) => Promise<boolean>;

export interface GameRepository {
  ensureAccount(identity: { externalAuthId: string; email: string }): Promise<AccountRecord>;
  createCharacter(accountId: string, name: string): Promise<CharacterRecord>;
  listCharacters(accountId: string): Promise<readonly CharacterRecord[]>;
  getCharacter(accountId: string, characterId: string): Promise<CharacterRecord | null>;
  ownsCharacter(accountId: string, characterId: string): Promise<boolean>;
  withOwnedCharacter<T>(
    accountId: string,
    characterId: string,
    operation: (character: CharacterRecord) => Promise<T>,
  ): Promise<T | null>;
  softDeleteCharacter(
    accountId: string,
    characterId: string,
    isCharacterActive?: CharacterActiveCheck,
  ): Promise<DeleteCharacterResult>;
}

export class DrizzleGameRepository implements GameRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async ensureAccount(identity: { externalAuthId: string; email: string }): Promise<AccountRecord> {
    const email = identity.email.trim().toLowerCase();
    try {
      const [created] = await this.#db
        .insert(accounts)
        .values({ id: randomUUID(), email, externalAuthId: identity.externalAuthId })
        .onConflictDoUpdate({
          target: accounts.externalAuthId,
          set: { email },
        })
        .returning();
      if (created === undefined) throw new Error('failed to ensure account');
      return toAccount(created);
    } catch (error) {
      if (isUniqueViolation(error, 'account_email_unique')) {
        throw new AccountIdentityConflictError();
      }
      throw error;
    }
  }

  async createCharacter(accountId: string, name: string): Promise<CharacterRecord> {
    try {
      const [created] = await this.#db
        .insert(characters)
        .values({ id: randomUUID(), accountId, name })
        .returning();
      if (created === undefined) throw new Error('failed to create character');
      return toCharacter(created);
    } catch (error) {
      if (isUniqueViolation(error, 'character_name_unique')) throw new CharacterNameTakenError();
      throw error;
    }
  }

  async listCharacters(accountId: string): Promise<readonly CharacterRecord[]> {
    const rows = await this.#db
      .select()
      .from(characters)
      .where(and(eq(characters.accountId, accountId), isNull(characters.deletedAt)))
      .orderBy(asc(characters.createdAt));
    return rows.map(toCharacter);
  }

  async getCharacter(accountId: string, characterId: string): Promise<CharacterRecord | null> {
    const rows = await this.#db
      .select()
      .from(characters)
      .where(and(
        eq(characters.id, characterId),
        eq(characters.accountId, accountId),
        isNull(characters.deletedAt),
      ))
      .limit(1);
    return rows[0] === undefined ? null : toCharacter(rows[0]);
  }

  async ownsCharacter(accountId: string, characterId: string): Promise<boolean> {
    return (await this.getCharacter(accountId, characterId)) !== null;
  }

  async withOwnedCharacter<T>(
    accountId: string,
    characterId: string,
    operation: (character: CharacterRecord) => Promise<T>,
  ): Promise<T | null> {
    return this.#db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(characters)
        .where(and(
          eq(characters.id, characterId),
          eq(characters.accountId, accountId),
          isNull(characters.deletedAt),
        ))
        .limit(1)
        .for('update');
      const character = rows[0];
      return character === undefined ? null : operation(toCharacter(character));
    });
  }

  async softDeleteCharacter(
    accountId: string,
    characterId: string,
    isCharacterActive?: CharacterActiveCheck,
  ): Promise<DeleteCharacterResult> {
    return this.#db.transaction(async (tx) => {
      const rows = await tx
        .select({ sessionId: characters.sessionId })
        .from(characters)
        .where(and(
          eq(characters.id, characterId),
          eq(characters.accountId, accountId),
          isNull(characters.deletedAt),
        ))
        .limit(1)
        .for('update');
      const character = rows[0];
      if (character === undefined) return 'not-found';

      // A consulta ao diretório ocorre sob a mesma trava usada pela emissão de ticket.
      // Assim, reserva e exclusão não podem observar ownership válido ao mesmo tempo.
      if (character.sessionId !== null
        || (isCharacterActive !== undefined
          && await isCharacterActive(accountId, characterId))) {
        return 'active';
      }

      const deleted = await tx
        .update(characters)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(characters.id, characterId),
          eq(characters.accountId, accountId),
          isNull(characters.deletedAt),
          isNull(characters.sessionId),
        ))
        .returning({ id: characters.id });
      return deleted.length === 0 ? 'active' : 'deleted';
    });
  }
}

export class AccountIdentityConflictError extends Error {
  constructor() {
    super('account email belongs to another external identity');
    this.name = 'AccountIdentityConflictError';
  }
}

export class CharacterNameTakenError extends Error {
  constructor() {
    super('character name already exists');
    this.name = 'CharacterNameTakenError';
  }
}

function toAccount(row: typeof accounts.$inferSelect): AccountRecord {
  if (row.externalAuthId === null) throw new Error('authenticated account has no external auth id');
  return { id: row.id, email: row.email, externalAuthId: row.externalAuthId, coins: row.coins };
}

function toCharacter(row: typeof characters.$inferSelect): CharacterRecord {
  // O domínio usa number. Um bigint fora do intervalo seguro não pode virar progresso
  // arredondado silenciosamente ao atravessar a fronteira Postgres → TypeScript.
  for (const value of [row.xp, row.gold, row.staminaMs]) {
    if (!Number.isSafeInteger(value)) throw new Error('character value exceeds safe integer range');
  }
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    vocation: row.vocation,
    level: row.level,
    xp: row.xp,
    gold: row.gold,
    capacity: row.capacity,
    premiumUntil: row.premiumUntil,
    staminaMs: row.staminaMs,
    staminaUpdatedAt: row.staminaUpdatedAt,
    state: row.state,
    sessionId: row.sessionId,
    createdAt: row.createdAt,
  };
}

function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === '23505') return matchesConstraint(candidate, constraintName);
  if (typeof candidate.cause === 'object' && candidate.cause !== null) {
    const cause = candidate.cause as { code?: unknown };
    return cause.code === '23505' && matchesConstraint(cause, constraintName);
  }
  return false;
}

/**
 * Falha FECHADA quando o driver não diz qual constraint estourou.
 *
 * Casar com qualquer coisa faria uma violação de índice futuro em `character` sair como
 * HTTP 409 "name-taken": o jogador é mandado escolher outro nome por uma colisão que não
 * tem nada a ver com o nome, e a causa real some, engolida pelo erro tipado. Sem nome,
 * o certo é deixar o erro subir com o que ele é.
 */
function matchesConstraint(error: object, constraintName: string): boolean {
  const candidate = error as { constraint_name?: unknown; constraint?: unknown };
  return (candidate.constraint_name ?? candidate.constraint) === constraintName;
}
