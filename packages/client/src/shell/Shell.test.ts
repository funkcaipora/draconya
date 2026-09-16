import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { Shell } from './Shell.js';
import { INITIAL_HUD, hud } from '../state/hud.js';

// A geografia (§5.3, ADR 0026 d.7, #161): set, mochila e bolsa FIXOS à direita, nessa ordem,
// antes do analisador e do Bestiário. `prerender` roda a árvore inteira sem DOM e sem efeitos
// — o viewport monta vazio, e o que se prende é a ordem das seções.

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(Shell));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD }));
});

describe('Shell', () => {
  it('the right column is set → backpack → satchel → analyzer, always mounted, in that order', async () => {
    const html = await render();
    const right = html.slice(html.indexOf('janelas à direita'));
    const order = ['aria-label="set"', 'aria-label="mochila"', 'aria-label="bolsa"']
      .map((marker) => right.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Sem `inventory` ainda, as três existem dizendo que carregam — nunca somem.
    expect((right.match(/Carregando/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('windows-right renders .vitals as the first child, before the set (#253, RF-01)', async () => {
    // As vitais migraram do topo para o alto da coluna direita (ADR 0029 D3). Mutação que mata:
    // montar `<Vitals />` depois de `<EquipmentPanel />`, ou não montá-la em `Shell.tsx`.
    const html = await render();
    const right = html.slice(html.indexOf('janelas à direita'));
    const vitalsIndex = right.indexOf('class="vitals"');
    const setIndex = right.indexOf('aria-label="set"');
    expect(vitalsIndex).toBeGreaterThan(0);
    expect(setIndex).toBeGreaterThan(vitalsIndex);
  });
});
