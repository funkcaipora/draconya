// A luz que o monstro carrega (#620, `monster.light` do Canary), em números.
//
// Puro, como `effects.ts`: o Pixi só desenha o que sai daqui. Só o CLIENTE a conhece — o servidor
// manda `level` e `color` no `creature-appear` e o `sim` nunca os lê (invariante 3: a luz não
// muda resultado nenhum).
//
// O Tibia escurece o ambiente e cada fonte de luz abre um círculo nele, com a cor dela. O viewport
// da hunt não escurece o andar (só tinge a caverna), então aqui a luz é um CLARÃO aditivo — um
// disco suave, da cor do Canary, com o alcance dele em tiles. É a mesma informação (quanto e de
// que cor), e é o que o jogador vê acender em volta do Fire Elemental.

import { TILE } from './camera.js';
import { tibiaRgb } from './minimap.js';

/**
 * Quantos anéis o clarão tem. O disco suave é uma pilha de círculos concêntricos de raios
 * crescentes, cada um com pouco alfa, em soma aditiva: o centro acumula todos e a borda só o
 * maior — o degradê sem precisar de textura.
 */
export const LIGHT_RINGS = 6;

/** O alfa de cada anel. No centro, `LIGHT_RINGS × LIGHT_RING_ALPHA` de cor somada. */
export const LIGHT_RING_ALPHA = 0.05;

/**
 * O teto do alcance, em tiles. Os monstros GERADOS da caça vão de 1 a 6, e o Canary tem um de 10
 * (o Lava Golem, fora do corte); o teto protege o desenho de um valor absurdo (o protocolo aceita
 * até 255), que cobriria a tela inteira, e deixa o de 10 caber.
 */
export const LIGHT_MAX_TILES = 12;

/** O raio do clarão em pixels de tile: `level` tiles, limitado por `LIGHT_MAX_TILES`. */
export function lightRadiusPx(level: number): number {
  return Math.min(Math.max(level, 0), LIGHT_MAX_TILES) * TILE;
}

/** A cor do clarão como `0xRRGGBB`, da paleta de 216 cores do Tibia (`c = r·36 + g·6 + b`). */
export function lightTint(color: number): number {
  const [r, g, b] = tibiaRgb(color);
  return (r << 16) | (g << 8) | b;
}

/**
 * Os círculos do clarão, do menor ao maior: `[raio em px, alfa]`. A chave do que está desenhado
 * é `level:color`, e o viewport só redesenha quando ela muda.
 */
export function lightRings(level: number): ReadonlyArray<readonly [radius: number, alpha: number]> {
  const radius = lightRadiusPx(level);
  const rings: Array<readonly [number, number]> = [];
  for (let ring = 1; ring <= LIGHT_RINGS; ring += 1) {
    rings.push([(radius * ring) / LIGHT_RINGS, LIGHT_RING_ALPHA]);
  }
  return rings;
}
