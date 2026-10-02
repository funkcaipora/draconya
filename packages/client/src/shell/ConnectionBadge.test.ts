import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectionBadge } from './ConnectionBadge.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { ConnectionStatus } from '../state/hud.js';

// O estado da conexão sempre na tela (RC-13). A fila do mundo cheio (OW-23, #846) é um estado próprio: o
// personagem não "reconecta", espera a vez — dizer "reconectando" mostraria falha onde há fila.

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(ConnectionBadge));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
});

describe('ConnectionBadge', () => {
  it.each<[ConnectionStatus, string]>([
    ['idle', 'desconectado'],
    ['connecting', 'conectando'],
    ['connected', 'conectado'],
    ['reconnecting', 'reconectando'],
    ['queued', 'na fila'],
    ['failed', 'falhou'],
  ])('%s diz "%s"', async (connection, label) => {
    hud.set((state) => ({ ...state, connection }));
    const html = await render();
    expect(html).toContain(label);
    expect(html).toContain(`world-status-dot-${connection}`);
  });
});
