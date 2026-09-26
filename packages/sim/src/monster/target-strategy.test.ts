// `rankTarget` isolada (#541): cada peso sozinho escolhe o critério esperado, o desempate
// segue o `monster_targeting.cpp` (estrito, primeiro candidato da lista vence o empate), e a
// mistura 70/10/10/10 do Dragon cai dentro da banda esperada num número grande de sorteios.
// `monster.test.ts` cobre a FIAÇÃO com `chooseTarget`; aqui é só a função pura.

import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { rankTarget, type TargetRankCandidate } from './target-strategy.js';

/** Uma instância de `Rng` que conta quantas vezes cada sorteio foi consultado (#541). */
class CountingRng extends Rng {
  integerCalls = 0;

  override integer(min: number, max: number): number {
    this.integerCalls++;
    return super.integer(min, max);
  }
}

const candidate = (id: string, over: Partial<TargetRankCandidate> = {}): TargetRankCandidate =>
  ({ id, distance: 5, health: 100, damage: 0, ...over });

describe('rankTarget: cada peso isolado (#541)', () => {
  it('nearest (100): escolhe o candidato mais perto', () => {
    const strategy = { nearest: 100, health: 0, damage: 0, random: 0 };
    const candidates = [candidate('far', { distance: 9 }), candidate('near', { distance: 1 })];
    expect(rankTarget(strategy, candidates, Rng.fromSeed('a'))).toBe('near');
  });

  it('nearest (100): empate na distância fica com quem aparece PRIMEIRO na lista', () => {
    // O mesmo desempate do `monster_targeting.cpp`: a comparação é ESTRITA (`<`), então o
    // primeiro candidato com o valor vencedor não é substituído por um empate — nunca sorteado.
    const strategy = { nearest: 100, health: 0, damage: 0, random: 0 };
    const candidates = [candidate('first', { distance: 3 }), candidate('second', { distance: 3 })];
    expect(rankTarget(strategy, candidates, Rng.fromSeed('a'))).toBe('first');
  });

  it('health (100): escolhe quem tem menos vida, mesmo mais longe', () => {
    const strategy = { nearest: 0, health: 100, damage: 0, random: 0 };
    const candidates = [
      candidate('healthy', { distance: 1, health: 900 }),
      candidate('wounded', { distance: 9, health: 3 }),
    ];
    expect(rankTarget(strategy, candidates, Rng.fromSeed('a'))).toBe('wounded');
  });

  it('health (100): empate fica com quem aparece primeiro', () => {
    const strategy = { nearest: 0, health: 100, damage: 0, random: 0 };
    const candidates = [candidate('first', { health: 50 }), candidate('second', { health: 50 })];
    expect(rankTarget(strategy, candidates, Rng.fromSeed('a'))).toBe('first');
  });

  it('damage (100): escolhe quem causou mais dano NO monstro', () => {
    const strategy = { nearest: 0, health: 0, damage: 100, random: 0 };
    const candidates = [
      candidate('poker', { damage: 5 }),
      candidate('big-hitter', { damage: 40 }),
    ];
    expect(rankTarget(strategy, candidates, Rng.fromSeed('a'))).toBe('big-hitter');
  });

  it('damage (100): ninguém bateu ainda (todos em zero) — cai no primeiro, como o Canary sem `hasDamage`', () => {
    // `Contribution.record` nunca guarda golpe de dano zero (`death.ts`), então "zero" e
    // "nunca bateu" são a MESMA coisa — o Canary trata os dois igual: sem ninguém com dano
    // registrado, `selected` fica no `front()` da lista.
    const strategy = { nearest: 0, health: 0, damage: 100, random: 0 };
    const candidates = [candidate('first'), candidate('second')];
    expect(rankTarget(strategy, candidates, Rng.fromSeed('a'))).toBe('first');
  });

  it('damage (100): empate em dano positivo também fica com quem aparece primeiro', () => {
    const strategy = { nearest: 0, health: 0, damage: 100, random: 0 };
    const candidates = [candidate('first', { damage: 20 }), candidate('second', { damage: 20 })];
    expect(rankTarget(strategy, candidates, Rng.fromSeed('a'))).toBe('first');
  });

  it('random (100): candidato único não sorteia entre nada', () => {
    const strategy = { nearest: 0, health: 0, damage: 0, random: 100 };
    expect(rankTarget(strategy, [candidate('only')], Rng.fromSeed('a'))).toBe('only');
  });

  it('random (100): varia entre os candidatos ao longo de vários sorteios — não é sempre o primeiro', () => {
    const strategy = { nearest: 0, health: 0, damage: 0, random: 100 };
    const candidates = [candidate('a'), candidate('b'), candidate('c'), candidate('d')];
    const rng = Rng.fromSeed('random-strategy-varies');
    const picked = new Set<string>();
    for (let i = 0; i < 100; i++) picked.add(rankTarget(strategy, candidates, rng));
    // 100 sorteios uniformes entre 4 candidatos: a chance de nunca variar é desprezível — isto
    // prova que o segundo sorteio (o desempate aleatório) está de fato acontecendo, não é uma
    // ilusão de sempre devolver o primeiro.
    expect(picked.size).toBeGreaterThan(1);
  });
});

describe('rankTarget: ordem fixa de consumo do RNG (#541)', () => {
  it('nearest/health/damage consomem EXATAMENTE um sorteio — o desempate não sorteia', () => {
    const candidates = [candidate('a', { distance: 1, health: 10, damage: 5 }), candidate('b', { distance: 2, health: 20, damage: 1 })];
    for (const strategy of [
      { nearest: 100, health: 0, damage: 0, random: 0 },
      { nearest: 0, health: 100, damage: 0, random: 0 },
      { nearest: 0, health: 0, damage: 100, random: 0 },
    ]) {
      const rng = new CountingRng(Rng.fromSeed('order').getState());
      rankTarget(strategy, candidates, rng);
      expect(rng.integerCalls).toBe(1);
    }
  });

  it('random consome DOIS sorteios — o critério e o desempate entre candidatos', () => {
    const strategy = { nearest: 0, health: 0, damage: 0, random: 100 };
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const rng = new CountingRng(Rng.fromSeed('order').getState());
    rankTarget(strategy, candidates, rng);
    expect(rng.integerCalls).toBe(2);
  });

  it('candidato único em `random` ainda assim sorteia o critério — só não sorteia o desempate', () => {
    // `rng.integer(0, 0)` é um sorteio de verdade (consome o gerador), mesmo devolvendo sempre
    // o mesmo índice — a sequência não pode depender de haver um candidato só ou vários.
    const strategy = { nearest: 0, health: 0, damage: 0, random: 100 };
    const rng = new CountingRng(Rng.fromSeed('order').getState());
    rankTarget(strategy, [candidate('only')], rng);
    expect(rng.integerCalls).toBe(2);
  });
});

describe('rankTarget: a mistura do Dragon, 70/10/10/10 (#541)', () => {
  // Quatro candidatos onde CADA critério determinístico (nearest/health/damage) tem um
  // vencedor ÚNICO e diferente — e um quarto, `filler`, que nenhum dos três jamais escolhe:
  // só o critério `random` pode alcançá-lo. A frequência dele isola a fatia de `random` da
  // mistura sem precisar instrumentar `rankTarget` por dentro.
  const strategy = { nearest: 70, health: 10, damage: 10, random: 10 };
  const candidates = [
    candidate('nearest-winner', { distance: 1, health: 900, damage: 0 }),
    candidate('health-winner', { distance: 9, health: 3, damage: 0 }),
    candidate('damage-winner', { distance: 9, health: 900, damage: 50 }),
    candidate('filler', { distance: 9, health: 900, damage: 0 }),
  ];

  it('ao longo de 2000 sorteios, cada critério aparece perto do peso declarado', () => {
    const rng = Rng.fromSeed('dragon-distribution');
    const counts = { 'nearest-winner': 0, 'health-winner': 0, 'damage-winner': 0, filler: 0 };
    const total = 2000;
    for (let i = 0; i < total; i++) {
      const winner = rankTarget(strategy, candidates, rng) as keyof typeof counts;
      counts[winner]++;
    }

    // `nearest-winner` recebe TODO sorteio de `nearest` (70 %) mais 1/4 dos de `random`
    // (10 % × 25 % = 2,5 %) — esperado ~1 450 de 2 000. Banda generosa (~3 desvios-padrão do
    // binomial), como as janelas de frequência do Dragon em `hunt.test.ts`.
    expect(counts['nearest-winner']).toBeGreaterThan(1300);
    expect(counts['nearest-winner']).toBeLessThan(1600);

    // `health-winner` e `damage-winner`: 10 % cada mais a mesma fatia de `random` — esperado
    // ~225 de 2 000.
    expect(counts['health-winner']).toBeGreaterThan(150);
    expect(counts['health-winner']).toBeLessThan(320);
    expect(counts['damage-winner']).toBeGreaterThan(150);
    expect(counts['damage-winner']).toBeLessThan(320);

    // `filler` SÓ existe no resultado quando o critério sorteado é `random` E o desempate
    // aleatório cai nele — 10 % × 25 % = 2,5 %, esperado ~50 de 2 000. É a prova de que
    // `random` está de fato rodando dentro da mistura, não só nos testes isolados acima.
    expect(counts.filler).toBeGreaterThan(10);
    expect(counts.filler).toBeLessThan(110);

    expect(
      counts['nearest-winner'] + counts['health-winner'] + counts['damage-winner'] + counts.filler,
    ).toBe(total);
  });
});
