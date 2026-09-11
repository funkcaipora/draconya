// Efeito, projétil e número flutuante, em números (FUN-106).
//
// Puro, como `camera.ts` e `health.ts`: é a aritmética de "em que fase este efeito está", "onde
// o projétil está agora" e "quanto o número já subiu". O Pixi só desenha o que sai daqui, e o
// teste disto não precisa de canvas — que é onde mora o defeito silencioso: um `<=` no lugar
// de `<` faz o último quadro de um efeito nunca ser desenhado, e ninguém nota numa animação de
// 300 ms.
//
// Os NÚMEROS são de referência, e não medidos contra o cliente do Tibia: a velocidade do
// projétil, a subida do texto e as cores são o ponto de partida para um `[ABERTO]`, ajustáveis
// aqui num lugar só.

import type { HitKind, Point } from '../state/world.js';

/**
 * Qual fase de um efeito está tocando em `elapsedMs`, ou `null` quando ele acabou.
 *
 * `phases` é a duração de cada fase, em ms, na ordem em que tocam — é o que
 * `AssetPack.effectPhases` devolve. Fases vazias é efeito que não toca nada: `null` já em zero,
 * e o viewport o descarta sem desenhar um quadro. Tempo negativo — o mesmo relógio, então só
 * por lote aplicado fora de ordem — é a fase 0, não um erro.
 */
export function effectPhaseAt(phases: readonly number[], elapsedMs: number): number | null {
  let end = 0;
  for (let phase = 0; phase < phases.length; phase++) {
    end += phases[phase] ?? 0;
    if (elapsedMs < end) return phase;
  }
  return null;
}

/**
 * Sem pacote de arte, ou com um id que o pacote não tem, o efeito ainda toca — por este tempo,
 * como um retângulo. É a mesma degradação da criatura sem quadro, e existe pela mesma razão:
 * o modo sem arte é o que CI e o cliente de carga rodam, e um efeito que não aparece nele é
 * indistinguível de um efeito que não chegou.
 */
export const FALLBACK_EFFECT_PHASES: readonly number[] = [300];

/** O projétil leva isto para sair do tile de origem, mais `MISSILE_PER_TILE_MS` por tile. */
export const MISSILE_BASE_MS = 100;
export const MISSILE_PER_TILE_MS = 60;

/**
 * Quanto tempo um projétil leva de `from` a `to`.
 *
 * A distância é a de CHEBYSHEV — o maior dos dois eixos —, que é a distância do Tibia: a
 * diagonal é um passo, não dois. Por Manhattan o projétil em diagonal voaria mais devagar que
 * o em linha reta para um alvo à mesma distância de tiro.
 */
export function missileDuration(from: Point, to: Point): number {
  const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return MISSILE_BASE_MS + MISSILE_PER_TILE_MS * distance;
}

/**
 * Onde o projétil está no trajeto, de 0 (saiu) a 1 (chegou), ou `null` quando já chegou.
 *
 * Presa em zero antes de começar, pela mesma razão do `interpolate` das criaturas: o lote
 * aplicado pode carimbar um instante que o quadro ainda não alcançou. Duração zero é
 * "chegou" — dividir por ela daria `NaN`, que posicionaria o sprite em lugar nenhum.
 */
export function missileProgress(
  startedAtMs: number, durationMs: number, nowMs: number,
): number | null {
  if (durationMs <= 0) return null;
  const elapsed = nowMs - startedAtMs;
  if (elapsed >= durationMs) return null;
  if (elapsed <= 0) return 0;
  return elapsed / durationMs;
}

/** O número vive isto, e some. */
export const FLOATING_TEXT_LIFETIME_MS = 1000;
/** Sobe um pixel a cada tantos ms: ~33 px na vida inteira. */
export const FLOATING_TEXT_RISE_MS_PER_PX = 30;
/** A partir de que fração da vida o alfa começa a cair — o último terço. */
const FLOATING_TEXT_FADE_FROM = 2 / 3;

/**
 * Quanto o número já subiu e quão visível está, ou `null` quando acabou.
 *
 * `dy` é INTEIRO: o texto é uma textura rasterizada, e posição fracionária o borra — é o
 * `roundPixels` de sempre, feito na conta em vez de no Pixi. O alfa fica cheio por dois
 * terços e cai linear no último: sumir de repente parece o número ter sido apagado, e
 * desvanecer desde o início deixa o dano ilegível antes de o jogador ler.
 */
export function floatingTextOffset(elapsedMs: number): { dy: number; alpha: number } | null {
  if (elapsedMs >= FLOATING_TEXT_LIFETIME_MS) return null;
  const elapsed = Math.max(0, elapsedMs);
  const dy = Math.floor(elapsed / FLOATING_TEXT_RISE_MS_PER_PX);
  const fadeFromMs = FLOATING_TEXT_LIFETIME_MS * FLOATING_TEXT_FADE_FROM;
  const alpha = elapsed <= fadeFromMs
    ? 1
    : 1 - (elapsed - fadeFromMs) / (FLOATING_TEXT_LIFETIME_MS - fadeFromMs);
  return { dy, alpha };
}

/**
 * A cor do número por tipo de golpe. São DADOS do Tibia, que o jogador do gênero já lê sem
 * pensar: vermelho é golpe físico, o roxo elétrico é magia (a cor da energia), verde é cura.
 */
const FLOATING_TEXT_COLORS: Readonly<Record<HitKind, number>> = {
  melee: 0xff0000,
  spell: 0xcc33ff,
  heal: 0x00ff00,
};

export function floatingTextColor(kind: HitKind): number {
  return FLOATING_TEXT_COLORS[kind];
}
