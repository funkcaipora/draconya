import { describe, expect, it } from 'vitest';
import { cleavePower, cleaveTiles } from './cleave.js';

describe('cleaveTiles (#552, WeaponMelee::useWeapon)', () => {
  const hero = { x: 5, y: 5 };

  it('alvo na mesma coluna: leste e oeste DO ALVO, nessa ordem', () => {
    expect(cleaveTiles(hero, { x: 5, y: 4 })).toEqual([{ x: 6, y: 4 }, { x: 4, y: 4 }]);
  });

  it('alvo na mesma linha: sul e norte DO ALVO, nessa ordem', () => {
    expect(cleaveTiles(hero, { x: 6, y: 5 })).toEqual([{ x: 6, y: 6 }, { x: 6, y: 4 }]);
  });

  it('alvo na diagonal: os dois vizinhos comuns ao atacante e ao alvo', () => {
    expect(cleaveTiles(hero, { x: 6, y: 6 })).toEqual([{ x: 5, y: 6 }, { x: 6, y: 5 }]);
    expect(cleaveTiles(hero, { x: 4, y: 4 })).toEqual([{ x: 5, y: 4 }, { x: 4, y: 5 }]);
  });

  it('mesmo tile: não há cleave', () => {
    expect(cleaveTiles(hero, hero)).toBeNull();
  });
});

describe('cleavePower', () => {
  it('é a fração inteira truncada da rolagem própria', () => {
    expect(cleavePower(99, 3)).toBe(2);
    expect(cleavePower(200, 50)).toBe(100);
  });
});
