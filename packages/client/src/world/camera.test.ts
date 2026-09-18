import { describe, expect, it } from 'vitest';
import {
  PREFETCH_TILES, RENDER_OVERSCAN_TILES, VIEW_HEIGHT, VIEW_WIDTH, cameraOrigin, compareDrawOrder,
  prefetchTiles, renderTiles, sameWindow, tileWindow, tilesEntering, toScreen, viewFor,
  visibleTiles, zoomFor, TILE, type TileWindow,
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

  it('renderTiles já contém a coluna que entra pela borda antes de visibleTiles', () => {
    // Substitui o teste da semântica antiga (margem 1 fixa + um tile a mais na ponta). Reprova
    // o executor que só trocasse o nome do teste antigo e mantivesse a margem 1 em `visibleTiles`.
    const visible = visibleTiles(at(10, 10), view);
    const render = renderTiles(at(10, 10), view);
    expect(render.minX).toBeLessThan(visible.minX);
    expect(render.maxX).toBeGreaterThan(visible.maxX);
  });

  it('tileWindow com margem 0, 3 e 5 a partir do mesmo alvo: cada lado cresce exatamente a margem', () => {
    const target = at(10, 10);
    const visible = tileWindow(target, view, 0);
    const render = tileWindow(target, view, RENDER_OVERSCAN_TILES);
    const prefetch = tileWindow(target, view, PREFETCH_TILES);

    expect(visibleTiles(target, view)).toEqual(visible);
    expect(renderTiles(target, view)).toEqual(render);
    expect(prefetchTiles(target, view)).toEqual(prefetch);

    for (const corner of ['minX', 'minY'] as const) {
      expect(render[corner]).toBe(visible[corner] - RENDER_OVERSCAN_TILES);
      expect(prefetch[corner]).toBe(visible[corner] - PREFETCH_TILES);
    }
    for (const corner of ['maxX', 'maxY'] as const) {
      expect(render[corner]).toBe(visible[corner] + RENDER_OVERSCAN_TILES);
      expect(prefetch[corner]).toBe(visible[corner] + PREFETCH_TILES);
    }
  });

  it('câmera fracionária: a janela visível cobre a coluna parcial de cada lado', () => {
    // Alvo em x = 10.5 → origin.x = 2.0 (inteiro): a borda esquerda cai exatamente no início do
    // tile 2, e a direita em 20.0 — nenhuma coluna parcial, 18 colunas (a largura da vista).
    const halfStep = visibleTiles({ x: 10.5, y: 10, z: 7 }, view);
    expect(halfStep.minX).toBe(2);
    expect(halfStep.maxX).toBe(19);
    expect(halfStep.maxX - halfStep.minX + 1).toBe(18);

    // Alvo em x = 10 → origin.x = 1.5: uma coluna parcial de CADA lado, 19 colunas.
    const wholeStep = visibleTiles({ x: 10, y: 10, z: 7 }, view);
    expect(wholeStep.minX).toBe(1);
    expect(wholeStep.maxX).toBe(19);
    expect(wholeStep.maxX - wholeStep.minX + 1).toBe(19);
  });

  it('borda direita exatamente inteira: o último tile visível é o que termina nela, não o seguinte', () => {
    // origin.x = 1.0 (target.x = 9.5) → origin.x + widthTiles = 19.0 exatamente: o tile 19
    // começa na borda e está inteiramente FORA da tela; o tile 18 é o último dentro dela.
    const target = { x: 9.5, y: 10, z: 7 };
    const origin = cameraOrigin(target, view);
    expect(origin.x + view.widthTiles).toBe(19);
    expect(visibleTiles(target, view).maxX).toBe(18);
  });

  it('bordas de mapa: alvo no canto não recorta a janela', () => {
    const corner = at(0, 0);
    const visible = visibleTiles(corner, view);
    expect(visible.minX).toBeLessThan(0);
    expect(visible.minY).toBeLessThan(0);

    // A janela de render é mais negativa ainda: a margem soma por cima, nunca protege a borda.
    const render = renderTiles(corner, view);
    expect(render.minX).toBe(visible.minX - RENDER_OVERSCAN_TILES);
    expect(render.minY).toBe(visible.minY - RENDER_OVERSCAN_TILES);
  });

  it('propriedade da caminhada: todo tile que entra na janela visível já esteve na de render há 3 passos e na de prefetch há 5', () => {
    // Alvo de x = 10 a x = 40, passo de 1 tile, y fixo. Só a partir do 5º passo dá para olhar
    // 5 passos para trás sem sair do intervalo caminhado.
    const START = 10;
    const STEPS = 30;
    let checked = 0;

    for (let k = 5; k <= STEPS; k++) {
      const previous = visibleTiles(at(START + k - 1, 10), view);
      const next = visibleTiles(at(START + k, 10), view);
      const entering = tilesEntering(previous, next);
      expect(entering.length).toBeGreaterThan(0);

      const renderWindow = renderTiles(at(START + k - RENDER_OVERSCAN_TILES, 10), view);
      const prefetchWindow = prefetchTiles(at(START + k - PREFETCH_TILES, 10), view);
      for (const tile of entering) {
        expect(tile.x).toBeGreaterThanOrEqual(renderWindow.minX);
        expect(tile.x).toBeLessThanOrEqual(renderWindow.maxX);
        expect(tile.x).toBeGreaterThanOrEqual(prefetchWindow.minX);
        expect(tile.x).toBeLessThanOrEqual(prefetchWindow.maxX);
      }
      checked += 1;
    }
    expect(checked).toBe(STEPS - 5 + 1);
  });

  it('tilesEntering: null devolve todos, um passo devolve a coluna ou o L, janela igual devolve vazio', () => {
    const window: TileWindow = { minX: 0, minY: 0, maxX: 4, maxY: 3 };

    const all = tilesEntering(null, window);
    expect(all).toHaveLength((window.maxX - window.minX + 1) * (window.maxY - window.minY + 1));

    const shiftedX: TileWindow = { minX: 1, minY: 0, maxX: 5, maxY: 3 };
    const column = tilesEntering(window, shiftedX);
    expect(column).toHaveLength(window.maxY - window.minY + 1);
    expect(column.every((tile) => tile.x === shiftedX.maxX)).toBe(true);

    const shiftedXY: TileWindow = { minX: 1, minY: 1, maxX: 5, maxY: 4 };
    const ell = tilesEntering(window, shiftedXY);
    const width = shiftedXY.maxX - shiftedXY.minX + 1;
    const height = shiftedXY.maxY - shiftedXY.minY + 1;
    expect(ell).toHaveLength(width + height - 1);

    const same = tilesEntering(window, window);
    expect(same).toEqual([]);

    for (const result of [all, column, ell]) {
      const keys = new Set(result.map((tile) => `${tile.x},${tile.y}`));
      expect(keys.size).toBe(result.length);
    }
  });

  it('sameWindow: igual é true, cada canto diferente é false', () => {
    const a: TileWindow = { minX: 0, minY: 0, maxX: 10, maxY: 8 };
    expect(sameWindow(a, { ...a })).toBe(true);
    expect(sameWindow(a, { ...a, minX: a.minX - 1 })).toBe(false);
    expect(sameWindow(a, { ...a, minY: a.minY - 1 })).toBe(false);
    expect(sameWindow(a, { ...a, maxX: a.maxX + 1 })).toBe(false);
    expect(sameWindow(a, { ...a, maxY: a.maxY + 1 })).toBe(false);
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

  it('a vista é o que cabe na tela, fracionária, com teto no raio de interesse', () => {
    expect(viewFor(1024, 768, 2)).toEqual({ widthTiles: 16, heightTiles: 12 });
    expect(viewFor(1000, 700, 2).widthTiles).toBeCloseTo(15.625);
    // 4K a 3×: 4096/96 = 42 tiles caberiam, mas só chegam criaturas em 18×14.
    expect(viewFor(4096, 2160, 3)).toEqual({ widthTiles: VIEW_WIDTH, heightTiles: VIEW_HEIGHT });
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
});
