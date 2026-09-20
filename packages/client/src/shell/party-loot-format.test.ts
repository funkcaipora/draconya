import { describe, expect, it } from 'vitest';
import type { PartyBagView, PartyView } from '../state/hud.js';
import {
  autoSellEnabledFor, reservedCapacityOf, shareCostsOf, splitLootOf,
  xpBonusLabel, xpMultiplierLabel,
} from './party-loot-format.js';

// As contas puras da party v2 (#405): a reserva (com o zero que não divide), a regra
// "VENDER implica PEGAR" e os rótulos de XP. Sem DOM, sem store.

const bag = (over: Partial<PartyBagView>): PartyBagView => ({
  gold: 0, items: [], weight: 0, capacity: 0, ...over,
});

describe('reservedCapacityOf (#405, §11-§13)', () => {
  it('devolve a entrada do personagem, com o percentual arredondado', () => {
    const view = bag({
      reservations: [
        { characterId: 'other', reserved: 10, available: 100 },
        { characterId: 'me', reserved: 30, available: 200 },
      ],
    });
    expect(reservedCapacityOf(view, 'me')).toEqual({ reserved: 30, available: 200, percent: 15 });
  });

  it('devolve `null` sem a entrada do personagem — nunca zero fabricado (D8)', () => {
    const view = bag({ reservations: [{ characterId: 'other', reserved: 10, available: 100 }] });
    expect(reservedCapacityOf(view, 'me')).toBeNull();
  });

  it('devolve `null` sem `reservations` (nó anterior ao #400)', () => {
    expect(reservedCapacityOf(bag({}), 'me')).toBeNull();
  });

  it('`available: 0` devolve `percent: null` em vez de dividir por zero', () => {
    const view = bag({ reservations: [{ characterId: 'me', reserved: 0, available: 0 }] });
    expect(reservedCapacityOf(view, 'me')).toEqual({ reserved: 0, available: 0, percent: null });
  });
});

describe('autoSellEnabledFor (#405, D2)', () => {
  it('`collect: null` (coleta tudo) vale para qualquer item', () => {
    expect(autoSellEnabledFor('cheese', null)).toBe(true);
  });

  it('item fora de PEGAR não pode ser vendido', () => {
    expect(autoSellEnabledFor('cheese', ['gold-coin'])).toBe(false);
    expect(autoSellEnabledFor('cheese', ['cheese'])).toBe(true);
  });
});

describe('shareCostsOf / splitLootOf (#405, D1)', () => {
  const view = (over: Partial<PartyView>): PartyView => ({
    leaderId: 'lead', mode: 'split', members: [], ...over,
  });

  it('lê os campos v2 quando presentes', () => {
    expect(shareCostsOf(view({ mode: 'split', shareCosts: true }))).toBe(true);
    expect(splitLootOf(view({ mode: 'shared', splitLoot: false }))).toBe(false);
  });

  it('cai para `mode` quando o campo v2 está ausente (nó anterior)', () => {
    expect(shareCostsOf(view({ mode: 'shared' }))).toBe(true);
    expect(shareCostsOf(view({ mode: 'split' }))).toBe(false);
    expect(splitLootOf(view({ mode: 'shared' }))).toBe(true);
    expect(splitLootOf(view({ mode: 'split' }))).toBe(false);
  });
});

describe('rótulos de XP (#405, §32)', () => {
  it('bônus é a diferença sobre a base solo de 100 %', () => {
    expect(xpBonusLabel(200)).toBe('+100%');
    expect(xpBonusLabel(125)).toBe('+25%');
  });

  it('multiplicador é o pool dividido por 100, em pt-BR', () => {
    expect(xpMultiplierLabel(200)).toBe('2x');
    expect(xpMultiplierLabel(175)).toBe('1,75x');
  });
});
