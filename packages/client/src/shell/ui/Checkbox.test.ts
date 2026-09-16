import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './Checkbox.js';

async function render(props: Parameters<typeof Checkbox>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Checkbox, props));
  return new Response(prelude).text();
}

describe('Checkbox', () => {
  it('reflects checked true/false in aria-checked', async () => {
    const on = await render({ checked: true });
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('ui-checkbox-checked');

    const off = await render({ checked: false });
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain('ui-checkbox-checked');
  });

  it('is keyboard focusable unless disabled', async () => {
    const enabled = await render({ checked: false });
    expect(enabled).toContain('tabindex="0"');

    const disabled = await render({ checked: false, disabled: true });
    expect(disabled).toContain('tabindex="-1"');
    expect(disabled).toContain('aria-disabled="true"');
  });

  it('renders a clickable label next to the box', async () => {
    const html = await render({ checked: false, label: 'Ignorar corpse' });
    expect(html).toContain('ui-checkbox-label');
    expect(html).toContain('Ignorar corpse');
  });
});
