import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { ContextMenu } from './ContextMenu.js';

async function render(props: Parameters<typeof ContextMenu>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(ContextMenu, props));
  return new Response(prelude).text();
}

describe('ContextMenu (#724, ADR 0048 d.8)', () => {
  it('desenha na posição de tela recebida, com role="menu" e um menuitem por ação', async () => {
    const html = await render({
      x: 42, y: 99, onClose: () => {},
      actions: [
        { label: 'Vender', onSelect: () => {} },
        { label: 'Descartar', onSelect: () => {}, danger: true },
      ],
    });
    expect(html).toContain('role="menu"');
    expect(html).toContain('left:42px');
    expect(html).toContain('top:99px');
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(html).toContain('>Vender<');
    expect(html).toContain('>Descartar<');
  });

  it('ação desabilitada vira botão desabilitado, com o motivo no title', async () => {
    const html = await render({
      x: 0, y: 0, onClose: () => {},
      actions: [{ label: 'Vender', onSelect: () => {}, disabled: true, title: 'Ninguém compra isto.' }],
    });
    expect(html).toContain('disabled=""');
    expect(html).toContain('title="Ninguém compra isto."');
  });

  it('ação normal não é desabilitada, e não carrega title nenhum', async () => {
    const html = await render({
      x: 0, y: 0, onClose: () => {},
      actions: [{ label: 'Vender', onSelect: () => {} }],
    });
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('title=');
  });

  it('a ação `danger` ganha a classe de destaque; a comum, não', async () => {
    const html = await render({
      x: 0, y: 0, onClose: () => {},
      actions: [
        { label: 'Vender', onSelect: () => {} },
        { label: 'Descartar', onSelect: () => {}, danger: true },
      ],
    });
    expect(html).toContain('ui-context-menu-item--danger');
    const vender = html.slice(html.indexOf('>Vender<') - 200, html.indexOf('>Vender<'));
    expect(vender).not.toContain('ui-context-menu-item--danger');
  });
});
