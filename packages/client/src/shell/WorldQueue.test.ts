import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorldQueue, queueStatusText, worldQueueView } from './WorldQueue.js';
import { INITIAL_ACCOUNT, account } from '../account/store.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { WorldQueueView } from '../state/hud.js';

// A fila do mundo cheio (OW-23, #846, ADR 0060 d.2b): a posição, a contagem até a próxima tentativa e a saída pela
// hunt idle. `prerender` roda sem efeitos e sem clique — a conta e as frases são funções puras, e a estrutura
// (o botão "caçar agora", a saída) se prende no HTML.

const queue: WorldQueueView = { position: 3, retryAfterMs: 10_000, huntAvailable: true, receivedAtMs: 1_000 };

const hunts = [
  { id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1 },
  { id: 'rotworm-caves', name: 'Rotworm Caves', recommendedLevel: 20 },
];

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(WorldQueue));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
  account.set(() => ({
    ...INITIAL_ACCOUNT,
    phase: 'ready',
    playing: 'c1',
    characters: [{ id: 'c1', name: 'Aldric', level: 25, xp: 0, gold: 0, vocation: 'knight', state: 'offline', sessionId: null }],
    entryOptions: { openWorld: true, hunts },
  }));
});

describe('worldQueueView: quanto falta, no relógio local', () => {
  it('a duração do servidor menos o que já passou desde que a mensagem chegou', () => {
    expect(worldQueueView(queue, 1_000)).toEqual({ position: 3, remainingMs: 10_000, secondsLeft: 10 });
    expect(worldQueueView(queue, 4_500)).toEqual({ position: 3, remainingMs: 6_500, secondsLeft: 7 });
  });

  it('arredonda os segundos PARA CIMA: "0 s" só quando é agora', () => {
    // Mutação que mata: `Math.floor` — a tela diria "0 s" por quase um segundo antes de tentar, e "agora" já
    // não significaria agora.
    expect(worldQueueView(queue, 10_200).secondsLeft).toBe(1);
    expect(worldQueueView(queue, 11_000).secondsLeft).toBe(0);
  });

  it('passado o prazo não fica negativo', () => {
    expect(worldQueueView(queue, 60_000)).toEqual({ position: 3, remainingMs: 0, secondsLeft: 0 });
  });
});

describe('queueStatusText: a frase da fila, em português', () => {
  it('diz a posição e quando tenta de novo', () => {
    expect(queueStatusText({ position: 3, remainingMs: 6_500, secondsLeft: 7 }))
      .toBe('Você está na posição 3 da fila de espera. Tentando de novo em 7 s.');
  });

  it('no prazo diz que tenta agora', () => {
    expect(queueStatusText({ position: 1, remainingMs: 0, secondsLeft: 0 }))
      .toBe('Você está na posição 1 da fila de espera. Tentando de novo agora.');
  });
});

describe('WorldQueue', () => {
  it('sem fila não desenha nada', async () => {
    expect(await render()).toBe('');
  });

  it('mostra o mundo cheio, a posição e a saída pela hunt idle', async () => {
    hud.set((state) => ({ ...state, worldQueue: queue }));
    const html = await render();

    expect(html).toContain('Mundo cheio');
    expect(html).toContain('Você está na fila');
    expect(html).toContain('Você está na posição 3 da fila de espera.');
    expect(html).toContain('CAÇAR AGORA');
    expect(html).toContain('A caçada idle não tem fila nem teto');
    expect(html).toContain('Sair da fila');
  });

  it('o seletor traz as hunts do servidor e já marca a que o personagem alcança', async () => {
    hud.set((state) => ({ ...state, worldQueue: queue }));
    const html = await render();

    expect(html).toContain('Rat Cellars · level 1+');
    expect(html).toContain('Rotworm Caves · level 20+');
    // O personagem é level 25: a maior hunt ao alcance.
    expect(html).toMatch(/<option value="rotworm-caves" selected/);
  });

  it('sem `huntAvailable` não oferece a hunt: o servidor disse que a hunt idle também está fora', async () => {
    hud.set((state) => ({ ...state, worldQueue: { ...queue, huntAvailable: false } }));
    const html = await render();

    // Mutação que mata: oferecer a hunt sempre — o jogador clicaria numa saída que o servidor recusa (nó em
    // drenagem), e a fila que ele ainda poderia esperar ficaria escondida atrás de um botão que não funciona.
    expect(html).not.toContain('CAÇAR AGORA');
    expect(html).toContain('Você está na posição 3');
    expect(html).toContain('Sair da fila');
  });

  it('sem a lista de hunts do servidor também não oferece: não há o que escolher', async () => {
    account.set((state) => ({ ...state, entryOptions: { openWorld: true, hunts: [] } }));
    hud.set((state) => ({ ...state, worldQueue: queue }));
    expect(await render()).not.toContain('CAÇAR AGORA');
  });

  it('depois de pedir a caçada o botão diz que está entrando e não responde de novo', async () => {
    account.set((state) => ({ ...state, entry: { hunt: 'rotworm-caves' } }));
    hud.set((state) => ({ ...state, worldQueue: queue }));
    const html = await render();

    expect(html).toContain('ENTRANDO NA CAÇADA');
    expect(html).not.toContain('CAÇAR AGORA');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>ENTRANDO NA CAÇADA/);
  });
});
