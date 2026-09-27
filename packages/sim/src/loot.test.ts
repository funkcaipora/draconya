import { describe, expect, it, vi } from 'vitest';
import type { LootTable } from '@draconya/content';
import { CANARY_LOOT_CHANCE_SCALE, rollLoot } from './loot.js';
import { Rng } from './rng.js';

const table = (over: Partial<LootTable> = {}): LootTable => ({ items: [], ...over });

describe('rollLoot', () => {
  it('chance zero nunca cai; chance um sempre cai', () => {
    // Os extremos pegam o sorteio invertido, ou um `>=` no lugar de `<`.
    const never = table({ gold: { chance: 0, min: 1, max: 4 } });
    const always = table({ gold: { chance: 1, min: 1, max: 4 } });
    const rng = Rng.fromSeed('loot');
    for (let i = 0; i < 200; i++) {
      expect(rollLoot(never, rng).gold).toBe(0);
      expect(rollLoot(always, rng).gold).toBeGreaterThanOrEqual(1);
    }
  });

  it('min igual a max dá quantidade fixa, dentro do intervalo quando difere', () => {
    const rng = Rng.fromSeed('loot');
    expect(rollLoot(table({ gold: { chance: 1, min: 3, max: 3 } }), rng).gold).toBe(3);
    for (let i = 0; i < 100; i++) {
      const gold = rollLoot(table({ gold: { chance: 1, min: 2, max: 5 } }), rng).gold;
      expect(gold).toBeGreaterThanOrEqual(2);
      expect(gold).toBeLessThanOrEqual(5);
    }
  });

  it('tabela vazia é zero e nada, não erro', () => {
    expect(rollLoot(table(), Rng.fromSeed('loot')))
      .toEqual({ gold: 0, items: [], supplies: [], ammunition: [] });
  });

  it('a mesma semente produz a mesma sequência', () => {
    // `Math.random` entrando por descuido é o que este teste pega: sem o `Rng` da sessão, uma
    // hunt retomada continua com outra sequência, e "por que não caiu" deixa de ser
    // investigável.
    const t = table({ gold: { chance: 0.5, min: 1, max: 10 } });
    const a = Rng.fromSeed('same');
    const b = Rng.fromSeed('same');
    const sequence = (rng: Rng) => Array.from({ length: 50 }, () => rollLoot(t, rng).gold);
    expect(sequence(a)).toEqual(sequence(b));
  });

  it('uma linha com chance zero NÃO desloca a sequência das outras (DT-05)', () => {
    // Semente é contrato: desabilitar uma linha da tabela não pode mudar o que as outras
    // rendem para toda semente já gravada.
    const withDisabled = table({
      gold: { chance: 0.5, min: 1, max: 10 },
      items: [{ itemId: 'nothing', chance: 0, min: 1, max: 1 }],
    });
    const without = table({ gold: { chance: 0.5, min: 1, max: 10 } });
    const a = Rng.fromSeed('shift');
    const b = Rng.fromSeed('shift');
    for (let i = 0; i < 50; i++) {
      expect(rollLoot(withDisabled, a).gold).toBe(rollLoot(without, b).gold);
    }
    expect(a.getState()).toEqual(b.getState());
  });

  it('sorteia gold antes dos itens, na ordem da tabela', () => {
    // A ordem é contrato pela mesma razão da semente. O `Rng` é consumido por linha que
    // sorteia, e trocar a ordem trocaria o resultado de cada uma.
    const rng = Rng.fromSeed('order');
    const result = rollLoot(table({
      gold: { chance: 1, min: 7, max: 7 },
      items: [
        { itemId: 'first', chance: 1, min: 2, max: 2 },
        { itemId: 'second', chance: 1, min: 1, max: 1 },
      ],
    }), rng);
    expect(result).toEqual({
      gold: 7,
      items: [{ itemId: 'first', quantity: 2 }, { itemId: 'second', quantity: 1 }],
      supplies: [],
      ammunition: [],
    });
  });

  it('supplyId cai em `supplies`, separado de `items`, na ordem de sorteio da tabela (#520)', () => {
    // A linha de supply consome sorteio na mesma posição que ocuparia se fosse item — só o
    // BALDE de destino muda, não a sequência. Intercalar item e supply na tabela prova que a
    // separação acontece DEPOIS do sorteio, não antes.
    const rng = Rng.fromSeed('supply');
    const result = rollLoot(table({
      items: [
        { itemId: 'dragon-ham', chance: 1, min: 1, max: 1 },
        { supplyId: 'strong-health-potion', chance: 1, min: 2, max: 2 },
        { itemId: 'small-diamond', chance: 1, min: 1, max: 1 },
      ],
    }), rng);
    expect(result).toEqual({
      gold: 0,
      items: [
        { itemId: 'dragon-ham', quantity: 1 },
        { itemId: 'small-diamond', quantity: 1 },
      ],
      supplies: [{ supplyId: 'strong-health-potion', quantity: 2 }],
      ammunition: [],
    });
  });

  it('ammunitionId cai em `ammunition`, separado de `items` e `supplies` (#520, revisão do #536)', () => {
    // Munição física (Burst Arrow, Power Bolt) é a TERCEIRA alternativa da linha — mesma regra
    // de posição/sorteio do supply, balde diferente.
    const rng = Rng.fromSeed('ammo');
    const result = rollLoot(table({
      items: [
        { itemId: 'dragon-ham', chance: 1, min: 1, max: 1 },
        { ammunitionId: 'burst-arrow', chance: 1, min: 1, max: 10 },
        { supplyId: 'strong-health-potion', chance: 1, min: 1, max: 1 },
      ],
    }), rng);
    expect(result.gold).toBe(0);
    expect(result.items).toEqual([{ itemId: 'dragon-ham', quantity: 1 }]);
    expect(result.supplies).toEqual([{ supplyId: 'strong-health-potion', quantity: 1 }]);
    expect(result.ammunition).toHaveLength(1);
    expect(result.ammunition[0]?.ammunitionId).toBe('burst-arrow');
    expect(result.ammunition[0]?.quantity).toBeGreaterThanOrEqual(1);
    expect(result.ammunition[0]?.quantity).toBeLessThanOrEqual(10);
  });

  describe('rate de loot (#691)', () => {
    const rich = table({
      gold: { chance: 0.5, min: 1, max: 10 },
      items: [{ itemId: 'sword', chance: 0.2, min: 1, max: 1 }, { itemId: 'shield', chance: 0.4, min: 1, max: 3 }],
    });

    it('rate 0 devolve o loot vazio SEM consumir sorteio', () => {
      const rng = Rng.fromSeed('off');
      const before = rng.getState();
      expect(rollLoot(rich, rng, 0)).toEqual({ gold: 0, items: [], supplies: [], ammunition: [] });
      expect(rng.getState()).toEqual(before);
    });

    it('rate 1 é o sorteio de hoje, com a mesma semente', () => {
      const a = Rng.fromSeed('same');
      const b = Rng.fromSeed('same');
      for (let i = 0; i < 50; i++) expect(rollLoot(rich, a, 1)).toEqual(rollLoot(rich, b));
      expect(a.getState()).toEqual(b.getState());
    });

    it('rate 3 triplica a chance de cada linha, com teto 1', () => {
      const rng = Rng.fromSeed('triple');
      const chance = vi.spyOn(rng, 'chance');
      rollLoot(rich, rng, 3);
      expect(chance.mock.calls.map(([probability]) => probability)).toEqual([1, 0.2 * 3, 1]);
    });

    it('rate entre 0 e 1 age como 1 (`max(1, rate)` do Canary)', () => {
      const rng = Rng.fromSeed('half');
      const chance = vi.spyOn(rng, 'chance');
      rollLoot(rich, rng, 0.5);
      expect(chance.mock.calls.map(([probability]) => probability)).toEqual([0.5, 0.2, 0.4]);
    });
  });
});

/** Conta cada `next()` — todo sorteio do `Rng` passa por ele (`integer`, `chance`, `fraction`). */
class CountingRng extends Rng {
  draws = 0;
  override next(): number {
    this.draws++;
    return super.next();
  }
}

/** Devolve os inteiros roteirizados, na ordem: é o jeito de fixar fator e rolagem de uma linha. */
class ScriptedRng extends Rng {
  readonly #values: number[];
  constructor(values: readonly number[]) {
    super({ a: 1, b: 2, c: 3, d: 4 });
    this.#values = [...values];
  }
  override integer(min: number, max: number): number {
    const value = this.#values.shift();
    if (value === undefined) throw new Error('ScriptedRng: sorteio além do roteiro');
    if (value < min || value > max) throw new Error(`ScriptedRng: ${value} fora de [${min}, ${max}]`);
    return value;
  }
  override chance(): boolean {
    throw new Error('ScriptedRng: o modelo canary não usa rng.chance');
  }
  get remaining(): number {
    return this.#values.length;
  }
}

/**
 * O que a tabela sem `rollModel` rendia ANTES do #685, com a semente `fun63-regression` —
 * medido contra o `loot.ts` da base da PR. É o contrato FUN-63 (DT-05) congelado em números.
 */
const FUN63_REGRESSION = [[3, 3], [10, 0], [0, 1], [0, 0], [1, 0], [0, 3], [0, 0], [4, 0]];

const canary = (over: Partial<LootTable> = {}): LootTable => table({ rollModel: 'canary', ...over });

describe('rollLoot com rollModel canary (#685)', () => {
  it('consome exatamente dois sorteios por linha, inclusive a de chance zero', () => {
    // Pular a linha zerada daria 4; sortear a quantidade à parte daria 7 ou mais.
    const rng = new CountingRng(Rng.fromSeed('canary-count').getState());
    rollLoot(canary({
      gold: { chance: 0.5, min: 1, max: 10 },
      items: [
        { itemId: 'nothing', chance: 0, min: 1, max: 1 },
        { itemId: 'ham', chance: 1, min: 1, max: 3 },
      ],
    }), rng);
    expect(rng.draws).toBe(6);
  });

  it('uma linha "100 %" cai entre 98,0 % e 99,2 % das vezes (esperado ~98,6 %)', () => {
    // `rng.chance(1)` mediria 100 %: é o modelo FUN-63 vazando para a tabela canary.
    const t = canary({ gold: { chance: 1, min: 1, max: 1 } });
    const rng = Rng.fromSeed('canary-hundred');
    const kills = 100_000;
    let drops = 0;
    for (let i = 0; i < kills; i++) if (rollLoot(t, rng).gold > 0) drops++;
    expect(drops / kills).toBeGreaterThanOrEqual(0.98);
    expect(drops / kills).toBeLessThanOrEqual(0.992);
  });

  it('a quantidade sai da mesma rolagem que decidiu o drop', () => {
    // Fator 100 (1,0) e rolagem 1234 com chance 50000: cai, e 1234 % 10 + 1 = 5.
    const rng = new ScriptedRng([100, 1234]);
    expect(rollLoot(canary({ gold: { chance: 0.5, min: 1, max: 10 } }), rng).gold).toBe(5);
    expect(rng.remaining).toBe(0);
  });

  it('o fator vem antes e a comparação é estrita: fator 95 cai em 94999, não em 95000', () => {
    const line = canary({ items: [{ itemId: 'ham', chance: 1, min: 1, max: 1 }] });
    expect(rollLoot(line, new ScriptedRng([95, 94_999])).items).toEqual([{ itemId: 'ham', quantity: 1 }]);
    expect(rollLoot(line, new ScriptedRng([95, 95_000])).items).toEqual([]);
  });

  it('a rolagem inclui o extremo 100000: com fator 100 a linha "100 %" falha nele', () => {
    // 100000 × 1,05 = 105000 > 100000: com fator acima de 100 a linha "100 %" sempre cai;
    // com fator 100, a rolagem 100000 (o extremo incluso) não cai.
    const line = canary({ gold: { chance: 1, min: 1, max: 1 } });
    expect(rollLoot(line, new ScriptedRng([101, CANARY_LOOT_CHANCE_SCALE])).gold).toBe(1);
    expect(rollLoot(line, new ScriptedRng([100, CANARY_LOOT_CHANCE_SCALE])).gold).toBe(0);
  });

  it('min igual a max devolve min sem sorteio extra', () => {
    const rng = new ScriptedRng([100, 7]);
    expect(rollLoot(canary({ gold: { chance: 1, min: 3, max: 3 } }), rng).gold).toBe(3);
    expect(rng.remaining).toBe(0);
  });

  it('a mesma semente produz a mesma sequência', () => {
    const t = canary({
      gold: { chance: 0.7, min: 1, max: 30 },
      items: [{ supplyId: 'potion', chance: 0.3, min: 1, max: 4 }],
    });
    const run = (rng: Rng) => Array.from({ length: 50 }, () => rollLoot(t, rng));
    expect(run(Rng.fromSeed('canary-same'))).toEqual(run(Rng.fromSeed('canary-same')));
  });

  it('a tabela sem rollModel rende o mesmo de antes para a mesma semente (FUN-63 intocado)', () => {
    // Valores gravados antes do #685, com o `rollLine` de sempre: se o modelo padrão mudar,
    // toda semente já gravada muda junto.
    const t = table({
      gold: { chance: 0.5, min: 1, max: 10 },
      items: [{ itemId: 'ham', chance: 0.4, min: 1, max: 3 }],
    });
    const rng = Rng.fromSeed('fun63-regression');
    const sequence = Array.from({ length: 8 }, () => {
      const result = rollLoot(t, rng);
      return [result.gold, result.items[0]?.quantity ?? 0];
    });
    expect(sequence).toEqual(FUN63_REGRESSION);
  });
});

describe('rate de loot no modelo canary (#691 × #685)', () => {
  it('rate 1 é bit a bit o sorteio sem rate, com a mesma semente', () => {
    const t = canary({
      gold: { chance: 0.4, min: 1, max: 30 },
      items: [{ itemId: 'ham', chance: 0.2, min: 1, max: 4 }],
    });
    const run = (rng: Rng, rate?: number) => Array.from({ length: 200 }, () =>
      rate === undefined ? rollLoot(t, rng) : rollLoot(t, rng, rate));
    expect(run(Rng.fromSeed('canary-rate-1'), 1)).toEqual(run(Rng.fromSeed('canary-rate-1')));
  });

  it('o rate DIVIDE a rolagem, e a quantidade sai da rolagem já dividida', () => {
    // Fator 100, chance 30000, rolagem 50000: sem rate não cai; com rate 2 a rolagem vira 25000,
    // cai, e a quantidade é 25000 % 10 + 1 = 1 — não 50000 % 10 + 1, nem um sorteio novo.
    const t = canary({ gold: { chance: 0.3, min: 1, max: 10 } });
    expect(rollLoot(t, new ScriptedRng([100, 50_000])).gold).toBe(0);
    const rng = new ScriptedRng([100, 50_000]);
    expect(rollLoot(t, rng, 2).gold).toBe(1);
    expect(rng.remaining).toBe(0);
    // Rolagem fracionária (12345 / 2 = 6172,5): a contagem chega truncada, 6172,5 % 10 + 1 → 3.
    expect(rollLoot(t, new ScriptedRng([100, 12_345]), 2).gold).toBe(3);
  });

  it('rate 2 dobra a chance efetiva da linha', () => {
    const t = canary({ gold: { chance: 0.1, min: 1, max: 1 } });
    const kills = 100_000;
    const rate = (lootRate: number) => {
      const rng = Rng.fromSeed('canary-rate-2');
      let drops = 0;
      for (let i = 0; i < kills; i++) if (rollLoot(t, rng, lootRate).gold > 0) drops++;
      return drops / kills;
    };
    expect(rate(1)).toBeGreaterThan(0.095);
    expect(rate(1)).toBeLessThan(0.105);
    expect(rate(2)).toBeGreaterThan(0.195);
    expect(rate(2)).toBeLessThan(0.205);
  });

  it('continua consumindo exatamente dois sorteios por linha com rate > 1', () => {
    const rng = new CountingRng(Rng.fromSeed('canary-rate-count').getState());
    rollLoot(canary({
      gold: { chance: 0.5, min: 1, max: 10 },
      items: [{ itemId: 'ham', chance: 0, min: 1, max: 1 }],
    }), rng, 3);
    expect(rng.draws).toBe(4);
  });
});
