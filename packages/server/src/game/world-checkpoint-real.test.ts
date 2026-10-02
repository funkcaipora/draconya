import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { absoluteToLocal, isBlocked, localToAbsolute } from '@draconya/content';
import type { Content, Tilemap, World } from '@draconya/content';
import { WorldRuleset, createWorldSession } from '@draconya/sim';
import type { CharacterRuntime } from '@draconya/sim';
import { createLogger } from '../log.js';
import type { ReceiptStore } from '../receipts.js';
import type { InitialCharacter } from '../tickets.js';
import { SessionHost } from './host.js';
import { characterFromTicket } from './sessions.js';
import { carryRestoredConditions } from '../world-state.js';
import type { WorldState } from '../world-state.js';

// O checkpoint do mundo (#837, OW-16) sobre o mundo REAL: a Thais importada do OTBM, o `main.json` e a
// tabela de progressão de verdade, pelo mesmo `loadContent` do boot, hospedados num `SessionHost`.
// `world-checkpoint.test.ts` prova o mecanismo com um ruleset de mentira; aqui se prova que ele fala a
// língua do `WorldRuleset` de verdade — a âncora é a coordenada ABSOLUTA do tile, a vida regenera e suja
// o personagem, e a posição que o lote gravou é a que o login seguinte usa para recolocá-lo.

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => (cached ??= loadContent(DATA));
const logger = createLogger('silent', 'test');

const worldOf = (): { readonly content: Content; readonly map: Tilemap; readonly world: World } => {
  const content = real();
  const map = content.maps.get('thais');
  const world = content.worlds.get('main');
  if (map === undefined || world === undefined) throw new Error('o conteúdo real não tem a thais ou o mundo main');
  return { content, map, world };
};

/** O que o `ReceiptStore` recebe de um extrato do mundo — o que estes testes leem. */
interface SavedLine extends WorldState {
  readonly characterId: string;
  readonly reason: string;
  readonly seq: number;
}

function hostedWorld() {
  const { content, map, world } = worldOf();
  const session = createWorldSession({ id: 'world-real', map, world, content, seed: 'w', createdAtMs: 0 });
  const batches: SavedLine[][] = [];
  const receipts = {
    save: async () => { throw new Error('o mundo grava em lote'); },
    saveBatch: async (batch: readonly SavedLine[]) => { batches.push([...batch]); },
  } as unknown as ReceiptStore;
  const tickets = new Map<string, InitialCharacter>();
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, receipts, openWorld: true,
    createSession: (characterId) => {
      // O personagem como a sessão o recebe do ticket do `api`, no relógio de agora.
      const hero = characterFromTicket(content, characterId, tickets.get(characterId) ?? { level: 1, xp: 0 }, () => 0);
      carryRestoredConditions(hero, session);
      session.enter(hero);
      return session;
    },
  });
  const enter = async (characterId: string, ticket: Partial<InitialCharacter> = {}): Promise<CharacterRuntime> => {
    tickets.set(characterId, { level: 1, xp: 0, townId: 'thais', ...ticket });
    await host.prepare(characterId, tickets.get(characterId), `acc-${characterId}`);
    const hero = session.participants.find((participant) => participant.id === characterId);
    if (hero === undefined) throw new Error(`${characterId} não entrou no mundo`);
    return hero;
  };
  const ruleset = (): WorldRuleset => {
    if (!(session.ruleset instanceof WorldRuleset)) throw new Error('a sessão não é um mundo');
    return session.ruleset;
  };
  return { host, session, map, batches, enter, ruleset };
}

/** Um tile vizinho em que se pode pisar, no mesmo andar. */
function neighbourOf(map: Tilemap, at: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
    if (!isBlocked(map, at.x + dx, at.y + dy, at.z)) return { x: at.x + dx, y: at.y + dy, z: at.z };
  }
  throw new Error('nenhum vizinho livre');
}

describe('o checkpoint do mundo sobre a Thais real (#837, OW-16)', () => {
  it('quem entrou e ficou parado na PZ do templo, de vida cheia, não gera linha', async () => {
    const f = hostedWorld();
    await f.enter('a');
    await f.enter('b');
    f.session.advanceBy(60_000);

    await f.host.checkpointWorlds();

    expect(f.batches).toEqual([]);
  });

  it('andar suja: a linha leva a coordenada ABSOLUTA do tile de agora, a cidade, a vida e a mana', async () => {
    const f = hostedWorld();
    const hero = await f.enter('a');
    await f.enter('b'); // parado: não entra no lote
    const start = { ...hero.position };
    const to = neighbourOf(f.map, start);

    expect(f.ruleset().requestMove(f.session, 'a', to)).toMatchObject({ ok: true });
    f.session.advanceBy(5_000);
    expect(hero.position).toEqual(to);
    await f.host.checkpointWorlds();

    const [batch] = f.batches;
    expect(batch?.map((line) => line.characterId)).toEqual(['a']);
    expect(batch?.[0]).toMatchObject({
      characterId: 'a', reason: 'checkpoint', townId: 'thais',
      worldPosition: localToAbsolute(f.map, to), health: hero.health, mana: hero.mana,
    });
    // A âncora do dono é a que a linha leva: é por ela que o login seguinte o recoloca.
    expect(hero.worldPosition).toEqual(localToAbsolute(f.map, to));
  });

  it('quem saiu a 10 HP e regenera na PZ — a regeneração do mundo é a da hunt — suja pela vida', async () => {
    // O repouso não cura e o mundo não cura na entrada (ADR 0060 d.14d): a vida sobe por pulso, e o
    // lote tem de ver a vida de agora, não a de ticket.
    const f = hostedWorld();
    const hero = await f.enter('a', { health: 10 });
    expect(hero.health).toBe(10);

    await f.host.checkpointWorlds();
    expect(f.batches).toEqual([]); // a vida de entrada É o que a linha já guarda

    f.session.advanceBy(60_000);
    expect(hero.health).toBeGreaterThan(10);
    await f.host.checkpointWorlds();

    expect(f.batches[0]?.[0]).toMatchObject({ characterId: 'a', health: hero.health });
  });

  it('as condições entram na linha como PRAZO RESTANTE, no relógio da sessão que já andou', async () => {
    const f = hostedWorld();
    f.session.advanceBy(120_000); // o mundo já anda há dois minutos quando ele chega
    const hero = await f.enter('a', { conditions: [{ key: 'haste', expiresAtMs: 8_000, speedPercent: 30 }] });
    f.session.advanceBy(3_000);
    hero.mana = Math.max(0, hero.mana - 1);
    hero.health -= 1;

    await f.host.checkpointWorlds();

    const [line] = f.batches[0] ?? [];
    const haste = line?.conditions?.find((condition) => condition.key === 'haste');
    // Faltavam 8 s na entrada e passaram 3: a linha guarda 5 s, não um instante de relógio.
    expect(haste?.expiresAtMs).toBe(5_000);
  });

  it('a saída grava o tile de onde se saiu, e o login seguinte volta a ele', async () => {
    const f = hostedWorld();
    const hero = await f.enter('a');
    const to = neighbourOf(f.map, hero.position);
    f.ruleset().requestMove(f.session, 'a', to);
    f.session.advanceBy(5_000);

    await f.host.release('a', 1000, 'logout');

    const exit = f.batches[0]?.find((line) => line.characterId === 'a');
    expect(exit).toMatchObject({ reason: 'manual-exit', worldPosition: localToAbsolute(f.map, to) });

    // O próximo login: o ticket traz a âncora que o extrato levou, e o mundo o recoloca nesse tile.
    const back = hostedWorld();
    const arrival = await back.enter('a', { worldPosition: exit?.worldPosition as never });
    expect(arrival.position).toEqual(to);
    expect(absoluteToLocal(back.map, exit?.worldPosition as never)).toEqual(to);
  });
});
