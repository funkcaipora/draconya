import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { absoluteToLocal, isBlocked, localToAbsolute } from '@draconya/content';
import type { Content, Tilemap, World } from '@draconya/content';
import {
  CharacterRuntime, WorldRuleset, canLogout, createWorldSession, statsForLevel, zoneAt,
} from '@draconya/sim';
import type { Session } from '@draconya/sim';

// A sessão do mundo (#834, OW-13) montada sobre o conteúdo REAL — a Thais importada do OTBM e o
// `main.json` do OW-08 —, pelo mesmo `loadContent` do boot. O `sim` só vê mapa sintético (a
// fronteira o proíbe de ler disco), e este arquivo é o que prende que o que a topologia promete
// (o templo, a âncora absoluta, o portão de serviço por PZ) vale sobre o dado que o mundo vai
// usar: o catálogo inteiro de monstros, itens e magias entra no `HuntRuleset`, e a coordenada
// absoluta de verdade (32369, 32241, 7) vira o tile (94, 88, 7).
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => (cached ??= loadContent(DATA));

const worldOf = (): { readonly content: Content; readonly map: Tilemap; readonly world: World } => {
  const content = real();
  const map = content.maps.get('thais');
  const world = content.worlds.get('main');
  if (map === undefined || world === undefined) throw new Error('o conteúdo real não tem a thais ou o mundo main');
  return { content, map, world };
};

const newSession = (id = 'world-real-1'): Session => {
  const { content, map, world } = worldOf();
  return createWorldSession({ id, map, world, content, seed: id, createdAtMs: 0 });
};

const hero = (id: string, worldPosition?: { x: number; y: number; z: number }) => {
  const { content } = worldOf();
  const stats = statsForLevel(1, null, content.progression);
  return new CharacterRuntime({
    id, position: { x: 0, y: 0, z: 7 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
    level: 1, xp: 0, vocationId: null, staminaMs: 86_400_000, staminaUpdatedAtMs: 0,
    gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    ...(worldPosition === undefined ? {} : { worldPosition }),
  });
};

const rulesetOf = (session: Session): WorldRuleset => {
  if (!(session.ruleset instanceof WorldRuleset)) throw new Error('a sessão não é um mundo');
  return session.ruleset;
};

describe('o mundo sobre a Thais real (#834, OW-13)', () => {
  it('monta com o catálogo inteiro do conteúdo, a versão congelada e nenhum monstro ainda', () => {
    const session = newSession();
    expect(session.ruleset.type).toBe('world');
    expect(session.contentVersion).toBe(worldOf().content.version);
    expect(rulesetOf(session).mapId).toBe('thais');
    // O spawn do mundo é da OW-25/OW-31: sem pontos, o mundo anda sem criatura nenhuma.
    session.enter(hero('a'));
    session.advanceBy(60_000);
    expect(rulesetOf(session).monsters).toHaveLength(0);
    expect(session.ended).toBeNull();
  });

  it('o templo absoluto (32369, 32241, 7) é o tile (94, 88, 7): o `entryPoint` da Cidade, em PZ', () => {
    const { map, world } = worldOf();
    const temple = world.towns[0]?.temple;
    if (temple === undefined) throw new Error('o mundo não tem cidade');
    expect(temple).toEqual({ x: 32369, y: 32241, z: 7 });
    expect(absoluteToLocal(map, temple)).toEqual({ x: 94, y: 88, z: 7 });
    expect(map.entryPoint).toEqual({ x: 94, y: 88, z: 7 });

    const session = newSession();
    const first = hero('a');
    const second = hero('b');
    session.enter(first);
    session.enter(second);
    expect(first.position).toEqual({ x: 94, y: 88, z: 7 });
    // O segundo cai no livre mais próximo a pé, ainda dentro da PZ do templo.
    expect(second.position).not.toEqual(first.position);
    expect(zoneAt(map, second.position)).toBe('protection');
    expect(rulesetOf(session).worldPositionOf(first)).toEqual(temple);
  });

  it('serviço de Cidade: aceito na PZ do templo, recusado na rua que começa em (94, 97, 7)', () => {
    const { map } = worldOf();
    const session = newSession();
    const ruleset = rulesetOf(session);
    const inTemple = hero('a');
    const inStreet = hero('b', localToAbsolute(map, { x: 94, y: 97, z: 7 }));
    session.enter(inTemple);
    session.enter(inStreet);
    expect(inStreet.position).toEqual({ x: 94, y: 97, z: 7 });
    expect(ruleset.acceptsCityServices(session, 'a')).toBe(true);
    expect(ruleset.acceptsCityServices(session, 'b')).toBe(false);
  });

  it('a posição salva vale em qualquer andar, e o tile PZ + no-logout de z6 aceita serviço e recusa a saída', () => {
    const { map } = worldOf();
    // O tile em cima do templo é PZ E no-logout (`tile-zones-real.test.ts`): o bit da PZ abre o
    // serviço, e o no-logout fecha a saída — as duas leituras do mesmo tile.
    const above = { x: 94, y: 93, z: 6 };
    expect(zoneAt(map, above)).toBe('protection');
    expect(isBlocked(map, above.x, above.y, above.z)).toBe(false);

    const session = newSession();
    const climber = hero('a', localToAbsolute(map, above));
    session.enter(climber);
    expect(climber.position).toEqual(above);
    expect(rulesetOf(session).acceptsCityServices(session, 'a')).toBe(true);
    expect(canLogout(climber, map, session.nowMs)).toEqual({ ok: false, reason: 'no-logout-tile' });
  });

  it('a âncora em parede, fora do recorte ou no 0,0,0 cai no templo', () => {
    const { map } = worldOf();
    // O primeiro tile de parede do z7, a partir do templo para o norte: o tile onde "saiu" um
    // personagem cujo mapa mudou, ou um dado corrompido.
    let wallY = 88;
    while (!isBlocked(map, 94, wallY, 7)) wallY -= 1;
    const wall = localToAbsolute(map, { x: 94, y: wallY, z: 7 });
    expect(wall).toBeDefined();
    for (const anchor of [wall, { x: 1, y: 1, z: 7 }, { x: 0, y: 0, z: 0 }]) {
      const session = newSession();
      const arrival = hero('a', anchor);
      session.enter(arrival);
      expect(arrival.position).toEqual({ x: 94, y: 88, z: 7 });
    }
  });
});
