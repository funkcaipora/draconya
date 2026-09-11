// Para onde a criatura olha, e em que quadro do passo ela está (FUN-23).
//
// Não existe campo de direção em lugar nenhum — nem no protocolo, nem no `Creature` — e ele
// não precisa existir: o passo já diz de onde para onde. `apply.ts` grava o passo e nunca o
// devolve a `null`, então o ÚLTIMO passo dá o facing indefinidamente, inclusive parada. É o
// que faz um personagem que andou para o norte continuar olhando para o norte.
//
// Puro de propósito, como `camera.ts`: é aritmética, e o teste dela não precisa de canvas.

import type { Direction } from '../assets/pack.js';
import type { Creature } from '../state/world.js';

/** Sem passo nenhum — recém-chegada, ou reanexada — a criatura olha para o sul, como no Tibia. */
export const DEFAULT_FACING: Direction = 'south';

/**
 * A direção do último passo.
 *
 * Diagonal escolhe o eixo horizontal: no Tibia a criatura andando em diagonal mostra o lado,
 * não as costas. Empurrão (`pushed`) NÃO vira a criatura — ser empurrado não é andar.
 */
export function facingOf(creature: Pick<Creature, 'step'>): Direction {
  const step = creature.step;
  if (step === null || step.pushed) return DEFAULT_FACING;
  const dx = step.to.x - step.from.x;
  const dy = step.to.y - step.from.y;
  if (dx === 0 && dy === 0) return DEFAULT_FACING;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'east' : 'west';
  return dy > 0 ? 'south' : 'north';
}

export interface WalkFrame {
  /** Ainda dentro da duração do passo. `step !== null` NÃO basta: o passo vencido fica no objeto. */
  readonly moving: boolean;
  /** Qual das `frames` fases desenhar. `0` parada. */
  readonly phase: number;
}

/**
 * Em que fase da caminhada a criatura está AGORA.
 *
 * **Amarrada ao progresso do passo, não ao relógio de parede.** O grupo andando do rato tem
 * oito fases de 300 ms — 2,4 s de ciclo — contra um passo de ~400 ms. Por relógio, as patas
 * mal se mexeriam num passo inteiro; por progresso, um passo mostra o ciclo todo, que é o
 * que "andar" parece.
 */
export function walkFrame(
  creature: Pick<Creature, 'step'>, nowMs: number, frames: number,
): WalkFrame {
  const step = creature.step;
  if (step === null || step.durationMs <= 0) return { moving: false, phase: 0 };
  const elapsed = nowMs - step.startedAtMs;
  if (elapsed < 0 || elapsed >= step.durationMs) return { moving: false, phase: 0 };
  const total = Math.max(1, Math.floor(frames));
  // `min` no último: no instante exato do fim `t` seria 1 e `floor(1 * total)` cairia FORA.
  const phase = Math.min(total - 1, Math.floor((elapsed / step.durationMs) * total));
  return { moving: true, phase };
}
