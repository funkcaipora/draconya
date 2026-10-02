import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { ExitRefusalNotice } from './ExitRefusalNotice.js';
import { INITIAL_HUD, hud } from '../state/hud.js';

// O aviso "não pode sair" sobre o mundo (OW-23, #846): o veredicto do `canLogout`, em português. `prerender`
// roda sem efeitos — o desaparecer por tempo é do `useEffect`, e o que se prende aqui é o que aparece e quando se
// cala.

async function render(props: { suppressed?: boolean } = {}): Promise<string> {
  const { prelude } = await prerender(createElement(ExitRefusalNotice, props));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
});

describe('ExitRefusalNotice', () => {
  it('sem recusa não desenha nada', async () => {
    expect(await render()).toBe('');
  });

  it('em luta: "Você não pode sair durante uma luta."', async () => {
    hud.set((state) => ({ ...state, exitRefusal: { reason: 'in-fight', atMs: 1 } }));
    const html = await render();
    expect(html).toContain('Você não pode sair durante uma luta.');
    expect(html).toContain('role="alert"');
  });

  it('tile que proíbe sair: "Você não pode sair daqui."', async () => {
    hud.set((state) => ({ ...state, exitRefusal: { reason: 'no-logout-tile', atMs: 1 } }));
    expect(await render()).toContain('Você não pode sair daqui.');
  });

  it('se cala quando outra tela já diz a mesma coisa (o HuntsModal aberto)', async () => {
    hud.set((state) => ({ ...state, exitRefusal: { reason: 'in-fight', atMs: 1 } }));
    // Mutação que mata: ignorar `suppressed` — o jogador leria "não pode SAIR" por cima de um modal que diz
    // "não pode ENTRAR numa caçada", duas frases para um veredicto só.
    expect(await render({ suppressed: true })).toBe('');
  });
});
