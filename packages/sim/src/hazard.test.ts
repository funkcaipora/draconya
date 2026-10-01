// O registro de Hazard do personagem (M44-14, #632, ADR 0052 d.1): o nível máximo desbloqueado e o
// escolhido de cada zona, com os números de `data/libs/systems/hazard.lua` do Canary (`47dfd51`).

import type { HazardZone } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { HAZARD_STATE_VERSION, HazardProgress, emptyHazardState, isHazardState } from './hazard.js';

/** A zona do Canary (`hazard_primal.lua`): níveis de 1 a 12. */
const GARDENS: HazardZone = {
  name: 'Gnomprona Gardens', minLevel: 1, maxLevel: 12,
  crit: true, dodge: true, damageBoost: true, defenseBoost: true,
};
const ID = 'gnomprona-gardens';

describe('o personagem que nunca pisou numa zona de hazard', () => {
  it('vale o minLevel, no nível escolhido e no teto', () => {
    const progress = HazardProgress.fromState();
    expect(progress.isEmpty).toBe(true);
    expect(progress.maxLevelOf(ID, GARDENS)).toBe(1);
    expect(progress.currentLevelOf(ID, GARDENS)).toBe(1);
  });

  it('o minLevel da zona é o piso, mesmo quando o registro guarda zero ou menos', () => {
    const zone = { ...GARDENS, minLevel: 3 };
    const progress = HazardProgress.fromState({
      maxLevel: { [ID]: 0 }, currentLevel: { [ID]: -2 }, version: HAZARD_STATE_VERSION,
    });
    expect(progress.maxLevelOf(ID, zone)).toBe(3);
    expect(progress.currentLevelOf(ID, zone)).toBe(3);
  });
});

describe('escolher o nível (Hazard:setPlayerCurrentLevel)', () => {
  it('recusa acima do teto desbloqueado e abaixo do minLevel, e aceita o nível em que já está', () => {
    const progress = HazardProgress.fromState({
      maxLevel: { [ID]: 5 }, currentLevel: {}, version: HAZARD_STATE_VERSION,
    });
    expect(progress.select(ID, GARDENS, 6)).toEqual({ ok: false, reason: 'above-maximum' });
    expect(progress.select(ID, GARDENS, 0)).toEqual({ ok: false, reason: 'below-minimum' });
    expect(progress.select(ID, GARDENS, -3)).toEqual({ ok: false, reason: 'below-minimum' });
    expect(progress.select(ID, GARDENS, 2.5)).toEqual({ ok: false, reason: 'invalid-level' });
    expect(progress.select(ID, GARDENS, Number.NaN)).toEqual({ ok: false, reason: 'invalid-level' });
    expect(progress.select(ID, undefined, 1)).toEqual({ ok: false, reason: 'unknown-zone' });
    expect(progress.currentLevelOf(ID, GARDENS)).toBe(1);

    expect(progress.select(ID, GARDENS, 5)).toEqual({ ok: true, level: 5 });
    expect(progress.currentLevelOf(ID, GARDENS)).toBe(5);
    expect(progress.select(ID, GARDENS, 5)).toEqual({ ok: true, level: 5 });
    expect(progress.select(ID, GARDENS, 1)).toEqual({ ok: true, level: 1 });
    expect(progress.currentLevelOf(ID, GARDENS)).toBe(1);
  });

  it('a recusa não escreve nada', () => {
    const progress = HazardProgress.fromState();
    progress.select(ID, GARDENS, 9);
    expect(progress.isEmpty).toBe(true);
  });

  it('o que um objeto comum herda NÃO é zona: quem resolve a zona por `zones[zoneId]` pode passar isso', () => {
    // `zones` vem de um `z.record` — um objeto comum —, então `zones['constructor']` é uma função e
    // `zones['__proto__']` é `Object.prototype`. Nenhum dos dois tem `minLevel`/`maxLevel`.
    const zones: Record<string, HazardZone> = { [ID]: GARDENS };
    const progress = HazardProgress.fromState();
    for (const zoneId of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(progress.select(zoneId, zones[zoneId], 999), zoneId).toEqual({ ok: false, reason: 'unknown-zone' });
    }
    expect(progress.isEmpty).toBe(true);
    expect(progress.getState().currentLevel).toEqual({});
  });
});

describe('subir o teto (Hazard:levelUp)', () => {
  it('só sobe quando o nível escolhido é o teto', () => {
    const progress = HazardProgress.fromState();
    // Nível 1 escolhido, teto 1: sobe para 2.
    expect(progress.levelUp(ID, GARDENS)).toBe(true);
    expect(progress.maxLevelOf(ID, GARDENS)).toBe(2);
    // Escolheu o 1 com o teto em 2: matar o chefe não sobe nada.
    expect(progress.levelUp(ID, GARDENS)).toBe(false);
    expect(progress.maxLevelOf(ID, GARDENS)).toBe(2);
    // Escolheu o teto: sobe.
    progress.select(ID, GARDENS, 2);
    expect(progress.levelUp(ID, GARDENS)).toBe(true);
    expect(progress.maxLevelOf(ID, GARDENS)).toBe(3);
  });

  it('nunca passa do maxLevel da zona', () => {
    const progress = HazardProgress.fromState({
      maxLevel: { [ID]: 12 }, currentLevel: { [ID]: 12 }, version: HAZARD_STATE_VERSION,
    });
    expect(progress.levelUp(ID, GARDENS)).toBe(false);
    expect(progress.maxLevelOf(ID, GARDENS)).toBe(12);
  });

  it('o conteúdo que encolhe a zona limita o que o jogador já tinha desbloqueado', () => {
    const progress = HazardProgress.fromState({
      maxLevel: { [ID]: 12 }, currentLevel: { [ID]: 12 }, version: HAZARD_STATE_VERSION,
    });
    const smaller = { ...GARDENS, maxLevel: 8 };
    expect(progress.maxLevelOf(ID, smaller)).toBe(8);
    expect(progress.currentLevelOf(ID, smaller)).toBe(8);
  });
});

describe('o registro persistido', () => {
  it('vai e volta pelo estado, sem compartilhar a cópia', () => {
    const progress = HazardProgress.fromState();
    progress.levelUp(ID, GARDENS);
    progress.select(ID, GARDENS, 2);
    const state = progress.getState();
    expect(state).toEqual({
      maxLevel: { [ID]: 2 }, currentLevel: { [ID]: 2 }, version: HAZARD_STATE_VERSION,
    });
    progress.levelUp(ID, GARDENS);
    expect(state.maxLevel[ID]).toBe(2);
    expect(HazardProgress.fromState(state).maxLevelOf(ID, GARDENS)).toBe(2);
  });

  it('isHazardState confere a FORMA, e recusa o torto', () => {
    expect(isHazardState(emptyHazardState())).toBe(true);
    expect(isHazardState({ maxLevel: { a: 3 }, currentLevel: { a: 2 }, version: 1 })).toBe(true);
    expect(isHazardState(null)).toBe(false);
    expect(isHazardState([])).toBe(false);
    expect(isHazardState({ maxLevel: {}, currentLevel: {} })).toBe(false);
    expect(isHazardState({ maxLevel: { a: 0 }, currentLevel: {}, version: 1 })).toBe(false);
    expect(isHazardState({ maxLevel: { a: 1.5 }, currentLevel: {}, version: 1 })).toBe(false);
    expect(isHazardState({ maxLevel: { '': 1 }, currentLevel: {}, version: 1 })).toBe(false);
    expect(isHazardState({ maxLevel: {}, currentLevel: { a: '2' }, version: 1 })).toBe(false);
    expect(isHazardState({ maxLevel: [], currentLevel: {}, version: 1 })).toBe(false);
  });
});
