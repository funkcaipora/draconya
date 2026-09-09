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

describe('RouteWalker', () => {
  it('takes one tile per step', () => {
    // Quem sabe QUANDO o passo vence é o evento de passo (FUN-68); aqui só se anda.
    const walker = new RouteWalker(square);
    expect(walker.step()).toEqual(square.tiles[1]);
    expect(walker.step()).toEqual(square.tiles[2]);
  });

  it('walks the whole loop and comes back to the start', () => {
    const walker = new RouteWalker(square);
    const visited: typeof square.tiles[number][] = [];
    for (let i = 0; i < square.tiles.length; i++) {
      const next = walker.step();
      if (next !== null) visited.push(next);
    }
    expect(walker.index).toBe(0);
    expect(walker.current).toEqual(square.tiles[0]);
    // Passou por todos os tiles do laço, sem repetir nenhum.
    expect(new Set(visited.map((t) => `${t.x},${t.y}`)).size).toBe(square.tiles.length);
  });

  it('resumes at the same index, not from the beginning', () => {
    // Reiniciar do começo faria o personagem refazer o trecho já limpo, e a hunt renderia
    // menos sem nenhuma razão visível para quem está olhando o extrato.
    const walker = new RouteWalker(square);
    for (let i = 0; i < 4; i++) walker.step();
    const stoppedAt = walker.index;
    expect(stoppedAt).toBe(4);

    walker.stop();
    expect(walker.step()).toBeNull();
    expect(walker.step()).toBeNull();
    expect(walker.index).toBe(stoppedAt);

    walker.resume();
    walker.step();
    expect(walker.index).toBe(stoppedAt + 1);
  });

  it('never jumps more than one tile per step', () => {
    // A garantia que o 1,51× de dano sofrido custou (FUN-68). A versão anterior avançava
    // `índice + quantos passos coubessem no tick`, e num tick de 1 s o personagem atravessava
    // vários tiles de uma vez — passando por cima de onde os monstros estavam sem que a
    // adjacência fosse conferida em nenhum dos tiles do meio.
    const walker = new RouteWalker(square);
    for (let i = 0; i < 20; i++) {
      const before = walker.index;
      walker.step();
      const advanced = (walker.index - before + square.tiles.length) % square.tiles.length;
      expect(advanced).toBe(1);
    }
  });

  it('hold undoes the last step, so a blocked tile is retried and never skipped', () => {
    // FUN-69: o passo é decidido pelo walker e aplicado pelo sistema de movimento. Quando o
    // tile da rota está ocupado, o índice já avançou — e sem desfazer, o personagem pularia o
    // tile na volta seguinte. `hold` é o que faz "tentar de novo" ser de novo, e não adiante.
    const walker = new RouteWalker(square);
    walker.step();
    walker.step();
    expect(walker.index).toBe(2);
    walker.hold();
    expect(walker.index).toBe(1);
    expect(walker.step()).toEqual(square.tiles[2]);
    // E dá a volta no zero, como o laço da rota.
    const atStart = new RouteWalker(square);
    atStart.hold();
    expect(atStart.index).toBe(square.tiles.length - 1);
  });

  it('survives a snapshot and carries on from where it was', () => {
    // O índice entra no snapshot. Sem isso, cair o nó devolveria o personagem ao começo da
    // rota, e a retomada (FUN-28) renderia menos que a sessão que ela substitui.
    const walker = new RouteWalker(square);
    for (let i = 0; i < 4; i++) walker.step();
    walker.stop();
    const before = walker.index;

    const restored = new RouteWalker(square, walker.getState());
    expect(restored.index).toBe(before);
    expect(restored.stopped).toBe(true);
    restored.resume();
    restored.step();
    expect(restored.index).toBe((before + 1) % square.tiles.length);
  });

  it('carries no clock of its own into the snapshot', () => {
    // O acumulador de passo saiu do estado na FUN-68: quem guarda tempo é a fila da sessão,
    // e dois lugares guardando a mesma coisa é como um deles fica errado sem ninguém ver.
    const walker = new RouteWalker(square);
    walker.step();
    expect(Object.keys(walker.getState()).sort()).toEqual(['index', 'stopped']);
  });

  it('rejoins at the nearest tile after being pushed off the route', () => {
    // Empurrado, teleportado, o que for. Busca LINEAR na lista, não A*: reentrar pelo tile
    // mais próximo é o que evita o personagem refazer meia volta.
    const walker = new RouteWalker(square);
    for (let i = 0; i < 4; i++) walker.step();
    expect(walker.index).toBeGreaterThan(0);

    // Jogado para perto do começo do laço.
    expect(walker.rejoinNearest({ x: 1, y: 1, z: 7 })).toBe(0);
    expect(walker.current).toEqual(square.tiles[0]);
  });

  it('normalises an index that came from outside', () => {
    // Snapshot de uma rota que encolheu, ou índice corrompido: entrar em laço com índice
    // fora da lista seria `undefined` no meio do tick, longe da causa.
    expect(new RouteWalker(square, { index: 99, stopped: false }).index)
      .toBe(99 % square.tiles.length);
    expect(new RouteWalker(square, { index: -1, stopped: false }).index)
      .toBe(square.tiles.length - 1);
  });

  it('refuses a route with no tiles', () => {
    expect(() => new RouteWalker({ ...square, tiles: [] })).toThrow(/tiles/);
  });
});
