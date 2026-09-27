// A casca com estado do pedido de abrir cadáver (#722, ADR 0048 d.4 — ajuste do DT-01). A
// decisão em si tem teste próprio, puro, em `world/corpse-approach.test.ts`; aqui se prende a
// FIAÇÃO — o que entra no `world` e sai pelo `sendIntent`.

import type { C2SMessage } from '@draconya/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { setConnection } from '../net/current.js';
import { world } from '../state/world.js';
import { cancelCorpseApproach, pendingCorpseApproach, requestCorpseApproach, tick } from './corpse-approach.js';

function spySender(): { sent: C2SMessage[] } {
  const sent: C2SMessage[] = [];
  setConnection({ send: (message) => { sent.push(message); } });
  return { sent };
}

beforeEach(() => {
  cancelCorpseApproach();
  world.selfId = null;
  world.creatures.clear();
  world.groundItems.clear();
  setConnection(null);
});

describe('requestCorpseApproach (#722)', () => {
  it('manda walk-to na hora, e guarda o pedido', () => {
    const { sent } = spySender();
    world.groundItems.set(7, { id: 7, position: { x: 10, y: 10, z: 7 }, appearanceId: 1 });

    requestCorpseApproach(7, { x: 10, y: 10, z: 7 }, 1_000);

    expect(sent).toEqual([{ type: 'walk-to', destination: { x: 10, y: 10, z: 7 } }]);
    expect(pendingCorpseApproach()).toEqual({
      groundItemId: 7, position: { x: 10, y: 10, z: 7 }, requestedAtMs: 1_000,
    });
  });

  it('já adjacente: manda open-corpse na hora, sem esperar o próximo tick', () => {
    const { sent } = spySender();
    world.selfId = 1;
    world.creatures.set(1, {
      id: 1, appearanceId: 1, name: 'hero', health: 1, maxHealth: 1,
      position: { x: 10, y: 9, z: 7 }, step: null,
    });
    world.groundItems.set(7, { id: 7, position: { x: 10, y: 10, z: 7 }, appearanceId: 1 });

    requestCorpseApproach(7, { x: 10, y: 10, z: 7 }, 1_000);

    expect(sent).toEqual([
      { type: 'walk-to', destination: { x: 10, y: 10, z: 7 } },
      { type: 'open-corpse', groundItemId: 7 },
    ]);
    expect(pendingCorpseApproach()).toBeNull();
  });

  it('clicar em outro cadáver SUBSTITUI o pedido, nunca acumula', () => {
    world.groundItems.set(7, { id: 7, position: { x: 10, y: 10, z: 7 }, appearanceId: 1 });
    world.groundItems.set(8, { id: 8, position: { x: 20, y: 20, z: 7 }, appearanceId: 1 });
    requestCorpseApproach(7, { x: 10, y: 10, z: 7 }, 1_000);
    requestCorpseApproach(8, { x: 20, y: 20, z: 7 }, 1_100);
    expect(pendingCorpseApproach()?.groundItemId).toBe(8);
  });
});

describe('tick (#722)', () => {
  it('espera enquanto longe, manda quando o world diz que o personagem chegou', () => {
    const { sent } = spySender();
    world.groundItems.set(7, { id: 7, position: { x: 10, y: 10, z: 7 }, appearanceId: 1 });
    world.selfId = 1;
    world.creatures.set(1, {
      id: 1, appearanceId: 1, name: 'hero', health: 1, maxHealth: 1,
      position: { x: 0, y: 0, z: 7 }, step: null,
    });
    requestCorpseApproach(7, { x: 10, y: 10, z: 7 }, 1_000);
    sent.length = 0; // só o walk-to inicial; limpa para isolar o que o tick manda.

    tick(1_100);
    expect(sent).toEqual([]);
    expect(pendingCorpseApproach()).not.toBeNull();

    // O personagem "andou" — o world é quem o timer de useCorpseKeys.ts atualizaria via
    // `creature-move`; aqui simula a chegada direto.
    world.creatures.get(1)!.position = { x: 10, y: 9, z: 7 };
    tick(1_200);
    expect(sent).toEqual([{ type: 'open-corpse', groundItemId: 7 }]);
    expect(pendingCorpseApproach()).toBeNull();
  });

  it('cancela quando o cadáver decai antes de o personagem chegar', () => {
    const { sent } = spySender();
    world.groundItems.set(7, { id: 7, position: { x: 10, y: 10, z: 7 }, appearanceId: 1 });
    requestCorpseApproach(7, { x: 10, y: 10, z: 7 }, 1_000);
    sent.length = 0;

    world.groundItems.delete(7);
    tick(1_100);

    expect(sent).toEqual([]);
    expect(pendingCorpseApproach()).toBeNull();
  });

  it('cancela depois do prazo — o cliente desiste, sem system-message nenhum', () => {
    const { sent } = spySender();
    world.groundItems.set(7, { id: 7, position: { x: 10, y: 10, z: 7 }, appearanceId: 1 });
    requestCorpseApproach(7, { x: 10, y: 10, z: 7 }, 1_000);
    sent.length = 0;

    tick(1_000 + 10_000 + 1);

    expect(sent).toEqual([]);
    expect(pendingCorpseApproach()).toBeNull();
  });

  it('sem pedido pendente, tick não manda nada', () => {
    const { sent } = spySender();
    tick(1_000);
    expect(sent).toEqual([]);
  });
});

describe('cancelCorpseApproach (#722)', () => {
  it('limpa o pedido sem mandar nada — quem cancela é o teclado ou outro clique', () => {
    const { sent } = spySender();
    world.groundItems.set(7, { id: 7, position: { x: 10, y: 10, z: 7 }, appearanceId: 1 });
    requestCorpseApproach(7, { x: 10, y: 10, z: 7 }, 1_000);
    sent.length = 0;

    cancelCorpseApproach();
    tick(2_000);

    expect(pendingCorpseApproach()).toBeNull();
    expect(sent).toEqual([]);
  });
});
