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
    // catastrófico para ler dado. `'pseudo-latin1'` é o que o próprio README do luaparse
    // recomenda para texto comum (identity-map de ISO-8859-1, o mesmo encoding que o
    // `items.xml` já declara no prólogo).
    chunk = luaparse.parse(source, { luaVersion: '5.1', locations: true, encodingMode: 'pseudo-latin1' });
  } catch (erro) {
    throw new LuaEvalError(`erro de sintaxe Lua: ${(erro as Error).message}`);
  }
  const result: Record<string, LuaValue> = {};
  for (const statement of chunk.body) {
    collectAssignments(statement, rootName, constants, result);
  }
  return result;
}

function collectAssignments(
  statement: Statement, rootName: string, constants: ConstantResolver, into: Record<string, LuaValue>,
): void {
  if (statement.type === 'AssignmentStatement') {
    applyAssignment(statement, rootName, constants, into);
  } else if (statement.type === 'LocalStatement') {
    applyLocal(statement, rootName, constants, into);
  }
  // Outros tipos (CallStatement como `mType:register(monster)`, comentários, etc.) não
  // interessam: não são atribuição a `raiz.campo`.
}

function applyAssignment(
  statement: AssignmentStatement, rootName: string, constants: ConstantResolver, into: Record<string, LuaValue>,
): void {
  statement.variables.forEach((target, index) => {
    const field = fieldNameOf(target, rootName);
    if (field === null) return;
    const value = statement.init[index];
    if (value === undefined) return;
    into[field] = evaluateExpression(value, constants);
  });
}

/**
 * `local monster = { … }` também é uma forma válida (alguns arquivos preenchem tudo de uma vez
 * em vez de campo por campo); tratamos como se fosse `monster = { … }` quando o nome bate com
 * `rootName` e o valor inicial é uma tabela — o conteúdo dela vira os campos de `into`.
 */
function applyLocal(
  statement: LocalStatement, rootName: string, constants: ConstantResolver, into: Record<string, LuaValue>,
): void {
  statement.variables.forEach((variable, index) => {
    if (variable.name !== rootName) return;
    const value = statement.init[index];
    if (value === undefined || value.type !== 'TableConstructorExpression') return;
    const table = evaluateTable(value, constants);
    if (!Array.isArray(table)) Object.assign(into, table);
  });
}

/** `raiz.campo` → `"campo"`; qualquer outra forma (`raiz.a.b`, `outraCoisa.campo`) → `null`. */
function fieldNameOf(target: AssignmentStatement['variables'][number], rootName: string): string | null {
  if (target.type !== 'MemberExpression') return null;
  if (target.base.type !== 'Identifier' || target.base.name !== rootName) return null;
  return target.identifier.name;
}
