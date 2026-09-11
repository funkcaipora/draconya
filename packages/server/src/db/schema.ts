// Schema do Postgres (Drizzle). Só o que a Fase 1 precisa; o resto entra por migração.
//
// Duas decisões de modelagem que evitam migração destrutiva depois (ADR 0012, §35.3):
//   - Coins vivem na CONTA; Premium vive no PERSONAGEM.
//   - `item_instance` terá identidade própria desde o primeiro item, porque lendário
//     negociável na Fase 2 exige proveniência estável.

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const accounts = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),

    // Identidade delegada ao provedor de autenticação (WorkOS). Nulável porque
    // uma conta pode existir antes de ter identidade externa vinculada.
    externalAuthId: text('external_auth_id'),

    // Nulável e sem uso hoje: a autenticação é do provedor externo. Existe para que
    // trazer a autenticação para casa seja uma migração aditiva, e não uma reescrita
    // do fluxo de conta com usuários reais dentro. Ver ADR 0012.
    passwordHash: text('password_hash'),

    coins: integer('coins').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueEmail: uniqueIndex('account_email_unique').on(t.email),
    uniqueExternalAuth: uniqueIndex('account_external_auth_unique').on(t.externalAuthId),
  }),
);

/**
 * A instância de um item — ESTE item, não "um item deste tipo" (FUN-76).
 *
 * `docs/technical-architecture.md` §9: sem identidade, lendário não tem proveniência. Um
 * inventário guardado como contador é barato até o dia em que alguém pergunta de onde veio
 * aquela espada — e nesse dia a resposta não existe para item nenhum, retroativamente.
 *
 * `itemId` aponta o CATÁLOGO, que é conteúdo. Sem chave estrangeira de propósito: o alvo não é
 * uma tabela, e espelhar o catálogo no banco criaria dois lugares para a mesma verdade.
 */
export const itemInstances = pgTable(
  'item_instance',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id').notNull(),
    ownerCharacterId: text('owner_character_id').notNull().references(() => characters.id),
    /** Item empilhável (munição) usa mais de 1. Quem diz qual empilha é o conteúdo. */
    quantity: integer('quantity').notNull().default(1),
    /** De onde veio (§25.3). É toda a proveniência de lendário que a arquitetura pede. */
    origin: text('origin').notNull(),
    /**
     * Em que slot está vestida, ou `null` para "na mochila" (FUN-82).
     *
     * Coluna na INSTÂNCIA, e não tabela à parte: o item está num lugar só. Uma tabela separada
     * permitiria a mesma instância aparecer equipada e na mochila ao mesmo tempo.
     */
    equippedSlot: text('equipped_slot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // O acesso real é "o que este personagem tem". Sem índice, abrir o inventário varre a
    // tabela inteira.
    index('item_instance_owner').on(table.ownerCharacterId),
    // Um slot, um item — imposto pelo BANCO, que é o que continua valendo quando alguém
    // escrever um caminho novo de escrita.
    uniqueIndex('item_instance_one_per_slot')
      .on(table.ownerCharacterId, table.equippedSlot)
      .where(sql`${table.equippedSlot} is not null`),
  ],
);

export const characters = pgTable(
  'character',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    name: text('name').notNull(),

    // Nulável de propósito: o personagem nasce sem vocação e escolhe no level 8 (§7.4).
    vocation: text('vocation'),

    level: integer('level').notNull().default(1),
    xp: bigint('xp', { mode: 'number' }).notNull().default(0),
    skills: jsonb('skills').notNull().default({}),

    gold: bigint('gold', { mode: 'number' }).notNull().default(0),
    capacity: integer('capacity').notNull().default(400),

    // Premium é POR PERSONAGEM, mesmo comprado com Coins da conta (§7.3).
    premiumUntil: timestamp('premium_until', { withTimezone: true }),

    // Stamina é função do tempo decorrido, não recurso decrementado por job (FUN-39).
    // Guarda-se o valor materializado e o instante em que ele valia.
    staminaMs: bigint('stamina_ms', { mode: 'number' }).notNull().default(86_400_000),
    staminaUpdatedAt: timestamp('stamina_updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * A configuração do bot (§13, FUN-81). Nulável — mas desde a FUN-114 o `api` grava a
     * padrão do conteúdo ao criar, então `null` é personagem anterior a isso, que entra na
     * hunt sem bot, como sempre entrou.
     *
     * A versão do vocabulário vai DENTRO do documento (`config.version`), não numa coluna ao
     * lado — um segundo lugar para a versão é um segundo lugar para ela divergir.
     */
    botConfig: jsonb('bot_config'),

    /**
     * As cores do outfit (FUN-104): `{ head, body, legs, feet }`, cada um um índice da paleta.
     * Nulável: personagem que nunca escolheu lê `null`, e o cliente o pinta com as cores de
     * personagem novo — que é o que ele já fazia com todo mundo.
     *
     * `jsonb` e não quatro colunas: as quatro só existem JUNTAS, e a forma é a do protocolo
     * (`OutfitColors`), não do banco. Quem valida é quem monta o ticket; aqui é só a linha.
     * Ninguém escreve ainda — a escolha (§7.4) é tela que não existe.
     */
    outfitColors: jsonb('outfit_colors'),

    /**
     * Abates por monstro, PERMANENTES (§18, FUN-113): `{ monsterId: kills }`. Nulável: quem
     * nunca abateu nada — ou foi gravado antes do Bestiário — lê `null`, o ticket sai sem o
     * campo e a sessão parte de `{}`, que é onde um personagem novo começa de qualquer jeito.
     *
     * `jsonb` e não uma tabela `(character_id, monster_id, kills)`: o dado é lido INTEIRO na
     * emissão do ticket e escrito INTEIRO na liquidação do extrato, nunca por monstro — a
     * mesma forma de `skills`, pela mesma razão. Quem escreve é só o ledger, fundindo pelo
     * MAIOR de cada monstro (`Bestiary.merge`) na transação do extrato; o `game` nunca toca.
     */
    bestiary: jsonb('bestiary'),

    state: text('state').notNull().default('city'),
    sessionId: text('session_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Soft delete preserva proveniência futura de itens lendários e ledger (FUN-11/ADR 0008).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // Nome de personagem é único sem diferenciar maiúsculas/minúsculas.
    uniqueName: uniqueIndex('character_name_unique')
      .on(sql`lower(normalize(${t.name}, NFC))`)
      .where(sql`${t.deletedAt} is null`),
    normalizedName: check('character_name_nfc', sql`${t.name} = normalize(${t.name}, NFC)`),
    byAccount: index('character_by_account').on(t.accountId),
  }),
);

// Ledger append-only. `UNIQUE (session_id, seq)` é o que garante que retry nunca
// duplica (invariante 10, ADR 0006) — e é também a trilha de auditoria do §40.
export const ledger = pgTable(
  'ledger',
  {
    id: text('id').primaryKey(),
    characterId: text('character_id').notNull().references(() => characters.id),
    sessionId: text('session_id').notNull(),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    delta: bigint('delta', { mode: 'number' }).notNull(),
    ref: jsonb('ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotency: uniqueIndex('ledger_session_seq_unique').on(t.sessionId, t.seq),
    byCharacter: index('ledger_by_character').on(t.characterId, t.createdAt),
  }),
);
