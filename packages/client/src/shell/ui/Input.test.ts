import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Input } from './Input.js';

async function render(props: Parameters<typeof Input>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Input, props));
  return new Response(prelude).text();
}

describe('Input', () => {
  it('label and action render together', async () => {
    const html = await render({ label: 'Senha', action: 'Mostrar' });
    expect(html).toContain('Senha');
    expect(html).toContain('Mostrar');
  });

  it('error replaces the hint footer instead of showing both', async () => {
    const withHint = await render({ hint: 'Entre 3 e 20 caracteres' });
    expect(withHint).toContain('Entre 3 e 20 caracteres');

    const withError = await render({ hint: 'Entre 3 e 20 caracteres', error: 'Nome em uso' });
    expect(withError).toContain('Nome em uso');
    expect(withError).not.toContain('Entre 3 e 20 caracteres');
    expect(withError).toContain('ui-input-error');
  });

  it('size="sm" type="number" is the NumField (RF-03b, DT-03)', async () => {
    const html = await render({ size: 'sm', type: 'number', value: '4' });
    expect(html).toContain('ui-input-sm');
    expect(html).toContain('type="number"');
    expect(html).toContain('value="4"');
  });

  it('passes native input props through, like placeholder', async () => {
    const html = await render({ placeholder: 'Nome do personagem' });
    expect(html).toContain('placeholder="Nome do personagem"');
  });
});
