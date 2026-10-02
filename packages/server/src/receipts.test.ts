import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BosstiaryState, CharmsState, FamiliarState, HazardState, LearnedSpellsState, OfflineTrainingState,
} from '@draconya/sim';
import { ReceiptStore, type SessionReceipt } from './receipts.js';
import { connectTestRedis } from './testing/redis.js';

const { redis, available } = await connectTestRedis(8);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

const receiptOf = (
  sessionId: string, characterId: string, overrides: Partial<SessionReceipt> = {},
): Omit<SessionReceipt, 'endedAtMs'> => ({
  sessionId,
  characterId,
  accountId: 'a1',
  reason: 'drain',
  seq: 1,
  aggregates: {
    durationMs: 60_000, xpGained: 400, goldGained: 90, goldSpent: 10, kills: 4, deaths: 0,
       itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
       damageDealt: 0, healingDone: 0,
  },
  notableEvents: [],
  ...overrides,
});

describe.runIf(available)('pending receipts of one character (FUN-56)', () => {
  it('answers with that character alone, not the whole queue', async () => {
    // É a razão de o índice existir: quem emite ticket precisa saber se AQUELE personagem
    // tem crédito esperando, e varrer o keyspace inteiro a cada login não é resposta.
    const store = new ReceiptStore(redis);
    const mine = randomUUID();
    const theirs = randomUUID();
    await store.save(receiptOf(randomUUID(), mine));
    await store.save(receiptOf(randomUUID(), mine, { seq: 2 }));
    await store.save(receiptOf(randomUUID(), theirs));

    const found = await store.pendingFor(mine);

    expect(found).toHaveLength(2);
    expect(found.every((receipt) => receipt.characterId === mine)).toBe(true);
    expect(await store.pending()).toHaveLength(3);
  });

  it('has nothing to say about a character that never played', async () => {
    expect(await new ReceiptStore(redis).pendingFor(randomUUID())).toEqual([]);
  });

  it('stops answering once the receipt is credited', async () => {
    // `remove` apaga os dois lados. Deixar o índice para trás faria o extrato já creditado
    // voltar como pendente na próxima emissão de ticket.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await store.save(receiptOf(sessionId, characterId));

    await store.remove(sessionId, characterId, 1);

    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await redis.zrange(`receipts:char:v2:${characterId}`, '0', '-1')).toEqual([]);
  });

  it('round-trips promoted (#566, ADR 0042 decisão 1) through parseReceipt', async () => {
    // `parseReceipt` é lista de PERMISSÃO: campo que não entra nela some no caminho de volta
    // sem erro nenhum — é exatamente o defeito que este teste reprova para `promoted`.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, { promoted: true }));

    const [found] = await store.pendingFor(characterId);

    expect(found?.promoted).toBe(true);
  });

  it('never carries `false` for promoted: the field is always absent when not promoting', async () => {
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId));

    const [found] = await store.pendingFor(characterId);

    expect(found?.promoted).toBeUndefined();
  });

  it('drops an index entry whose receipt is gone, instead of returning a phantom', async () => {
    // Acontece de dois jeitos: o extrato expirou pelo TTL, ou um `remove` morreu entre
    // apagar o extrato e limpar o índice. Sem a limpeza na leitura, o conjunto de um
    // personagem que joga todo dia cresce para sempre.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await store.save(receiptOf(sessionId, characterId));
    await redis.del(`receipt:${sessionId}:${characterId}:1`);

    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await redis.zrange(`receipts:char:v2:${characterId}`, '0', '-1')).toEqual([]);
  });

  it('ignores a receipt written before the index existed, and lets the sweep have it', async () => {
    // Degradação de deploy em rolagem: um nó `game` antigo grava só `receipt:{sessionId}`.
    // Aquele personagem volta a esperar a varredura — o comportamento de antes desta issue,
    // que é o pior aceitável — mas o crédito NÃO se perde.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await redis.set(
      `receipt:${sessionId}`,
      JSON.stringify({ ...receiptOf(sessionId, characterId), endedAtMs: 1 }),
    );

    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await store.pending()).toHaveLength(1);
  });

  it('stops at a ceiling, because this runs on the path of an HTTP request', async () => {
    // Cada extrato custa uma transação no Postgres. Encostar no teto significa que a
    // varredura está parada há um bom tempo, e nesse mundo o certo é o login continuar
    // rápido e o resto sair no próximo — não a emissão de ticket virar o `jobs` de fato.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    for (let seq = 1; seq <= 4; seq += 1) {
      await store.save(receiptOf(randomUUID(), characterId, { seq }));
    }

    expect(await store.pendingFor(characterId, 2)).toHaveLength(2);
    expect(await store.pendingFor(characterId)).toHaveLength(4);
  });

  it('carries the bestiary through Redis and back, and a receipt without one stays without (FUN-113)', async () => {
    // `parseReceipt` é lista de PERMISSÃO: campo que não entra nela some no caminho de volta
    // sem erro nenhum — foi o que aconteceu com as skills na primeira vez. Este teste é o que
    // pega a mesma omissão para o Bestiário: gravado com o mapa, lido com o mapa, absoluto.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const counts = { rat: 10_000, bat: 3 };
    await store.save(receiptOf(randomUUID(), characterId, { bestiary: counts }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.bestiary).toEqual(counts);
    // Sem o campo, sem a chave: o ledger distingue "não veio" (não toca na coluna) de "veio
    // vazio", e uma chave `undefined` colapsaria os dois.
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('bestiary');
  });

  it('carries the Bosstiary through Redis and back, and a receipt without one stays without (#629)', async () => {
    // A mesma lista de PERMISSÃO do Bestiário e dos Charms: campo que não entra em `parseReceipt`
    // some no caminho de volta sem erro nenhum, e o ledger nunca veria um abate de boss.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const bosstiary: BosstiaryState = { kills: { '639': 3, '1811': 20 }, points: 70, version: 1 };
    await store.save(receiptOf(randomUUID(), characterId, { bosstiary }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.bosstiary).toEqual(bosstiary);
    // Sem o campo, sem a chave: o ledger distingue "não veio" (não toca na coluna) de "veio vazio".
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('bosstiary');
  });

  it('carries the Charms economy through Redis and back, and a receipt without one stays without (#602)', async () => {
    // A mesma lista de PERMISSÃO do Bestiário logo acima. Diferente dele, este registro é
    // ABSOLUTO (última escrita vence, ADR 0052 d.1) — mas a ida e volta pelo Redis é a MESMA
    // conferência: campo que não entra em `parseReceipt` some no caminho de volta sem erro.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const charms: CharmsState = {
      pointsSpent: 240, echoesSpent: 50, tiers: { wound: 1 }, assignments: { wound: 'rat' }, version: 1,
    };
    await store.save(receiptOf(randomUUID(), characterId, { charms }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.charms).toEqual(charms);
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('charms');
  });

  it('carries the learned spells through Redis and back, and a receipt without one stays without (#624)', async () => {
    // A mesma lista de PERMISSÃO do Bestiário e dos Charms: campo que não entra em
    // `parseReceipt` some no caminho de volta sem erro — e o personagem perderia a magia que
    // pagou no próximo logout.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const learnedSpells: LearnedSpellsState = { spellIds: ['berserk', 'wound-cleansing'], version: 1 };
    await store.save(receiptOf(randomUUID(), characterId, { learnedSpells }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.learnedSpells).toEqual(learnedSpells);
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('learnedSpells');
  });

  it('carries the familiar stamps through Redis and back, and drops a malformed record (#599)', async () => {
    // Os carimbos de relógio de PAREDE do familiar: ABSOLUTOS e última-escrita-vence (ADR 0052 d.1).
    // A ida e volta pelo Redis é a mesma conferência de `charms`: campo que não entra em
    // `parseReceipt` some no caminho de volta sem erro — e aqui um registro torto também some.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const familiar: FamiliarState = { version: 1, summonUntilMs: 1_790_000_900_000, cooldownUntilMs: 1_790_001_800_000 };
    await store.save(receiptOf(randomUUID(), characterId, { familiar }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));
    await store.save(receiptOf(randomUUID(), characterId, {
      seq: 3, familiar: { version: 1, summonUntilMs: -5, cooldownUntilMs: 'x' } as unknown as FamiliarState,
    }));
    // Instante fracionário: a forma é INTEIRO SEGURO, e é o `sim` quem arredonda ao gravar o carimbo
    // (`#wallStampMs`) — o relógio lógico do hospedeiro é `performance.now()`, nunca inteiro. Este é o
    // lado que recusa: um carimbo fracionário que chegasse aqui some em silêncio, e o cooldown junto.
    await store.save(receiptOf(randomUUID(), characterId, {
      seq: 4, familiar: { version: 1, summonUntilMs: 1_790_000_900_000.4, cooldownUntilMs: 1_790_001_800_000 },
    }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.familiar).toEqual(familiar);
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('familiar');
    expect(found.find((receipt) => receipt.seq === 3)).not.toHaveProperty('familiar');
    expect(found.find((receipt) => receipt.seq === 4)).not.toHaveProperty('familiar');
  });

  it('carries the offline training record through Redis and back, and a receipt without one stays without (#631)', async () => {
    // A mesma lista de PERMISSÃO dos registros logo acima — e este é ABSOLUTO (ADR 0052 d.1): o banco
    // sobe por tempo de sessão e desce quando a `api` o gasta, então nada de fusão por máximo. Além
    // da ida e volta, a leitura é a defensiva do `sim`: o ledger grava o registro direto numa coluna
    // `jsonb`, e um banco negativo ou uma skill torta não pode chegar lá.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const training: OfflineTrainingState = { offlineBankMs: 7_200_000, offlineSkill: 'sword', version: 1 };
    await store.save(receiptOf(randomUUID(), characterId, { training }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));
    await store.save(receiptOf(
      randomUUID(), characterId,
      { seq: 3, training: { offlineBankMs: -5, offlineSkill: 7, version: 1 } as unknown as OfflineTrainingState },
    ));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.training).toEqual(training);
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('training');
    // O torto some — o ledger não toca na coluna —, e o extrato em si continua valendo.
    expect(found.find((receipt) => receipt.seq === 3)).not.toHaveProperty('training');
  });

  it('carries the Hazard registry through Redis and back, and drops a malformed one (#632)', async () => {
    // O mesmo caminho dos Charms: campo que não entra em `parseReceipt` some no caminho de volta sem
    // erro, e o registro torto (nível não inteiro, zona sem nome) é descartado em vez de gravado.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const hazard: HazardState = { maxLevel: { gardens: 3 }, currentLevel: { gardens: 2 }, version: 1 };
    await store.save(receiptOf(randomUUID(), characterId, { hazard }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));
    await store.save(receiptOf(randomUUID(), characterId, {
      seq: 3, hazard: { maxLevel: { gardens: 1.5 }, currentLevel: {}, version: 1 },
    }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.hazard).toEqual(hazard);
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('hazard');
    expect(found.find((receipt) => receipt.seq === 3)).not.toHaveProperty('hazard');
  });

  it('carries the ammo selection through Redis and back, and a receipt without one stays without (#152)', async () => {
    // A mesma lista de PERMISSÃO, o mesmo defeito a pegar: a escolha gravada tem de voltar
    // inteira, e o extrato sem ela não pode ganhar a chave — o ledger não toca na coluna.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, { ammo: { arrow: 'sniper-arrow' } }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.ammo).toEqual({ arrow: 'sniper-arrow' });
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('ammo');
  });

  it('carries removedInstances through Redis and back, and a receipt without one stays without (#724, ADR 0048 d.8)', async () => {
    // A mesma lista de PERMISSÃO, o mesmo defeito real: `parseReceipt` reconstrói campo a
    // campo, e um campo novo em `SessionReceipt` que não entra ali some no caminho de volta
    // sem erro nenhum — foi exatamente o que aconteceu aqui na primeira versão desta feature:
    // `jobs/ledger.ts` recebia sempre `removedInstances: undefined` de volta do Redis, mesmo
    // com `sell-items`/`discard-item` gravando a lista corretamente na escrita, e o
    // `item_instance` vendido/descartado nunca era apagado.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, { removedInstances: ['s1:0', 's1:1'] }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.removedInstances).toEqual(['s1:0', 's1:1']);
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('removedInstances');
  });

  it('carries the quantity of every carried instance through Redis and back, dropping what the column rejects (#837)', async () => {
    // A mesma lista de PERMISSÃO, o mesmo defeito a pegar: sem a linha em `parseReceipt` a pilha do mundo
    // volta a ficar com a quantidade do primeiro checkpoint, sem erro nenhum. E o `ledger` grava o valor
    // direto na coluna `integer`: zero, fração, texto e o que estoura a coluna são dado torto e somem.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, {
      quantities: { 'w:p1:0': 3, 'w:p1:1': 1, zero: 0, half: 1.5, text: '4', huge: 2_147_483_648 } as never,
    }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 3, quantities: [1, 2] as never }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.quantities).toEqual({ 'w:p1:0': 3, 'w:p1:1': 1 });
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('quantities');
    expect(found.find((receipt) => receipt.seq === 3)).not.toHaveProperty('quantities');
  });

  it('carries the soul points through Redis and back, and a receipt without one stays without (#593)', async () => {
    // A mesma lista de PERMISSÃO, o mesmo defeito a pegar: alma gravada tem de voltar inteira,
    // e o extrato sem ela não pode ganhar a chave — diferente do Bestiário, o ledger NÃO funde
    // por máximo aqui (alma pode descer), então "a chave sumiu" e "a chave voltou zero" são
    // coisas diferentes que este teste também distingue.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, { soul: 42 }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.soul).toBe(42);
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('soul');
  });

  it('carries the blessings bitmask through Redis and back, and a receipt without one stays without (#570)', async () => {
    // A mesma lista de PERMISSÃO. E a mesma disciplina da alma: bênção DESCE na morte, então o
    // ledger nunca funde por máximo (ver jobs/ledger.ts) — "a chave sumiu" (extrato de sessão
    // sem o campo, nunca tocou a linha) e "a chave voltou zero" (a morte zerou de verdade) são
    // coisas diferentes, e este teste distingue as duas indo e voltando pelo Redis de verdade.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, { blessings: 0b1010101 }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2, blessings: 0 }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 3 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.blessings).toBe(0b1010101);
    expect(found.find((receipt) => receipt.seq === 2)?.blessings).toBe(0);
    expect(found.find((receipt) => receipt.seq === 3)).not.toHaveProperty('blessings');
  });

  it('carries the fight mode through Redis and back, and a receipt without one stays without (#550)', async () => {
    // A mesma lista de PERMISSÃO. Os três modos voltam inteiros, o extrato sem o campo não ganha
    // a chave (o ledger não toca a coluna), e um valor torto na volta some em vez de virar um
    // modo que o `sim` não conhece.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, { fightMode: 'defense' }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2, fightMode: 'attack' }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 3 }));
    await store.save(receiptOf(randomUUID(), characterId, {
      seq: 4, fightMode: 'aggressive' as unknown as 'attack',
    }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.fightMode).toBe('defense');
    expect(found.find((receipt) => receipt.seq === 2)?.fightMode).toBe('attack');
    expect(found.find((receipt) => receipt.seq === 3)).not.toHaveProperty('fightMode');
    expect(found.find((receipt) => receipt.seq === 4)).not.toHaveProperty('fightMode');
  });

  it('carries the world and the vitals through Redis and back, and a receipt without them stays without (#836, OW-15)', async () => {
    // A mesma lista de PERMISSÃO. Posição, cidade, vida, mana e condições voltam inteiras; o extrato
    // sem os campos não ganha chave nenhuma (o ledger não toca as colunas); e `worldPosition: null`
    // e `conditions: []` são EXPLÍCITOS — "volta ao templo" e "nenhuma" — e atravessam, ao contrário
    // da ausência. Mutação que mata: esquecer o `...readReceiptWorldState` de `parseReceipt`.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const poison = { key: 'poison', expiresAtMs: 4_000, tick: { amount: 3, intervalMs: 1_000, kind: 'damage' as const } };
    await store.save(receiptOf(randomUUID(), characterId, {
      worldPosition: { x: 32369, y: 32241, z: 7 }, townId: 'thais', health: 10, mana: 0, conditions: [poison],
    }));
    await store.save(receiptOf(randomUUID(), characterId, {
      seq: 2, worldPosition: null, townId: 'thais', health: 150, mana: 40, conditions: [],
    }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 3 }));

    const found = await store.pendingFor(characterId);
    const bySeq = (seq: number) => found.find((receipt) => receipt.seq === seq);

    expect(bySeq(1)).toMatchObject({
      worldPosition: { x: 32369, y: 32241, z: 7 }, townId: 'thais', health: 10, mana: 0, conditions: [poison],
    });
    expect(bySeq(2)).toMatchObject({ worldPosition: null, health: 150, mana: 40, conditions: [] });
    for (const field of ['worldPosition', 'townId', 'health', 'mana', 'conditions']) {
      expect(bySeq(3)).not.toHaveProperty(field);
    }
  });

  it('drops a malformed world or vital field on the way back, field by field (#836, OW-15)', async () => {
    // O ledger grava estes campos direto nas colunas: uma coordenada fora do mapa, uma vida negativa
    // ou uma condição com prazo `NaN` não pode chegar lá. O campo torto some e os outros seguem.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, {
      worldPosition: { x: 1, y: 2 } as never, townId: '', health: -4, mana: 12,
      conditions: [{ key: 'haste' }] as never,
    }));

    const [found] = await store.pendingFor(characterId);

    expect(found).toMatchObject({ mana: 12 });
    for (const field of ['worldPosition', 'townId', 'health', 'conditions']) {
      expect(found).not.toHaveProperty(field);
    }
  });

  it('keeps the index out of the sweep, which scans by key prefix', async () => {
    // `receipts:char:` e `receipt:` são prefixos distintos DE PROPÓSITO. Nomear o índice
    // `receipt:char:{id}` o poria dentro do `MATCH` da varredura, e um SET no lugar de um
    // extrato sai do `MGET` como nada — a varredura pararia de ver um extrato por ciclo sem
    // nenhum erro em lugar nenhum.
    const store = new ReceiptStore(redis);
    await store.save(receiptOf(randomUUID(), randomUUID()));

    const keys = await redis.keys('receipt:*');

    expect(keys).toHaveLength(1);
    expect(await store.pending()).toHaveLength(1);
  });
});

describe.runIf(available)('one receipt per party member (#194, ADR 0027)', () => {
  it('keeps two receipts of the same session apart, and removes one without touching the other', async () => {
    // Mutação que mata: a chave antiga `receipt:{sessionId}` — o segundo `save` sobrescreveria
    // o primeiro, e um membro da party perderia a hunt inteira.
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    await store.save(receiptOf(sessionId, 'a', { seq: 1 }));
    await store.save(receiptOf(sessionId, 'b', { seq: 2 }));

    expect((await store.pendingFor('a')).map((r) => [r.characterId, r.seq])).toEqual([['a', 1]]);
    expect((await store.pendingFor('b')).map((r) => [r.characterId, r.seq])).toEqual([['b', 2]]);
    expect(await store.pending()).toHaveLength(2);

    await store.remove(sessionId, 'a', 1);
    expect(await store.pendingFor('a')).toEqual([]);
    expect((await store.pendingFor('b')).map((r) => r.seq)).toEqual([2]);
    expect(await store.pending()).toHaveLength(1);
  });

  it('still reads and removes a receipt written under the old key, with the old index entry', async () => {
    // Deploy em rolagem: um nó anterior ao #194 gravou `receipt:{sessionId}` e o índice com o
    // `sessionId` cru. Precisa ser lido por `pendingFor` E apagado por `remove`.
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const characterId = randomUUID();
    await redis.set(`receipt:${sessionId}`, JSON.stringify({ ...receiptOf(sessionId, characterId), endedAtMs: 1 }));
    await redis.sadd(`receipts:char:${characterId}`, sessionId);

    expect((await store.pendingFor(characterId)).map((r) => r.sessionId)).toEqual([sessionId]);
    await store.remove(sessionId, characterId, 1);
    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await redis.exists(`receipt:${sessionId}`)).toBe(0);
  });
});

// O extrato por `seq`, em ordem por versão (#823, OW-02, ADR 0060 decisão 10e). A chave era
// `receipt:{sessionId}:{characterId}` e o segundo extrato do par SOBRESCREVIA o primeiro; o
// índice era um SET, sem ordem.
describe.runIf(available)('one receipt per (session, character, seq), oldest version first (#823)', () => {
  it('keeps two receipts of the SAME pair apart — the second does not overwrite the first', async () => {
    // Mutação que mata: a chave sem o `seq`. É a janela que já existe hoje (Cidade → hunt →
    // Cidade) e a que o checkpoint do mundo abriria de vez.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await store.save(receiptOf(sessionId, characterId, { seq: 1, durableVersion: 1 }));
    await store.save(receiptOf(sessionId, characterId, { seq: 2, durableVersion: 2 }));

    expect((await store.pendingFor(characterId)).map((receipt) => receipt.seq)).toEqual([1, 2]);
    expect(await store.pending()).toHaveLength(2);
    expect(await redis.keys('receipt:*')).toHaveLength(2);
  });

  it('removes one receipt of the pair without touching the other', async () => {
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await store.save(receiptOf(sessionId, characterId, { seq: 1, durableVersion: 1 }));
    await store.save(receiptOf(sessionId, characterId, { seq: 2, durableVersion: 2 }));

    await store.remove(sessionId, characterId, 1);

    expect((await store.pendingFor(characterId)).map((receipt) => receipt.seq)).toEqual([2]);
    await store.remove(sessionId, characterId, 2);
    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await redis.keys('receipt*')).toEqual([]);
  });

  it('answers oldest version first, whatever order they were saved in', async () => {
    // Mutação que mata: o índice voltar a ser um SET (`SMEMBERS` não tem ordem).
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, { seq: 1, durableVersion: 30 }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 1, durableVersion: 10 }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 1, durableVersion: 20 }));

    expect((await store.pendingFor(characterId)).map((receipt) => receipt.durableVersion)).toEqual([10, 20, 30]);
  });

  it('cuts at the ceiling by the OLDEST, so a newer receipt never jumps ahead of an older one', async () => {
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    for (const durableVersion of [4, 2, 3, 1]) {
      await store.save(receiptOf(randomUUID(), characterId, { seq: durableVersion, durableVersion }));
    }

    expect((await store.pendingFor(characterId, 2)).map((receipt) => receipt.durableVersion)).toEqual([1, 2]);
  });

  it('saving the same receipt again (a lost acknowledgement) does not duplicate it, and moves the score', async () => {
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await store.save(receiptOf(sessionId, characterId, { seq: 1, durableVersion: 5 }));
    await store.save(receiptOf(sessionId, characterId, { seq: 1, durableVersion: 6 }));

    const found = await store.pendingFor(characterId);

    expect(found).toHaveLength(1);
    expect(found[0]?.durableVersion).toBe(6);
  });

  it('round-trips durableVersion through parseReceipt, and a receipt without one stays without', async () => {
    // `parseReceipt` é lista de PERMISSÃO: sem a linha do campo, todo extrato voltaria "sem
    // versão" do Redis e o ledger liquidaria tudo pela regra de antes, em silêncio.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, { seq: 1, durableVersion: 7 }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 3, durableVersion: -4 }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 4, durableVersion: 1.5 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.durableVersion).toBe(7);
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('durableVersion');
    // Negativo e fracionário são lixo: somem, o lado seguro (a regra de antes).
    expect(found.find((receipt) => receipt.seq === 3)).not.toHaveProperty('durableVersion');
    expect(found.find((receipt) => receipt.seq === 4)).not.toHaveProperty('durableVersion');
  });

  it('highestPendingVersion is the floor the ticket hands to the next session', async () => {
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    expect(await store.highestPendingVersion(characterId)).toBe(0);

    const sessionId = randomUUID();
    await store.save(receiptOf(sessionId, characterId, { seq: 1, durableVersion: 4 }));
    await store.save(receiptOf(sessionId, characterId, { seq: 2, durableVersion: 9 }));
    await store.save(receiptOf(sessionId, characterId, { seq: 3, durableVersion: 6 }));
    expect(await store.highestPendingVersion(characterId)).toBe(9);

    await store.remove(sessionId, characterId, 2);
    expect(await store.highestPendingVersion(characterId)).toBe(6);
    // E é por personagem: o pendente de outro não entra.
    expect(await store.highestPendingVersion(randomUUID())).toBe(0);
  });
});

// O formato ANTIGO continua lido por um ciclo de deploy (ADR 0014): extrato em voo gravado por
// um nó `game` anterior não pode se perder, e apagar o novo não pode levar junto um antigo de
// outro `seq`.
describe.runIf(available)('the previous receipt format is still read, and never erased by another seq (#823)', () => {
  const writeV1 = async (sessionId: string, characterId: string, seq: number, endedAtMs: number) => {
    // `receipt:{sessionId}:{characterId}` + o SET `receipts:char:{characterId}` com a chave inteira.
    const key = `receipt:${sessionId}:${characterId}`;
    await redis.set(key, JSON.stringify({ ...receiptOf(sessionId, characterId, { seq }), endedAtMs }));
    await redis.sadd(`receipts:char:${characterId}`, key);
  };

  it('reads the #194 key through the old SET and the sweep, ahead of the versioned ones', async () => {
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const oldSession = randomUUID();
    await writeV1(oldSession, characterId, 1, 1_000);
    await store.save(receiptOf(randomUUID(), characterId, { seq: 1, durableVersion: 3 }));

    const found = await store.pendingFor(characterId);

    // O antigo não tem versão e é sempre mais velho: vem primeiro.
    expect(found.map((receipt) => receipt.durableVersion)).toEqual([undefined, 3]);
    expect(found[0]?.sessionId).toBe(oldSession);
    expect(await store.pending()).toHaveLength(2);
  });

  it('removes the #194 key and its old index entry when the seq matches', async () => {
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await writeV1(sessionId, characterId, 4, 1_000);

    await store.remove(sessionId, characterId, 4);

    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await redis.exists(`receipt:${sessionId}:${characterId}`)).toBe(0);
    expect(await redis.smembers(`receipts:char:${characterId}`)).toEqual([]);
  });

  it('leaves the #194 key alone when the seq is another one — it is a DIFFERENT receipt', async () => {
    // Mutação que mata: apagar a chave antiga às cegas (`DEL receipt:{sessionId}:{characterId}`),
    // como o `remove` de antes fazia: levaria junto um extrato que ninguém liquidou.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await writeV1(sessionId, characterId, 4, 1_000);
    await store.save(receiptOf(sessionId, characterId, { seq: 5, durableVersion: 1 }));

    await store.remove(sessionId, characterId, 5);

    const left = await store.pendingFor(characterId);
    expect(left.map((receipt) => receipt.seq)).toEqual([4]);
    expect(await redis.smembers(`receipts:char:${characterId}`)).toHaveLength(1);
  });

  it('does not erase another character’s receipt that shares the original key of the session', async () => {
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const owner = randomUUID();
    await redis.set(`receipt:${sessionId}`, JSON.stringify({ ...receiptOf(sessionId, owner), endedAtMs: 1 }));

    // Mesmo `sessionId` e mesmo `seq`, outro personagem: a chave antiga não é dele.
    await store.remove(sessionId, randomUUID(), 1);

    expect(await redis.exists(`receipt:${sessionId}`)).toBe(1);
    await store.remove(sessionId, owner, 1);
    expect(await redis.exists(`receipt:${sessionId}`)).toBe(0);
  });

  it('drops a stale entry of the old SET, like the ZSET one', async () => {
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await redis.sadd(`receipts:char:${characterId}`, `receipt:${randomUUID()}:${characterId}`);

    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await redis.smembers(`receipts:char:${characterId}`)).toEqual([]);
  });
});

describe.runIf(available)('the world checkpoint batch is ONE transaction (#837, OW-16, ADR 0060 d.10d)', () => {
  const batchOf = (sessionId: string, characters: readonly string[]) =>
    characters.map((characterId, index) =>
      receiptOf(sessionId, characterId, { seq: index + 1, durableVersion: 10 + index, reason: 'checkpoint' }));

  it('writes every receipt of the batch, each under its own key and in its own character index', async () => {
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()] as const;

    await store.saveBatch(batchOf(sessionId, [a, b, c]));

    for (const [index, characterId] of [a, b, c].entries()) {
      expect(await redis.exists(`receipt:${sessionId}:${characterId}:${index + 1}`)).toBe(1);
      const found = await store.pendingFor(characterId);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ sessionId, characterId, seq: index + 1, durableVersion: 10 + index });
    }
    expect(await store.pending()).toHaveLength(3);
  });

  it('goes to Redis in a SINGLE MULTI — so the node dying leaves the last whole batch, never half of it', async () => {
    // A atomicidade é do `MULTI`: o cliente enfileira tudo e manda um `EXEC`. Três `save`s seriam três
    // transações, e uma queda entre elas devolveria o mundo inteiro dividido em dois instantes.
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const multi = vi.spyOn(redis, 'multi');
    try {
      await store.saveBatch(batchOf(sessionId, [randomUUID(), randomUUID(), randomUUID()]));
      expect(multi).toHaveBeenCalledTimes(1);
      const pipeline = multi.mock.results[0]?.value as { length: number };
      // Três comandos por extrato (`SET`, `ZADD`, `PEXPIRE`), mais o `MULTI` e o `EXEC` do próprio
      // ioredis — todos na mesma transação.
      expect(pipeline.length).toBe(3 * 3 + 2);
    } finally {
      multi.mockRestore();
    }
  });

  it('is what a node that dies BEFORE the EXEC leaves behind: nothing of the new batch, all of the old one', async () => {
    // Simula a queda entre dois lotes: o segundo lote é enfileirado e nunca executado (a conexão
    // caiu antes do `EXEC`). O Redis fica com o primeiro lote INTEIRO e com nada do segundo.
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const characters = [randomUUID(), randomUUID(), randomUUID()];
    await store.saveBatch(batchOf(sessionId, characters));

    const dying = new ReceiptStore(redis);
    const multi = vi.spyOn(redis, 'multi').mockImplementationOnce(() => {
      const pipeline = redis.multi();
      // `exec` é o que a queda impede: o que foi enfileirado nunca chega ao servidor.
      vi.spyOn(pipeline, 'exec').mockRejectedValue(new Error('connection lost'));
      return pipeline;
    });
    try {
      await expect(dying.saveBatch(characters.map((characterId, index) =>
        receiptOf(sessionId, characterId, { seq: 50 + index, durableVersion: 90 + index }))))
        .rejects.toThrow('connection lost');
    } finally {
      multi.mockRestore();
    }

    for (const [index, characterId] of characters.entries()) {
      const found = await store.pendingFor(characterId);
      expect(found.map((receipt) => receipt.seq)).toEqual([index + 1]);
    }
  });

  it('an empty batch does not talk to Redis', async () => {
    const store = new ReceiptStore(redis);
    const multi = vi.spyOn(redis, 'multi');
    try {
      await store.saveBatch([]);
      expect(multi).not.toHaveBeenCalled();
    } finally {
      multi.mockRestore();
    }
    expect(await redis.dbsize()).toBe(0);
  });

  it('stamps the whole batch with ONE instant, and gives every key and index the TTL', async () => {
    const store = new ReceiptStore(redis, { now: () => 1_234, ttlMs: 60_000 });
    const sessionId = randomUUID();
    const characters = [randomUUID(), randomUUID()];

    await store.saveBatch(batchOf(sessionId, characters));

    for (const [index, characterId] of characters.entries()) {
      const [found] = await store.pendingFor(characterId);
      expect(found?.endedAtMs).toBe(1_234);
      expect(await redis.pttl(`receipt:${sessionId}:${characterId}:${index + 1}`)).toBeGreaterThan(0);
      expect(await redis.pttl(`receipts:char:v2:${characterId}`)).toBeGreaterThan(0);
    }
  });

  it('keeps several receipts of the SAME character apart, oldest version first, whatever the batch order', async () => {
    // O lote que um `release` falho deixou para o próximo leva o extrato atrasado e o novo do mesmo
    // personagem: os dois entram, e a liquidação os lê em ordem de versão.
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const characterId = randomUUID();

    await store.saveBatch([
      receiptOf(sessionId, characterId, { seq: 3, durableVersion: 8 }),
      receiptOf(sessionId, characterId, { seq: 1, durableVersion: 6 }),
      receiptOf(sessionId, characterId, { seq: 2, durableVersion: 7 }),
    ]);

    expect((await store.pendingFor(characterId)).map((receipt) => receipt.durableVersion)).toEqual([6, 7, 8]);
    expect(await store.highestPendingVersion(characterId)).toBe(8);
  });

  it('writing the same batch again (a lost acknowledgement) neither duplicates nor reorders anything', async () => {
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const characters = [randomUUID(), randomUUID()];
    const batch = batchOf(sessionId, characters);

    await store.saveBatch(batch);
    await store.saveBatch(batch);

    for (const characterId of characters) {
      expect(await redis.zcard(`receipts:char:v2:${characterId}`)).toBe(1);
    }
    expect(await store.pending()).toHaveLength(2);
  });

  it('reports a command that fails INSIDE the transaction, like `save` — and the retry is safe', async () => {
    // O Redis não desfaz os outros comandos de um `MULTI` quando um falha em tempo de execução, mas o
    // erro volta para quem chamou (`exec`), e repetir o lote é idempotente: o chamador mantém os
    // extratos e tenta de novo.
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const [a, b] = [randomUUID(), randomUUID()] as const;
    await redis.set(`receipts:char:v2:${b}`, 'not a sorted set');

    await expect(store.saveBatch(batchOf(sessionId, [a, b]))).rejects.toThrow(/WRONGTYPE/);

    await redis.del(`receipts:char:v2:${b}`);
    await store.saveBatch(batchOf(sessionId, [a, b]));
    expect(await store.pendingFor(a)).toHaveLength(1);
    expect(await store.pendingFor(b)).toHaveLength(1);
  });

  it('round-trips the `checkpoint` reason, and the world fields of a checkpoint line', async () => {
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();

    await store.saveBatch([receiptOf(randomUUID(), characterId, {
      reason: 'checkpoint', durableVersion: 4, townId: 'thais', health: 90, mana: 12,
      worldPosition: { x: 32_369, y: 32_241, z: 7 },
      conditions: [{ key: 'haste', expiresAtMs: 5_000, speedPercent: 30 }],
    })]);

    const [found] = await store.pendingFor(characterId);
    expect(found).toMatchObject({
      reason: 'checkpoint', townId: 'thais', health: 90, mana: 12, worldPosition: { x: 32_369, y: 32_241, z: 7 },
    });
    expect(found?.conditions).toHaveLength(1);
  });
});
