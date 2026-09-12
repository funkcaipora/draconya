// Eventos de domínio de PRESENÇA: uma criatura nasceu, sumiu ou mudou de vida (FUN-103).
//
// Irmãos de `CreatureMoved` (`movement.ts`), e pela mesma razão de existir: o `sim` produz o
// acontecimento haja ou não alguém olhando (§12 da referência OpenTibia), e quem o transforma
// em bytes é o hospedeiro. Antes destes três, o único evento era o passo — e o efeito era um
// monstro cujo passo atravessava o fio com um id que ninguém tinha anunciado. O cliente
// descartava em silêncio, e a hunt parecia vazia.
//
// **Só o que a apresentação precisa, e nada de mecânica.** Nome e aparência NÃO estão aqui: o
// `sim` não conhece nome nem arte (FUN-58, invariante 6). O hospedeiro resolve os dois pelo
// `monsterId`, no catálogo de conteúdo fixado na sessão (invariante 7).

import type { WorldPoint } from './movement.js';

export interface CreatureAppeared {
  readonly kind: 'creature-appeared';
  readonly creatureId: string | number;
  /** Qual definição de conteúdo. É por ele que o hospedeiro acha nome e `outfitId`. */
  readonly monsterId: string;
  readonly position: WorldPoint;
  readonly health: number;
  readonly maxHealth: number;
}

export interface CreatureVanished {
  readonly kind: 'creature-vanished';
  readonly creatureId: string | number;
}

/**
 * A vida mudou. Vai UMA vez por golpe, nunca por tick — é evento, como o passo (ADR 0001).
 *
 * `maxHealth` viaja junto porque o runtime do monstro não o guarda (vem da definição), e
 * mandar só `health` obrigaria o hospedeiro a procurar a definição a cada golpe.
 *
 * Desde a FUN-109 sai também para o PERSONAGEM (`creatureId` é o id dele), sempre que a vida
 * dele muda — por golpe, por cura, por regeneração. É o que faz a barra do jogador andar sem
 * reanexar. O `creature-hit` ou `creature-healed` que explica a mudança sai ANTES deste; a
 * regeneração passiva é a exceção e não explica nada, porque "+1" por segundo é ruído.
 */
export interface CreatureHealthChanged {
  readonly kind: 'creature-health-changed';
  readonly creatureId: string | number;
  readonly health: number;
  readonly maxHealth: number;
}

/**
 * Um item apareceu no chão (FUN-123): o cadáver de um monstro. O `sim` diz QUAL monstro morreu
 * e ONDE; a aparência é da tabela, resolvida pelo hospedeiro (invariante 6). Só visual — o
 * loot não passa por aqui.
 */
export interface GroundItemAppeared {
  readonly kind: 'ground-item-appeared';
  readonly itemId: number;
  readonly monsterId: string;
  readonly position: WorldPoint;
}

/** O item do chão sumiu — o cadáver apodreceu. */
export interface GroundItemVanished {
  readonly kind: 'ground-item-vanished';
  readonly itemId: number;
}

export type PresenceEvent =
  | CreatureAppeared | CreatureVanished | CreatureHealthChanged
  | GroundItemAppeared | GroundItemVanished;
