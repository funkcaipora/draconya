import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { isBlocked, localToAbsolute } from '@draconya/content';
import type { Content, Tilemap } from '@draconya/content';
import type { S2CMessage } from '@draconya/protocol';
import { Session } from '@draconya/sim';
import type { CharacterRuntime } from '@draconya/sim';
import { createLogger } from '../log.js';
import type { SessionDirectory, SessionLocation } from '../directory.js';
import type { ReceiptStore } from '../receipts.js';
import type { InitialCharacter, PartyTicket } from '../tickets.js';
import { SessionHost } from './host.js';
import type { PrepareResult } from './host.js';
import { createLateJoiner, createSessionWiring, DEFAULT_WORLD_ID } from './sessions.js';
import type { SessionWiring } from './sessions.js';
import { FakeSocket } from './testing.js';
import { TransitionError } from './transitions.js';
import type { Viewer } from './viewer.js';

// O mundo e a hunt idle (#841, OW-20, ADR 0060 d.6a e d.6c): entrar numa instância passa por `canLogout`, e o
// fim dela decide pelo visualizador — com alguém olhando volta ao mundo, sem ninguém vai ao REPOUSO, onde nada
// o encontra. É a promessa central da hunt idle: o personagem desanexado nunca acaba sozinho num mundo onde
// morreria sem ninguém olhando.
//
// O hospedeiro é o REAL, com a costura de sessões do nó (`createSessionWiring`) sobre o conteúdo REAL — a
// Thais do OTBM e a `rat-cellars` —, um diretório que faz a CAS de verdade (`succeed` só troca se o registro
// ainda é o da origem) e o armazém de extratos que anota cada linha. O tempo é o relógio injetado, nunca
// dormido (invariante 2).
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => (cached ??= loadContent(DATA));
const logger = createLogger('silent', 'test');

const THAIS = (): Tilemap => {
  const map = real().maps.get('thais');
  if (map === undefined) throw new Error('o conteúdo real não tem a thais');
  return map;
};

const absolute = (tile: { x: number; y: number; z: number }) => {
  const point = localToAbsolute(THAIS(), tile);
  if (point === undefined) throw new Error(`fora do recorte: ${JSON.stringify(tile)}`);
  return point;
};

const TEMPLE = { x: 94, y: 88, z: 7 };
/** A rua ao sul do templo: tile andável FORA da PZ (`world-host.test.ts` a usa pelo mesmo motivo). */
const STREET = { x: 94, y: 97, z: 7 };
/** O tile em cima do templo: PZ e no-logout (`world-session-real.test.ts`). */
const UPSTAIRS = { x: 94, y: 93, z: 6 };
const HUNT = 'rat-cellars';

/** Um tile andável do andar 7, outro que a rua, a 3 ou mais tiles dela — para dois personagens que não se pisam. */
const OTHER_STREET = ((): { x: number; y: number; z: number } => {
  const map = THAIS();
  for (let x = STREET.x - 6; x <= STREET.x + 6; x += 1) {
    if (Math.abs(x - STREET.x) >= 3 && !isBlocked(map, x, STREET.y, 7)) return { x, y: STREET.y, z: 7 };
  }
  throw new Error('nenhum outro tile de rua');
})();

/** O que o armazém de extratos viu de cada linha. */
interface SavedLine {
  readonly characterId: string;
  readonly reason: string;
  readonly sessionId: string;
  readonly worldPosition?: { x: number; y: number; z: number } | null;
  readonly health?: number;
  readonly mana?: number;
  readonly conditions?: readonly unknown[];
  readonly townId?: string;
}

interface Node {
  readonly host: SessionHost;
  readonly wiring: SessionWiring;
  /** Toda linha gravada, na ordem — a avulsa (`save`) e a do lote (`saveBatch`). */
  readonly saved: SavedLine[];
  /** Quem o diretório soltou, na ordem. */
  readonly released: string[];
  /** Onde o diretório acha cada personagem. */
  readonly located: Map<string, SessionLocation>;
  readonly tick: (ms: number) => void;
  readonly now: () => number;
  /** O handshake do `game`: `prepare` e, se `attach`, um socket e o `session-attach`. */
  readonly login: (id: string, initial?: Partial<InitialCharacter>, options?: LoginOptions) => Promise<Login>;
  readonly session: (id: string) => Session;
  readonly character: (id: string) => CharacterRuntime;
  readonly typeOf: (id: string) => string | undefined;
  /** O último extrato gravado de `id`. */
  readonly lastLine: (id: string) => SavedLine | undefined;
}

interface Login {
  readonly viewer: Viewer;
  readonly socket: FakeSocket;
}

interface LoginOptions {
  readonly entry?: { readonly hunt: string };
  /** Não liga socket nenhum: o navegador fechado. */
  readonly detached?: boolean;
  readonly party?: PartyTicket;
}

function node(options: {
  readonly openWorld?: boolean;
  /** O `save` de extrato espera esta promessa — para um visualizador cair no meio da gravação. */
  readonly gateSave?: Promise<void>;
  /** As primeiras N gravações de extrato avulso FALHAM (o Redis que pisca): a sucessão que não fecha. */
  readonly failSaves?: number;
} = {}): Node {
  const content = real();
  let nowMs = 0;
  const openWorld = options.openWorld !== false;
  const wiring = createSessionWiring(content, () => nowMs, { openWorld });
  const saved: SavedLine[] = [];
  const released: string[] = [];
  const located = new Map<string, SessionLocation>();
  let failuresLeft = options.failSaves ?? 0;
  const receipts = {
    save: async (line: SavedLine) => {
      if (options.gateSave !== undefined) await options.gateSave;
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('receipt store unavailable');
      }
      saved.push(line);
    },
    saveBatch: async (batch: readonly SavedLine[]) => { saved.push(...batch); },
  } as unknown as ReceiptStore;
  // O diretório com a CAS de verdade: sem ele uma sucessão que perde a corrida passa em silêncio — e é a que
  // perde que SOLTA o personagem.
  const directory = {
    register: async (characterId: string, location: SessionLocation) => {
      located.set(characterId, location);
      return true;
    },
    succeed: async (characterId: string, _accountId: string, from: SessionLocation, to: SessionLocation) => {
      if (located.get(characterId)?.sessionId !== from.sessionId) return false;
      located.set(characterId, to);
      return true;
    },
    release: async (characterId: string) => { released.push(characterId); located.delete(characterId); },
    releaseSlot: async () => undefined,
    renew: async () => undefined,
    aliveNodes: async () => [],
  } as unknown as SessionDirectory;
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, receipts, directory, now: () => nowMs, openWorld,
    createSession: wiring.createSession,
    buildSession: wiring.buildSession,
    createParticipant: createLateJoiner(content, () => nowMs),
    itemCatalog: content.items,
    blessingCatalog: content.blessings,
    progression: content.progression,
  });
  const login: Node['login'] = async (id, initial = {}, loginOptions = {}) => {
    await host.prepare(
      id, { level: 1, xp: 0, townId: 'thais', ...initial }, `acc-${id}`, loginOptions.party, loginOptions.entry,
    );
    const socket = new FakeSocket();
    if (loginOptions.detached === true) return { viewer: undefined as unknown as Viewer, socket };
    const viewer = host.attach(socket, id);
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    return { viewer, socket };
  };
  return {
    host, wiring, saved, released, located, login,
    now: () => nowMs,
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
    typeOf: (id) => host.sessionFor(id)?.ruleset.type,
    lastLine: (id) => saved.filter((line) => line.characterId === id).at(-1),
  };
}

const ofType = <T extends S2CMessage['type']>(messages: readonly S2CMessage[], type: T) =>
  messages.filter((message): message is Extract<S2CMessage, { type: T }> => message.type === type);

/** Deixa as promessas do hospedeiro terminarem: a sucessão e a transição correm fora do ciclo. */
const settle = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

/** Põe o personagem em luta AGORA, no relógio lógico da sessão em que está (`isInFight`). */
const intoFight = (n: Node, id: string): void => {
  n.character(id).lastCombatActionAtMs = n.session(id).nowMs;
};

/**
 * Faz a hunt acabar DENTRO de um avanço, como acaba de verdade — uma regra de saída, a morte —, e não entre
 * dois: o ciclo pula a sessão que já acabou, e só quem encerra dentro do avanço dispara a sucessão.
 */
function endInsideNextAdvance(session: Session, finish: (session: Session) => void): void {
  // O `advanceBy` de verdade, e não o que está na instância: um segundo espião sobre o primeiro se chamaria a si
  // mesmo.
  const original = (ms: number): void => { Session.prototype.advanceBy.call(session, ms); };
  let done = false;
  vi.spyOn(session, 'advanceBy').mockImplementation((ms: number) => {
    original(ms);
    if (done || session.ended !== null) return;
    done = true;
    finish(session);
  });
}

describe('entrar numa instância passa por canLogout (#841, ADR 0060 d.6a)', () => {
  it('em luta fora da PZ a entrada é recusada com `in-fight`, o motivo chega a quem pediu e nada se move', async () => {
    const n = node();
    const a = await n.login('a', { worldPosition: absolute(STREET) });
    const world = n.session('a');
    n.tick(10_000);
    intoFight(n, 'a');

    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    n.host.flush();

    // O motivo do Canary (`YOUMAYNOTLOGOUTDURINGAFIGHT`), o MESMO do `logout` recusado: o cliente escreve um texto só.
    expect(ofType(a.socket.received(), 'logout-refused')).toEqual([{ type: 'logout-refused', reason: 'in-fight' }]);
    // O personagem segue no mundo, no tile onde estava, e nada foi gravado: a recusa é antes de qualquer efeito.
    expect(n.session('a')).toBe(world);
    expect(n.typeOf('a')).toBe('world');
    expect(n.character('a').position).toEqual(STREET);
    expect(n.saved).toEqual([]);
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(1);
  });

  it('o tile de no-logout recusa por tile, e nem a PZ de cima do templo (PZ + no-logout) deixa entrar', async () => {
    const n = node();
    const up = await n.login('up', { worldPosition: absolute(UPSTAIRS) });

    n.host.handle(up.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    n.host.flush();

    // O no-logout vale por cima da PZ (`player.cpp:6972-6978`): é a ordem que `canLogout` fixa, e a entrada na
    // instância é o mesmo portão do logout.
    expect(ofType(up.socket.received(), 'logout-refused')).toEqual([{ type: 'logout-refused', reason: 'no-logout-tile' }]);
    expect(n.typeOf('up')).toBe('world');
  });

  it('na PZ entra mesmo em luta: o templo é o refúgio, como o logout', async () => {
    const n = node();
    const a = await n.login('a'); // o templo é PZ
    n.tick(10_000);
    intoFight(n, 'a');

    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    n.host.flush();

    expect(n.typeOf('a')).toBe('hunt');
    expect(ofType(a.socket.received(), 'logout-refused')).toEqual([]);
  });

  it('a janela de luta vence no relógio LÓGICO: 60 s depois do último golpe, a mesma entrada passa', async () => {
    const n = node();
    const a = await n.login('a', { worldPosition: absolute(STREET) });
    n.tick(10_000);
    intoFight(n, 'a');

    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    expect(n.typeOf('a')).toBe('world');

    // 59 s: ainda em luta. A recusa não deixa estado — nada a limpar — e o pedido seguinte decide de novo.
    n.tick(59_000);
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    expect(n.typeOf('a')).toBe('world');

    n.tick(1_000);
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    expect(n.typeOf('a')).toBe('hunt');
  });

  it('a API de transição lança `TransitionError` `cannot-logout` com o motivo, e não mexe em nada', async () => {
    const n = node();
    await n.login('a', { worldPosition: absolute(STREET) });
    n.tick(10_000);
    intoFight(n, 'a');

    const refused = await n.host.transition('a', { to: 'hunt', huntId: HUNT }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(TransitionError);
    expect(refused).toMatchObject({ refusal: 'cannot-logout', logoutRefusal: 'in-fight' });
    expect(n.typeOf('a')).toBe('world');
    expect(n.saved).toEqual([]);
  });

  it('a recusa NÃO prende a hunt de quem não está no mundo: a Cidade da flag desligada entra de onde está', async () => {
    const n = node({ openWorld: false });
    const a = await n.login('a');
    expect(n.typeOf('a')).toBe('city');
    // Carimbo de luta na Cidade: a regra do logout é do mundo, e a Cidade não a conhece.
    n.character('a').lastCombatActionAtMs = 0;

    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();

    expect(n.typeOf('a')).toBe('hunt');
  });
});

describe('a hunt acaba COM visualizador: volta ao mundo, no tile de onde saiu (#841, ADR 0060 d.6c)', () => {
  it('do templo: vai, a hunt acaba, e volta ao templo — na sessão do mundo, com o mesmo visualizador', async () => {
    const n = node();
    const a = await n.login('a');
    await n.login('keeper', { worldPosition: absolute(OTHER_STREET) }); // mantém o mundo de pé
    const world = n.session('a');

    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    expect(n.typeOf('a')).toBe('hunt');
    // A saída gravou a âncora: o templo, em coordenada absoluta.
    expect(n.lastLine('a')).toMatchObject({ reason: 'manual-exit', worldPosition: absolute(TEMPLE) });

    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.end('exit-rule'); });
    n.tick(1_000);
    await settle();
    n.host.flush();

    // De volta ao MUNDO — não à Cidade, que cura —, no tile de onde saiu, junto de quem ficou.
    expect(n.typeOf('a')).toBe('world');
    expect(n.session('a')).toBe(world);
    expect(n.character('a').position).toEqual(TEMPLE);
    expect(world.participants.map((participant) => participant.id)).toEqual(['keeper', 'a']);
    expect(n.wiring.cityShard.population).toBe(0);
    expect(n.located.get('a')).toMatchObject({ sessionId: world.id, type: 'world' });
    // O visualizador acompanhou o PERSONAGEM: o fim da hunt chegou e a cena do mundo veio depois.
    expect(a.viewer.dead).toBe(false);
    const messages = a.socket.received();
    expect(ofType(messages, 'session-ended').map((message) => message.reason)).toEqual(['exit-rule']);
    expect(ofType(messages, 'instance-enter').at(-1)).toMatchObject({ map: 'thais' });
    expect(n.released).toEqual([]);
  });

  it('da rua: volta ao MESMO tile, e a vida e a mana são as da volta — o mundo não cura', async () => {
    const n = node();
    const a = await n.login('a', { worldPosition: absolute(STREET) });
    await n.login('keeper');
    const maxHealth = n.character('a').maxHealth;
    n.character('a').health = Math.floor(maxHealth / 2);
    const health = n.character('a').health;

    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    // Uma regra de saída qualquer: o que importa é o personagem, e nenhum pulso de regeneração o cura entre os dois.
    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.end('exit-rule'); });
    n.tick(500);
    await settle();

    expect(n.typeOf('a')).toBe('world');
    expect(n.character('a').position).toEqual(STREET);
    // Sem cura na chegada (a Cidade curaria em `onEnter`, para a vida cheia): a vida é a de quem chegou — a hunt
    // mexeu nela, para cima ou para baixo, mas nunca a levou ao máximo.
    expect(n.character('a').health).toBeLessThan(maxHealth);
    expect(n.character('a').health).toBeGreaterThan(0);
    expect(n.character('a').alive).toBe(true);
    void health;
  });

  it('o `leave-hunt` de quem olha volta ao mundo: é o jogador pedindo, e ele está olhando', async () => {
    const n = node();
    const a = await n.login('a', { worldPosition: absolute(STREET) });
    await n.login('keeper');
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    expect(n.typeOf('a')).toBe('hunt');

    n.host.handle(a.viewer, { type: 'leave-hunt' });
    await settle();

    expect(n.typeOf('a')).toBe('world');
    expect(n.character('a').position).toEqual(STREET);
  });

  it('o `leave-hunt` que RETENTA uma sucessão que falhou também volta ao mundo: o destino é o mesmo do fim da hunt', async () => {
    const n = node({ failSaves: 1 });
    const a = await n.login('a', { worldPosition: absolute(STREET) });
    await n.login('keeper', { worldPosition: absolute(OTHER_STREET) });
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.end('exit-rule'); });
    n.tick(500);
    await settle();
    // O Redis piscou: o extrato não gravou, a sucessão não fechou, e o personagem ficou na hunt que acabou.
    expect(n.typeOf('a')).toBe('hunt');
    expect(n.session('a').ended).not.toBeNull();

    // O jogador clica de novo: o retry manual é a transição de sempre — e para o MUNDO, não para a Cidade.
    n.host.handle(a.viewer, { type: 'leave-hunt' });
    await settle();

    expect(n.typeOf('a')).toBe('world');
    expect(n.character('a').position).toEqual(STREET);
    expect(n.wiring.cityShard.population).toBe(0);
  });

  it('a MORTE com visualizador volta ao mundo no TEMPLO, vivo e de vida cheia — e a âncora de antes cai', async () => {
    const n = node();
    const a = await n.login('a', { worldPosition: absolute(STREET) });
    await n.login('keeper', { worldPosition: absolute(OTHER_STREET) });
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    const hero = n.character('a');
    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.kill(hero); });

    n.tick(1_000);
    await settle();
    n.host.flush();

    // `player.cpp:4034-4041, 4226-4252`: o templo, de vida e mana cheias. Quem morreu NÃO volta ao tile da rua.
    expect(n.typeOf('a')).toBe('world');
    expect(n.character('a').alive).toBe(true);
    expect(n.character('a').health).toBe(n.character('a').maxHealth);
    expect(n.character('a').mana).toBe(n.character('a').maxMana);
    expect(n.character('a').position).toEqual(TEMPLE);
    expect(n.character('a').worldPosition).toBeNull();
    expect(ofType(a.socket.received(), 'session-ended').map((message) => message.reason)).toEqual(['death']);
    // O extrato da morte leva o mesmo personagem que o repouso levaria: o templo e a vida cheia.
    expect(n.lastLine('a')).toMatchObject({ reason: 'death', worldPosition: null, health: hero.maxHealth, conditions: [] });
  });

  it('o mundo vazio some e a volta cria outro: quem volta de uma hunt nunca é recusado pelo teto', async () => {
    const n = node();
    const a = await n.login('a', { worldPosition: absolute(STREET) });
    const first = n.session('a');
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(0);

    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.end('exit-rule'); });
    n.tick(500);
    await settle();

    expect(n.typeOf('a')).toBe('world');
    expect(n.session('a')).not.toBe(first);
    expect(n.character('a').position).toEqual(STREET);
  });
});

describe('a hunt acaba SEM ninguém olhando: o repouso, e nunca o mundo (#841, ADR 0060 d.6c)', () => {
  it('fecha o navegador na hunt e deixa-a acabar por regra de saída (`out-of-gold`): repouso no tile de saída, e o mundo nem nasce', async () => {
    const n = node();
    // A hunt idle direta do login (OW-21): o personagem desloga na rua e a primeira sessão dele é a hunt, e o
    // navegador fecha — o socket nunca chega a abrir. A hunt continua a 1 Hz.
    await n.login('a', { worldPosition: absolute(STREET), gold: 0 }, { entry: { hunt: HUNT }, detached: true });
    expect(n.typeOf('a')).toBe('hunt');
    // Quando a regra `out-of-gold` dispara — e quando a janela de luta a deixa concluir — é do `sim` (a suíte da
    // hunt prova); o que o hospedeiro vê é a sessão que acaba por `exit-rule`, DENTRO de um avanço.
    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.end('exit-rule'); });
    n.tick(5_000);
    await settle();

    // Sem visualizador (nem chegou a haver): a regra de saída acabou a hunt, e o personagem está em REPOUSO —
    // sem sessão, sem registro no diretório —, no tile de onde deslogou. Nenhum mundo foi criado para recebê-lo.
    expect(n.host.sessionFor('a')).toBeUndefined();
    expect(n.host.sessionCount).toBe(0);
    expect(n.wiring.worldShard?.worlds).toBe(0);
    expect(n.wiring.cityShard.population).toBe(0);
    expect(n.located.has('a')).toBe(false);
    expect(n.released).toEqual(['a']);
    // O extrato que pousou É o checkpoint: a reason da regra, a âncora e os vitais.
    expect(n.lastLine('a')).toMatchObject({
      reason: 'exit-rule', worldPosition: absolute(STREET), townId: 'thais',
    });
    expect(n.lastLine('a')?.health).toBeGreaterThan(0);
  });

  it('o mesmo a partir do mundo: foi caçar do templo, o navegador fechou, a hunt acabou — repouso, e o mundo segue de pé', async () => {
    const n = node();
    const a = await n.login('a');
    await n.login('keeper', { worldPosition: absolute(OTHER_STREET) });
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    expect(n.typeOf('a')).toBe('hunt');
    // O navegador fecha DURANTE a hunt: a hunt idle sobrevive a isso (invariante 3).
    n.host.detach(a.viewer);
    const hunt = n.session('a');
    endInsideNextAdvance(hunt, (session) => { session.end('exit-rule'); });

    n.tick(2_000);
    await settle();

    expect(n.host.sessionFor('a')).toBeUndefined();
    expect(n.located.has('a')).toBe(false);
    expect(n.released).toContain('a');
    // O mundo continua com quem ficou, e NÃO recebeu o desanexado: ele chegaria sem visualizador, sem passar pela
    // queda que dispara `presence-lost`, e morreria sozinho na âncora.
    expect(n.wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(1);
    expect(n.session('keeper').participants.map((participant) => participant.id)).toEqual(['keeper']);
    // O extrato do fim leva a âncora de saída — o templo — e os vitais, para o login seguinte voltar a ele.
    expect(n.lastLine('a')).toMatchObject({ reason: 'exit-rule', worldPosition: absolute(TEMPLE) });
  });

  it('morrer na hunt desanexado: repouso no TEMPLO, com vida e mana cheias, sem condição', async () => {
    const n = node();
    const a = await n.login('a', { worldPosition: absolute(STREET) });
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    const hero = n.character('a');
    n.host.detach(a.viewer);
    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.kill(hero); });

    n.tick(2_000);
    await settle();

    expect(n.host.sessionFor('a')).toBeUndefined();
    expect(n.located.has('a')).toBe(false);
    // `player.cpp:4034-4041, 4226-4252`: a posição vira nula (o templo no login) e a vida e a mana voltam cheias.
    expect(n.lastLine('a')).toMatchObject({
      reason: 'death', worldPosition: null, health: hero.maxHealth, mana: hero.maxMana, conditions: [],
    });
    expect(n.wiring.worldShard?.worlds).toBe(0);
  });

  it('o visualizador que cai ENQUANTO o extrato grava vale como desanexado: a decisão é depois de gravar', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const n = node({ gateSave: gate });
    const a = await n.login('a', { worldPosition: absolute(STREET) });
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    // O extrato de saída do mundo grava em lote, sem esperar o portão; a hunt, não.
    await settle();
    expect(n.typeOf('a')).toBe('hunt');
    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.end('exit-rule'); });
    n.tick(500);
    await settle();
    // A sucessão está esperando o extrato pousar, com o visualizador ainda ligado...
    expect(n.host.sessionFor('a')).toBeDefined();

    // ...e o navegador fecha nesse intervalo.
    n.host.detach(a.viewer);
    release();
    await settle();

    // Mutação que mata: decidir ANTES de gravar — o personagem iria ao mundo sem visualizador, e morreria lá.
    expect(n.host.sessionFor('a')).toBeUndefined();
    expect(n.wiring.worldShard?.worlds).toBe(0);
    expect(n.located.has('a')).toBe(false);
  });

  it('o personagem em repouso volta pelo login: o ticket traz a âncora gravada, e o mundo o põe lá', async () => {
    const n = node();
    await n.login('a', { worldPosition: absolute(STREET), gold: 0 }, { entry: { hunt: HUNT }, detached: true });
    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.end('exit-rule'); });
    n.tick(5_000);
    await settle();
    const line = n.lastLine('a');
    expect(n.host.sessionFor('a')).toBeUndefined();

    // O ticket seguinte é o `api` lendo a linha que o `jobs` aplicou: a âncora e os vitais do extrato.
    if (line?.worldPosition == null || line.health === undefined || line.mana === undefined) {
      throw new Error('o extrato do fim da hunt não levou o mundo');
    }
    await n.login('a', { worldPosition: line.worldPosition, health: line.health, mana: line.mana });

    expect(n.typeOf('a')).toBe('world');
    expect(n.character('a').position).toEqual(STREET);
  });
});

describe('a largada de party a partir do mundo checa canLogout de cada membro (#841)', () => {
  const ticket = (members: readonly string[], over: Partial<PartyTicket> = {}): PartyTicket => ({
    sessionId: 's-party', leaderId: members[0] as string, shareCosts: false, splitLoot: false,
    huntId: HUNT, difficulty: 'cautious',
    members: members.map((characterId) => ({
      characterId, accountId: `acc-${characterId}`,
      initialCharacter: { level: 1, xp: 0, townId: 'thais', name: characterId },
    })),
    ...over,
  });
  const launch = (n: Node, party: PartyTicket, id = party.leaderId): Promise<PrepareResult> =>
    n.host.prepare(id, party.members.find((m) => m.characterId === id)?.initialCharacter, `acc-${id}`, party);
  /**
   * O que o socket novo faz depois do `prepare`: a largada tira o personagem do mundo e SOLTA o visualizador
   * dele (`#leaveForParty`), e é o websocket do ticket da party que o anexa à hunt.
   */
  const watch = (n: Node, id: string): Viewer => {
    const viewer = n.host.attach(new FakeSocket(), id);
    n.host.handle(viewer, { type: 'session-attach' });
    return viewer;
  };

  it('um membro em luta derruba a largada: ninguém é movido, e quem está em luta recebe o motivo', async () => {
    const n = node();
    const leader = await n.login('leader');
    const fighter = await n.login('fighter', { worldPosition: absolute(STREET) });
    n.tick(10_000);
    intoFight(n, 'fighter');
    const world = n.session('leader');

    const result = await launch(n, ticket(['leader', 'fighter']));

    expect(result).toEqual({ created: false, refused: 'member-in-fight' });
    // NADA foi movido: os dois seguem no mundo, a party não existe, e o diretório não mudou.
    expect(n.session('leader')).toBe(world);
    expect(n.session('fighter')).toBe(world);
    expect(n.host.sessionCount).toBe(1);
    expect(n.located.get('leader')).toMatchObject({ sessionId: world.id, type: 'world' });
    expect(n.located.get('fighter')).toMatchObject({ sessionId: world.id, type: 'world' });
    expect(n.saved).toEqual([]);
    // O culpado sabe por quê — é o `logout` dele que seria recusado —, e o líder não recebe nada dele.
    n.host.flush();
    expect(ofType(fighter.socket.received(), 'logout-refused')).toEqual([{ type: 'logout-refused', reason: 'in-fight' }]);
    expect(ofType(leader.socket.received(), 'logout-refused')).toEqual([]);
  });

  it('o ticket de OUTRO membro, que não está em luta, também cai: a largada é de todos ou de ninguém', async () => {
    const n = node();
    await n.login('leader');
    await n.login('fighter', { worldPosition: absolute(STREET) });
    n.tick(10_000);
    intoFight(n, 'fighter');
    const party = ticket(['leader', 'fighter']);

    // Quem chega primeiro, líder ou não, é quem cria a hunt com TODOS: a conferência é de todos os membros.
    expect(await launch(n, party, 'leader')).toMatchObject({ refused: 'member-in-fight' });
    expect(await launch(n, party, 'fighter')).toMatchObject({ refused: 'member-in-fight' });
    expect(n.typeOf('leader')).toBe('world');
    expect(n.typeOf('fighter')).toBe('world');
  });

  it('fora de luta — ou em luta na PZ — a largada sai e tira todo membro do mundo', async () => {
    const n = node();
    await n.login('leader'); // o templo, PZ
    await n.login('fighter', { worldPosition: absolute(STREET) });
    n.tick(10_000);
    intoFight(n, 'leader'); // em luta, mas na PZ: passa
    const world = n.session('leader');

    expect(await launch(n, ticket(['leader', 'fighter']))).toEqual({ created: true });

    expect(n.typeOf('leader')).toBe('hunt');
    expect(n.typeOf('fighter')).toBe('hunt');
    expect(n.session('leader')).toBe(n.session('fighter'));
    expect(world.participants).toEqual([]);
    expect(n.located.get('fighter')).toMatchObject({ sessionId: 's-party', type: 'hunt' });
  });

  it('a luta que acaba libera a largada: 60 s depois o mesmo ticket passa', async () => {
    const n = node();
    await n.login('leader');
    await n.login('fighter', { worldPosition: absolute(STREET) });
    n.tick(10_000);
    intoFight(n, 'fighter');
    const party = ticket(['leader', 'fighter']);
    expect(await launch(n, party)).toMatchObject({ refused: 'member-in-fight' });

    n.tick(60_000);

    expect(await launch(n, party)).toEqual({ created: true });
    expect(n.typeOf('fighter')).toBe('hunt');
  });

  it('o ticket de ENTRADA numa hunt em curso (`join`) de quem está em luta também é recusado', async () => {
    const n = node();
    await n.login('leader');
    await n.login('mate');
    await launch(n, ticket(['leader', 'mate']));
    expect(n.typeOf('leader')).toBe('hunt');
    // Quem chega depois, do mundo, em luta fora da PZ.
    const late = await n.login('late', { worldPosition: absolute(STREET) });
    n.tick(10_000);
    intoFight(n, 'late');
    const join: PartyTicket = {
      ...ticket(['leader', 'mate']), join: true,
      members: [{ characterId: 'late', accountId: 'acc-late', initialCharacter: { level: 1, xp: 0, townId: 'thais', name: 'late' } }],
    };

    const refused = await n.host.prepare('late', join.members[0]?.initialCharacter, 'acc-late', join);

    expect(refused).toEqual({ created: false, refused: 'member-in-fight' });
    expect(n.typeOf('late')).toBe('world');
    expect(n.session('leader').participants.map((participant) => participant.id)).toEqual(['leader', 'mate']);
    n.host.flush();
    expect(ofType(late.socket.received(), 'logout-refused')).toEqual([{ type: 'logout-refused', reason: 'in-fight' }]);
  });

  it('a party largada do mundo VOLTA ao tile de onde cada um saiu: a âncora de agora, não a do último checkpoint', async () => {
    const n = node();
    const leader = await n.login('leader', { worldPosition: absolute(STREET) });
    const mate = await n.login('mate', { worldPosition: absolute(OTHER_STREET) });
    // O banco tem a posição de um checkpoint atrás: o ticket da party a carrega, e o mundo já andou.
    const stale = { ...absolute(TEMPLE) };
    const party = ticket(['leader', 'mate']);
    const staleParty: PartyTicket = {
      ...party,
      members: party.members.map((member) => ({
        ...member, initialCharacter: { ...member.initialCharacter, worldPosition: stale },
      })),
    };
    await launch(n, staleParty);
    watch(n, 'leader');
    watch(n, 'mate');
    expect(n.typeOf('leader')).toBe('hunt');
    // A âncora que cada um leva para a hunt é a de AGORA — a que a saída do mundo gravou —, não a do ticket.
    expect(n.character('leader').worldPosition).toEqual(absolute(STREET));
    expect(n.character('mate').worldPosition).toEqual(absolute(OTHER_STREET));

    // A party acaba com os dois olhando: cada um volta ao mundo no tile de onde saiu.
    const hunt = n.session('leader');
    endInsideNextAdvance(hunt, (session) => { session.end('exit-rule'); });
    n.tick(1_000);
    await settle();

    expect(n.typeOf('leader')).toBe('world');
    expect(n.typeOf('mate')).toBe('world');
    expect(n.character('leader').position).toEqual(STREET);
    expect(n.character('mate').position).toEqual(OTHER_STREET);
    void leader;
    void mate;
  });

  it('o membro que sai por dentro vai ao repouso SEM encerrar a hunt dos outros; o último, olhando, volta ao mundo', async () => {
    const n = node();
    const leader = await n.login('leader', { worldPosition: absolute(STREET) });
    const mate = await n.login('mate', { worldPosition: absolute(OTHER_STREET) });
    await launch(n, ticket(['leader', 'mate']));
    const hunt = n.session('leader');
    // Só o líder olha: o outro membro tem o navegador fechado.
    const leaderWatching = watch(n, 'leader');
    void mate;
    const mateHero = n.character('mate');
    endInsideNextAdvance(hunt, (session) => { session.kill(mateHero); });

    n.tick(1_000);
    await settle();

    // `mate` saiu da party por dentro (a morte), sem ninguém olhando: repouso, no templo, de vida cheia. E a
    // hunt do líder CONTINUA — soltá-lo pelo `release` de sempre a teria encerrado, com `manual-exit`.
    expect(n.host.sessionFor('mate')).toBeUndefined();
    expect(n.located.has('mate')).toBe(false);
    expect(n.lastLine('mate')).toMatchObject({ reason: 'death', worldPosition: null, health: mateHero.maxHealth });
    expect(n.typeOf('leader')).toBe('hunt');
    expect(n.session('leader')).toBe(hunt);
    expect(hunt.ended).toBeNull();
    expect(hunt.participants.map((participant) => participant.id)).toEqual(['leader']);

    // Depois o líder, olhando, vê a hunt acabar: ele volta ao mundo, no tile de onde saiu.
    endInsideNextAdvance(hunt, (session) => { session.end('exit-rule'); });
    n.tick(1_000);
    await settle();
    expect(n.typeOf('leader')).toBe('world');
    expect(n.character('leader').position).toEqual(STREET);
    expect(leaderWatching.dead).toBe(false);
    void leader;
  });
});

describe('a drenagem leva TODOS ao repouso (#841, ADR 0060 d.6c)', () => {
  it('com hunts desanexadas e gente no mundo: todos saem do nó, com o extrato que leva a âncora e os vitais', async () => {
    const n = node();
    // Duas hunts idle desanexadas: uma direta do login (a rua) e uma que saiu do mundo (o templo).
    await n.login('direct', { worldPosition: absolute(STREET) }, { entry: { hunt: HUNT }, detached: true });
    const left = await n.login('left');
    n.host.handle(left.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    n.host.detach(left.viewer);
    // E duas pessoas no mundo, uma olhando e outra não.
    const watching = await n.login('watching', { worldPosition: absolute(OTHER_STREET) });
    await n.login('away', { worldPosition: absolute(UPSTAIRS) }, { detached: true });
    n.saved.length = 0;

    await n.host.drainAll();

    // Ninguém fica sem estado nem com sessão: todos em repouso — o personagem é a linha de `characters`.
    for (const id of ['direct', 'left', 'watching', 'away']) {
      expect(n.host.sessionFor(id)).toBeUndefined();
      expect(n.located.has(id)).toBe(false);
      expect(n.released).toContain(id);
    }
    expect(n.host.sessionCount).toBe(0);
    // Cada um gravou o extrato do fim, com a âncora do tile de onde saiu e os vitais.
    expect(n.lastLine('direct')).toMatchObject({ reason: 'drain', worldPosition: absolute(STREET), townId: 'thais' });
    expect(n.lastLine('left')).toMatchObject({ reason: 'drain', worldPosition: absolute(TEMPLE) });
    expect(n.lastLine('watching')).toMatchObject({ worldPosition: absolute(OTHER_STREET) });
    // O que olhava foi fechado com o código da drenagem, e nenhum foi posto num mundo novo.
    expect(watching.socket.ended).toMatchObject({ code: 1001, reason: 'drain' });
    expect(n.wiring.worldShard?.worlds).toBe(0);
  });
});

describe('com a flag DESLIGADA o fim da hunt é o de hoje: a Cidade, com ou sem visualizador (#841)', () => {
  it('com visualizador volta à Cidade, que cura', async () => {
    const n = node({ openWorld: false });
    const a = await n.login('a');
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    n.character('a').health = 1;
    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.end('exit-rule'); });

    n.tick(1_000);
    await settle();

    expect(n.typeOf('a')).toBe('city');
    expect(n.character('a').health).toBe(n.character('a').maxHealth);
    expect(n.wiring.worldShard).toBeUndefined();
  });

  it('sem visualizador também vai à Cidade — o repouso sem sessão é do mundo aberto, e só dele', async () => {
    const n = node({ openWorld: false });
    const a = await n.login('a');
    n.host.handle(a.viewer, { type: 'enter-hunt', huntId: HUNT });
    await settle();
    n.host.detach(a.viewer);
    endInsideNextAdvance(n.session('a'), (hunt) => { hunt.end('exit-rule'); });

    n.tick(2_000);
    await settle();

    expect(n.typeOf('a')).toBe('city');
    expect(n.located.get('a')).toMatchObject({ type: 'city' });
    expect(n.released).toEqual([]);
  });
});
