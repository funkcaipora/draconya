// Que andares a tela mostra (M23, D7). Puro: aritmética sobre a cena e as flags, extraída do
// viewport para ser travada sem Pixi — um sinal errado aqui é o telhado que não some quando o
// jogador entra em casa, e só apareceria olhando a tela.
//
// A regra é a do OTClient (`MapView::calcFirstVisibleFloor`, `calcLastVisibleFloor`,
// `Tile::limitsFloorsView`; MIT — lida em NÚMEROS, nada copiado; ADR 0019): na superfície
// tudo o que está acima é visível até encontrar COBERTURA; no subsolo vê-se dois andares para
// cada lado. Cobertura é um tile no andar de cima — fisicamente sobre o jogador ou sobre a
// posição de TELA dele, que com a perspectiva de um tile por andar é o `(x+1, y+1)` de cima —
// cuja "primeira coisa" é chão ou parede, e que não foi marcado `dont_hide`.

import type { AppearanceFlags } from '../assets/appearances.js';
import type { Point } from '../state/world.js';
import { SURFACE_FLOOR } from './floors.js';
import type { TileStack } from './scene.js';

export const SEA_FLOOR = SURFACE_FLOOR;
export const UNDERGROUND_FLOOR = 8;
/** Quantos andares para cada lado se vê no subsolo. */
export const AWARE_UNDERGROUND_FLOOR_RANGE = 2;
export const MAX_Z = 15;
/** A rampa de alpha de um andar que acaba de ser coberto ou descoberto. */
export const FLOOR_FADE_MS = 250;

export interface FloorView { tileAt(x: number, y: number, z: number): TileStack | null; }
export interface VisibilityInfo { flagsOf(appearanceId: number): AppearanceFlags; }

/** Há tile, e nada nele bloqueia a vista (`unsight`) — a janela e a porta aberta deixam ver. */
export function lookPossible(stack: TileStack | null, info: VisibilityInfo): boolean {
  if (stack === null) return false;
  if (stack.ground > 0 && info.flagsOf(stack.ground).unsight) return false;
  for (const item of stack.items) if (info.flagsOf(item.id).unsight) return false;
  return true;
}

/**
 * A "primeira coisa" do tile na ordem de pilha do Tibia: o chão; sem chão, o item de menor
 * prioridade — `clip`, depois `bottom`, depois `top`, depois comum — e dentro de cada classe a
 * ordem do arquivo. É a mesma classificação de `tile-stack.ts`. `null` para o tile vazio.
 */
function firstThing(
  stack: TileStack, info: VisibilityInfo,
): { readonly flags: AppearanceFlags; readonly ground: boolean } | null {
  if (stack.ground > 0) return { flags: info.flagsOf(stack.ground), ground: true };
  const flagged = stack.items.map((item) => info.flagsOf(item.id));
  const flags = flagged.find((f) => f.clip)
    ?? flagged.find((f) => !f.clip && f.bottom)
    ?? flagged.find((f) => !f.clip && !f.bottom && f.top)
    ?? flagged[0];
  return flags === undefined ? null : { flags, ground: false };
}

/**
 * O tile limita a vista dos andares acima dele? Chão sempre; `bottom` (parede, porta fechada)
 * com vista livre sempre, sem vista livre só se também bloqueia o tiro (`unsight`) — a cerca
 * baixa não esconde o andar de cima. `dontHide` nunca limita: é a flag para o que fica no
 * andar de cima sem ser teto.
 */
export function limitsFloorsView(stack: TileStack, freeView: boolean, info: VisibilityInfo): boolean {
  const first = firstThing(stack, info);
  if (first === null || first.flags.dontHide) return false;
  if (first.ground) return true;
  if (!first.flags.bottom) return false;
  return freeView || first.flags.unsight;
}

/**
 * O andar mais alto a desenhar para quem está em `player`.
 *
 * Superfície começa em 0 (tudo acima visível); subsolo em `max(z − 2, 8)`. Nos 3×3 em volta do
 * jogador — o centro sempre, os ortogonais só com vista livre, a diagonal nunca — sobe andar a
 * andar enquanto `uz ≥ first`: o tile FISICAMENTE acima `(x, y, uz)` limita com `!freeView`, o
 * GEOMETRICAMENTE acima `(x + lift, y + lift, uz)` limita com `freeView`; o primeiro que limita
 * põe `first = uz + 1` e encerra aquele tile. `lift` é `z − uz`: cada andar de cima é desenhado
 * um tile para cima e para a esquerda, então o que cobre a posição de TELA do jogador está um
 * tile para baixo e para a direita por nível.
 */
export function firstVisibleFloor(scene: FloorView, player: Point, info: VisibilityInfo): number {
  let first = player.z > SEA_FLOOR
    ? Math.max(player.z - AWARE_UNDERGROUND_FLOOR_RANGE, UNDERGROUND_FLOOR)
    : 0;
  for (let ix = -1; ix <= 1 && first < player.z; ix++) {
    for (let iy = -1; iy <= 1 && first < player.z; iy++) {
      const x = player.x + ix;
      const y = player.y + iy;
      const centre = ix === 0 && iy === 0;
      const orthogonal = Math.abs(ix) !== Math.abs(iy);
      const freeView = lookPossible(scene.tileAt(x, y, player.z), info);
      if (!centre && !(orthogonal && freeView)) continue;
      for (let uz = player.z - 1; uz >= first; uz--) {
        const lift = player.z - uz;
        const physically = scene.tileAt(x, y, uz);
        if (physically !== null && limitsFloorsView(physically, !freeView, info)) { first = uz + 1; break; }
        const geometrically = scene.tileAt(x + lift, y + lift, uz);
        if (geometrically !== null && limitsFloorsView(geometrically, freeView, info)) { first = uz + 1; break; }
      }
    }
  }
  return Math.min(MAX_Z, Math.max(0, first));
}

/** O andar mais fundo a desenhar: a superfície vê até o 7; o subsolo, dois abaixo do jogador. */
export function lastVisibleFloor(playerZ: number): number {
  const last = playerZ > SEA_FLOOR ? playerZ + AWARE_UNDERGROUND_FLOOR_RANGE : SEA_FLOOR;
  return Math.min(MAX_Z, Math.max(0, last));
}

/**
 * Os andares da cena em `[first, last]`, do mais fundo ao mais alto — a ordem de pintura, o de
 * baixo primeiro. A diferença para a regra antiga é que `first` pode estar ACIMA do jogador, e
 * aí o andar de cima entra, deslocado e sem véu.
 */
export function visibleFloors(sceneFloors: readonly number[], first: number, last: number): number[] {
  return sceneFloors.filter((z) => z >= first && z <= last).sort((a, b) => b - a);
}

/** A troca de `first` em curso: de `previous` para `first`, começada em `since` (relógio do quadro). */
export interface FloorFade {
  readonly first: number;
  readonly previous: number;
  readonly since: number;
}

/**
 * O alpha de um andar: 1 visível, 0 escondido. Entre `previous` e `first` — os andares que a
 * troca cobriu ou descobriu — a rampa linear de `FLOOR_FADE_MS` a partir de `since`; fora dela,
 * o valor final. `last` não entra: andar além dele não está na lista e não é consultado.
 */
export function floorAlpha(z: number, fade: FloorFade, nowMs: number): number {
  const shown = z >= fade.first;
  const wasShown = z >= fade.previous;
  if (shown === wasShown) return shown ? 1 : 0;
  const t = Math.min(1, Math.max(0, (nowMs - fade.since) / FLOOR_FADE_MS));
  return shown ? t : 1 - t;
}

/**
 * (nome desta spec) O `first` a PINTAR: enquanto a rampa corre, o andar que está sumindo ainda
 * é desenhado — com `visibleFloors(first, …)` ele sairia da lista no primeiro quadro e o fade
 * não teria o que esmaecer. Fora da rampa é `first`.
 */
export function paintedFirstFloor(fade: FloorFade, nowMs: number): number {
  if (nowMs - fade.since >= FLOOR_FADE_MS) return fade.first;
  return Math.min(fade.first, fade.previous);
}