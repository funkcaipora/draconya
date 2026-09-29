// `settleStaleSnapshot` (#527, ADR 0010) — a metade de `pnpm dev:dragon-party --reset` que
// liquida o snapshot resumível de um personagem em vez de apagá-lo às cegas. Testável com
// fakes: a orquestração HTTP (`DragonPartyApi`) já não tem teste de integração aqui (ver o
// cabeçalho de `dragon-party-runner.ts`) por exigir o `api` de pé, mas o par snapshot/extrato é
// Redis-only e não precisa de nenhum processo — `settleSnapshotAsReceipt`
// (`packages/server/src/snapshot-settlement.test.ts`) já prova a MONTAGEM do extrato; isto
// prova a ORQUESTRAÇÃO: carrega, liquida, apaga — e nunca apaga se a liquidação falhar.

import type { ReceiptStore, SessionReceipt } from '@draconya/server';
import type { SnapshotStore, StoredSnapshot } from '@draconya/server';
import type { SessionSnapshot } from '@draconya/sim';
import { describe, expect, it } from 'vitest';
import { settleStaleSnapshot } from './dragon-party-runner.js';

const snapshot: SessionSnapshot = {
  formatVersion: 1, contentVersion: 'v-test', id: 's-old', type: 'hunt', createdAtMs: 0,
  logicalNowMs: 12_345, schedule: { events: [], nextEventId: 1 } as never, rng: { seed: 1 } as never,
  participants: [{
    id: 'draco-knight', position: { x: 0, y: 0, z: 7 }, health: 100, maxHealth: 100, mana: 0, maxMana: 0,
    level: 200, xp: 0, goldDelta: 500, alive: true, cooldowns: {},
  }],
  aggregates: {
    durationMs: 2_800_000, xpGained: 900_000, goldGained: 12_000, goldSpent: 2_000, kills: 40, deaths: 0,
    itemsLooted: 12, suppliesUsed: 30, bestBasicHit: 0, bestSpellHit: 0, damageDealt: 0, healingDone: 0,
  },
  notableEvents: [],
  ledgerSeq: 7,
  endedReason: null,
};

function fakeStores(over: { stored?: StoredSnapshot | null } = {}) {
  const removed: string[] = [];
  const saved: Array<Omit<SessionReceipt, 'endedAtMs'>> = [];
  const snapshots = {
    load: async () => (over.stored === undefined
      ? { characterId: 'draco-knight', accountId: 'acc-knight', nodeId: 'n1', savedAtMs: 0, snapshot }
      : over.stored),
    remove: async (characterId: string) => { removed.push(characterId); },
  } as unknown as SnapshotStore;
  const receipts = {
    save: async (receipt: Omit<SessionReceipt, 'endedAtMs'>) => { saved.push(receipt); },
  } as unknown as ReceiptStore;
  return { snapshots, receipts, removed, saved };
}

describe('settleStaleSnapshot (#527)', () => {
  it('credits the pending snapshot as a receipt and removes it — never a blind DEL', async () => {
    const { snapshots, receipts, removed, saved } = fakeStores();
    const result = await settleStaleSnapshot('draco-knight', { snapshots, receipts });
    expect(result).toEqual({ settled: true, sessionId: 's-old' });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      sessionId: 's-old', characterId: 'draco-knight', accountId: 'acc-knight', reason: 'drain', seq: 8,
    });
    // A remoção só acontece DEPOIS do crédito ter sido confirmado, na mesma ordem que o `game`
    // usa em `#resume` — nunca a receita inversa, que perderia o crédito numa queda no meio.
    expect(removed).toEqual(['draco-knight']);
  });

  it('does nothing, settling nothing, when there is no snapshot pending — the common case', async () => {
    const { snapshots, receipts, removed, saved } = fakeStores({ stored: null });
    const result = await settleStaleSnapshot('draco-paladin', { snapshots, receipts });
    expect(result).toEqual({ settled: false });
    expect(saved).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('keeps the snapshot in place when crediting fails, so the next --reset can retry', async () => {
    const snapshots = {
      load: async () => ({ characterId: 'draco-sorcerer', accountId: 'acc-sorcerer', nodeId: 'n1', savedAtMs: 0, snapshot }),
      remove: async () => { throw new Error('should never be called'); },
    } as unknown as SnapshotStore;
    const receipts = {
      save: async () => { throw new Error('redis unreachable'); },
    } as unknown as ReceiptStore;
    await expect(settleStaleSnapshot('draco-sorcerer', { snapshots, receipts })).rejects.toThrow('redis unreachable');
  });
});
