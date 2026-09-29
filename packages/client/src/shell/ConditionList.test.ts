import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import type { BotConditionV2 } from '@draconya/content';
import { ConditionList } from './ConditionList.js';
import { blankConditionV2 } from '../bot/action-config.js';

// A lista de condições em E (AB-11/#426, redesenhada em #437 na régua da imagem do "Configurar
// ação" do Tibia, anexa à issue #435). `prerender` roda sem DOM: o que se prende é a ESTRUTURA —
// os oito controles da linha (Você / tipo / operador / − / valor / + / % / ×), o "%" ausente em
// `targets`, o `hint` e o "+ Adicionar condição". A remoção que apaga SÓ a condição
// (UC-COND-006) é presa por inspeção de fonte, porque `prerender` não dispara evento (DT-03,
// mesmo limite de ActionBar.test.ts).

const CONDITIONS: readonly BotConditionV2[] = [
  { kind: 'targets', op: '>=', count: 2 },
  { kind: 'mana', op: '>=', percent: 20 },
];

async function render(
  conditions: readonly BotConditionV2[],
  hint?: string,
): Promise<string> {
  const { prelude } = await prerender(
    createElement(ConditionList, { conditions, onChange: () => {}, ...(hint === undefined ? {} : { hint }) }),
  );
  return new Response(prelude).text();
}

describe('ConditionList — a linha da imagem, oito controles (RF-08)', () => {
  it('monta "Você" desabilitado com aria-label "quem", antes do tipo', async () => {
    const html = await render([CONDITIONS[1]!]);
    expect(html).toContain('aria-label="quem"');
    expect(html).toContain('>Você<');
    // O primeiro <select> da linha é o "Você"; ele, e só ele, vem desabilitado.
    const firstSelect = html.slice(html.indexOf('<select'), html.indexOf('</select>'));
    expect(firstSelect).toContain('aria-label="quem"');
    expect(firstSelect).toContain('disabled');
  });

  it('monta tipo, operador por extenso, −, valor e + para uma condição percentual', async () => {
    const html = await render([CONDITIONS[1]!]);
    expect(html).toContain('>Mana<');
    expect(html).toContain('menor ou igual a');
    expect(html).toContain('maior ou igual a');
    expect(html).toContain('>−<');
    expect(html).toContain('value="20"');
    expect(html).toContain('>+<');
    expect((html.match(/condition-row/g) ?? []).length).toBe(1);
  });

  it('o "%" vem marcado e desabilitado numa condição percentual', async () => {
    const html = await render([CONDITIONS[1]!]);
    expect(html).toMatch(/role="checkbox"[^>]*aria-checked="true"/);
    expect(html).toContain('ui-checkbox-checked');
  });

  it('o "%" NÃO aparece em `targets` — não é percentual', async () => {
    const html = await render([CONDITIONS[0]!]);
    expect(html).not.toContain('role="checkbox"');
  });

  it('o × está presente em toda linha, percentual ou não', async () => {
    const html = await render(CONDITIONS);
    expect((html.match(/>×</g) ?? []).length).toBe(2);
  });

  it('o hint aparece acima da lista quando passado; ausente sem ele', async () => {
    const withHint = await render([], 'Todas as condições precisam bater. Sem condições, dispara sempre.');
    expect(withHint).toContain('Todas as condições precisam bater. Sem condições, dispara sempre.');
    expect(withHint).toContain('quiet');

    const withoutHint = await render([]);
    expect(withoutHint).not.toContain('Todas as condições precisam bater');
  });

  it('lista vazia é válida (RG-007) e "+ Adicionar condição" nasce no meio da faixa', async () => {
    const html = await render([]);
    expect(html).toContain('+ Adicionar condição');
    expect(html).not.toContain('condition-row');
    // O primeiro tipo oferecido é `hp`, e o valor nasce no meio da faixa.
    expect(blankConditionV2('hp')).toEqual({ kind: 'hp', op: '>=', percent: 50 });
  });

  it('sem a primeira, a segunda continua — remover não apaga a lista', async () => {
    const html = await render([CONDITIONS[1]!]);
    expect(html).toContain('value="20"');
    expect((html.match(/condition-row/g) ?? []).length).toBe(1);
  });

  it('o × remove SÓ a condição, e o + acrescenta uma nova (por fonte)', async () => {
    const source = await readFile(new URL('./ConditionList.tsx', import.meta.url), 'utf8');
    expect(source).toContain('conditions.filter');
    expect(source).toContain('onChange([...conditions, blankConditionV2');
  });

  it('o −/+ da faixa respeita conditionBounds (por fonte)', async () => {
    const source = await readFile(new URL('./ConditionList.tsx', import.meta.url), 'utf8');
    expect(source).toContain('conditionBounds(kind)');
    expect(source).toContain('function step(');
  });
});
