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
    id,
    appearanceId: 100,
    name: `rat-${String(id)}`,
    health: 20,
    maxHealth: 20,
    position: { x: 0, y: 0, z: 7 },
    step: null,
    ...over,
  };
}

function party(members: PartyView['members']): PartyView {
  return {
    leaderId: members[0]?.characterId ?? 'nobody',
    mode: 'split',
    members,
  };
}

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
  world.creatures.clear();
  world.selfId = null;
});

describe('WorldOverlay (#327, RC-14)', () => {
  it('shows the fixed city text outside a hunt', async () => {
    const html = await render(createElement(WorldOverlay, { hunting: false }));

    expect(html).toContain('Cidade · zona protegida');
    expect(html).toContain('a praça não credita nada');
    expect(html).not.toContain('Bênção');
  });

  it('shows the count derived from world.creatures during a hunt', async () => {
    world.selfId = 1;
    world.creatures.set(1, creature(1, { name: 'você' }));
    world.creatures.set(2, creature(2, { name: 'Rat' }));
    world.creatures.set(3, creature(3, { name: 'Bat' }));
    world.creatures.set(4, creature(4, { name: 'Troll' }));

    const html = await render(createElement(WorldOverlay, { hunting: true }));

    expect(html).toContain('3 criaturas no alcance');
    expect(html).not.toContain('zona protegida');
  });

  it('keeps a zero count during a hunt instead of falling back to city text', async () => {
    world.selfId = 1;
    world.creatures.set(1, creature(1, { name: 'você' }));

    const html = await render(createElement(WorldOverlay, { hunting: true }));

    expect(html).toContain('0 criaturas no alcance');
    expect(html).not.toContain('zona protegida');
  });

  it('does not count a visible party member', async () => {
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

  it('never invents a hunt name or difficulty', async () => {
    const html = await render(createElement(WorldOverlay, { hunting: true }));

    expect(html).not.toContain('Covil');
    expect(html).not.toContain('Ousado');
    expect(html).not.toContain('Bênção');
  });
});
