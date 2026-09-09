import type { Route } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { RouteWalker } from './walker.js';

/** Um quadrado de 4×4, laço fechado — a forma que o §14.4 exige. */
const square: Route = {
  id: 'square',
  mapId: 'm',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 1, z: 7 },
    { x: 3, y: 2, z: 7 }, { x: 3, y: 3, z: 7 },
    { x: 2, y: 3, z: 7 }, { x: 1, y: 3, z: 7 },
    { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [],
};
const STEP = 500;

describe('RouteWalker', () => {
  it('takes the first step immediately on entering', () => {
    // Os cooldowns começam PRONTOS (FUN-25): a primeira chamada já anda. Entrar numa hunt e
    // ficar meio segundo parado antes do primeiro passo seria um atraso sem explicação.
    const walker = new RouteWalker(square);
    expect(walker.advance(0, STEP)).toEqual(square.tiles[1]);
  });

  it('walks the whole loop and comes back to the start', () => {
    const walker = new RouteWalker(square);
    const visited: typeof square.tiles[number][] = [];
    // Um passo por chamada depois do primeiro, que sai de graça: `tiles.length` passos
    // fecham o laço.
    for (let i = 0; i < square.tiles.length - 1; i++) {
      const next = walker.advance(STEP, STEP);
      if (next !== null) visited.push(next);
    }
    expect(walker.index).toBe(0);
    expect(walker.current).toEqual(square.tiles[0]);
    // Passou por todos os tiles do laço, sem repetir nenhum.
    expect(new Set(visited.map((t) => `${t.x},${t.y}`)).size).toBe(square.tiles.length - 1);
  });

  it('resumes at the same index, not from the beginning', () => {
    // Reiniciar do começo faria o personagem refazer o trecho já limpo, e a hunt renderia
    // menos sem nenhuma razão visível para quem está olhando o extrato.
    const walker = new RouteWalker(square);
    walker.advance(STEP * 3, STEP);
    const stoppedAt = walker.index;
    expect(stoppedAt).toBe(4);

    walker.stop();
    expect(walker.advance(STEP * 10, STEP)).toBeNull();
    expect(walker.index).toBe(stoppedAt);

    walker.resume();
    walker.advance(STEP, STEP);
    expect(walker.index).toBe(stoppedAt + 1);
  });

  it('walks the same distance at 1 Hz and at 10 Hz', () => {
    // Invariante 2. É o que faz a hunt desanexada render igual.
    const fast = new RouteWalker(square);
    for (let i = 0; i < 100; i++) fast.advance(100, STEP);
    const slow = new RouteWalker(square);
    for (let i = 0; i < 10; i++) slow.advance(1_000, STEP);
    expect(fast.index).toBe(slow.index);
  });

  it('holds the SECOND step until the duration has elapsed, and keeps the remainder', () => {
    const walker = new RouteWalker(square);
    walker.advance(0, STEP);            // o primeiro sai de graça
    expect(walker.advance(100, STEP)).toBeNull();
    expect(walker.index).toBe(1);
    // O acumulado não some: 100 + 400 fecha o passo seguinte.
    expect(walker.advance(400, STEP)).toEqual(square.tiles[2]);
  });

  it('survives a snapshot and carries on from where it was', () => {
    // O índice entra no snapshot. Sem isso, cair o nó devolveria o personagem ao começo da
    // rota, e a retomada (FUN-28) renderia menos que a sessão que ela substitui.
    const walker = new RouteWalker(square);
    walker.advance(STEP * 4, STEP);
    walker.stop();
    const before = walker.index;

    const restored = new RouteWalker(square, walker.getState());
    expect(restored.index).toBe(before);
    expect(restored.stopped).toBe(true);
    restored.resume();
    restored.advance(STEP, STEP);
    expect(restored.index).toBe((before + 1) % square.tiles.length);
  });

  it('rejoins at the nearest tile after being pushed off the route', () => {
    // Empurrado, teleportado, o que for. Busca LINEAR na lista, não A*: reentrar pelo tile
    // mais próximo é o que evita o personagem refazer meia volta.
    const walker = new RouteWalker(square);
    walker.advance(STEP * 4, STEP);
    expect(walker.index).toBeGreaterThan(0);

    // Jogado para perto do começo do laço.
    expect(walker.rejoinNearest({ x: 1, y: 1, z: 7 })).toBe(0);
    expect(walker.current).toEqual(square.tiles[0]);
  });

  it('normalises an index that came from outside', () => {
    // Snapshot de uma rota que encolheu, ou índice corrompido: entrar em laço com índice
    // fora da lista seria `undefined` no meio do tick, longe da causa.
    expect(new RouteWalker(square, { index: 99, stopped: false, cooldowns: {} }).index)
      .toBe(99 % square.tiles.length);
    expect(new RouteWalker(square, { index: -1, stopped: false, cooldowns: {} }).index)
      .toBe(square.tiles.length - 1);
  });

  it('refuses a route with no tiles', () => {
    expect(() => new RouteWalker({ ...square, tiles: [] })).toThrow(/tiles/);
  });
});
