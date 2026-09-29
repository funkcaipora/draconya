import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel.js';

async function render(props: Parameters<typeof Panel>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Panel, props));
  return new Response(prelude).text();
}

describe('Panel', () => {
  it('mostra título, corpo e rodapé quando expandido', async () => {
    const html = await render({ title: 'BOT', footer: 'rodapé', children: 'conteúdo' });
    expect(html).toContain('ui-panel-title');
    expect(html).toContain('BOT');
    expect(html).toContain('conteúdo');
    expect(html).toContain('ui-panel-footer');
  });

  it('minimizado esconde corpo e rodapé mas mantém o cabeçalho', async () => {
    const html = await render({ title: 'BOT', collapsed: true, footer: 'rodapé', children: 'conteúdo' });
    expect(html).toContain('ui-panel-title');
    expect(html).not.toContain('conteúdo');
    expect(html).not.toContain('ui-panel-footer');
  });

  it('sem onToggle não desenha o botão de minimizar', async () => {
    const html = await render({ title: 'BOT' });
    expect(html).not.toContain('minimizar');
    expect(html).not.toContain('expandir');
  });

  it('onToggle desenha o botão de minimizar', async () => {
    const html = await render({ title: 'BOT', onToggle: () => {} });
    expect(html).toContain('minimizar');
  });

  it('onClose desenha o botão fechar; sem onClose ele não existe', async () => {
    const on = await render({ title: 'BOT', onClose: () => {} });
    expect(on).toContain('fechar');

    const off = await render({ title: 'BOT' });
    expect(off).not.toContain('fechar');
  });

  it('dock aplica a classe que remove borda e sombra', async () => {
    const html = await render({ title: 'BOT', dock: true });
    expect(html).toContain('ui-panel--dock');
  });

  it('sem footer não desenha <footer> nenhum', async () => {
    const html = await render({ title: 'BOT', children: 'conteúdo' });
    expect(html).not.toContain('<footer');
    expect(html).not.toContain('ui-panel-footer');
  });

  it('collapsed e footer juntos: a classe composta esconde os dois', async () => {
    const html = await render({ title: 'BOT', collapsed: true, footer: 'rodapé' });
    expect(html).toContain('ui-panel--collapsed');
    expect(html).toContain('ui-panel--footer');
    expect(html).not.toContain('<footer');
  });
});
