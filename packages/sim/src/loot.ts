// Sorteio de loot (FUN-63, §31 da referência) — um estágio do pipeline de morte.
//
// Moeda é CAMPO no personagem (`character.gold`), não item, e a tabela de conteúdo diz isso
// com um lugar próprio para `gold`. Item de verdade precisa de definição, instância, capacidade
// e inventário, e nada disso existe: `items` fica vazio e o `buildContent` recusa qualquer coisa
// nele. A forma do dado já está certa; o que falta é o catálogo.

import type { LootRoll, LootTable } from '@draconya/content';
import type { Rng } from './rng.js';

/**
 * `MAX_LOOTCHANCE` do Canary (#685): a chance do arquivo é em cem-milésimos, e a #578 a guarda
 * como fração (`chance / 100000`) — `round(fração × 100000)` devolve o número original.
 */
export const CANARY_LOOT_CHANCE_SCALE = 100_000;

/**
 * O `config.factor` do `generateLootRoll` (prey de loot, wealth duplex, boosted creature, charm
 * Gut): 1 até esses sistemas existirem, cada um no seu épico. O `rateLoot` do servidor (#691) não é
 * o fator: ele divide a rolagem em `rollCanaryLine`.
 */
const LOOT_FACTOR = 1;

export interface LootItem {
  readonly itemId: string;
  readonly quantity: number;
}

/**
 * Um supply sorteado (#520): poção é suprimento ABSTRATO (AB-01), e não passa pela mochila —
 * `quantity` credita direto o estoque de quem recebe (`CharacterRuntime.supplyStock`), sem
 * peso, sem instância. Ver `lootTableSchema` em `@draconya/content`.
 */
export interface LootSupply {
  readonly supplyId: string;
  readonly quantity: number;
}

/**
 * Uma munição sorteada (#520): munição é ABSTRATA no TIRO (ADR 0026 d.7), como supply é no uso
 * — `quantity` credita direto o estoque de quem recebe (`CharacterRuntime.ammunitionStock`),
 * sem peso, sem instância. Ver `lootTableSchema` em `@draconya/content`.
 */
export interface LootAmmunition {
  readonly ammunitionId: string;
  readonly quantity: number;
}

export interface LootResult {
  readonly gold: number;
  readonly items: readonly LootItem[];
  readonly supplies: readonly LootSupply[];
  readonly ammunition: readonly LootAmmunition[];
}

const NO_ITEMS: readonly LootItem[] = [];
const NO_SUPPLIES: readonly LootSupply[] = [];
const NO_AMMUNITION: readonly LootAmmunition[] = [];
const EMPTY_LOOT: LootResult = { gold: 0, items: NO_ITEMS, supplies: NO_SUPPLIES, ammunition: NO_AMMUNITION };

/**
 * Sorteia a tabela com o `Rng` da SESSÃO, nunca `Math.random`: sem isso, uma sessão retomada
 * continua com outra sequência de loot, e nenhuma investigação de "por que não caiu" fica
 * possível.
 *
 * A ORDEM dos sorteios é contrato: mudar a ordem muda o resultado de toda semente já gravada,
 * e uma hunt retomada passaria a render diferente do que renderia. Gold primeiro, itens,
 * supplies e munição na ordem da tabela — cada linha consome UMA rolagem, declare ela `itemId`,
 * `supplyId` ou `ammunitionId`; separar os três resultados em listas diferentes DEPOIS de
 * sortear não muda a sequência nenhuma (FUN-63).
 */
export function rollLoot(table: LootTable, rng: Rng, lootRate = 1): LootResult {
  // `rateLoot <= 0` desliga o loot (#691, `monster.cpp:3431` do Canary): nada cai, e NENHUM
  // sorteio é consumido — o loot desligado não pode deslocar a sequência do resto da hunt. Vale
  // para os dois modelos: no Canary o `rateLoot` 0 nem chega ao `generateLootRoll`.
  if (lootRate <= 0) return EMPTY_LOOT;
  // O modelo é CAMPO da tabela (#685, invariante 7): ausente é o FUN-63, bit a bit; `canary` é
  // o `generateLootRoll` do Canary. A ordem (gold, depois itens na ordem da tabela) é a mesma
  // nos dois — o que muda é quantos sorteios cada linha consome, e onde o rate entra (na chance
  // no FUN-63, na rolagem no `canary`).
  const roll = table.rollModel === 'canary' ? rollCanaryLine : rollLine;
  const gold = table.gold === undefined ? 0 : roll(table.gold, rng, lootRate);
  let items: LootItem[] | null = null;
  let supplies: LootSupply[] | null = null;
  let ammunition: LootAmmunition[] | null = null;
  for (const line of table.items) {
    const quantity = roll(line, rng, lootRate);
    if (quantity === 0) continue;
    if (line.itemId !== undefined) {
      (items ??= []).push({ itemId: line.itemId, quantity });
    } else if (line.supplyId !== undefined) {
      (supplies ??= []).push({ supplyId: line.supplyId, quantity });
    } else if (line.ammunitionId !== undefined) {
      (ammunition ??= []).push({ ammunitionId: line.ammunitionId, quantity });
    }
  }
  return {
    gold, items: items ?? NO_ITEMS, supplies: supplies ?? NO_SUPPLIES,
    ammunition: ammunition ?? NO_AMMUNITION,
  };
}

/**
 * Uma linha: cai ou não, e quanto.
 *
 * `chance: 0` NÃO consome sorteio (DT-05): uma linha desabilitada não pode deslocar a
 * sequência das outras — semente é contrato. `min === max` também não consome o sorteio de
 * intervalo, pela mesma razão: quantidade fixa não tem o que sortear.
 */
function rollLine(line: LootRoll, rng: Rng, lootRate: number): number {
  if (line.chance <= 0) return 0;
  // O rate de loot (#691) multiplica a CHANCE, com teto 1 — o `getLootRandom` do Canary
  // (`random × 100 / max(1, rateLoot)`): um rate entre 0 e 1 age como 1. Com rate 1 a chamada
  // é exatamente a de sempre.
  const chance = lootRate === 1 ? line.chance : Math.min(1, line.chance * Math.max(1, lootRate));
  if (!rng.chance(chance)) return 0;
  return line.min === line.max ? line.min : rng.integer(line.min, line.max);
}

/**
 * Uma linha pelo `generateLootRoll` do Canary (#685, `monstertype.lua`). SEMPRE dois sorteios,
 * nesta ordem, mesmo com `chance: 0` — o fator e a rolagem —, porque é o que o Canary faz, e a
 * quantidade NÃO é um terceiro sorteio: sai da MESMA rolagem que decidiu o drop, então um drop
 * "apertado" (rolagem alta) tende a vir numa pilha diferente de um folgado. Consequência que
 * surpreende: uma linha "100 %" cai só ~98,6 % das vezes (fator abaixo de 1 e a rolagem inclui
 * o 100000).
 *
 * Linha não-empilhável chega aqui com `min = max = 1` (o `buildContent` recusa o resto), e a
 * conta devolve 1 — o mesmo que o ramo não-empilhável do Canary.
 */
function rollCanaryLine(line: LootRoll, rng: Rng, _lootRate: number): number {
  const chance = Math.round(line.chance * CANARY_LOOT_CHANCE_SCALE);
  // A ordem das operações é a do Canary: reassociar muda o último bit do double e, na fronteira,
  // o drop.
  const dynamicFactor = LOOT_FACTOR * (rng.integer(95, 105) / 100);
  const adjustedChance = chance * dynamicFactor;
  // `getLootRandom` com rateLoot 1: inteiro em [0, 100000], os DOIS extremos inclusos.
  // PONTO DE ENCAIXE do rate de loot (#691): no Canary o `rateLoot` divide a ROLAGEM
  // (`random × 100 / max(1, rateLoot × 100)`), não a chance — e a quantidade sai da rolagem já
  // dividida. Quando a #691 e esta se encontrarem, o rate entra aqui, sobre `randValue`, e não
  // pela chance como no `rollLine`.
  const randValue = rng.integer(0, CANARY_LOOT_CHANCE_SCALE);
  if (randValue >= adjustedChance) return 0;
  return (randValue % (line.max - line.min + 1)) + line.min;
}
