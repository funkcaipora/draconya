import { describe, expect, it } from 'vitest';
import { constantsFrom } from './lua-table.js';
import { collectMethodCalls, parseSpellSource, spellReceiver } from './spell-calls.js';

const CONSTANTS = constantsFrom({
  COMBAT_PARAM_TYPE: 'COMBAT_PARAM_TYPE', COMBAT_PARAM_EFFECT: 'COMBAT_PARAM_EFFECT',
  COMBAT_FIREDAMAGE: 'COMBAT_FIREDAMAGE', CONST_ME_FIREATTACK: 'CONST_ME_FIREATTACK',
});

// Fixture SINTÉTICA no formato do Canary — números e nomes inventados, nunca um arquivo real
// copiado (ADR 0019/0038 decisão 7), só para exercitar o leitor de CHAMADA.
const SPELL = `
local combat = Combat()
combat:setParameter(COMBAT_PARAM_TYPE, COMBAT_FIREDAMAGE)
combat:setParameter(COMBAT_PARAM_EFFECT, CONST_ME_FIREATTACK)

local spell = Spell("instant")

function spell.onCastSpell(creature, var)
	return combat:execute(creature, var)
end

spell:name("Test Bolt")
spell:words("test bolt")
spell:group("attack")
spell:vocation("sorcerer;true", "druid;true")
spell:level(23)
spell:mana(40)
spell:soul(1)
spell:cooldown(2 * 1000)
spell:groupCooldown(2 * 1000)
spell:range(5)
spell:needTarget(true)
spell:register()
`;

const RUNE = `
local combat = Combat()
local rune = Spell("rune")
rune:id(999)
rune:name("test rune")
rune:runeId(3160)
rune:charges(3)
rune:magicLevel(10)
rune:level(50)
rune:register()
`;

describe('spellReceiver', () => {
  it('acha o receptor "spell" e o kind "instant"', () => {
    const chunk = parseSpellSource(SPELL);
    expect(spellReceiver(chunk)).toEqual({ receiver: 'spell', kind: 'instant' });
  });

  it('acha o receptor "rune" e o kind "rune"', () => {
    const chunk = parseSpellSource(RUNE);
    expect(spellReceiver(chunk)).toEqual({ receiver: 'rune', kind: 'rune' });
  });

  it('devolve null sem "local X = Spell(...)"', () => {
    const chunk = parseSpellSource('local x = 1\n');
    expect(spellReceiver(chunk)).toBeNull();
  });
});

describe('collectMethodCalls', () => {
  it('lê toda chamada "spell:campo(args)" de nível topo, na ordem do arquivo', () => {
    const chunk = parseSpellSource(SPELL);
    const calls = collectMethodCalls(chunk, 'spell', CONSTANTS);
    expect(calls).toEqual([
      { method: 'name', args: ['Test Bolt'] },
      { method: 'words', args: ['test bolt'] },
      { method: 'group', args: ['attack'] },
      { method: 'vocation', args: ['sorcerer;true', 'druid;true'] },
      { method: 'level', args: [23] },
      { method: 'mana', args: [40] },
      { method: 'soul', args: [1] },
      { method: 'cooldown', args: [2000] },
      { method: 'groupCooldown', args: [2000] },
      { method: 'range', args: [5] },
      { method: 'needTarget', args: [true] },
      { method: 'register', args: [] },
    ]);
  });

  it('ignora chamada de outro receptor ("combat:setParameter" quando o receptor pedido é "spell")', () => {
    const chunk = parseSpellSource(SPELL);
    const calls = collectMethodCalls(chunk, 'combat', CONSTANTS);
    expect(calls).toEqual([
      { method: 'setParameter', args: ['COMBAT_PARAM_TYPE', 'COMBAT_FIREDAMAGE'] },
      { method: 'setParameter', args: ['COMBAT_PARAM_EFFECT', 'CONST_ME_FIREATTACK'] },
    ]);
  });

  it('lê chamada de runa ("rune:campo(args)")', () => {
    const chunk = parseSpellSource(RUNE);
    const calls = collectMethodCalls(chunk, 'rune', CONSTANTS);
    expect(calls).toEqual([
      { method: 'id', args: [999] },
      { method: 'name', args: ['test rune'] },
      { method: 'runeId', args: [3160] },
      { method: 'charges', args: [3] },
      { method: 'magicLevel', args: [10] },
      { method: 'level', args: [50] },
      { method: 'register', args: [] },
    ]);
  });
});
