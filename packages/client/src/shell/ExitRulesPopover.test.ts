import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BotExitRule } from '@draconya/content';
import { ExitRulesList, ExitRulesPopover } from './ExitRulesPopover.js';
import { INITIAL_BOT, bot } from '../bot/store.js';

// RF-01/RF-09: `prerender` roda sem DOM (mesmo limite de `RuleEditor.test.ts`) — clique de
// verdade (abrir/fechar, marcar o checkbox pelo dedo) é a captura no navegador da seção 10.

async function renderList(rules: readonly BotExitRule[]): Promise<string> {
  const { prelude } = await prerender(createElement(ExitRulesList, { rules }));
  return new Response(prelude).text();
}

async function renderPopover(): Promise<string> {
  const { prelude } = await prerender(createElement(ExitRulesPopover));
  return new Response(prelude).text();
}

beforeEach(() => { bot.set(() => INITIAL_BOT); });

describe('ExitRulesList (RF-01)', () => {
  it('mostra exatamente três linhas, na ordem fixa HP → gold → grupo, nunca uma quarta', async () => {
    const html = await renderList([]);
    const labels = [...html.matchAll(/class="exit-rule-label">([^<]*)/g)].map((m) => m[1]);
    expect(labels).toEqual([
      `HP abaixo de 30 %`, 'Acabar o gold', 'Alguém do grupo sair',
    ]);
    expect(html).not.toContain('Acabar a capacidade');
  });

  it('hp-below ligada mostra o campo de percentual com o valor certo; as outras duas, não', async () => {
    const html = await renderList([{ kind: 'hp-below', percent: 45 }]);
    expect(html).toMatch(/<input type="number"[^>]*value="45"/);
    expect(html).toContain('aria-label="percentual de HP"');
    // Só UM campo de número — as duas linhas booleanas não ganham input numérico.
    expect(html.match(/type="number"/g)).toHaveLength(1);
  });

  it('hp-below desligada NÃO mostra o campo de percentual, mesmo com o rótulo no default', async () => {
    const html = await renderList([]);
    expect(html).not.toContain('type="number"');
    expect(html).toContain('HP abaixo de 30 %');
  });

  it('cada linha é um checkbox, marcado só quando a regra correspondente está no rascunho', async () => {
    const html = await renderList([{ kind: 'out-of-gold' }]);
    const checkboxes = [...html.matchAll(/type="checkbox"[^>]*aria-label="([^"]*)"[^>]*(checked="")?/g)];
    expect(checkboxes).toHaveLength(3);
    const goldRow = html.slice(html.indexOf('Acabar o gold'), html.indexOf('Alguém do grupo sair'));
    expect(goldRow).toContain('checked=""');
    const hpRow = html.slice(html.indexOf('exit-rule-row'), html.indexOf('Acabar o gold'));
    expect(hpRow).not.toContain('checked=""');
  });

  it('role="dialog" com aria-label "Sair sozinho quando…" — a estrutura do popover em si', async () => {
    const html = await renderList([]);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Sair sozinho quando…"');
  });

  it('exibe a nota de contagem regressiva de cinco segundos (#360)', async () => {
    const html = await renderList([]);
    expect(html).toContain('<p class="exit-rules-note">A mesma saída de cinco segundos, iniciada para você.</p>');
  });
});

describe('ExitRulesPopover (RF-01, RF-07, RF-09)', () => {
  it('fechado por padrão: aria-expanded="false", sem role="dialog" na saída', async () => {
    const html = await renderPopover();
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('exit-rules-toggle');
    expect(html).toContain('»');
  });

  it('sem regra ligada (exit vazio), nenhum resumo aparece', async () => {
    const html = await renderPopover();
    expect(html).not.toContain('Saindo sozinho');
    expect(html).not.toContain('exit-rules-summary');
  });

  it('com alguma regra ligada e o popover fechado, mostra "Saindo sozinho: …" (RF-07)', async () => {
    bot.set((state) => ({
      ...state,
      draft: { ...state.draft, exit: [{ kind: 'hp-below', percent: 30 }, { kind: 'out-of-gold' }] },
    }));
    const html = await renderPopover();
    expect(html).toContain('Saindo sozinho: hp abaixo de 30 % · acabar o gold');
  });

  it('não recebe nenhuma prop de HuntActions — renderiza sozinho (RF-09, DT-04)', async () => {
    // A própria assinatura de `renderPopover` já prova isso: `createElement(ExitRulesPopover)`
    // sem segundo argumento. Repetido aqui como asserção explícita do critério de aceite.
    const html = await renderPopover();
    expect(html).toContain('exit-rules-anchor');
  });
});
