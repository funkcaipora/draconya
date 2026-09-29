import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { AmmoPicker, ammoInUse } from './AmmoPicker.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

async function render(family: string): Promise<string> {
  const { prelude } = await prerender(createElement(AmmoPicker, { family, onClose: () => {} }));
  return new Response(prelude).text();
}

const ammunition: Catalogue['ammunition'] = [
  { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1, appearanceId: 3447, requires: {} },
  { id: 'sniper-arrow', name: 'Sniper Arrow', family: 'arrow', attack: 28, price: 5, appearanceId: 7364, requires: { level: 20 } },
  { id: 'bolt', name: 'Bolt', family: 'bolt', attack: 30, price: 2, appearanceId: 3446, requires: {} },
];
const catalogue: Catalogue = {
  hunts: [], monsters: [], items: [], vocations: [], vocationLevel: 8, ammunition,
  bot: { vocabularyVersion: 1, slots: {}, spells: [], supplies: [] },
};

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue, level: 10 }));
});

describe('AmmoPicker', () => {
  it('lista só a família, com preço e level, trava acima do nível e marca a escolhida', async () => {
    const html = await render('arrow');
    expect(html).toContain('Arrow');
    expect(html).toContain('Sniper Arrow');
    expect(html).not.toContain('>Bolt<');
    expect(html).toContain('1 gold/tiro');
    expect(html).toContain('5 gold/tiro');
    expect(html).toContain('lv 20');
    // Level 10: a sniper vem desabilitada; sem seleção, nenhuma fica "em uso".
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('aria-pressed="true"');
    hud.set((state) => ({ ...state, level: 20, ammo: { arrow: 'sniper-arrow', bolt: null } }));
    const chosen = await render('arrow');
    expect(chosen).not.toContain('disabled=""');
    expect(chosen).toContain('ammo-option active');
    expect(chosen.indexOf('Sniper Arrow')).toBeGreaterThan(chosen.indexOf('ammo-option active'));
  });

  it('ammoInUse só devolve a escolhida — não existe fallback grátis', () => {
    expect(ammoInUse(ammunition, 'arrow', null)).toBeUndefined();
    expect(ammoInUse(ammunition, 'arrow', 'sniper-arrow')?.id).toBe('sniper-arrow');
    expect(ammoInUse(ammunition, 'arrow', 'gone')).toBeUndefined();
    expect(ammoInUse(ammunition, 'spear', 'arrow')).toBeUndefined();
  });
});
