// scripts/catalog/spell-calls.ts — lê `receptor:método(args)` de nível topo de um script de
// magia/runa do Canary (`data/scripts/spells/**/*.lua`, `data/scripts/runes/**/*.lua`) como DADO,
// nunca como código (ADR 0019 limite 1, ADR 0038 decisão 7).
//
// O padrão do Canary aqui é DIFERENTE do de monstro/loja que `lua-table.ts` já lê: lá é
// ATRIBUIÇÃO (`monster.campo = <expr>`); aqui é CHAMADA DE MÉTODO com dois-pontos
// (`spell:name("Brutal Strike")`, `combat:setParameter(COMBAT_PARAM_TYPE, COMBAT_FIREDAMAGE)`).
// Este módulo generaliza para chamada o mesmo princípio de `evaluateAssignments`: percorre o
// chunk de nível topo, reconhece `receptor:método(args)` e avalia cada argumento como expressão
// LITERAL (`evaluateExpression`, reaproveitado de `lua-table.ts` — nunca uma chamada aninhada).

import * as luaparse from 'luaparse';
import type { CallStatement, Chunk, Expression, LocalStatement } from 'luaparse';
import { evaluateExpression, type ConstantResolver, type LuaValue } from './lua-table.js';

/** Uma chamada `receptor:método(args)` de nível topo, na ordem do arquivo. */
export interface MethodCall {
  readonly method: string;
  readonly args: readonly LuaValue[];
}

const PARSE_OPTIONS = { luaVersion: 'LuaJIT' as const, locations: true, encodingMode: 'pseudo-latin1' as const };

/** Faz o parse uma vez — quem chama várias funções deste módulo sobre o MESMO `source` evita reparsear. */
export function parseSpellSource(source: string): Chunk {
  return luaparse.parse(source, PARSE_OPTIONS);
}

/**
 * Toda `receptor:método(args)` de nível topo do chunk, na ordem em que aparece no arquivo.
 * `combat:setParameter(...)`/`spell:vocation(...)`/`rune:magicLevel(...)` são todos a MESMA forma
 * — só muda o nome do receptor local.
 */
export function collectMethodCalls(chunk: Chunk, receiver: string, constants: ConstantResolver): MethodCall[] {
  const calls: MethodCall[] = [];
  for (const statement of chunk.body) {
    if (statement.type !== 'CallStatement') continue;
    const expr = (statement as CallStatement).expression;
    if (expr.type !== 'CallExpression') continue;
    const base = expr.base;
    if (base.type !== 'MemberExpression') continue;
    if (base.indexer !== ':') continue;
    if (base.base.type !== 'Identifier' || base.base.name !== receiver) continue;
    calls.push({
      method: base.identifier.name,
      args: expr.arguments.map((argument: Expression) => evaluateExpression(argument, constants)),
    });
  }
  return calls;
}

/**
 * O nome do RECEPTOR (`spell`/`rune`, ou qualquer outro identificador local) e o KIND declarado
 * (`Spell("instant")` ou `Spell("rune")`) — de `local <nome> = Spell(<kind>)`, a forma que todo
 * arquivo real usa (`local spell = Spell("instant")`, `local rune = Spell("rune")`). `null`
 * quando o arquivo não tem essa atribuição — não é um script de magia/runa reconhecível por este
 * leitor (ex.: os utilitários de `house/`, já fora do escopo antes de chegar aqui).
 */
export function spellReceiver(chunk: Chunk): { readonly receiver: string; readonly kind: string } | null {
  for (const statement of chunk.body) {
    if (statement.type !== 'LocalStatement') continue;
    const local = statement as LocalStatement;
    for (const [index, variable] of local.variables.entries()) {
      const init = local.init[index];
      if (init === undefined || init.type !== 'CallExpression') continue;
      if (init.base.type !== 'Identifier' || init.base.name !== 'Spell') continue;
      const kindArg = init.arguments[0];
      if (kindArg === undefined || kindArg.type !== 'StringLiteral') continue;
      return { receiver: variable.name, kind: kindArg.value };
    }
  }
  return null;
}
