import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { IconButton } from './IconButton.js';

async function render(props: Parameters<typeof IconButton>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(IconButton, props));
  return new Response(prelude).text();
}

describe('IconButton', () => {
  it('title becomes the HTML attribute', async () => {
    const html = await render({ title: 'Minimizar', children: '–' });
    expect(html).toContain('title="Minimizar"');
  });

  it('active carries the ui-icon-button-active class', async () => {
    const on = await render({ active: true, children: '×' });
    expect(on).toContain('ui-icon-button-active');

    const off = await render({ children: '×' });
    expect(off).not.toContain('ui-icon-button-active');
  });

  it.each(['sm', 'md', 'lg'] as const)('size="%s" carries its class', async (size) => {
    const html = await render({ size, children: '×' });
    expect(html).toContain(`ui-icon-button-${size}`);
  });

  it('active exposes aria-pressed, and omitting it omits the attribute (#306)', async () => {
    const on = await render({ active: true, children: '×' });
    expect(on).toContain('aria-pressed="true"');

    const off = await render({ active: false, children: '×' });
    expect(off).toContain('aria-pressed="false"');

    const unset = await render({ children: '×' });
    expect(unset).not.toContain('aria-pressed');
  });
});
