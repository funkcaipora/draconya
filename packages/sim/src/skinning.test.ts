import { SKINNING_CHANCE_SCALE } from '@draconya/content';
import type { Charm, Skinning } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { hasSkinningStage } from './combat/profile.js';
import { Rng } from './rng.js';
import {
  guaranteedStageAt, rollSkinning, scavengeChanceFor, skinningChanceRange, skinningStageAt,
} from './skinning.js';

// O Dragon do Canary: `5973` por 10 s, `4025` por 300 s — os dois estágios esfoláveis; o `4026`
// (300 s) e o `4027` (60 s) que fecham os 670 s de vida do cadáver não são chave do `config`.
const dragon: Skinning = {
  id: 'dragon', toolId: 'obsidian-knife', materialId: 'green-dragon-leather', chance: 25_000,
  stages: [
    { canaryItemId: 5973, durationMs: 10_000, afterTtlMs: 360_000 },
    { canaryItemId: 4025, durationMs: 300_000, afterTtlMs: 360_000 },
  ],
};
// O coelho: o sorteio é só do `6017` (10 s); o `4301` que vem depois (300 s) não é chave da tabela,
// mas a faca nele rende o pé de coelho SEM sorteio — o ramo `target.itemid == 4301` do Lua.
const rabbit: Skinning = {
  id: 'rabbit', toolId: 'obsidian-knife', materialId: 'rabbits-foot', chance: 25_000,
  stages: [{ canaryItemId: 6017, durationMs: 10_000, afterTtlMs: 360_000 }],
  guaranteed: [{ canaryItemId: 4301, startMs: 10_000, durationMs: 300_000, materialId: 'rabbits-foot', quantity: 1 }],
};
const scavenge: Charm = {
  id: 'scavenge', name: 'Scavenge', canaryCharmId: 13, category: 'minor', type: 'passive',
  chance: [60, 90, 120], points: [100, 150, 225],
};

describe('a janela de esfola é por estágio do cadáver, não pela vida inteira dele', () => {
  it('o Dragon é esfolável nos dois primeiros estágios e em nenhum depois', () => {
    expect(skinningStageAt(dragon, 0)?.canaryItemId).toBe(5973);
    expect(skinningStageAt(dragon, 9_999)?.canaryItemId).toBe(5973);
    expect(skinningStageAt(dragon, 10_000)?.canaryItemId).toBe(4025);
    expect(skinningStageAt(dragon, 309_999)?.canaryItemId).toBe(4025);
    // 310 s: o cadáver virou o `4026`, que o Canary não esfola ("not possible") — e ele ainda
    // dura 360 s dos 670.
    expect(skinningStageAt(dragon, 310_000)).toBeNull();
    expect(skinningStageAt(dragon, 600_000)).toBeNull();
  });

  it('a fronteira pertence ao estágio seguinte e a idade negativa nunca esfola', () => {
    expect(skinningStageAt(rabbit, 9_999)?.canaryItemId).toBe(6017);
    expect(skinningStageAt(rabbit, 10_000)).toBeNull();
    expect(skinningStageAt(dragon, -1)).toBeNull();
  });
});

describe('o ramo garantido da faca vale só no estágio dele, depois da janela do sorteio', () => {
  it('o coelho rende sem sorteio de 10 s a 310 s, e a fronteira pertence ao estágio seguinte', () => {
    expect(guaranteedStageAt(rabbit, 9_999)).toBeNull();
    expect(guaranteedStageAt(rabbit, 10_000)?.canaryItemId).toBe(4301);
    expect(guaranteedStageAt(rabbit, 309_999)?.canaryItemId).toBe(4301);
    expect(guaranteedStageAt(rabbit, 310_000)).toBeNull();
    expect(guaranteedStageAt(rabbit, -1)).toBeNull();
  });

  it('a janela do sorteio e a garantida não se sobrepõem em instante nenhum', () => {
    for (let age = 0; age < 700_000; age += 500) {
      expect(skinningStageAt(rabbit, age) !== null && guaranteedStageAt(rabbit, age) !== null, String(age)).toBe(false);
    }
  });

  it('quem não declara o ramo (o Dragon, quase toda a tabela) nunca o tem', () => {
    for (const age of [0, 10_000, 100_000, 310_000]) expect(guaranteedStageAt(dragon, age)).toBeNull();
  });
});

describe('o chanceRange: o Scavenge ENCOLHE o intervalo, não soma à chance', () => {
  it('sem o charm é a escala inteira do Lua (100000)', () => {
    expect(SKINNING_CHANCE_SCALE).toBe(100_000);
    expect(skinningChanceRange(undefined)).toBe(100_000);
  });

  it('com o charm é 100000 × chance / 100 — o que o Canary escreve, inclusive o que ele tem de estranho', () => {
    expect(skinningChanceRange(60)).toBe(60_000);
    expect(skinningChanceRange(90)).toBe(90_000);
    // O tier 3 (120) ALARGA o intervalo: 25 000 de 120 000 é MENOS que os 25 % sem charm.
    expect(skinningChanceRange(120)).toBe(120_000);
    expect(25_000 / skinningChanceRange(60)).toBeCloseTo(0.4167, 4);
    expect(25_000 / skinningChanceRange(90)).toBeCloseTo(0.2778, 4);
    expect(25_000 / skinningChanceRange(120)).toBeCloseTo(0.2083, 4);
  });

  it('chance zero vira 1 ("guarantee that the chance will never be 0"), e o intervalo é truncado', () => {
    expect(skinningChanceRange(0)).toBe(1_000);
    expect(skinningChanceRange(0.5)).toBe(500);
    expect(skinningChanceRange(0.001)).toBe(1);
  });
});

describe('o Scavenge vale pelo ID do cadáver que está sendo esfolado', () => {
  // O Minotaur, o Minotaur Bruiser e o Depowered Minotaur são todos `5969`: o mesmo par de estágios.
  const minotaur: Skinning = {
    id: 'minotaur', toolId: 'obsidian-knife', materialId: 'minotaur-leather', chance: 25_000,
    stages: [
      { canaryItemId: 5969, durationMs: 10_000, afterTtlMs: 360_000 },
      { canaryItemId: 4011, durationMs: 300_000, afterTtlMs: 360_000 },
    ],
  };
  const bruiser: Skinning = { ...minotaur, id: 'minotaur-bruiser' };

  it('o charm escolhido no Dragon vale nos dois estágios do Dragon, com a chance do tier', () => {
    for (const stage of dragon.stages) {
      expect(scavengeChanceFor(scavenge, 1, dragon, stage)).toBe(60);
      expect(scavengeChanceFor(scavenge, 2, dragon, stage)).toBe(90);
      expect(scavengeChanceFor(scavenge, 3, dragon, stage)).toBe(120);
    }
  });

  it('vale para OUTRO monstro que compartilha o cadáver, e para nenhum que não compartilha', () => {
    const [first] = bruiser.stages;
    expect(first).toBeDefined();
    expect(scavengeChanceFor(scavenge, 1, minotaur, first as (typeof bruiser.stages)[number])).toBe(60);
    // O charm no Minotaur não vale no cadáver do Dragon (`5973`/`4025` não são `5969`/`4011`).
    expect(scavengeChanceFor(scavenge, 1, minotaur, dragon.stages[0] as (typeof dragon.stages)[number]))
      .toBeUndefined();
  });

  it('só os dois primeiros estágios do monstro do charm são comparados', () => {
    const three: Skinning = {
      ...dragon,
      stages: [
        { canaryItemId: 1, durationMs: 1, afterTtlMs: 1 }, { canaryItemId: 2, durationMs: 1, afterTtlMs: 1 },
        { canaryItemId: 3, durationMs: 1, afterTtlMs: 1 },
      ],
    };
    expect(scavengeChanceFor(scavenge, 1, three, { canaryItemId: 2, durationMs: 1, afterTtlMs: 1 })).toBe(60);
    expect(scavengeChanceFor(scavenge, 1, three, { canaryItemId: 3, durationMs: 1, afterTtlMs: 1 })).toBeUndefined();
  });

  it('sem charm, sem monstro escolhido esfolável ou sem tier desbloqueado, nada muda', () => {
    const stage = dragon.stages[0] as (typeof dragon.stages)[number];
    expect(scavengeChanceFor(undefined, 1, dragon, stage)).toBeUndefined();
    expect(scavengeChanceFor(scavenge, 1, undefined, stage)).toBeUndefined();
    expect(scavengeChanceFor(scavenge, 0, dragon, stage)).toBeUndefined();
  });
});

describe('o sorteio da esfola', () => {
  /** Quantas de `n` tentativas dão certo, com a semente dada. */
  const successes = (n: number, range: number, seed: string): number => {
    const rng = new Rng(Rng.fromSeed(seed).getState());
    let hits = 0;
    for (let i = 0; i < n; i += 1) if (rollSkinning(rng, dragon, range)) hits += 1;
    return hits;
  };

  it('consome UMA rolagem por tentativa, sempre', () => {
    const a = Rng.fromSeed('skin');
    const b = Rng.fromSeed('skin');
    rollSkinning(a, dragon, 100_000);
    b.integer(1, 100_000);
    expect(a.getState()).toEqual(b.getState());
  });

  it.each([
    ['sem charm', 100_000, 0.25],
    ['Scavenge tier 1', 60_000, 25_000 / 60_000],
    ['Scavenge tier 2', 90_000, 25_000 / 90_000],
    ['Scavenge tier 3', 120_000, 25_000 / 120_000],
  ])('%s: a frequência de sucesso é value / chanceRange', (_label, range, expected) => {
    const n = 200_000;
    const rate = successes(n, range, `skin-${String(range)}`) / n;
    expect(Math.abs(rate - expected)).toBeLessThan(0.006);
  });

  it('o intervalo encolhido do charm zerado (1 000) acerta sempre: o value 25 000 cabe inteiro', () => {
    expect(successes(2_000, skinningChanceRange(0), 'guarantee')).toBe(2_000);
  });
});

describe('o estágio de esfola é do combat-v4', () => {
  it('só o combat-v4 esfola; o v3 e os anteriores nunca reconhecem a ferramenta (invariante 7)', () => {
    expect(hasSkinningStage('combat-v4')).toBe(true);
    expect(hasSkinningStage('combat-v3')).toBe(false);
    expect(hasSkinningStage('combat-v2')).toBe(false);
    expect(hasSkinningStage('combat-v1')).toBe(false);
    expect(hasSkinningStage(undefined)).toBe(false);
  });
});
