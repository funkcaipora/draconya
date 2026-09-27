import { afterEach, describe, expect, it } from 'vitest';
import type { C2SMessage } from '@draconya/protocol';
import { setConnection } from '../net/current.js';
import { enterInstance, world } from '../state/world.js';
import { cancelTileApproach, pendingTileApproach, requestTileUse, tick } from './tile-approach.js';

// A casca do pedido de usar um tile sozinho (#729, ADR 0050 d.7) — espelha o precedente de
// `corpse-approach.ts` (#722/#749): guarda o pedido, manda `walk-to` na hora, e `tick` decide
// quando mandar `use-on-map` de verdade.

function sent(): C2SMessage[] {
  const list: C2SMessage[] = [];
  setConnection({ send: (m) => { list.push(m); } });
  return list;
}

function putSelf(id: number, position: { x: number; y: number; z: number }): void {
  world.selfId = id;
  world.creatures.set(id, {
    id, appearanceId: 1, name: 'hero', health: 1, maxHealth: 1, position, step: null,
  });
}

afterEach(() => {
  cancelTileApproach();
  setConnection(null);
  enterInstance('i', 'm');
});

describe('requestTileUse', () => {
  it('manda walk-to na hora e guarda o pedido', () => {
    const messages = sent();
    requestTileUse({ x: 4, y: 2, z: 7 }, 0);
    expect(messages[0]).toEqual({ type: 'walk-to', destination: { x: 4, y: 2, z: 7 } });
    expect(pendingTileApproach()).toMatchObject({ position: { x: 4, y: 2, z: 7 } });
  });

  it('já adjacente, o próprio requestTileUse manda use-on-map na hora — sem esperar o laço', () => {
    putSelf(1, { x: 4, y: 1, z: 7 });
    const messages = sent();
    requestTileUse({ x: 4, y: 2, z: 7 }, 0);
    expect(messages.some((m) => m.type === 'use-on-map')).toBe(true);
    expect(pendingTileApproach()).toBeNull();
  });

  it('clicar em outro tile SUBSTITUI o pedido em curso, nunca acumula', () => {
    requestTileUse({ x: 4, y: 2, z: 7 }, 0);
    requestTileUse({ x: 1, y: 1, z: 7 }, 0);
    expect(pendingTileApproach()).toMatchObject({ position: { x: 1, y: 1, z: 7 } });
  });
});

describe('tick', () => {
  it('manda use-on-map quando o personagem chega perto, e limpa o pedido', () => {
    const messages = sent();
    requestTileUse({ x: 4, y: 2, z: 7 }, 0);
    putSelf(1, { x: 4, y: 1, z: 7 });
    tick(1_000);
    expect(messages.some((m) => m.type === 'use-on-map' && m.position.x === 4 && m.position.y === 2))
      .toBe(true);
    expect(pendingTileApproach()).toBeNull();
  });

  it('não manda nada enquanto o personagem ainda está longe', () => {
    const messages = sent();
    requestTileUse({ x: 4, y: 2, z: 7 }, 0);
    putSelf(1, { x: 0, y: 0, z: 7 });
    messages.length = 0;
    tick(1_000);
    expect(messages.some((m) => m.type === 'use-on-map')).toBe(false);
    expect(pendingTileApproach()).not.toBeNull();
  });

  it('desiste em silêncio depois do prazo — nunca vira system-message', () => {
    const messages = sent();
    requestTileUse({ x: 4, y: 2, z: 7 }, 0);
    messages.length = 0;
    tick(20_000);
    expect(messages).toHaveLength(0);
    expect(pendingTileApproach()).toBeNull();
  });
});

describe('cancelTileApproach', () => {
  it('apaga o pedido sem mandar nada', () => {
    const messages = sent();
    requestTileUse({ x: 4, y: 2, z: 7 }, 0);
    messages.length = 0;
    cancelTileApproach();
    tick(1_000);
    expect(messages).toHaveLength(0);
    expect(pendingTileApproach()).toBeNull();
  });
});
