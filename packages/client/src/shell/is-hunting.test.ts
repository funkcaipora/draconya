import { describe, expect, it } from 'vitest';
import { isHunting } from './is-hunting.js';

// "Em hunt" (RF-02, #502): o MESMO cálculo do `Shell` (#259) sobre o `sessionType` do
// analisador — o que o servidor disse por último. Puro, sem DOM.

describe('isHunting (#502)', () => {
  it('is false in the City and without a session', () => {
    expect(isHunting('city')).toBe(false);
    expect(isHunting(null)).toBe(false);
  });

  it('is true for any session that is not the City (hunt or manual content)', () => {
    expect(isHunting('hunt')).toBe(true);
    expect(isHunting('manual')).toBe(true);
  });
});
