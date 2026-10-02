import { decodeC2S, encodeS2C } from '@draconya/protocol';
import type { TicketEntry } from '../account/api.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_HUD, hud } from '../state/hud.js';
import { world } from '../state/world.js';
import { createConnection, type SocketLike } from './connection.js';
import { offerWsUrl, takeWsUrl } from './pending-ticket.js';

class FakeSocket implements SocketLike {
  binaryType = '';
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: Uint8Array[] = [];
  closed = false;

  send(data: ArrayBufferView): void {
    this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  close(): void {
    this.closed = true;
  }

  /** O que o cliente mandou, já decodificado. */
  requests(): string[] {
    return this.sent.flatMap((frame) => (decodeC2S(frame) ?? []).map((m) => m.type));
  }
}

function harness(
  overrides: { requestTicket?: () => Promise<string>; entry?: TicketEntry; onLeft?: () => void } = {},
) {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const entries: TicketEntry[] = [];
  let requestTicketCalls = 0;
  const pending: Array<{ fn: () => void; delayMs: number }> = [];
  const connection = createConnection({
    apiUrl: 'http://api',
    characterId: 'c1',
    ...(overrides.entry === undefined ? {} : { entry: overrides.entry }),
    ...(overrides.onLeft === undefined ? {} : { onLeft: overrides.onLeft }),
    requestTicket: async (_apiUrl, _characterId, entry) => {
      requestTicketCalls += 1;
      entries.push(entry);
      return overrides.requestTicket === undefined ? 'ws://node/?ticket=t' : overrides.requestTicket();
    },
    openSocket: (url) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    schedule: (fn, delayMs) => {
      const entry = { fn, delayMs };
      pending.push(entry);
      return () => {
        const index = pending.indexOf(entry);
        if (index >= 0) pending.splice(index, 1);
      };
    },
    random: () => 1,
  });
  const runPending = (): void => {
    const due = pending.splice(0, pending.length);
    for (const entry of due) entry.fn();
  };
  return { connection, sockets, urls, entries, requestTicketCalls: () => requestTicketCalls, pending, runPending };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
  world.creatures.clear();
  world.selfId = null;
  // A fila de ticket oferecido é um módulo só (#197): um teste anterior que ofereceu e não
  // consumiu vazaria para o próximo. `takeWsUrl` também CONSOME, então isto já limpa.
  takeWsUrl();
});

describe('connection', () => {
  it('reattaches on open instead of asking to log in again', async () => {
    // Reconectar é REANEXAR. A primeira coisa que sai do socket é `session-attach`; se fosse
    // um login, o modelo de sessão (ADR 0001) teria vazado para a UI.
    const { connection, sockets } = harness();
    connection.start();
    await flush();

    expect(sockets).toHaveLength(1);
    sockets[0]?.onopen?.({});
    expect(sockets[0]?.requests()).toEqual(['session-attach']);
    expect(hud.get().connection).toBe('connected');
  });

  it('does not clear the world when the socket drops', async () => {
    // A tela continua mostrando a última coisa verdadeira em vez de piscar vazia. O mundo é
    // substituído quando o `session-state` chegar, não antes.
    const { connection, sockets, runPending } = harness();
    connection.start();
    await flush();
    sockets[0]?.onopen?.({});
    world.creatures.set(7, {
      id: 7, appearanceId: 1, name: 'r', health: 1, maxHealth: 1,
      position: { x: 1, y: 1, z: 7 }, step: null,
    });

    sockets[0]?.onclose?.({});

    expect(hud.get().connection).toBe('reconnecting');
    expect(world.creatures.size).toBe(1);

    runPending();
    await flush();
    expect(sockets).toHaveLength(2);
  });

  it('waits longer after each failure, and resets once it is back', async () => {
    const { connection, sockets, pending, runPending } = harness();
    connection.start();
    await flush();

    sockets[0]?.onclose?.({});
    expect(pending[0]?.delayMs).toBe(500);
    runPending();
    await flush();

    sockets[1]?.onclose?.({});
    expect(pending[0]?.delayMs).toBe(1_000);
    runPending();
    await flush();

    // Conectou: a próxima queda volta a esperar pouco, senão um blip depois de uma queda
    // longa herdaria a espera de meia hora.
    sockets[2]?.onopen?.({});
    sockets[2]?.onclose?.({});
    expect(pending[0]?.delayMs).toBe(500);
  });

  it('stops retrying after stop, and the intentional close does not schedule one', async () => {
    const { connection, sockets, pending } = harness();
    connection.start();
    await flush();
    sockets[0]?.onopen?.({});

    connection.stop();

    expect(sockets[0]?.closed).toBe(true);
    // Sem zerar os handlers antes de fechar, o `onclose` do fechamento intencional agendaria
    // uma reconexão que ninguém pediu.
    expect(pending).toHaveLength(0);
    expect(hud.get().connection).toBe('idle');
  });

  it('applies a batch of deltas in one go', async () => {
    // Ao voltar de aba de fundo chega um lote inteiro de uma vez. Aplicar em bloco, sem
    // tentar animar dez minutos de eventos.
    const { connection, sockets } = harness();
    connection.start();
    await flush();
    sockets[0]?.onopen?.({});

    const frame = encodeS2C({
      type: 'creature-appear', id: 3, position: { x: 2, y: 2, z: 7 },
      appearanceId: 1, name: 'rato', health: 20, maxHealth: 20,
    });
    sockets[0]?.onmessage?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) });

    expect(world.creatures.get(3)?.name).toBe('rato');
  });

  it('retries when the ticket is refused instead of stalling', async () => {
    // Ticket recusado pode ser transitório. Falhar em silêncio deixaria a tela em
    // "conectando" para sempre, que é indistinguível de jogo travado.
    const sockets: FakeSocket[] = [];
    const pending: Array<{ fn: () => void; delayMs: number }> = [];
    const connection = createConnection({
      apiUrl: 'http://api',
      characterId: 'c1',
      requestTicket: async () => {
        throw new Error('refused');
      },
      openSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (fn, delayMs) => {
        pending.push({ fn, delayMs });
        return () => {};
      },
      random: () => 1,
    });

    connection.start();
    await flush();

    expect(sockets).toHaveLength(0);
    expect(pending).toHaveLength(1);
    expect(hud.get().connection).toBe('reconnecting');
  });

  it('restart with a pending wsUrl opens exactly that URL, with no extra retry (#197, #527)', async () => {
    // A party entra na hunt assim: `enter(wsUrl)` oferece o ticket e reinicia a conexão — o
    // `restart` tem que abrir o socket NAQUELE endereço, não pedir um novo por `POST /api/tickets`.
    const { connection, sockets, urls, requestTicketCalls, pending } = harness();
    connection.start();
    await flush();
    sockets[0]?.onopen?.({});
    expect(urls).toEqual(['ws://node/?ticket=t']);

    offerWsUrl('ws://party-node/?ticket=party-1');
    connection.restart();
    await flush();

    expect(urls).toEqual(['ws://node/?ticket=t', 'ws://party-node/?ticket=party-1']);
    expect(sockets).toHaveLength(2);
    // Nenhuma tentativa a mais agendada: `restart` reconecta na hora, não cai no backoff.
    expect(pending).toHaveLength(0);
    expect(requestTicketCalls()).toBe(1);
  });

  it('restart without a pending ticket requests a fresh one from the api (#527)', async () => {
    const { connection, sockets, urls, requestTicketCalls } = harness();
    connection.start();
    await flush();
    sockets[0]?.onopen?.({});

    connection.restart();
    await flush();

    expect(sockets).toHaveLength(2);
    expect(urls).toEqual(['ws://node/?ticket=t', 'ws://node/?ticket=t']);
    expect(requestTicketCalls()).toBe(2);
  });

  it("the old socket's onclose does not schedule a retry after restart (#527)", async () => {
    // Mutação que mata: sem zerar os handlers do socket velho ANTES de fechar, o `onclose` do
    // fechamento intencional agendaria uma reconexão duplicada — dois sockets brigando pela
    // mesma sessão.
    const { connection, sockets, pending } = harness();
    connection.start();
    await flush();
    const first = sockets[0];
    first?.onopen?.({});

    offerWsUrl('ws://party-node/?ticket=party-1');
    connection.restart();
    await flush();

    expect(sockets).toHaveLength(2);
    expect(pending).toHaveLength(0);
    // O `onclose` do socket velho — disparado pelo `close()` que `restart` chamou, como um
    // WebSocket de verdade faria — não pode agendar nada: os handlers já foram zerados.
    first?.onclose?.({});
    expect(pending).toHaveLength(0);
    expect(sockets).toHaveLength(2);
  });

  it('restart never leaves the status at idle, and keeps sending intent afterward', async () => {
    const { connection, sockets } = harness();
    connection.start();
    await flush();
    sockets[0]?.onopen?.({});
    expect(hud.get().connection).toBe('connected');

    connection.restart();
    // Entre o fechamento e o novo socket abrir, o status é "conectando" — nunca "idle": uma
    // troca de sessão não é uma queda, e "idle" pareceria que a conexão foi encerrada de vez.
    expect(hud.get().connection).toBe('connecting');
    await flush();
    sockets[1]?.onopen?.({});
    expect(hud.get().connection).toBe('connected');

    connection.send({ type: 'ping', t: 1 });
    expect(sockets[1]?.requests()).toContain('ping');
  });
});

describe('o ticket oferecido por fora (#197)', () => {
  it('is used once before asking the api, then the api is asked again', () => {
    offerWsUrl('ws://party/?ticket=p');
    expect(takeWsUrl()).toBe('ws://party/?ticket=p');
    expect(takeWsUrl()).toBeNull();
  });
});

describe('o mundo aberto na conexão (OW-23, #846)', () => {
  const worldFull = (over: { position?: number; retryAfterMs?: number; huntAvailable?: boolean } = {}) => ({
    data: encodeS2C({
      type: 'world-full', position: 3, retryAfterMs: 10_000, huntAvailable: true, ...over,
    }).buffer.slice(0),
  });

  const sessionState = () => ({
    data: encodeS2C({
      type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'c1', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
        level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {},
        magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      world: { groundItems: [], tileUpdates: [], fields: [], mapId: 'rat-cellars', creatures: [] },
      aggregates: {
        durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0, itemsLooted: 0,
        suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
      },
      notableEvents: [],
    }).buffer.slice(0),
  });

  describe('por onde a primeira sessão nasce (entry)', () => {
    it('pede o ticket com o mundo, que é o default — a conexão de sempre', async () => {
      const { connection, entries } = harness();
      connection.start();
      await flush();
      expect(entries).toEqual(['world']);
    });

    it('pede o ticket com a hunt idle enquanto a primeira sessão não existe, mesmo depois de uma queda', async () => {
      const { connection, sockets, entries, runPending } = harness({ entry: { hunt: 'rat-cellars' } });
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});
      // Caiu antes do `session-state`: não houve sessão alguma, e calar o `entry` na segunda tentativa faria a
      // hunt escolhida virar o mundo.
      sockets[0]?.onclose?.({ code: 1006 });
      runPending();
      await flush();
      expect(entries).toEqual([{ hunt: 'rat-cellars' }, { hunt: 'rat-cellars' }]);
    });

    it('depois que a sessão existiu, a volta pede o mundo: o `entry` não inicia uma caçada que ninguém pediu', async () => {
      const { connection, sockets, entries, runPending } = harness({ entry: { hunt: 'rat-cellars' } });
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});
      sockets[0]?.onmessage?.(sessionState());
      // A hunt acabou e a Cidade foi recolhida sem visualizador: o servidor já não tem sessão, e honraria o
      // `entry` repetido como um pedido novo — gastando suprimento de quem só dormiu o notebook.
      // Mutação que mata: pedir `entry` em toda `connect()`, como antes.
      sockets[0]?.onclose?.({ code: 1006 });
      runPending();
      await flush();
      sockets[1]?.onopen?.({});
      sockets[1]?.onclose?.({ code: 1006 });
      runPending();
      await flush();
      expect(entries).toEqual([{ hunt: 'rat-cellars' }, 'world', 'world']);
    });

    it('o ticket oferecido que falhou também cai no mundo, e não na hunt de antes', async () => {
      const { connection, sockets, entries, runPending } = harness({ entry: { hunt: 'rat-cellars' } });
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});
      sockets[0]?.onmessage?.(sessionState());
      offerWsUrl('ws://party/?ticket=p');
      sockets[0]?.onclose?.({ code: 1006 });
      runPending();
      await flush();
      // O ticket de party foi usado (não pediu à api); a queda seguinte pede o ticket normal, do mundo.
      sockets[1]?.onclose?.({ code: 1006 });
      runPending();
      await flush();
      expect(entries).toEqual([{ hunt: 'rat-cellars' }, 'world']);
    });

    it('a fila (world-full) não é sessão: a hunt escolhida continua sendo pedida', async () => {
      const { connection, sockets, entries, runPending } = harness({ entry: { hunt: 'rat-cellars' } });
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});
      sockets[0]?.onmessage?.(worldFull());
      sockets[0]?.onclose?.({ code: 4001 });
      runPending();
      await flush();
      expect(entries).toEqual([{ hunt: 'rat-cellars' }, { hunt: 'rat-cellars' }]);
    });
  });

  describe('o corpo do pedido de ticket', () => {
    const body = async (entry: TicketEntry | undefined): Promise<unknown> => {
      const fetchMock = vi.fn(async () => Response.json({ wsUrl: 'ws://node/?ticket=t' }));
      vi.stubGlobal('fetch', fetchMock);
      const connection = createConnection({
        apiUrl: 'http://api', characterId: 'c1', ...(entry === undefined ? {} : { entry }),
        openSocket: () => new FakeSocket(), schedule: () => () => undefined, random: () => 1,
      });
      connection.start();
      await flush();
      connection.stop();
      vi.unstubAllGlobals();
      const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
      return JSON.parse(init.body as string);
    };

    it('o mundo vai SEM `entry`: o pedido é byte a byte o de antes do mundo aberto', async () => {
      // Mutação que mata: mandar `entry: 'world'` sempre — um `api` anterior (deploy em rolagem) ou um
      // proxy que valida o corpo veria um campo que não conhece.
      expect(await body(undefined)).toEqual({ characterId: 'c1' });
      expect(await body('world')).toEqual({ characterId: 'c1' });
    });

    it('a hunt idle direta vai no `entry`', async () => {
      expect(await body({ hunt: 'rotworm-caves' })).toEqual({
        characterId: 'c1', entry: { hunt: 'rotworm-caves' },
      });
    });
  });

  describe('a fila do mundo cheio (world-full)', () => {
    it('volta no prazo que o SERVIDOR mandou, e não no recuo de uma queda', async () => {
      const { connection, sockets, pending } = harness();
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});
      sockets[0]?.onmessage?.(worldFull({ position: 3, retryAfterMs: 10_000 }));
      sockets[0]?.onclose?.({ code: 4001 });

      // Mutação que mata: cair no `scheduleRetry` de sempre — o recuo de 500 ms voltaria ANTES do prazo da
      // fila (10 s) e o ticket novo seria uma tentativa que a fila recusa, a cada meio segundo.
      expect(pending).toHaveLength(1);
      // `random: () => 1` → a folga inteira de 500 ms: nunca ANTES do prazo, só um pouco depois.
      expect(pending[0]?.delayMs).toBe(10_500);
      expect(hud.get().connection).toBe('queued');
      expect(hud.get().worldQueue).toMatchObject({ position: 3, retryAfterMs: 10_000, huntAvailable: true });
    });

    it('a espera na fila não é falha: o recuo exponencial não anda', async () => {
      const { connection, sockets, pending, runPending } = harness();
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});
      sockets[0]?.onmessage?.(worldFull({ retryAfterMs: 5_000 }));
      sockets[0]?.onclose?.({ code: 4001 });
      runPending();
      await flush();
      // A segunda tentativa também encontra o mundo cheio, na posição de agora.
      sockets[1]?.onopen?.({});
      sockets[1]?.onmessage?.(worldFull({ position: 2, retryAfterMs: 5_000 }));
      sockets[1]?.onclose?.({ code: 4001 });

      expect(pending[0]?.delayMs).toBe(5_500);
      expect(hud.get().worldQueue).toMatchObject({ position: 2 });
    });

    it('um fechamento SEM world-full volta ao recuo de sempre, mesmo depois de uma fila', async () => {
      // O `world-full` é local ao socket que o recebeu: um valor de antes não pode agendar a volta de outra queda.
      const { connection, sockets, pending, runPending } = harness();
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});
      sockets[0]?.onmessage?.(worldFull({ retryAfterMs: 30_000 }));
      sockets[0]?.onclose?.({ code: 4001 });
      runPending();
      await flush();
      sockets[1]?.onopen?.({});
      sockets[1]?.onclose?.({});

      expect(pending[0]?.delayMs).toBe(500);
      expect(hud.get().connection).toBe('reconnecting');
    });

    it('parar durante a espera cancela a volta', async () => {
      const { connection, sockets, pending } = harness();
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});
      sockets[0]?.onmessage?.(worldFull());
      sockets[0]?.onclose?.({ code: 4001 });
      expect(pending).toHaveLength(1);

      connection.stop();

      expect(pending).toHaveLength(0);
      expect(hud.get().connection).toBe('idle');
    });
  });

  describe('o logout aceito', () => {
    it('o servidor fechou com 1000/logout: NÃO reconecta, avisa que o personagem saiu e fica parado', async () => {
      const onLeft = vi.fn();
      const { connection, sockets, pending } = harness({ onLeft });
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});

      sockets[0]?.onclose?.({ code: 1000, reason: 'logout' });

      // Mutação que mata: tratar o fechamento como queda — o cliente reconectaria e recriaria a sessão que o
      // jogador acabou de deixar, e "Sair do jogo" nunca sairia.
      expect(onLeft).toHaveBeenCalledTimes(1);
      expect(pending).toHaveLength(0);
      expect(hud.get().connection).toBe('idle');
    });

    it('qualquer outro fechamento continua sendo queda e reconecta (a drenagem, o nó que caiu)', async () => {
      const onLeft = vi.fn();
      const { connection, sockets, pending } = harness({ onLeft });
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});

      sockets[0]?.onclose?.({ code: 1001, reason: 'drain' });

      expect(onLeft).not.toHaveBeenCalled();
      expect(pending).toHaveLength(1);
      expect(hud.get().connection).toBe('reconnecting');
    });

    it('o 1000 de outro motivo (session-moved) também reconecta — só o logout é "saiu"', async () => {
      const onLeft = vi.fn();
      const { connection, sockets, pending } = harness({ onLeft });
      connection.start();
      await flush();
      sockets[0]?.onopen?.({});

      sockets[0]?.onclose?.({ code: 1000, reason: 'session-moved' });

      expect(onLeft).not.toHaveBeenCalled();
      expect(pending).toHaveLength(1);
    });
  });
});
