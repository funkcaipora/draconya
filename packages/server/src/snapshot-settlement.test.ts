// A liquidação de um snapshot de sessão como extrato (#527), fora do `game` — a mesma conta
// que `SessionHost#creditUnrestorable` faz, só que utilizável por quem não tem o resto do
// runtime de jogo (`/api/party/:id/start`, `pnpm dev:dragon-party --reset`).

import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '@draconya/sim';
import type { ReceiptStore, SessionReceipt } from './receipts.js';
import { settleSnapshotAsReceipt } from './snapshot-settlement.js';

function fakeReceipts(): { receipts: ReceiptStore; saved: Array<Omit<SessionReceipt, 'endedAtMs'>> } {
  const saved: Array<Omit<SessionReceipt, 'endedAtMs'>> = [];
  const receipts = {
    save: async (receipt: Omit<SessionReceipt, 'endedAtMs'>) => { saved.push(receipt); },
  } as unknown as ReceiptStore;
  return { receipts, saved };
}

const baseSnapshot: SessionSnapshot = {
  formatVersion: 1, contentVersion: 'v-test', id: 's-old', type: 'hunt', createdAtMs: 0,
  logicalNowMs: 12_345, schedule: { events: [], nextEventId: 1 } as never,
  rng: { seed: 1 } as never,
  participants: [{
    id: 'a', position: { x: 0, y: 0, z: 7 }, health: 80, maxHealth: 100, mana: 10, maxMana: 20,
    level: 12, xp: 5_000, goldDelta: 20, alive: true, cooldowns: {},
  }],
  aggregates: {
    durationMs: 60_000, xpGained: 800, goldGained: 30, goldSpent: 10, kills: 4, deaths: 0,
    itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0, damageDealt: 0, healingDone: 0,
  },
  notableEvents: [],
  ledgerSeq: 3,
  endedReason: null,
};

describe('settleSnapshotAsReceipt (#527)', () => {
  it('credits the aggregates and the ledgerSeq + 1, idempotent with the normal end-of-session path', async () => {
    const { receipts, saved } = fakeReceipts();
    await settleSnapshotAsReceipt(baseSnapshot, { characterId: 'a', accountId: 'acc-a', receipts });
    expect(saved).toEqual([{
      sessionId: 's-old', characterId: 'a', accountId: 'acc-a', reason: 'drain', seq: 4,
      aggregates: baseSnapshot.aggregates, notableEvents: [],
      // O dono existe e o snapshot é anterior ao estoque: `{}` é "sem estoque", nunca a chave
      // omitida — omitida deixaria o valor antigo da coluna ressuscitar (#520).
      supplyStock: {}, ammunitionStock: {},
      // E anterior aos storages (#731): `{}` pela mesma razão.
      storages: {},
      // Comida ativa (#726): mesma regra acima — `0` é "sem comida", nunca a chave omitida.
      fedMs: 0,
      // As bênçãos (#570): mesma regra — `0` é "nenhuma", nunca a chave omitida.
      blessings: 0,
      // A postura de luta (#550): o snapshot omite o default, e `attack` é GRAVADO — nunca a chave
      // omitida, ou a postura antiga do Postgres ressuscitaria no próximo login.
      fightMode: 'attack',
    }]);
  });

  it("credits the PARTICIPANT's own aggregates, not the session sum, when both exist (#187)", async () => {
    const { receipts, saved } = fakeReceipts();
    const snapshot: SessionSnapshot = {
      ...baseSnapshot,
      aggregatesByCharacter: {
        a: {
          durationMs: 60_000, xpGained: 500, goldGained: 10, goldSpent: 0, kills: 2, deaths: 0,
          itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0, damageDealt: 0, healingDone: 0,
        },
      },
    };
    await settleSnapshotAsReceipt(snapshot, { characterId: 'a', accountId: 'acc-a', receipts });
    expect(saved[0]?.aggregates).toEqual(snapshot.aggregatesByCharacter?.['a']);
  });

  it('carries stamina, skills, bestiary, ammo, stock, vocation and equipment of the OWNER', async () => {
    const imbued = { imbuements: [{ slot: 0, typeId: 'strike-basic', remainingMs: 1000 }] };
    const { receipts, saved } = fakeReceipts();
    const snapshot: SessionSnapshot = {
      ...baseSnapshot,
      participants: [{
        ...baseSnapshot.participants[0]!,
        staminaMs: 3_000_000, staminaUpdatedAtMs: 999,
        skills: { melee: { level: 15, points: 200 } },
        bestiary: { dragon: 12 },
        ammo: { arrow: 'sniper-arrow' },
        supplyStock: { 'health-potion': 4 },
        ammunitionStock: { 'sniper-arrow': 10 },
        vocationId: 'knight',
        inventory: {
          backpack: [{ instanceId: 's-old:1', itemId: 'gold-coin', quantity: 50 }],
          equipped: { hand: { instanceId: 's-old:2', itemId: 'sword', quantity: 1, overlay: imbued } },
        },
      }],
    };
    await settleSnapshotAsReceipt(snapshot, { characterId: 'a', accountId: 'acc-a', receipts });
    const receipt = saved[0];
    expect(receipt?.staminaMs).toBe(3_000_000);
    expect(receipt?.staminaUpdatedAtMs).toBe(999);
    expect(receipt?.skills).toEqual({ melee: { level: 15, points: 200 } });
    expect(receipt?.bestiary).toEqual({ dragon: 12 });
    expect(receipt?.ammo).toEqual({ arrow: 'sniper-arrow' });
    expect(receipt?.supplyStock).toEqual({ 'health-potion': 4 });
    expect(receipt?.ammunitionStock).toEqual({ 'sniper-arrow': 10 });
    expect(receipt?.vocation).toBe('knight');
    expect(receipt?.equipment).toEqual({ hand: 's-old:2' });
    expect(receipt?.layout).toEqual({ 's-old:1': { container: 'backpack', index: 0 } });
    // O overlay por instância (#604): containers E corpo; `null` é a instância sem overlay.
    expect(receipt?.overlays).toEqual({ 's-old:1': null, 's-old:2': imbued });
    // Nasceu NESTA sessão (prefixo `s-old:`) — vira item a inserir, não só posição.
    expect(receipt?.acquired).toEqual([
      { instanceId: 's-old:1', itemId: 'gold-coin', quantity: 50 },
      { instanceId: 's-old:2', itemId: 'sword', quantity: 1, overlay: imbued },
    ]);
  });

  it('carries the Bosstiary of the OWNER (#629), and a snapshot without one omits the key', async () => {
    // Monotônico como o Bestiário (o ledger funde pelo maior): sem ele aqui, o abate de boss de uma
    // sessão irrestaurável sumia junto com o snapshot.
    const { receipts, saved } = fakeReceipts();
    const bosstiary = { kills: { '639': 3 }, points: 40, version: 1 };
    const snapshot: SessionSnapshot = {
      ...baseSnapshot,
      participants: [{ ...baseSnapshot.participants[0]!, bosstiary }],
    };
    await settleSnapshotAsReceipt(snapshot, { characterId: 'a', accountId: 'acc-a', receipts });
    expect(saved[0]?.bosstiary).toEqual(bosstiary);

    await settleSnapshotAsReceipt(baseSnapshot, { characterId: 'a', accountId: 'acc-a', receipts });
    expect(saved[1]).not.toHaveProperty('bosstiary');
  });

  it('carries the posture of the OWNER (#550), and a snapshot without one is the Canary offensive default', async () => {
    const { receipts, saved } = fakeReceipts();
    const snapshot: SessionSnapshot = {
      ...baseSnapshot,
      participants: [{ ...baseSnapshot.participants[0]!, fightMode: 'defense' }],
    };
    await settleSnapshotAsReceipt(snapshot, { characterId: 'a', accountId: 'acc-a', receipts });
    expect(saved[0]?.fightMode).toBe('defense');

    // `getState` omite o default: o snapshot de quem nunca trocou de postura NÃO tem a chave, e o
    // extrato grava `attack` mesmo assim — omitir deixaria uma postura antiga do Postgres voltar.
    const { receipts: other, saved: otherSaved } = fakeReceipts();
    await settleSnapshotAsReceipt(baseSnapshot, { characterId: 'a', accountId: 'acc-a', receipts: other });
    expect(otherSaved[0]?.fightMode).toBe('attack');
  });

  it('carries the learned spells of the OWNER (#624), so a `learn-spell` accepted before the crash is not lost', async () => {
    const { receipts, saved } = fakeReceipts();
    const learnedSpells = { spellIds: ['berserk', 'wound-cleansing'], version: 1 };
    const snapshot: SessionSnapshot = {
      ...baseSnapshot,
      participants: [{ ...baseSnapshot.participants[0]!, learnedSpells }],
    };
    await settleSnapshotAsReceipt(snapshot, { characterId: 'a', accountId: 'acc-a', receipts });
    expect(saved[0]?.learnedSpells).toEqual(learnedSpells);

    // Snapshot anterior à issue: sem a chave no dono, e o extrato NÃO inventa um registro vazio —
    // o ledger não toca na coluna, e as magias do Postgres (migração 0024) continuam valendo.
    const { receipts: legacy, saved: legacySaved } = fakeReceipts();
    await settleSnapshotAsReceipt(baseSnapshot, { characterId: 'a', accountId: 'acc-a', receipts: legacy });
    expect(legacySaved[0]).not.toHaveProperty('learnedSpells');
  });

  it('omits every optional field when the participant record has none of them', async () => {
    const { receipts, saved } = fakeReceipts();
    await settleSnapshotAsReceipt(baseSnapshot, { characterId: 'a', accountId: 'acc-a', receipts });
    const receipt = saved[0];
    expect(receipt).not.toHaveProperty('staminaMs');
    expect(receipt).not.toHaveProperty('skills');
    expect(receipt).not.toHaveProperty('bestiary');
    expect(receipt).not.toHaveProperty('ammo');
    expect(receipt).not.toHaveProperty('vocation');
    expect(receipt).not.toHaveProperty('equipment');
  });

  it('rejects when the character never participated in that session, leaving no receipt saved', async () => {
    const { receipts, saved } = fakeReceipts();
    await settleSnapshotAsReceipt(baseSnapshot, { characterId: 'ghost', accountId: 'acc-x', receipts });
    // Ninguém achado: os campos opcionais do dono simplesmente ficam ausentes — a MESMA
    // degradação de um `CharacterState` sem eles, nunca uma recusa.
    expect(saved).toEqual([{
      sessionId: 's-old', characterId: 'ghost', accountId: 'acc-x', reason: 'drain', seq: 4,
      aggregates: baseSnapshot.aggregates, notableEvents: [],
    }]);
  });

  it('propagates a failed save instead of swallowing it, so the caller keeps the snapshot for retry', async () => {
    const receipts = {
      save: async () => { throw new Error('redis down'); },
    } as unknown as ReceiptStore;
    await expect(
      settleSnapshotAsReceipt(baseSnapshot, { characterId: 'a', accountId: 'acc-a', receipts }),
    ).rejects.toThrow('redis down');
  });
});
