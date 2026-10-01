import { describe, expect, it } from 'vitest';
import type { SpellDefinition } from '../state/hud.js';
import { isSpellLearned, spellShopLabel, spellShopRows } from './spell-shop.js';
import type { SpellShopContext } from './spell-shop.js';

// A tela de aprendizado é PURA (#624): o servidor decide de verdade (invariante 4), e o que se
// prende aqui é que a tela não OFEREÇA o que ele vai recusar — e não esconda o que ele aceita.

const spell = (over: Partial<SpellDefinition> & Pick<SpellDefinition, 'id'>): SpellDefinition => ({
  name: over.id, manaCost: 20, minLevel: 1, vocationId: 'knight', effect: 'damage', group: 'attack',
  ...over,
});

const catalogue: readonly SpellDefinition[] = [
  spell({ id: 'berserk', name: 'Berserk', minLevel: 35, learnPrice: 2_500 }),
  spell({ id: 'wound-cleansing', name: 'Wound Cleansing', minLevel: 8, learnPrice: 0 }),
  spell({ id: 'bruise-bane', name: 'Bruise Bane', minLevel: 1, learnPrice: 0 }),
  spell({ id: 'annihilation', name: 'Annihilation', minLevel: 110, learnPrice: 20_000 }),
  spell({ id: 'haste-druid', name: 'Haste', minLevel: 14, vocationId: 'druid', learnPrice: 600 }),
  spell({ id: 'cure-poison', name: 'Cure Poison', minLevel: 10, vocationId: null, learnPrice: 150 }),
  spell({ id: 'great-death-beam', name: 'Great Death Beam', minLevel: 30, vocationId: 'knight' }),
];

const knight = (over: Partial<SpellShopContext> = {}): SpellShopContext => ({
  vocationId: 'knight', level: 40, gold: 10_000, learned: [], ...over,
});

const byId = (rows: ReturnType<typeof spellShopRows>) => Object.fromEntries(rows.map((row) => [row.id, row]));

describe('spellShopRows', () => {
  it('lista a vocação do personagem e as magias sem vocação — nunca as de outra', () => {
    const ids = spellShopRows(catalogue, knight()).map((row) => row.id);
    expect(ids).toContain('berserk');
    expect(ids).toContain('cure-poison');
    expect(ids).not.toContain('haste-druid');
  });

  it('quem ainda não escolheu vocação vê só o que não exige uma', () => {
    const ids = spellShopRows(catalogue, knight({ vocationId: null })).map((row) => row.id);
    expect(ids).toEqual(['cure-poison']);
  });

  it('vem na ordem em que o jogador alcança: level, depois nome', () => {
    const names = spellShopRows(catalogue, knight()).map((row) => row.name);
    expect(names).toEqual([
      'Bruise Bane', 'Wound Cleansing', 'Cure Poison', 'Great Death Beam', 'Berserk', 'Annihilation',
    ]);
  });

  it('cada linha diz em que pé está a magia — a MESMA régua do servidor (`LearnedSpells.check`)', () => {
    const rows = byId(spellShopRows(catalogue, knight({ level: 40, gold: 2_000, learned: ['bruise-bane'] })));
    expect(rows['bruise-bane']?.status).toBe('learned');
    // `0` é grátis e nunca falta gold para ela.
    expect(rows['wound-cleansing']?.status).toBe('buyable');
    expect(rows['cure-poison']?.status).toBe('buyable');
    // Bate level e vocação, falta só saldo.
    expect(rows['berserk']?.status).toBe('no-gold');
    // Falta level: nem o saldo importa.
    expect(rows['annihilation']?.status).toBe('level');
    // Ninguém a ensina — vem SEM preço, e a tela não oferece a compra.
    expect(rows['great-death-beam']).toMatchObject({ status: 'not-for-sale', price: undefined });
  });

  it('é o limite exato: no level e no saldo do requisito compra, um abaixo não', () => {
    expect(byId(spellShopRows(catalogue, knight({ level: 35, gold: 2_500 })))['berserk']?.status).toBe('buyable');
    expect(byId(spellShopRows(catalogue, knight({ level: 34, gold: 2_500 })))['berserk']?.status).toBe('level');
    expect(byId(spellShopRows(catalogue, knight({ level: 35, gold: 2_499 })))['berserk']?.status).toBe('no-gold');
  });

  it('já aprendida vence qualquer outro estado, inclusive o de "sem preço"', () => {
    const rows = byId(spellShopRows(catalogue, knight({ level: 1, gold: 0, learned: ['berserk', 'great-death-beam'] })));
    expect(rows['berserk']?.status).toBe('learned');
    expect(rows['great-death-beam']?.status).toBe('learned');
  });

  it('sem o registro (`null`), nada aparece como aprendido', () => {
    const rows = byId(spellShopRows(catalogue, knight({ learned: null })));
    expect(rows['wound-cleansing']?.status).toBe('buyable');
  });
});

describe('spellShopLabel', () => {
  it('o texto de cada estado — `Grátis` para `0`, o preço para o resto', () => {
    const rows = byId(spellShopRows(catalogue, knight({ level: 40, gold: 2_000, learned: ['bruise-bane'] })));
    expect(spellShopLabel(rows['bruise-bane']!)).toBe('Aprendida');
    expect(spellShopLabel(rows['wound-cleansing']!)).toBe('Grátis');
    expect(spellShopLabel(rows['berserk']!)).toBe('2500 gold');
    expect(spellShopLabel(rows['annihilation']!)).toBe('Level 110');
    expect(spellShopLabel(rows['great-death-beam']!)).toBe('Indisponível');
  });
});

describe('isSpellLearned', () => {
  it('só marca como NÃO aprendida com o registro na mão', () => {
    expect(isSpellLearned('berserk', ['berserk'])).toBe(true);
    expect(isSpellLearned('berserk', ['wound-cleansing'])).toBe(false);
    expect(isSpellLearned('berserk', [])).toBe(false);
    // "Ainda não sei" nunca vira "não aprendeu".
    expect(isSpellLearned('berserk', null)).toBe(true);
  });
});
