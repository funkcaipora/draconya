import { Conditions } from '@draconya/sim';
import type { ConditionState } from '@draconya/sim';
import { describe, expect, it } from 'vitest';
import {
  absolutePointOfAnchor, carryRestoredConditions, readAbsolutePoint, readPersistedConditions,
  readReceiptWorldState, readTicketWorldState, readVital, receiptWorldStateOf, worldStateOfRow,
} from './world-state.js';

const TEMPLE = { x: 32369, y: 32241, z: 7 };

const poison: ConditionState = {
  key: 'poison', expiresAtMs: 4_000, nextTickAtMs: 1_000,
  tick: { amount: 3, intervalMs: 1_000, kind: 'damage', damageType: 'earth', queue: [{ amount: 2, intervalMs: 1_000 }] },
};
const haste: ConditionState = { key: 'haste', expiresAtMs: 9_500, speedPercent: 30, merge: 'refresh' };

describe('a coordenada absoluta do Tibia (#836, OW-15)', () => {
  it('aceita inteiros dentro do mapa, em qualquer um dos 16 andares', () => {
    expect(readAbsolutePoint(TEMPLE)).toEqual(TEMPLE);
    expect(readAbsolutePoint({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(readAbsolutePoint({ x: 65_535, y: 65_535, z: 15 })).toEqual({ x: 65_535, y: 65_535, z: 15 });
  });

  it('recusa o que não é uma coordenada: fora do mapa, fracionária, pela metade, ou de outro tipo', () => {
    for (const bad of [
      null, undefined, 'x', [], { x: 1, y: 2 }, { x: -1, y: 2, z: 7 }, { x: 65_536, y: 2, z: 7 },
      { x: 1.5, y: 2, z: 7 }, { x: 1, y: 2, z: 16 }, { x: 1, y: 2, z: -1 }, { x: '1', y: 2, z: 7 },
      { x: Number.NaN, y: 2, z: 7 },
    ]) {
      expect(readAbsolutePoint(bad)).toBeUndefined();
    }
  });

  it('a âncora do `sim` vira a coordenada, ou `null` — o `0,0,0` do Canary nunca é um lugar', () => {
    expect(absolutePointOfAnchor(TEMPLE)).toEqual(TEMPLE);
    // `null` no `sim` é "nunca esteve no mundo": o templo.
    expect(absolutePointOfAnchor(null)).toBeNull();
    // O `0,0,0` do Canary (`iologindata_load_player.cpp:207-210`) é "sem posição", não o canto do mapa.
    expect(absolutePointOfAnchor({ x: 0, y: 0, z: 0 })).toBeNull();
    // Uma âncora fora do mapa não vira linha: o `jobs` a gravaria numa coluna que o CHECK aceita.
    expect(absolutePointOfAnchor({ x: 70_000, y: 1, z: 7 })).toBeNull();
  });
});

describe('vida e mana como número de linha (#836, OW-15)', () => {
  it('é um inteiro seguro não negativo, ou nada', () => {
    expect(readVital(10)).toBe(10);
    expect(readVital(0)).toBe(0);
    for (const bad of [-1, 1.5, Number.NaN, Infinity, '10', null, undefined, 2 ** 60]) {
      expect(readVital(bad)).toBeUndefined();
    }
  });
});

describe('as condições persistidas (#836, OW-15)', () => {
  it('aceita a lista como o `sim` a escreve, inclusive a vazia, sem descartar campo nenhum', () => {
    expect(readPersistedConditions([poison, haste])).toEqual([poison, haste]);
    expect(readPersistedConditions([])).toEqual([]);
    // Um campo que esta leitura não conhece passa: o formato do `sim` cresce.
    const future = { key: 'novel', expiresAtMs: 1, newField: { deep: [1, 2] } };
    expect(readPersistedConditions([future])).toEqual([future]);
  });

  it('aceita o próximo tique que já vencia no instante da saída (restante zero ou negativo)', () => {
    expect(readPersistedConditions([{ ...poison, nextTickAtMs: 0 }])).toHaveLength(1);
    expect(readPersistedConditions([{ ...poison, nextTickAtMs: -40 }])).toHaveLength(1);
  });

  it('recusa a lista INTEIRA se uma condição vem torta — uma lista pela metade é um personagem com a haste e sem o veneno', () => {
    const torts: unknown[] = [
      { key: '', expiresAtMs: 1 },
      { key: 'x' },
      { key: 'x', expiresAtMs: 0 },
      { key: 'x', expiresAtMs: -5 },
      { key: 'x', expiresAtMs: Number.NaN },
      { key: 'x', expiresAtMs: Infinity },
      { key: 'x', expiresAtMs: 5, nextTickAtMs: 'cedo' },
      { key: 'x', expiresAtMs: 5, merge: 'sum' },
      { key: 'x', expiresAtMs: 5, speedPercent: Number.NaN },
      { key: 'x', expiresAtMs: 5, damageDealtPercent: { melee: 'muito' } },
      { key: 'x', expiresAtMs: 5, skillDeltas: [1] },
      { key: 'x', expiresAtMs: 5, look: 'sapo' },
      { key: 'x', expiresAtMs: 5, sourceId: 7 },
      { key: 'x', expiresAtMs: 5, tick: { amount: 1, intervalMs: 0 } },
      { key: 'x', expiresAtMs: 5, tick: { amount: 1, intervalMs: 1_000, kind: 'burn' } },
      { key: 'x', expiresAtMs: 5, tick: { amount: 1, intervalMs: 1_000, queue: [{ amount: 1 }] } },
      'poison', 42, null, [],
    ];
    for (const tort of torts) {
      expect(readPersistedConditions([haste, tort]), JSON.stringify(tort)).toBeUndefined();
    }
  });

  it('recusa o que não é uma lista, e a lista que passa do teto', () => {
    for (const bad of [null, undefined, 'poison', {}, 7]) expect(readPersistedConditions(bad)).toBeUndefined();
    expect(readPersistedConditions(Array.from({ length: 65 }, (_, i) => ({ key: `k${i}`, expiresAtMs: 1 }))))
      .toBeUndefined();
    expect(readPersistedConditions(Array.from({ length: 64 }, (_, i) => ({ key: `k${i}`, expiresAtMs: 1 }))))
      .toHaveLength(64);
  });
});

describe('o mundo e os vitais no ticket (#836, OW-15)', () => {
  it('leva cada campo válido, e só ele', () => {
    expect(readTicketWorldState({
      worldPosition: TEMPLE, townId: 'thais', health: 10, mana: 0, conditions: [haste],
    })).toEqual({ worldPosition: TEMPLE, townId: 'thais', health: 10, mana: 0, conditions: [haste] });
    expect(readTicketWorldState({})).toEqual({});
  });

  it('torto vira ausente CAMPO a CAMPO: um campo ruim não derruba os outros', () => {
    const read = readTicketWorldState({
      worldPosition: { x: 1, y: 2 }, townId: '', health: -3, mana: 7, conditions: [{ key: 'x' }],
    });
    expect(read).toEqual({ mana: 7 });
  });

  it('uma vida zero é um morto, e o morto entra cheio: o campo some; a posição `null` não existe no ticket', () => {
    expect(readTicketWorldState({ health: 0, mana: 0 })).toEqual({ mana: 0 });
    expect(readTicketWorldState({ worldPosition: null })).toEqual({});
  });
});

describe('o mundo e os vitais no extrato (#836, OW-15)', () => {
  it('a posição `null` é EXPLÍCITA e quer dizer "volta ao templo"; a ausente é "não toque"', () => {
    expect(readReceiptWorldState({ worldPosition: null })).toEqual({ worldPosition: null });
    expect(readReceiptWorldState({})).not.toHaveProperty('worldPosition');
    // Torta não vira `null`: apagaria uma posição boa por causa de um valor ruim.
    expect(readReceiptWorldState({ worldPosition: { x: 1 } })).not.toHaveProperty('worldPosition');
  });

  it('`conditions: []` é "nenhuma" e passa; vida e mana aceitam zero', () => {
    expect(readReceiptWorldState({ conditions: [], health: 0, mana: 0 })).toEqual({
      conditions: [], health: 0, mana: 0,
    });
  });
});

describe('a linha de `characters` no ticket (#836, OW-15)', () => {
  const row = { worldPosition: null, townId: 'thais', health: null, mana: null, conditions: null };

  it('um personagem que nunca saiu do mundo leva só a cidade: cheio, no templo, sem condição', () => {
    expect(worldStateOfRow(row)).toEqual({ townId: 'thais' });
  });

  it('leva o que a linha guarda', () => {
    expect(worldStateOfRow({
      worldPosition: TEMPLE, townId: 'thais', health: 10, mana: 4, conditions: [poison],
    })).toEqual({ worldPosition: TEMPLE, townId: 'thais', health: 10, mana: 4, conditions: [poison] });
  });

  it('vida zero, condições vazias ou tortas não viram campo', () => {
    expect(worldStateOfRow({ ...row, health: 0 })).toEqual({ townId: 'thais' });
    expect(worldStateOfRow({ ...row, conditions: [] })).toEqual({ townId: 'thais' });
    expect(worldStateOfRow({ ...row, conditions: [{ key: 'x' }] })).toEqual({ townId: 'thais' });
    expect(worldStateOfRow({ ...row, conditions: 'poison' })).toEqual({ townId: 'thais' });
  });
});

describe('o que o extrato leva do dono (#836, OW-15, ADR 0060 d.10.f)', () => {
  const alive = { alive: true, health: 10, maxHealth: 100, mana: 3, maxMana: 40 };

  it('leva a âncora, a cidade, a vida, a mana e as condições de quem está vivo', () => {
    expect(receiptWorldStateOf({ ...alive, townId: 'thais', worldPosition: TEMPLE }, [haste])).toEqual({
      worldPosition: TEMPLE, townId: 'thais', health: 10, mana: 3, conditions: [haste],
    });
  });

  it('quem nunca esteve no mundo leva a posição `null` — "volta ao templo" —, e não a ausência', () => {
    expect(receiptWorldStateOf({ ...alive, townId: 'thais', worldPosition: null }, [])).toMatchObject({
      worldPosition: null, conditions: [],
    });
    expect(receiptWorldStateOf({ ...alive, townId: 'thais' }, [])).toMatchObject({ worldPosition: null });
  });

  it('quem morreu volta ao templo de vida e mana cheias, sem condição (`player.cpp:4226-4252`)', () => {
    expect(receiptWorldStateOf(
      { alive: false, health: 0, maxHealth: 100, mana: 0, maxMana: 40, townId: 'thais', worldPosition: TEMPLE },
      [poison],
    )).toEqual({ worldPosition: null, townId: 'thais', health: 100, mana: 40, conditions: [] });
  });

  it('SEM cidade o ticket não trouxe o mundo, e o extrato não leva NADA — não apaga o que a linha guarda', () => {
    // Um `api` anterior, ou a flag desligada nele: gravar `worldPosition: null` apagaria a posição
    // da linha, e a vida cheia desfaria a que ela guarda. Mutação que mata: tirar a marca.
    expect(receiptWorldStateOf({ ...alive, worldPosition: TEMPLE }, [haste])).toEqual({});
    expect(receiptWorldStateOf({ ...alive, townId: null, worldPosition: TEMPLE }, [haste])).toEqual({});
    expect(receiptWorldStateOf({ alive: false, health: 0, maxHealth: 100, mana: 0, maxMana: 40 }, [])).toEqual({});
  });
});

describe('as condições do ticket no relógio da sessão que as recebe (#836, OW-15)', () => {
  const holder = (conditions: readonly ConditionState[]) => ({ conditions: Conditions.fromState(conditions) });

  it('soma o relógio da sessão ao prazo restante — a que já andou não vê a condição como vencida', () => {
    const character = holder([poison, haste]);
    carryRestoredConditions(character, { nowMs: 60_000 });
    expect(character.conditions.getState()).toEqual([
      { ...poison, expiresAtMs: 64_000, nextTickAtMs: 61_000 },
      { ...haste, expiresAtMs: 69_500 },
    ]);
  });

  it('numa sessão que nasce agora (relógio zero) não muda nada', () => {
    const character = holder([poison]);
    carryRestoredConditions(character, { nowMs: 0 });
    expect(character.conditions.getState()).toEqual([poison]);
  });

  it('sem condição nenhuma não faz nada', () => {
    const character = holder([]);
    carryRestoredConditions(character, { nowMs: 5_000 });
    expect(character.conditions.getState()).toEqual([]);
  });
});
