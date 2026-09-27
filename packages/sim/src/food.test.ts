// Comida (#726, ADR 0049 decisão 5, emenda ao ADR 0043).

import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import { drainFedMs, feed, FOOD_CAP_MS } from './food.js';

const newCharacter = (fedMs = 0): CharacterRuntime => new CharacterRuntime({
  id: 'hero', position: { x: 0, y: 0, z: 7 },
  health: 100, maxHealth: 100, mana: 0, maxMana: 0,
  level: 1, xp: 0, vocationId: null,
  gold: 0, goldDelta: 0, alive: true, cooldowns: {},
  ...(fedMs === 0 ? {} : { fedMs }),
});

describe('feed (#726, ADR 0049 decisão 5)', () => {
  it('soma duration a fedMs (o value × 12 s do foods.lua, já em ms)', () => {
    const character = newCharacter();
    const result = feed(character, 108_000); // cheese: 9 × 12 s
    expect(result).toEqual({ ok: true });
    expect(character.fedMs).toBe(108_000);
  });

  it('soma em cima do que já havia', () => {
    const character = newCharacter(60_000);
    feed(character, 60_000);
    expect(character.fedMs).toBe(120_000);
  });

  it('recusa `full` SEM consumir quando a soma estouraria o teto de 1.200.000 ms', () => {
    const character = newCharacter(FOOD_CAP_MS - 1000);
    const result = feed(character, 108_000);
    expect(result).toEqual({ ok: false, reason: 'full' });
    // Não consumiu: o contador continua exatamente onde estava.
    expect(character.fedMs).toBe(FOOD_CAP_MS - 1000);
  });

  it('aceita exatamente no teto (a soma bate igual, não estoura)', () => {
    const character = newCharacter(FOOD_CAP_MS - 108_000);
    const result = feed(character, 108_000);
    expect(result).toEqual({ ok: true });
    expect(character.fedMs).toBe(FOOD_CAP_MS);
  });
});

describe('drainFedMs (#726) — pelo tempo de hunt decorrido, nunca por tick (invariante 2)', () => {
  it('drena dtMs, sem passar de zero', () => {
    const character = newCharacter(1000);
    drainFedMs(character, 400);
    expect(character.fedMs).toBe(600);
    drainFedMs(character, 10_000);
    expect(character.fedMs).toBe(0);
  });

  it('sem comida, não faz nada (fedMs continua 0)', () => {
    const character = newCharacter(0);
    drainFedMs(character, 5000);
    expect(character.fedMs).toBe(0);
  });
});
