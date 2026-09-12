import { describe, expect, it } from 'vitest';
import { NO_FLAGS } from '../assets/appearances.js';
import type { AppearanceFlags } from '../assets/appearances.js';
import { MAX_ELEVATION, countCell, drawTile } from './tile-stack.js';
import type { ObjectInfo } from './tile-stack.js';

// Um "pacote" de mentira: cada id com as flags e o padrão que a regra em teste precisa.
const GRASS = 100; // chão 4×4
const BORDER = 101; // clip
const WALL = 102; // bottom + unpass, com gancho ao sul
const CRATE = 103; // comum, elevação 8
const BARREL = 104; // comum, elevação 8
const PILLAR = 105; // comum, elevação 24 — o teto sozinho
const ARCH = 106; // top
const COINS = 107; // comum, empilhável 4×2
const PAINTING = 108; // hang, padrão 3×1
const SHIFTED = 109; // comum com shift (2, 3)

const catalogue: Record<number, { flags: Partial<AppearanceFlags>; pattern?: { width: number; height: number } }> = {
  [GRASS]: { flags: { bankWaypoints: 150 }, pattern: { width: 4, height: 4 } },
  [BORDER]: { flags: { clip: true }, pattern: { width: 2, height: 2 } },
  [WALL]: { flags: { bottom: true, unpass: true, unsight: true, hookSouth: 1 } },
  [CRATE]: { flags: { elevation: 8, take: true } },
  [BARREL]: { flags: { elevation: 8 } },
  [PILLAR]: { flags: { elevation: 24, unpass: true } },
  [ARCH]: { flags: { top: true } },
  [COINS]: { flags: { take: true }, pattern: { width: 4, height: 2 } },
  [PAINTING]: { flags: { hang: true }, pattern: { width: 3, height: 1 } },
  [SHIFTED]: { flags: { shiftX: 2, shiftY: 3 } },
};
const info: ObjectInfo = {
  flagsOf: (id) => ({ ...NO_FLAGS, ...(catalogue[id]?.flags ?? {}) }),
  patternOf: (id) => catalogue[id]?.pattern ?? { width: 1, height: 1 },
};
const ids = (drawn: ReturnType<typeof drawTile>) => drawn.objects.map((o) => o.appearanceId);

describe('drawTile — a ordem da pilha (FUN-121)', () => {
  it('chão, bordas, bottom, comuns na ordem do arquivo, e top por último, ACIMA das criaturas', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: ARCH }, { id: CRATE }, { id: WALL }, { id: BORDER }, { id: BARREL }] }, 0, 0, info);
    expect(ids(drawn)).toEqual([GRASS, BORDER, WALL, CRATE, BARREL, ARCH]);
    expect(drawn.objects.map((o) => o.layer)).toEqual(['ground', 'ground', 'ground', 'ground', 'ground', 'top']);
  });

  it('tile sem chão desenha só os itens; tile vazio não desenha nada', () => {
    expect(ids(drawTile({ ground: 0, items: [{ id: CRATE }] }, 0, 0, info))).toEqual([CRATE]);
    expect(drawTile({ ground: 0, items: [] }, 0, 0, info).objects).toEqual([]);
  });

  it('bloqueia quando o chão ou qualquer item tem unpass — a regra do importador, para o retângulo de reserva', () => {
    expect(drawTile({ ground: GRASS, items: [{ id: CRATE }] }, 0, 0, info).blocked).toBe(false);
    expect(drawTile({ ground: GRASS, items: [{ id: CRATE }, { id: WALL }] }, 0, 0, info).blocked).toBe(true);
    expect(drawTile({ ground: PILLAR, items: [] }, 0, 0, info).blocked).toBe(true);
  });
});

describe('drawTile — elevação (FUN-121)', () => {
  it('cada item sobe o que vem depois pelo que os anteriores somaram, e a criatura sobe o total', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: CRATE }, { id: BARREL }, { id: COINS }] }, 0, 0, info);
    expect(drawn.objects.map((o) => [o.dx, o.dy])).toEqual([[0, 0], [0, 0], [-8, -8], [-16, -16]]);
    expect(drawn.creatureElevation).toBe(16);
  });

  it('o teto é 24 px, e o que passa dele não sobe mais', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: PILLAR }, { id: CRATE }, { id: BARREL }] }, 0, 0, info);
    expect(drawn.objects.map((o) => o.dy)).toEqual([0, 0, -24, -24]);
    expect(drawn.creatureElevation).toBe(MAX_ELEVATION);
  });

  it('top ignora a elevação: o arco não sobe com a caixa embaixo dele', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: CRATE }, { id: ARCH }] }, 0, 0, info);
    expect(drawn.objects.at(-1)).toMatchObject({ appearanceId: ARCH, dx: 0, dy: 0, layer: 'top' });
    expect(drawn.creatureElevation).toBe(8);
  });

  it('shift desloca o próprio item, e soma com a elevação de quem veio antes', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: CRATE }, { id: SHIFTED }] }, 0, 0, info);
    expect(drawn.objects[2]).toMatchObject({ appearanceId: SHIFTED, dx: -10, dy: -11 });
  });
});

describe('drawTile — padrões (FUN-121)', () => {
  it('chão e item comum pela célula (x % largura, y % altura)', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: BORDER }] }, 5, 6, info);
    expect(drawn.objects[0]?.cell).toEqual({ x: 1, y: 2 });
    expect(drawn.objects[1]?.cell).toEqual({ x: 1, y: 0 });
  });

  it('empilhável com contagem usa a tabela de contagem, não a posição', () => {
    const at = (count: number) => drawTile({ ground: GRASS, items: [{ id: COINS, count }] }, 5, 6, info).objects[1]?.cell;
    expect(at(1)).toEqual({ x: 0, y: 0 });
    expect(at(2)).toEqual({ x: 1, y: 0 });
    expect(at(4)).toEqual({ x: 3, y: 0 });
    expect(at(5)).toEqual({ x: 0, y: 1 });
    expect(at(10)).toEqual({ x: 1, y: 1 });
    expect(at(25)).toEqual({ x: 2, y: 1 });
    expect(at(100)).toEqual({ x: 3, y: 1 });
  });

  it('countCell cabe num padrão menor sem estourar', () => {
    expect(countCell(100, { width: 1, height: 1 })).toEqual({ x: 0, y: 0 });
    expect(countCell(3, { width: 2, height: 1 })).toEqual({ x: 0, y: 0 });
  });

  it('pendurável escolhe a coluna pelo gancho da parede do MESMO tile', () => {
    const onSouthWall = drawTile({ ground: GRASS, items: [{ id: WALL }, { id: PAINTING }] }, 0, 0, info);
    expect(onSouthWall.objects.at(-1)?.cell).toEqual({ x: 1, y: 0 });
    const alone = drawTile({ ground: GRASS, items: [{ id: PAINTING }] }, 0, 0, info);
    expect(alone.objects.at(-1)?.cell).toEqual({ x: 0, y: 0 });
  });
});
