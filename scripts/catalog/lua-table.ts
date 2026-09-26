// scripts/catalog/lua-table.ts — avalia as tabelas Lua de monstro e de loja do Canary
// (`data-otservbr-global/monster/**/*.lua`, `npcConfig.shop` em `data-otservbr-global/npc/*.lua`)
// como dado, nunca como código.
//
// `luaparse` (MIT, JS puro, sem binário nativo — ADR 0013) faz só a análise sintática: devolve
// uma AST, e nada aqui EXECUTA Lua — não há efeito colateral, não há função de biblioteca padrão,
// não há `require`. O que este módulo faz é percorrer a AST de expressões literais (número,
// string, booleano, tabela) e resolver identificador contra um mapa de constantes fornecido
// (`COMBAT_*`, `BESTY_RACE_*`, `CONST_ME_*` — ver `enums.ts`), produzindo valores JS puros. É
// exatamente o limite de licença do ADR 0019/0038: número e fato saem, forma de código não.
//
// O padrão do Canary é sempre `local monster = {}` seguido de várias `monster.campo = <expr>`,
// e o mesmo vale para `npcConfig.shop = <expr>` nos arquivos de loja — um identificador RAIZ
// (`monster`, `npcConfig`) recebendo atribuições de um nível (`raiz.campo = valor`).
// `evaluateAssignments` generaliza os dois: lê TODAS as atribuições de primeiro nível cujo lado
// esquerdo é `<raiz>.<campo>` e devolve um objeto JS com cada campo já avaliado.

import * as luaparse from 'luaparse';
import type {
  AssignmentStatement, Chunk, Expression, LocalStatement, Statement, TableConstructorExpression,
} from 'luaparse';

export type LuaValue = string | number | boolean | null | LuaTable;
/**
 * Uma tabela Lua avaliada. Tabela só-posicional vira array; só-nomeada vira objeto; MISTA (as
 * duas formas juntas, como `monster.voices = { interval = 5000, chance = 10, { text = "..." } }`)
 * vira objeto com os campos nomeados e a parte posicional sob a chave reservada `$items` — `$`
 * nunca é o primeiro caractere de um identificador Lua, então a chave nunca colide com um campo
 * real.
 */
export type LuaTable = { readonly [key: string]: LuaValue } | readonly LuaValue[];

export const MIXED_TABLE_ITEMS_KEY = '$items';

export interface ConstantResolver {
  /** Devolve o valor do identificador, ou `undefined` quando ele não é conhecido. */
  resolve(name: string): string | number | undefined;
  /**
   * Devolve o valor de `raiz.campo` — auto-referência a um campo JÁ atribuído da MESMA raiz
   * (ex.: `npcConfig.maxHealth = npcConfig.health`, real em 1033 dos 1036 `npc/*.lua` do Canary,
   * e em 5 `monster.lua` como `werehyaena_shaman.lua`: `monster.maxHealth = monster.health`).
   * Opcional: só o resolvedor que `evaluateAssignments` monta implementa isto, porque só ele
   * conhece a raiz e o que já foi lido nas linhas anteriores do mesmo arquivo. `undefined`
   * é "não suportado" OU "campo ainda não atribuído" — os dois viram `LuaEvalError`, nunca
   * `undefined` em silêncio (a mesma regra de `resolve`).
   */
  resolveMember?(base: string, field: string): LuaValue | undefined;
}

/** Um mapa simples (`Map`/`Record`) também serve como resolvedor. */
export function constantsFrom(source: ReadonlyMap<string, number | string> | Readonly<Record<string, number | string>>): ConstantResolver {
  const map = source instanceof Map ? source : new Map(Object.entries(source));
  return { resolve: (name) => map.get(name) };
}

export class LuaEvalError extends Error {}

function locationOf(node: { readonly loc?: { readonly start: { readonly line: number } } | undefined }): string {
  return node.loc === undefined ? '' : ` (linha ${node.loc.start.line})`;
}

/** Avalia uma expressão Lua LITERAL — nunca uma chamada de função. */
export function evaluateExpression(node: Expression, constants: ConstantResolver): LuaValue {
  switch (node.type) {
    case 'StringLiteral':
      return node.value;
    case 'NumericLiteral':
      return node.value;
    case 'BooleanLiteral':
      return node.value;
    case 'NilLiteral':
      return null;
    case 'Identifier': {
      const value = constants.resolve(node.name);
      if (value === undefined) {
        throw new LuaEvalError(`identificador "${node.name}" sem constante conhecida${locationOf(node)}`);
      }
      return value;
    }
    case 'UnaryExpression': {
      const argument = evaluateExpression(node.argument, constants);
      if (node.operator === '-') {
        if (typeof argument !== 'number') throw new LuaEvalError(`"-" sobre valor não numérico${locationOf(node)}`);
        return -argument;
      }
      if (node.operator === 'not') return !truthy(argument);
      if (node.operator === '#') {
        if (Array.isArray(argument)) return argument.length;
        if (typeof argument === 'string') return argument.length;
        throw new LuaEvalError(`"#" sobre valor sem tamanho${locationOf(node)}`);
      }
      throw new LuaEvalError(`operador unário "${node.operator}" não suportado${locationOf(node)}`);
    }
    case 'BinaryExpression':
      return evaluateBinary(node.operator, evaluateExpression(node.left, constants), evaluateExpression(node.right, constants), node);
    case 'LogicalExpression': {
      const left = evaluateExpression(node.left, constants);
      if (node.operator === 'and') return truthy(left) ? evaluateExpression(node.right, constants) : left;
      return truthy(left) ? left : evaluateExpression(node.right, constants);
    }
    case 'TableConstructorExpression':
      return evaluateTable(node, constants);
    case 'MemberExpression': {
      // `raiz.campo` do lado DIREITO de uma atribuição — auto-referência, nunca navegação de
      // objeto de verdade (isto não executa Lua). `constants.resolveMember` é quem sabe
      // resolver; sem ele (ou base que não é um identificador simples), é expressão não
      // suportada, igual a qualquer outra forma que este avaliador não reconhece.
      if (node.base.type !== 'Identifier' || constants.resolveMember === undefined) {
        throw new LuaEvalError(`expressão "MemberExpression" não suportada${locationOf(node)}`);
      }
      const value = constants.resolveMember(node.base.name, node.identifier.name);
      if (value === undefined) {
        throw new LuaEvalError(`"${node.base.name}.${node.identifier.name}" sem valor conhecido (auto-referência não resolvida)${locationOf(node)}`);
      }
      return value;
    }
    default:
      throw new LuaEvalError(`expressão "${node.type}" não suportada — tabela de dado não chama função${locationOf(node)}`);
  }
}

function truthy(value: LuaValue): boolean {
  return value !== false && value !== null;
}

function evaluateBinary(operator: string, left: LuaValue, right: LuaValue, node: Expression): LuaValue {
  if (operator === '..') return `${luaToText(left)}${luaToText(right)}`;
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new LuaEvalError(`"${operator}" precisa de dois números${locationOf(node)}`);
  }
  switch (operator) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/': return left / right;
    case '%': return left % right;
    case '^': return left ** right;
    case '//': return Math.floor(left / right);
    case '<<': return left << right;
    case '>>': return left >> right;
    case '&': return left & right;
    case '|': return left | right;
    case '~': return left ^ right;
    default:
      throw new LuaEvalError(`operador binário "${operator}" não suportado${locationOf(node)}`);
  }
}

function luaToText(value: LuaValue): string {
  if (value === null) return 'nil';
  if (typeof value === 'object') throw new LuaEvalError('".." não concatena tabela');
  return String(value);
}

function evaluateTable(node: TableConstructorExpression, constants: ConstantResolver): LuaTable {
  const positional: LuaValue[] = [];
  const named: Record<string, LuaValue> = {};
  for (const field of node.fields) {
    if (field.type === 'TableValue') {
      positional.push(evaluateExpression(field.value, constants));
    } else if (field.type === 'TableKeyString') {
      named[field.key.name] = evaluateExpression(field.value, constants);
    } else {
      const key = evaluateExpression(field.key, constants);
      named[luaToText(key)] = evaluateExpression(field.value, constants);
    }
  }
  const hasNamed = Object.keys(named).length > 0;
  const hasPositional = positional.length > 0;
  if (hasNamed && hasPositional) return { ...named, [MIXED_TABLE_ITEMS_KEY]: positional };
  if (hasNamed) return named;
  return positional;
}

/** Percorre `raiz.campo = <expr>` no nível mais alto do chunk e devolve o objeto acumulado. */
export function evaluateAssignments(source: string, rootName: string, constants: ConstantResolver): Record<string, LuaValue> {
  let chunk: Chunk;
  try {
    // `encodingMode` PRECISA ser explícito: o padrão do luaparse é `'none'`, que descarta o
    // CONTEÚDO de toda string literal e devolve `value: null` — ótimo para só validar sintaxe,
    // catastrófico para ler dado. `'pseudo-latin1'` é o modo que NÃO descarta conteúdo e aceita
    // qualquer caractere já decodificado até `\xff` (Latin-1 Supplement, onde mora todo acento
    // do português/alemão que os `.lua` do Canary usam) como identidade — sem exigir que o
    // ARQUIVO tenha sido lido como Latin-1. Quem chama `evaluateAssignments` decodifica o
    // arquivo como **UTF-8** (o encoding real do checkout — `file data-otservbr-global/monster/
    // giants/frost_giant.lua` confirma "UTF-8 text"; ISO-8859-1 é o que o `items.xml`
    // declara no próprio prólogo, um arquivo diferente, sem relação com Lua). Decodificar como
    // Latin-1 byte a byte quebraria qualquer caractere multibyte de verdade em dois caracteres
    // (mojibake) ANTES mesmo do parser rodar — `pseudo-latin1` não notaria, porque os dois
    // bytes resultantes também ficam ≤ 0xff.
    //
    // `luaVersion` é `'LuaJIT'` porque é o que Canary/TFS de fato embutem (`#if LUA_VERSION_NUM
    // >= 502`/`>= 503` em `src/config/configmanager.cpp`/`src/lua/scripts/luascript.cpp`) —
    // `'5.1'` rejeita a continuação de linha `\z` que 166 dos 1656 `monster/**/*.lua` reais
    // usam (`Locations = "... \z\n\t\tMammoth Shearing Factory..."`, `giants/frost_giant.lua`),
    // derrubando o arquivo inteiro por causa de uma string descritiva.
    chunk = luaparse.parse(source, { luaVersion: 'LuaJIT', locations: true, encodingMode: 'pseudo-latin1' });
  } catch (erro) {
    throw new LuaEvalError(`erro de sintaxe Lua: ${(erro as Error).message}`);
  }
  const result: Record<string, LuaValue> = {};
  // `local NOME = <expr>` que não é `local <rootName> = { … }` (tratado à parte, abaixo) —
  // por exemplo `local internalNpcName = "Nicholas"`, presente em 1028 dos 1036 `npc/*.lua`
  // reais, sempre seguido de `npcConfig.name = internalNpcName`. Só entra aqui quando avalia
  // para `string`/`number`: é exatamente o que `scope.resolve` abaixo devolve, e nada mais
  // precisa reconhecer um identificador local.
  const locals = new Map<string, string | number>();
  const scope: ConstantResolver = {
    resolve: (name) => {
      const local = locals.get(name);
      return local === undefined ? constants.resolve(name) : local;
    },
    // Auto-referência `raiz.campo` contra o que ESTE arquivo já atribuiu antes desta linha
    // (`npcConfig.maxHealth = npcConfig.health`, real em 1033/1036 `npc/*.lua`, e em
    // `monster.maxHealth = monster.health` de 5 `monster.lua` como `werehyaena_shaman.lua`).
    resolveMember: (base, field) => (base === rootName ? result[field] : undefined),
  };
  for (const statement of chunk.body) {
    collectAssignments(statement, rootName, scope, locals, result);
  }
  return result;
}

function collectAssignments(
  statement: Statement, rootName: string, scope: ConstantResolver,
  locals: Map<string, string | number>, into: Record<string, LuaValue>,
): void {
  if (statement.type === 'AssignmentStatement') {
    applyAssignment(statement, rootName, scope, into);
  } else if (statement.type === 'LocalStatement') {
    applyLocal(statement, rootName, scope, locals, into);
  }
  // Outros tipos (CallStatement como `mType:register(monster)`, comentários, etc.) não
  // interessam: não são atribuição a `raiz.campo`.
}

function applyAssignment(
  statement: AssignmentStatement, rootName: string, scope: ConstantResolver, into: Record<string, LuaValue>,
): void {
  statement.variables.forEach((target, index) => {
    const field = fieldNameOf(target, rootName);
    if (field === null) return;
    const value = statement.init[index];
    if (value === undefined) return;
    into[field] = evaluateExpression(value, scope);
  });
}

/**
 * `local monster = { … }` também é uma forma válida (alguns arquivos preenchem tudo de uma vez
 * em vez de campo por campo); tratamos como se fosse `monster = { … }` quando o nome bate com
 * `rootName` e o valor inicial é uma tabela — o conteúdo dela vira os campos de `into`.
 *
 * Qualquer OUTRO `local NOME = <expr>` (nome diferente de `rootName`, ou `rootName` com um
 * valor que não é tabela) é candidato a identificador reaproveitável mais adiante — registrado
 * em `locals` quando avalia para `string`/`number`. Quando a expressão não é avaliável como
 * dado puro (`local mType = Game.createMonsterType("Rat")`, uma CHAMADA — a primeira linha de
 * praticamente todo arquivo), o erro é engolido de propósito: nada aqui garante que o
 * identificador seja referenciado depois, e travar o arquivo inteiro por causa de um `local`
 * que ninguém usa contradiz o resto deste módulo (avaliar só o que é dado, ignorar o resto).
 */
function applyLocal(
  statement: LocalStatement, rootName: string, scope: ConstantResolver,
  locals: Map<string, string | number>, into: Record<string, LuaValue>,
): void {
  statement.variables.forEach((variable, index) => {
    const value = statement.init[index];
    if (value === undefined) return;
    if (variable.name === rootName && value.type === 'TableConstructorExpression') {
      const table = evaluateTable(value, scope);
      if (!Array.isArray(table)) Object.assign(into, table);
      return;
    }
    try {
      const evaluated = evaluateExpression(value, scope);
      if (typeof evaluated === 'string' || typeof evaluated === 'number') {
        locals.set(variable.name, evaluated);
      }
    } catch {
      // Ignorado de propósito — ver o comentário do doc-block acima.
    }
  });
}

/** `raiz.campo` → `"campo"`; qualquer outra forma (`raiz.a.b`, `outraCoisa.campo`) → `null`. */
function fieldNameOf(target: AssignmentStatement['variables'][number], rootName: string): string | null {
  if (target.type !== 'MemberExpression') return null;
  if (target.base.type !== 'Identifier' || target.base.name !== rootName) return null;
  return target.identifier.name;
}
