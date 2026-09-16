import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { VitalBar } from './VitalBar.js';

async function render(props: Parameters<typeof VitalBar>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(VitalBar, props));
  return new Response(prelude).text();
}

describe('VitalBar', () => {
  it('com value/max mostra "N / M"', async () => {
    const html = await render({ kind: 'hp', value: 1200, max: 1500 });
    expect(html).toContain('1.200 / 1.500');
  });

  it('com percent mostra "NN%" e ignora value/max', async () => {
    const html = await render({ kind: 'exp', percent: 42, value: 1, max: 2 });
    expect(html).toContain('42%');
    expect(html).not.toContain('1 / 2');
  });

  it('showText={false} esconde o texto', async () => {
    const html = await render({ kind: 'mp', value: 10, max: 20, showText: false });
    expect(html).not.toContain('ui-vital-text');
  });

  it('data-kind muda por kind, para a cor do preenchimento vir do CSS', async () => {
    const hp = await render({ kind: 'hp', value: 1, max: 1 });
    expect(hp).toContain('data-kind="hp"');

    const stamina = await render({ kind: 'stamina', value: 1, max: 1 });
    expect(stamina).toContain('data-kind="stamina"');
  });

  it('max: 0 cai para fração 0, nunca NaN/Infinity', async () => {
    const html = await render({ kind: 'hp', value: 0, max: 0 });
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
    expect(html).toContain('width:0%');
  });

  it('nenhum preenchimento usa cor inline: só data-kind', async () => {
    const html = await render({ kind: 'hp', value: 1, max: 1 });
    expect(html).not.toMatch(/background:\s*#/);
  });
});
