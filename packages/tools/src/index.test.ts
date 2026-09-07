import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

// Smoke test do esqueleto: prova que o pacote compila, resolve e roda sob o vitest.
// Some quando houver comportamento de verdade para testar.
describe('@draconya/tools', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@draconya/tools');
  });
});
