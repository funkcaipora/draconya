import { describe, expect, it } from 'vitest';
import {
  LuaEvalError, MIXED_TABLE_ITEMS_KEY, constantsFrom, evaluateAssignments,
} from './lua-table.js';

const NO_CONSTANTS = constantsFrom({});

describe('evaluateAssignments', () => {
  it('lê monster.campo = <expr> repetido, no formato real do Canary', () => {
    // Uma fixture PEQUENA, no formato do Canary — nunca um arquivo real copiado (ADR 0019).
    const source = `
      local mType = Game.createMonsterType("Rat")
      local monster = {}
      monster.description = "a rat"
      monster.experience = 5
      monster.health = 20
      mType:register(monster)
    `;
    expect(evaluateAssignments(source, 'monster', NO_CONSTANTS)).toEqual({
      description: 'a rat', experience: 5, health: 20,
    });
  });

  it('também lê local monster = { … } preenchido de uma vez', () => {
    const source = `
      local monster = { description = "a rat", experience = 5 }
      monster.health = 20
    `;
    expect(evaluateAssignments(source, 'monster', NO_CONSTANTS)).toEqual({
      description: 'a rat', experience: 5, health: 20,
    });
  });

  it('tabela só-posicional vira array; só-nomeada vira objeto', () => {
    const source = `
      monster.elements = { { type = 1, percent = 10 }, { type = 2, percent = -10 } }
      monster.outfit = { lookType = 21, lookHead = 0 }
    `;
    const result = evaluateAssignments(source, 'monster', NO_CONSTANTS);
    expect(result['elements']).toEqual([{ type: 1, percent: 10 }, { type: 2, percent: -10 }]);
    expect(result['outfit']).toEqual({ lookType: 21, lookHead: 0 });
  });

  it('tabela MISTA (nomeada + posicional) vira objeto com $items — o caso de monster.voices', () => {
    const source = `
      monster.voices = { interval = 5000, chance = 10, { text = "Meep!", yell = false } }
    `;
    expect(evaluateAssignments(source, 'monster', NO_CONSTANTS)['voices']).toEqual({
      interval: 5000, chance: 10, [MIXED_TABLE_ITEMS_KEY]: [{ text: 'Meep!', yell: false }],
    });
  });

  it('resolve identificador contra o mapa de constantes fornecido', () => {
    const constants = constantsFrom({ COMBAT_EARTHDAMAGE: 2 });
    const source = 'monster.elements = { { type = COMBAT_EARTHDAMAGE, percent = 20 } }';
    expect(evaluateAssignments(source, 'monster', constants)).toEqual({
      elements: [{ type: 2, percent: 20 }],
    });
  });

  it('identificador SEM constante conhecida lança LuaEvalError — nunca vira undefined em silêncio', () => {
    const source = 'monster.elements = { { type = COMBAT_DESCONHECIDO, percent = 0 } }';
    expect(() => evaluateAssignments(source, 'monster', NO_CONSTANTS)).toThrow(LuaEvalError);
    expect(() => evaluateAssignments(source, 'monster', NO_CONSTANTS)).toThrow(/COMBAT_DESCONHECIDO/);
  });

  it('número negativo (dano do golpe, ex. maxDamage = -8)', () => {
    const source = 'monster.attacks = { { minDamage = 0, maxDamage = -8 } }';
    expect(evaluateAssignments(source, 'monster', NO_CONSTANTS)).toEqual({
      attacks: [{ minDamage: 0, maxDamage: -8 }],
    });
  });

  it('chamada de função dentro da tabela lança — nunca executamos Lua', () => {
    const source = 'monster.something = someFunction()';
    expect(() => evaluateAssignments(source, 'monster', NO_CONSTANTS)).toThrow(LuaEvalError);
  });

  it('atribuição a outra raiz (não "monster") é ignorada', () => {
    const source = `
      local mType = Game.createMonsterType("Rat")
      monster.health = 20
      npcConfig.name = "Should not appear"
    `;
    expect(evaluateAssignments(source, 'monster', NO_CONSTANTS)).toEqual({ health: 20 });
  });

  it('serve também para npcConfig.shop, com a mesma função (o mesmo padrão raiz.campo)', () => {
    const source = `
      local npcConfig = {}
      npcConfig.name = "Rachel"
      npcConfig.shop = {
        { itemName = "backpack", sell = 5 },
      }
    `;
    expect(evaluateAssignments(source, 'npcConfig', NO_CONSTANTS)).toEqual({
      name: 'Rachel', shop: [{ itemName: 'backpack', sell: 5 }],
    });
  });

  it('erro de sintaxe Lua vira LuaEvalError, não uma exceção crua do luaparse', () => {
    expect(() => evaluateAssignments('monster.x = }{', 'monster', NO_CONSTANTS)).toThrow(LuaEvalError);
  });
});
