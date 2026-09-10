import { buildTilemap } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { TileOccupancy, canOccupy, move, movementDuration, place } from './movement.js';
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
  ({ alive: true, position: { x, y, z: 7 }, stepDurationMs: 500 });
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
    const rato: Movable<{ x: number; y: number }> = { position: { x: 2, y: 1 }, stepDurationMs: 300 };
    const w = new TileOccupancy(map);
    w.reset([hero, { ...rato, alive: true }]);
    expect(move(w, rato, { x: 3, y: 1 }).ok).toBe(true);
    expect(move(w, hero, to(2, 1)).ok).toBe(true);
    expect(hero.position.z).toBe(7);
    expect(w.occupied(3, 1)).toBe(true);
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

describe('movementDuration', () => {
  it('é uma função só, para humano, bot, monstro e auto-walk', () => {
    // §10.1. Hoje a diagonal custa o mesmo que a reta; quando isso mudar, muda aqui e em mais
    // lugar nenhum — que é o ponto de ela existir.
    const mover = at(1, 1);
    expect(movementDuration(mover, to(1, 1), to(2, 1))).toBe(500);
    expect(movementDuration(mover, to(1, 1), to(2, 2))).toBe(500);
  });
});
