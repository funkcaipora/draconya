// A fala periódica do monstro (#620, `monster.voices` do Canary), em números.
//
// Puro, como `effects.ts`: é a conta de "quando este monstro fala e o quê". **O sorteio é do
// CLIENTE**, e isso é a regra da issue — nunca o `Rng` da sessão, nunca o servidor. A fala não
// muda resultado nenhum (invariante 3), então ninguém além da tela precisa saber dela, e sortear
// fora da sessão é o que garante que olhar ou não olhar não mexe na hunt. O teste injeta o
// `random`; em produção é `Math.random`, como em `net/backoff.ts`.
//
// O mecanismo é o de `Monster::onThinkYell` do Canary: um relógio por monstro que acumula até
// `intervalMs`, zera, e então rola `chance >= uniform_random(1, 100)`; passou, diz UMA linha
// sorteada por igual. Os NÚMEROS (intervalo, chance, linhas) vêm do conteúdo; o que é
// apresentação pura e nossa é quanto o balão fica na tela e a cor, abaixo.

import type { CreatureVoices } from '@draconya/protocol';
import { tibiaRgb } from './minimap.js';

/** Uma fala escolhida: o texto e se é grito (`TALKTYPE_MONSTER_YELL`). */
export interface Utterance {
  readonly text: string;
  readonly yell: boolean;
}

/** O relógio de UM monstro: o instante em que ele rola de novo. */
export interface SpeechState {
  nextAtMs: number;
}

/**
 * O relógio de um monstro recém-visto: a primeira rolagem é daqui a `intervalMs`, como o
 * `yellTicks` do Canary, que começa em zero.
 */
export function startSpeech(voices: CreatureVoices, nowMs: number): SpeechState {
  return { nextAtMs: nowMs + voices.intervalMs };
}

/**
 * Anda o relógio e, se venceu, rola. Devolve a fala, ou `null` (ainda não venceu, ou venceu e a
 * chance não passou).
 *
 * **Vencer zera a partir de AGORA**, e nunca soma o atraso: um quadro que chega depois de uma
 * aba em segundo plano (o laço de quadro para) rola UMA vez, e não uma vez por intervalo perdido
 * — o monstro não fala dez vezes seguidas ao voltar. É o `yellTicks = 0` do Canary.
 *
 * `random` devolve `[0, 1)`. A rolagem é `uniform(1, 100) <= chance`, e a linha é
 * `uniform(0, n - 1)` — as duas conferidas em `Monster::onThinkYell`.
 */
export function rollSpeech(
  voices: CreatureVoices, state: SpeechState, nowMs: number, random: () => number,
): Utterance | null {
  if (nowMs < state.nextAtMs) return null;
  state.nextAtMs = nowMs + voices.intervalMs;
  const roll = Math.floor(random() * 100) + 1;
  if (roll > voices.chance) return null;
  const index = Math.min(voices.lines.length - 1, Math.floor(random() * voices.lines.length));
  const line = voices.lines[index];
  return line === undefined ? null : { text: line.text, yell: line.yell === true };
}

/**
 * A cor da fala: o laranja do `TEXTCOLOR_ORANGE` (198) que o Canary usa para a fala de monstro,
 * lido da paleta de 216 cores do Tibia — a mesma do automapa e da luz.
 */
export const SPEECH_COLOR: number = (() => {
  const [r, g, b] = tibiaRgb(198);
  return (r << 16) | (g << 8) | b;
})();

/** O balão fica ao menos isto na tela — apresentação nossa, o Canary não tem um número. */
export const SPEECH_MIN_MS = 2500;
/** E mais isto por caractere, para a fala longa dar tempo de ler. */
export const SPEECH_MS_PER_CHARACTER = 50;

/** Quanto tempo a fala de `text` fica sobre o monstro. */
export function speechDurationMs(text: string): number {
  return SPEECH_MIN_MS + SPEECH_MS_PER_CHARACTER * text.length;
}
