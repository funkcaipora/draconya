import type { ComponentProps } from 'react';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { OutfitSprite } from './OutfitSprite.js';

// RF-09 (#259, SV-14 #350): sem `AssetPackContext` provido — o padrão de `prerender`, que não roda
// efeitos — a inicial do nome aparece, nunca um canvas exposto sem sprite. É o mesmo comportamento
// que `ItemSprite` já tem sem `appearanceId`, portado para `outfitId` (DT-07).

async function render(props: ComponentProps<typeof OutfitSprite>): Promise<string> {
  const { prelude } = await prerender(createElement(OutfitSprite, props));
  return new Response(prelude).text();
}

describe('OutfitSprite (RF-09)', () => {
  it('shows the initial of the name as a fallback, with the canvas hidden', async () => {
    const html = await render({ outfitId: 21, name: 'Dragon' });
    expect(html).toContain('class="item-sprite"');
    expect(html).toContain('class="item-initial"');
    expect(html).toContain('>D<');
    expect(html).toMatch(/<canvas[^>]*hidden[^>]*>/);
  });

  it('falls back to "?" without a name', async () => {
    const html = await render({ outfitId: 21, name: undefined });
    expect(html).toContain('>?<');
  });

  it('the aria-label carries the monster name, or the "unknown" text without one', async () => {
    const withName = await render({ outfitId: 21, name: 'Dragon' });
    expect(withName).toContain('aria-label="Dragon"');
    const withoutName = await render({ outfitId: undefined, name: undefined });
    expect(withoutName).toContain('aria-label="monstro desconhecido"');
  });

  it('renders fallback initial when colors are provided for player portrait (SV-14)', async () => {
    const html = await render({
      outfitId: 128,
      name: 'Aldric',
      colors: { head: 10, body: 20, legs: 30, feet: 40 },
    });
    expect(html).toContain('class="item-sprite"');
    expect(html).toContain('class="item-initial"');
    expect(html).toContain('>A<');
    expect(html).toContain('aria-label="Aldric"');
    expect(html).toMatch(/<canvas[^>]*hidden[^>]*>/);
  });
});
