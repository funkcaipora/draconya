// A tela de serviço "Magias" da Cidade (#624, ADR 0058 d.2, ADR 0042): a lista do que o
// personagem pode aprender, com preço e o motivo de cada bloqueio. PURO, sem estado.
//
// O cliente não decide nada (invariante 4): a regra de verdade — vocação, level, "já aprendida",
// preço e saldo — é conferida pelo servidor em `learn-spell`. Esta função só espelha essa regra
// para a tela não oferecer o que o servidor vai recusar, e o servidor continua sendo quem decide:
// se as duas divergirem, a tela mostra o botão por um instante e a compra é recusada com o motivo
// — nunca o contrário. É a mesma razão de `blessing-cost.ts`.

import type { SpellDefinition } from '../state/hud.js';

/**
 * Em que pé está cada magia para ESTE personagem:
 * - `learned`: já aprendida — nada a fazer;
 * - `buyable`: o servidor aceitaria agora (level, vocação e saldo batem);
 * - `no-gold`: bate tudo, menos o saldo;
 * - `level`: falta level;
 * - `not-for-sale`: ninguém a ensina (`learnPrice` ausente — só a Wheel of Destiny concede).
 */
export type SpellShopStatus = 'learned' | 'buyable' | 'no-gold' | 'level' | 'not-for-sale';

export interface SpellShopRow {
  readonly id: string;
  readonly name: string;
  readonly minLevel: number;
  readonly manaCost: number;
  /** Ausente é "ninguém a ensina". `0` é magia grátis, e por isso é `undefined`, nunca truthy. */
  readonly price: number | undefined;
  readonly status: SpellShopStatus;
}

export interface SpellShopContext {
  /** A vocação do personagem, ou `null` enquanto não escolheu (§7.4). */
  readonly vocationId: string | null;
  readonly level: number;
  readonly gold: number;
  /** O registro de `learned-spells`; `null` é "o servidor ainda não disse", e nada aparece como aprendido. */
  readonly learned: readonly string[] | null;
}

function statusOf(spell: SpellDefinition, context: SpellShopContext, learned: ReadonlySet<string>): SpellShopStatus {
  if (learned.has(spell.id)) return 'learned';
  if (spell.learnPrice === undefined) return 'not-for-sale';
  if (context.level < spell.minLevel) return 'level';
  if (context.gold < spell.learnPrice) return 'no-gold';
  return 'buyable';
}

/**
 * As magias da vocação do personagem (e as sem vocação, como Cure Poison), em ordem de level e
 * depois de nome — a ordem em que o jogador as alcança. Quem ainda não escolheu vocação vê só as
 * que não exigem uma: o servidor recusaria o resto (`wrong-vocation`).
 */
export function spellShopRows(spells: readonly SpellDefinition[], context: SpellShopContext): SpellShopRow[] {
  const learned: ReadonlySet<string> = new Set(context.learned ?? []);
  return spells
    .filter((spell) => spell.vocationId === null || spell.vocationId === context.vocationId)
    .map((spell): SpellShopRow => ({
      id: spell.id,
      name: spell.name,
      minLevel: spell.minLevel,
      manaCost: spell.manaCost,
      price: spell.learnPrice,
      status: statusOf(spell, context, learned),
    }))
    .sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name));
}

/** O texto do botão/rótulo de estado de uma linha. */
export function spellShopLabel(row: SpellShopRow): string {
  switch (row.status) {
    case 'learned': return 'Aprendida';
    case 'not-for-sale': return 'Indisponível';
    case 'level': return 'Level ' + String(row.minLevel);
    case 'buyable':
    case 'no-gold':
      return row.price === 0 ? 'Grátis' : String(row.price ?? 0) + ' gold';
  }
}

/**
 * A magia do slot está aprendida? `true` quando a tela ainda não sabe (`learned === null`):
 * "ainda não sei" nunca vira "não aprendeu" — o slot só é marcado com o registro na mão.
 */
export function isSpellLearned(spellId: string, learned: readonly string[] | null): boolean {
  return learned === null || learned.includes(spellId);
}
