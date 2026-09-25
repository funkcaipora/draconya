import { buildContent, placeholderAppearances } from '@draconya/content';
import type { RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { servedPackProblem } from './served-pack.js';

const raw: RawContent = {
  monsters: [], hunts: [], vocations: [],
  progression: [{
    id: 'baseline', startingHealth: 150, startingMana: 0, startingCapacity: 400,
    healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8, startingSpeed: 300, speedPerLevel: 0,
    regen: { healthPerSecond: 1, manaPerSecond: 1 }, xp: { kind: 'power', base: 20, exponent: 2 },
    deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessedReduction: 0.56, levelFloor: 8 },
  }],
  combat: [{
    id: 'baseline', dodgeMultiplier: 0.5, armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
    minimumDamageFraction: 0.1,
    player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 4, dodgeChance: 0.05 },
  }],
  stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
  party: [{ id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 } }],
  bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
};
const inventory = {
  id: 'tibia-1332', version: '1332', appearancesSha256: 'a'.repeat(64),
  object: [[100, 200]], outfit: [[1, 134]], effect: [[1, 80]], missile: [[1, 42]],
};
const withPack = buildContent({
  ...raw,
  appearances: [{ id: 'baseline', pack: 'tibia-1332', monsters: {}, items: {} }],
  packs: [inventory],
});

describe('servedPackProblem (FUN-21)', () => {
  it('aceita o deploy que serve o pacote contra o qual o conteúdo foi conferido', () => {
    expect(withPack.pack?.version).toBe('1332');
    expect(servedPackProblem(withPack, '1332')).toBeNull();
  });

  it('recusa o deploy que serve OUTRO pacote, e diz os dois lados', () => {
    // O caso que passava em tudo: `pnpm check` verde, boot ok, quadrado invisível na tela.
    const problem = servedPackProblem(withPack, '1400');
    expect(problem).toMatch(/THINGS_VERSION=1400/);
    expect(problem).toMatch(/"tibia-1332" \(versão 1332\)/);
  });

  it('conteúdo sem inventário não tem o que comparar — a fixture sobe com qualquer versão', () => {
    const fixture = buildContent({ ...raw, appearances: [placeholderAppearances(raw)] });
    expect(fixture.pack).toBeUndefined();
    expect(servedPackProblem(fixture, '9999')).toBeNull();
  });
});
