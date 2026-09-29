import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs.js';

async function render(props: Parameters<typeof Tabs>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Tabs, props));
  return new Response(prelude).text();
}

function tabButtons(html: string): string[] {
  return html.split('<button').slice(1).map((chunk) => `<button${chunk}`);
}

describe('Tabs', () => {
  it('marks the item matching value as the selected tab', async () => {
    const html = await render({ items: ['Geral', 'Regras'], value: 'Regras' });
    const [general, rules] = tabButtons(html);
    expect(rules).toContain('aria-selected="true"');
    expect(rules).toContain('Regras');
    expect(general).toContain('aria-selected="false"');
    expect(general).toContain('Geral');
  });

  it('pill and underline generate different root classes', async () => {
    const pill = await render({ items: ['Geral'], value: 'Geral', variant: 'pill' });
    expect(pill).toContain('ui-tabs-pill');
    expect(pill).not.toContain('ui-tabs-underline');

    const underline = await render({ items: ['Geral'], value: 'Geral', variant: 'underline' });
    expect(underline).toContain('ui-tabs-underline');
    expect(underline).not.toContain('ui-tabs-pill');
  });

  it('renders an empty tablist without error when items is empty', async () => {
    const html = await render({ items: [], value: '' });
    expect(html).toContain('role="tablist"');
  });
});
