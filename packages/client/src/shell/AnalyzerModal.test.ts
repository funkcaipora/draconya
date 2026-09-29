import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { AnalyzerModal } from './AnalyzerModal.js';
import type { Aggregates } from '../state/hud.js';

/** Os mesmos agregados de `Analyzer.test.ts`: 1 h exata faz a taxa bater com o valor absoluto. */
const aggregates: Aggregates = {
  durationMs: 3_600_000, xpGained: 1_000, goldGained: 500, goldSpent: 200, kills: 10, deaths: 0,
  itemsLooted: 25, suppliesUsed: 4, bestBasicHit: 120, bestSpellHit: 340,
};

async function render(open: boolean): Promise<string> {
  const { prelude } = await prerender(createElement(AnalyzerModal, {
    open, onClose: () => {}, aggregates, elapsedMs: 3_600_000,
  }));
  return new Response(prelude).text();
}

describe('AnalyzerModal (#315, R8-25)', () => {
  it('mostra as dez linhas na ordem do kit, com taxa só nas cinco que o kit taxa', async () => {
    const html = await render(true);

    const order = ['Tempo', 'XP', 'Gold', 'Gastos', 'Saldo', 'Mortos', 'Loot', 'Supplies', 'Maior golpe', 'Maior magia'];
    const indexes = order.map((label) => html.indexOf(`<span>${label}</span>`));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);

    // Taxa presente nas cinco do kit (a fixture é 1 h, então a taxa é o próprio valor).
    expect(html).toContain('<i>1.000/h</i>');
    expect(html).toContain('<i>500 gp/h</i>');
    expect(html).toContain('<i>200 gp/h</i>');
    expect(html).toContain('<i>300 gp/h</i>');
    expect(html).toContain('<i>10/h</i>');

    // Sem taxa: Tempo, Loot, Supplies, Maior golpe e Maior magia.
    expect((html.match(/<i><\/i>/g) ?? []).length).toBe(5);
  });

  it('aplica o tom --ok só no valor de "Saldo"', async () => {
    const html = await render(true);

    expect(html).toContain('class="analyzer-modal-value-ok">300 gp<');
    expect((html.match(/analyzer-modal-value-ok/g) ?? []).length).toBe(1);
  });

  it('o título e o meta são os do kit', async () => {
    const html = await render(true);

    expect(html).toContain('Analisador de caçada');
    expect(html).toContain('sessão ao vivo');
  });

  it('fechado, o HTML é vazio', async () => {
    expect(await render(false)).toBe('');
  });
});
