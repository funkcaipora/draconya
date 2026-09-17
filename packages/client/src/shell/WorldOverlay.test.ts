import { createElement, type ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorldOverlay } from './WorldOverlay.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { PartyView } from '../state/hud.js';
import { world } from '../state/world.js';
import type { Creature } from '../state/world.js';

async function render(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element);
  return new Response(prelude).text();
}

function creature(id: number, over: Partial<Creature> = {}): Creature {
  return {
    id, appearanceId: 100, name: `rat-${String(id)}`, health: 20, maxHealth: 20,
    position: { x: 0, y: 0, z: 7 }, step: null, ...over,
  };
}

const party = (
  members: Array<
    Omit<PartyView['members'][number], 'vocationId'> & { vocationId?: string | null }
  >,
): PartyView => ({
  leaderId: members[0]?.characterId ?? 'nobody',
  mode: 'split',
  members: members.map((m) => ({
    vocationId: null,
    ...m,
  })),
});

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
  world.creatures.clear();
  world.selfId = null;
});

describe('o overlay de área e criaturas (#327, RC-14)', () => {
  it('fora de hunt, mostra o texto fixo da Cidade', async () => {
    const html = await render(createElement(WorldOverlay, { hunting: false }));
    expect(html).toContain('Cidade · zona protegida');
    expect(html).toContain('a praça não credita nada');
    expect(html).not.toContain('Bênção');
  });

  it('numa hunt, mostra a contagem derivada de world.creatures', async () => {
    world.selfId = 1;
    world.creatures.set(1, creature(1, { name: 'você' }));
    world.creatures.set(2, creature(2, { name: 'Rat' }));
    world.creatures.set(3, creature(3, { name: 'Bat' }));
    world.creatures.set(4, creature(4, { name: 'Troll' }));

    const html = await render(createElement(WorldOverlay, { hunting: true }));

    expect(html).toContain('3 criaturas no alcance');
    expect(html).not.toContain('zona protegida');
  });

  it('numa hunt sem criaturas visíveis, mostra "0", nunca o texto de Cidade (DT-01)', async () => {
    world.selfId = 1;
    world.creatures.set(1, creature(1, { name: 'você' }));

    const html = await render(createElement(WorldOverlay, { hunting: true }));

    expect(html).toContain('0 criaturas no alcance');
    expect(html).not.toContain('zona protegida');
  });

  it('quem está na party não conta (mesma exclusão de BattlePanel)', async () => {
    world.selfId = 99;
    world.creatures.set(1, creature(1, { name: 'Companheiro' }));
    world.creatures.set(2, creature(2, { name: 'Rat' }));
    hud.set((state) => ({
      ...state,
      party: party([{ characterId: 'c1', name: 'Companheiro', alive: true, healthPercent: 100 }]),
    }));

    const html = await render(createElement(WorldOverlay, { hunting: true }));

    expect(html).toContain('1 criaturas no alcance');
  });

  it('nenhum estado mostra nome de hunt ou dificuldade inventados', async () => {
    const html = await render(createElement(WorldOverlay, { hunting: true }));
    expect(html).not.toContain('Covil');
    expect(html).not.toContain('Ousado');
  });
});
