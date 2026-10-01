import { compileReflect } from '@draconya/content';
import type { CompiledReflect } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { reflectedDamageIntent, resolveReflect } from './reflect.js';

const table = (reflect: Parameters<typeof compileReflect>[0]): CompiledReflect => {
  const compiled = compileReflect(reflect);
  if (compiled === undefined) throw new Error('reflexo vazio');
  return compiled;
};

describe('resolveReflect (#552, game.cpp:7957-7981)', () => {
  const near = { maxHealth: 100_000, distance: 1 };
  const far = { maxHealth: 100_000, distance: 3 };

  it('percent é floor(dano × p / 100), mais o flat', () => {
    const reflect = { reflector: 'player' as const, table: table({ fire: { percent: 29, flat: 3 } }) };
    // 100 × 29 / 100 = 29 exato — a conta inteira não herda o 28,999… de 0,29 × 100.
    expect(resolveReflect(100, 'fire', reflect, near)?.amount).toBe(32);
    expect(resolveReflect(15, 'fire', reflect, near)?.amount).toBe(3 + 4);
  });

  it('o teto é ceil(1 % da vida máxima do atacante)', () => {
    const reflect = { reflector: 'player' as const, table: table({ physical: { flat: 42 } }) };
    expect(resolveReflect(0, 'physical', reflect, { maxHealth: 500, distance: 1 })?.amount).toBe(5);
    expect(resolveReflect(0, 'physical', reflect, { maxHealth: 501, distance: 1 })?.amount).toBe(6);
  });

  it('reflexo flat de físico do JOGADOR exige o atacante adjacente', () => {
    const reflect = { reflector: 'player' as const, table: table({ physical: { flat: 42 } }) };
    expect(resolveReflect(10, 'physical', reflect, far)).toBeUndefined();
    expect(resolveReflect(10, 'physical', reflect, near)?.amount).toBe(42);
  });

  it('com percentual, ou num tipo elemental, a distância não importa', () => {
    const percent = { reflector: 'player' as const, table: table({ physical: { percent: 10 } }) };
    expect(resolveReflect(100, 'physical', percent, far)?.amount).toBe(10);
    const elemental = { reflector: 'player' as const, table: table({ fire: { flat: 5 } }) };
    expect(resolveReflect(100, 'fire', elemental, far)?.amount).toBe(5);
  });

  it('o MONSTRO (#683) reflete o físico flat a qualquer distância, com o tipo original', () => {
    const reflect = { reflector: 'monster' as const, table: table({ physical: { flat: 7 } }) };
    expect(resolveReflect(10, 'physical', reflect, far))
      .toEqual({ amount: 7, damageType: 'physical', neutral: false });
  });

  it('jogador reflete dano NEUTRO; tipo sem reflexo não devolve nada', () => {
    const reflect = { reflector: 'player' as const, table: table({ ice: { percent: 50 } }) };
    expect(resolveReflect(100, 'ice', reflect, near)?.neutral).toBe(true);
    expect(resolveReflect(100, 'fire', reflect, near)).toBeUndefined();
  });

  it('a segunda resolução é extensão, sem bloqueio nem modificadores', () => {
    const intent = reflectedDamageIntent({ amount: 5, damageType: 'physical', neutral: true });
    expect(intent).toEqual({
      rawDamage: 5, source: 'reflect', damageType: 'physical',
      blockable: { armor: false, shield: false }, extension: true, neutral: true,
    });
  });
});
