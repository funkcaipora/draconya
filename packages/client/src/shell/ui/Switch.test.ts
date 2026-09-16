// O padrão de teste desta issue, igual ao de Shell.test.ts (prerender, react-dom/static, sem DOM).
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Switch } from './Switch.js';

async function render(props: Parameters<typeof Switch>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Switch, props));
  return new Response(prelude).text();
}

describe('Switch', () => {
  it('reflects on/off in role and aria-checked', async () => {
    const on = await render({ on: true, onChange: () => {} });
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('ui-switch-on');

    const off = await render({ on: false, onChange: () => {} });
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain('ui-switch-on');
  });

  it('tone="traffic" carries the vBot class the bot panel will use (#162, DS-12)', async () => {
    const html = await render({ on: true, onChange: () => {}, tone: 'traffic' });
    expect(html).toContain('ui-switch-traffic');
    expect(html).not.toContain('ui-switch-gold');
  });
});
