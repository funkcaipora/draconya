import { describe, expect, it } from 'vitest';
import { NO_FLAGS } from '../assets/appearances.js';
import type { AppearanceFlags } from '../assets/appearances.js';
import { MAX_ELEVATION, countCell, drawTile, layerOf } from './tile-stack.js';
import type { ObjectInfo } from './tile-stack.js';

// Um "pacote" de mentira: cada id com as flags e o padrão que a regra em teste precisa.
const GRASS = 100; // chão 4×4
const BORDER = 101; // clip
const WALL = 102; // bottom + unpass, com gancho ao sul
const CRATE = 103; // comum, elevação 8
const BARREL = 104; // comum, elevação 8
const PILLAR = 105; // unpass, elevação 24 — o teto sozinho
const ARCH = 106; // top
const COINS = 107; // comum, empilhável 4×2
const PAINTING = 108; // hang, padrão 3×1
const SHIFTED = 109; // comum com shift (2, 3)
const COINS_13 = 110; // empilhável do 13.x: padrão 4×3, fora da tabela de contagem
const STEP = 111; // chão com elevação 8 (um degrau)
const TREE = 112; // unpass + unsight, 32×32 — cenário pelas flags
const STATUE = 113; // sem flag, 64×64 — cenário SÓ pela dimensão
const CARPET = 114; // sem flag, 32×32 — chão decorativo

const catalogue: Record<number, {
  flags: Partial<AppearanceFlags>;
  pattern?: { width: number; height: number };
  size?: { width: number; height: number };
}> = {
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
  [COINS_13]: { flags: { take: true }, pattern: { width: 4, height: 3 } },
  [STEP]: { flags: { bankWaypoints: 150, elevation: 8 } },
  [TREE]: { flags: { unpass: true, unsight: true } },
  [STATUE]: { flags: {}, size: { width: 2, height: 2 } },
  [CARPET]: { flags: {} },
};
const info: ObjectInfo = {
  flagsOf: (id) => ({ ...NO_FLAGS, ...(catalogue[id]?.flags ?? {}) }),
  patternOf: (id) => catalogue[id]?.pattern ?? { width: 1, height: 1 },
  sizeOf: (id) => catalogue[id]?.size ?? { width: 1, height: 1 },
};
const ids = (drawn: ReturnType<typeof drawTile>) => drawn.objects.map((o) => o.appearanceId);

describe('drawTile — a ordem da pilha (FUN-121)', () => {
  it('chão, bordas, bottom, comuns na ordem do arquivo, e top por último, ACIMA das criaturas', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: ARCH }, { id: CRATE }, { id: WALL }, { id: BORDER }, { id: BARREL }] }, 0, 0, info);
    expect(ids(drawn)).toEqual([GRASS, BORDER, WALL, CRATE, BARREL, ARCH]);
    // A parede muda de CAMADA — a ordem das passagens é a mesma, mas `bottom` e o que vem
    // depois dele na pilha saem `scene`. É a pilha completa que prova as três camadas juntas.
    expect(drawn.objects.map((o) => o.layer)).toEqual(['ground', 'ground', 'scene', 'scene', 'scene', 'top']);
    expect(drawn.objects.map((o) => o.sceneSlot)).toEqual([0, 0, 0, 1, 2, 3]);
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

  it('a tabela de contagem só vale para o padrão de 4×2; com outro padrão a célula é a da posição', () => {
    // As moedas do 13.x têm padrão 4×3, e o cliente do Tibia as desenha pela posição — pela
    // tabela, a terceira linha delas nunca seria alcançada.
    const drawn = drawTile({ ground: GRASS, items: [{ id: COINS_13, count: 4 }] }, 129, 50, info);
    expect(drawn.objects[1]?.cell).toEqual({ x: 1, y: 2 });
  });

  it('chão com elevação sobe os itens em cima dele e a criatura, como um degrau', () => {
    const drawn = drawTile({ ground: STEP, items: [{ id: CRATE }] }, 0, 0, info);
    expect(drawn.objects.map((o) => o.dy)).toEqual([0, -8]);
    expect(drawn.creatureElevation).toBe(16);
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

describe('layerOf — a camada de um objeto (M23, D3)', () => {
  it('a dimensão é RESERVA: um item sem flag de mais de um tile é cenário pelos dois eixos', () => {
    // `{1, 2}` e `{2, 1}` são spritetype 1 e 2; os dois transbordam para um vizinho, então os
    // dois precisam de ordem espacial. Reserva olhando só a largura (ou só a altura) deixaria
    // um dos dois passar.
    expect(layerOf(NO_FLAGS, { width: 1, height: 2 })).toBe('scene');
    expect(layerOf(NO_FLAGS, { width: 2, height: 1 })).toBe('scene');
  });

  it('chão de folha grande continua chão: `bankWaypoints` vence a dimensão', () => {
    // O chão é chão mesmo quando a folha dele é de 64 px; sem esta pergunta antes da dimensão,
    // um piso de 2×2 viraria cenário e trocaria de camada.
    expect(layerOf({ ...NO_FLAGS, bankWaypoints: 0 }, { width: 2, height: 2 })).toBe('ground');
  });

  it('`bottom` vence `top` — a parede com as duas flags não sobe para cima das criaturas', () => {
    // A passagem de `top` de `drawTile` exige `!flags.bottom`, e `layerOf` testa `bottom`
    // ANTES de `top` para dizer a mesma coisa: pacote estranho com as duas flags sai `scene`.
    expect(layerOf({ ...NO_FLAGS, bottom: true, top: true }, { width: 1, height: 1 })).toBe('scene');
  });
});

describe('drawTile — a camada que o M23 corrige (M23, D3)', () => {
  it('a parede (`bottom`, 32×32) sai `scene` pelas flags, não pelo tamanho', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: WALL }] }, 0, 0, info);
    expect(drawn.objects.at(-1)).toMatchObject({ appearanceId: WALL, layer: 'scene', sceneSlot: 0 });
  });

  it('o pilar (`unpass`, 32×32) sai `scene` — a flag basta, sem dimensão', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: PILLAR }] }, 0, 0, info);
    expect(drawn.objects.at(-1)).toMatchObject({ appearanceId: PILLAR, layer: 'scene' });
  });

  it('a árvore (`unpass` + `unsight`, 32×32) sai `scene`', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: TREE }] }, 0, 0, info);
    expect(drawn.objects.at(-1)).toMatchObject({ appearanceId: TREE, layer: 'scene' });
  });

  it('um objeto passável sem flag só é `scene` pela dimensão — 64×64 sim, 32×32 não', () => {
    const big = drawTile({ ground: GRASS, items: [{ id: STATUE }] }, 0, 0, info);
    expect(big.objects.at(-1)).toMatchObject({ appearanceId: STATUE, layer: 'scene' });
    // O MESMO id visto como 32×32: sem flag e sem dimensão, volta a ser chão. Prova que a
    // reserva olha o `sizeOf`, e não o id.
    const flat: ObjectInfo = { ...info, sizeOf: () => ({ width: 1, height: 1 }) };
    const small = drawTile({ ground: GRASS, items: [{ id: STATUE }] }, 0, 0, flat);
    expect(small.objects.at(-1)).toMatchObject({ appearanceId: STATUE, layer: 'ground' });
  });

  it('o chão e o carpete comum de 32×32 continuam `ground`', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: CARPET }] }, 0, 0, info);
    expect(drawn.objects[0]).toMatchObject({ appearanceId: GRASS, layer: 'ground' });
    expect(drawn.objects.at(-1)).toMatchObject({ appearanceId: CARPET, layer: 'ground' });
  });

  it('a partir do primeiro `scene`, o resto não-`top` também é `scene`', () => {
    // O quadro pendurado (`hang`, 32×32, passável) é chão sozinho, mas sobre a parede ele é
    // parte dela: em `ground` seria desenhado ATRÁS da parede e sumiria dentro dela.
    const onWall = drawTile({ ground: GRASS, items: [{ id: WALL }, { id: PAINTING }] }, 0, 0, info);
    expect(onWall.objects.at(-1)).toMatchObject({
      appearanceId: PAINTING, layer: 'scene', sceneSlot: 1, cell: { x: 1, y: 0 },
    });
    const alone = drawTile({ ground: GRASS, items: [{ id: PAINTING }] }, 0, 0, info);
    expect(alone.objects.at(-1)).toMatchObject({
      appearanceId: PAINTING, layer: 'ground', sceneSlot: 0, cell: { x: 0, y: 0 },
    });
  });

  it('o `top` continua `top` e ignora a elevação e a regra de pilha', () => {
    const drawn = drawTile({ ground: GRASS, items: [{ id: CRATE }, { id: ARCH }] }, 0, 0, info);
    expect(drawn.objects.at(-1)).toMatchObject({ appearanceId: ARCH, dx: 0, dy: 0, layer: 'top' });
  });
});
