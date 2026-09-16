import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { OutfitSprite } from './OutfitSprite.js';

// RF-09 (#259): sem `AssetPackContext` provido — o padrão de `prerender`, que não roda efeitos —
// a inicial do nome aparece, nunca um canvas exposto sem sprite. É o mesmo comportamento que
// `ItemSprite` já tem sem `appearanceId`, portado para `outfitId` (DT-07).

async function render(props: { outfitId: number | undefined; name: string | undefined }): Promise<string> {
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
});
