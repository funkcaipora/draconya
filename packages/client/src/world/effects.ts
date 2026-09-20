// Efeito, projétil e número flutuante, em números (FUN-106).
//
// Puro, como `camera.ts` e `health.ts`: é a aritmética de "em que fase este efeito está", "onde
// o projétil está agora" e "quanto o número já subiu". O Pixi só desenha o que sai daqui, e o
// teste disto não precisa de canvas — que é onde mora o defeito silencioso: um `<=` no lugar
// de `<` faz o último quadro de um efeito nunca ser desenhado, e ninguém nota numa animação de
// 300 ms.
//
// Os NÚMEROS vêm da referência (OTClient v8, ADR 0019) desde a #479: a velocidade do projétil
// é `150 * sqrt(dx² + dy²)`, o texto sobe 48 px com fade no último sexto e a cor sai do
// elemento do golpe. Continuam ajustáveis aqui num lugar só, e continuam sendo apresentação —
// o `sim` não sabe de cor nem de px.

import type { FloatingText, HitKind, Point } from '../state/world.js';

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

/** O projétil leva isto por tile de distância EUCLIDIANA — a fórmula do OTClient v8. */
export const MISSILE_MS_PER_TILE = 150;
/** Piso: um projétil disparado no próprio tile não pode ter duração zero. */
export const MISSILE_MIN_MS = 50;

/**
 * Quanto tempo um projétil leva de `from` a `to`.
 *
 * A distância é a EUCLIDIANA — `sqrt(dx² + dy²)` —, e não a de Chebyshev: é a conta do
 * `Missile::setPath` do OTClient v8, e é o que faz a diagonal voar mais devagar na razão
 * correta em vez de custar os mesmos 150 ms por tile de qualquer eixo. O piso existe para a
 * distância zero: sem ele, `Math.round(0)` daria um projétil já chegado, que nunca desenha o
 * primeiro quadro.
 */
export function missileDuration(from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.max(MISSILE_MIN_MS, Math.round(MISSILE_MS_PER_TILE * Math.sqrt(dx * dx + dy * dy)));
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
/** Sobe 48 px na vida inteira — o `AnimatedText` do OTClient v8. */
export const FLOATING_TEXT_RISE_PX = 48;
/** A partir de que fração da vida o alfa começa a cair — o último SEXTO. */
const FLOATING_TEXT_FADE_FROM = 5 / 6;

/**
 * Quanto o número já subiu e quão visível está, ou `null` quando acabou.
 *
 * `dy` é INTEIRO: o texto é uma textura rasterizada, e posição fracionária o borra — é o
 * `roundPixels` de sempre, feito na conta em vez de no Pixi. A subida inteira é
 * `FLOATING_TEXT_RISE_PX` (48 px, o `AnimatedText` do OTClient), distribuída ao longo da vida;
 * o alfa fica cheio por cinco sextos e cai linear no último. Sumir de repente parece o número
 * ter sido apagado, e desvanecer desde o início deixa o dano ilegível antes de o jogador ler.
 */
export function floatingTextOffset(elapsedMs: number): { dy: number; alpha: number } | null {
  if (elapsedMs >= FLOATING_TEXT_LIFETIME_MS) return null;
  const elapsed = Math.max(0, elapsedMs);
  const dy = Math.round((elapsed / FLOATING_TEXT_LIFETIME_MS) * FLOATING_TEXT_RISE_PX);
  const fadeFromMs = FLOATING_TEXT_LIFETIME_MS * FLOATING_TEXT_FADE_FROM;
  const alpha = elapsed <= fadeFromMs
    ? 1
    : 1 - (elapsed - fadeFromMs) / (FLOATING_TEXT_LIFETIME_MS - fadeFromMs);
  return { dy, alpha };
}

/**
 * A cor de um número por TIPO DE GOLPE, quando o servidor não mandou o elemento.
 *
 * São DADOS do Tibia, que o jogador do gênero já lê sem pensar: vermelho é golpe físico, o
 * roxo elétrico é magia (a cor da energia), verde é cura.
 */
const FLOATING_TEXT_COLORS: Readonly<Record<HitKind, number>> = {
  melee: 0xff0000,
  spell: 0xcc33ff,
  heal: 0x00ff00,
};

/**
 * A cor de cada TIPO DE DANO (RF-02, #479). É a paleta do cliente de referência: gelo azul
 * claro, fogo laranja, energia roxa, terra verde, sagrado amarelo, morte cinza, físico
 * vermelho, cura verde. `arcane` cai no roxo da magia — é o tipo "mágico" do v1.
 */
export const ELEMENT_COLORS: Readonly<Record<string, number>> = {
  physical: 0xff0000,
  ice: 0x66ccff,
  fire: 0xff6600,
  energy: 0xcc33ff,
  earth: 0x00cc00,
  holy: 0xffff00,
  death: 0xcccccc,
  arcane: 0xcc33ff,
  heal: 0x00ff00,
};

/** A cor de um tipo de dano; um tipo desconhecido cai no roxo de magia, nunca em preto. */
export function elementColor(type: string): number {
  return ELEMENT_COLORS[type] ?? FLOATING_TEXT_COLORS.spell;
}

/**
 * A cor do número: o ELEMENTO quando o servidor o mandou, senão o `kind` (RF-02). A ausência é
 * a degradação para um nó `game` anterior — a mesma leitura de antes da #479.
 */
export function floatingTextColor(kind: HitKind, damageType?: string): number {
  return damageType === undefined ? FLOATING_TEXT_COLORS[kind] : elementColor(damageType);
}

/**
 * Dois números no MESMO tile dentro desta janela somam num só, em vez de um borrão sobreposto
 * (RF-05). 200 ms é o "mesmo instante" do combate: uma área que bate em quem já estava sendo
 * batido, ou um golpe e o tique de um DOT que vencem juntos.
 */
export const FLOATING_TEXT_MERGE_WINDOW_MS = 200;

/**
 * Soma um número a um texto que já está na tela (RF-05). É MUTAÇÃO de propósito: o viewport
 * reusa o mesmo sprite, e trocar o objeto por um novo faria o pool perder a chave no meio do
 * voo. Quem decide SE pode fundir (mesmo tile, mesma cor, dentro da janela) é `addFloatingText`,
 * que tem a lista e o relógio.
 */
export function mergeFloatingText(existing: FloatingText, amount: number): void {
  existing.amount += amount;
}
