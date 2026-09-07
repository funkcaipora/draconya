import { describe, expect, it } from 'vitest';
import { NOME_DO_PACOTE } from './index.js';

// Smoke test do esqueleto: prova que o pacote compila, resolve e roda sob o vitest.
// Some quando houver comportamento de verdade para testar.
describe('@draconya/protocol', () => {
  it('carrega', () => {
    expect(NOME_DO_PACOTE).toBe('@draconya/protocol');
  });
});
