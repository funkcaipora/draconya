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

  it('local NOME = <literal> vira identificador reaproveitável depois — o nome interno do NPC', () => {
    // O padrão real de 1028 dos 1036 `npc/*.lua` do Canary: o nome "de verdade" mora num
    // `local` fora de `npcConfig`, e `npcConfig.name` só referencia o identificador.
    const source = `
      local internalNpcName = "Nicholas"
      local npcConfig = {}
      npcConfig.name = internalNpcName
    `;
    expect(evaluateAssignments(source, 'npcConfig', NO_CONSTANTS)).toEqual({ name: 'Nicholas' });
  });

  it('local que não é avaliável como dado (chamada de função) é ignorado, não lança', () => {
    // `local mType = Game.createMonsterType("Rat")` é a primeira linha de praticamente todo
    // `monster.lua` real — não é dado, e nada o referencia depois como identificador.
    const source = `
      local mType = Game.createMonsterType("Rat")
      monster.health = 20
    `;
    expect(evaluateAssignments(source, 'monster', NO_CONSTANTS)).toEqual({ health: 20 });
  });

  it('raiz.campo pode se referir a outro campo JÁ atribuído da mesma raiz (auto-referência)', () => {
    // `npcConfig.maxHealth = npcConfig.health` é real em 1033 dos 1036 `npc/*.lua`, e o mesmo
    // padrão aparece em `monster.maxHealth = monster.health` (5 `monster.lua`, ex.
    // `lycanthropes/werehyaena_shaman.lua`).
    const source = `
      local npcConfig = {}
      npcConfig.health = 100
      npcConfig.maxHealth = npcConfig.health
    `;
    expect(evaluateAssignments(source, 'npcConfig', NO_CONSTANTS)).toEqual({
      health: 100, maxHealth: 100,
    });
  });

  it('auto-referência a um campo AINDA não atribuído lança — nunca vira undefined em silêncio', () => {
    const source = 'npcConfig.maxHealth = npcConfig.health';
    expect(() => evaluateAssignments(source, 'npcConfig', NO_CONSTANTS)).toThrow(LuaEvalError);
    expect(() => evaluateAssignments(source, 'npcConfig', NO_CONSTANTS)).toThrow(/auto-referência/);
  });

  it('auto-referência contra outra raiz (não a que evaluateAssignments está lendo) lança', () => {
    const source = 'monster.x = outraCoisa.y';
    expect(() => evaluateAssignments(source, 'monster', NO_CONSTANTS)).toThrow(LuaEvalError);
  });

  it('a continuação de linha "\\z" (Lua 5.2+/LuaJIT) é aceita — real em 166 dos 1656 monster.lua', () => {
    // `Locations = "Tyrsung ..., \z\n\t\tMammoth Shearing Factory..."`, formato real de
    // `data-otservbr-global/monster/giants/frost_giant.lua`. `luaVersion: '5.1'` rejeitaria
    // isto com "unfinished string" — LuaJIT (o que Canary/TFS de fato embutem) aceita.
    const source = 'monster.description = "parte um \\z\n        parte dois"';
    expect(evaluateAssignments(source, 'monster', NO_CONSTANTS)).toEqual({
      description: 'parte um parte dois',
    });
  });

  it('o arquivo precisa ser decodificado como UTF-8, nunca Latin-1 — o encoding real do Canary/TFS', () => {
    // Um caractere acentuado (o "ö" de "Bröre", `giants/frost_giant.lua`) é DOIS bytes em UTF-8
    // (0xC3 0xB6). `evaluateAssignments` não lê arquivo — quem chama decide o encoding — mas o
    // valor que chega aqui já carrega o defeito se o arquivo tiver sido decodificado errado:
    // decodificar como 'latin1' (byte a byte) separa o caractere em DOIS (mojibake); como
    // 'utf8' funde os dois bytes de volta no único caractere correto.
    const bytes = Buffer.from('monster.description = "Bröre"', 'utf8');
    const decodedCorrectly = evaluateAssignments(bytes.toString('utf8'), 'monster', NO_CONSTANTS);
    expect(decodedCorrectly['description']).toBe('Bröre');
    const decodedWrong = evaluateAssignments(bytes.toString('latin1'), 'monster', NO_CONSTANTS);
    expect(decodedWrong['description']).not.toBe('Bröre');
  });
});
