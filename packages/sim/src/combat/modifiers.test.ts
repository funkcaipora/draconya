// Testes de `modifiers.ts` (M30-04, #551): a fórmula de leech do Canary (`calculateLeechAmount`),
// o crítico de monstro (`monsterCriticalModifiers`) e a soma de fontes (`combineCombatModifiers`).
// A APLICAÇÃO sobre o estado quente (`applyDamageOutcome`) é assunto de `outcome.test.ts`; a
// rolagem em si, de `damage.test.ts`.

import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../character.js';
import { CharacterRuntime } from '../character.js';
import {
  applyLeech, calculateLeechAmount, combineCombatModifiers, monsterCriticalModifiers,
} from './modifiers.js';

const character = (over: Partial<CharacterState> = {}): CharacterRuntime =>
  new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: 100, maxHealth: 100, mana: 100, maxMana: 100,
    level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
    ...over,
  });

describe('calculateLeechAmount (Game::calculateLeechAmount, game.cpp:9058)', () => {
  it('targetsAffected 1 é a identidade: realDamage × leechFraction, sem desconto', () => {
    expect(calculateLeechAmount(40, 0.5, 1)).toBe(20);
    expect(calculateLeechAmount(100, 0.1, 1)).toBe(10);
  });

  it('cinco alvos: o fator é (0,1×5+0,9)/5 = 0,28 — NÃO 0,2, uma divisão simples', () => {
    // 100 × 0,5 × 0,28 = 14 exato — o vetor da issue (#551), com a fórmula real do Canary.
    expect(calculateLeechAmount(100, 0.5, 5)).toBe(14);
    // Uma divisão ingênua por 5 daria 100 × 0,5 / 5 = 10 — um número MENOR e diferente.
    expect(calculateLeechAmount(100, 0.5, 5)).not.toBe(10);
  });

  it('dois alvos: fator (0,1×2+0,9)/2 = 0,55', () => {
    expect(calculateLeechAmount(100, 0.5, 2)).toBe(28);
  });

  it('arredonda meio para cima (std::lround), como o Canary', () => {
    // 51 × 0,5 × 1 = 25,5 → 26.
    expect(calculateLeechAmount(51, 0.5, 1)).toBe(26);
  });

  it('nunca passa do realDamage, mesmo com leechFraction alto', () => {
    expect(calculateLeechAmount(10, 2, 1)).toBe(10);
  });

  it('zero sem fração, sem dano, ou com targetsAffected inválido (piso em 1)', () => {
    expect(calculateLeechAmount(100, 0, 1)).toBe(0);
    expect(calculateLeechAmount(0, 0.5, 1)).toBe(0);
    expect(calculateLeechAmount(100, 0.5, 0)).toBe(calculateLeechAmount(100, 0.5, 1));
  });
});

describe('applyLeech', () => {
  it('repõe vida e mana pela fórmula, clampado no teto do atacante', () => {
    const attacker = character({ health: 0, mana: 0 });
    const result = applyLeech(attacker, 100, { lifeLeech: 0.5, manaLeech: 0.5 }, 5);
    expect(result.lifeLeechApplied).toBe(14);
    expect(result.manaLeechApplied).toBe(14);
    expect(attacker.health).toBe(14);
    expect(attacker.mana).toBe(14);
  });

  it('sem modificadores ou sem dano, não repõe nada', () => {
    const attacker = character({ health: 0 });
    expect(applyLeech(attacker, 100, undefined, 1)).toEqual({ lifeLeechApplied: 0, manaLeechApplied: 0 });
    expect(applyLeech(attacker, 0, { lifeLeech: 0.5 }, 1)).toEqual({ lifeLeechApplied: 0, manaLeechApplied: 0 });
  });
});

describe('monsterCriticalModifiers (Monster::getCriticalChance, combat.cpp:2766)', () => {
  it('critChance ausente ou zero não declara crítico — identidade de rato/rotworm/dragon', () => {
    expect(monsterCriticalModifiers(undefined)).toBeUndefined();
    expect(monsterCriticalModifiers({ critChance: 0 })).toBeUndefined();
  });

  it('critChance 10 (antenna.lua) vira 10 % de chance, sem multiplicador de dano', () => {
    // getCriticalChance() * 100 = 1000 pontos-base = 10 %. Sem `criticalDamage` de conteúdo, o
    // Canary não multiplica dano nenhum quando o monstro cria — só marca a flag.
    expect(monsterCriticalModifiers({ critChance: 10 })).toEqual({
      critical: { chance: 0.1, multiplier: 1 },
    });
  });

  it('critChance 3 (mitmah_scout.lua) vira 3 %', () => {
    expect(monsterCriticalModifiers({ critChance: 3 })?.critical?.chance).toBeCloseTo(0.03);
  });
});

describe('combineCombatModifiers', () => {
  it('undefined quando nenhuma fonte declara nada', () => {
    expect(combineCombatModifiers()).toBeUndefined();
    expect(combineCombatModifiers(undefined, undefined)).toBeUndefined();
  });

  it('uma fonte só passa direto', () => {
    expect(combineCombatModifiers({ lifeLeech: 0.1 })).toEqual({ lifeLeech: 0.1 });
  });

  it('soma pontos-base de crítico de VÁRIAS fontes antes de UMA rolagem só', () => {
    // 10 % + 5 % de chance, +35 % e +20 % de dano — como o Canary soma vários itens antes de
    // rolar uma vez (`combat.cpp:2657`).
    const combined = combineCombatModifiers(
      { critical: { chance: 0.1, multiplier: 1.35 } },
      { critical: { chance: 0.05, multiplier: 1.2 } },
    );
    expect(combined?.critical?.chance).toBeCloseTo(0.15);
    expect(combined?.critical?.multiplier).toBeCloseTo(1.55);
  });

  it('lifeLeech/manaLeech somam direto, como fração', () => {
    const combined = combineCombatModifiers(
      { lifeLeech: 0.1, manaLeech: 0.05 }, { lifeLeech: 0.2 },
    );
    expect(combined?.lifeLeech).toBeCloseTo(0.3);
    expect(combined?.manaLeech).toBeCloseTo(0.05);
  });

  it('crítico com chance 0 ainda MARCA a fonte como declarada (regra aditiva do ADR 0031)', () => {
    const combined = combineCombatModifiers({ critical: { chance: 0, multiplier: 1 } });
    expect(combined?.critical).toEqual({ chance: 0, multiplier: 1 });
  });
});
