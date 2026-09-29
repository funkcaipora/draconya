import { describe, expect, it, vi } from 'vitest';
import { FIGHT_MODES } from '@draconya/protocol';
import type { C2SMessage } from '@draconya/protocol';
import { chooseFightMode } from './fight-mode-intent.js';

describe('chooseFightMode (M30-03, #550)', () => {
  it('manda a INTENÇÃO com o modo escolhido — e só ele: nenhum fator, resultado ou instante', () => {
    for (const mode of FIGHT_MODES) {
      const send = vi.fn<(message: C2SMessage) => boolean>(() => true);
      expect(chooseFightMode(send, mode)).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ type: 'set-fight-mode', mode });
    }
  });

  it('devolve o que o remetente devolveu: socket fechado é `false`, e não estoura', () => {
    expect(chooseFightMode(() => false, 'defense')).toBe(false);
  });
});
