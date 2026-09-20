import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { accounts, characters, friends, itemInstances } from './schema.js';

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
  /**
   * A configuração do bot, como veio do banco (FUN-81). `unknown` de propósito: quem valida
   * contra o vocabulário é `botConfigSchema`, e o repositório não é lugar de conhecer regra de
   * jogo. `null` é personagem que nunca configurou.
   */
  readonly botConfig: unknown;
  /** Skills que sobem por uso (§9.4, FUN-75). A coluna já existia; o que faltava era quem a usasse. */
  readonly skills: unknown;
  /**
   * As cores do outfit, como vieram do banco (FUN-104). `unknown` pela mesma razão de
   * `botConfig`: a forma é do protocolo (`OutfitColors`), e quem a valida é quem monta o
   * ticket — o repositório não é lugar de conhecer paleta. `null` é personagem que nunca
   * escolheu. Sem método de escrita: a escolha (§7.4) ainda não tem tela.
   */
  readonly outfitColors: unknown;
  /**
   * Abates por monstro, como vieram do banco (§18, FUN-113). `unknown` pela mesma razão de
   * `skills`: a forma (`BestiaryState`) é do `sim`, e quem a confere é quem monta o ticket.
   * `null` é personagem que nunca abateu nada, ou gravado antes do Bestiário — os dois entram
   * na sessão com `{}`. Sem método de escrita: quem escreve é o ledger, na transação do extrato.
   */
  readonly bestiary: unknown;
  /** A munição escolhida por família (#152), como veio do banco; `null` é a grátis. */
  readonly ammo: unknown;
  readonly createdAt: Date;
}

/**
 * Uma instância de item no banco (FUN-76).
 *
 * `itemId` é do CATÁLOGO, que é conteúdo — o repositório não sabe o que uma espada faz, só que
 * esta linha existe e é de alguém.
 */
/** Uma peça do kit de nascimento: o item e o slot em que ele nasce vestido (#153). */
export interface StartingKitPiece {
  readonly itemId: string;
  readonly slot: string;
}

export interface ItemInstanceRecord {
  readonly id: string;
  readonly itemId: string;
  readonly ownerCharacterId: string;
  readonly quantity: number;
  readonly origin: string;
  /** Em que slot está vestida, ou `null` para "na mochila" (FUN-82). */
  readonly equippedSlot: string | null;
  /** Onde está dentro dos containers (#160); nulos é linha sem posição gravada. */
  readonly container: string | null;
  readonly slotIndex: number | null;
  readonly createdAt: Date;
}

export type DeleteCharacterResult = 'deleted' | 'not-found' | 'active';
export type CharacterActiveCheck = (
  accountId: string,
  characterId: string,
) => Promise<boolean>;

/** Uma linha da tabela `friend` (Amigos, §21): a amizade é um fato, não uma presença. */
export interface FriendRecord {
  readonly id: string;
  readonly characterId: string;
  readonly friendCharacterId: string;
  readonly createdAt: Date;
}

/**
 * A vista que `GET /api/friends` precisa, já com nome/vocação/level — uma JOIN só, não um
 * lookup por amigo (a tabela `friend` não guarda accountId, e não deveria: accountId é do
 * personagem, não da amizade).
 */
export interface FriendView {
  readonly characterId: string;
  readonly name: string;
  readonly vocation: string | null;
  readonly level: number;
  readonly createdAt: Date;
}

export interface GameRepository {
  ensureAccount(identity: { externalAuthId: string; email: string }): Promise<AccountRecord>;
  /**
   * Cria o personagem. `initial.botConfig` é a configuração de bot com que ele NASCE (FUN-114)
   * — a padrão do conteúdo, gravada aqui porque o personagem novo precisa entrar na primeira
   * hunt curando e atacando sem ter aberto tela nenhuma. Opaca: quem valida o vocabulário é o host da sessão.
   *
   * `initial.kit` é com o que ele nasce VESTIDO (#153, ADR 0026 decisão 2): uma linha de
   * `item_instance` por peça, origem `starting-kit`, na MESMA transação do personagem —
   * personagem sem kit, ou kit sem personagem, são os dois estados que uma falha no meio
   * deixaria para trás. Não passa pelo ledger: o kit não tem preço, é inicialização de linha
   * como o bot padrão.
   */
  createCharacter(
    accountId: string, name: string,
    initial?: { readonly botConfig?: unknown; readonly kit?: readonly StartingKitPiece[] },
  ): Promise<CharacterRecord>;
  listCharacters(accountId: string): Promise<readonly CharacterRecord[]>;
  getCharacter(accountId: string, characterId: string): Promise<CharacterRecord | null>;
  ownsCharacter(accountId: string, characterId: string): Promise<boolean>;
  /**
   * Resolve um personagem pelo nome (Amigos, §21). Mesma normalização do índice único
   * (`character_name_unique`) que já impede dois personagens ativos com nomes que só diferem
   * em maiúscula/acentuação — quem busca "Jose" precisa achar "José".
   */
  getCharacterByName(name: string): Promise<CharacterRecord | null>;
  /** Direção única (ADR 0031 decisão 6): não cria a amizade recíproca. */
  addFriend(characterId: string, friendCharacterId: string): Promise<FriendRecord>;
  listFriends(characterId: string): Promise<readonly FriendView[]>;
  /** `false` se o par não existia — remover o que não é amigo é idempotente, não é erro. */
  removeFriend(characterId: string, friendCharacterId: string): Promise<boolean>;
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
  /**
   * Cria uma instância de item para um personagem (FUN-76).
   *
   * **Nada no jogo chama isto ainda**, e é deliberado: loot de item, inventário e caixa de loot
   * são as issues seguintes do marco. O que existe aqui é a identidade — e ela precisa existir
   * antes de a primeira instância nascer, porque proveniência que começa tarde não vale para o
   * que veio antes.
   */
  createItemInstance(instance: {
    itemId: string;
    ownerCharacterId: string;
    origin: string;
    quantity?: number;
  }): Promise<ItemInstanceRecord>;
  /** O que este personagem tem. É a consulta que o índice por dono existe para servir. */
  listItemInstances(characterId: string): Promise<readonly ItemInstanceRecord[]>;
  /**
   * Aplica o layout de equipamento que a sessão registrou (FUN-82).
   *
   * `equipped` é `slot → instanceId`, ABSOLUTO: o que não está nele volta para a mochila. É a
   * mesma forma das skills, e pela mesma razão — a sessão sabe o estado final, e mandar delta
   * exigiria que os dois lados concordassem sobre o inicial.
   *
   * Tudo escopado por `ownerCharacterId`: um extrato não move item de outra pessoa nem que
   * traga o id dela.
   */
  applyEquipment(characterId: string, equipped: Readonly<Record<string, string>>): Promise<void>;
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

  async createCharacter(
    accountId: string, name: string,
    initial: { readonly botConfig?: unknown; readonly kit?: readonly StartingKitPiece[] } = {},
  ): Promise<CharacterRecord> {
    const id = randomUUID();
    const kit = initial.kit ?? [];
    try {
      return await this.#db.transaction(async (tx) => {
        const [created] = await tx
          .insert(characters)
          .values({
            id, accountId, name,
            ...(initial.botConfig === undefined ? {} : { botConfig: initial.botConfig }),
          })
          .returning();
        if (created === undefined) throw new Error('failed to create character');
        // Id determinístico por posição no kit: a proveniência diz "a primeira peça do kit
        // deste personagem", e nunca há como o mesmo personagem ganhar o kit duas vezes. Sem
        // `ON CONFLICT`: duas peças no mesmo slot devem DERRUBAR a criação (índice único
        // `item_instance_one_per_slot`), não nascer pela metade em silêncio. Um retry do
        // `POST` esbarra antes no nome único, e é a resposta certa para ele.
        if (kit.length > 0) {
          await tx.insert(itemInstances).values(kit.map((piece, index) => ({
            id: `${id}:kit:${index + 1}`,
            itemId: piece.itemId,
            ownerCharacterId: id,
            origin: 'starting-kit',
            equippedSlot: piece.slot,
          })));
        }
        return toCharacter(created);
      });
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

  async getCharacterByName(name: string): Promise<CharacterRecord | null> {
    // A MESMA normalização do índice único (`character_name_unique`), e não `ilike`: um nome
    // já é único no jogo inteiro por essa regra, e duplicá-la aqui com outra comparação
    // arriscaria "José" e "jose" responderem personagens diferentes num lugar e o mesmo no
    // outro. `normalize(..., NFC)` casa com a forma canônica que a criação exige.
    const rows = await this.#db
      .select()
      .from(characters)
      .where(and(
        sql`lower(normalize(${characters.name}, NFC)) = lower(normalize(${name}, NFC))`,
        isNull(characters.deletedAt),
      ))
      .limit(1);
    return rows[0] === undefined ? null : toCharacter(rows[0]);
  }

  async addFriend(characterId: string, friendCharacterId: string): Promise<FriendRecord> {
    if (characterId === friendCharacterId) throw new CannotFriendSelfError();
    try {
      const [created] = await this.#db
        .insert(friends)
        .values({ id: randomUUID(), characterId, friendCharacterId })
        .returning();
      if (created === undefined) throw new Error('failed to create friend');
      return toFriend(created);
    } catch (error) {
      if (isUniqueViolation(error, 'friend_pair_unique')) throw new FriendAlreadyExistsError();
      throw error;
    }
  }

  async listFriends(characterId: string): Promise<readonly FriendView[]> {
    return this.#db
      .select({
        characterId: friends.friendCharacterId,
        name: characters.name,
        vocation: characters.vocation,
        level: characters.level,
        createdAt: friends.createdAt,
      })
      .from(friends)
      .innerJoin(characters, eq(characters.id, friends.friendCharacterId))
      // Amigo cujo personagem foi soft-deleted nunca aparece, mesmo com a linha `friend`
      // intacta — a limpeza da tabela é passiva (não há job de poda nesta versão).
      .where(and(eq(friends.characterId, characterId), isNull(characters.deletedAt)))
      .orderBy(asc(friends.createdAt));
  }

  async removeFriend(characterId: string, friendCharacterId: string): Promise<boolean> {
    const deleted = await this.#db
      .delete(friends)
      .where(and(
        eq(friends.characterId, characterId),
        eq(friends.friendCharacterId, friendCharacterId),
      ))
      .returning();
    return deleted.length > 0;
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

  async createItemInstance(instance: {
    itemId: string;
    ownerCharacterId: string;
    origin: string;
    quantity?: number;
  }): Promise<ItemInstanceRecord> {
    const [row] = await this.#db
      .insert(itemInstances)
      .values({
        id: randomUUID(),
        itemId: instance.itemId,
        ownerCharacterId: instance.ownerCharacterId,
        origin: instance.origin,
        ...(instance.quantity === undefined ? {} : { quantity: instance.quantity }),
      })
      .returning();
    return row as ItemInstanceRecord;
  }

  async listItemInstances(characterId: string): Promise<readonly ItemInstanceRecord[]> {
    return this.#db
      .select()
      .from(itemInstances)
      .where(eq(itemInstances.ownerCharacterId, characterId))
      // Ordem estável: sem ela, duas aberturas do inventário desenham a mesma coisa em ordens
      // diferentes, e o jogador vê os itens dançando sem ter mexido em nada.
      .orderBy(asc(itemInstances.createdAt), asc(itemInstances.id));
  }

  async applyEquipment(
    characterId: string, equipped: Readonly<Record<string, string>>,
  ): Promise<void> {
    const wanted = new Map(Object.entries(equipped).map(([slot, id]) => [id, slot]));
    await this.#db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: itemInstances.id, equippedSlot: itemInstances.equippedSlot })
        .from(itemInstances)
        .where(eq(itemInstances.ownerCharacterId, characterId));

      // DESEQUIPA PRIMEIRO, e a ordem é a razão de isto ser uma transação com dois passos em
      // vez de um `update` por linha: o índice único recusa duas peças no mesmo slot, e trocar
      // A por B esbarraria nele se B entrasse antes de A sair.
      for (const row of owned) {
        if (row.equippedSlot === null || wanted.get(row.id) === row.equippedSlot) continue;
        await tx.update(itemInstances)
          .set({ equippedSlot: null })
          .where(eq(itemInstances.id, row.id));
      }
      for (const row of owned) {
        const slot = wanted.get(row.id);
        if (slot === undefined || slot === row.equippedSlot) continue;
        await tx.update(itemInstances)
          .set({ equippedSlot: slot })
          .where(eq(itemInstances.id, row.id));
      }
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

/** O par `(character_id, friend_character_id)` já existia — duplo clique ou retry de rede. */
export class FriendAlreadyExistsError extends Error {
  constructor() {
    super('friend already added');
    this.name = 'FriendAlreadyExistsError';
  }
}

/** Um personagem não pode ser amigo de si mesmo (o CHECK `friend_not_self` também recusa). */
export class CannotFriendSelfError extends Error {
  constructor() {
    super('a character cannot friend itself');
    this.name = 'CannotFriendSelfError';
  }
}

function toFriend(row: typeof friends.$inferSelect): FriendRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    friendCharacterId: row.friendCharacterId,
    createdAt: row.createdAt,
  };
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
    botConfig: row.botConfig,
    skills: row.skills,
    outfitColors: row.outfitColors,
    bestiary: row.bestiary,
    ammo: row.ammo,
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
