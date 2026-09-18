import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { VocationChoice } from './VocationChoice.js';
import { resolveChosenVocationId } from './VocationChoice.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

// A escolha de vocação (#154): o diálogo existe pelo ESTADO — level, vocação e catálogo — e
// nunca por um número em código. `prerender` roda a função do componente sem DOM; o que se
// prende é se ele devolve algo e o que ele escreve.

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(VocationChoice));
  return new Response(prelude).text();
}

const catalogue: Catalogue = {
  hunts: [], monsters: [],
  bot: {
    vocabularyVersion: 1, slots: {},
    spells: [], supplies: [],
  },
  items: [{ id: 'steel-axe', name: 'Steel Axe', appearanceId: 3264, weight: 41, slot: 'hand', twoHanded: false }],
  vocations: [
    { id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25, startingWeaponItemId: 'steel-axe' },
    { id: 'paladin', name: 'Paladin', healthPerLevel: 10, manaPerLevel: 15, capacityPerLevel: 20, startingWeaponItemId: 'bow' },
    { id: 'sorcerer', name: 'Sorcerer', healthPerLevel: 5, manaPerLevel: 30, capacityPerLevel: 10, startingWeaponItemId: 'wand-of-vortex' },
    { id: 'druid', name: 'Druid', healthPerLevel: 5, manaPerLevel: 30, capacityPerLevel: 10, startingWeaponItemId: 'snakebite-rod' },
  ],
  vocationLevel: 8,
};

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue, level: 8, vocationId: null }));
});

describe('VocationChoice', () => {
  it('shows the four cards at the vocation level, with gains and the starting weapon', async () => {
    const html = await render();
    expect(html).toContain('escolha de vocação');
    expect((html.match(/class="vocation-card"/g) ?? []).length).toBe(4);
    expect(html).toContain('+15 HP · +5 mana · +25 cap por level');
    // A arma vem do catálogo de itens; a que não está lá mostra o id, e o jogo segue.
    expect(html).toContain('Steel Axe');
    expect(html).toContain('snakebite-rod');
  });

  it('does not exist below the level, after the choice, without a catalogue, or from an older node', async () => {
    // Mutação que mata: trocar `level < vocationLevel` por `<=`, ou abrir com `vocationLevel` 0.
    hud.set((state) => ({ ...state, level: 7 }));
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, level: 8, vocationId: 'knight' }));
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, vocationId: null, catalogue: null }));
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, catalogue: { ...catalogue, vocationLevel: 0 } }));
    expect(await render()).toBe('');
  });

  it('never carries the level in code: raising vocationLevel in the catalogue moves the dialog', async () => {
    hud.set((state) => ({ ...state, level: 8, catalogue: { ...catalogue, vocationLevel: 10 } }));
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, level: 10 }));
    expect(await render()).toContain('vocation-card');
  });

  // --- Casos novos (#249): Modal + cartões do design system, seleção em duas etapas -------

  it('renders no element badge, even with a real vocation catalogue (RF-03)', async () => {
    const html = await render();
    expect(html).not.toContain('Badge');
  });

  it('renders no inline style on any of the four vocation-card buttons (RF-07)', async () => {
    const html = await render();
    const buttons = html.match(/<button[^>]*class="vocation-card"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(buttons.length).toBe(4);
    for (const button of buttons) expect(button).not.toContain('style="');
  });

  it('Modal.onClose is a no-op — the choice cannot be closed before choosing (RF-05)', async () => {
    const source = await readFile(new URL('./VocationChoice.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onClose={() => {}}');
  });

  it('sendIntent is wired only to the FORJAR button, never to a card click (RF-04)', async () => {
    // Regressão vigiada: o comportamento antigo mandava `choose-vocation` no clique do
    // cartão. `prerender` não dispara clique (Node sem DOM), então a garantia aqui é
    // estrutural — como `resolveChosenVocationId` abaixo prova o cálculo em si.
    const source = await readFile(new URL('./VocationChoice.tsx', import.meta.url), 'utf8');
    const occurrences = source.match(/sendIntent\(/g) ?? [];
    expect(occurrences.length).toBe(1);
    const footerIndex = source.indexOf('footer={');
    const cardOnClickIndex = source.indexOf("onClick={() => { setSelected(vocation.id); }}");
    const sendIntentIndex = source.indexOf('sendIntent(');
    expect(footerIndex).toBeGreaterThan(-1);
    expect(cardOnClickIndex).toBeGreaterThan(-1);
    // O `footer` (com o "FORJAR") vem ANTES da grade de cartões na árvore JSX — é uma prop do
    // `Modal`, passada antes dos `children`. O único `sendIntent` fica DEPOIS do rodapé
    // começar e ANTES do clique do cartão aparecer no código-fonte — ou seja, dentro do
    // `Button` do rodapé, nunca dentro do `onClick` do cartão.
    expect(sendIntentIndex).toBeGreaterThan(footerIndex);
    expect(sendIntentIndex).toBeLessThan(cardOnClickIndex);
  });

  it('renders role short and full description for each vocation in order (R1-18)', async () => {
    const html = await render();
    // Papel curto
    expect(html).toContain('Tanque · corpo a corpo');
    expect(html).toContain('Dano à distância · Sagrado');
    expect(html).toContain('Suporte e cura · Gelo e Terra');
    expect(html).toContain('Dano mágico · Fogo e Energia');

    // Descrição completa
    expect(html).toContain('Tanque: mais vida e capacidade, bate de perto com espada, machado ou maça.');
    expect(html).toContain('Dano à distância: atira com bow e munição. Canaliza a luz sagrada contra o que não devia andar.');
    expect(html).toContain('Suporte e cura: a maior mana, magias de cura. Congela e envenena o campo com a fúria da terra.');
    expect(html).toContain('Dano mágico: a maior mana, magias de ataque. Chamas de dragão e raios que rasgam hordas — frágil, mas devastador.');
  });

  it('renders starting weapon before gains in the card (R1-18)', async () => {
    const html = await render();
    const weaponIndex = html.indexOf('class="vocation-weapon"');
    const gainsIndex = html.indexOf('class="vocation-gains"');
    expect(weaponIndex).toBeGreaterThan(-1);
    expect(gainsIndex).toBeGreaterThan(-1);
    expect(weaponIndex).toBeLessThan(gainsIndex);
  });

  it('renders the vocation subtitle explaining permanence and group role (R1-18)', async () => {
    const html = await render();
    expect(html).toContain('vocation-subtitle');
    expect(html).toContain('A vocação define suas armas, elementos e o papel no grupo. Não pode ser alterada depois.');
  });
});

describe('resolveChosenVocationId (RF-04)', () => {
  const vocations = catalogue.vocations;

  it('falls back to the first vocation when FORJAR is clicked with no card selected', () => {
    expect(resolveChosenVocationId(null, vocations)).toBe('knight');
  });

  it('keeps the selected card when it exists in the list', () => {
    expect(resolveChosenVocationId('paladin', vocations)).toBe('paladin');
  });

  it('falls back to the first vocation when the selection no longer exists (catalogue swapped on reconnect)', () => {
    expect(resolveChosenVocationId('an-old-vocation-no-longer-in-the-catalogue', vocations)).toBe('knight');
  });

  it('throws when called with an empty catalogue — a contract only the caller can violate', () => {
    expect(() => resolveChosenVocationId(null, [])).toThrow();
  });
});
