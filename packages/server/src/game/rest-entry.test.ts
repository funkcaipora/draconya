import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession, statsForLevel } from '@draconya/sim';
import type { Session, SessionSnapshot } from '@draconya/sim';
import { createLogger } from '../log.js';
import type { ReceiptStore } from '../receipts.js';
import type { SnapshotStore } from '../snapshots.js';
import type { InitialCharacter, TicketEntry } from '../tickets.js';
import { connectTestRedis } from '../testing/redis.js';
import { WorldQueue } from '../world-queue.js';
import { buildCatalogue } from './catalogue.js';
import { SessionHost } from './host.js';
import type { PrepareResult } from './host.js';
import { WorldFullError } from './rest-entry.js';
import type { WorldEntryGate, WorldEntryVerdict } from './rest-entry.js';
import { DEFAULT_WORLD_ID, createSessionWiring } from './sessions.js';
import type { SessionWiring } from './sessions.js';

// A entrada de quem sai do REPOUSO no hospedeiro (#842, OW-21, ADR 0060 d.2b e d.6b): o mundo cheio vira uma
// fila com posição, e a hunt idle é a primeira sessão de quem a pede — sem passar pelo mundo, que pode estar
// cheio. O hospedeiro é o REAL, com a costura de sessões do nó sobre o conteúdo real (a Thais do OTBM) e a fila
// em Redis de verdade; o que se prende é o que o handshake faz com cada pedido, e que nenhuma entrada deixa o
// personagem em duas sessões (invariante 8).
//
// O banco 30 é deste arquivo — ver `testing/redis.ts`. A checagem fica no topo do módulo (`describe.runIf`
// é avaliado na coleta, ver `directory.test.ts`).
const { redis, available } = await connectTestRedis(30);

afterAll(async () => {
  if (available) await redis.quit();
});

// Só as chaves da fila do mundo `main`, e não `flushdb`: o Redis local de 16 bancos não tem o 30, e o arquivo cai
// no banco 0, que outros arquivos dividem — um `flushdb` aqui apagaria o estado deles no meio do teste. No CI
// (32 bancos) o banco é só deste arquivo, e o cuidado não custa nada.
beforeEach(async () => {
  if (available) await redis.del('world:main:queue', 'world:main:queue:until', 'world:main:queue:seq');
});

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => (cached ??= loadContent(DATA));
const logger = createLogger('silent', 'test');

/** O relógio de PAREDE da fila, que dá o prazo a quem espera: começa num instante qualquer. */
const WALL_START_MS = 1_700_000_000_000;

interface Node {
  readonly host: SessionHost;
  readonly wiring: SessionWiring;
  readonly queue: WorldQueue;
  /** Avança o relógio do nó (e o da fila) em `ms`. */
  readonly advance: (ms: number) => void;
  /** O handshake de um personagem do repouso, como o `game` o faz depois de consumir o ticket. */
  readonly prepare: (id: string, initial?: Partial<InitialCharacter>, entry?: TicketEntry) => Promise<PrepareResult>;
  readonly typeOf: (id: string) => string | undefined;
}

function node(options: {
  readonly openWorld?: boolean;
  readonly capacity?: number;
  /** Troca a porta que o fio real montaria — para o teste que escreve a corrida à mão. */
  readonly gate?: WorldEntryGate;
  readonly withoutQueue?: boolean;
  readonly extra?: Partial<ConstructorParameters<typeof SessionHost>[0]>;
} = {}): Node {
  const content = real();
  let nowMs = 0;
  const queue = new WorldQueue(redis, { now: () => WALL_START_MS + nowMs });
  const openWorld = options.openWorld !== false;
  const wiring = createSessionWiring(content, () => nowMs, {
    openWorld,
    worldShard: options.capacity === undefined ? {} : { capacity: options.capacity },
    ...(options.withoutQueue === true ? {} : { worldQueue: queue }),
  });
  const receipts = {
    save: async () => undefined,
    saveBatch: async () => undefined,
  } as unknown as ReceiptStore;
  const gate = options.gate ?? wiring.worldEntry;
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, receipts, now: () => nowMs, openWorld,
    createSession: wiring.createSession, buildSession: wiring.buildSession,
    itemCatalog: content.items, blessingCatalog: content.blessings, progression: content.progression,
    ...(gate === undefined ? {} : { worldEntry: gate }),
    ...(options.extra ?? {}),
  });
  return {
    host, wiring, queue,
    advance: (ms) => { nowMs += ms; },
    prepare: (id, initial = {}, entry) => host.prepare(
      id, { level: 1, xp: 0, townId: 'thais', ...initial }, `acc-${id}`, undefined, entry,
    ),
    typeOf: (id) => host.sessionFor(id)?.ruleset.type,
  };
}

const HUNT: TicketEntry = { hunt: 'rat-cellars' };

describe.runIf(available)('o mundo cheio vira fila (#842, OW-21)', () => {
  it('com `capacity: 2` o terceiro recebe `world-full` na posição 1, e entra depois que alguém sai', async () => {
    const n = node({ capacity: 2 });
    expect(await n.prepare('a')).toEqual({ created: true });
    expect(await n.prepare('b')).toEqual({ created: true });
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(2);

    const third = await n.prepare('c');

    // A recusa é TIPADA e leva a posição na fila e a espera da tabela do Canary (5 s até a posição 4).
    expect(third).toEqual({ created: false, refused: 'world-full', worldFull: { position: 1, retryAfterMs: 5_000 } });
    // Sem rastro: o personagem não entrou, não tem sessão e o mundo continua com dois.
    expect(n.host.sessionFor('c')).toBeUndefined();
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(2);
    expect(await n.queue.size(DEFAULT_WORLD_ID)).toBe(1);

    // Alguém sai: a vaga abre e o MESMO personagem, tentando de novo, entra — e sai da fila.
    await n.host.release('a', 1000, 'logout');
    expect(await n.prepare('c')).toEqual({ created: true });
    expect(n.typeOf('c')).toBe('world');
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(2);
    expect(await n.queue.size(DEFAULT_WORLD_ID)).toBe(0);
  });

  it('a vez é de quem chegou primeiro: com UMA vaga e dois na fila, o segundo a tentar antes NÃO a leva', async () => {
    const n = node({ capacity: 1 });
    await n.prepare('a');
    expect((await n.prepare('b')).worldFull).toEqual({ position: 1, retryAfterMs: 5_000 });
    expect((await n.prepare('c')).worldFull).toEqual({ position: 2, retryAfterMs: 5_000 });

    await n.host.release('a', 1000, 'logout');
    // `c` bate primeiro, com a vaga aberta: a posição dele (2) não cabe numa vaga, e o primeiro da fila ainda
    // não voltou. Mutação que mata: admitir sempre que `isFull` é falso — a vaga seria do mais rápido.
    expect((await n.prepare('c')).worldFull).toEqual({ position: 2, retryAfterMs: 5_000 });
    expect(await n.prepare('b')).toEqual({ created: true });
    expect(n.typeOf('c')).toBeUndefined();
    // E agora `c` é o primeiro: o mundo voltou a estar cheio.
    expect((await n.prepare('c')).worldFull).toEqual({ position: 1, retryAfterMs: 5_000 });
  });

  it('o premium vai para a frente: com o mundo cheio, quem paga é a posição 1', async () => {
    const n = node({ capacity: 1 });
    await n.prepare('a');
    expect((await n.prepare('free')).worldFull?.position).toBe(1);

    expect((await n.prepare('paying', { premium: true })).worldFull?.position).toBe(1);
    expect((await n.prepare('free')).worldFull?.position).toBe(2);
  });

  it('quem desiste de voltar sai da fila no prazo, e quem estava atrás sobe', async () => {
    const n = node({ capacity: 1 });
    await n.prepare('a');
    await n.prepare('ghost');
    await n.prepare('stays');
    expect(await n.queue.size(DEFAULT_WORLD_ID)).toBe(2);

    // `stays` volta a cada 10 s; `ghost` some. O prazo dele é a espera de 5 s mais 15 s de folga.
    n.advance(10_000);
    expect((await n.prepare('stays')).worldFull?.position).toBe(2);
    n.advance(10_000);
    expect((await n.prepare('stays')).worldFull?.position).toBe(1);
  });

  it('o handshake recusado não deixa rastro: nenhum extrato, nenhuma sessão, e o login seguinte é o de sempre', async () => {
    const saved = vi.fn(async () => undefined);
    const n = node({
      capacity: 1,
      extra: { receipts: { save: saved, saveBatch: saved } as unknown as ReceiptStore },
    });
    await n.prepare('a');
    const sessions = n.host.sessionCount;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await n.prepare('b', { durableVersion: 7 })).refused).toBe('world-full');
    }

    expect(n.host.sessionCount).toBe(sessions);
    expect(n.host.sessionFor('b')).toBeUndefined();
    expect(saved).not.toHaveBeenCalled();
    // E o contador de versão durável que o ticket trouxe não ficou para trás: quando `b` entra, a sessão o
    // adota do ticket de agora, e a anterior não deixou piso nenhum.
    await n.host.release('a', 1000, 'logout');
    expect(await n.prepare('b', { durableVersion: 7 })).toEqual({ created: true });
  });

  it('o mundo com vaga e SEM fila entra direto, e a fila nem nasce no Redis', async () => {
    const n = node({ capacity: 5 });
    await n.prepare('a');
    await n.prepare('b');
    expect(await redis.keys('world:main:*')).toEqual([]);
  });

  it('o nó SEM a fila injetada recusa o mundo cheio como a OW-18 o deixou: `WorldFullError`, sem posição', async () => {
    const n = node({ capacity: 1, withoutQueue: true });
    await n.prepare('a');
    await expect(n.prepare('b')).rejects.toBeInstanceOf(WorldFullError);
    expect(n.host.sessionFor('b')).toBeUndefined();
  });

  it('a corrida entre a fila e a entrada: a fila admitiu, a vaga já tinha dono — o personagem volta para a fila', async () => {
    // Dois logins veem a mesma vaga, a fila admite os dois e o segundo encontra o mundo cheio ao criar a
    // sessão. A porta é escrita à mão para fixar a ordem: primeiro "entre", depois "fique na posição 1".
    const login = vi.fn<(characterId: string, premium: boolean) => Promise<WorldEntryVerdict>>()
      .mockResolvedValueOnce({ admitted: true })
      .mockResolvedValueOnce({ admitted: false, position: 1, retryAfterMs: 5_000 });
    const n = node({ capacity: 1, gate: { login, leave: async () => undefined } });
    await n.wiring.createSession('a', { level: 1, xp: 0, townId: 'thais' });
    expect(n.wiring.worldShard?.isFull(DEFAULT_WORLD_ID)).toBe(true);

    const result = await n.prepare('b');

    expect(login).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ created: false, refused: 'world-full', worldFull: { position: 1, retryAfterMs: 5_000 } });
    expect(n.host.sessionFor('b')).toBeUndefined();
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(1);
  });

  it('a corrida onde uma vaga abre no meio: a segunda tentativa entra', async () => {
    let world: Session | undefined;
    let calls = 0;
    // A porta admite sempre; a vaga só reaparece entre a primeira recusa da fábrica e a segunda pergunta.
    const login = vi.fn(async (): Promise<WorldEntryVerdict> => {
      calls += 1;
      if (calls === 2) world?.leave('a', 'manual-exit');
      return { admitted: true };
    });
    const n = node({ capacity: 1, gate: { login, leave: async () => undefined } });
    world = n.wiring.createSession('a', { level: 1, xp: 0, townId: 'thais' });

    expect(await n.prepare('b')).toEqual({ created: true });

    expect(login).toHaveBeenCalledTimes(2);
    expect(n.typeOf('b')).toBe('world');
  });

  it('a corrida que nunca se resolve desiste depois de três tentativas, com o erro do shard — não gira para sempre', async () => {
    const login = vi.fn(async (): Promise<WorldEntryVerdict> => ({ admitted: true }));
    const n = node({ capacity: 1, gate: { login, leave: async () => undefined } });
    n.wiring.createSession('a', { level: 1, xp: 0, townId: 'thais' });

    await expect(n.prepare('b')).rejects.toBeInstanceOf(WorldFullError);
    expect(login).toHaveBeenCalledTimes(3);
  });

  it('quem reconecta a uma sessão que já tem NÃO passa pela fila: o teto vale só na entrada do repouso', async () => {
    const n = node({ capacity: 1 });
    await n.prepare('a');
    const login = vi.spyOn(n.wiring.worldEntry as WorldEntryGate, 'login');

    // O ticket de `a`, de novo: o personagem já está no mundo cheio, e reanexar não é entrar.
    expect(await n.prepare('a')).toEqual({ created: false });
    expect(login).not.toHaveBeenCalled();
    expect(n.typeOf('a')).toBe('world');
  });

  it('o personagem com um snapshot pendente retoma a sessão dele, e o teto não o alcança (precedência do snapshot)', async () => {
    // O snapshot é a sessão em que o personagem estava quando o nó caiu (ADR 0010): ele está nela, não no
    // repouso. A fila é da entrada do repouso, e consultá-la deixaria quem foi interrompido numa hunt
    // esperando uma vaga no mundo.
    const content = real();
    const hunt = createHuntSession({
      id: 'resumed', content, huntId: 'rat-cellars', difficulty: 'cautious', createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, content.progression);
    hunt.enter(new CharacterRuntime({
      id: 'p', position: { x: -1, y: -1, z: 0 },
      health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    }));
    const snapshots = {
      // Só `p` tem snapshot: `a`, que enche o mundo, não.
      load: async (characterId: string) => (characterId === 'p'
        ? { snapshot: { createdAtMs: 0 } as SessionSnapshot, savedAtMs: Date.now(), accountId: 'acc-p' }
        : null),
      remove: async () => undefined,
    } as unknown as SnapshotStore;
    const n = node({
      capacity: 1,
      extra: { snapshots, restoreSession: (): Session => hunt },
    });
    await n.prepare('a');
    const login = vi.spyOn(n.wiring.worldEntry as WorldEntryGate, 'login');

    expect(await n.prepare('p')).toEqual({ created: true });
    expect(n.typeOf('p')).toBe('hunt');
    expect(login).not.toHaveBeenCalled();
  });
});

describe.runIf(available)('a hunt idle direta do repouso (#842, OW-21, ADR 0060 d.6b)', () => {
  it('a primeira sessão é a HUNT, sem passar pelo mundo: o personagem está em exatamente uma sessão', async () => {
    const n = node();

    expect(await n.prepare('a', {}, HUNT)).toEqual({ created: true });

    expect(n.typeOf('a')).toBe('hunt');
    expect(n.host.sessionCount).toBe(1);
    // O mundo nem nasceu: entrar direto é criação, não transição (invariante 8).
    expect(n.wiring.worldShard?.worlds).toBe(0);
    expect(n.wiring.cityShard.population).toBe(0);
    expect(n.host.sessionFor('a')?.participants.map((participant) => participant.id)).toEqual(['a']);
  });

  it('com o mundo CHEIO a hunt direta entra: a base econômica não depende de haver vaga', async () => {
    const n = node({ capacity: 1 });
    await n.prepare('a');
    expect((await n.prepare('b')).refused).toBe('world-full');

    expect(await n.prepare('b', {}, HUNT)).toEqual({ created: true });

    expect(n.typeOf('b')).toBe('hunt');
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(1);
  });

  it('quem estava na fila e entra na hunt largou a fila: a vaga que ele guardava não fica ocupada até o prazo', async () => {
    const n = node({ capacity: 1 });
    await n.prepare('a');
    await n.prepare('b');
    await n.prepare('c');
    expect(await n.queue.size(DEFAULT_WORLD_ID)).toBe(2);

    await n.prepare('b', {}, HUNT);

    // `c` sobe para a posição 1 na hora, e não daqui a 20 s.
    expect(await n.queue.size(DEFAULT_WORLD_ID)).toBe(1);
    expect((await n.prepare('c')).worldFull?.position).toBe(1);
  });

  it('uma hunt que não existe é recusada com `hunt-unavailable`, sem cair no mundo no lugar dela', async () => {
    const n = node();

    expect(await n.prepare('a', {}, { hunt: 'nao-existe' })).toEqual({ created: false, refused: 'hunt-unavailable' });

    expect(n.host.sessionFor('a')).toBeUndefined();
    expect(n.wiring.worldShard?.worlds).toBe(0);
    expect(n.host.sessionCount).toBe(0);
  });

  it('quem já tem sessão reencontra a sua: o pedido de hunt direta não cria uma segunda (invariante 8)', async () => {
    const n = node();
    await n.prepare('a');
    const world = n.host.sessionFor('a');

    // O ticket de `a` traz a hunt, mas ele já está no mundo: reanexa, e trocar de sessão é transição.
    expect(await n.prepare('a', {}, HUNT)).toEqual({ created: false });

    expect(n.host.sessionFor('a')).toBe(world);
    expect(n.typeOf('a')).toBe('world');
    expect(n.host.sessionCount).toBe(1);
  });

  it('com a flag DESLIGADA o `entry` é ignorado: o login cai na Cidade, como sempre', async () => {
    const n = node({ openWorld: false });

    expect(await n.prepare('a', {}, HUNT)).toEqual({ created: true });

    expect(n.typeOf('a')).toBe('city');
    expect(n.wiring.worldEntry).toBeUndefined();
  });

  it('a hunt direta guarda a âncora do mundo no personagem: é para onde o fim dela o devolve (OW-20)', async () => {
    const n = node();
    const anchor = { x: 32369, y: 32249, z: 7 };

    await n.prepare('a', { worldPosition: anchor }, HUNT);

    const character = n.host.sessionFor('a')?.participants.find((participant) => participant.id === 'a');
    expect(character?.worldPosition).toEqual(anchor);
  });
});

describe('`offersHunts`: a hunt idle está ao alcance de quem não coube no mundo (`huntAvailable`)', () => {
  it('é verdade com o catálogo do conteúdo, falso com um catálogo sem hunt, e verdade sem catálogo', () => {
    // Não precisa de Redis: é só a leitura do catálogo do nó.
    const content = real();
    const catalogue = buildCatalogue(content);
    expect(catalogue.hunts.length).toBeGreaterThan(0);

    const make = (extra: Partial<ConstructorParameters<typeof SessionHost>[0]>) => new SessionHost({
      nodeId: 'n1', contentVersion: content.version, logger,
      createSession: createSessionWiring(content).createSession, ...extra,
    });
    expect(make({ catalogue: () => catalogue }).offersHunts).toBe(true);
    expect(make({ catalogue: () => ({ ...catalogue, hunts: [] }) }).offersHunts).toBe(false);
    expect(make({}).offersHunts).toBe(true);
  });
});

describe.runIf(available)('quem volta de uma instância nunca passa pela fila (#842, OW-21)', () => {
  it('com o mundo cheio, o personagem que voltou da hunt entra, e a fila não é nem consultada', async () => {
    const n = node({ capacity: 2 });
    await n.prepare('a');
    await n.prepare('b');
    // `a` vai caçar: sai do mundo (população 1), e `c` ocupa a vaga dele — o mundo está cheio de novo.
    await n.host.transition('a', { to: 'hunt', huntId: 'rat-cellars' });
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(1);
    expect(await n.prepare('c')).toEqual({ created: true });
    expect(n.wiring.worldShard?.isFull(DEFAULT_WORLD_ID)).toBe(true);
    // E o repouso é recusado, na fila.
    expect((await n.prepare('d')).refused).toBe('world-full');
    const queued = await n.queue.size(DEFAULT_WORLD_ID);
    const login = vi.spyOn(n.wiring.worldEntry as WorldEntryGate, 'login');

    await n.host.transition('a', { to: 'world' });

    // Mutação que mata: aplicar a fila a toda entrada — quem já estava no mundo ficaria sem sessão ao voltar.
    expect(n.typeOf('a')).toBe('world');
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(3);
    expect(login).not.toHaveBeenCalled();
    expect(await n.queue.size(DEFAULT_WORLD_ID)).toBe(queued);
  });
});
