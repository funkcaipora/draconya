import { buildTilemap } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import {
  TileOccupancy, canOccupy, move, movementDuration, place, placeNear, placeReachable, tilesAround,
} from './movement.js';
import type { Movable, MoveRejection } from './movement.js';

// Uma sala de 4×3 com uma parede no meio. Pequena de propósito: num mapa assim dá para dizer,
// olhando, o que cada caso significa.
//
//     0 1 2 3 4 5
//   0 # # # # # #
//   1 # . . . . #
//   2 # . # . . #
//   3 # . . . . #
//   4 # # # # # #
const map = buildTilemap({
  id: 'sala', z: 7,
  grid: ['######', '#....#', '#.#..#', '#....#', '######'],
});

// Com `z`, como o personagem carrega: o sistema é genérico no tipo do ponto, e este é o lado
// que precisa provar que o `z` sobrevive ao commit em vez de ser apagado no caminho.
interface Ponto { readonly x: number; readonly y: number; readonly z: number }
const at = (x: number, y: number): Movable<Ponto> & { alive: boolean } =>
  ({ alive: true, position: { x, y, z: 7 }, speed: 300 });
const to = (x: number, y: number): Ponto => ({ x, y, z: 7 });

/** Mundo com quem já está de pé, e um retrato da ocupação para provar que nada mudou. */
const world = (...creatures: ReturnType<typeof at>[]) => {
  const w = new TileOccupancy(map);
  w.reset(creatures);
  return w;
};
const snapshotOf = (w: TileOccupancy, c: ReturnType<typeof at>) =>
  ({ position: { ...c.position }, occupiedHere: w.occupied(c.position.x, c.position.y) });

describe('as cinco recusas, e nenhuma delas mexe no mundo', () => {
  // Um teste por `MoveRejection`, e cada um afirma que NADA mudou — posição e ocupação. É o
  // commit parcial que o §8 da referência existe para impedir: validar aqui e aplicar pela
  // metade é o estado que produz dois corpos no mesmo tile.
  const rejects = (
    reason: MoveRejection, hero: ReturnType<typeof at>, w: TileOccupancy, x: number, y: number,
  ): void => {
    const before = snapshotOf(w, hero);
    const result = move(w, hero, to(x, y));
    expect(result).toEqual({ ok: false, reason });
    expect(snapshotOf(w, hero)).toEqual(before);
  };

  it('same-tile', () => {
    const hero = at(2, 1);
    rejects('same-tile', hero, world(hero), 2, 1);
  });

  it('not-adjacent — é o walk-to do cliente tentando teleportar', () => {
    const hero = at(2, 1);
    rejects('not-adjacent', hero, world(hero), 2, 3);
  });

  it('out-of-bounds', () => {
    // O tilemap devolve `true` para fora dos limites como devolve para parede. Separar as
    // duas razões é o que faz a recusa dizer algo: "parede" sugere tentar outra direção;
    // "fora do mapa" diz que quem pediu está errado sobre a geometria.
    // Na borda, e pedindo um tile ADJACENTE fora do mapa — a adjacência é checada antes, e um
    // destino a dois tiles seria `not-adjacent` antes de chegar aqui.
    const hero = at(0, 0);
    rejects('out-of-bounds', hero, world(hero), -1, 0);
  });

  it('tile-blocked', () => {
    const hero = at(1, 1);
    rejects('tile-blocked', hero, world(hero), 2, 2); // a parede da sala
  });

  it('tile-occupied', () => {
    const hero = at(1, 1);
    const rato = at(2, 1);
    const w = world(hero, rato);
    rejects('tile-occupied', hero, w, 2, 1);
    expect(w.occupied(2, 1)).toBe(true); // o rato continua lá
  });
});

describe('legalidade', () => {
  it('a diagonal é legal, e dois tiles não são', () => {
    // Adjacência de rei: ADR 0009 deixa o passo guloso usar as oito direções.
    const hero = at(3, 1);
    const w = world(hero);
    expect(canOccupy(w, hero, to(4, 2))).toBeNull();
    expect(canOccupy(w, hero, to(3, 3))).toBe('not-adjacent');
  });

  it('o tile de onde ELE mesmo está saindo não conta como ocupado por outro', () => {
    // Quem chama já vacate-ou? Não: `canOccupy` é chamado ANTES do commit, e o próprio tile
    // está ocupado por quem pergunta. `same-tile` recusa antes de olhar a ocupação, e é isso
    // que dispensa uma lista de exclusão.
    const hero = at(1, 1);
    const w = world(hero);
    expect(canOccupy(w, hero, to(1, 2))).toBeNull();
  });

  it('consultar não move nada', () => {
    // `canOccupy` é o `queryAdd` do §8: responde sem tocar em estado. Se ele mexesse, o passo
    // guloso — que só pergunta, avaliando vizinhos — moveria por engano.
    const hero = at(1, 1);
    const w = world(hero);
    expect(canOccupy(w, hero, to(2, 1))).toBeNull();
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });
    expect(w.occupied(2, 1)).toBe(false);
  });
});

describe('commit', () => {
  it('move, e a ocupação acompanha nos dois tiles', () => {
    const hero = at(1, 1);
    const w = world(hero);
    const result = move(w, hero, to(2, 1));
    expect(result.ok).toBe(true);
    expect(hero.position).toEqual({ x: 2, y: 1, z: 7 });
    expect(w.occupied(1, 1)).toBe(false);
    expect(w.occupied(2, 1)).toBe(true);
  });

  it('devolve origem, destino e duração, com o andar do MAPA', () => {
    // O resultado fala para fora, onde `z` é obrigatório — e a única fonte de verdade sobre o
    // andar de uma instância é o tilemap dela, não a criatura.
    const hero = at(1, 1);
    const result = move(world(hero), hero, to(1, 2));
    expect(result).toEqual({
      ok: true, from: { x: 1, y: 1, z: 7 }, to: { x: 1, y: 2, z: 7 }, durationMs: 500,
    });
  });

  it('duas criaturas nunca acabam no mesmo tile, em nenhuma ordem', () => {
    // O commit atômico existe para isto: não há instante em que a criatura esteja em dois
    // tiles ou em nenhum, então não há janela em que a segunda ache o destino livre.
    const a = at(1, 1);
    const b = at(1, 3);
    const w = world(a, b);
    expect(move(w, a, to(1, 2)).ok).toBe(true);
    expect(move(w, b, to(1, 2))).toEqual({ ok: false, reason: 'tile-occupied' });
    expect(a.position).toEqual({ x: 1, y: 2, z: 7 });
    expect(b.position).toEqual({ x: 1, y: 3, z: 7 });
  });

  it('convive com criatura sem `z` no mesmo mapa', () => {
    // Personagem e monstro dividem a instância e o índice de ocupação, com formatos de ponto
    // diferentes. É o caso real da hunt, e o `z` de quem o tem sobrevive.
    const hero = at(1, 1);
    const rato: Movable<{ x: number; y: number }> = { position: { x: 2, y: 1 }, speed: 300 };
    const w = new TileOccupancy(map);
    w.reset([hero, { ...rato, alive: true }]);
    expect(move(w, rato, { x: 3, y: 1 }).ok).toBe(true);
    expect(move(w, hero, to(2, 1)).ok).toBe(true);
    expect(hero.position.z).toBe(7);
    expect(w.occupied(3, 1)).toBe(true);
  });
});

describe('duração do passo (FUN-119)', () => {
  // A fórmula do Tibia: `chão × 1000 / speed`, para cima em múltiplos de 50, diagonal × 3
  // ANTES do arredondamento. Os números são os medidos no Huntera (Parte II da observação):
  // speed 292 em chão 130/160/200 dá 450/550/700, e a diagonal em 200 dá 2.100; um rato
  // (172) em 200 dá 1.200 na reta e 3.500 na diagonal — e não 3.600, que é o que sairia
  // arredondando antes de triplicar.
  const paved = buildTilemap({
    id: 'calcada', z: 7,
    floors: { '7': { grid: ['######', '#....#', '#....#', '######'], speed: ['      ', ' abc  ', ' ddd  ', '      '] } },
    speedPalette: { a: 130, b: 160, c: 200, d: 200 },
  });
  const liesh = (x: number, y: number): Movable<Ponto> & { alive: boolean } =>
    ({ alive: true, position: { x, y, z: 7 }, speed: 292 });

  it('segue o chão do DESTINO e a velocidade de quem anda', () => {
    const w = new TileOccupancy(paved);
    const hero = liesh(4, 1);
    expect(movementDuration(w, hero, hero.position, { x: 1, y: 1, z: 7 })).toBe(450);
    expect(movementDuration(w, hero, hero.position, { x: 2, y: 1, z: 7 })).toBe(550);
    expect(movementDuration(w, hero, hero.position, { x: 3, y: 1, z: 7 })).toBe(700);
  });

  it('a diagonal custa três vezes, e o arredondamento vem depois', () => {
    const w = new TileOccupancy(paved);
    const hero = liesh(2, 1);
    expect(movementDuration(w, hero, hero.position, { x: 3, y: 2, z: 7 })).toBe(2100);
    const rat: Movable<{ x: number; y: number }> = { position: { x: 2, y: 1 }, speed: 172 };
    expect(movementDuration(w, rat, rat.position, { x: 3, y: 1, z: 7 })).toBe(1200);
    expect(movementDuration(w, rat, rat.position, { x: 3, y: 2, z: 7 })).toBe(3500);
  });

  it('mapa sem camada de velocidade anda no chão padrão, e speed 300 dá 500 ms', () => {
    // É o que mantém toda fixture de hunt no ritmo de antes da FUN-119.
    const w = new TileOccupancy(map);
    const hero = at(2, 1);
    expect(movementDuration(w, hero, hero.position, to(3, 1))).toBe(500);
    expect(movementDuration(w, hero, hero.position, to(3, 2))).toBe(1500);
  });

  it('na Cidade o passo é fixo, para todo mundo, e a diagonal não custa mais', () => {
    const w = new TileOccupancy(paved, { fixedStepMs: 150 });
    const walker = liesh(1, 1);
    expect(movementDuration(w, walker, walker.position, { x: 2, y: 2, z: 7 })).toBe(150);
    const slow: Movable<Ponto> = { position: { x: 1, y: 1, z: 7 }, speed: 50 };
    expect(movementDuration(w, slow, slow.position, { x: 3, y: 1, z: 7 })).toBe(150);
  });

  it('o `move` devolve a duração do passo dado', () => {
    const w = new TileOccupancy(paved);
    const hero = liesh(2, 1);
    w.reset([hero]);
    const result = move(w, hero, { x: 3, y: 1, z: 7 });
    expect(result).toEqual({ ok: true, from: { x: 2, y: 1, z: 7 }, to: { x: 3, y: 1, z: 7 }, durationMs: 700 });
  });
});

describe('andares e escadas (FUN-119)', () => {
  // Dois andares. A escada em (2,1,7) leva a (3,1,6) — um tile deslocado, como no Tibia —,
  // e a de volta em (3,2,6) leva a (2,2,7).
  //
  //   z7            z6
  //   ######        ######
  //   #....#        #..S.#     (3,1,6) é onde a subida chega; S = escada de descida em (3,2,6)
  //   #....#        #....#
  //   ######        ######
  const house = buildTilemap({
    id: 'casa', z: 7,
    floors: {
      '7': { grid: ['######', '#....#', '#....#', '######'] },
      '6': { grid: ['######', '#....#', '#....#', '######'] },
    },
    floorChanges: [
      { from: { x: 2, y: 1, z: 7 }, to: { x: 3, y: 1, z: 6 } },
      { from: { x: 3, y: 2, z: 6 }, to: { x: 2, y: 2, z: 7 } },
    ],
  });

  it('pisar na escada é um passo que chega em outro andar, e o tile de origem é liberado', () => {
    const w = new TileOccupancy(house);
    const hero = at(1, 1);
    w.reset([hero]);
    const up = move(w, hero, to(2, 1));
    // A duração é a de um passo RETO (o pedido, (1,1)→(2,1)) no chão de chegada — a escada
    // levar a (3,1) não faz dele uma diagonal.
    expect(up).toEqual({ ok: true, from: { x: 1, y: 1, z: 7 }, to: { x: 3, y: 1, z: 6 }, durationMs: 500 });
    expect(hero.position).toEqual({ x: 3, y: 1, z: 6 });
    expect(w.occupied(3, 1, 6)).toBe(true);
    expect(w.occupied(1, 1, 7)).toBe(false);
    expect(w.occupied(2, 1, 7)).toBe(false);
    // E a volta, pela escada de baixo: o passo pede o tile da escada, chega no destino dela.
    const down = move(w, hero, { x: 3, y: 2, z: 6 });
    expect(down).toMatchObject({ ok: true, to: { x: 2, y: 2, z: 7 } });
    expect(hero.position.z).toBe(7);
  });

  it('a diagonal é a do passo pedido, e o chão é o da chegada — mesmo quando a escada desloca', () => {
    // Escada em (2,2,7) que leva a (4,1,6): o passo pedido é reto ((1,2)→(2,2)), e a chegada
    // divide o eixo y com a origem por acaso — nada disso pode mudar a conta.
    const stairs = buildTilemap({
      id: 'escada-torta', z: 7,
      floors: {
        '7': { grid: ['######', '#....#', '#....#', '######'] },
        '6': { grid: ['######', '#....#', '#....#', '######'], speed: ['      ', ' ffff ', ' ffff ', '      '] },
      },
      speedPalette: { f: 200 },
      floorChanges: [{ from: { x: 2, y: 2, z: 7 }, to: { x: 4, y: 1, z: 6 } }],
    });
    const w = new TileOccupancy(stairs);
    const straight = { alive: true, position: { x: 1, y: 2, z: 7 }, speed: 292 };
    w.reset([straight]);
    // Reto, chão 200 na chegada: 700 — não 2.100.
    expect(move(w, straight, { x: 2, y: 2, z: 7 })).toMatchObject({ ok: true, durationMs: 700 });
    const diagonal = { alive: true, position: { x: 1, y: 1, z: 7 }, speed: 292 };
    w.reset([diagonal]);
    // Diagonal ((1,1)→(2,2)), chão 200 na chegada: 2.100 — mesmo com a chegada em y = 1.
    expect(move(w, diagonal, { x: 2, y: 2, z: 7 })).toMatchObject({ ok: true, durationMs: 2100 });
  });

  it('a escada respeita a ocupação do DESTINO, não a do degrau', () => {
    const w = new TileOccupancy(house);
    const hero = at(1, 1);
    const other = { alive: true, position: { x: 3, y: 1, z: 6 }, speed: 300 };
    w.reset([hero, other]);
    expect(move(w, hero, to(2, 1))).toEqual({ ok: false, reason: 'tile-occupied' });
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });
  });

  it('a ocupação é por andar: o mesmo (x, y) em andares diferentes são tiles diferentes', () => {
    const w = new TileOccupancy(house);
    const a = at(1, 1);
    const b = { alive: true, position: { x: 1, y: 1, z: 6 }, speed: 300 };
    w.reset([a, b]);
    expect(w.occupied(1, 1, 7)).toBe(true);
    expect(w.occupied(1, 1, 6)).toBe(true);
    expect(move(w, a, to(1, 2)).ok).toBe(true);
    expect(w.occupied(1, 1, 6)).toBe(true);
    expect(w.occupied(1, 1, 7)).toBe(false);
  });

  it('quem não carrega `z` — o monstro de andar único — trata a escada como parede', () => {
    const w = new TileOccupancy(house);
    const rat: Movable<{ x: number; y: number }> = { position: { x: 1, y: 1 }, speed: 300 };
    w.reset([{ ...rat, alive: true }]);
    expect(move(w, rat, { x: 2, y: 1 })).toEqual({ ok: false, reason: 'tile-blocked' });
    expect(canOccupy(w, rat, { x: 2, y: 1 })).toBe('tile-blocked');
  });

  it('`crossesFloors: false` trata a escada como parede MESMO carregando `z` (#519)', () => {
    // O monstro multiandar carrega `z` de verdade — é o que faz `zOf` achar o andar CERTO dele
    // para bloqueio e ocupação (a outra metade desta issue) —, mas isso não pode virar
    // permissão de trocar de andar sozinho: no Tibia, um Dragon Lord não sobe escada.
    const w = new TileOccupancy(house);
    const dragonLord: Movable<Ponto> & { alive: boolean; crossesFloors: false } =
      { alive: true, position: { x: 1, y: 1, z: 7 }, speed: 300, crossesFloors: false };
    w.reset([dragonLord]);
    expect(canOccupy(w, dragonLord, to(2, 1))).toBe('tile-blocked');
    expect(move(w, dragonLord, to(2, 1))).toEqual({ ok: false, reason: 'tile-blocked' });
    // Mas o `z` que ele carrega continua achando o andar CERTO para um passo comum: sai de
    // (1,1,7) para (1,2,7), sem cair no andar padrão do mapa por engano.
    expect(move(w, dragonLord, to(1, 2))).toMatchObject({ ok: true, to: { x: 1, y: 2, z: 7 } });
  });

  it('fora do mapa continua fora, e andar que não existe é parede', () => {
    const w = new TileOccupancy(house);
    const hero: Movable<Ponto> & { alive: boolean } = { alive: true, position: { x: 1, y: 1, z: 5 }, speed: 300 };
    w.reset([hero]);
    expect(move(w, hero, { x: 2, y: 1, z: 5 })).toEqual({ ok: false, reason: 'tile-blocked' });
  });
});

describe('colocação (FUN-60)', () => {
  it('não exige adjacência, mas exige a mesma legalidade', () => {
    // Quem chega não está neste mundo ainda: `world()` nasce vazio, e a posição que o herói
    // carrega é de onde ele estava antes. Distância nenhuma importa — só o tile de destino.
    const hero = at(1, 1);
    const w = world();
    expect(place(w, hero, to(4, 3))).toBeNull();
    expect(hero.position).toEqual({ x: 4, y: 3, z: 7 });
    expect(w.occupied(4, 3)).toBe(true);
  });

  it('recusa nascer dentro de parede, e não mexe em nada', () => {
    // `(0,0)` é a borda de QUALQUER tilemap, bloqueada por construção. O defeito era colocação
    // sem legalidade nenhuma: um espaço reservado que ninguém olhava, e que passava a importar
    // assim que alguém validasse posição.
    const novo = at(1, 1);
    const w = world(novo);
    expect(place(w, novo, to(0, 0))).toBe('tile-blocked');
    expect(novo.position).toEqual({ x: 1, y: 1, z: 7 });
  });

  it('NÃO libera o tile da posição anterior, que pode ser de outro mundo (FUN-72)', () => {
    // `place` é ENTRADA no mundo. A posição que o mover traz vem de outra sessão, de outro
    // mapa, ou de um valor que nunca foi ocupado aqui — liberá-la é liberar um tile que
    // pertence a outra criatura desta instância, e aí duas acabam no mesmo lugar. É o estado
    // que o commit atômico do `move` existe para impedir, entrando pela porta dos fundos.
    const morador = at(2, 1);
    const w = world(morador);
    // O recém-chegado traz `(2,1)` de onde estava antes — coincidência de coordenada entre
    // dois mapas diferentes, que é o caso normal e não o raro.
    const chegando = at(2, 1);

    expect(place(w, chegando, to(3, 3))).toBeNull();

    expect(chegando.position).toEqual({ x: 3, y: 3, z: 7 });
    // O tile do morador continua ocupado — ele não saiu de lugar nenhum.
    expect(w.occupied(2, 1)).toBe(true);
    expect(w.occupied(3, 3)).toBe(true);
  });

  it('recusa nascer em cima de quem já está lá', () => {
    const primeiro = at(3, 1);
    const segundo = at(1, 1);
    expect(place(world(primeiro, segundo), segundo, to(3, 1))).toBe('tile-occupied');
  });
});

describe('TileOccupancy', () => {
  it('reset ignora os mortos, que não ocupam lugar', () => {
    const w = new TileOccupancy(map);
    w.reset([at(1, 1), { ...at(2, 1), alive: false }]);
    expect(w.occupied(1, 1)).toBe(true);
    expect(w.occupied(2, 1)).toBe(false);
  });
});

describe('tilesAround', () => {
  it('walks outward from the centre, in a fixed order', () => {
    // Ordem fixa é o que torna a posição reproduzível: sem isso, dois servidores com o mesmo
    // snapshot desenhariam mapas diferentes.
    const tiles = [...tilesAround({ x: 0, y: 0, z: 7 }, 1)];
    expect(tiles[0]).toEqual({ x: 0, y: 0, z: 7 });
    expect(tiles).toHaveLength(9);
    expect([...tilesAround({ x: 0, y: 0, z: 7 }, 1)]).toEqual(tiles);
  });
});

describe('placeNear (FUN-71)', () => {
  it('usa o tile pedido quando ele está livre', () => {
    const world = new TileOccupancy(map);
    const mover = at(3, 3);
    expect(placeNear(world, mover, to(1, 1), 2)).toBeNull();
    expect(mover.position).toEqual(to(1, 1));
  });

  it('desvia para o mais PRÓXIMO quando o pedido está ocupado', () => {
    // É o caso da praça compartilhada: o segundo a chegar encontra o primeiro no ponto de
    // entrada. Um `place` seco recusaria, e o personagem ficaria fora do mapa — invisível,
    // parado, com o log dizendo que ele entrou.
    const world = new TileOccupancy(map);
    const primeiro = at(3, 3);
    place(world, primeiro, to(1, 1));

    const segundo = at(3, 3);
    expect(placeNear(world, segundo, to(1, 1), 2)).toBeNull();
    expect(segundo.position).not.toEqual(to(1, 1));
    // Anel 1 em volta de (1,1): dentro da sala, e nunca em cima de quem já estava lá.
    expect(Math.max(
      Math.abs(segundo.position.x - 1), Math.abs(segundo.position.y - 1),
    )).toBe(1);
    expect(world.occupied(1, 1)).toBe(true);
  });

  it('não pisa em parede ao desviar', () => {
    // (2,2) é parede. Procurar tile livre não pode virar "qualquer coordenada serve".
    const world = new TileOccupancy(map);
    const ocupante = at(3, 3);
    place(world, ocupante, to(2, 1));

    // Anel 1 em volta de (2,1): a linha de cima é toda parede, (2,2) é a parede do meio, e o
    // primeiro livre na ordem fixa é (1,1).
    const chegando = at(3, 3);
    expect(placeNear(world, chegando, to(2, 1), 1)).toBeNull();
    expect(chegando.position).toEqual(to(1, 1));
  });

  it('devolve a recusa quando o anel inteiro está cheio', () => {
    // A praça cheia. Quem chama decide o que fazer — e o teto de população é da FUN-33.
    const world = new TileOccupancy(map);
    for (const tile of tilesAround(to(1, 1), 1)) place(world, at(3, 3), tile);

    const chegando = at(3, 3);
    expect(placeNear(world, chegando, to(1, 1), 1)).not.toBeNull();
  });
});

describe('placeReachable (FUN-120)', () => {
  // Duas salas separadas por uma parede, ligadas por um corredor que dá a volta por baixo. A
  // entrada E é na sala da esquerda; a da direita está a dois tiles em linha reta — e a doze
  // a pé.
  //
  //     0 1 2 3 4 5 6
  //   0 # # # # # # #
  //   1 # . . # . . #
  //   2 # . E # . . #
  //   3 # . . # . . #
  //   4 # . # # # . #
  //   5 # . . . . . #
  //   6 # # # # # # #
  const temple = buildTilemap({
    id: 'templo', z: 7,
    grid: ['#######', '#..#..#', '#..#..#', '#..#..#', '#.###.#', '#.....#', '#######'],
  });
  const entry = to(2, 2);
  const leftRoom = [to(1, 1), to(2, 1), to(1, 2), to(2, 2), to(1, 3), to(2, 3)];

  it('usa o tile pedido quando ele está livre', () => {
    const world = new TileOccupancy(temple);
    const mover = at(5, 5);
    expect(placeReachable(world, mover, entry, 100)).toBeNull();
    expect(mover.position).toEqual(entry);
  });

  it('com a sala lotada, fica no primeiro tile livre A PÉ — nunca do outro lado da parede', () => {
    const world = new TileOccupancy(temple);
    for (const tile of leftRoom) expect(place(world, at(5, 5), tile)).toBeNull();

    // O anel geométrico atravessa a parede: a dois tiles de E está (4,1), na sala da direita.
    const pelaParede = at(5, 5);
    expect(placeNear(world, pelaParede, entry, 2)).toBeNull();
    expect(pelaParede.position).toEqual(to(4, 1));
    world.vacate(4, 1);

    // A pé, o primeiro livre é a boca do corredor.
    const chegando = at(5, 5);
    expect(placeReachable(world, chegando, entry, 100)).toBeNull();
    expect(chegando.position).toEqual(to(1, 4));
    expect(world.occupied(1, 4)).toBe(true);
  });

  it('tenta o tile pedido mesmo com `limit` zero, como `placeNear` sempre tenta o centro', () => {
    const world = new TileOccupancy(temple);
    const mover = at(5, 5);
    expect(placeReachable(world, mover, entry, 0)).toBeNull();
    expect(mover.position).toEqual(entry);
  });

  it('desiste depois de visitar `limit` tiles, e devolve a última recusa', () => {
    const world = new TileOccupancy(temple);
    for (const tile of leftRoom) place(world, at(5, 5), tile);
    const chegando = at(5, 5);
    // Seis tiles visitados, os seis ocupados: o sétimo, livre, fica fora do teto.
    expect(placeReachable(world, chegando, entry, 6)).toBe('tile-occupied');
    expect(chegando.position).toEqual(to(5, 5));
  });

  it('não sobe escada para procurar lugar: ela leva a outro andar', () => {
    // Um degrau ao lado da entrada, e mais nada. Com a entrada ocupada, o único vizinho é a
    // escada — e colocar alguém nela seria colocá-lo no andar de cima.
    const stairs = buildTilemap({
      id: 'degrau', z: 7,
      floors: { '7': { grid: ['####', '#..#', '####'] }, '6': { grid: ['####', '#..#', '####'] } },
      floorChanges: [{ from: { x: 2, y: 1, z: 7 }, to: { x: 2, y: 1, z: 6 } }],
    });
    const world = new TileOccupancy(stairs);
    place(world, at(1, 1), to(1, 1));
    const chegando = at(1, 1);
    expect(placeReachable(world, chegando, to(1, 1), 100)).toBe('tile-occupied');
  });
});
