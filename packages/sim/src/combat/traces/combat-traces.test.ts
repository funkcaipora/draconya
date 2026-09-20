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
import { spellTraces } from './spells.trace.js';
import { healingGaps, healingTraces } from './healing.trace.js';
import {
  CANARY_CIRCLE_RADIUS_3_TILES, avalancheTrace, circleRadiusThreeTiles, runesGaps,
} from './runes.trace.js';
import { DAMAGE_ELEMENT_ORACLE, damageEventOrderTrace, resolveOracleCase } from './damage.trace.js';
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

  it('toda lacuna do M24 nomeia a issue que a fecha', () => {
    // As lacunas de ALVO que existiam na #469 foram fechadas pela #470 (protocolo e
    // cancelamento), e o trace deixou de carregá-las. As que restam são de outras issues.
    const all: readonly CombatTraceGap[] = [
      ...healingGaps, ...runesGaps,
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const gap of all) expect(gap.task).toMatch(/^#\d+$/);
  });
});