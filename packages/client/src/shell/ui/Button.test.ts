import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Button } from './Button.js';

async function render(props: Parameters<typeof Button>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Button, props));
  return new Response(prelude).text();
}

describe('Button', () => {
  it.each(['primary', 'gold', 'secondary', 'ghost', 'danger', 'text'] as const)(
    'variant="%s" carries its class',
    async (variant) => {
      const html = await render({ variant, children: 'Attack' });
      expect(html).toContain(`ui-button-${variant}`);
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('size="%s" carries its class', async (size) => {
    const html = await render({ size, children: 'Attack' });
    expect(html).toContain(`ui-button-${size}`);
  });

  it('block widens the button', async () => {
    const html = await render({ block: true, children: 'Attack' });
    expect(html).toContain('ui-button-block');
  });

  it('disabled reflects in the HTML attribute', async () => {
    const on = await render({ disabled: true, children: 'Attack' });
    expect(on).toContain('disabled=""');

    const off = await render({ children: 'Attack' });
    expect(off).not.toContain('disabled=""');
  });

  it('renders the icon before the children', async () => {
    const html = await render({ icon: createElement('i', { className: 'attack-icon' }), children: 'Attack' });
    expect(html).toContain('attack-icon');
    expect(html.indexOf('attack-icon')).toBeLessThan(html.indexOf('Attack'));
  });
});
