import { describe, expect, it } from 'vitest';
import {
  count, duration, formatClock, gold, goldRate, optionalCount, rate,
} from './analyzer-format.js';

describe('analyzer-format (#315)', () => {
  it('formatClock sempre com dois dígitos em hora, minuto e segundo', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock(4 * 60_000 + 13_000)).toBe('00:04:13');
    expect(formatClock(3_661_000)).toBe('01:01:01');
    // Negativo não vira "-00:00:01": o relógio é uma leitura de tempo decorrido.
    expect(formatClock(-5_000)).toBe('00:00:00');
  });

  it('gold usa "gp" e a taxa fica depois da unidade', () => {
    expect(gold(500)).toBe('500 gp');
    expect(goldRate(500, 3_600_000)).toBe('500 gp/h');
    expect(rate(1_000, 3_600_000)).toBe('1.000/h');
  });

  it('count, duration e optionalCount mantêm a regra de sempre', () => {
    expect(count(1_234.6)).toBe('1.235');
    expect(duration(45_000)).toBe('45 s');
    expect(duration(4 * 60_000 + 13_000)).toBe('4 min');
    expect(duration(3_600_000)).toBe('1 h 0 min');
    expect(optionalCount(undefined)).toBe('—');
    expect(optionalCount(0)).toBe('0');
  });
});
