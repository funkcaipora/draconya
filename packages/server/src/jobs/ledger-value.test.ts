import { describe, expect, it } from 'vitest';
import type { SessionReceipt } from '../receipts.js';
import { movesValue } from './ledger.js';

// O que é "valor movido" (#838, OW-17, ADR 0060 d.10.d): o extrato que o `jobs` aplica SEM linha de
// ledger é o que não tem nenhum destes. A definição é a da issue — XP, gold ganho e gasto, abates e
// mortes iguais a zero, `acquired` e `removedInstances` vazios — e uma coluna a mais nela (ou a menos)
// muda o que o ledger registra, então cada uma tem o seu caso.

const EMPTY = {
  durationMs: 60_000, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0,
  itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0, damageDealt: 0, healingDone: 0,
};

const receiptOf = (overrides: Partial<SessionReceipt> = {}): SessionReceipt => ({
  sessionId: 's', characterId: 'c', accountId: 'a', reason: 'drain', seq: 1, durableVersion: 1,
  aggregates: EMPTY, notableEvents: [], endedAtMs: 0,
  ...overrides,
});

describe('movesValue', () => {
  it('um extrato de posição, vitais e estado absoluto não move valor', () => {
    expect(movesValue(receiptOf())).toBe(false);
    expect(movesValue(receiptOf({
      worldPosition: { x: 32369, y: 32241, z: 7 }, townId: 'thais', health: 10, mana: 3, conditions: [],
      soul: 5, ammo: { arrow: 'plain-arrow' }, supplyStock: { 'health-potion': 3 }, storages: { 'quest:a': 1 },
      equipment: {}, layout: {}, overlays: {}, vocation: 'knight', promoted: true,
    }))).toBe(false);
  });

  it('o que o ledger não conta como valor: duração, golpes, itens vistos e supplies usados', () => {
    // `itemsLooted` e `suppliesUsed` são contagens de apresentação; o valor que eles carregam já
    // entra por `acquired` e por `goldSpent` (o gold sai no uso).
    expect(movesValue(receiptOf({
      aggregates: { ...EMPTY, durationMs: 9_999_999, bestBasicHit: 40, bestSpellHit: 90, damageDealt: 500, healingDone: 80 },
    }))).toBe(false);
    expect(movesValue(receiptOf({ aggregates: { ...EMPTY, itemsLooted: 3, suppliesUsed: 2 } }))).toBe(false);
  });

  it('listas vazias não são valor', () => {
    expect(movesValue(receiptOf({ acquired: [], removedInstances: [] }))).toBe(false);
  });

  it.each([
    ['XP ganha', { xpGained: 10 }],
    ['XP perdida (a penalidade de morte entra como negativo)', { xpGained: -10 }],
    ['gold ganho', { goldGained: 1 }],
    ['gold gasto', { goldSpent: 1 }],
    ['um abate', { kills: 1 }],
    ['uma morte', { deaths: 1 }],
  ])('%s é valor', (_, aggregates) => {
    expect(movesValue(receiptOf({ aggregates: { ...EMPTY, ...aggregates } }))).toBe(true);
  });

  it('gold ganho e gasto que se anulam continuam sendo valor — o ledger tem o que registrar', () => {
    expect(movesValue(receiptOf({ aggregates: { ...EMPTY, goldGained: 50, goldSpent: 50 } }))).toBe(true);
  });

  it('um item que nasceu, ou que morreu, é valor', () => {
    expect(movesValue(receiptOf({ acquired: [{ instanceId: 's:0', itemId: 'spike-sword', quantity: 1 }] }))).toBe(true);
    expect(movesValue(receiptOf({ removedInstances: ['s:0'] }))).toBe(true);
  });
});
