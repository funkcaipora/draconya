// Suite dos golden traces de combate (M24-01, #469).
//
// Cada trace é uma cena determinística com semente fixa e um oráculo escrito à mão. O teste
// roda a cena e compara evento a evento; a divergência sai nomeada. O que este arquivo NÃO
// faz é derivar o esperado do observado — um oráculo copiado da implementação concorda com o
// defeito que deveria pegar (DT-01 da #469, lição do CMB-10).
//
// Além dos traces de evento, há as TABELAS de oráculo de dano (oito tipos, armadura,
// resistência, imunidade) e de alvo (política, desempate, prioridade, raio da arma x da
// magia), e os testes de LACUNA: cada fato da referência que o motor ainda não entrega fica
// preso com o número atual e a issue do M24 que o fecha.

import { describe, expect, it } from 'vitest';
import type { Spell } from '@draconya/content';
import { runTrace } from './harness.js';
import type { CombatTraceEvent, CombatTraceGap } from './types.js';
import { spellSingleTargetTrace, spellTraces } from './spells.trace.js';
import { healingGaps, healingTraces, lightHealingTrace, ultimateHealingRuneTrace } from './healing.trace.js';
import {
  CANARY_CIRCLE_RADIUS_3_TILES, CANARY_RUNE_LEVEL, CANARY_RUNE_MAGIC_LEVEL, avalancheTrace,
  canaryRunes, circleRadiusThreeTiles, runesGaps, suddenDeathRune,
} from './runes.trace.js';
import { DAMAGE_ELEMENT_ORACLE, damageEventOrderTrace, resolveOracleCase, resolveOracleOutcome } from './damage.trace.js';
import {
  TARGETING_ORACLE, chooseOracleTarget, countOracleTargets,
} from './targeting.trace.js';

const goldenTraces = [
  ...spellTraces, ...healingTraces, avalancheTrace, damageEventOrderTrace,
];

/** O `tileCount` que um evento carrega, ou `null` se ele não o tem. */
const tileCountOf = (event: CombatTraceEvent): number | null =>
  typeof event.payload.tileCount === 'number' ? event.payload.tileCount : null;

describe('golden traces: a cena reproduz o oráculo, evento a evento', () => {
  for (const trace of goldenTraces) {
    it(`${trace.id}: ${trace.description}`, () => {
      expect(trace.run()).toEqual(trace.expected);
    });
  }
});

describe('golden traces: determinismo e invariante 2 (a taxa não muda o resultado)', () => {
  for (const trace of goldenTraces) {
    it(`${trace.id}: a mesma semente roda duas vezes e rende o MESMO trace`, () => {
      expect(trace.run()).toEqual(trace.run());
    });
  }

  it('100 ms e 1000 ms rendem a mesma sequência de eventos', () => {
    // A cena age a cada 1000 ms lógicos; o plano de 100 ms tem dez passos por ação, e o
    // coarsen junta cada dez. Se algum evento dependesse do tamanho do passo, divergiria.
    const stepsAt = (stepMs: number): readonly { readonly dtMs: number; readonly action?: { readonly kind: 'attack'; readonly rawDamage: number } }[] =>
      Array.from({ length: 30 }, (_, index) => ({
        dtMs: stepMs,
        ...(index % 10 === 0 ? { action: { kind: 'attack' as const, rawDamage: 10 } } : {}),
      }));
    const fine = runTrace({
      seed: 'm24-rate', hero: {}, monsters: [{ id: 1, monsterId: 'orc', position: { x: 1, y: 0 }, health: 1_000 }],
      steps: stepsAt(100),
    }).events;
    const coarse = runTrace({
      seed: 'm24-rate', hero: {}, monsters: [{ id: 1, monsterId: 'orc', position: { x: 1, y: 0 }, health: 1_000 }],
      steps: Array.from({ length: 3 }, (_, index) => ({
        dtMs: 1_000,
        ...(index % 1 === 0 ? { action: { kind: 'attack' as const, rawDamage: 10 } } : {}),
      })),
    }).events;
    expect(coarse).toEqual(fine);
  });
});

describe('oráculo de dano: os oito tipos, armadura, resistência e imunidade (RF-02)', () => {
  for (const case_ of DAMAGE_ELEMENT_ORACLE) {
    it(case_.id, () => {
      expect(resolveOracleCase(case_)).toBe(case_.resolved);
    });
  }
});

describe('oráculo de alvo: política, desempate, prioridade e raio (RF-01)', () => {
  for (const case_ of TARGETING_ORACLE) {
    it(case_.id, () => {
      expect(chooseOracleTarget(case_)).toBe(case_.expected);
    });
  }

  it('countTargets não conta ignorado', () => {
    const ignored = TARGETING_ORACLE.find((case_) => case_.id === 'ignored-is-skipped');
    expect(ignored).toBeDefined();
    if (ignored !== undefined) expect(countOracleTargets(ignored)).toBe(1);
  });
});

describe('casos de borda: morte no meio de uma área não corrompe os alvos seguintes', () => {
  const blast: Spell = {
    id: 'blast', name: 'Blast', manaCost: 20, cooldownMs: 4_000, minLevel: 1,
    effect: {
      kind: 'damage', power: 50, range: 3, damageType: 'fire',
      area: { shape: 'circle', radius: 1, centered: 'target' },
    },
  };

  it('o alvo que morre primeiro não impede o golpe nos que vêm depois', () => {
    const events = runTrace({
      seed: 'm24-area-death',
      hero: { position: { x: 0, y: 0, z: 7 }, mana: 100, maxMana: 100 },
      monsters: [
        { id: 1, monsterId: 'rat', position: { x: 2, y: 0 }, health: 10 },
        { id: 2, monsterId: 'rat', position: { x: 3, y: 0 }, health: 200 },
        { id: 3, monsterId: 'rat', position: { x: 3, y: 1 }, health: 200 },
      ],
      steps: [{ dtMs: 1000, action: { kind: 'spell', spell: blast } }, { dtMs: 1000 }],
    }).events;
    const hits = events.filter((event) => event.kind === 'creature-hit');
    expect(hits.map((event) => event.subject)).toEqual(['m:1', 'm:2', 'm:3']);
    const health = events
      .filter((event) => event.kind === 'creature-health')
      .map((event) => event.payload.health);
    expect(health).toEqual([0, 150, 150]);
  });
});

describe('pipeline canônico do #473: sem splitting e com o tipo preservado', () => {
  const blast: Spell = {
    id: 'blast', name: 'Blast', manaCost: 20, cooldownMs: 4_000, minLevel: 1,
    effect: {
      kind: 'damage', power: 50, range: 3, damageType: 'fire',
      area: { shape: 'circle', radius: 1, centered: 'target' },
    },
  };
  const hitsOf = (events: readonly CombatTraceEvent[]): number[] =>
    events.filter((event) => event.kind === 'creature-hit')
      .map((event) => Number(event.payload.amount));

  it('RF-04: 1 alvo e 5 alvos rendem o MESMO golpe por alvo, sem divisão de dano', () => {
    // A área rola o poder UMA vez por alvo e aplica integralmente em cada um. Se houvesse
    // splitting/cap, o total de 5 alvos não passaria do de 1 — o mesmo sorteio inicial cai no
    // primeiro alvo das duas cenas, então é ele a âncora da igualdade.
    const scene = (monsters: readonly { id: number; x: number; y: number }[]) => runTrace({
      seed: 'm24-no-split',
      hero: { position: { x: 0, y: 0, z: 7 }, mana: 100, maxMana: 100 },
      monsters: monsters.map(({ id, x, y }) => ({
        id, monsterId: 'rat', position: { x, y }, health: 500,
      })),
      steps: [{ dtMs: 1000, action: { kind: 'spell', spell: blast } }],
    }).events;
    const one = hitsOf(scene([{ id: 1, x: 2, y: 0 }]));
    const five = hitsOf(scene([
      { id: 1, x: 2, y: 0 }, { id: 2, x: 3, y: 0 }, { id: 3, x: 2, y: 1 },
      { id: 4, x: 2, y: -1 }, { id: 5, x: 3, y: 1 },
    ]));
    expect(one).toHaveLength(1);
    expect(five).toHaveLength(5);
    expect(five[0]).toBe(one[0]);
    expect(five.reduce((sum, amount) => sum + amount, 0)).toBeGreaterThan(one[0] as number * 2);
    for (const amount of five) expect(amount).toBeGreaterThan(0);
  });

  it('RF-05: o outcome preserva o damageType de cada caso do oráculo', () => {
    for (const case_ of DAMAGE_ELEMENT_ORACLE) {
      expect(resolveOracleOutcome(case_).damageType).toBe(case_.damageType);
    }
  });
});

describe('lacunas da referência: o número atual e a issue que o muda (RF-05)', () => {
  it('o círculo de raio 3 entrega os 37 tiles da AREA_CIRCLE3X3 (#472 fechada)', () => {
    // A #472 recortou os cantos pela distância de Manhattan; o oráculo agora é a paridade.
    expect(circleRadiusThreeTiles()).toHaveLength(CANARY_CIRCLE_RADIUS_3_TILES);
  });

  it('o supply-used da Avalanche carrega os 37 tiles da referência', () => {
    const supplyUsed = avalancheTrace.run().find((event) => event.kind === 'supply-used');
    expect(supplyUsed).toBeDefined();
    expect(tileCountOf(supplyUsed as CombatTraceEvent)).toBe(CANARY_CIRCLE_RADIUS_3_TILES);
  });

  it('toda lacuna do M24 nomeia a issue que a fecha, e as duas listas estão vazias', () => {
    // As lacunas de ALVO que existiam na #469 foram fechadas pela #470 (protocolo e
    // cancelamento); a #475 fechou a cura e a #476 fechou o catálogo e as fórmulas de runa. Não
    // sobra gap com issue pendente — e um gap novo tem de trazer a sua task.
    const all: readonly CombatTraceGap[] = [
      ...healingGaps, ...runesGaps,
    ];
    for (const gap of all) expect(gap.task).toMatch(/^#\d+$/);
    expect(all).toEqual([]);
  });

  it('a fórmula de magia é a canônica do Canary, não a conversão provisória (#474 fechada)', () => {
    // O trace da Ice Strike roda com level 50 e ML 40 e declara a `formula` do Canary. Os dois
    // golpes têm de cair na faixa `level/5 + ML×1.403 + 8 = 74` a `level/5 + ML×2.203 + 13 = 111`.
    // Mutação que mata: cair no `basePower` 45 daria 382~518, e este teste reprova.
    const hits = spellSingleTargetTrace.run()
      .filter((event) => event.kind === 'creature-hit')
      .map((event) => Number(event.payload.amount));
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      expect(hit).toBeGreaterThanOrEqual(74);
      expect(hit).toBeLessThanOrEqual(111);
    }
  });

  it('a cura é a fórmula canônica do Canary e as runas UH/IH existem (#475 fechada)', () => {
    // Light Healing em level 8, magic 0: `8/5 + 0×1.4 + 8 = 9` a `8/5 + 0×2.0 + 11 = 12`.
    // Mutação que mata: cair no `basePower` 40 daria 50~69. A UH rune em level 50, ML 40:
    // `50/5 + 40×5.7 + 36 = 274` a `50/5 + 40×10.3 + 65 = 487`.
    const healed = (trace: typeof lightHealingTrace): number[] =>
      trace.run().filter((event) => event.kind === 'creature-healed')
        .map((event) => Number(event.payload.amount));
    for (const amount of healed(lightHealingTrace)) {
      expect(amount).toBeGreaterThanOrEqual(9);
      expect(amount).toBeLessThanOrEqual(12);
    }
    for (const amount of healed(ultimateHealingRuneTrace)) {
      expect(amount).toBeGreaterThanOrEqual(274);
      expect(amount).toBeLessThanOrEqual(487);
    }
    // A #475 fechou a área, as runas e a fórmula: não sobra lacuna de cura na referência.
    expect(healingGaps).toEqual([]);
  });
});

describe('as runas de ataque e a fórmula canônica do Canary (#476)', () => {
  it('level 50 e ML 40 rendem a faixa Canary de cada runa, sem passar pelo basePower', () => {
    // O oráculo (`rune.min`/`rune.max`) é escrito à mão, não lido do motor. Mutação que mata:
    // manter o caminho do `basePower`/`spellPowerRange` — a rolagem sairia fora da faixa.
    for (const rune of canaryRunes) {
      const events = runTrace({
        seed: `m24-rune-${rune.supply.id}`,
        hero: {
          position: { x: 0, y: 0, z: 7 }, mana: 0, maxMana: 100,
          level: CANARY_RUNE_LEVEL, gold: 10_000,
        },
        monsters: [{ id: 1, monsterId: 'dragon', position: { x: 5, y: 0 }, health: 100_000 }],
        steps: [{
          dtMs: 1_000,
          action: { kind: 'supply', supply: rune.supply, skillLevel: CANARY_RUNE_MAGIC_LEVEL },
        }],
      }).events;
      const hits = events.filter((event) => event.kind === 'creature-hit')
        .map((event) => Number(event.payload.amount));
      expect(hits.length, rune.supply.id).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit, rune.supply.id).toBeGreaterThanOrEqual(rune.min);
        expect(hit, rune.supply.id).toBeLessThanOrEqual(rune.max);
      }
      // O elemento é o do catálogo; o dano da fórmula não o troca no caminho.
      expect(rune.supply.effect.kind === 'damage' && rune.supply.effect.damageType)
        .toBe(rune.damageType);
    }
  });

  it('a Sudden Death é alvo ÚNICO: dois monstros adjacentes, UM só leva o golpe (#476)', () => {
    // Com área, o segundo monstro (a 1 tile do principal) cairia no raio; sem área, o
    // `targets` tem um só e o `tileCount` é zero. Mutação que mata: reintroduzir um círculo
    // implícito na runa de alvo único.
    const events = runTrace({
      seed: 'm24-sd-single',
      hero: {
        position: { x: 0, y: 0, z: 7 }, mana: 0, maxMana: 100, level: 45, gold: 10_000,
      },
      monsters: [
        { id: 1, monsterId: 'dragon', position: { x: 5, y: 0 }, health: 100_000 },
        { id: 2, monsterId: 'dragon', position: { x: 5, y: 1 }, health: 100_000 },
      ],
      steps: [{ dtMs: 1_000, action: { kind: 'supply', supply: suddenDeathRune, skillLevel: 15 } }],
    }).events;
    const hits = events.filter((event) => event.kind === 'creature-hit');
    expect(hits.map((event) => event.subject)).toEqual(['m:1']);
    const used = events.find((event) => event.kind === 'supply-used') as CombatTraceEvent;
    expect(used.payload.targets).toEqual(['m:1']);
    expect(used.payload.tileCount).toBe(0);
    for (const hit of hits) {
      // Em level 45 / ML 15: min = 9 + 15×4.6 + 32 = 110; max = 9 + 15×7.4 + 48 = 168.
      expect(Number(hit.payload.amount)).toBeGreaterThanOrEqual(110);
      expect(Number(hit.payload.amount)).toBeLessThanOrEqual(168);
    }
  });
});