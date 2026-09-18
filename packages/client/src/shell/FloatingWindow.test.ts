import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FloatingWindow, clampPosition, loadPosition, savePosition,
} from './FloatingWindow.js';

async function render(props: Parameters<typeof FloatingWindow>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(FloatingWindow, props));
  return new Response(prelude).text();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FloatingWindow', () => {
  it('renderiza na posição inicial quando não há posição salva', async () => {
    const html = await render({
      name: 'analyzer', title: 'ANALISADOR', initial: { x: 250, y: 12 }, children: 'conteúdo',
    });

    expect(html).toContain('floating-window');
    expect(html).toContain('left:250px');
    expect(html).toContain('top:12px');
    expect(html).toContain('conteúdo');
  });

  it('aceita uma classe de instância extra (para o order de mobile do consumidor)', async () => {
    const html = await render({
      name: 'analyzer', title: 'X', initial: { x: 0, y: 0 }, className: 'ui-floating-window--analyzer',
    });

    expect(html).toContain('floating-window ui-floating-window--analyzer');
  });

  it('reserva sessenta pixels para os botões da janela', async () => {
    const html = await render({ name: 'x', title: 'X', initial: { x: 0, y: 0 } });

    expect(html).toContain('floating-window-drag');
    expect(html).toContain('right:60px');
  });

  it('repassa ações, meta, rodapé e fechamento ao Panel', async () => {
    const html = await render({
      name: 'x',
      title: 'X',
      initial: { x: 0, y: 0 },
      meta: 'sessão',
      actions: 'ação',
      footer: 'rodapé',
      onClose: () => {},
    });

    expect(html).toContain('sessão');
    expect(html).toContain('ação');
    expect(html).toContain('rodapé');
    expect(html).toContain('fechar');
  });

  it('sem onClose não desenha o botão fechar', async () => {
    const html = await render({ name: 'x', title: 'X', initial: { x: 0, y: 0 } });

    expect(html).not.toContain('fechar');
  });
});

describe('clampPosition', () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 200, height: 100 };

  it('preserva uma posição já visível', () => {
    expect(clampPosition({ x: 100, y: 50 }, size, viewport)).toEqual({ x: 100, y: 50 });
  });

  it('ancora na borda direita e inferior', () => {
    expect(clampPosition({ x: 750, y: 590 }, size, viewport)).toEqual({ x: 600, y: 500 });
  });

  it('ancora posições negativas em zero', () => {
    expect(clampPosition({ x: -40, y: -10 }, size, viewport)).toEqual({ x: 0, y: 0 });
  });

  it('ancora uma janela maior que o viewport em zero', () => {
    expect(clampPosition({ x: 500, y: 500 }, { width: 900, height: 700 }, viewport))
      .toEqual({ x: 0, y: 0 });
  });
});

describe('loadPosition e savePosition', () => {
  const fallback = { x: 1, y: 2 };

  it('cai no fallback sem storage', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(loadPosition('window', fallback)).toEqual(fallback);
    expect(() => { savePosition('window', fallback); }).not.toThrow();
  });

  it('persiste posições separadas por nome', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });

    savePosition('analyzer', { x: 9, y: 8 });
    savePosition('party-loot', { x: 2, y: 3 });

    expect(loadPosition('analyzer', fallback)).toEqual({ x: 9, y: 8 });
    expect(loadPosition('party-loot', fallback)).toEqual({ x: 2, y: 3 });
  });

  it('rejeita JSON corrompido e posição inválida', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{not json',
      setItem: () => {},
    });
    expect(loadPosition('window', fallback)).toEqual(fallback);

    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ x: '1', y: 2 }),
      setItem: () => {},
    });
    expect(loadPosition('window', fallback)).toEqual(fallback);
  });

  it('não propaga falha de leitura ou escrita do storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });

    expect(loadPosition('window', fallback)).toEqual(fallback);
    expect(() => { savePosition('window', fallback); }).not.toThrow();
  });
});
