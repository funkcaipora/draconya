import { describe, expect, it } from 'vitest';
import type { Item } from '@draconya/content';
import {
  autoSellLimit, bagValue, canShareExperience, DEFAULT_SHARED_EXPERIENCE_RULES, reserveProportionally,
  settleEntries, shareCostsOf, sharedExperiencePercent, splitEqually, splitLootOf, uniqueVocations,
  xpByDamage, xpShare,
} from './party.js';
import type {
  BagEntry, GoldEntry, MemberCapacity, PartyBagState, PartyMember, SharedExperienceMember,
} from './party.js';

// As contas da party (#189, ADR 0027; fórmula e elegibilidade emendadas em 2026-09-24 e
// 2026-09-25, #525, pela fidelidade CANARY do ADR 0037 decisão 4 — não TFS: as duas engines
// divergem aqui, e o Canary manda em fórmula). O que se prende é a fórmula real do Canary
// (`Party:onShareExperience`/`Party::getUniqueVocationsCount`/`Party::canUseSharedExperience`)
// — e que nada consome RNG nem sai de inteiro.

const m = (id: string, vocationId: string | null = null): PartyMember => ({ id, vocationId });
const k = (id: string) => m(id, 'knight');
const d = (id: string) => m(id, 'druid');
const s = (id: string) => m(id, 'sorcerer');
const p = (id: string) => m(id, 'paladin');

describe('uniqueVocations — Party::getUniqueVocationsCount do Canary', () => {
  it('conta "nenhuma" (null) como uma vocação DISTINTA — Canary NÃO exclui VOCATION_NONE (id 0 "None" é um Vocation* real)', () => {
    expect(uniqueVocations([])).toBe(0);
    expect(uniqueVocations([m('a'), m('b')])).toBe(1);
    expect(uniqueVocations([m('a'), m('b'), m('c')])).toBe(1);
    // Um real + um sem vocação: as duas contam — "nenhuma" É uma vocação distinta no Canary.
    expect(uniqueVocations([m('a'), k('b')])).toBe(2);
    expect(uniqueVocations([k('a'), k('b'), d('c')])).toBe(2);
    expect(uniqueVocations([k('a'), d('b'), s('c'), p('d')])).toBe(4);
    expect(uniqueVocations([k('a'), d('b'), s('c'), m('d')])).toBe(4);
  });

  it('capa em 4 — o loop do Canary para de inserir ao chegar em 4 distintas (`if (size >= 4) break`)', () => {
    const eight = ['knight', 'druid', 'sorcerer', 'paladin', 'monk', 'a', 'b', 'c']
      .map((vocation, index) => m(`m${String(index)}`, vocation));
    expect(uniqueVocations(eight)).toBe(4);
  });
});

describe('sharedExperiencePercent — Party:onShareExperience do Canary (m = 0,1n² − 0,2n + 1,3; −0,1 se tamanho ≥ 4)', () => {
  // O DIVISOR do desconto é o TAMANHO da party (membros + líder), NÃO a contagem de vocações
  // únicas — o comentário do Canary fala em "todas as vocações presentes", mas o código testa
  // `partySize`. Reproduzimos o CÓDIGO: uma party de 4+ com vocações repetidas TAMBÉM desconta.
  it.each<[string, PartyMember[], number]>([
    ['1 knight (solo não passa por aqui, mas a fórmula sozinha dá isto)', [k('a')], 120],
    ['2 knights (n=1, tamanho 2 < 4)', [k('a'), k('b')], 120],
    ['knight + druid (n=2, tamanho 2 < 4)', [k('a'), d('b')], 130],
    ['knight + sem vocação (n=2 — "nenhuma" conta, tamanho 2 < 4)', [k('a'), m('b')], 130],
    ['sem vocação + sem vocação (n=1, tamanho 2 < 4)', [m('a'), m('b')], 120],
    ['knight + druid + sorcerer (n=3, tamanho 3 < 4)', [k('a'), d('b'), s('c')], 160],
    ['knight + druid + sorcerer + paladin (n=4, tamanho 4 ≥ 4 → 210 − 10)', [k('a'), d('b'), s('c'), p('d')], 200],
    // Os dois casos que o Canary real diverge do TFS — exatamente os que a revisão pediu:
    ['4 knights (n=1, tamanho 4 ≥ 4 → 120 − 10)', [k('a'), k('b'), k('c'), k('d')], 110],
    ['2 knights + 2 druids + 1 sorcerer (n=3, tamanho 5 ≥ 4 → 160 − 10)', [k('a'), k('b'), d('c'), d('d'), s('e')], 150],
    // 2K+2D é o mesmo `n=2` do caso isolado acima, mas com tamanho 4: o desconto muda o resultado.
    ['2 knights + 2 druids (n=2, tamanho 4 ≥ 4 → 130 − 10, NÃO 130 como o TFS daria)', [k('a'), k('b'), d('c'), d('d')], 120],
  ])('%s', (_name, allMembers, percent) => {
    expect(sharedExperiencePercent(allMembers)).toBe(percent);
  });

  it('capa em 4 vocações e ainda desconta por tamanho: 8 membros distintos rendem 200 %, não 210 %', () => {
    const eight = ['knight', 'druid', 'sorcerer', 'paladin', 'monk', 'a', 'b', 'c']
      .map((vocation, index) => m(`m${String(index)}`, vocation));
    expect(sharedExperiencePercent(eight)).toBe(200);
  });
});

describe('xpShare — cota final, monstro de 100 XP', () => {
  it.each<[string, PartyMember[], PartyMember[], number]>([
    ['solo (eligible.length 1, não lê a fórmula)', [k('a')], [k('a')], 100],
    ['knight + knight, todos elegíveis', [k('a'), k('b')], [k('a'), k('b')], 60],
    ['knight + druid, todos elegíveis', [k('a'), d('b')], [k('a'), d('b')], 65],
    ['4 vocações reais, todos elegíveis: ceil(100 × 200 / 400)', [k('a'), d('b'), s('c'), p('d')], [k('a'), d('b'), s('c'), p('d')], 50],
    ['4 knights, todos elegíveis: ceil(100 × 110 / 400)', [k('a'), k('b'), k('c'), k('d')], [k('a'), k('b'), k('c'), k('d')], 28],
    ['ninguém elegível', [], [], 0],
  ])('%s', (_name, allMembers, eligible, share) => {
    expect(xpShare(100, eligible, allMembers)).toBe(share);
    expect(Number.isInteger(xpShare(100, eligible, allMembers))).toBe(true);
  });

  it('o DIVISOR é o TAMANHO TOTAL da party (allMembers), não a contagem de elegíveis — um membro exausto de stamina ainda conta, só não recebe', () => {
    // 4 vocações reais, mas só 3 elegíveis (o 4º está sem stamina, ainda no roster): a fórmula
    // usa os 4 (200 %) e divide por 4 — o mesmo POR CABEÇA que os 4 receberiam juntos, só que
    // o 4º não recebe nada (ele não está em `eligible`).
    const allFour = [k('a'), d('b'), s('c'), p('d')];
    expect(xpShare(100, [k('a'), d('b'), s('c')], allFour)).toBe(50);
  });

  it('rounds the SHARE up (ceil), like the Canary does — the rest of this file discards remainders, this does not', () => {
    // Rato de 5 XP, party de 4 vocações reais: ceil(5 × 200 / 400) = ceil(2,5) = 3 — NÃO 2
    // (`floor(10 / 4)`). É o Canary arredondando a cota final para cima, sempre.
    const allFour = [k('a'), d('b'), s('c'), p('d')];
    expect(xpShare(5, allFour, allFour)).toBe(3);
  });
});

describe('canShareExperience — Party::canUseSharedExperience do TFS/Canary (§525)', () => {
  const rules = DEFAULT_SHARED_EXPERIENCE_RULES; // 30 tiles, 1 andar, 2/3 do level, 2 min
  const at = (x: number, y: number, z = 0) => ({ x, y, z });
  const member = (id: string, level: number, position = at(0, 0), lastActionAtMs: number | null = 0):
    SharedExperienceMember => ({ id, level, position, lastActionAtMs });

  it('0 ou 1 elegível: nada para compartilhar, sempre true', () => {
    expect(canShareExperience([], 200, at(0, 0), 0, rules)).toBe(true);
    expect(canShareExperience([member('a', 1)], 200, at(0, 0), 0, rules)).toBe(true);
  });

  it('todos dentro do nível, alcance e atividade: true', () => {
    const members = [member('a', 200), member('b', 134, at(10, -20)), member('c', 200, at(0, 30, 1))];
    expect(canShareExperience(members, 200, at(0, 0, 0), 60_000, rules)).toBe(true);
  });

  it('nível: abaixo de ceil(maiorLevel × 2/3) desliga para TODOS, não só quem falhou', () => {
    // maiorLevel 200: mínimo ceil(200/1.5) = ceil(133.33) = 134. 133 falha.
    const members = [member('a', 200), member('b', 133)];
    expect(canShareExperience(members, 200, at(0, 0), 0, rules)).toBe(false);
    // 134 passa (o limiar é inclusive).
    expect(canShareExperience([member('a', 200), member('b', 134)], 200, at(0, 0), 0, rules)).toBe(true);
  });

  it('nível: usa o MAIOR level de toda a sessão, não só dos elegíveis passados', () => {
    // Um level 300 fora dos elegíveis (por exemplo exausto) ainda define a régua: mínimo
    // ceil(300/1.5) = 200. Um elegível de 190 falha mesmo sendo o "mais alto" entre os dois.
    const members = [member('a', 200), member('b', 190)];
    expect(canShareExperience(members, 300, at(0, 0), 0, rules)).toBe(false);
  });

  it('alcance: fora de rangeTiles do LÍDER desliga para todos (30 tiles, x/y independentes)', () => {
    const farX = [member('a', 200), member('b', 200, at(31, 0))];
    expect(canShareExperience(farX, 200, at(0, 0), 0, rules)).toBe(false);
    const okX = [member('a', 200), member('b', 200, at(30, 0))];
    expect(canShareExperience(okX, 200, at(0, 0), 0, rules)).toBe(true);
    const farY = [member('a', 200), member('b', 200, at(0, -31))];
    expect(canShareExperience(farY, 200, at(0, 0), 0, rules)).toBe(false);
  });

  it('andar: fora de floors do LÍDER desliga (hunt multiandar, #519)', () => {
    const otherFloor = [member('a', 200), member('b', 200, at(0, 0, 2))];
    expect(canShareExperience(otherFloor, 200, at(0, 0, 0), 0, rules)).toBe(false);
    const oneUp = [member('a', 200), member('b', 200, at(0, 0, 1))];
    expect(canShareExperience(oneUp, 200, at(0, 0, 0), 0, rules)).toBe(true);
  });

  it('atividade: nunca agiu (null) ou fora da janela desliga; dentro da janela passa', () => {
    const never = [member('a', 200), member('b', 200, at(0, 0), null)];
    expect(canShareExperience(never, 200, at(0, 0), 60_000, rules)).toBe(false);
    const stale = [member('a', 200), member('b', 200, at(0, 0), 0)];
    expect(canShareExperience(stale, 200, at(0, 0), rules.activityWindowMs + 1, rules)).toBe(false);
    const fresh = [member('a', 200), member('b', 200, at(0, 0), 0)];
    expect(canShareExperience(fresh, 200, at(0, 0), rules.activityWindowMs, rules)).toBe(true);
  });
});

describe('xpByDamage — Tibia sem party, ou com a compartilhada desligada (§525)', () => {
  it('divide pelo DANO, floor por atacante, como Creature::getGainedExperience do TFS/Canary', () => {
    const shares = xpByDamage(100, [k('a'), d('b')], { a: 75, b: 25 });
    expect(shares.get('a')).toBe(75);
    expect(shares.get('b')).toBe(25);
  });

  it('floor perde o resto (não redistribui): 100 × 1/3 = 33,33 por atacante', () => {
    const shares = xpByDamage(100, [k('a'), d('b'), s('c')], { a: 1, b: 1, c: 1 });
    expect(shares.get('a')).toBe(33);
    expect(shares.get('b')).toBe(33);
    expect(shares.get('c')).toBe(33);
  });

  it('quem não bateu (ausente ou 0) não recebe nada — a party não cobre quem ficou parado', () => {
    const shares = xpByDamage(100, [k('a'), d('b')], { a: 100 });
    expect(shares.get('a')).toBe(100);
    expect(shares.has('b')).toBe(false);
  });

  it('dano de quem não está mais elegível ainda reduz a fatia dos outros (o damageMap não filtra)', () => {
    // "c" bateu mas não é elegível (saiu/morreu): seu dano some da lista, mas conta no total.
    const shares = xpByDamage(100, [k('a'), d('b')], { a: 50, b: 25, c: 25 });
    expect(shares.get('a')).toBe(50);
    expect(shares.get('b')).toBe(25);
    expect(shares.has('c')).toBe(false);
  });

  it('sem dano nenhum (total zero), ninguém recebe', () => {
    expect(xpByDamage(100, [k('a')], {}).size).toBe(0);
    expect(xpByDamage(100, [k('a')], { a: 0 }).size).toBe(0);
  });
});

describe('splitEqually', () => {
  it('sums to the total, with the remainder one by one on the first shares', () => {
    expect(splitEqually(10, 4)).toEqual([3, 3, 2, 2]);
    expect(splitEqually(0, 3)).toEqual([0, 0, 0]);
    expect(splitEqually(5, 1)).toEqual([5]);
    expect(splitEqually(7, 3)).toEqual([3, 2, 2]);
    expect(splitEqually(9, 0)).toEqual([]);
    for (const [total, n] of [[1, 4], [99, 7], [1_000_000, 3]] as const) {
      expect(splitEqually(total, n).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('settleEntries', () => {
  const catalogItem = (id: string, value: number): Item =>
    ({ id, name: id, kind: 'other', weight: 1, value, stackable: true } as unknown as Item);
  const catalog = new Map<string, Item>([
    ['sword', catalogItem('sword', 10)],
    ['cheese', catalogItem('cheese', 0)],
  ]);
  const carried = (itemId: string, quantity = 1, instanceId = `s:${itemId}`) =>
    ({ instanceId, itemId, quantity });
  const bag = (gold: GoldEntry[], items: BagEntry[], capacity = 400): PartyBagState =>
    ({ gold, items, capacity, overweight: false });

  it('autovenda: 30 gold entre 4 presentes → 8/8/7/7 (resto na ordem de entrada)', () => {
    const settled = settleEntries(
      bag([{ amount: 30, eligible: ['a', 'b', 'c', 'd'] }], []), ['a', 'b', 'c', 'd'], catalog,
    );
    expect([...settled.shares]).toEqual([['a', 8], ['b', 8], ['c', 7], ['d', 7]]);
    expect(settled.total).toBe(30);
  });

  it('elegibilidade: cada entrada paga só quem estava no drop (A50/B50/C0; Y 34/33/33)', () => {
    // X cai com A,B; C entra; B sai. O settlement inclui quem sai (eligible ∩ present).
    const x: BagEntry = { item: carried('sword', 10, 's:x'), eligible: ['a', 'b'] };
    const y: BagEntry = { item: carried('sword', 10, 's:y'), eligible: ['a', 'b', 'c'] };
    const settled = settleEntries(bag([], [x, y]), ['a', 'b', 'c'], catalog);
    expect(settled.shares.get('a')).toBe(84);
    expect(settled.shares.get('b')).toBe(83);
    expect(settled.shares.get('c')).toBe(33);
    expect(settled.total).toBe(200);

    // Só X: 100 entre A e B; C (que entrou depois) não recebe nada dela.
    const justX = settleEntries(bag([], [x]), ['a', 'b', 'c'], catalog);
    expect([...justX.shares]).toEqual([['a', 50], ['b', 50]]);
    expect(justX.shares.get('c')).toBeUndefined();
  });

  it('entrada MIGRADA (eligible: []) divide entre os presentes — a regra de hoje (D5)', () => {
    const settled = settleEntries(bag([{ amount: 9, eligible: [] }], []), ['a', 'b', 'c'], catalog);
    expect([...settled.shares]).toEqual([['a', 3], ['b', 3], ['c', 3]]);
  });

  it('item com value: 0 vai para unsold e não vira gold; fora do catálogo também', () => {
    const settled = settleEntries(bag([], [
      { item: carried('cheese', 3, 's:c'), eligible: ['a', 'b'] },
      { item: carried('ghost', 1, 's:g'), eligible: ['a', 'b'] },
    ]), ['a', 'b'], catalog);
    expect(settled.shares.size).toBe(0);
    expect(settled.total).toBe(0);
    expect(settled.unsold.map((i) => i.itemId)).toEqual(['cheese', 'ghost']);
  });

  it('a soma das cotas É o total, e a bolsa não é mutada', () => {
    const state = bag(
      [{ amount: 7, eligible: ['a', 'b'] }],
      [{ item: carried('sword', 2, 's:x'), eligible: ['a'] }],
    );
    const settled = settleEntries(state, ['a', 'b'], catalog);
    expect(settled.total).toBe(27);
    expect([...settled.shares.values()].reduce((sum, gold) => sum + gold, 0)).toBe(27);
    expect(state.gold).toHaveLength(1);
    expect(state.items).toHaveLength(1);
  });
});

describe('reserveProportionally (#396, plano §3)', () => {
  const cap = (id: string, available: number): MemberCapacity => ({ id, available });

  it('R_i = W × B_i / ΣB sobre a capacidade DISPONÍVEL (§12.1)', () => {
    // A 1 000, B 500, bolsa 300 → A 200, B 100 (20 % cada).
    const two = reserveProportionally(300, [cap('a', 1_000), cap('b', 500)]);
    expect(two.get('a')).toBe(200);
    expect(two.get('b')).toBe(100);

    // Três: 1 000 / 500 / 250, bolsa 700 → 400 / 200 / 100 (40 % cada).
    const three = reserveProportionally(700, [cap('a', 1_000), cap('b', 500), cap('c', 250)]);
    expect(three.get('a')).toBe(400);
    expect(three.get('b')).toBe(200);
    expect(three.get('c')).toBe(100);
    expect([...three.values()].reduce((sum, n) => sum + n, 0)).toBe(700);
  });

  it('em OVERWEIGHT cada um reserva no máximo a própria disponível, nunca o peso da bolsa', () => {
    const over = reserveProportionally(2_000, [cap('a', 1_000), cap('b', 500)]);
    expect(over.get('a')).toBe(1_000);
    expect(over.get('b')).toBe(500);
    // Σ reservas = Σ disponível, o excedente fica sem reserva de ninguém (§14).
    expect([...over.values()].reduce((sum, n) => sum + n, 0)).toBe(1_500);
  });

  it('disponível 0 (ou negativa) não gera reserva negativa nem NaN', () => {
    const zero = reserveProportionally(100, [cap('a', 0), cap('b', -50)]);
    expect([...zero.values()]).toEqual([0, 0]);
    for (const value of zero.values()) expect(Number.isFinite(value)).toBe(true);

    const empty = reserveProportionally(100, []);
    expect(empty.size).toBe(0);
  });

  it('peso 0 (ou negativo) reserva 0 para todos', () => {
    expect([...reserveProportionally(0, [cap('a', 1_000), cap('b', 500)]).values()]).toEqual([0, 0]);
    expect([...reserveProportionally(-5, [cap('a', 1_000)]).values()]).toEqual([0]);
  });
});

describe('bagValue (#396, PRD §10)', () => {
  const item = (id: string, value: number): Item =>
    ({ id, name: id, kind: 'other', weight: 1, value, stackable: true } as unknown as Item);
  const catalog = new Map<string, Item>([
    ['sword', item('sword', 10)],
    ['cheese', item('cheese', 0)],
  ]);
  const carried = (itemId: string, quantity = 1) => ({ instanceId: `s:${itemId}`, itemId, quantity });

  it('soma o gold da bolsa com value × quantity dos itens', () => {
    const state: PartyBagState = {
      gold: [{ amount: 7, eligible: ['a'] }],
      items: [
        { item: carried('sword', 2), eligible: ['a'] },
        { item: carried('cheese', 3), eligible: ['a'] },
      ],
      capacity: 0,
      overweight: false,
    };
    expect(bagValue(state, catalog)).toBe(27);
  });

  it('item com value 0 — ou fora do catálogo — não entra na conta', () => {
    const state: PartyBagState = {
      gold: [],
      items: [
        { item: carried('cheese', 5), eligible: ['a'] },
        { item: carried('ghost', 1), eligible: ['a'] },
      ],
      capacity: 0,
      overweight: false,
    };
    expect(bagValue(state, catalog)).toBe(0);
  });
});

describe('autoSellLimit (#395)', () => {
  const limits = { free: 5, premium: 20 };

  it('lê o Premium do LÍDER; a lista guarda 18 e só os 5 primeiros valem com free', () => {
    expect(autoSellLimit({ lead: true }, 'lead', limits)).toBe(20);
    expect(autoSellLimit({ lead: false }, 'lead', limits)).toBe(5);
    expect(autoSellLimit({}, 'lead', limits)).toBe(5);
    // O Premium de OUTRO membro não vale: o limite é do líder.
    expect(autoSellLimit({ b: true }, 'lead', limits)).toBe(5);
    const configured = Array.from({ length: 18 }, (_, i) => `i${String(i)}`);
    expect(configured.slice(0, autoSellLimit({}, 'lead', limits))).toHaveLength(5);
    expect(configured).toHaveLength(18);
  });

  it('sem o bloco de conteúdo, o limite é zero', () => {
    expect(autoSellLimit({ lead: true }, 'lead', undefined)).toBe(0);
  });
});

describe('shareCostsOf and splitLootOf (#359)', () => {
  it('falls back to mode when axes are omitted', () => {
    expect(shareCostsOf({ mode: 'split' })).toBe(false);
    expect(splitLootOf({ mode: 'split' })).toBe(false);

    expect(shareCostsOf({ mode: 'shared' })).toBe(true);
    expect(splitLootOf({ mode: 'shared' })).toBe(true);
  });

  it('respects explicit overrides over mode fallback', () => {
    // Combination C: shareCosts: true, splitLoot: false
    expect(shareCostsOf({ mode: 'split', shareCosts: true, splitLoot: false })).toBe(true);
    expect(splitLootOf({ mode: 'split', shareCosts: true, splitLoot: false })).toBe(false);

    // Combination D: shareCosts: false, splitLoot: true
    expect(shareCostsOf({ mode: 'split', shareCosts: false, splitLoot: true })).toBe(false);
    expect(splitLootOf({ mode: 'split', shareCosts: false, splitLoot: true })).toBe(true);

    // Explicit false overrides shared mode
    expect(shareCostsOf({ mode: 'shared', shareCosts: false })).toBe(false);
    expect(splitLootOf({ mode: 'shared', splitLoot: false })).toBe(false);

    // Explicit true overrides split mode
    expect(shareCostsOf({ mode: 'split', shareCosts: true })).toBe(true);
    expect(splitLootOf({ mode: 'split', splitLoot: true })).toBe(true);
  });
});

