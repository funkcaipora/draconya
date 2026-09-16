import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Kicker } from './Kicker.js';

async function render(props: Parameters<typeof Kicker>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Kicker, props));
  return new Response(prelude).text();
}

describe('Kicker', () => {
  it.each(['gold', 'muted'] as const)('tone="%s" carries its class', async (tone) => {
    const html = await render({ tone, children: 'Prey' });
    expect(html).toContain(`ui-kicker-${tone}`);
  });

  it('defaults to gold', async () => {
    const html = await render({ children: 'Prey' });
    expect(html).toContain('ui-kicker-gold');
  });
});
