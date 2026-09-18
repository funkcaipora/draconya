import { createElement, type ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorldOverlay } from './WorldOverlay.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue, PartyView } from '../state/hud.js';
import { world } from '../state/world.js';
import type { Creature } from '../state/world.js';

const mockCatalogue: Catalogue = {
  hunts: [{
    id: 'rat-cellars',
    name: 'Rat Cellars',
    recommendedLevel: 1,
    lootDrops: 2,
    outfitIds: [],
    difficulties: ['cautious', 'bold', 'reckless'],
    difficultyDetails: [
      { id: 'cautious', monsterCount: 2 },
      { id: 'bold', monsterCount: 5 },
      { id: 'reckless', monsterCount: 8 },
    ],
    monsters: [],
    loot: [],
  }],
  monsters: [],
  ammunition: [],
  bot: {
    vocabularyVersion: 1,
    advancedFromLevel: 50,
    slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [],
    supplies: [],
  },
  items: [],
  vocations: [],
  vocationLevel: 8,
};

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

describe('WorldOverlay (#327, #348, RC-14, SV-12)', () => {
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
      party: party([{ characterId: 'c1', name: 'Companheiro', alive: true, healthPercent: 100, vocationId: null }]),
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

  it('shows the hunt name and difficulty when present in hud and catalogue (#348, SV-12)', async () => {
    hud.set((state) => ({ ...state, huntId: 'rat-cellars', difficulty: 'cautious', catalogue: mockCatalogue }));

    const html = await render(createElement(WorldOverlay, { hunting: true }));

    expect(html).toContain('Rat Cellars · Cauteloso');
    expect(html).toContain('world-overlay-area');
    expect(html).toContain('0 criaturas no alcance');
  });

  it('without hud.huntId, does not render the hunt line, only the count', async () => {
    hud.set((state) => ({ ...state, huntId: null, difficulty: 'cautious', catalogue: mockCatalogue }));

    const html = await render(createElement(WorldOverlay, { hunting: true }));

    expect(html).not.toContain('Rat Cellars');
    expect(html).not.toContain('Cauteloso');
    expect(html).toContain('0 criaturas no alcance');
  });

  it('when hud.huntId is not in the catalogue (reconnect swapped it), does not render the hunt line', async () => {
    hud.set((state) => ({ ...state, huntId: 'unknown-hunt', difficulty: 'cautious', catalogue: mockCatalogue }));

    const html = await render(createElement(WorldOverlay, { hunting: true }));

    expect(html).not.toContain('Cauteloso');
    expect(html).toContain('0 criaturas no alcance');
  });
});
