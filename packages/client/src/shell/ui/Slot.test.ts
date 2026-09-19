import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Slot } from './Slot.js';

async function render(props: Parameters<typeof Slot>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Slot, props));
  return new Response(prelude).text();
}

describe('Slot', () => {
  it('vazio com rótulo mostra o rótulo, não "+"', async () => {
    const html = await render({ size: 30, empty: true, label: 'PESCOÇO' });
    expect(html).toContain('PESCOÇO');
  });

  it('vazio sem rótulo cai no "+"', async () => {
    const html = await render({ size: 36, empty: true, dashed: true });
    expect(html).toContain('+');
    expect(html).toContain('ui-slot--dashed');
  });

  it('vazio com rótulo E dashed juntos mostra o rótulo, não "+"', async () => {
    const html = await render({ size: 36, empty: true, dashed: true, label: '+ regra' });
    expect(html).toContain('+ regra');
  });

  it('tecla e quantidade aparecem quando vêm', async () => {
    const html = await render({ size: 26, label: 'X', hotkey: 'F1', count: 12 });
    expect(html).toContain('F1');
    expect(html).toContain('>12<');
  });

  it('sem tecla e sem quantidade, nenhum dos dois aparece', async () => {
    const html = await render({ size: 26, label: 'X' });
    expect(html).not.toContain('ui-slot-hotkey');
    expect(html).not.toContain('ui-slot-count');
  });

  it('tamanho vira a custom property --slot-size', async () => {
    const html = await render({ size: 26, label: 'X' });
    expect(html).toContain('--slot-size');
    expect(html).toContain('26px');
  });

  it.each([26, 30, 36] as const)('size=%d aplica --slot-size:%dpx', async (size) => {
    const html = await render({ size, label: 'X' });
    expect(html).toContain(`${size}px`);
  });

  it('repassa title, aria-label e draggable para o <button>', async () => {
    const html = await render({
      size: 30,
      title: 'Tirar Sword',
      ariaLabel: 'Sword',
      draggable: true,
    });
    expect(html).toContain('title="Tirar Sword"');
    expect(html).toContain('aria-label="Sword"');
    expect(html).toContain('draggable="true"');
  });

  it('com ícone E rótulo, os dois aparecem no mesmo slot (RF-04)', async () => {
    // O `icon ?? label` engolia o rótulo quando havia sprite; o kit (UH 150) mostra os dois.
    const html = await render({
      size: 26,
      icon: createElement('span', { className: 'sprite-marker' }),
      label: 'UH',
      count: 150,
    });
    expect(html).toContain('sprite-marker');
    expect(html).toContain('>UH<');
    expect(html).toContain('ui-slot-count">150');
  });

  it('com ícone e SEM rótulo, nenhum rótulo é inventado', async () => {
    const html = await render({ size: 26, icon: createElement('span', { className: 'sprite-marker' }) });
    expect(html).toContain('sprite-marker');
    expect(html).not.toContain('ui-slot-label');
  });
});
