// Schema do Postgres (Drizzle). Só o que a Fase 1 precisa; o resto entra por migração.
//
// Duas decisões de modelagem que evitam migração destrutiva depois (ADR 0012, §35.3):
//   - Coins vivem na CONTA; Premium vive no PERSONAGEM.
//   - `item_instance` terá identidade própria desde o primeiro item, porque lendário
//     negociável na Fase 2 exige proveniência estável.

import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const contas = pgTable(
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
    senhaHash: text('senha_hash'),

    coins: integer('coins').notNull().default(0),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnico: uniqueIndex('account_email_unico').on(t.email),
    authExternoUnico: uniqueIndex('account_external_auth_unico').on(t.externalAuthId),
  }),
);

export const personagens = pgTable(
  'character',
  {
    id: text('id').primaryKey(),
    contaId: text('account_id').notNull().references(() => contas.id),
    nome: text('nome').notNull(),

    // Nulável de propósito: o personagem nasce sem vocação e escolhe no level 8 (§7.4).
    vocacao: text('vocacao'),

    level: integer('level').notNull().default(1),
    xp: bigint('xp', { mode: 'number' }).notNull().default(0),
    skills: jsonb('skills').notNull().default({}),

    gold: bigint('gold', { mode: 'number' }).notNull().default(0),
    capacidade: integer('capacidade').notNull().default(400),

    // Premium é POR PERSONAGEM, mesmo comprado com Coins da conta (§7.3).
    premiumAte: timestamp('premium_ate', { withTimezone: true }),

    // Stamina é função do tempo decorrido, não recurso decrementado por job (FUN-39).
    // Guarda-se o valor materializado e o instante em que ele valia.
    staminaMs: bigint('stamina_ms', { mode: 'number' }).notNull().default(86_400_000),
    staminaAtualizadaEm: timestamp('stamina_atualizada_em', { withTimezone: true }).notNull().defaultNow(),

    estado: text('estado').notNull().default('cidade'),
    sessaoId: text('sessao_id'),

    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nomeUnico: uniqueIndex('character_nome_unico').on(t.nome),
    porConta: index('character_por_conta').on(t.contaId),
  }),
);

// Ledger append-only. `UNIQUE (session_id, seq)` é o que garante que retry nunca
// duplica (invariante 10, ADR 0006) — e é também a trilha de auditoria do §40.
export const ledger = pgTable(
  'ledger',
  {
    id: text('id').primaryKey(),
    personagemId: text('character_id').notNull().references(() => personagens.id),
    sessaoId: text('session_id').notNull(),
    seq: integer('seq').notNull(),
    tipo: text('tipo').notNull(),
    delta: bigint('delta', { mode: 'number' }).notNull(),
    ref: jsonb('ref'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencia: uniqueIndex('ledger_sessao_seq_unico').on(t.sessaoId, t.seq),
    porPersonagem: index('ledger_por_personagem').on(t.personagemId, t.criadoEm),
  }),
);
