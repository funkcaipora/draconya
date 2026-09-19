import { describe, expect, it } from 'vitest';
import {
  PREFETCH_TILES, RENDER_OVERSCAN_TILES, VIEW_HEIGHT, VIEW_WIDTH, cameraOrigin, compareDrawOrder,
  fromScreen, prefetchTiles, renderTiles, sameWindow, tileAtScreen, tileWindow, tilesEntering,
  toScreen, viewFor, visibleTiles, zoomFor, TILE, type TileWindow,
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

  it('RENDER_OVERSCAN_TILES e PREFETCH_TILES são os números do PRD: 3 e 5', () => {
    // Achado 1 da rodada 1 de revisão (#382): os outros testes usam as próprias constantes
    // como parâmetro (`renderTiles(t, v)` já É `tileWindow(t, v, RENDER_OVERSCAN_TILES)`), o
    // que prova que os wrappers delegam certo, mas não prende O VALOR — mudar a constante para
    // 2 ou 4 não reprovava nada aqui. Esta é a única asserção que trava o NÚMERO.
    expect(RENDER_OVERSCAN_TILES).toBe(3);
    expect(PREFETCH_TILES).toBe(5);
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
    //
    // Achado 1 da rodada 1 de revisão (#382): os offsets abaixo são os LITERAIS `3` e `5`, não
    // `RENDER_OVERSCAN_TILES`/`PREFETCH_TILES` — com a constante, mudar a margem para 2 também
    // mudava quantos passos a propriedade olhava para trás, e as duas mudanças se cancelavam
    // (a propriedade virava tautologia, verdadeira para qualquer margem). Com o literal, uma
    // margem menor que 3 (ou 5) deixa o tile fora da janela correspondente. A igualdade — não
    // só "dentro de" — é o que fecha "≥ 3 passos" (RF-05): com largura constante, o tile que
    // entra em `visibleTiles` no passo `k` é EXATAMENTE `renderTiles(k - 3).maxX` quando a
    // margem é 3; uma margem de 2 deixaria esse tile UM À FRENTE da janela de render de 3
    // passos atrás, não só fora de uma faixa frouxa.
    const START = 10;
    const STEPS = 30;
    let checked = 0;

    for (let k = 5; k <= STEPS; k++) {
      const previous = visibleTiles(at(START + k - 1, 10), view);
      const next = visibleTiles(at(START + k, 10), view);
      const entering = tilesEntering(previous, next);
      expect(entering.length).toBeGreaterThan(0);

      const renderWindow = renderTiles(at(START + k - 3, 10), view);
      const prefetchWindow = prefetchTiles(at(START + k - 5, 10), view);
      for (const tile of entering) {
        expect(tile.x).toBe(renderWindow.maxX);
        expect(tile.x).toBe(prefetchWindow.maxX);
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

  it('fromScreen é o inverso de toScreen, inclusive com posição fracionária', () => {
    // É o caminho do clique: o pixel do canvas volta a tile. Eixo trocado ou offset da câmera
    // errado só aparece aqui — no canvas o sintoma é acertar a criatura ao lado.
    const target = at(10, 10);
    for (const point of [{ x: 8.25, y: 9.5 }, { x: 10, y: 10 }, { x: 11.75, y: 12.1 }]) {
      const screen = toScreen(point, target, view);
      const back = fromScreen(screen, target, view);
      expect(back.x).toBeCloseTo(point.x);
      expect(back.y).toBeCloseTo(point.y);
    }
  });

  it('quantiza o tile pelo PISO, não pelo arredondamento (#420)', () => {
    // Câmera em x=10, vista de 18: origem.x = 1.5; o tile 10 ocupa os pixels 272–304. O pixel
    // 290 (metade DIREITA) dá 290/32 + 1.5 = 10.56 — o tile é o 10. Com `round` a metade direita
    // de cada sprite cai no tile seguinte e o clique erra a criatura.
    // Em y, origem = 3.5: o tile 10 ocupa 208–240; o pixel 232 (metade INFERIOR) dá 10.75.
    expect(tileAtScreen({ x: 290, y: 232 }, at(10, 10), view)).toEqual({ x: 10, y: 10 });
    // E a metade esquerda/superior continua sendo o mesmo tile.
    expect(tileAtScreen({ x: 273, y: 209 }, at(10, 10), view)).toEqual({ x: 10, y: 10 });
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
