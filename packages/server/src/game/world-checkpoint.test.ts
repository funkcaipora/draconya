import { CharacterRuntime, Rng, Session } from '@draconya/sim';
import type { Aggregates, CarriedItem, ConditionState, Point, Ruleset } from '@draconya/sim';
import { compileItem, itemSchema } from '@draconya/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../log.js';
import type { ReceiptStore } from '../receipts.js';
import { SessionHost } from './host.js';
import type { SessionHostOptions } from './host.js';
import { FakeSocket } from './testing.js';
import { WORLD_CHECKPOINT_MS } from './world-checkpoint.js';

// O checkpoint do mundo no hospedeiro (#837, OW-16, ADR 0060 d.10d, invariante 10).
//
// O que se prova aqui é o que o Redis veria: QUANTOS lotes, com QUE linhas, e se o que o personagem
// rendeu entra uma vez só — nem duas (retry), nem nenhuma (falha, queda). A loja de extratos é um
// espião que guarda cada `saveBatch`; o do Redis de verdade e o do Postgres são de
// `receipts.test.ts` e `world-checkpoint.postgres.test.ts`.

const logger = createLogger('silent', 'test');

const QUIET = {
  hz: () => 0, onEnter: () => {}, onEvent: () => {}, onCreatureDied: () => {}, onEnd: () => {},
} as const;
const HUNT: Ruleset = { type: 'hunt', ...QUIET };
const CITY: Ruleset = { type: 'city', shared: true, ...QUIET };

/** A origem do recorte em coordenada absoluta: o `source.region` do mapa, em miniatura. */
const ORIGIN = { x: 32_000, y: 32_100 } as const;
/**
 * O que o `WorldRuleset` responde de verdade (`worldPositionOf`): o tile local traduzido pela origem do
 * recorte. Em espalhamento, e não como propriedade do literal: o `Ruleset` genérico não a declara
 * (`world-checkpoint.ts` a consulta por forma), e o literal não a passaria na checagem de excesso.
 */
const POSITIONED = {
  worldPositionOf: (character: CharacterRuntime): Point => ({
    x: ORIGIN.x + character.position.x, y: ORIGIN.y + character.position.y, z: character.position.z,
  }),
};
/**
 * O mundo: shard que credita e checkpointa. O `type` é o da Cidade por um motivo que o
 * `gold-channel.test.ts` explica — os serviços de Cidade ainda conferem `type === 'city'`, e a troca
 * por `acceptsCityServices` é da OW-18.
 */
const WORLD: Ruleset = { ...CITY, progress: 'checkpointed', ...POSITIONED };

const gem = {
  ...compileItem(itemSchema.parse({ kind: 'other', weight: 1, id: 'gem', name: 'Gem', value: 30 })),
  appearanceId: 3,
};
/** Empilhável: o que o personagem pega e come, e o que o `acquired` cumulativo do mundo repete. */
const cheese = {
  ...compileItem(itemSchema.parse({
    kind: 'other', weight: 1, id: 'cheese', name: 'Cheese', value: 5, stackable: true,
  })),
  appearanceId: 4,
};
const itemCatalog = new Map([gem, cheese].map((entry) => [entry.id, entry]));
const ROOM = { backpackSlots: 0, satchelSlots: 0, row: 1 } as const;

/** Um extrato como o `ReceiptStore` o recebe — só o que estes testes leem. */
interface SavedReceipt {
  readonly sessionId: string;
  readonly characterId: string;
  readonly reason: string;
  readonly seq: number;
  readonly durableVersion?: number;
  readonly aggregates: Aggregates;
  readonly removedInstances?: readonly string[];
  readonly acquired?: readonly { readonly instanceId: string; readonly itemId: string; readonly quantity: number }[];
  readonly quantities?: Readonly<Record<string, number>>;
  readonly worldPosition?: Point | null;
  readonly townId?: string;
  readonly health?: number;
  readonly mana?: number;
  readonly conditions?: readonly ConditionState[];
}

interface CharacterOptions {
  readonly position?: Point;
  readonly health?: number;
  readonly townId?: string;
  /** O que ele traz do ticket na mochila (o que um login anterior deixou no banco). */
  readonly carrying?: readonly CarriedItem[];
}

interface Fixture {
  readonly host: SessionHost;
  readonly session: Session;
  /** Todo `saveBatch` recebido, em ordem. */
  readonly batches: SavedReceipt[][];
  /** Todo `save` recebido — o mundo não deve usá-lo. */
  readonly singles: SavedReceipt[];
  readonly enter: (characterId: string, options?: CharacterOptions) => Promise<Entered>;
  readonly heroOf: (characterId: string) => CharacterRuntime;
}

interface Entered {
  readonly viewer: ReturnType<SessionHost['attach']>;
  readonly hero: CharacterRuntime;
}

/** O `Fixture.batches` achatado: toda linha que chegou ao Redis, na ordem. */
const linesOf = (f: Fixture): SavedReceipt[] => f.batches.flat();
const only = <T,>(items: readonly T[]): T => {
  expect(items).toHaveLength(1);
  return items[0] as T;
};
/** O líquido de gold do que o ledger veria. */
const netGold = (receipts: readonly { readonly aggregates: Aggregates }[]) =>
  receipts.reduce((net, receipt) => net + receipt.aggregates.goldGained - receipt.aggregates.goldSpent, 0);

function build(
  ruleset: Ruleset = WORLD,
  options: Partial<SessionHostOptions> & {
    /** Troca a loja de extratos (o espião padrão guarda `saveBatch`). */
    readonly store?: (batches: SavedReceipt[][], singles: SavedReceipt[]) => unknown;
  } = {},
): Fixture {
  const { store, ...hostOptions } = options;
  const batches: SavedReceipt[][] = [];
  const singles: SavedReceipt[] = [];
  const receipts = (store?.(batches, singles) ?? {
    save: async (receipt: SavedReceipt) => { singles.push(receipt); },
    saveBatch: async (batch: readonly SavedReceipt[]) => { batches.push([...batch]); },
  }) as ReceiptStore;
  // O mundo é UMA sessão para todos, como `WorldShard`; a hunt é uma por personagem.
  const session = new Session({ id: 'world-1', contentVersion: 'v-test', ruleset, rng: Rng.fromSeed('w'), createdAtMs: 0 });
  const pending = new Map<string, CharacterOptions>();
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: 'v-test', logger, receipts, itemCatalog,
    ...hostOptions,
    createSession: (characterId) => {
      const chosen = pending.get(characterId) ?? {};
      session.enter(new CharacterRuntime({
        id: characterId, position: chosen.position ?? { x: 10, y: 10, z: 7 },
        health: chosen.health ?? 100, maxHealth: 100, mana: 10, maxMana: 10,
        level: 8, xp: 0, gold: 0, goldDelta: 0, alive: true, cooldowns: {},
        ...(chosen.townId === undefined ? {} : { townId: chosen.townId }),
        ...(chosen.carrying === undefined ? {} : { inventory: { backpack: [...chosen.carrying], equipped: {} } }),
      }));
      return session;
    },
  });
  const heroOf = (characterId: string): CharacterRuntime => {
    const hero = session.participants.find((participant) => participant.id === characterId);
    if (hero === undefined) throw new Error(`${characterId} is not in the world`);
    return hero;
  };
  const enter = async (characterId: string, chosen: CharacterOptions = {}): Promise<Entered> => {
    pending.set(characterId, chosen);
    await host.prepare(characterId, { level: 8, xp: 0 }, `acc-${characterId}`);
    const socket = new FakeSocket();
    const viewer = host.attach(socket, characterId);
    host.flush();
    const hero = heroOf(characterId);
    hero.capacity = 1_000;
    return { viewer, hero };
  };
  return { host, session, batches, singles, enter, heroOf };
}

/** O que `hunt.ts` faz ao creditar loot: `goldDelta` E agregado, juntos. */
const lootGold = (session: Session, hero: CharacterRuntime, amount: number) => {
  hero.goldDelta += amount;
  session.credit(hero.id, 'goldGained', amount);
};

afterEach(() => { vi.useRealTimers(); });

describe('o checkpoint do mundo no hospedeiro (#837, OW-16)', () => {
  describe('quando: um lote a cada `worldCheckpointMs`', () => {
    it('o padrão é 60 s (ADR 0060 d.10d)', () => {
      expect(WORLD_CHECKPOINT_MS).toBe(60_000);
    });

    it('o timer grava o lote na cadência configurada — nem antes, nem a cada ciclo de 100 ms', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const f = build(WORLD, { worldCheckpointMs: 5_000 });
      const { hero } = await f.enter('p1');
      f.host.start();
      try {
        lootGold(f.session, hero, 100);

        await vi.advanceTimersByTimeAsync(4_999);
        expect(f.batches).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(f.batches).toHaveLength(1);
        expect(netGold(linesOf(f))).toBe(100);

        // Nada mudou desde o último lote: o próximo tique não grava nada.
        await vi.advanceTimersByTimeAsync(5_000);
        expect(f.batches).toHaveLength(1);

        lootGold(f.session, hero, 25);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(f.batches).toHaveLength(2);
        expect(netGold(linesOf(f))).toBe(125);
      } finally {
        f.host.stop();
      }
    });

    it('`stop` desliga o timer: nenhum lote sai depois dele', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const f = build(WORLD, { worldCheckpointMs: 5_000 });
      const { hero } = await f.enter('p1');
      f.host.start();
      f.host.stop();
      lootGold(f.session, hero, 100);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(f.batches).toHaveLength(0);
    });

    it('sem a opção, o timer usa os 60 s', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const f = build(WORLD);
      const { hero } = await f.enter('p1');
      f.host.start();
      try {
        lootGold(f.session, hero, 100);
        await vi.advanceTimersByTimeAsync(WORLD_CHECKPOINT_MS - 1);
        expect(f.batches).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(f.batches).toHaveLength(1);
      } finally {
        f.host.stop();
      }
    });
  });

  describe('quem: o personagem sujo — e só ele', () => {
    it('um lote só: todo sujo vai num `saveBatch`, e quem não mexeu em nada não gera linha', async () => {
      const f = build();
      const p1 = await f.enter('p1');
      const p2 = await f.enter('p2');
      await f.enter('p3'); // parado, sem render nada
      lootGold(f.session, p1.hero, 100);
      p2.hero.position = { x: 11, y: 10, z: 7 };

      await f.host.checkpointWorlds();

      const batch = only(f.batches);
      expect(batch.map((line) => line.characterId).sort()).toEqual(['p1', 'p2']);
      expect(batch.every((line) => line.reason === 'checkpoint')).toBe(true);
      // `save` (um extrato por `MULTI`) é o caminho da hunt: o mundo grava só em lote.
      expect(f.singles).toEqual([]);
    });

    it('personagem parado na PZ não gera linha — nem no primeiro lote, nem nos seguintes', async () => {
      const f = build();
      await f.enter('p1');

      await f.host.checkpointWorlds();
      await f.host.checkpointWorlds();

      expect(f.batches).toEqual([]);
    });

    it('depois de gravado, o personagem volta a "limpo": o lote seguinte só leva o que mudou de novo', async () => {
      const f = build();
      const { hero } = await f.enter('p1');
      hero.position = { x: 11, y: 10, z: 7 };

      await f.host.checkpointWorlds();
      await f.host.checkpointWorlds();
      expect(f.batches).toHaveLength(1);

      hero.position = { x: 12, y: 10, z: 7 };
      await f.host.checkpointWorlds();
      expect(f.batches).toHaveLength(2);
    });

    // O que torna um personagem sujo. Cada linha muda UMA coisa; a de baixo (`unchanged`) é o controle.
    it.each([
      ['moveu', (f: Fixture, hero: CharacterRuntime) => { hero.position = { x: 11, y: 10, z: 7 }; void f; }],
      ['perdeu vida', (_f: Fixture, hero: CharacterRuntime) => { hero.health -= 10; }],
      ['gastou mana', (_f: Fixture, hero: CharacterRuntime) => { hero.mana -= 3; }],
      ['ganhou uma condição', (_f: Fixture, hero: CharacterRuntime) => {
        hero.conditions.replace({ key: 'haste', expiresAtMs: 8_000, speedPercent: 30 });
      }],
      ['ganhou XP', (f: Fixture, hero: CharacterRuntime) => { f.session.credit(hero.id, 'xpGained', 40); }],
      ['abateu um monstro', (f: Fixture, hero: CharacterRuntime) => { f.session.credit(hero.id, 'kills', 1); }],
      ['gastou gold', (f: Fixture, hero: CharacterRuntime) => { f.session.credit(hero.id, 'goldSpent', 5); }],
      ['causou dano', (f: Fixture, hero: CharacterRuntime) => { f.session.credit(hero.id, 'damageDealt', 12); }],
      ['vendeu uma instância', (_f: Fixture, hero: CharacterRuntime) => { hero.removedInstances.push('i1'); }],
    ] as const)('%s → sujo', async (_name, change) => {
      const f = build();
      const { hero } = await f.enter('p1');

      change(f, hero);
      await f.host.checkpointWorlds();

      expect(only(f.batches)).toHaveLength(1);
    });

    it('mexer em estado durável por uma intenção (`dirty`) suja: descartar uma instância', async () => {
      const f = build();
      const { viewer, hero } = await f.enter('p1');
      hero.inventory.add(
        { instanceId: 'g1', itemId: 'gem', quantity: 1 }, itemCatalog, hero, { backpackSlots: 0, satchelSlots: 0, row: 1 },
      );

      f.host.handle(viewer, { type: 'discard-item', instanceId: 'g1' });
      f.host.flush();
      await f.host.checkpointWorlds();

      expect(only(only(f.batches)).removedInstances).toEqual(['g1']);
    });

    it('o tempo passando não suja: `durationMs` corre para todo presente e não é rendimento', async () => {
      const f = build();
      await f.enter('p1');

      f.session.advanceBy(60_000);
      await f.host.checkpointWorlds();

      expect(f.session.aggregatesOf('p1').durationMs).toBe(60_000);
      expect(f.batches).toEqual([]);
    });

    it('uma condição que só ENVELHECE não suja — a que entra ou sai, sim', async () => {
      const f = build();
      const { hero } = await f.enter('p1');
      hero.conditions.replace({ key: 'haste', expiresAtMs: 8_000, speedPercent: 30 });
      await f.host.checkpointWorlds();
      expect(f.batches).toHaveLength(1);

      // O prazo restante encolhe a cada segundo; comparar prazo deixaria toda haste ativa suja para sempre.
      hero.conditions.replace({ key: 'haste', expiresAtMs: 4_000, speedPercent: 30 });
      await f.host.checkpointWorlds();
      expect(f.batches).toHaveLength(1);

      hero.conditions.replace({ key: 'poison', expiresAtMs: 4_000 });
      await f.host.checkpointWorlds();
      expect(f.batches).toHaveLength(2);
    });

    it('sem visualizador o lote sai igual: o que decide é o personagem, nunca quem olha (invariante 3)', async () => {
      const f = build();
      const { viewer, hero } = await f.enter('p1');
      f.host.detach(viewer);
      expect(f.host.viewersOf('p1')).toBe(0);

      lootGold(f.session, hero, 100);
      hero.position = { x: 11, y: 10, z: 7 };
      await f.host.checkpointWorlds();

      expect(netGold(linesOf(f))).toBe(100);
    });

    it('quem sai e volta entra com a base nova: não vira sujo só por ter chegado', async () => {
      const f = build();
      await f.enter('p1');
      await f.enter('p2');
      await f.host.release('p1', 1000, 'logout');
      f.batches.length = 0;

      await f.enter('p1');
      await f.host.checkpointWorlds();

      expect(f.batches).toEqual([]);
    });
  });

  describe('o quê: o extrato inteiro, mais a âncora, a cidade, a vida, a mana e as condições', () => {
    it('com `OPEN_WORLD`, a linha leva o mundo e os vitais do dono — a âncora é a posição de AGORA', async () => {
      const f = build(WORLD, { openWorld: true });
      const { hero } = await f.enter('p1', { townId: 'thais', position: { x: 94, y: 88, z: 7 } });
      hero.health = 42;
      hero.mana = 3;
      hero.conditions.replace({ key: 'haste', expiresAtMs: 8_000, speedPercent: 30 });
      hero.position = { x: 94, y: 97, z: 7 };

      await f.host.checkpointWorlds();

      const line = only(only(f.batches));
      expect(line).toMatchObject({
        characterId: 'p1', townId: 'thais', health: 42, mana: 3,
        worldPosition: { x: ORIGIN.x + 94, y: ORIGIN.y + 97, z: 7 },
        conditions: [{ key: 'haste', expiresAtMs: 8_000, speedPercent: 30 }],
      });
      // E a âncora do dono é a que a linha leva: o login seguinte volta ao mesmo tile.
      expect(hero.worldPosition).toEqual({ x: ORIGIN.x + 94, y: ORIGIN.y + 97, z: 7 });
    });

    it('sem `OPEN_WORLD`, a linha é a de antes — nenhum campo de mundo é gravado', async () => {
      const f = build(WORLD);
      const { hero } = await f.enter('p1', { townId: 'thais' });
      hero.position = { x: 94, y: 97, z: 7 };

      await f.host.checkpointWorlds();

      const line = only(only(f.batches));
      for (const field of ['worldPosition', 'townId', 'health', 'mana', 'conditions'] as const) {
        expect(line).not.toHaveProperty(field);
      }
    });

    it('cada checkpoint leva só o que rendeu desde o anterior — o gold do primeiro não volta no segundo', async () => {
      const f = build();
      const { hero } = await f.enter('p1');

      lootGold(f.session, hero, 100);
      await f.host.checkpointWorlds();
      lootGold(f.session, hero, 25);
      await f.host.checkpointWorlds();

      expect(linesOf(f).map((line) => line.aggregates.goldGained)).toEqual([100, 25]);
      expect(linesOf(f).map((line) => line.reason)).toEqual(['checkpoint', 'checkpoint']);
    });

    it('cada extrato tem o `seq` próprio, e a versão durável do personagem sobe a cada um (invariante 10)', async () => {
      const f = build();
      await f.host.prepare('p1', { level: 8, xp: 0, durableVersion: 5 }, 'acc-p1');
      const hero = f.heroOf('p1');
      f.host.attach(new FakeSocket(), 'p1');

      for (let step = 0; step < 3; step += 1) {
        lootGold(f.session, hero, 10);
        await f.host.checkpointWorlds();
      }
      await f.host.release('p1', 1000, 'logout');

      const lines = linesOf(f);
      expect(lines.map((line) => line.seq)).toEqual([1, 2, 3, 4]);
      expect(lines.map((line) => line.durableVersion)).toEqual([6, 7, 8, 9]);
      expect(new Set(lines.map((line) => `${line.sessionId}:${line.seq}`)).size).toBe(4);
      expect(netGold(lines)).toBe(30);
    });
  });

  describe('o inventário: a pilha que muda depois do primeiro checkpoint (#837)', () => {
    // O `acquired` é CUMULATIVO — a sessão do mundo nunca termina, e todo item que o personagem pega nela
    // leva o prefixo dela — e o ledger o insere sem tocar na linha que já existe. A quantidade e o que
    // acabou chegam por `quantities` e `removedInstances`.
    const stack = 'world-1:p1:0';
    const pickUp = (hero: CharacterRuntime, quantity: number, instanceId = stack) => {
      const added = hero.inventory.add({ instanceId, itemId: 'cheese', quantity }, itemCatalog, hero, ROOM);
      expect(added.ok).toBe(true);
    };

    it('cada linha leva a quantidade de AGORA de toda instância carregada — a pilha cresce e diminui', async () => {
      const f = build();
      const { hero } = await f.enter('p1');

      pickUp(hero, 1);
      await f.host.checkpointWorlds();
      pickUp(hero, 2); // o loot empilha: a instância é a mesma, a quantidade é 3
      await f.host.checkpointWorlds();
      hero.inventory.consumeOne(stack);
      await f.host.checkpointWorlds();

      const lines = linesOf(f);
      expect(lines.map((line) => line.quantities)).toEqual([{ [stack]: 1 }, { [stack]: 3 }, { [stack]: 2 }]);
      // O `acquired` repete a instância a cada linha — é o que o ledger não pode tomar por quantidade nova.
      expect(lines.map((line) => line.acquired?.map((item) => item.instanceId))).toEqual([[stack], [stack], [stack]]);
    });

    it('mexer SÓ no inventário suja: comer na PZ, sem render nada, chega ao banco', async () => {
      const f = build();
      const { hero } = await f.enter('p1');
      pickUp(hero, 3);
      await f.host.checkpointWorlds();
      expect(f.batches).toHaveLength(1);

      hero.inventory.consumeOne(stack); // nenhum agregado, nenhuma posição, nenhuma vida
      await f.host.checkpointWorlds();

      expect(f.batches).toHaveLength(2);
      expect(linesOf(f)[1]?.quantities).toEqual({ [stack]: 2 });

      // E depois de gravado volta a limpo.
      await f.host.checkpointWorlds();
      expect(f.batches).toHaveLength(2);
    });

    it('a pilha que acabou sai por `removedInstances`, mesmo sem o `sim` a reportar — comer não a reporta', async () => {
      const f = build();
      const { hero } = await f.enter('p1');
      pickUp(hero, 1);
      await f.host.checkpointWorlds();

      expect(hero.inventory.consumeOne(stack)?.quantity).toBe(1);
      expect(hero.removedInstances).toEqual([]); // o `sim` não a contou
      await f.host.checkpointWorlds();

      const line = linesOf(f)[1];
      expect(line?.removedInstances).toEqual([stack]);
      expect(line?.quantities).toEqual({});
      expect(line?.acquired).toEqual([]);
    });

    it('vale também para a pilha que o personagem trouxe de um login anterior: o prefixo da sessão não decide', async () => {
      const f = build();
      // Veio do ticket: o id é de outra sessão, então NÃO está no `acquired` — e está na base de chegada.
      const { hero } = await f.enter('p1', {
        carrying: [{ instanceId: 'hunt-7:p1:3', itemId: 'cheese', quantity: 5 }],
      });

      hero.inventory.consumeOne('hunt-7:p1:3');
      await f.host.checkpointWorlds();
      for (let eaten = 0; eaten < 4; eaten += 1) hero.inventory.consumeOne('hunt-7:p1:3');
      await f.host.checkpointWorlds();

      const lines = linesOf(f);
      expect(lines[0]?.quantities).toEqual({ 'hunt-7:p1:3': 4 });
      expect(lines[0]?.acquired).toEqual([]);
      expect(lines[1]?.removedInstances).toEqual(['hunt-7:p1:3']);
      expect(lines[1]?.quantities).toEqual({});
    });

    it('o que o personagem NUNCA carregou não é removido: só entra o que estava no inventário e saiu', async () => {
      const f = build();
      const { hero } = await f.enter('p1');
      hero.position = { x: 11, y: 10, z: 7 };

      await f.host.checkpointWorlds();

      expect(only(only(f.batches)).removedInstances).toBeUndefined();
    });

    it('o que o `sim` reportou e já saiu do inventário não duplica o id', async () => {
      const f = build();
      const { viewer, hero } = await f.enter('p1');
      pickUp(hero, 1, 'g1');
      await f.host.checkpointWorlds();

      f.host.handle(viewer, { type: 'discard-item', instanceId: 'g1' });
      f.host.flush();
      await f.host.checkpointWorlds();

      expect(linesOf(f)[1]?.removedInstances).toEqual(['g1']);
    });

    it('a linha de saída leva a diferença do inventário — comer a última antes de sair não ressuscita no login', async () => {
      const f = build();
      const { hero } = await f.enter('p1');
      pickUp(hero, 1);
      await f.host.checkpointWorlds();

      hero.inventory.consumeOne(stack);
      await f.host.release('p1', 1000, 'logout');

      const exit = linesOf(f).find((line) => line.reason === 'manual-exit');
      expect(exit?.removedInstances).toEqual([stack]);
      expect(exit?.quantities).toEqual({});
    });

    it('a diferença é contra o último extrato MONTADO: o lote que falhou volta inteiro e o seguinte não a repete', async () => {
      let down = false;
      const f = build(WORLD, {
        store: (batches) => ({
          save: async () => {},
          saveBatch: async (batch: readonly SavedReceipt[]) => {
            if (down) throw new Error('Redis unavailable');
            batches.push([...batch]);
          },
        }),
      });
      const { hero } = await f.enter('p1');
      pickUp(hero, 1);
      await f.host.checkpointWorlds();

      down = true;
      hero.inventory.consumeOne(stack);
      await f.host.checkpointWorlds(); // a linha com o `removedInstances` fica em `unsaved`
      down = false;
      pickUp(hero, 4, 'world-1:p1:1');
      await f.host.checkpointWorlds();

      // A linha atrasada vai na frente, com o que ela leva; a nova só leva o que é dela.
      const lines = linesOf(f);
      expect(lines.map((line) => line.removedInstances)).toEqual([undefined, [stack], undefined]);
      expect(lines[2]?.quantities).toEqual({ 'world-1:p1:1': 4 });
    });

    it('a hunt não leva `quantities` nem a diferença: o extrato dela é o de antes, byte a byte', async () => {
      const f = build(HUNT);
      const { hero } = await f.enter('p1');
      pickUp(hero, 2);
      hero.inventory.consumeOne(stack);
      lootGold(f.session, hero, 10);

      await f.host.release('p1', 1000, 'logout');

      const line = only(f.singles);
      expect(line.quantities).toBeUndefined();
      expect(line.removedInstances).toBeUndefined();
      expect(f.batches).toEqual([]);
    });
  });

  describe('o gold: um canal só, liquidado depois de gravar', () => {
    it('o `goldDelta` só é liquidado depois de o lote pousar', async () => {
      let land: () => void = () => {};
      const gate = new Promise<void>((resolve) => { land = resolve; });
      const f = build(WORLD, {
        store: (batches) => ({
          saveBatch: async (batch: readonly SavedReceipt[]) => { await gate; batches.push([...batch]); },
        }),
      });
      const { hero } = await f.enter('p1');
      lootGold(f.session, hero, 100);

      const checkpointing = f.host.checkpointWorlds();
      await Promise.resolve();
      await Promise.resolve();
      expect(hero.goldDelta).toBe(100); // o lote ainda não pousou

      land();
      await checkpointing;

      expect(hero.goldDelta).toBe(0);
      expect(hero.gold).toBe(100);
    });

    it('o que o personagem ganha ENQUANTO o lote voa não se perde: entra no lote seguinte, uma vez', async () => {
      let land: () => void = () => {};
      const gate = new Promise<void>((resolve) => { land = resolve; });
      let first = true;
      const f = build(WORLD, {
        store: (batches) => ({
          saveBatch: async (batch: readonly SavedReceipt[]) => {
            if (first) { first = false; await gate; }
            batches.push([...batch]);
          },
        }),
      });
      const { hero } = await f.enter('p1');
      lootGold(f.session, hero, 100);

      const checkpointing = f.host.checkpointWorlds();
      await Promise.resolve();
      await Promise.resolve();
      lootGold(f.session, hero, 20); // o mundo não parou
      land();
      await checkpointing;
      await f.host.checkpointWorlds();

      expect(linesOf(f).map((line) => line.aggregates.goldGained)).toEqual([100, 20]);
      expect(netGold(linesOf(f))).toBe(120);
      // O saldo é `gold + goldDelta`: o mesmo número, com o delta liquidado ou não.
      expect(hero.gold + hero.goldDelta).toBe(120);
    });
  });

  describe('a saída antecipa o lote inteiro', () => {
    it('quem sai leva junto o checkpoint de todo outro sujo — num `saveBatch` só; o limpo fica de fora', async () => {
      const f = build();
      const p1 = await f.enter('p1');
      const p2 = await f.enter('p2');
      await f.enter('p3'); // limpo
      lootGold(f.session, p1.hero, 100);
      lootGold(f.session, p2.hero, 40);

      await f.host.release('p1', 1000, 'logout');

      const batch = only(f.batches);
      expect(batch.map((line) => [line.characterId, line.reason]).sort()).toEqual([
        ['p1', 'manual-exit'], ['p2', 'checkpoint'],
      ]);
      expect(netGold(batch)).toBe(140);
      // O p2 já está gravado: o checkpoint seguinte não o repete.
      await f.host.checkpointWorlds();
      expect(f.batches).toHaveLength(1);
      expect(f.host.sessionFor('p1')).toBeUndefined();
      expect(f.host.sessionFor('p2')).toBeDefined();
    });

    it('a linha de saída existe mesmo sem o personagem ter mexido em nada — toda saída grava (ADR 0060 d.7)', async () => {
      const f = build();
      await f.enter('p1');

      await f.host.release('p1', 1000, 'logout');

      const line = only(only(f.batches));
      expect(line).toMatchObject({ characterId: 'p1', reason: 'manual-exit' });
    });

    it('a saída grava a âncora de onde o personagem saiu — o login seguinte volta a esse tile', async () => {
      const f = build(WORLD, { openWorld: true });
      const { hero } = await f.enter('p1', { townId: 'thais', position: { x: 94, y: 88, z: 7 } });
      hero.position = { x: 100, y: 90, z: 7 };

      await f.host.release('p1', 1000, 'logout');

      expect(only(only(f.batches)).worldPosition).toEqual({ x: ORIGIN.x + 100, y: ORIGIN.y + 90, z: 7 });
    });

    it('a transição para a hunt antecipa o lote, e a âncora é a de ANTES de o destino ser construído', async () => {
      const hunt = new Session({ id: 'hunt-1', contentVersion: 'v-test', ruleset: HUNT, rng: Rng.fromSeed('h'), createdAtMs: 0 });
      const f = build(WORLD, {
        openWorld: true,
        buildSession: (_request, from, characterId, departed) => {
          const character = from.participants.find((participant) => participant.id === characterId) ?? departed;
          if (character === undefined) return null;
          hunt.enter(character);
          // O que a hunt faz ao colocar: o MESMO `CharacterRuntime` passa a estar no tile de largada dela.
          character.position = { x: 1, y: 1, z: 7 };
          return hunt;
        },
      });
      const p1 = await f.enter('p1', { townId: 'thais', position: { x: 94, y: 88, z: 7 } });
      const p2 = await f.enter('p2', { townId: 'thais' });
      p1.hero.position = { x: 100, y: 90, z: 7 };
      lootGold(f.session, p2.hero, 40);

      await f.host.transition('p1', { to: 'hunt', huntId: 'arena' });

      const batch = only(f.batches);
      expect(batch.map((line) => line.characterId).sort()).toEqual(['p1', 'p2']);
      const departure = batch.find((line) => line.characterId === 'p1');
      expect(departure?.worldPosition).toEqual({ x: ORIGIN.x + 100, y: ORIGIN.y + 90, z: 7 });
      expect(f.host.sessionFor('p1')?.ruleset.type).toBe('hunt');
    });

    it('a drenagem leva todo mundo: o primeiro lote já tem o checkpoint de todo sujo, e cada saída grava a sua', async () => {
      const f = build();
      const p1 = await f.enter('p1');
      const p2 = await f.enter('p2');
      lootGold(f.session, p1.hero, 100);
      lootGold(f.session, p2.hero, 40);

      expect(await f.host.drainAll()).toBe(2);

      expect(f.batches[0]?.map((line) => line.characterId).sort()).toEqual(['p1', 'p2']);
      expect(netGold(linesOf(f))).toBe(140);
      expect(f.host.sessionFor('p1')).toBeUndefined();
      expect(f.host.sessionFor('p2')).toBeUndefined();
    });

    it('a saída por dentro do `sim` (`member-left`, a morte do mundo) também vai no lote', async () => {
      let nowMs = 0;
      const live: Ruleset = { ...WORLD, hz: () => 10 };
      const f = build(live, { now: () => nowMs });
      const p1 = await f.enter('p1');
      const p2 = await f.enter('p2');
      lootGold(f.session, p2.hero, 40);
      const departure = f.session.leave('p1', 'death');
      if (departure === null) throw new Error('p1 should have been in the world');
      f.session.emit({ kind: 'member-left', characterId: 'p1', reason: 'death', departure });
      void p1;

      nowMs += 100;
      f.host.cycle(nowMs);
      await vi.waitFor(() => { expect(f.batches).toHaveLength(1); });

      const batch = only(f.batches);
      expect(batch.map((line) => [line.characterId, line.reason]).sort()).toEqual([
        ['p1', 'death'], ['p2', 'checkpoint'],
      ]);
    });
  });

  describe('a falha do Redis não perde crédito', () => {
    /** Uma loja que recusa os primeiros `failures` lotes e depois grava. */
    const flaky = (failures: number) => {
      let remaining = failures;
      return (batches: SavedReceipt[][]) => ({
        saveBatch: async (batch: readonly SavedReceipt[]) => {
          if (remaining > 0) { remaining -= 1; throw new Error('Redis unavailable'); }
          batches.push([...batch]);
        },
      });
    };

    it('o checkpoint que falha é tentado de novo com o MESMO `seq` e a MESMA versão — e credita uma vez só', async () => {
      const attempts: SavedReceipt[][] = [];
      const f = build(WORLD, {
        store: (batches) => {
          let failed = false;
          return {
            saveBatch: async (batch: readonly SavedReceipt[]) => {
              attempts.push([...batch]);
              if (!failed) { failed = true; throw new Error('Redis unavailable'); }
              batches.push([...batch]);
            },
          };
        },
      });
      await f.host.prepare('p1', { level: 8, xp: 0, durableVersion: 0 }, 'acc-p1');
      const hero = f.heroOf('p1');
      lootGold(f.session, hero, 100);

      await f.host.checkpointWorlds(); // falha — e não derruba o laço
      expect(f.batches).toEqual([]);
      expect(hero.goldDelta).toBe(100); // não liquidado: nada pousou

      await f.host.checkpointWorlds(); // o mesmo extrato, de novo

      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(only(f.batches)).toHaveLength(1);
      expect(only(only(f.batches))).toMatchObject({ seq: 1, durableVersion: 1 });
      expect(netGold(linesOf(f))).toBe(100);
      expect(hero.goldDelta).toBe(0);
    });

    it('o extrato que falhou vai na FRENTE do seguinte: nada se perde e a ordem de versão se mantém', async () => {
      const f = build(WORLD, { store: flaky(1) });
      await f.host.prepare('p1', { level: 8, xp: 0, durableVersion: 0 }, 'acc-p1');
      const hero = f.heroOf('p1');

      lootGold(f.session, hero, 100);
      await f.host.checkpointWorlds(); // falha
      lootGold(f.session, hero, 30);
      await f.host.checkpointWorlds(); // grava o que falhou E o novo

      const batch = only(f.batches);
      expect(batch.map((line) => [line.seq, line.durableVersion, line.aggregates.goldGained]))
        .toEqual([[1, 1, 100], [2, 2, 30]]);
      expect(netGold(batch)).toBe(130);
    });

    it('a saída que falha: o `release` falha, e o `release` seguinte grava o extrato que ficou para trás', async () => {
      const f = build(WORLD, { store: flaky(1) });
      const { hero } = await f.enter('p1');
      lootGold(f.session, hero, 100);

      await expect(f.host.release('p1', 1000, 'logout')).rejects.toThrow('Redis unavailable');
      // Nada foi solto: o personagem continua hospedado, e não foi creditado.
      expect(f.host.sessionFor('p1')).toBeDefined();
      expect(f.batches).toEqual([]);

      // `leave` já o tirou da sessão: o extrato só existe em `unsaved`, e o retry o encontra lá.
      await f.host.release('p1', 1000, 'logout');

      expect(only(only(f.batches))).toMatchObject({ characterId: 'p1', reason: 'manual-exit' });
      expect(netGold(linesOf(f))).toBe(100);
      expect(f.host.sessionFor('p1')).toBeUndefined();
    });

    it('o que sobra do crédito de quem sai e a sessão esvazia: a saída seguinte ainda grava, uma vez', async () => {
      const f = build(WORLD, { store: flaky(1) });
      const { hero } = await f.enter('p1');
      lootGold(f.session, hero, 100);

      await expect(f.host.drainAll()).resolves.toBe(0); // a falha é registrada e a drenagem segue
      expect(f.host.sessionFor('p1')).toBeDefined();

      await expect(f.host.drainAll()).resolves.toBe(1);

      expect(netGold(linesOf(f))).toBe(100);
      expect(linesOf(f).filter((line) => line.reason === 'drain')).toHaveLength(1);
    });
  });

  describe('um lote de cada vez', () => {
    it('um checkpoint enquanto outro voa não empilha: o timer pula o ciclo', async () => {
      let land: () => void = () => {};
      const gate = new Promise<void>((resolve) => { land = resolve; });
      let calls = 0;
      const f = build(WORLD, {
        store: (batches) => ({
          saveBatch: async (batch: readonly SavedReceipt[]) => { calls += 1; await gate; batches.push([...batch]); },
        }),
      });
      const { hero } = await f.enter('p1');
      lootGold(f.session, hero, 100);

      const first = f.host.checkpointWorlds();
      await Promise.resolve();
      await Promise.resolve();
      lootGold(f.session, hero, 20);
      await f.host.checkpointWorlds(); // o primeiro ainda voa: este não faz nada

      expect(calls).toBe(1);
      land();
      await first;
      expect(calls).toBe(1);
    });

    it('a saída de um personagem espera o lote em voo — e só depois grava o dela, num lote seguinte', async () => {
      let land: () => void = () => {};
      const gate = new Promise<void>((resolve) => { land = resolve; });
      let calls = 0;
      const f = build(WORLD, {
        store: (batches) => ({
          saveBatch: async (batch: readonly SavedReceipt[]) => {
            calls += 1;
            if (calls === 1) await gate;
            batches.push([...batch]);
          },
        }),
      });
      const p1 = await f.enter('p1');
      await f.enter('p2');
      lootGold(f.session, p1.hero, 100);

      const checkpointing = f.host.checkpointWorlds();
      await Promise.resolve();
      await Promise.resolve();
      const releasing = f.host.release('p2', 1000, 'logout');
      await new Promise((resolve) => setTimeout(resolve, 10));

      // A saída está na fila atrás do lote em voo: um `saveBatch` só, e nada solto.
      expect(calls).toBe(1);
      expect(f.host.sessionFor('p2')).toBeDefined();

      land();
      await Promise.all([checkpointing, releasing]);

      expect(calls).toBe(2);
      expect(f.batches[1]?.map((line) => line.characterId)).toEqual(['p2']);
      expect(f.host.sessionFor('p2')).toBeUndefined();
    });
  });

  describe('o que não é mundo não muda', () => {
    it('a Cidade e a hunt não têm lote: o checkpoint não as toca nem lê a loja', async () => {
      for (const ruleset of [CITY, HUNT]) {
        const f = build(ruleset);
        const { hero } = await f.enter('p1');
        lootGold(f.session, hero, 100);

        await f.host.checkpointWorlds();

        expect(f.batches).toEqual([]);
        expect(f.singles).toEqual([]);
        // O que a sessão rendeu continua nela: nada foi zerado por um checkpoint que não era dela.
        expect(f.session.aggregatesOf('p1').goldGained).toBe(100);
        expect(hero.goldDelta).toBe(100);
      }
    });

    it('a hunt sai como sempre: um `save` no `end`, sem `saveBatch`', async () => {
      const f = build(HUNT);
      const { hero } = await f.enter('p1');
      lootGold(f.session, hero, 100);

      await f.host.release('p1', 1000, 'logout');

      expect(f.batches).toEqual([]);
      expect(only(f.singles)).toMatchObject({ characterId: 'p1', reason: 'manual-exit' });
    });

    it('sem a loja de extratos o checkpoint não tira nada da sessão — zerar sem gravar perderia o crédito', async () => {
      const session = new Session({ id: 'world-2', contentVersion: 'v-test', ruleset: WORLD, rng: Rng.fromSeed('b'), createdAtMs: 0 });
      const hero = new CharacterRuntime({
        id: 'p1', position: { x: 10, y: 10, z: 7 }, health: 100, maxHealth: 100, mana: 10, maxMana: 10,
        level: 8, xp: 0, gold: 0, goldDelta: 0, alive: true, cooldowns: {},
      });
      session.enter(hero);
      const bare = new SessionHost({
        nodeId: 'n2', contentVersion: 'v-test', logger, itemCatalog,
        createSession: () => session,
      });
      await bare.prepare('p1', { level: 8, xp: 0 }, 'acc-p1');
      lootGold(session, hero, 100);

      await bare.checkpointWorlds();

      expect(session.aggregatesOf('p1').goldGained).toBe(100);
      expect(hero.goldDelta).toBe(100);
    });
  });
});
