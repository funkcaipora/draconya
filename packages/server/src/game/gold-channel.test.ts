import { CharacterRuntime, Rng, Session } from '@draconya/sim';
import type { Aggregates, CharmBestiaryEntry, Ruleset } from '@draconya/sim';
import { compileItem, itemSchema } from '@draconya/content';
import type { Blessing, Charm, Progression, Spell } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../log.js';
import type { ReceiptStore } from '../receipts.js';
import { TEST_PROGRESSION } from '../testing/content.js';
import { SessionHost } from './host.js';
import type { SessionHostOptions } from './host.js';
import { leavesOnExit } from './ruleset-traits.js';
import { FakeSocket } from './testing.js';

// O canal ÚNICO de gold de uma sessão (OW-04, ADR 0060 d.10c, invariante 10).
//
// A regra, escrita uma vez:
//   - a sessão que credita por agregado move o gold pelo agregado E pelo `goldDelta`, e o
//     `goldDelta` é liquidado depois de gravar o extrato;
//   - a que não credita (a Cidade) manda o `goldDelta` como agregado do extrato de estado;
//   - nunca as duas coisas.
//
// O que se prova aqui é o que o ledger veria: o líquido de `goldGained - goldSpent` de TODOS os
// extratos gravados. É o que o jogador perde se um valor for creditado duas vezes, ou nenhuma.

const logger = createLogger('silent', 'test');

const QUIET = {
  hz: () => 0, onEnter: () => {}, onEvent: () => {}, onCreatureDied: () => {}, onEnd: () => {},
} as const;
/** A hunt: sessão privada. Sair é encerrar; o extrato leva o agregado. */
const HUNT: Ruleset = { type: 'hunt', ...QUIET };
/** A Cidade de hoje: shard que não credita, e não declara `progress`. */
const CITY: Ruleset = { type: 'city', shared: true, ...QUIET };
/**
 * O mundo (OW-13/OW-18): shard que credita. O `type` dele ainda não existe — o que o hospedeiro lê
 * é `shared` e `progress`, e os serviços de Cidade conferem `type === 'city'`; por isso o `type` é
 * o da Cidade, e a diferença entre os dois é UMA linha.
 */
const WORLD: Ruleset = { ...CITY, progress: 'checkpointed' };

const item = (fields: Record<string, unknown>, appearanceId: number) =>
  ({ ...compileItem(itemSchema.parse({ kind: 'other', weight: 1, ...fields })), appearanceId });
const gem = item({ id: 'gem', name: 'Gem', value: 30 }, 3);
const stone = item({ id: 'stone', name: 'Stone', value: 20 }, 4);
const ticket = item({ id: 'ticket', name: 'Ticket', value: 0, purchasable: true, buyPrice: 100 }, 5);
const itemCatalog = new Map([gem, stone, ticket].map((entry) => [entry.id, entry]));

/** Um extrato como o `ReceiptStore` o recebe — só o que estes testes leem. */
interface SavedReceipt {
  readonly sessionId: string;
  readonly characterId: string;
  readonly reason: string;
  readonly seq: number;
  readonly aggregates: Aggregates;
  readonly removedInstances?: readonly string[];
}

interface CharacterOptions {
  readonly level?: number;
  readonly gold?: number;
  readonly vocationId?: string;
}

function build(
  ruleset: Ruleset,
  options: Partial<SessionHostOptions> & { readonly character?: CharacterOptions } = {},
) {
  const { character: characterOptions, ...hostOptions } = options;
  const saved: SavedReceipt[] = [];
  const receipts = { save: async (receipt: SavedReceipt) => { saved.push(receipt); } } as unknown as ReceiptStore;
  // O shard é UMA sessão para todos, como `CityShard.admit`; a privada é uma por personagem.
  let shared: Session | null = null;
  const open = (id: string): Session =>
    new Session({ id, contentVersion: 'v-test', ruleset, rng: Rng.fromSeed(id), createdAtMs: 0 });
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: 'v-test', logger, receipts, itemCatalog,
    ...hostOptions,
    createSession: (characterId) => {
      const session = leavesOnExit(ruleset) ? (shared ??= open('shared-1')) : open(`s-${characterId}`);
      session.enter(new CharacterRuntime({
        id: characterId, position: { x: 0, y: 0, z: 7 },
        health: 100, maxHealth: 100, mana: 10, maxMana: 10,
        level: characterOptions?.level ?? 8, xp: 0, gold: characterOptions?.gold ?? 0,
        ...(characterOptions?.vocationId === undefined ? {} : { vocationId: characterOptions.vocationId }),
        goldDelta: 0, alive: true, cooldowns: {},
      }));
      return session;
    },
  });
  const sessionOf = (characterId: string): Session => {
    const session = host.sessionFor(characterId);
    if (session === undefined) throw new Error(`${characterId} has no session`);
    return session;
  };
  /** Entra e anexa, como o handshake: devolve o visualizador, o personagem e o que chegou ao socket. */
  const enter = async (characterId: string) => {
    await host.prepare(characterId, { level: characterOptions?.level ?? 8, xp: 0 }, `acc-${characterId}`);
    const socket = new FakeSocket();
    const viewer = host.attach(socket, characterId);
    host.flush();
    socket.frames.length = 0;
    const hero = sessionOf(characterId).participants.find((participant) => participant.id === characterId);
    if (hero === undefined) throw new Error(`${characterId} is not a participant`);
    hero.capacity = 1_000;
    const warnings = () => socket.received().flatMap((message) =>
      message.type === 'system-message' && message.level === 'warning' ? [message.text] : []);
    return { viewer, hero, session: sessionOf(characterId), warnings };
  };
  return { host, saved, sessionOf, enter };
}

const give = (hero: CharacterRuntime, instanceId: string, itemId: 'gem' | 'stone') => {
  const added = hero.inventory.add(
    { instanceId, itemId, quantity: 1 }, itemCatalog, hero, { backpackSlots: 0, satchelSlots: 0, row: 1 },
  );
  expect(added.ok).toBe(true);
};

/** O que `hunt.ts` faz ao creditar loot (`hunt.ts:10617-10618`): `goldDelta` E agregado, juntos. */
const lootGold = (session: Session, hero: CharacterRuntime, amount: number) => {
  hero.goldDelta += amount;
  session.credit(hero.id, 'goldGained', amount);
};

/** O que o ledger veria: o líquido de gold de todos os extratos gravados. */
const netGold = (receipts: readonly { readonly aggregates: Aggregates }[]) =>
  receipts.reduce((net, receipt) => net + receipt.aggregates.goldGained - receipt.aggregates.goldSpent, 0);

describe('um canal de gold por sessão (OW-04, ADR 0060 d.10c)', () => {
  describe('a Cidade — shard que não credita: o gold vai só por `goldDelta`', () => {
    it('vender duas vezes, com dois logouts, credita cada venda uma vez só', async () => {
      // O agregado da Cidade é CUMULATIVO e nunca zerado por extrato de estado. Se a venda
      // andasse também por ele, o segundo logout creditaria a venda do primeiro de novo.
      const f = build(CITY);
      await f.enter('p2'); // quem fica, para a mesma cópia da praça viver os dois logouts de p1

      for (const instanceId of ['g1', 'g2']) {
        const { viewer, hero, session } = await f.enter('p1');
        give(hero, instanceId, 'gem');
        f.host.handle(viewer, { type: 'sell-items', instanceIds: [instanceId] });
        f.host.flush();

        expect(hero.goldDelta).toBe(30);
        // A Cidade não passa pelo agregado: nada de `goldGained` na sessão.
        expect(session.aggregatesOf('p1').goldGained).toBe(0);

        await f.host.release('p1', 1000, 'logout');
      }

      expect(f.saved.map((receipt) => receipt.aggregates.goldGained)).toEqual([30, 30]);
      expect(f.saved.map((receipt) => receipt.aggregates.goldSpent)).toEqual([0, 0]);
      expect(f.saved.map((receipt) => receipt.removedInstances)).toEqual([['g1'], ['g2']]);
      // `seq` próprio por extrato (invariante 10): é a chave que o ledger usa para recusar retry.
      // Não é contínuo — o `leave` da Cidade consome um `seq` para o extrato zerado que descarta
      // (`Session.leave`) —, e o ledger exige unicidade, não continuidade.
      expect(new Set(f.saved.map((receipt) => receipt.seq)).size).toBe(2);
      expect(netGold(f.saved)).toBe(60);
    });

    it('liquida o delta ao gravar: a base incorpora a venda e não sobra delta para reler', async () => {
      const f = build(CITY);
      const { viewer, hero } = await f.enter('p1');
      give(hero, 'g1', 'gem');
      f.host.handle(viewer, { type: 'sell-items', instanceIds: ['g1'] });
      f.host.flush();

      await f.host.release('p1', 1000, 'logout');

      expect(hero.goldDelta).toBe(0);
      expect(hero.gold).toBe(30);
    });
  });

  describe('o mundo — shard que credita: o gold vai pelo agregado E pelo `goldDelta`, e uma vez só', () => {
    it('100 de loot + 50 de venda, dois checkpoints e um logout: o ledger soma exatamente 150', async () => {
      // O teste do mundo que a OW-16 herda (plano §4, "um canal de gold"). O checkpoint do
      // hospedeiro ainda não existe; aqui ele é feito à mão, com o que ele fará: o extrato parcial
      // do `sim`, gravado, e DEPOIS `settleGoldDelta`. A OW-16 troca `checkpoint()` pelo dela, e a
      // aritmética que este teste prova — gold que anda pelos dois canais e é contado uma vez —
      // continua sendo o critério.
      const f = build(WORLD);
      const { viewer, hero, session } = await f.enter('p1');
      const checkpoint = () => {
        const receipt = session.checkpoint('p1', 'manual-exit');
        if (receipt === null) throw new Error('the session produced no checkpoint receipt');
        f.saved.push(receipt);
        hero.settleGoldDelta();
      };

      lootGold(session, hero, 100);
      checkpoint();
      expect(hero.goldDelta).toBe(0);

      give(hero, 'g1', 'gem');
      give(hero, 's1', 'stone');
      f.host.handle(viewer, { type: 'sell-items', instanceIds: ['g1', 's1'] });
      f.host.flush();
      expect(hero.goldDelta).toBe(50);
      checkpoint();

      await f.host.release('p1', 1000, 'logout');

      // Um extrato por checkpoint e o da saída: o do meio leva a venda, o último não leva gold.
      expect(f.saved.map((receipt) => netGold([receipt]))).toEqual([100, 50, 0]);
      expect(netGold(f.saved)).toBe(150);
      expect(new Set(f.saved.map((receipt) => receipt.seq)).size).toBe(3);
      expect(f.saved[1]?.removedInstances).toEqual(['g1', 's1']);
      expect(hero.gold).toBe(150);
      expect(hero.goldDelta).toBe(0);
      // O acumulado da sessão continua somando tudo, como depois de qualquer `leave`.
      expect(session.aggregates.goldGained).toBe(150);
    });

    it('100 de loot + 50 de venda e um logout: um extrato só, com 150, e o delta liquidado', async () => {
      const f = build(WORLD);
      const { viewer, hero, session } = await f.enter('p1');
      lootGold(session, hero, 100);
      give(hero, 'g1', 'gem');
      give(hero, 's1', 'stone');
      f.host.handle(viewer, { type: 'sell-items', instanceIds: ['g1', 's1'] });
      f.host.flush();
      expect(hero.goldDelta).toBe(150);
      expect(session.aggregatesOf('p1').goldGained).toBe(150);

      await f.host.release('p1', 1000, 'logout');

      expect(f.saved).toHaveLength(1);
      expect(f.saved[0]).toMatchObject({ characterId: 'p1', reason: 'manual-exit', removedInstances: ['g1', 's1'] });
      expect(f.saved[0]?.aggregates).toMatchObject({ goldGained: 150, goldSpent: 0 });
      // Liquidado: a base incorporou os 150 e não sobra delta para o próximo extrato reler.
      expect(hero.goldDelta).toBe(0);
      expect(hero.gold).toBe(150);
    });

    it('sair e voltar à mesma sessão grava um extrato por saída — nenhum é engolido pelo anterior', async () => {
      // `credited` é uma marca por sessão e personagem, feita para a sessão que sai UMA vez. No
      // mundo o personagem volta à mesma sessão, e a segunda saída tem extrato próprio.
      const f = build(WORLD);
      await f.enter('p2'); // quem mantém a sessão de pé

      for (const instanceId of ['g1', 'g2']) {
        const { viewer, hero } = await f.enter('p1');
        give(hero, instanceId, 'gem');
        f.host.handle(viewer, { type: 'sell-items', instanceIds: [instanceId] });
        f.host.flush();
        await f.host.release('p1', 1000, 'logout');
      }

      expect(f.saved.map((receipt) => receipt.characterId)).toEqual(['p1', 'p1']);
      expect(f.saved.map((receipt) => receipt.aggregates.goldGained)).toEqual([30, 30]);
      expect(f.saved.map((receipt) => receipt.seq)).toEqual([1, 2]);
      expect(netGold(f.saved)).toBe(60);
      // Quem ficou não ganhou nem perdeu nada com a saída do outro.
      expect(f.sessionOf('p2').aggregatesOf('p2').goldGained).toBe(0);
    });

    it('a drenagem sai por extrato de delta, e o `release` que vem logo depois não grava de novo', async () => {
      const f = build(WORLD);
      const { viewer, hero } = await f.enter('p1');
      give(hero, 'g1', 'gem');
      give(hero, 's1', 'stone');
      f.host.handle(viewer, { type: 'sell-items', instanceIds: ['g1', 's1'] });
      f.host.flush();

      expect(await f.host.drainAll()).toBe(1);

      expect(f.saved).toHaveLength(1);
      expect(f.saved[0]).toMatchObject({ reason: 'drain', characterId: 'p1' });
      expect(netGold(f.saved)).toBe(50);
      expect(f.host.sessionFor('p1')).toBeUndefined();
    });

    it('a transição para a hunt grava o extrato de delta antes de trocar, e a hunt parte do saldo liquidado', async () => {
      const hunt = new Session({ id: 'hunt-1', contentVersion: 'v-test', ruleset: HUNT, rng: Rng.fromSeed('h'), createdAtMs: 0 });
      const f = build(WORLD, {
        buildSession: (_request, from, characterId, departed) => {
          const character = from.participants.find((participant) => participant.id === characterId) ?? departed;
          if (character === undefined) return null;
          hunt.enter(character);
          return hunt;
        },
      });
      await f.enter('p2'); // o mundo continua de pé para quem fica
      const { viewer, hero, session } = await f.enter('p1');
      lootGold(session, hero, 100);
      give(hero, 'g1', 'gem');
      give(hero, 's1', 'stone');
      f.host.handle(viewer, { type: 'sell-items', instanceIds: ['g1', 's1'] });
      f.host.flush();

      await f.host.transition('p1', { to: 'hunt', huntId: 'arena' });

      expect(f.saved).toHaveLength(1);
      expect(f.saved[0]).toMatchObject({ sessionId: 'shared-1', characterId: 'p1', reason: 'manual-exit' });
      expect(netGold(f.saved)).toBe(150);
      expect(f.host.sessionFor('p1')?.ruleset.type).toBe('hunt');
      expect(session.participants.map((participant) => participant.id)).toEqual(['p2']);
      // A hunt parte de uma base que já inclui a venda: o delta não é lido uma segunda vez.
      expect(hero.gold).toBe(150);
      expect(hero.goldDelta).toBe(0);
      expect(hunt.aggregatesOf('p1').goldGained).toBe(0);
    });

    it('o estado pendente (`dirty`) vai INTEIRO no extrato de delta, e a saída não passa pelo extrato de estado', async () => {
      const f = build(WORLD);
      const { viewer, hero } = await f.enter('p1');
      give(hero, 'g1', 'gem');
      f.host.handle(viewer, { type: 'discard-item', instanceId: 'g1' });
      f.host.flush();

      await expect(f.host.release('p1', 1000, 'logout')).resolves.toBeUndefined();

      expect(f.saved).toHaveLength(1);
      expect(f.saved[0]).toMatchObject({ reason: 'manual-exit', removedInstances: ['g1'] });
      expect(netGold(f.saved)).toBe(0);
    });
  });

  describe('a hunt — sessão privada: não muda nada', () => {
    it('vender credita agregado E goldDelta, e o extrato do fim leva os dois como UM crédito', async () => {
      const f = build(HUNT);
      const { viewer, hero, session } = await f.enter('p1');
      give(hero, 'g1', 'gem');
      f.host.handle(viewer, { type: 'sell-items', instanceIds: ['g1'] });
      f.host.flush();
      expect(hero.goldDelta).toBe(30);
      expect(session.aggregatesOf('p1').goldGained).toBe(30);

      await f.host.release('p1', 1000, 'logout');

      expect(f.saved).toHaveLength(1);
      expect(f.saved[0]?.aggregates.goldGained).toBe(30);
      expect(hero.goldDelta).toBe(0);
      expect(hero.gold).toBe(30);
    });
  });

  describe('os serviços de gold fora do loot seguem o canal da sessão', () => {
    // Para cada serviço: o que o `goldDelta` e o agregado da sessão mostram depois dele. O
    // `goldDelta` sempre se move; o agregado só quando a sessão credita por agregado.
    type Outcome = { readonly delta: number; readonly gained: number; readonly spent: number };
    const SESSIONS = {
      hunt: HUNT, city: CITY, world: WORLD,
    } as const;

    const observe = (hero: CharacterRuntime, session: Session): Outcome => ({
      delta: hero.goldDelta,
      gained: session.aggregatesOf(hero.id).goldGained,
      spent: session.aggregatesOf(hero.id).goldSpent,
    });

    it.each([
      ['hunt', 30, 30], ['city', 30, 0], ['world', 30, 30],
    ] as const)('vender, na sessão %s: delta %i, agregado %i', async (kind, delta, gained) => {
      const f = build(SESSIONS[kind]);
      const { viewer, hero, session } = await f.enter('p1');
      give(hero, 'g1', 'gem');

      f.host.handle(viewer, { type: 'sell-items', instanceIds: ['g1'] });
      f.host.flush();

      expect(observe(hero, session)).toEqual({ delta, gained, spent: 0 });
    });

    describe('remover um Charm (level × 100)', () => {
      const wound: Charm = {
        id: 'wound', name: 'Wound', canaryCharmId: 0, category: 'major', type: 'offensive',
        damageType: 'physical', percent: 5, chance: [5, 10, 11], points: [10, 20, 30],
      };
      const charmBestiaryEntries = new Map<string, CharmBestiaryEntry>([['rat', { toKill: 1, charmsPoints: 20 }]]);

      it.each([
        ['hunt', -800, 800], ['city', -800, 0], ['world', -800, 800],
      ] as const)('na sessão %s: delta %i, gasto no agregado %i', async (kind, delta, spent) => {
        const f = build(SESSIONS[kind], {
          charmCatalog: new Map([[wound.id, wound]]), charmBestiaryEntries, character: { gold: 1_000 },
        });
        const { viewer, hero, session } = await f.enter('p1');
        hero.bestiary.record('rat');
        f.host.handle(viewer, { type: 'charm-unlock', charmId: 'wound' });
        f.host.handle(viewer, { type: 'charm-assign', charmId: 'wound', monsterId: 'rat' });
        f.host.flush();
        expect(observe(hero, session)).toEqual({ delta: 0, gained: 0, spent: 0 });

        f.host.handle(viewer, { type: 'charm-remove', charmId: 'wound' });
        f.host.flush();

        expect(observe(hero, session)).toEqual({ delta, gained: 0, spent });
      });
    });

    describe('aprender uma magia', () => {
      const berserk: Spell = {
        id: 'berserk', name: 'Berserk', manaCost: 115, cooldownMs: 4_000, minLevel: 35, vocationId: 'knight',
        learnPrice: 2_500, effect: { kind: 'heal', amount: 10, target: 'self' },
      };

      it.each([
        ['hunt', -2_500, 2_500], ['city', -2_500, 0], ['world', -2_500, 2_500],
      ] as const)('na sessão %s: delta %i, gasto no agregado %i', async (kind, delta, spent) => {
        const f = build(SESSIONS[kind], {
          spellCatalog: new Map([[berserk.id, berserk]]),
          character: { level: 40, gold: 10_000, vocationId: 'knight' },
        });
        const { viewer, hero, session } = await f.enter('p1');

        f.host.handle(viewer, { type: 'learn-spell', spellId: 'berserk' });
        f.host.flush();

        expect(hero.learnedSpells.has('berserk')).toBe(true);
        expect(observe(hero, session)).toEqual({ delta, gained: 0, spent });
      });
    });

    describe('comprar uma bênção (serviço de Cidade)', () => {
      const spark: Blessing = { id: 'spark', name: 'Spark of the Phoenix', order: 0, enhanced: false };
      // Level 25 cai na faixa fixa (21–30): 2.000.
      const progression = {
        ...TEST_PROGRESSION,
        blessingPricing: {
          freeBelowLevel: 21, flatUntilLevel: 30, flatPrice: 2_000, highFromLevel: 120, midOffset: 20,
          midMultiplier: 200, midEnhancedMultiplier: 260, highBase: 20_000, highEnhancedBase: 26_000,
          highMultiplier: 75, highEnhancedMultiplier: 100,
        },
      } as unknown as Progression;

      it.each([
        ['city', -2_000, 0], ['world', -2_000, 2_000],
      ] as const)('na sessão %s: delta %i, gasto no agregado %i', async (kind, delta, spent) => {
        const f = build(SESSIONS[kind], {
          blessingCatalog: new Map([[spark.id, spark]]), progression, character: { level: 25, gold: 5_000 },
        });
        const { viewer, hero, session } = await f.enter('p1');

        f.host.handle(viewer, { type: 'buy-blessing', blessingId: 'spark' });
        f.host.flush();

        expect(hero.blessings).toBe(1);
        expect(observe(hero, session)).toEqual({ delta, gained: 0, spent });
      });

      it('na hunt é recusada, e nada se move', async () => {
        const f = build(HUNT, {
          blessingCatalog: new Map([[spark.id, spark]]), progression, character: { level: 25, gold: 5_000 },
        });
        const { viewer, hero, session, warnings } = await f.enter('p1');

        f.host.handle(viewer, { type: 'buy-blessing', blessingId: 'spark' });
        f.host.flush();

        expect(warnings()).toEqual(['Bênçãos só se compram na Cidade.']);
        expect(hero.blessings).toBe(0);
        expect(observe(hero, session)).toEqual({ delta: 0, gained: 0, spent: 0 });
      });
    });

    describe('promover a vocação (serviço de Cidade)', () => {
      const promotableKnight = {
        id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25,
        startingWeaponItemId: 'steel-axe', spellSkill: 'magic', startingKit: [], skillMultipliers: {},
        meleeDamageMultiplier: 1, distDamageMultiplier: 1, soulMax: 100, soulGainTicksMs: 120000,
        promotion: {
          name: 'Elite Knight',
          regen: { health: { ticksMs: 4000, amount: 1 }, mana: { ticksMs: 6000, amount: 2 } },
          minLevel: 20, price: 20_000,
        },
      };
      const vocations = new Map([[promotableKnight.id, promotableKnight]]);

      it.each([
        ['city', -20_000, 0], ['world', -20_000, 20_000],
      ] as const)('na sessão %s: delta %i, gasto no agregado %i', async (kind, delta, spent) => {
        const f = build(SESSIONS[kind], {
          vocations, vocationLevel: 8, character: { level: 20, gold: 20_000, vocationId: 'knight' },
        });
        const { viewer, hero, session } = await f.enter('p1');

        f.host.handle(viewer, { type: 'promote-vocation' });
        f.host.flush();

        expect(hero.promoted).toBe(true);
        expect(observe(hero, session)).toEqual({ delta, gained: 0, spent });
      });
    });

    describe('comprar um item (serviço de Cidade)', () => {
      it.each([
        ['city', -100, 0], ['world', -100, 100],
      ] as const)('na sessão %s: delta %i, gasto no agregado %i', async (kind, delta, spent) => {
        const f = build(SESSIONS[kind], { character: { gold: 500 } });
        const { viewer, hero, session } = await f.enter('p1');

        f.host.handle(viewer, { type: 'buy-item', itemId: 'ticket' });
        f.host.flush();

        expect(hero.inventory.findStack('ticket')).not.toBeNull();
        expect(observe(hero, session)).toEqual({ delta, gained: 0, spent });
      });
    });
  });
});
