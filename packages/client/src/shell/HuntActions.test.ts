import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import { HuntActions, leaveHunt } from './HuntActions.js';

// RF-07 (#259): as duas pills sobre o mundo. `prerender` roda sem DOM — um clique real não
// dispara (mesmo limite de VocationChoice.test.ts). A intenção de saída é uma função pura,
// testada direto; a fiação do clique com ela (e com `onChoose`) é provada por inspeção do
// código-fonte, o mesmo padrão que `VocationChoice.test.ts` já usa para o mesmo problema.

async function render(hunting: boolean): Promise<string> {
  const { prelude } = await prerender(createElement(HuntActions, { hunting, onChoose: () => {} }));
  return new Response(prelude).text();
}

describe('HuntActions', () => {
  it('hunting=false: shows the "⚔ Escolher caçada" pill, and only that one', async () => {
    const html = await render(false);
    expect(html).toContain('Escolher caçada');
    expect(html).not.toContain('Sair da caçada');
    expect(html).toContain('class="hunt-pill"');
    expect(html).not.toContain('hunt-pill-danger');
  });

  it('hunting=true: shows the "↩ Sair da caçada »" pill, and only that one', async () => {
    const html = await render(true);
    expect(html).toContain('Sair da caçada');
    expect(html).toContain('»');
    expect(html).not.toContain('Escolher caçada');
    expect(html).toContain('hunt-pill-danger');
  });

  it('wires onChoose to the non-hunting pill, and leaveHunt(sendIntent) to the exit pill', async () => {
    const source = await readFile(new URL('./HuntActions.tsx', import.meta.url), 'utf8');
    const notHuntingIndex = source.indexOf('if (!hunting)');
    const onChooseIndex = source.indexOf('onClick={onChoose}');
    const huntingReturnIndex = source.lastIndexOf('return (');
    const leaveHuntCallIndex = source.indexOf('leaveHunt(sendIntent)');
    expect(notHuntingIndex).toBeGreaterThan(-1);
    // `onClick={onChoose}` mora DENTRO do bloco `if (!hunting)`, antes do segundo `return`.
    expect(onChooseIndex).toBeGreaterThan(notHuntingIndex);
    expect(onChooseIndex).toBeLessThan(huntingReturnIndex);
    // `leaveHunt(sendIntent)` mora DEPOIS do segundo `return` — o pill de saída.
    expect(leaveHuntCallIndex).toBeGreaterThan(huntingReturnIndex);
  });
});

describe('leaveHunt (RF-07)', () => {
  it('sends exactly the leave-hunt intent (opcode 10), and returns what send() returns', () => {
    const send = vi.fn(() => true);
    expect(leaveHunt(send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'leave-hunt' });
  });

  it('propagates a silent failure (no connection) as false', () => {
    const send = vi.fn(() => false);
    expect(leaveHunt(send)).toBe(false);
  });
});
