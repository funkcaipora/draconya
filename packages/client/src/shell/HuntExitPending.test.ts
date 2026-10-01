import { readFile } from 'node:fs/promises';
import { createElement, type ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import type { ExitPendingView } from '../state/hud.js';
import { HuntExitPending, cancelExit, exitPendingLabel } from './HuntExitPending.js';

// A pill de saída pendente (#802). `prerender` roda sem DOM — um clique real não dispara (mesmo
// limite de HuntActions.test.ts): a intenção é uma função pura testada direto, e a fiação do
// clique é provada por inspeção do código-fonte.

async function render(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element);
  return new Response(prelude).text();
}

const pending = (over: Partial<ExitPendingView> = {}): ExitPendingView => ({
  reason: 'manual-exit', phase: 'countdown', remainingMs: 5_000, receivedAtMs: performance.now(), ...over,
});

describe('exitPendingLabel', () => {
  it('conta regressiva do exitDelayMs, em segundos cheios (arredonda para cima)', () => {
    expect(exitPendingLabel(pending({ remainingMs: 5_000 }), 0)).toBe('Saindo em 5 s');
    expect(exitPendingLabel(pending({ remainingMs: 5_000 }), 1)).toBe('Saindo em 5 s');
    expect(exitPendingLabel(pending({ remainingMs: 5_000 }), 1_000)).toBe('Saindo em 4 s');
    expect(exitPendingLabel(pending({ remainingMs: 5_000 }), 4_001)).toBe('Saindo em 1 s');
  });

  it('o tempo local que passou desconta do que o servidor mandou, e nunca fica negativo', () => {
    expect(exitPendingLabel(pending({ remainingMs: 2_000 }), 9_000)).toBe('Saindo em 0 s');
  });

  it('em combate diz que é o combate que segura, e passa de um minuto em m:ss', () => {
    expect(exitPendingLabel(pending({ phase: 'in-combat', remainingMs: 47_000 }), 0))
      .toBe('Em combate · saindo em 47 s');
    expect(exitPendingLabel(pending({ phase: 'in-combat', remainingMs: 65_000 }), 0))
      .toBe('Em combate · saindo em 1:05');
    expect(exitPendingLabel(pending({ phase: 'in-combat', remainingMs: 60_000 }), 0))
      .toBe('Em combate · saindo em 1:00');
  });
});

describe('cancelExit', () => {
  it('manda exatamente a intenção cancel-exit (opcode 34), e devolve o que o send devolve', () => {
    const send = vi.fn(() => true);
    expect(cancelExit(send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'cancel-exit' });
    expect(cancelExit(vi.fn(() => false))).toBe(false);
  });
});

describe('HuntExitPending', () => {
  it('saída manual: um BOTÃO com o estado e o "Cancelar"', async () => {
    const html = await render(createElement(HuntExitPending, { pending: pending() }));
    expect(html).toContain('<button');
    expect(html).toContain('hunt-pill-pending');
    expect(html).toContain('Saindo em 5 s');
    expect(html).toContain('Cancelar');
  });

  it('em combate mostra a fase', async () => {
    const html = await render(createElement(HuntExitPending, {
      pending: pending({ phase: 'in-combat', remainingMs: 41_000 }),
    }));
    expect(html).toContain('Em combate · saindo em 41 s');
  });

  it('saída de uma REGRA do bot: só o aviso, sem botão e sem "Cancelar"', async () => {
    // Mutação que mata: oferecer o cancelar aqui — o servidor recusa (a regra dispararia de
    // novo), e a tela prometeria o que ele não cumpre.
    const html = await render(createElement(HuntExitPending, {
      pending: pending({ reason: 'exit-rule' }),
    }));
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Cancelar');
    expect(html).toContain('Saindo em 5 s');
    expect(html).toContain('role="status"');
  });

  it('o clique do botão está ligado a cancelExit(sendIntent)', async () => {
    const source = await readFile(new URL('./HuntExitPending.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/onClick=\{\(\) => \{ cancelExit\(sendIntent\); \}\}/);
  });
});
