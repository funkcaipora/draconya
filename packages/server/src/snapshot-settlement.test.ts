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

  it('carries stamina, skills, bestiary, ammo, stock, vocation, equipment and the loot box of the OWNER', async () => {
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
          equipped: { hand: { instanceId: 's-old:2', itemId: 'sword', quantity: 1 } },
        },
        lootBox: [{ instanceId: 's-old:3', itemId: 'dragon-hide', quantity: 1 }],
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
    // Nasceu NESTA sessão (prefixo `s-old:`) — vira item a inserir, não só posição.
    expect(receipt?.acquired).toEqual([
      { instanceId: 's-old:1', itemId: 'gold-coin', quantity: 50 },
      { instanceId: 's-old:2', itemId: 'sword', quantity: 1 },
    ]);
    expect(receipt?.lootBox).toEqual([{ instanceId: 's-old:3', itemId: 'dragon-hide', quantity: 1 }]);
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
    expect(receipt).not.toHaveProperty('lootBox');
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
