import { createElement, type ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { BattlePanel, battleTone } from './BattlePanel.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { PartyView } from '../state/hud.js';
import { world } from '../state/world.js';
import type { Creature } from '../state/world.js';

/**
 * A árvore em HTML, sem DOM, como em `Bestiary.test.ts`: `prerender` roda a função do
 * componente e pula os efeitos (o `setInterval` do painel nunca dispara aqui).
 */
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

const party = (members: PartyView['members']): PartyView => ({
  leaderId: members[0]?.characterId ?? 'nobody',
  mode: 'split',
  members,
});

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
  world.creatures.clear();
  world.selfId = null;
});

describe('o painel Batalha (#254)', () => {
  it('lista as criaturas fora do próprio e fora da party, cada uma com nome e HP %', async () => {
    world.selfId = 3;
    world.creatures.set(1, creature(1, { name: 'Rat', health: 10, maxHealth: 20 }));
    world.creatures.set(2, creature(2, { name: 'Bat', health: 20, maxHealth: 20 }));
    world.creatures.set(3, creature(3, { name: 'você' }));

    const html = await render(createElement(BattlePanel));

    expect(html).toContain('Batalha · 2');
    expect(html).toContain('Rat');
    expect(html).toContain('50 %');
    expect(html).toContain('Bat');
    expect(html).toContain('100 %');
    expect(html).not.toContain('você');
  });

  it('sem outra criatura visível (a Cidade, sozinho), mostra a mensagem vazia e o título zerado', async () => {
    world.selfId = 1;
    world.creatures.set(1, creature(1, { name: 'você' }));

    const html = await render(createElement(BattlePanel));

    expect(html).toContain('Batalha · 0');
    expect(html).toContain('Nenhuma criatura à vista.');
  });

  it('quem está na party não aparece na lista de Batalha (RF-05)', async () => {
    world.selfId = 99;
    world.creatures.set(1, creature(1, { name: 'Companheiro' }));
    world.creatures.set(2, creature(2, { name: 'Rat' }));
    hud.set((state) => ({
      ...state,
      party: party([
        { characterId: 'c1', name: 'Companheiro', alive: true, healthPercent: 100, vocationId: null },
      ]),
    }));

    const html = await render(createElement(BattlePanel));

    expect(html).toContain('Batalha · 1');
    expect(html).toContain('Rat');
    expect(html).not.toContain('Companheiro');
  });

  it('battleTone: o limite é ">", não ">="', () => {
    expect(battleTone(61)).toBe('ok');
    expect(battleTone(60)).toBe('warn');
    expect(battleTone(31)).toBe('warn');
    expect(battleTone(30)).toBe('danger');
    expect(battleTone(0)).toBe('danger');
  });

  it('criatura com maxHealth 0 sai com percent 0, sem NaN na tela', async () => {
    world.selfId = null;
    world.creatures.set(1, creature(1, { name: 'Corpse', health: 0, maxHealth: 0 }));

    const html = await render(createElement(BattlePanel));

    expect(html).toContain('Corpse');
    expect(html).toContain('0 %');
    expect(html).not.toContain('NaN');
  });
});
