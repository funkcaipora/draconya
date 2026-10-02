import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { isBlocked, localToAbsolute } from '@draconya/content';
import type { Content, Tilemap } from '@draconya/content';
import type { S2CMessage } from '@draconya/protocol';
import type { CharacterRuntime, Session, SessionLimits } from '@draconya/sim';
import { createLogger } from '../log.js';
import type { SessionDirectory } from '../directory.js';
import type { ReceiptStore } from '../receipts.js';
import type { InitialCharacter } from '../tickets.js';
import { SessionHost } from './host.js';
import type { Viewer } from './viewer.js';
import { createSessionWiring, DEFAULT_WORLD_ID } from './sessions.js';
import type { SessionWiring } from './sessions.js';
import { FakeSocket } from './testing.js';
import { TransitionError } from './transitions.js';

// O mundo HOSPEDADO (#839, OW-18): o `SessionHost` com a costura de sessões do nó (`createSessionWiring`) e
// o conteúdo REAL — a Thais importada do OTBM, o `main.json`, o catálogo de bênçãos e de itens —, pelo mesmo
// `loadContent` do boot. `world-checkpoint-real.test.ts` prova o checkpoint com uma sessão montada à mão;
// aqui a sessão nasce do LOGIN (`prepare` → fábrica → `WorldShard`), como nasce em produção, e o que se prende
// é o que o hospedeiro faz com ela: quem entra, quem se enxerga, o serviço que só vale em PZ, a transição
// para a hunt e a volta — e que, com a flag desligada, nada disto existe.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => (cached ??= loadContent(DATA));
const logger = createLogger('silent', 'test');

const THAIS = (): Tilemap => {
  const map = real().maps.get('thais');
  if (map === undefined) throw new Error('o conteúdo real não tem a thais');
  return map;
};

/** A coordenada ABSOLUTA de um tile local do recorte, como o ticket a carrega. */
const absolute = (tile: { x: number; y: number; z: number }) => {
  const point = localToAbsolute(THAIS(), tile);
  if (point === undefined) throw new Error(`fora do recorte: ${JSON.stringify(tile)}`);
  return point;
};

const TEMPLE = { x: 94, y: 88, z: 7 };
/** A rua ao sul do templo: tile andável FORA da PZ (`world-session-real.test.ts` a usa pelo mesmo motivo). */
const STREET = { x: 94, y: 97, z: 7 };

/** Um tile andável do andar 7 a pelo menos `distance` tiles do templo — para quem precisa estar longe. */
function farTile(distance: number): { x: number; y: number; z: number } {
  const map = THAIS();
  for (let x = 0; x < map.width; x += 1) {
    for (let y = 0; y < map.height; y += 1) {
      if (Math.max(Math.abs(x - TEMPLE.x), Math.abs(y - TEMPLE.y)) >= distance && !isBlocked(map, x, y, 7)) {
        return { x, y, z: 7 };
      }
    }
  }
  throw new Error(`nenhum tile andável a ${String(distance)} tiles do templo`);
}

interface SavedBatchLine {
  readonly characterId: string;
  readonly reason: string;
  readonly worldPosition?: { x: number; y: number; z: number } | null;
}

interface Node {
  readonly host: SessionHost;
  readonly wiring: SessionWiring;
  readonly batches: SavedBatchLine[][];
  readonly saved: SavedBatchLine[];
  /** Avança o relógio do nó em `ms` e roda UM ciclo do hospedeiro. */
  readonly tick: (ms: number) => void;
  /** Prepara o personagem como o `game` faz no handshake e liga um socket a ele. */
  readonly login: (id: string, initial?: Partial<InitialCharacter>) => Promise<{ viewer: Viewer; socket: FakeSocket }>;
  readonly session: (id: string) => Session;
  readonly character: (id: string) => CharacterRuntime;
}

function node(options: {
  readonly openWorld?: boolean;
  readonly capacity?: number;
  readonly limits?: SessionLimits;
  readonly directory?: SessionDirectory;
} = {}): Node {
  const content = real();
  let nowMs = 0;
  const wiring = createSessionWiring(content, () => nowMs, {
    ...(options.openWorld === false ? {} : { openWorld: true }),
    worldShard: {
      ...(options.capacity === undefined ? {} : { capacity: options.capacity }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    },
  });
  const batches: SavedBatchLine[][] = [];
  const saved: SavedBatchLine[] = [];
  const receipts = {
    save: async (line: SavedBatchLine) => { saved.push(line); },
    saveBatch: async (batch: readonly SavedBatchLine[]) => { batches.push([...batch]); },
  } as unknown as ReceiptStore;
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, receipts, now: () => nowMs,
    openWorld: options.openWorld !== false,
    createSession: wiring.createSession,
    buildSession: wiring.buildSession,
    itemCatalog: content.items,
    blessingCatalog: content.blessings,
    progression: content.progression,
    ...(options.directory === undefined ? {} : { directory: options.directory }),
  });
  const login: Node['login'] = async (id, initial = {}) => {
    await host.prepare(id, { level: 1, xp: 0, townId: 'thais', ...initial }, `acc-${id}`);
    const socket = new FakeSocket();
    const viewer = host.attach(socket, id);
    // O `session-attach` do cliente: é o que manda a cena (`instance-enter`) e o estado.
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    return { viewer, socket };
  };
  return {
    host, wiring, batches, saved, login,
    tick: (ms) => { nowMs += ms; host.cycle(nowMs); },
    session: (id) => {
      const session = host.sessionFor(id);
      if (session === undefined) throw new Error(`${id} não tem sessão`);
      return session;
    },
    character: (id) => {
      const found = (host.sessionFor(id)?.participants ?? []).find((participant) => participant.id === id);
      if (found === undefined) throw new Error(`${id} não está na sessão`);
      return found;
    },
  };
}

const ofType = <T extends S2CMessage['type']>(messages: readonly S2CMessage[], type: T) =>
  messages.filter((message): message is Extract<S2CMessage, { type: T }> => message.type === type);

describe('o login no mundo hospedado (#839, OW-18)', () => {
  it('com a flag LIGADA o login cai no mundo: o templo, ou a posição salva, e a sessão é de tipo `world`', async () => {
    const n = node();
    await n.login('a');
    await n.login('b', { worldPosition: absolute(STREET) });

    expect(n.session('a').ruleset.type).toBe('world');
    expect(n.character('a').position).toEqual(TEMPLE);
    expect(n.character('b').position).toEqual(STREET);
  });

  it('dois personagens ficam na MESMA sessão, e o hospedeiro tem uma sessão só', async () => {
    const n = node();
    await n.login('a');
    await n.login('b');

    expect(n.session('b')).toBe(n.session('a'));
    expect(n.host.sessionCount).toBe(1);
    expect(n.session('a').participants.map((participant) => participant.id)).toEqual(['a', 'b']);
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(2);
  });

  it('o mundo roda a 10 Hz com ou sem visualizador, e o personagem é do nó (o diretório vê o tipo `world`)', async () => {
    const n = node();
    const { viewer } = await n.login('a');
    expect(n.session('a').currentHz()).toBe(10);
    n.host.detach(viewer);
    // Desanexado, o mundo continua a 10 Hz: o que cai é a apresentação, nunca a simulação (invariante 3).
    expect(n.session('a').currentHz()).toBe(10);
  });

  it('o cliente recebe a cena do mundo — o mapa `thais` — SEM identidade de hunt', async () => {
    const n = node();
    const { socket } = await n.login('a');
    const messages = socket.received();

    const [enter] = ofType(messages, 'instance-enter');
    expect(enter).toMatchObject({ map: 'thais' });
    // Mutação que mata: deixar o `huntId`/`difficulty` sintéticos do motor (`world:main`, `world`) vazarem —
    // o cliente procuraria no catálogo uma "hunt" que não existe.
    expect(enter).not.toHaveProperty('huntId');
    expect(enter).not.toHaveProperty('difficulty');

    const [state] = ofType(messages, 'session-state');
    expect(state).toMatchObject({ sessionType: 'world', world: { mapId: 'thais' } });
    expect(state).not.toHaveProperty('huntId');
    expect(state).not.toHaveProperty('difficulty');
  });

  it('a hunt segue com a identidade dela: o `instance-enter` leva o `huntId`', async () => {
    const n = node();
    const { socket } = await n.login('a');
    await n.host.transition('a', { to: 'hunt', huntId: 'rat-cellars' });
    n.host.flush();

    // O espectador acompanha o PERSONAGEM: a troca de cena chega no mesmo socket.
    const enters = ofType(socket.received(), 'instance-enter');
    expect(enters.at(-1)).toMatchObject({ map: 'rat-cellars', huntId: 'rat-cellars' });
  });
});

describe('a AOI no mundo (#839): quem está por perto se enxerga, e só ele', () => {
  it('dois personagens no templo se enxergam; um terceiro a sessenta tiles, não', async () => {
    const n = node();
    await n.login('a');
    await n.login('b');
    await n.login('far', { worldPosition: absolute(farTile(60)) });

    // Mutação que mata: `usesAreaOfInterest` falso para o mundo — todo mundo enxergaria todo mundo, e o
    // O(N²) de saída que a AOI existe para cortar voltaria na praça mais cheia do jogo.
    expect(n.host.interestOf('a')).toContain('b');
    expect(n.host.interestOf('b')).toContain('a');
    expect(n.host.interestOf('a')).not.toContain('far');
    expect(n.host.interestOf('far')).toEqual([]);
  });

  it('o passo de um vai para quem o enxerga — e não para quem está longe', async () => {
    const n = node();
    const a = await n.login('a');
    const b = await n.login('b');
    const far = await n.login('far', { worldPosition: absolute(farTile(60)) });
    const before = (socket: FakeSocket) => ofType(socket.received(), 'creature-move').length;
    const [aBefore, bBefore, farBefore] = [before(a.socket), before(b.socket), before(far.socket)];

    // `a` anda um tile: o primeiro vizinho livre.
    const map = THAIS();
    const here = n.character('a').position;
    const step = (['south', 'east', 'north', 'west'] as const).find((direction) => {
      const dx = direction === 'east' ? 1 : direction === 'west' ? -1 : 0;
      const dy = direction === 'south' ? 1 : direction === 'north' ? -1 : 0;
      return !isBlocked(map, here.x + dx, here.y + dy, here.z);
    });
    if (step === undefined) throw new Error('nenhum vizinho livre');
    n.host.handle(a.viewer, { type: 'walk', direction: step });
    n.tick(1_000);

    expect(n.character('a').position).not.toEqual(here);
    expect(before(a.socket)).toBeGreaterThan(aBefore);
    expect(before(b.socket)).toBeGreaterThan(bBefore);
    expect(before(far.socket)).toBe(farBefore);
  });
});

describe('o serviço de Cidade só vale em PZ no mundo (#839)', () => {
  const firstBlessing = (): string => {
    const [id] = [...real().blessings.keys()];
    if (id === undefined) throw new Error('o conteúdo real não tem bênçãos');
    return id;
  };
  /** O que o jogador lê: as mensagens de sistema que chegaram, em texto. */
  const warnings = (socket: FakeSocket): string[] =>
    ofType(socket.received(), 'system-message').map((message) => message.text);
  const balance = (character: CharacterRuntime): number => character.gold + character.goldDelta;

  it('a bênção se compra no templo (PZ) e é recusada na rua — sem debitar nada', async () => {
    const n = node();
    const inTemple = await n.login('temple', { gold: 1_000_000, level: 50 });
    const inStreet = await n.login('street', { gold: 1_000_000, level: 50, worldPosition: absolute(STREET) });
    const richBefore = balance(n.character('temple'));

    n.host.handle(inTemple.viewer, { type: 'buy-blessing', blessingId: firstBlessing() });
    n.host.handle(inStreet.viewer, { type: 'buy-blessing', blessingId: firstBlessing() });
    n.tick(100);

    // No templo: comprou — a bênção entrou e o gold saiu pelo canal único (`goldDelta` E o agregado
    // `goldSpent`, que a sessão `checkpointed` credita).
    expect(n.character('temple').blessings).not.toBe(0);
    expect(balance(n.character('temple'))).toBeLessThan(richBefore);
    expect(n.session('temple').aggregatesOf('temple').goldSpent).toBe(richBefore - balance(n.character('temple')));
    // Na rua: recusado com a frase do mundo, e nada se moveu.
    expect(warnings(inStreet.socket)).toContain('Isso só se faz numa zona de proteção.');
    expect(n.character('street').blessings).toBe(0);
    expect(balance(n.character('street'))).toBe(1_000_000);
    expect(n.session('street').aggregatesOf('street').goldSpent).toBe(0);
  });

  it('vender da mochila também: na rua é recusado, no templo vende e credita o agregado', async () => {
    const content = real();
    const sellable = [...content.items.values()].find((item) => (item.value ?? 0) > 0);
    if (sellable === undefined) throw new Error('o conteúdo real não tem item com valor');
    const backpack = [{ instanceId: 'x-1', itemId: sellable.id, quantity: 1 }];
    const n = node();
    const inTemple = await n.login('temple', { inventory: { backpack, equipped: {} } });
    const inStreet = await n.login('street', {
      inventory: { backpack: [{ ...backpack[0] as object, instanceId: 'x-2' }] as never, equipped: {} },
      worldPosition: absolute(STREET),
    });

    n.host.handle(inStreet.viewer, { type: 'sell-items', instanceIds: ['x-2'] });
    n.host.handle(inTemple.viewer, { type: 'sell-items', instanceIds: ['x-1'] });
    n.tick(100);

    expect(warnings(inStreet.socket)).toContain('Isso só se faz numa zona de proteção.');
    expect(n.character('street').goldDelta).toBe(0);
    expect(n.character('street').inventory.carried('x-2')).not.toBeNull();
    expect(n.character('temple').goldDelta).toBe(sellable.value);
    expect(n.character('temple').inventory.carried('x-1')).toBeNull();
    expect(n.session('temple').aggregatesOf('temple').goldGained).toBe(sellable.value);
  });

  it('no templo de CIMA (PZ + no-logout) o serviço vale: a PZ decide o serviço, e o no-logout a saída', async () => {
    const n = node();
    // O tile em cima do templo é PZ e no-logout (`world-session-real.test.ts`).
    const upstairs = await n.login('up', { gold: 1_000_000, level: 50, worldPosition: absolute({ x: 94, y: 93, z: 6 }) });
    n.host.handle(upstairs.viewer, { type: 'buy-blessing', blessingId: firstBlessing() });
    n.tick(100);
    expect(n.character('up').blessings).not.toBe(0);
  });

  it('a CIDADE (flag desligada) segue como era: a bênção se compra de onde se está', async () => {
    const n = node({ openWorld: false });
    const city = await n.login('a', { gold: 1_000_000, level: 50 });
    expect(n.session('a').ruleset.type).toBe('city');

    n.host.handle(city.viewer, { type: 'buy-blessing', blessingId: firstBlessing() });
    n.tick(100);

    expect(n.character('a').blessings).not.toBe(0);
    expect(warnings(city.socket)).toEqual([]);
  });
});

describe('o que o mundo recusa por ser o motor da hunt (#839)', () => {
  it('`leave-hunt` no mundo é recusado — o `requestExit` herdado levaria o personagem à Cidade por fora do canLogout', async () => {
    const n = node();
    const a = await n.login('a');
    await n.login('b');
    const world = n.session('a');

    n.host.handle(a.viewer, { type: 'leave-hunt' });
    // O que o `requestExit` herdado faria: contar `exitDelayMs`, concluir, `member-left`, Cidade.
    n.tick(120_000);
    await Promise.resolve();

    expect(ofType(a.socket.received(), 'system-message').map((message) => message.text)).toContain('Você já está aqui.');
    expect(n.session('a')).toBe(world);
    expect(world.participants.map((participant) => participant.id)).toEqual(['a', 'b']);
    expect(n.batches).toEqual([]);
  });

  it('o mundo não vai à Cidade, nem a Cidade ao mundo: a tabela de transições recusa', async () => {
    const n = node();
    await n.login('a');
    await expect(n.host.transition('a', { to: 'city' })).rejects.toBeInstanceOf(TransitionError);
    await expect(n.host.transition('a', { to: 'city' })).rejects.toMatchObject({ refusal: 'not-allowed' });
    await expect(n.host.transition('a', { to: 'world' })).rejects.toMatchObject({ refusal: 'same-state' });
  });
});

describe('mundo → hunt → mundo (#839): o grafo com `world` no centro', () => {
  it('vai para a hunt, grava a âncora de saída e VOLTA ao mesmo tile, na mesma sessão', async () => {
    const n = node();
    const a = await n.login('a', { worldPosition: absolute(STREET) });
    await n.login('keeper'); // fica no mundo, para ele não esvaziar e ser esquecido
    const world = n.session('a');
    const walkedTo = n.character('a').position;
    expect(walkedTo).toEqual(STREET);

    await n.host.transition('a', { to: 'hunt', huntId: 'rat-cellars' });

    expect(n.session('a').ruleset.type).toBe('hunt');
    expect(world.participants.map((participant) => participant.id)).toEqual(['keeper']);
    // A saída ANTECIPA o lote do mundo: a linha dele leva a coordenada ABSOLUTA do tile de onde saiu —
    // lida ANTES de o destino ser construído (o personagem é o mesmo objeto, e depois disso o `position`
    // já é o da hunt).
    const exit = n.batches.flat().find((line) => line.characterId === 'a');
    expect(exit).toMatchObject({ reason: 'manual-exit', worldPosition: absolute(STREET) });
    // O espectador acompanhou o PERSONAGEM para a hunt, e o `session-attach` o pôs na cena nova.
    expect(a.viewer.dead).toBe(false);

    await n.host.transition('a', { to: 'world' });

    // De volta: a MESMA sessão do mundo, no tile de onde saiu, junto de quem ficou.
    expect(n.session('a')).toBe(world);
    expect(n.character('a').position).toEqual(STREET);
    expect(world.participants.map((participant) => participant.id)).toEqual(['keeper', 'a']);
    expect(n.host.sessionCount).toBe(1);
    // E o mundo hospeda o checkpoint dele outra vez (sessão `checkpointed`): andar suja, e o lote grava.
    const map = THAIS();
    const here = n.character('a').position;
    const to = [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([dx, dy]) => ({ x: here.x + (dx ?? 0), y: here.y + (dy ?? 0), z: here.z }))
      .find((tile) => !isBlocked(map, tile.x, tile.y, tile.z));
    if (to === undefined) throw new Error('nenhum vizinho livre');
    (world.ruleset as unknown as { requestMove(s: Session, id: string, to: { x: number; y: number }): unknown })
      .requestMove(world, 'a', to);
    n.tick(5_000);
    n.batches.length = 0;
    await n.host.checkpointWorlds();
    expect(n.batches.flat().map((line) => line.characterId)).toContain('a');
  });

  it('o mundo vazio some do hospedeiro quando o último vai caçar, e a volta cria outro', async () => {
    const n = node();
    await n.login('a');
    const first = n.session('a');

    await n.host.transition('a', { to: 'hunt', huntId: 'rat-cellars' });
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(0);
    // O hospedeiro largou o mundo vazio: só a hunt está de pé.
    expect(n.host.sessionCount).toBe(1);

    await n.host.transition('a', { to: 'world' });
    expect(n.session('a')).not.toBe(first);
    expect(n.session('a').ruleset.type).toBe('world');
    expect(n.character('a').position).toEqual(TEMPLE);
    expect(n.host.sessionCount).toBe(1);
  });

  it('com a flag DESLIGADA o mundo não existe: `to: world` é recusado e o jogo é o da Cidade', async () => {
    const n = node({ openWorld: false });
    await n.login('a');
    expect(n.session('a').ruleset.type).toBe('city');
    await n.host.transition('a', { to: 'hunt', huntId: 'rat-cellars' });

    // A aresta existe na tabela, mas nenhum nó sem a flag constrói um mundo.
    await expect(n.host.transition('a', { to: 'world' })).rejects.toMatchObject({ refusal: 'unknown-destination' });
    expect(n.session('a').ruleset.type).toBe('hunt');
  });
});

describe('o analisador no mundo (#839): o cursor é a posição ABSOLUTA, e o teto não o desloca', () => {
  it('com a lista no teto, o evento novo ainda chega — e só ele', async () => {
    // Teto de 2 eventos por personagem: com UM personagem a lista guarda os dois últimos, e cada evento
    // novo descarta o mais velho. O tamanho da lista (2) não muda — e era ele o cursor.
    const n = node({ limits: { maxNotableEventsPerCharacter: 2 } });
    const { socket } = await n.login('a');
    const world = n.session('a');
    const analyzers = () => ofType(socket.received(), 'analyzer');
    const eventsOf = (analyzer: ReturnType<typeof analyzers>[number]) => analyzer.notableEvents.map((event) => event.type);

    world.record('first', undefined, 'a');
    world.record('second', undefined, 'a');
    n.tick(100);
    expect(eventsOf(analyzers().at(-1) as never)).toEqual(['first', 'second']);

    world.record('third', undefined, 'a'); // descarta `first`; o tamanho da lista continua 2
    n.tick(100);

    // Mutação que mata: cursor = tamanho da lista. O `eventCount` ficaria igual (2), o analisador acharia que
    // nada mudou e o terceiro evento nunca chegaria — ou, sem a comparação, o `slice(2)` o cortaria fora.
    expect(world.notableEventsDropped).toBeGreaterThan(0);
    expect(eventsOf(analyzers().at(-1) as never)).toEqual(['third']);

    world.record('fourth', undefined, 'a');
    world.record('fifth', undefined, 'a'); // descarta `third` e `fourth`
    n.tick(100);
    expect(eventsOf(analyzers().at(-1) as never)).toEqual(['fourth', 'fifth']);
  });

  it('o evento de OUTRO personagem não provoca um `analyzer` para quem não o vê', async () => {
    const n = node();
    const a = await n.login('a');
    const b = await n.login('b');
    const world = n.session('a');
    const analyzersOf = (socket: FakeSocket) => ofType(socket.received(), 'analyzer');
    const [aBefore, bBefore] = [analyzersOf(a.socket).length, analyzersOf(b.socket).length];

    // Um evento de `b` entra na lista da sessão: a contagem dela anda para os dois.
    world.record('level-up', 'b-sobe', 'b');
    n.tick(100);

    // Mutação que mata: comparar o tamanho da lista da sessão — todo evento de qualquer um mandaria uma
    // mensagem a todos os que olham o mundo, e a de `a` iria sem evento novo nenhum.
    expect(analyzersOf(a.socket)).toHaveLength(aBefore);
    const delivered = analyzersOf(b.socket);
    expect(delivered).toHaveLength(bBefore + 1);
    expect(delivered.at(-1)?.notableEvents.map((event) => event.type)).toEqual(['level-up']);

    // E `a` não perdeu o cursor: o evento DELE, depois, chega — e só ele.
    world.record('mine', undefined, 'a');
    n.tick(100);
    expect(analyzersOf(a.socket)).toHaveLength(aBefore + 1);
    expect(analyzersOf(a.socket).at(-1)?.notableEvents.map((event) => event.type)).toEqual(['mine']);
    expect(analyzersOf(b.socket)).toHaveLength(bBefore + 1);
  });
});

describe('o registro recusado não deixa fantasma no mundo (#839)', () => {
  it('se o diretório recusa o registro, o personagem sai da sessão que a fábrica já o pôs', async () => {
    // O diretório de mentira: toda reserva expirou. É o `active reservation expired` do `#register`.
    const refusing = { register: async () => false } as unknown as SessionDirectory;
    const n = node({ directory: refusing });

    await expect(n.host.prepare('a', { level: 1, xp: 0, townId: 'thais' }, 'acc-a'))
      .rejects.toThrow(/reservation expired/);

    // Mutação que mata: sem o `leave`, `a` ficaria em `participants` de um mundo que ninguém hospeda por ele
    // — um tile bloqueado no templo e uma vaga do teto que nunca volta, numa sessão que não esvazia.
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(0);
    expect(n.host.sessionCount).toBe(0);
  });

  it('o mesmo na Cidade da flag desligada: a recusa não deixa o personagem na cópia', async () => {
    const refusing = { register: async () => false } as unknown as SessionDirectory;
    const n = node({ openWorld: false, directory: refusing });
    await expect(n.host.prepare('a', { level: 1, xp: 0 }, 'acc-a')).rejects.toThrow(/reservation expired/);
    expect(n.wiring.cityShard.population).toBe(0);
  });
});
