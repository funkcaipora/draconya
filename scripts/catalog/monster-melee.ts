// scripts/catalog/monster-melee.ts — a faixa do `melee` de monstro do Canary (#684, M35-G7;
// ADR 0037/0038).
//
// O `melee` do Canary se declara de duas formas: a faixa explícita (`minDamage`/`maxDamage`) ou
// `skill` + `attack`, que o servidor converte em faixa NA CARGA (`Monsters::deserializeSpell`,
// `Weapons::getMaxMeleeDamage`). O Draconya só tem a faixa (`power: { min, max }`), então a
// conversão acontece aqui, no importador — o mesmo momento em que o Canary a faz.
//
// Só o NÚMERO e a precedência vêm do Canary (ADR 0019 limite 1): nenhuma linha de C++ ou Lua é
// reproduzida.

import type { LuaValue } from './lua-table.js';

/**
 * O máximo do golpe, em `double` e NA MESMA ORDEM do Canary: `attack * 0.05` primeiro, depois
 * `* skill`, depois `+ attack * 0.5`, e o `ceil` por último. Reordenar para a aritmética inteira
 * (`ceil(attack * (skill + 10) / 20)`) "limpa" o ponto flutuante e ERRA por 1 quatro monstros
 * reais: 50/82 dá 246.00000000000003 em `double`, e o Canary devolve 247 — não 246.
 */
export function maxMeleeDamage(skill: number, attack: number): number {
  return Math.ceil(skill * (attack * 0.05) + attack * 0.5);
}

/** De onde a faixa saiu — o relatório conta cada caso. */
export type MeleePowerVia = 'skill-attack' | 'min-max' | 'none';

export interface MeleePowerResult {
  readonly kind: 'range';
  /** A faixa em MAGNITUDE (dano positivo), como o `power` do schema e o sorteio do `sim`. */
  readonly power: { readonly min: number; readonly max: number };
  readonly via: MeleePowerVia;
}

const numberOf = (value: LuaValue | undefined): number | undefined =>
  typeof value === 'number' ? value : undefined;

/**
 * A faixa do `melee` com a precedência do Canary:
 *
 * 1. `skill` e `attack` ambos > 0 SUBSTITUEM qualquer faixa declarada: `0..maxMeleeDamage`.
 * 2. Senão, a faixa `minDamage`/`maxDamage` — mas só com os DOIS declarados (o leitor Lua do
 *    Canary só chama `setCombatValue` assim). Um lado só, ou nenhum, é `0..0`.
 * 3. O dano do Canary é negativo; a faixa `[lo, hi]` vira a magnitude `[max(0, −hi), max(0, −lo)]`.
 *    A parte positiva de uma faixa (que no Canary cura o alvo) não tem forma no `power` e vira 0.
 *
 * `attack` ≤ 0 (Plagueroot, `attack = -560`) desliga a fórmula e cai no passo 2 — como no Canary.
 */
export function meleePower(line: Readonly<Record<string, LuaValue>>): MeleePowerResult {
  const skill = numberOf(line['skill']);
  const attack = numberOf(line['attack']);
  if (skill !== undefined && attack !== undefined && skill > 0 && attack > 0) {
    return { kind: 'range', power: { min: 0, max: maxMeleeDamage(skill, attack) }, via: 'skill-attack' };
  }
  const minDamage = numberOf(line['minDamage']);
  const maxDamage = numberOf(line['maxDamage']);
  if (minDamage === undefined || maxDamage === undefined) {
    return { kind: 'range', power: { min: 0, max: 0 }, via: 'none' };
  }
  const lo = Math.min(minDamage, maxDamage);
  const hi = Math.max(minDamage, maxDamage);
  return { kind: 'range', power: { min: Math.max(0, -hi), max: Math.max(0, -lo) }, via: 'min-max' };
}
