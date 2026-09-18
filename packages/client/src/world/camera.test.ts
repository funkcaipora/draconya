import { describe, expect, it } from 'vitest';
import {
  VIEW_HEIGHT, VIEW_WIDTH, cameraOrigin, compareDrawOrder, toScreen, viewFor, visibleTiles, zoomFor, TILE,
} from './camera.js';

const view = { widthTiles: 18, heightTiles: 14 };
const at = (x: number, y: number) => ({ x, y, z: 7 });

describe('camera', () => {
  it('centres the target on screen', () => {
    const screen = toScreen(at(10, 10), at(10, 10), view);
    expect(screen).toEqual({ x: ((18 - 1) / 2) * TILE, y: ((14 - 1) / 2) * TILE });
  });

  it('follows a fractional position instead of snapping to whole tiles', () => {
    // O alvo se move em posição fracionária durante a interpolação. Travar a câmera em tile
    // inteiro faria a tela andar aos solavancos enquanto o personagem desliza.
    const a = cameraOrigin(at(10, 10), view);
    const b = cameraOrigin({ x: 10.5, y: 10, z: 7 }, view);
    expect(b.x - a.x).toBeCloseTo(0.5);
  });

  it('keeps a margin of one tile so the entering column is already drawn', () => {
    const window = visibleTiles(at(10, 10), view);
    const origin = cameraOrigin(at(10, 10), view);
    expect(window.minX).toBeLessThan(origin.x);
    expect(window.maxX).toBeGreaterThan(origin.x + view.widthTiles);
  });

  it('orders by y, then by x', () => {
    // O desempate por `x` é o que torna a ordem estável: sem ele, duas criaturas no mesmo
    // `y` trocam de ordem entre quadros e piscam uma na frente da outra.
    const creatures = [
      { x: 5, y: 3 }, { x: 1, y: 3 }, { x: 9, y: 1 },
    ].sort(compareDrawOrder);
    expect(creatures).toEqual([{ x: 9, y: 1 }, { x: 1, y: 3 }, { x: 5, y: 3 }]);
  });
});

describe('o mundo na tela inteira (FUN-115)', () => {
  it('o zoom é inteiro, e sobe com a altura da tela: 1, 2 e 3', () => {
    // Pixel art a 1,5× borra; o Huntera desenha o tile a 64 px numa tela comum.
    // Mutação que mata: devolver `height / 448` sem arredondar, ou 2 sempre.
    expect(zoomFor(800, 500)).toBe(1);
    expect(zoomFor(1024, 560)).toBe(2);
    expect(zoomFor(1440, 900)).toBe(2);
    expect(zoomFor(2560, 1399)).toBe(2);
    expect(zoomFor(2560, 1400)).toBe(3);
    expect(zoomFor(2560, 1440)).toBe(3);
    // É o lado MENOR que decide: uma tela larga e baixa não ganha zoom pela largura.
    expect(zoomFor(3000, 500)).toBe(1);
  });

  it('a vista é o que cabe na tela, fracionária, sem teto de câmera (#415)', () => {
    expect(viewFor(1024, 768, 2)).toEqual({ widthTiles: 16, heightTiles: 12 });
    expect(viewFor(1000, 700, 2).widthTiles).toBeCloseTo(15.625);
    // 4K a 3×: 4096/96 = 42,66… tiles de largura. A câmera desenha o canvas inteiro; o teto
    // de 18×14 é só do raio de interesse da rede.
    const wide = viewFor(4096, 2160, 3);
    expect(wide.widthTiles).toBeCloseTo(4096 / 96);
    expect(wide.heightTiles).toBeCloseTo(2160 / 96);
    expect(wide.widthTiles).toBeGreaterThan(VIEW_WIDTH);
    expect(wide.heightTiles).toBeGreaterThan(VIEW_HEIGHT);
  });

  it('o raio de interesse da rede continua 18×14, mesmo com a câmera maior (#415)', () => {
    // Mutação que mata: apagar `VIEW_WIDTH`/`VIEW_HEIGHT` junto com o teto da câmera, ou
    // fazer `viewFor` voltar a limitar por eles.
    expect(VIEW_WIDTH).toBe(18);
    expect(VIEW_HEIGHT).toBe(14);
  });

  it('com a vista fracionária a câmera continua centrada no alvo', () => {
    const view = viewFor(1000, 700, 2);
    const origin = cameraOrigin({ x: 10, y: 10, z: 7 }, view);
    // O alvo fica no meio do canvas: metade da largura em tiles para cada lado.
    expect(10 - origin.x).toBeCloseTo((view.widthTiles - 1) / 2);
    // E o CENTRO do tile do alvo cai no centro do canvas, em pixels de tela (zoom 2).
    const screen = toScreen({ x: 10, y: 10 }, { x: 10, y: 10, z: 7 }, view);
    expect((screen.x + TILE / 2) * 2).toBeCloseTo(1000 / 2);
    expect((screen.y + TILE / 2) * 2).toBeCloseTo(700 / 2);
  });

  it('numa tela larga o alvo cai no centro real do canvas, não no centro do raio de interesse (#415)', () => {
    // 1920×1080 a 2× é o caso do bug: a vista antiga era limitada a 18×14, e o alvo ficava em
    // ~576 px enquanto o overlay DOM de vitais ficava em 960 px. Mutação que mata: voltar o
    // `Math.min` de `viewFor`.
    const view = viewFor(1920, 1080, 2);
    expect(view.widthTiles).toBeCloseTo(30);
    expect(view.heightTiles).toBeCloseTo(16.875);
    const screen = toScreen(at(10, 10), at(10, 10), view);
    expect((screen.x + TILE / 2) * 2).toBeCloseTo(1920 / 2);
    expect((screen.y + TILE / 2) * 2).toBeCloseTo(1080 / 2);
  });
});
