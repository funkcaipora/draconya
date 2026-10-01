// A luz do próprio jogador (#623: Light, Great Light, Ultimate Light) e o tom do ambiente.
//
// É APRESENTAÇÃO e só isso: o `sim` guarda a condição e a vence, nenhuma regra de jogo lê luz. O
// bueiro (`ambience: 'cavern'`) é escuro; uma luz ativa CLAREIA o mundo em direção à cor dela —
// uma aproximação do que o Tibia faz (a luz abre um círculo em volta do jogador), suficiente para
// o jogador ver o efeito da magia sem uma camada de iluminação por tile. Na superfície não há
// escuridão a clarear, e a luz não muda nada, como no Tibia de dia.
//
// A conta do decaimento repete o `ConditionLight` do Canary: o raio cai 1 a cada
// `durationMs / level`, então o nível de agora é `ceil(level × restante / total)` — sem estado, só
// função do que o servidor mandou e do relógio local.

import { tibiaRgb } from './minimap.js';

/** O tom do bueiro: o mundo inteiro, sob uma luz fria. Era do `viewport`; mora aqui para o teste. */
export const CAVERN_TINT = 0x8e8eb0;

/** O maior nível de luz do catálogo (Great/Ultimate Light no Canary): 100 % da clareada. */
export const MAX_LIGHT_LEVEL = 8;

/** Quanto do caminho até a cor da luz o nível máximo percorre — o bueiro continua um bueiro. */
export const LIGHT_LIFT = 0.7;

/** A luz como o `active-conditions` a entregou, mais o instante local em que chegou. */
export interface SelfLight {
  readonly level: number;
  readonly color: number;
  readonly durationMs: number;
  /** O restante NO INSTANTE `receivedAtMs`, do servidor. */
  readonly remainingMs: number;
  /** `performance.now()` da chegada — o mesmo relógio do quadro. */
  readonly receivedAtMs: number;
}

/** O nível de luz de AGORA, de 0 (apagada) ao `level` da magia. */
export function lightLevelAt(light: SelfLight | null, nowMs: number): number {
  if (light === null) return 0;
  const remaining = Math.max(0, light.remainingMs - Math.max(0, nowMs - light.receivedAtMs));
  return Math.min(light.level, Math.ceil((light.level * remaining) / light.durationMs));
}

function mixChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

/** Mistura duas cores 0xRRGGBB: `t = 0` é `from`, `t = 1` é `to`. */
export function blendTint(from: number, to: number, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const r = mixChannel((from >> 16) & 0xff, (to >> 16) & 0xff, clamped);
  const g = mixChannel((from >> 8) & 0xff, (to >> 8) & 0xff, clamped);
  const b = mixChannel(from & 0xff, to & 0xff, clamped);
  return (r << 16) | (g << 8) | b;
}

/** O tom que o mundo leva em `nowMs`: o do ambiente, clareado pela luz do jogador se houver. */
export function ambientTint(
  ambience: 'surface' | 'cavern', light: SelfLight | null, nowMs: number,
): number {
  if (ambience !== 'cavern') return 0xffffff;
  const level = lightLevelAt(light, nowMs);
  if (level <= 0 || light === null) return CAVERN_TINT;
  const [r, g, b] = tibiaRgb(light.color);
  // Índice fora da paleta (ou o preto do 0) daria uma luz que ESCURECE: cai no branco.
  const target = r + g + b === 0 ? 0xffffff : (r << 16) | (g << 8) | b;
  return blendTint(CAVERN_TINT, target, Math.min(1, level / MAX_LIGHT_LEVEL) * LIGHT_LIFT);
}
