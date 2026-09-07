import { afterEach, describe, expect, it, vi } from 'vitest';
import { relogioDoSistema } from './relogio.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('relogioDoSistema', () => {
  it('mantém monotonicidade quando o relógio de parede muda', () => {
    const parede = vi.spyOn(Date, 'now');
    const monotonic = vi.spyOn(performance, 'now');
    parede.mockReturnValueOnce(1_000_000).mockReturnValueOnce(1);
    monotonic.mockReturnValueOnce(500).mockReturnValueOnce(501);

    const relogio = relogioDoSistema();

    expect(relogio.agoraMs()).toBe(500);
    expect(relogio.agoraMs()).toBe(501);
    expect(parede).not.toHaveBeenCalled();
  });
});
