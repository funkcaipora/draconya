import { describe, expect, it } from 'vitest';
import { parseSpellSource } from './spell-calls.js';
import { recognizeFormula, toSpellFormula, type RecognizedFormula } from './spell-formula.js';

// As quatro fixtures abaixo são SINTÉTICAS — a FORMA (assinatura de `onGetFormulaValues`, o jeito
// de somar/multiplicar) é a do Canary real (verificada contra o checkout local em
// `data/scripts/spells/attack/{brutal_strike,fierce_berserk,strong_flame_strike}.lua`), mas os
// NÚMEROS aqui são inventados — nunca uma linha copiada (ADR 0019/0038 decisão 7). Os números
// reais são conferidos à parte, no bloco `describe.skipIf(!HAS_CANARY)` de `spells.test.ts`.

/** A forma "magic" — `(player, level, maglevel)`, `CALLBACK_PARAM_LEVELMAGICVALUE`. */
const MAGIC_SHAPE = `
function onGetFormulaValues(player, level, maglevel)
	local min = (level / 5) + (maglevel * 1.5) + 10
	local max = (level / 5) + (maglevel * 3) + 20
	return -min, -max
end
`;

/** A forma "skill-attack" com PRODUTO — o formato do Brutal Strike. */
const SKILL_ATTACK_PRODUCT_SHAPE = `
function onGetFormulaValues(player, skill, attack, factor)
	local skillTotal = skill * attack
	local levelTotal = player:getLevel() / 5
	return -(((skillTotal * 0.1) + 2) + levelTotal) * 2, -(((skillTotal * 0.2) + 4) + levelTotal) * 2
end
`;

/** A forma "skill-attack" com TERMOS LINEARES separados — o formato do Fierce Berserk. */
const SKILL_ATTACK_LINEAR_SHAPE = `
function onGetFormulaValues(player, skill, attack, factor)
	local level = player:getLevel()
	local min = (level / 5) + (skill + 2 * attack) * 1.5
	local max = (level / 5) + (skill + 2 * attack) * 4
	return -min * 2, -max * 2
end
`;

/** Uma magia de CURA, sem o `-` externo — o retorno é positivo (a poção/magia não tira vida). */
const HEAL_SHAPE = `
function onGetFormulaValues(player, level, maglevel)
	local min = (level / 5) + (maglevel * 2) + 5
	local max = (level / 5) + (maglevel * 3) + 15
	return min, max
end
`;

function recognize(source: string): RecognizedFormula {
  const result = recognizeFormula(parseSpellSource(source));
  if (typeof result === 'string' || result === null) throw new Error(`esperava fórmula reconhecida, achei: ${String(result)}`);
  return result;
}

describe('recognizeFormula — forma "magic"', () => {
  it('reduz level/maglevel para os coeficientes esperados', () => {
    const formula = recognize(MAGIC_SHAPE);
    expect(formula.shape).toBe('magic');
    expect(toSpellFormula(formula)).toEqual({
      levelFactor: 0.2, skillMin: 1.5, skillMax: 3, baseMin: 10, baseMax: 20, scaling: 'magic',
    });
  });

  it('cura (sem "-" externo) não inverte o sinal', () => {
    const formula = recognize(HEAL_SHAPE);
    expect(toSpellFormula(formula)).toEqual({
      levelFactor: 0.2, skillMin: 2, skillMax: 3, baseMin: 5, baseMax: 15, scaling: 'magic',
    });
  });
});

describe('recognizeFormula — forma "skill-attack"', () => {
  it('reconhece o produto skill*attack (Brutal Strike)', () => {
    const formula = recognize(SKILL_ATTACK_PRODUCT_SHAPE);
    expect(formula.shape).toBe('skill-attack');
    // (0.1*2, 2*2, level/5*2) => skillAttackMin 0.2, baseMin 4, levelFactor 0.4
    expect(toSpellFormula(formula)).toEqual({
      levelFactor: 0.4, skillMin: 0, skillMax: 0, baseMin: 4, baseMax: 8,
      skillAttackMin: 0.2, skillAttackMax: 0.4,
    });
  });

  it('reconhece termos lineares de skill/attack com fator aninhado (Fierce Berserk)', () => {
    const formula = recognize(SKILL_ATTACK_LINEAR_SHAPE);
    expect(formula.shape).toBe('skill-attack');
    // level/5 * 2 => 0.4; skill*1.5*2=3, attack*2*1.5*2=6; max: skill*4*2=8, attack*2*4*2=16
    expect(toSpellFormula(formula)).toEqual({
      levelFactor: 0.4, skillMin: 3, skillMax: 8, baseMin: 0, baseMax: 0,
      attackMin: 6, attackMax: 16,
    });
  });
});

describe('recognizeFormula — casos de borda', () => {
  it('devolve null quando a função não existe', () => {
    expect(recognizeFormula(parseSpellSource('local x = 1\n'))).toBeNull();
  });

  it('devolve o motivo (string) para assinatura fora das duas formas', () => {
    const source = 'function onGetFormulaValues(player, foo)\n  return -1, -2\nend\n';
    const result = recognizeFormula(parseSpellSource(source));
    expect(typeof result).toBe('string');
    expect(result).toContain('assinatura não reconhecida');
  });

  it('devolve o motivo para forma algébrica fora do reconhecido (produto de duas variáveis que não é skill*attack)', () => {
    const source = `
function onGetFormulaValues(player, level, maglevel)
	local min = level * maglevel
	return -min, -min
end
`;
    const result = recognizeFormula(parseSpellSource(source));
    expect(typeof result).toBe('string');
  });

  it('devolve o motivo quando o "return" não tem dois valores', () => {
    const source = 'function onGetFormulaValues(player, level, maglevel)\n  return -1\nend\n';
    const result = recognizeFormula(parseSpellSource(source));
    expect(result).toContain('esperava 2');
  });
});
