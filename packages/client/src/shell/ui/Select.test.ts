import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Select } from './Select.js';

async function render(props: Parameters<typeof Select>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Select, props));
  return new Response(prelude).text();
}

describe('Select', () => {
  it('without label renders only the <select>', async () => {
    const html = await render({ options: ['a', 'b'] });
    expect(html).not.toContain('<label');
    expect(html).toContain('<select');
  });

  it('with label wraps the select in a <label>', async () => {
    const html = await render({ label: 'Ordenar', options: ['a', 'b'] });
    expect(html).toContain('<label');
    expect(html).toContain('Ordenar');
  });

  it('accepts options as plain strings', async () => {
    const html = await render({ options: ['gold', 'level'] });
    expect(html).toContain('value="gold"');
    expect(html).toContain('>gold<');
  });

  it('accepts options as {value,label} and shows the label, not the value', async () => {
    const html = await render({ options: [{ value: 'lvl', label: 'Nível' }] });
    expect(html).toContain('value="lvl"');
    expect(html).toContain('>Nível<');
  });

  it('inline puts a modifier class on the wrapper', async () => {
    const html = await render({ label: 'Ordenar', options: ['a'], inline: true });
    expect(html).toContain('ui-select-inline');
  });
});
