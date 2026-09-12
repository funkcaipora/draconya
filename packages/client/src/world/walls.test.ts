import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTilemap, isBlocked, tilemapSchema, type Tilemap } from '@draconya/content';
import { wallPiece, wallsOf, type WallPiece } from './walls.js';

/** Um predicado a partir de uma lista de tiles de parede — o mapa reduzido ao que importa. */
const wallsAt = (...tiles: ReadonlyArray<readonly [number, number]>) => {
  const set = new Set(tiles.map(([x, y]) => `${x},${y}`));
  return (x: number, y: number): boolean => set.has(`${x},${y}`);
};

describe('wallPiece — a peça pelos vizinhos de NORTE e OESTE (FUN-105)', () => {
  it('parede ao norte, e nada a oeste, é a peça VERTICAL', () => {
    // A vertical é o trecho que sobe deste tile até o de norte. Sul não entra: o trecho até o
    // vizinho de sul é a vertical DELE.
    // Mutação que mata: trocar `n` e `w` na escolha (`if (n) return 'horizontal'`).
    expect(wallPiece(wallsAt([5, 4]), 5, 5)).toBe('vertical');
    expect(wallPiece(wallsAt([5, 4], [5, 6]), 5, 5)).toBe('vertical');
    expect(wallPiece(wallsAt([5, 4], [6, 5]), 5, 5)).toBe('vertical');
  });

  it('parede a oeste, e nada ao norte, é a peça HORIZONTAL', () => {
    expect(wallPiece(wallsAt([4, 5]), 5, 5)).toBe('horizontal');
    expect(wallPiece(wallsAt([4, 5], [6, 5]), 5, 5)).toBe('horizontal');
    expect(wallPiece(wallsAt([4, 5], [5, 6]), 5, 5)).toBe('horizontal');
  });

  it('parede ao norte E a oeste é o CANTO — com ou sem sul e leste', () => {
    // A peça de canto fecha os dois trechos que chegam a este tile. Os braços de sul e leste
    // de um T ou de uma cruz são desenhados pelos tiles de lá, então não mudam a peça daqui.
    // Mutação que mata: `if (n && w)` → `if (n !== w)` (o canto vira "um lado só").
    expect(wallPiece(wallsAt([5, 4], [4, 5]), 5, 5)).toBe('corner');
    expect(wallPiece(wallsAt([5, 4], [4, 5], [6, 5]), 5, 5)).toBe('corner');
    expect(wallPiece(wallsAt([5, 4], [5, 6], [4, 5], [6, 5]), 5, 5)).toBe('corner');
  });

  it('sem parede ao norte nem a oeste é o POSTE — mesmo com parede ao sul e a leste', () => {
    // É o teste que pega a regra ESPELHADA (norte OU sul, leste OU oeste): com ela, um tile
    // com vizinho só ao sul e a leste sairia como canto, e o sprite — que espalha para cima e
    // para a esquerda — desenharia um toco de muro em direção a lugar nenhum. O canto de
    // cima-esquerda de todo retângulo é este caso.
    // Mutação que mata: `isWall(x, y - 1)` → `isWall(x, y - 1) || isWall(x, y + 1)` (e o
    // equivalente para leste); ou `return 'pole'` → `return 'corner'`.
    expect(wallPiece(wallsAt(), 5, 5)).toBe('pole');
    expect(wallPiece(wallsAt([5, 6]), 5, 5)).toBe('pole');
    expect(wallPiece(wallsAt([6, 5]), 5, 5)).toBe('pole');
    expect(wallPiece(wallsAt([5, 6], [6, 5]), 5, 5)).toBe('pole');
  });

  it('a diagonal NÃO conta: um vizinho só na diagonal ainda é poste', () => {
    // Diagonal não liga parede a parede. Contá-la desenharia um canto abrindo para lugar
    // nenhum — e, no mapa real, cada canto externo ganharia vizinhos que não tem.
    // Mutação que mata: somar `isWall(x - 1, y - 1)` (ou qualquer diagonal) a `n` ou `w`.
    expect(wallPiece(wallsAt([4, 4], [6, 4], [4, 6], [6, 6]), 5, 5)).toBe('pole');
  });

  it('o tile consultado é (x, y), e os vizinhos são os dele — não os de (y, x)', () => {
    // Num predicado assimétrico, trocar os eixos troca a resposta. É o que pega um
    // `isWall(y, x)` escrito por hábito.
    // Mutação que mata: `isWall(x, y - 1)` → `isWall(y, x - 1)` e afins.
    expect(wallPiece(wallsAt([2, 1]), 2, 2)).toBe('vertical');
    expect(wallPiece(wallsAt([2, 1]), 1, 2)).toBe('pole');
    expect(wallPiece(wallsAt([1, 2]), 2, 2)).toBe('horizontal');
  });
});

describe('wallsOf — fora do mapa não é parede (FUN-105)', () => {
  // A sala é RETANGULAR de propósito: 4 de largura por 3 de altura. Num mapa quadrado, trocar
  // `width` por `height` na checagem de limites passa em silêncio.
  const room = buildTilemap({ id: 'room', z: 7, grid: ['####', '#..#', '####'] });
  const walls = wallsOf(room);

  it('é `isBlocked` DENTRO do mapa', () => {
    expect(walls(0, 0)).toBe(true);
    expect(walls(1, 1)).toBe(false);
    expect(walls(3, 2)).toBe(true);
  });

  it('e é falso FORA dele, ao contrário de `isBlocked`', () => {
    // As duas respostas divergem de propósito: para andar, fora do mapa bloqueia; para a peça,
    // fora do mapa não há muro a ligar. Sem a diferença, a borda inteira do mapa vira canto.
    // Mutação que mata: `wallsOf` devolver `(x, y) => isBlocked(map, x, y)`.
    for (const [x, y] of [[-1, 0], [0, -1], [4, 0], [0, 3], [-1, -1], [4, 3]] as const) {
      expect(isBlocked(room, x, y), `isBlocked(${x},${y})`).toBe(true);
      expect(walls(x, y), `walls(${x},${y})`).toBe(false);
    }
  });

  it('o limite de x é a LARGURA e o de y é a ALTURA, não o contrário', () => {
    // (3, 0) só existe porque a largura é 4; (0, 2) só existe porque a altura é 3. Com os dois
    // trocados, a última coluna some e a linha de baixo do mapa vira "fora".
    // Mutação que mata: `x < map.width && y < map.height` → `x < map.height && y < map.width`.
    expect(walls(3, 0)).toBe(true);
    expect(walls(0, 2)).toBe(true);
    expect(walls(4, 0)).toBe(false);
    expect(walls(0, 3)).toBe(false);
  });

  it('numa sala fechada, o canto de cima-esquerda é POSTE e o de baixo-direita é CANTO', () => {
    // Cada trecho de muro é desenhado pelo tile que está ao sul ou a leste dele: a borda de
    // cima corre de leste a oeste a partir do poste, a borda da esquerda desce dele, e as duas
    // só se fecham em (3, 2), o único tile com parede ao norte E a oeste.
    expect(wallPiece(walls, 0, 0)).toBe('pole');
    expect(wallPiece(walls, 1, 0)).toBe('horizontal');
    expect(wallPiece(walls, 3, 0)).toBe('horizontal');
    expect(wallPiece(walls, 0, 1)).toBe('vertical');
    expect(wallPiece(walls, 0, 2)).toBe('vertical');
    expect(wallPiece(walls, 3, 1)).toBe('vertical');
    expect(wallPiece(walls, 1, 2)).toBe('horizontal');
    expect(wallPiece(walls, 3, 2)).toBe('corner');
  });
});

describe('a regra sobre a adega de teste — a antiga rat-cellars (FUN-105)', () => {
  // A adega 10×10 que foi a Rat Cellars até a FUN-123 — três retângulos concêntricos —, agora
  // fixture: o mapa real é importado e desenha pela pilha (`scene.ts`), não por esta regra. A
  // regra continua valendo para mapa autorado à mão, e é sobre esta grade que o histograma
  // abaixo foi conferido.
  const map: Tilemap = buildTilemap(tilemapSchema.parse({
    id: 'cellar', z: 7,
    grid: [
      "##########",
      "#........#",
      "#.######.#",
      "#.#....#.#",
      "#.#.##.#.#",
      "#.#.##.#.#",
      "#.#....#.#",
      "#.######.#",
      "#........#",
      "##########",
    ],
  }));
  const walls = wallsOf(map);

  it('a borda superior é um poste em (0, 0) e horizontal dali até a ponta direita', () => {
    // É o teste que pega o fora-do-mapa contado como parede: com ele, todo tile da borda de
    // cima teria "parede" ao norte e sairia como canto, não como muro. E pega a regra
    // espelhada: com ela, (0, 0) seria canto e (9, 0) também.
    // Mutação que mata: `wallsOf` sem a checagem de limites; ou `n` contando o sul.
    expect(wallPiece(walls, 0, 0)).toBe('pole');
    for (let x = 1; x < map.width; x++) {
      expect(wallPiece(walls, x, 0), `(${x},0)`).toBe('horizontal');
    }
  });

  it('a borda esquerda é vertical de (0, 1) até a ponta de baixo', () => {
    for (let y = 1; y < map.height; y++) {
      expect(wallPiece(walls, 0, y), `(0,${y})`).toBe('vertical');
    }
  });

  it('o mapa inteiro sai com 27 verticais, 27 horizontais, 3 cantos e 3 postes', () => {
    // O histograma conferido rodando a regra sobre a grade: são três retângulos concêntricos
    // (o anel externo, o anel interno e o bloco 2×2 do centro), e cada um tem UM poste no seu
    // canto de cima-esquerda e UM canto no de baixo-direita — as outras duas quinas são reta,
    // porque só têm parede num dos dois lados que contam. Cada muro reto entra na conta da
    // sua direção.
    //
    // É a asserção que pega uma regra que "quase" funciona — o canto virando `n || w`, a
    // diagonal entrando na conta, o poste e o canto trocados — porque cada uma dessas move
    // dezenas de tiles de uma coluna para outra, mesmo com a borda de cima ainda certa.
    // Mutação que mata: `if (n && w)` → `if (n || w)`; ou `return 'pole'` → `'corner'`.
    const count: Record<WallPiece, number> = { vertical: 0, horizontal: 0, corner: 0, pole: 0 };
    const corners: string[] = [];
    const poles: string[] = [];
    let blocked = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!isBlocked(map, x, y)) continue;
        blocked += 1;
        const piece = wallPiece(walls, x, y);
        count[piece] += 1;
        if (piece === 'corner') corners.push(`${x},${y}`);
        if (piece === 'pole') poles.push(`${x},${y}`);
      }
    }
    expect(blocked).toBe(60);
    expect(count).toEqual({ vertical: 27, horizontal: 27, corner: 3, pole: 3 });
    expect(corners).toEqual(['5,5', '7,7', '9,9']);
    expect(poles).toEqual(['0,0', '2,2', '4,4']);
  });
});
