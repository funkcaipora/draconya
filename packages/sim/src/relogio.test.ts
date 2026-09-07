import { describe, expect, it } from 'vitest';
import { RelogioDeTeste } from './relogio.js';

describe('RelogioDeTeste', () => {
  it('avança só quando mandado', () => {
    const r = new RelogioDeTeste(1000);
    expect(r.agoraMs()).toBe(1000);
    r.avancar(500);
    expect(r.agoraMs()).toBe(1500);
  });

  it('permite simular horas sem esperar horas', () => {
    // É o que torna o critério de saída da Fase 1 (FUN-44) testável no CI.
    const r = new RelogioDeTeste();
    r.avancar(6 * 60 * 60 * 1000);
    expect(r.agoraMs()).toBe(21_600_000);
  });

  it('não anda para trás', () => {
    expect(() => new RelogioDeTeste().avancar(-1)).toThrow();
  });
});
