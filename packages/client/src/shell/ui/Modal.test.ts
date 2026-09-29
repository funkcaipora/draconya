import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Modal } from './Modal.js';

async function render(props: Parameters<typeof Modal>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Modal, props));
  return new Response(prelude).text();
}

describe('Modal', () => {
  it('open={false} não renderiza nada, nem os children', async () => {
    const html = await render({
      open: false, onClose: () => {}, title: 'ESCOLHA UMA CAÇADA', children: 'conteúdo pesado',
    });
    expect(html).not.toContain('conteúdo pesado');
    expect(html).not.toContain('ui-modal-scrim');
  });

  it('aberto desenha o scrim com role="dialog", o título e o conteúdo', async () => {
    const html = await render({
      open: true, onClose: () => {}, title: 'ESCOLHA UMA CAÇADA', children: 'conteúdo',
    });
    expect(html).toContain('ui-modal-scrim');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('ESCOLHA UMA CAÇADA');
    expect(html).toContain('conteúdo');
  });

  it('envolve um Panel com onClose (botão fechar presente)', async () => {
    const html = await render({ open: true, onClose: () => {}, title: 'CYCLOPEDIA' });
    expect(html).toContain('fechar');
    expect(html).toContain('ui-panel--modal');
  });
});
