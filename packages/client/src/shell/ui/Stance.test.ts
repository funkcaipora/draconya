import { createElement } from 'react';
import type { ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import { STANCE_OPTIONS, Stance } from './Stance.js';
import type { StanceProps } from './Stance.js';

async function render(props: StanceProps): Promise<string> {
  const { prelude } = await prerender(createElement(Stance, props));
  return new Response(prelude).text();
}

function radios(html: string): string[] {
  return html.split('<button').slice(1).map((chunk) => `<button${chunk}`);
}

/**
 * Os botões como elementos, sem DOM: `Stance` não usa hook, então a função devolve a árvore do
 * React e o `onClick` de cada botão é chamável direto — o mais perto de um clique que este
 * pacote testa sem jsdom.
 */
function buttonsOf(props: StanceProps): Array<{ mode: string; click: () => void }> {
  const tree = Stance(props) as ReactElement<{
    children: Array<ReactElement<{ onClick: () => void; children: unknown }>>;
  }>;
  return tree.props.children.map((button, index) => ({
    mode: STANCE_OPTIONS[index]?.mode ?? '?', click: button.props.onClick,
  }));
}

describe('Stance', () => {
  it('é um radiogroup com as três posturas na ordem do kit: defensiva, balanceada, atacante', async () => {
    const html = await render({ value: 'attack' });
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Postura de luta"');
    const buttons = radios(html);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toContain('Defensiva');
    expect(buttons[1]).toContain('Balanceada');
    expect(buttons[2]).toContain('Atacante');
    for (const button of buttons) expect(button).toContain('role="radio"');
  });

  it('marca só a postura em vigor, com o papel e com a classe', async () => {
    for (const [mode, index] of [['defense', 0], ['balanced', 1], ['attack', 2]] as const) {
      const buttons = radios(await render({ value: mode }));
      buttons.forEach((button, i) => {
        expect(button).toContain(`aria-checked="${String(i === index)}"`);
        expect(button.includes('ui-stance-option-active')).toBe(i === index);
      });
    }
  });

  it('cada botão tem uma dica qualitativa — os fatores são do servidor, não do cliente', async () => {
    const buttons = radios(await render({ value: 'attack' }));
    expect(buttons[0]).toContain('title="Postura defensiva');
    expect(buttons[2]).toContain('title="Postura atacante');
    // Nenhum número de balanceamento na dica: o cliente não tem regra de combate (invariante 4).
    for (const button of buttons) {
      const title = /title="([^"]*)"/.exec(button)?.[1] ?? '';
      expect(title.length).toBeGreaterThan(0);
      expect(title).not.toMatch(/\d/);
    }
  });

  it('o clique numa OUTRA postura manda o modo, e o clique na que já vale não manda nada', () => {
    const onChange = vi.fn();
    const buttons = buttonsOf({ value: 'balanced', onChange });
    for (const button of buttons) button.click();
    expect(onChange.mock.calls).toEqual([['defense'], ['attack']]);
  });

  it('sem `onChange` o clique não quebra, e `disabled` desabilita os três botões', async () => {
    expect(() => { buttonsOf({ value: 'attack' }).forEach((button) => { button.click(); }); }).not.toThrow();
    const html = await render({ value: 'attack', disabled: true });
    for (const button of radios(html)) expect(button).toContain('disabled=""');
  });

  it('acrescenta a classe do dono ao lado da própria', async () => {
    const html = await render({ value: 'attack', className: 'na-coluna' });
    expect(html).toContain('class="ui-stance na-coluna"');
  });
});
