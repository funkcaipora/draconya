import { buildTilemap } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { MovementSystem, movementDuration } from './system.js';
import type { Movable, MoveRefusal } from './system.js';

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
const at = (x: number, y: number): Movable<Ponto> => ({ alive: true, position: { x, y, z: 7 } });
const dead = (x: number, y: number): Movable<Ponto> => ({ alive: false, position: { x, y, z: 7 } });
const to = (x: number, y: number): Ponto => ({ x, y, z: 7 });

const refusalOf = (system: MovementSystem, creature: Movable<Ponto>, x: number, y: number): MoveRefusal | 'ok' => {
  const outcome = system.move(creature, to(x, y), { creatureId: 'c', durationMs: 100 });
  return outcome.ok ? 'ok' : outcome.refusal;
};

describe('legalidade de tile', () => {
  // A tabela de casos que a FUN-69 pede. Cada linha é uma razão de recusa distinta, e a razão
  // importa: ela é a MESMA que o `walk` do socket vai receber, e "não deu" não diz a ninguém o
  // que fazer em seguida.
  it('percorre a tabela de casos, e cada recusa tem sua própria razão', () => {
    const system = new MovementSystem(map);
    const hero = at(2, 1);
    system.reset([hero]);

    expect(refusalOf(system, hero, 2, 1)).toBe('same-tile');
    expect(refusalOf(system, hero, 2, 3)).toBe('not-adjacent');
    expect(refusalOf(system, hero, 2, 0)).toBe('blocked-tile');
    expect(refusalOf(system, hero, 2, 2)).toBe('blocked-tile');
    expect(refusalOf(system, hero, 1, 1)).toBe('ok');
  });

  it('separa "fora do mapa" de "parede", porque as duas pedem coisas diferentes', () => {
    // O tilemap devolve `true` para as duas — fora dos limites é bloqueado por construção. Um
    // jogador que ouve "parede" tenta outra direção; quem ouve "fora do mapa" está errado sobre
    // a geometria, e é o cliente que precisa saber disso.
    const system = new MovementSystem(map);
    const naBorda = at(0, 0);
    system.reset([naBorda]);
    expect(refusalOf(system, naBorda, -1, 0)).toBe('out-of-bounds');
  });

  it('a diagonal é legal, e dois tiles não são', () => {
    // Adjacência de rei: ADR 0009 deixa o passo guloso usar as oito direções, então a diagonal
    // precisa passar. Duas casas na mesma direção, não.
    const system = new MovementSystem(map);
    const hero = at(1, 1);
    system.reset([hero]);
    expect(refusalOf(system, hero, 3, 1)).toBe('not-adjacent');
    expect(refusalOf(system, hero, 2, 2)).toBe('blocked-tile'); // a parede da sala
    // A diagonal livre: de (1,1) para (2,2) é parede, mas de (1,3) para (2,2) também — o
    // caminho diagonal que sobra nesta sala é (3,1) → (4,2).
    const outro = at(3, 1);
    system.reset([outro]);
    expect(refusalOf(system, outro, 4, 2)).toBe('ok');
  });

  it('recusa entrar em cima de outra criatura', () => {
    const system = new MovementSystem(map);
    const hero = at(1, 1);
    const rato = at(2, 1);
    system.reset([hero, rato]);
    expect(refusalOf(system, hero, 2, 1)).toBe('occupied');
    // E o tile de onde ELE mesmo está saindo não conta como ocupado por outro.
    expect(refusalOf(system, hero, 1, 2)).toBe('ok');
  });

  it('morto não anda', () => {
    const system = new MovementSystem(map);
    const caido = dead(1, 1);
    system.reset([caido]);
    expect(refusalOf(system, caido, 2, 1)).toBe('dead');
  });

  it('consultar não move nada', () => {
    // `validate` é o `queryAdd` do §8: responde sem tocar em estado. Se ele mexesse, um
    // caminho que só pergunta — o passo guloso avaliando vizinhos — moveria por engano.
    const system = new MovementSystem(map);
    const hero = at(1, 1);
    system.reset([hero]);
    expect(system.validate(hero, to(2, 1)).ok).toBe(true);
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });
    expect(system.occupantAt(2, 1)).toBeNull();
  });
});

describe('commit', () => {
  it('move, e a ocupação acompanha nos dois tiles', () => {
    const system = new MovementSystem(map);
    const hero = at(1, 1);
    system.reset([hero]);

    const outcome = system.move(hero, to(2, 1), { creatureId: 'hero', durationMs: 500 });
    if (!outcome.ok) throw new Error(`esperava mover, veio ${outcome.refusal}`);

    expect(hero.position).toEqual({ x: 2, y: 1, z: 7 });
    expect(system.occupantAt(1, 1)).toBeNull();
    expect(system.occupantAt(2, 1)).toBe(hero);
  });

  it('devolve o evento de domínio, com origem, destino e duração', () => {
    // O evento é DEVOLVIDO, não emitido daqui: quem sabe para onde ele vai é o ruleset. E ele
    // existe haja ou não alguém olhando (§12) — o que muda com viewer é quem serializa.
    const system = new MovementSystem(map);
    const hero = at(1, 1);
    system.reset([hero]);

    const outcome = system.move(hero, to(1, 2), { creatureId: 'hero', durationMs: 500 });
    expect(outcome.ok && outcome.event).toEqual({
      type: 'creature-moved',
      creatureId: 'hero',
      from: { x: 1, y: 1, z: 7 },
      to: { x: 1, y: 2, z: 7 },
      durationMs: 500,
    });
  });

  it('uma recusa não mexe em nada — nem posição, nem ocupação', () => {
    const system = new MovementSystem(map);
    const hero = at(1, 1);
    const rato = at(2, 1);
    system.reset([hero, rato]);

    expect(system.move(hero, to(2, 1), { creatureId: 'hero', durationMs: 500 }).ok).toBe(false);
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });
    expect(system.occupantAt(1, 1)).toBe(hero);
    expect(system.occupantAt(2, 1)).toBe(rato);
  });

  it('duas criaturas nunca acabam no mesmo tile, em nenhuma ordem', () => {
    // O commit atômico existe para isto: não há instante em que a criatura esteja em dois
    // tiles ou em nenhum, então não há janela em que a segunda ache o destino livre.
    const system = new MovementSystem(map);
    const a = at(1, 1);
    const b = at(1, 3);
    system.reset([a, b]);

    expect(system.move(a, to(1, 2), { creatureId: 'a', durationMs: 100 }).ok).toBe(true);
    expect(system.move(b, to(1, 2), { creatureId: 'b', durationMs: 100 }).ok).toBe(false);
    expect(a.position).toEqual({ x: 1, y: 2, z: 7 });
    expect(b.position).toEqual({ x: 1, y: 3, z: 7 });
  });
});

describe('colocação', () => {
  it('não exige adjacência, mas exige a mesma legalidade', () => {
    // Nascer, entrar numa hunt, reentrar na rota. A distância não importa; o tile importa.
    const system = new MovementSystem(map);
    const hero = at(1, 1);
    system.reset([hero]);
    expect(system.place(hero, to(4, 3), { creatureId: 'hero' }).ok).toBe(true);
    expect(hero.position).toEqual({ x: 4, y: 3, z: 7 });
  });

  it('recusa nascer dentro de parede — é a FUN-60', () => {
    // `(0,0)` é a borda de QUALQUER tilemap, e a borda é bloqueada por construção. O defeito
    // era colocação sem legalidade nenhuma: o valor era um espaço reservado que ninguém olhava,
    // e passava a importar assim que alguém validasse posição.
    const system = new MovementSystem(map);
    const novo = at(1, 1);
    system.reset([novo]);
    const outcome = system.place(novo, to(0, 0), { creatureId: 'novo' });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.refusal).toBe('blocked-tile');
    // E não moveu: recusar é deixar como estava.
    expect(novo.position).toEqual({ x: 1, y: 1, z: 7 });
  });

  it('recusa nascer em cima de quem já está lá', () => {
    const system = new MovementSystem(map);
    const primeiro = at(3, 1);
    const segundo = at(1, 1);
    system.reset([primeiro, segundo]);
    expect(system.place(segundo, to(3, 1), { creatureId: 's' }).ok).toBe(false);
  });
});

describe('ocupação', () => {
  it('remove libera o tile', () => {
    const system = new MovementSystem(map);
    const rato = at(2, 1);
    system.reset([rato]);
    system.remove(rato);
    expect(system.occupantAt(2, 1)).toBeNull();
  });

  it('reset ignora os mortos, que não ocupam lugar', () => {
    const system = new MovementSystem(map);
    system.reset([at(1, 1), dead(2, 1)]);
    expect(system.occupantAt(1, 1)).not.toBeNull();
    expect(system.occupantAt(2, 1)).toBeNull();
  });

  it('firstFree devolve o primeiro livre na ordem dada, e null quando não há', () => {
    // Ordem FIXA é o que torna a posição reproduzível: sem isso, dois nós com o mesmo snapshot
    // desenhariam mapas diferentes.
    const system = new MovementSystem(map);
    const rato = at(1, 1);
    system.reset([rato]);
    expect(system.firstFree([to(1, 1), to(2, 2), to(3, 1)])).toEqual(to(3, 1));
    expect(system.firstFree([to(0, 0), to(2, 2)])).toBeNull();
    // Quem se move não bloqueia a si mesmo.
    expect(system.firstFree([to(1, 1)], rato)).toEqual(to(1, 1));
  });
});

describe('tipo do ponto', () => {
  it('o `z` de quem o tem sobrevive ao commit', () => {
    // O monstro vive num mapa de um andar só e não carrega `z`; o personagem carrega, porque
    // ele atravessa protocolo e banco. Um sistema que forçasse um formato apagaria o `z` de um
    // ou inventaria para o outro — e transição de andar é não-objetivo declarado da FUN-69.
    const system = new MovementSystem(map);
    const hero = at(1, 1);
    system.reset([hero]);
    system.move(hero, to(2, 1), { creatureId: 'hero', durationMs: 100 });
    expect(hero.position.z).toBe(7);
  });

  it('convive com criatura sem `z` no mesmo mapa', () => {
    // Personagem e monstro dividem a instância e o índice de ocupação, com formatos de ponto
    // diferentes. É o caso real da hunt.
    const system = new MovementSystem(map);
    const hero = at(1, 1);
    const rato: Movable<{ x: number; y: number }> = { alive: true, position: { x: 2, y: 1 } };
    system.reset([hero, rato]);
    expect(system.move(rato, { x: 3, y: 1 }, { creatureId: 'm:1', durationMs: 500 }).ok).toBe(true);
    expect(system.move(hero, to(2, 1), { creatureId: 'hero', durationMs: 500 }).ok).toBe(true);
    expect(system.occupantAt(2, 1)).toBe(hero);
    expect(system.occupantAt(3, 1)).toBe(rato);
  });
});

describe('movementDuration', () => {
  it('é uma função só, para humano, bot, monstro e auto-walk', () => {
    // §10.1. Hoje a diagonal custa o mesmo que a reta; quando isso mudar, muda aqui e em mais
    // lugar nenhum — que é o ponto de ela existir.
    expect(movementDuration(500, to(1, 1), to(2, 1))).toBe(500);
    expect(movementDuration(500, to(1, 1), to(2, 2))).toBe(500);
  });
});
