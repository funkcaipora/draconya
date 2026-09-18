import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import { HuntActions, leaveHunt } from './HuntActions.js';

// As pills sobre o mundo (#259, #325). `prerender` roda sem DOM — um clique real não dispara
// (mesmo limite de VocationChoice.test.ts). A intenção de saída é uma função pura, testada
// direto; a fiação do clique é provada por inspeção do código-fonte.

async function render(hunting: boolean): Promise<string> {
  const { prelude } = await prerender(createElement(HuntActions, { hunting, onChoose: () => {} }));
  return new Response(prelude).text();
}

describe('HuntActions', () => {
  it('hunting=false: shows the "⚔ Escolher caçada" pill, and only that one', async () => {
    const html = await render(false);
    expect(html).toContain('Escolher caçada');
    expect(html).not.toContain('Sair da caçada');
    expect(html).not.toContain('Detalhes da caçada');
    expect(html).not.toContain('hunt-pill-icon');
    expect(html).toContain('class="hunt-pill"');
    expect(html).not.toContain('hunt-pill-danger');
  });

  it('hunting=true: puts details before the exit pair, without dispatching loot', async () => {
    const html = await render(true);
    const detailsIndex = html.indexOf('Detalhes da caçada');
    const exitIndex = html.indexOf('Sair da caçada');
    expect(detailsIndex).toBeGreaterThan(-1);
    expect(exitIndex).toBeGreaterThan(detailsIndex);
    expect(html).toContain('Sair da caçada');
    expect(html).not.toContain('Escolher caçada');
    expect(html).not.toContain('Despachar loot');
    expect(html).toContain('hunt-pill-danger');
    // Antes desta correção existiam DOIS "»": o decorativo dentro do texto da pill (removido
    // agora) e o funcional do `ExitRulesPopover`. O kit desenha só um, no mesmo botão partido.
    const chevronCount = (html.match(/»/g) ?? []).length;
    expect(chevronCount).toBe(1);
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

  it('renders the details modal after the exit pill, with the exit click wired straight to leaveHunt', async () => {
    const source = await readFile(new URL('./HuntActions.tsx', import.meta.url), 'utf8');
    const exitIndex = source.indexOf('onClick={() => { leaveHunt(sendIntent); }}');
    expect(exitIndex).toBeGreaterThan(-1);
    expect(source.indexOf('<HuntDetailsModal', exitIndex)).toBeGreaterThan(exitIndex);
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
