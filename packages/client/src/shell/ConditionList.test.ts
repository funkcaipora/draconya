import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import type { BotConditionV2 } from '@draconya/content';
import { ConditionList } from './ConditionList.js';
import { blankConditionV2 } from '../bot/action-config.js';

// A lista de condições em E (AB-11, #426). `prerender` roda sem DOM: o que se prende é a
// ESTRUTURA — uma linha por condição, a frase de cada uma e o "+ CONDIÇÃO". A remoção que apaga
// SÓ a condição (UC-COND-006) é presa por inspeção de fonte, porque `prerender` não dispara
// evento (DT-03, mesmo limite de ActionBar.test.ts).

const CONDITIONS: readonly BotConditionV2[] = [
  { kind: 'targets', op: '>=', count: 2 },
  { kind: 'mana', op: '>=', percent: 20 },
];

async function render(conditions: readonly BotConditionV2[]): Promise<string> {
  const { prelude } = await prerender(
    createElement(ConditionList, { conditions, onChange: () => {} }),
  );
  return new Response(prelude).text();
}

describe('ConditionList — condições em E (RG-006)', () => {
  it('monta as duas condições juntas, cada uma com a sua frase', async () => {
    const html = await render(CONDITIONS);
    expect(html).toContain('Nº de alvos ≥ 2');
    expect(html).toContain('Mana ≥ 20 %');
    expect((html.match(/condition-row/g) ?? []).length).toBe(2);
  });

  it('lista vazia é válida (RG-007) e "+ CONDIÇÃO" nasce no meio da faixa', async () => {
    const html = await render([]);
    expect(html).toContain('+ CONDIÇÃO');
    expect(html).not.toContain('condition-row');
    // O primeiro tipo oferecido é `hp`, e o valor nasce no meio da faixa.
    expect(blankConditionV2('hp')).toEqual({ kind: 'hp', op: '>=', percent: 50 });
  });

  it('sem a primeira, a segunda continua — remover não apaga a lista', async () => {
    const html = await render([CONDITIONS[1]!]);
    expect(html).toContain('Mana ≥ 20 %');
    expect((html.match(/condition-row/g) ?? []).length).toBe(1);
    expect(html).not.toContain('aria-label="Nº de alvos');
  });

  it('o × remove SÓ a condição, e o + acrescenta uma nova (por fonte)', async () => {
    const source = await readFile(new URL('./ConditionList.tsx', import.meta.url), 'utf8');
    expect(source).toContain('conditions.filter');
    expect(source).toContain('onChange([...conditions, blankConditionV2');
  });
});
