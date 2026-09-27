import { describe, expect, it } from 'vitest';
import { buildSceneryIndex, classifyByAttributes } from './scenery.js';
import type { CanaryTables } from './scenery.js';
import type { OtbmItem } from './otbm.js';

const item = (id: number, extra: Partial<OtbmItem> = {}): OtbmItem => ({ id, ...extra });

const tables: CanaryTables = {
  id: 'canary-test',
  source: 'fixture',
  doors: {
    locked: [{ locked: 1628, closed: 1629, open: 1630 }],
    common: [{ closed: 1638, open: 1639 }],
    quest: [{ closed: 1642, open: 1643 }],
    level: [{ closed: 1646, open: 1647 }],
  },
  grass: [{ uncut: 3696, cut: 3695, durationSec: 300 }],
  stonePiles: [{ pile: 593, hole: 594, durationSec: 60 }],
  ropeSpots: { ground: [386], special: [12935] },
  ladders: [1968],
  levers: [2772, 2773],
};

describe('buildSceneryIndex', () => {
  it('classifica os dois lados de cada porta, pelo id do estado CLOSED', () => {
    const index = buildSceneryIndex(tables);
    expect(index.classifyItem(item(1629))).toEqual({
      kind: 'locked-door', initialState: 'closed', appearanceKey: 'locked-door-1629',
    });
    expect(index.classifyItem(item(1630))).toEqual({
      kind: 'locked-door', initialState: 'open', appearanceKey: 'locked-door-1629',
    });
    expect(index.classifyItem(item(1628))).toEqual({
      kind: 'locked-door', initialState: 'locked', appearanceKey: 'locked-door-1629',
    });
    expect(index.staticAppearances['locked-door-1629']).toEqual({ locked: 1628, closed: 1629, open: 1630 });
  });

  it('porta comum não tem estado `locked`, e o par fica só closed/open', () => {
    const index = buildSceneryIndex(tables);
    expect(index.staticAppearances['door-1638']).toEqual({ closed: 1638, open: 1639 });
    expect(index.classifyItem(item(1638))?.kind).toBe('door');
  });

  it('capim exige machete e o estado cortado carrega revertMs do duration', () => {
    const index = buildSceneryIndex(tables);
    expect(index.classifyItem(item(3696))).toEqual({
      kind: 'grass', initialState: 'uncut', appearanceKey: 'grass-3696', requiresTool: 'machete',
    });
    expect(index.classifyItem(item(3695))).toEqual({
      kind: 'grass', initialState: 'cut', appearanceKey: 'grass-3696', requiresTool: 'machete',
      revertMs: 300_000,
    });
  });

  it('stone pile exige shovel e o buraco reverte pelo duration', () => {
    const index = buildSceneryIndex(tables);
    expect(index.classifyItem(item(593))?.requiresTool).toBe('shovel');
    expect(index.classifyItem(item(594))?.revertMs).toBe(60_000);
  });

  it('rope spot classifica por CHÃO (ground) e por item (special)', () => {
    const index = buildSceneryIndex(tables);
    expect(index.classifyGround(386)).toEqual({
      kind: 'rope-spot', initialState: 'default', appearanceKey: 'rope-spot-386', requiresTool: 'rope',
    });
    expect(index.classifyItem(item(12935))).toEqual({
      kind: 'rope-spot', initialState: 'default', appearanceKey: 'rope-spot-12935', requiresTool: 'rope',
    });
  });

  it('ladder não exige ferramenta', () => {
    const index = buildSceneryIndex(tables);
    expect(index.classifyItem(item(1968))).toEqual({
      kind: 'ladder', initialState: 'default', appearanceKey: 'ladder-1968',
    });
  });

  it('alavanca é UM par global — 2772 e 2773 apontam a mesma `appearanceKey`', () => {
    const index = buildSceneryIndex(tables);
    expect(index.classifyItem(item(2772))).toEqual({ kind: 'lever', initialState: 'down', appearanceKey: 'lever' });
    expect(index.classifyItem(item(2773))).toEqual({ kind: 'lever', initialState: 'up', appearanceKey: 'lever' });
    expect(index.staticAppearances.lever).toEqual({ down: 2772, up: 2773 });
  });

  it('interactiveIds cobre todo id classificado, dos dois estados', () => {
    const index = buildSceneryIndex(tables);
    for (const id of [1628, 1629, 1630, 1638, 1639, 3696, 3695, 593, 594, 386, 12935, 1968, 2772, 2773]) {
      expect(index.interactiveIds.has(id)).toBe(true);
    }
    expect(index.interactiveIds.has(9999)).toBe(false);
  });

  it('id que não está em tabela nenhuma não classifica', () => {
    const index = buildSceneryIndex(tables);
    expect(index.classifyItem(item(9999))).toBeNull();
    expect(index.classifyGround(9999)).toBeNull();
  });
});

describe('classifyByAttributes', () => {
  it('uid classifica baú', () => {
    expect(classifyByAttributes(item(2854, { uniqueId: 500 }))).toEqual({
      kind: 'chest', initialState: 'default', appearanceKey: 'chest-2854',
    });
  });

  it('text classifica placa', () => {
    expect(classifyByAttributes(item(1950, { text: 'You see a sign.' }))).toEqual({
      kind: 'sign', initialState: 'default', appearanceKey: 'sign-1950',
    });
  });

  it('teleportDestination classifica teleporte', () => {
    expect(classifyByAttributes(item(1387, { teleportDestination: { x: 1, y: 2, z: 3 } }))).toEqual({
      kind: 'teleport', initialState: 'default', appearanceKey: 'teleport-1387',
    });
  });

  it('uid tem prioridade sobre text quando o item (incomum) carrega os dois', () => {
    expect(classifyByAttributes(item(1, { uniqueId: 1, text: 'x' }))?.kind).toBe('chest');
  });

  it('aid sozinho não classifica nada — só as tabelas do Canary decidem alavanca', () => {
    expect(classifyByAttributes(item(1, { actionId: 100 }))).toBeNull();
  });

  it('item comum, sem nenhum atributo, não classifica', () => {
    expect(classifyByAttributes(item(1))).toBeNull();
  });
});
