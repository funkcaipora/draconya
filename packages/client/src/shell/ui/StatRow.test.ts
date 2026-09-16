import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { StatRow } from './StatRow.js';

async function render(props: Parameters<typeof StatRow>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(StatRow, props));
  return new Response(prelude).text();
}

describe('StatRow', () => {
  it('rótulo e valor sempre aparecem', async () => {
    const html = await render({ label: 'Level', value: 200 });
    expect(html).toContain('Level');
    expect(html).toContain('200');
  });

  it('desenha a barra só quando bar (default true) e percent vêm juntos', async () => {
    const withPercent = await render({ label: 'Level', value: 200, percent: 60 });
    expect(withPercent).toContain('ui-stat-row-bar');

    const withoutPercent = await render({ label: 'Level', value: 200 });
    expect(withoutPercent).not.toContain('ui-stat-row-bar');
  });

  it('bar={false} não desenha a barra mesmo com percent presente', async () => {
    const html = await render({ label: 'Level', value: 200, percent: 60, bar: false });
    expect(html).not.toContain('ui-stat-row-bar');
  });

  it('onRemove desenha o botão ×', async () => {
    const on = await render({ label: 'Haste', value: '30s', onRemove: () => {} });
    expect(on).toContain('ui-stat-row-remove');

    const off = await render({ label: 'Haste', value: '30s' });
    expect(off).not.toContain('ui-stat-row-remove');
  });

  it('tone ausente não quebra o render', async () => {
    const html = await render({ label: 'Level', value: 200 });
    expect(html).toContain('Level');
  });

  it('tone vira a custom property --stat-tone', async () => {
    const html = await render({ label: 'HP', value: 1, tone: 'vital-hp' });
    expect(html).toContain('--stat-tone');
  });
});
