// Eventos de domínio de COMBATE: um golpe caiu, uma cura repôs, uma magia saiu, um supply foi
// usado (FUN-109).
//
// Irmãos dos eventos de presença (`presence.ts`) e do passo (`movement.ts`), pela mesma razão
// de existir: o `sim` produz o acontecimento haja ou não alguém olhando (invariante 3), e quem
// o transforma em bytes é o hospedeiro. Antes destes quatro, a vida do PERSONAGEM só chegava ao
// cliente no `session-state` da reanexação: a barra dele ficava parada a hunt inteira enquanto
// a do monstro andava, e o jogador que olhava não sabia se estava apanhando.
//
// **O que a apresentação precisa, e nada de mecânica.** Nenhum destes eventos carrega dano
// resolvido, armadura, esquiva ou custo: `amount` é o que SAIU (ou ENTROU) na barra, porque é
// isso que o número flutuante mostra. O resolvido é assunto do extrato (`bestBasicHit`), e
// juntar os dois no mesmo evento faria o cliente escolher qual mostrar — e escolher errado.
//
// `position` viaja em todos, e é decisão: o efeito é desenhado no TILE, não na criatura. Uma
// criatura que já sumiu da tela (morreu no mesmo golpe) ainda precisa do número caindo onde
// ela estava, e o cliente não guarda posição de quem acabou de descartar.

import type { WorldPoint } from './movement.js';

/**
 * Alguém levou dano. `amount` é o APLICADO — `min(dano, vida)` —, o que a barra perdeu.
 *
 * O golpe sai ANTES do `creature-health-changed` correspondente, e a ordem é contrato: o
 * número flutuante acompanha a barra caindo, não o contrário.
 */
export interface CreatureHit {
  readonly kind: 'creature-hit';
  readonly creatureId: string | number;
  readonly attackerId: string | number;
  readonly amount: number;
  readonly source: 'melee' | 'spell';
  readonly position: WorldPoint;
}

/**
 * Alguém REPÔS vida. `amount` é o que repôs, não o que o efeito prometia: curar 80 em quem
 * estava a 10 do máximo é uma cura de 10, e é "+10" que o jogador precisa ver.
 *
 * Não sai para a regeneração passiva: um "+1" por segundo sobre o personagem a hunt inteira é
 * ruído. A barra anda mesmo assim, por `creature-health-changed`.
 */
export interface CreatureHealed {
  readonly kind: 'creature-healed';
  readonly creatureId: string | number;
  readonly amount: number;
  readonly source: 'spell' | 'supply';
  readonly position: WorldPoint;
}

/** Um alvo de magia como o cliente o enxerga: quem, e onde desenhar o efeito. */
export interface SpellCastTarget {
  readonly creatureId: string | number;
  readonly position: WorldPoint;
}

/**
 * A magia SAIU — uma vez por lançamento, ANTES dos golpes dela.
 *
 * `targets` é a mira inteira, na ordem em que os golpes vão cair; vazio para magia de cura, que
 * não mira ninguém. O dano de cada alvo vem em `creature-hit` separados, porque cada alvo leva
 * o seu — e o cliente desenha o efeito do lançamento uma vez e os números uma vez por alvo.
 */
export interface SpellCast {
  readonly kind: 'spell-cast';
  readonly casterId: string | number;
  readonly spellId: string;
  readonly casterPosition: WorldPoint;
  readonly targets: ReadonlyArray<SpellCastTarget>;
  /**
   * Os tiles da forma (#155), para o efeito aparecer onde não há monstro — a onda é visível
   * inteira, como no Tibia. Vazio em alvo único e em cura.
   */
  readonly tiles: readonly WorldPoint[];
}

/**
 * Um supply foi usado. O que ele repôs, se repôs, vem em `creature-healed`; uma poção de mana
 * produz só este evento — a barra de mana é assunto de outra issue.
 */
export interface SupplyUsed {
  readonly kind: 'supply-used';
  readonly characterId: string | number;
  readonly supplyId: string;
  readonly position: WorldPoint;
}

/**
 * Um TIRO saiu (#152): flecha do bow, ou o disparo da wand e do rod — uma vez por golpe,
 * ANTES do `creature-hit` dele. O `sim` diz qual arma e qual munição; o projétil a desenhar é
 * da tabela de aparências, resolvido pelo hospedeiro (invariante 6). `ammoId` só no tiro com
 * munição; a wand dispara sem.
 */
export interface Shot {
  readonly kind: 'shot';
  readonly attackerId: string | number;
  readonly targetId: string | number;
  readonly weaponItemId: string;
  readonly ammoId?: string;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
}

export type CombatEvent = CreatureHit | CreatureHealed | SpellCast | SupplyUsed | Shot;
