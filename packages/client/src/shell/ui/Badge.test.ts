import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Badge, type BadgeTone } from './Badge.js';

const TONES: readonly BadgeTone[] = [
  'gold', 'haste', 'exp', 'blood', 'fire', 'energy', 'ice', 'earth', 'holy', 'muted',
];

async function render(props: Parameters<typeof Badge>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Badge, props));
  return new Response(prelude).text();
}

describe('Badge', () => {
  it.each(TONES)('tone="%s" carries its class', async (tone) => {
    const html = await render({ tone, children: 'Haste' });
    expect(html).toContain(`ui-badge-${tone}`);
  });

  it('dot renders by default', async () => {
    const html = await render({ children: 'Haste' });
    expect(html).toContain('ui-badge-dot');
  });

  it('dot={false} omits the dot', async () => {
    const html = await render({ dot: false, children: 'Haste' });
    expect(html).not.toContain('ui-badge-dot');
  });

  it('rejects an unknown tone at compile time (§7 of the spec: TypeScript refuses, not runtime)', async () => {
    // @ts-expect-error BadgeTone is a closed union — the handoff accepted loose `string`, this doesn't.
    const html = await render({ tone: 'legendary', children: 'Haste' });
    expect(html).toContain('ui-badge-legendary');
  });
});
