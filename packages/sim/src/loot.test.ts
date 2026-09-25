import { describe, expect, it } from 'vitest';
import type { LootTable } from '@draconya/content';
import { rollLoot } from './loot.js';
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
});
