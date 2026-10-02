// A sessão do mundo aberto (OW-13, ADR 0060 decisões 2 e 4).
//
// O mundo é o `HuntRuleset` com a topologia de mundo, e este arquivo prova as três coisas que a
// issue pede: (1) a IDENTIDADE da sessão — compartilhada, `checkpointed`, 10 Hz, que nunca termina
// por esvaziar; (2) a ENTRADA — onde se saiu, senão o templo, sem curar, com a regeneração da hunt
// em qualquer tile; (3) o PORTÃO de serviço de Cidade por tile PZ. A prova de que a instância não
// mudou é a suíte da hunt (as sequências do FUN-63, 1 Hz = 10 Hz, a retomada) e o `bench:hunts`.
//
// O mapa é uma vila pequena de DOIS andares, importada (`source.region` x 100–114, y 200–206, z
// 6–7), em que dá para dizer, olhando, onde cada um está: o templo cai em (103, 202, 7), que é o
// tile local (3, 2), no meio de uma faixa de protect zone.
//
//   z7   x  0 1 2 3 4 5 6 7 8 9 …
//   y1      # p p p p p . . . . …      p = PZ, # = parede, T = templo
//   y2      # p p T p p . . . . …
//   y3      # p p p p p # . . . …      o # em (6, 3) é a parede de teste
//   y4      # . . . . . . . . . …
//   z6      um salão todo de chão, sem zonas

import {
  buildContent, placeholderAppearances,
} from '@draconya/content';
import type { Content, Progression, RawContent, Tilemap, World } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import type { DomainEvent } from '../session.js';
import { MAX_PENDING_DOMAIN_EVENTS, progressOf } from '../session.js';
import { statsForLevel } from '../progression.js';
import { HuntRuleset, contentOptionsOf, createHuntSession } from './hunt.js';
import { instanceTopology, worldTopology } from './topology.js';
import type { KillContext } from './topology.js';
import { WORLD_HZ, WORLD_SESSION_LIMITS, WorldRuleset, createWorldRuleset, createWorldSession } from './world.js';

const region = { x: [100, 114], y: [200, 206], z: [6, 7] };
const ROOM = ['###############', '#.............#', '#.............#', '#.....#.......#',
  '#.............#', '#.............#', '###############'];
const vila = {
  id: 'vila', z: 7,
  floors: {
    '6': { grid: ['###############', '#.............#', '#.............#', '#.............#',
      '#.............#', '#.............#', '###############'] },
    '7': {
      grid: ROOM,
      // A faixa de PZ cobre as colunas 1–5 das linhas 1–3 — o templo (3, 2) está no meio dela.
      zones: ['...............', '.ppppp.........', '.ppppp.........', '.ppppp.........',
        '...............', '...............', '...............'],
    },
  },
  source: { file: 'otservbr.otbm', sha256: 'a'.repeat(64), region },
};
const TEMPLE = { x: 103, y: 202, z: 7 }; // local (3, 2, 7)
const world = {
  id: 'main', name: 'Draconya', worldType: 'no-pvp', map: 'vila',
  towns: [{ id: 'vila', name: 'Vila', temple: TEMPLE }], capacity: 200,
};

const progression = {
  id: 'baseline', startingHealth: 500_000, startingMana: 100, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  // A regeneração da hunt (#678): um pulso por segundo de cada, com valores que o teste conta.
  regen: { health: { ticksMs: 1000, amount: 3 }, mana: { ticksMs: 1000, amount: 2 } },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.56, promotionReduction: 0.3 },
  skillMultipliers: {},
};
const combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0, manadrain: 0, arcane: 0 }, minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 0, dodgeChance: 0 },
};
const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const skills = [
  { id: 'melee', name: 'Melee', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5 },
];
const weaponFamilies = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
];

const raw = (over: Partial<RawContent> = {}): RawContent => {
  const base: RawContent = {
    monsters: [], hunts: [], vocations: [], progression: [progression], combat: [combat],
    stamina: [stamina], party: [{ id: 'baseline', maxMembers: 4 }], spells: [], skills, weaponFamilies,
    items: [],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [vila], routes: [], worlds: [world], ...over,
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};
const content: Content = buildContent(raw());
const map = content.maps.get('vila') as Tilemap;
const main = content.worlds.get('main') as World;

const stats = statsForLevel(1, null, progression as Progression);

/** Um personagem de ticket: o `position` que traz é de OUTRA sessão — o mundo o recoloca. */
const member = (
  id: string,
  over: Partial<{
    health: number; mana: number; alive: boolean; worldPosition: { x: number; y: number; z: number };
  }> = {},
) => new CharacterRuntime({
  id, position: { x: 0, y: 0, z: 7 },
  health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
  mana: over.mana ?? stats.maxMana, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
  staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
  gold: 0, goldDelta: 0, alive: over.alive ?? true, cooldowns: {}, capacity: 1_000,
  ...(over.worldPosition === undefined ? {} : { worldPosition: over.worldPosition }),
});

const newWorld = (id = 'world-1', seed = 'seed') => createWorldSession({
  id, map, world: main, content, seed, createdAtMs: 0,
});

/** O ruleset do mundo de uma sessão, sem cast solto nos testes. */
const rulesetOf = (session: ReturnType<typeof newWorld>): WorldRuleset => {
  if (!(session.ruleset instanceof WorldRuleset)) throw new Error('a sessão não é um mundo');
  return session.ruleset;
};

/** Onde o personagem está, em coordenada LOCAL do mapa. */
const at = (character: CharacterRuntime) => ({ ...character.position });

describe('createWorldSession: a identidade da sessão (OW-13)', () => {
  it('é um HuntRuleset de tipo `world`: compartilhado, `checkpointed`, 10 Hz com ou sem visualizador', () => {
    const session = newWorld();
    expect(session.ruleset).toBeInstanceOf(HuntRuleset);
    expect(session.ruleset.type).toBe('world');
    expect(session.ruleset.shared).toBe(true);
    expect(session.ruleset.progress).toBe('checkpointed');
    expect(progressOf(session.ruleset)).toBe('checkpointed');
    // `attached` não decide nada: o mundo é conteúdo em que o personagem é vulnerável (ADR 0003).
    expect(session.ruleset.hz(false)).toBe(WORLD_HZ);
    expect(session.ruleset.hz(true)).toBe(WORLD_HZ);
    expect(session.currentHz()).toBe(10);
    session.attach('viewer');
    expect(session.currentHz()).toBe(10);
  });

  it('roda sobre o mapa do mundo, com a versão de conteúdo congelada e a semente dada', () => {
    const session = newWorld('world-7', 'a-seed');
    expect(session.contentVersion).toBe(content.version);
    expect(session.id).toBe('world-7');
    expect((session.ruleset as WorldRuleset).mapId).toBe('vila');
    // A mesma semente reproduz o mesmo mundo; outra semente, outro (invariante 3).
    expect(newWorld('x', 'a-seed').getRngState()).toEqual(session.getRngState());
    expect(newWorld('x', 'other-seed').getRngState()).not.toEqual(session.getRngState());
  });

  it('a hunt NÃO declara `shared`, `progress` nem o portão de serviço: a instância é a de sempre', () => {
    const hunt = createHuntSession({
      id: 'hunt', content: buildContent(raw({
        hunts: [{ id: 'sala', name: 'Sala', recommendedLevel: 1, mapId: 'sala', routeId: 'sala-loop' }],
        maps: [vila, { id: 'sala', z: 7, grid: ['####', '#..#', '#..#', '####'] }],
        routes: [{
          id: 'sala-loop', mapId: 'sala',
          tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 2, y: 2, z: 7 }, { x: 1, y: 2, z: 7 }],
          spawnPoints: [],
        }],
      })),
      huntId: 'sala', difficulty: 'bold', createdAtMs: 0,
    });
    expect(hunt.ruleset.type).toBe('hunt');
    expect(hunt.ruleset.shared).toBeUndefined();
    expect(hunt.ruleset.progress).toBeUndefined();
    expect(progressOf(hunt.ruleset)).toBe('at-end');
    expect(hunt.ruleset.acceptsCityServices).toBeUndefined();
    expect(hunt.currentHz()).toBe(1);
  });

  it('nunca termina ao esvaziar: sair, esvaziar e entrar de novo deixam o mundo de pé', () => {
    const session = newWorld();
    session.enter(member('a'));
    session.advanceBy(1_000);
    const departure = session.leave('a');
    expect(departure?.receipt.reason).toBe('manual-exit');
    // Ninguém: o mundo continua, e avança (a instância teria acabado).
    expect(session.participants).toHaveLength(0);
    expect(session.ended).toBeNull();
    session.advanceBy(5_000);
    expect(session.ended).toBeNull();
    // E recebe quem chega depois — o personagem de volta, ou outro.
    session.enter(member('b'));
    expect(session.participants.map((p) => p.id)).toEqual(['b']);
    expect(session.ended).toBeNull();
  });

  it('a morte do único presente NÃO encerra o mundo: ele sai com o extrato e o mundo segue', () => {
    const session = newWorld();
    const hero = member('a');
    session.enter(hero);
    session.advanceBy(1_000);
    session.kill(hero);
    expect(session.ended).toBeNull();
    expect(session.participants).toHaveLength(0);
    const left = session.drainEvents().filter((event) => event.kind === 'member-left');
    expect(left).toHaveLength(1);
    const [event] = left;
    expect(event).toMatchObject({ kind: 'member-left', characterId: 'a', reason: 'death' });
    // O extrato sai pela mesma porta da party: `deaths` já está nele, para o ledger.
    expect(event?.kind === 'member-left' && event.departure.receipt.aggregates.deaths).toBe(1);
    session.advanceBy(1_000);
    expect(session.ended).toBeNull();
  });

  it('a morte de um não derruba o outro: quem fica continua na sessão', () => {
    const session = newWorld();
    const [a, b] = [member('a'), member('b')];
    session.enter(a);
    session.enter(b);
    session.kill(a);
    expect(session.participants.map((p) => p.id)).toEqual(['b']);
    expect(session.ended).toBeNull();
  });

  it('concluir uma saída (`requestExit`) tira só quem saiu, com o extrato, e o mundo continua', () => {
    const session = newWorld();
    session.enter(member('a'));
    session.enter(member('b'));
    // Sem `exitDelayMs` e fora de combate: a saída conclui na hora.
    rulesetOf(session).requestExit(session, 'a');
    expect(session.participants.map((p) => p.id)).toEqual(['b']);
    expect(session.ended).toBeNull();
    const left = session.drainEvents().find((event) => event.kind === 'member-left');
    expect(left).toMatchObject({ characterId: 'a', reason: 'manual-exit' });
  });

  it('e o último a concluir uma saída também deixa o mundo de pé: a instância solo acabaria', () => {
    const session = newWorld();
    session.enter(member('a'));
    rulesetOf(session).requestExit(session, 'a');
    expect(session.participants).toHaveLength(0);
    expect(session.ended).toBeNull();
    session.advanceBy(1_000);
    expect(session.ended).toBeNull();
  });

  it('os tetos são POR SESSÃO: o mundo guarda mais eventos que a hunt, e `limits` os troca', () => {
    expect(WORLD_SESSION_LIMITS.maxPendingDomainEvents).toBeGreaterThan(MAX_PENDING_DOMAIN_EVENTS);
    const moved = (n: number): DomainEvent => ({
      kind: 'creature-moved', creatureId: `c${n}`,
      from: { x: 0, y: 0, z: 7 }, to: { x: 1, y: 0, z: 7 }, durationMs: 100,
    });
    const flood = (session: ReturnType<typeof newWorld>, count: number): number => {
      for (let n = 0; n < count; n++) session.emit(moved(n));
      return session.drainEvents().length;
    };
    // 600 eventos estourariam o teto de 512 da hunt, e o mundo os guarda todos.
    expect(flood(newWorld(), 600)).toBe(600);
    const tight = createWorldSession({
      id: 'tight', map, world: main, content, seed: 's', createdAtMs: 0,
      limits: { maxPendingDomainEvents: 8 },
    });
    expect(flood(tight, 20)).toBeLessThan(20);
  });

  it('recusa montar o mundo sobre o mapa errado, sem cidade ou com o templo fora do recorte', () => {
    const other = content.maps.get('vila') as Tilemap;
    expect(() => createWorldRuleset(content, { ...main, map: 'outro' }, other)).toThrow(/not on "vila"/);
    expect(() => createWorldRuleset(content, { ...main, towns: [] } as unknown as World, map))
      .toThrow(/has no town/);
    const lost = { ...main, towns: [{ ...main.towns[0], temple: { x: 5, y: 5, z: 7 } }] } as World;
    expect(() => createWorldRuleset(content, lost, map)).toThrow(/outside the region/);
    // Um mapa SEM `source.region` (autorado à mão) não traduz coordenada nenhuma.
    const handmade = { ...map, source: undefined } as unknown as Tilemap;
    expect(() => createWorldRuleset(content, main, handmade)).toThrow(/outside the region/);
  });

  it('o `WorldRuleset` só se monta com a topologia de mundo', () => {
    // Montar com a de instância seria um mundo que acaba na primeira morte solo.
    const route = { id: 'r', mapId: 'vila', tiles: [{ x: 3, y: 2, z: 7 }], spawnPoints: [] };
    const hunt = { id: 'w', name: 'W', recommendedLevel: 1, mapId: 'vila', routeId: 'r' };
    expect(() => new WorldRuleset({
      hunt, difficulty: 'world', map, route, ...contentOptionsOf(content),
    })).toThrow(/needs the world topology/);
    expect(() => new WorldRuleset({
      hunt, difficulty: 'world', map, route, ...contentOptionsOf(content), topology: instanceTopology,
    })).toThrow(/needs the world topology/);
    expect(() => new WorldRuleset({
      hunt, difficulty: 'world', map, route, ...contentOptionsOf(content),
      topology: worldTopology({ map, temple: TEMPLE }),
    })).not.toThrow();
  });
});

// A coordenada ABSOLUTA de um tile local da vila: a origem do recorte é (100, 200).
const abs = (x: number, y: number, z = 7) => ({ x: x + 100, y: y + 200, z });

describe('a entrada no mundo: onde se saiu, senão o templo (OW-13)', () => {
  it('o primeiro entra no templo e o segundo no livre mais próximo A PÉ: os dois se veem', () => {
    const session = newWorld();
    const [a, b] = [member('a'), member('b')];
    session.enter(a);
    session.enter(b);
    expect(at(a)).toEqual({ x: 3, y: 2, z: 7 }); // o templo (103, 202, 7)
    expect(at(b)).toEqual({ x: 3, y: 1, z: 7 }); // o vizinho livre: norte, o primeiro dos quatro
    expect(session.participants.map((p) => p.id)).toEqual(['a', 'b']);
    // Tile é exclusivo: um não pisa onde o outro está, e a recusa é a de sempre.
    expect(rulesetOf(session).requestMove(session, 'a', { x: 3, y: 1 }))
      .toEqual({ ok: false, reason: 'tile-occupied' });
    // E o que um faz aparece no fluxo da sessão, que é o MESMO para os dois: é dele que o
    // hospedeiro monta o que cada um vê (OW-18).
    session.drainEvents();
    expect(rulesetOf(session).requestMove(session, 'b', { x: 2, y: 1 })).toMatchObject({ ok: true });
    expect(session.drainEvents()).toContainEqual(expect.objectContaining({
      kind: 'creature-moved', creatureId: 'b', to: { x: 2, y: 1, z: 7 },
    }));
  });

  it('a posição salva é respeitada: o login volta ao tile onde se saiu, em coordenada absoluta', () => {
    const session = newWorld();
    const hero = member('a', { worldPosition: abs(8, 4) });
    session.enter(hero);
    expect(at(hero)).toEqual({ x: 8, y: 4, z: 7 });
  });

  it('vale em qualquer andar do recorte: o personagem salvo no z6 volta ao z6', () => {
    const session = newWorld();
    const hero = member('a', { worldPosition: abs(5, 4, 6) });
    session.enter(hero);
    expect(at(hero)).toEqual({ x: 5, y: 4, z: 6 });
  });

  it.each([
    ['nunca esteve no mundo (sem âncora)', undefined],
    ['é o 0,0,0 do Canary — "sem posição salva"', { x: 0, y: 0, z: 0 }],
    ['o tile onde saiu virou parede', abs(6, 3)],
    ['o tile onde saiu está fora do recorte (x, y)', { x: 50, y: 50, z: 7 }],
    ['o andar onde saiu o recorte não tem (acima)', abs(8, 4, 5)],
    ['o andar onde saiu o recorte não tem (abaixo)', abs(8, 4, 8)],
  ] as const)('cai no templo quando %s', (_name, worldPosition) => {
    const session = newWorld();
    const hero = member('a', worldPosition === undefined ? {} : { worldPosition });
    session.enter(hero);
    expect(at(hero)).toEqual({ x: 3, y: 2, z: 7 });
    expect(session.ended).toBeNull();
  });

  it('o tile salvo ocupado entrega o livre mais próximo DELE, e não o templo', () => {
    const session = newWorld();
    const [a, b] = [member('a', { worldPosition: abs(8, 4) }), member('b', { worldPosition: abs(8, 4) })];
    session.enter(a);
    session.enter(b);
    expect(at(a)).toEqual({ x: 8, y: 4, z: 7 });
    expect(at(b)).toEqual({ x: 8, y: 3, z: 7 });
  });

  it('quarenta personagens no templo ocupam quarenta tiles diferentes, todos a pé do templo', () => {
    const session = newWorld();
    const crowd = Array.from({ length: 40 }, (_, i) => member(`c${i}`));
    for (const hero of crowd) session.enter(hero);
    const keys = new Set(crowd.map((hero) => `${hero.position.x},${hero.position.y},${hero.position.z}`));
    expect(keys.size).toBe(40);
    expect(crowd.every((hero) => hero.position.z === 7)).toBe(true);
    // Nunca dentro de parede: a busca é a pé, não um anel que atravessa o muro.
    const blocked = map.floors.get(7)?.blocked;
    expect(crowd.every((hero) => blocked?.[hero.position.y * map.width + hero.position.x] === 0)).toBe(true);
  });

  it('o personagem que chega já tem a vida e a mana que o ticket trouxe: o mundo NÃO cura', () => {
    const session = newWorld();
    const hurt = member('a', { health: 10, mana: 7 });
    session.enter(hurt);
    // No templo, em PZ — a Cidade curaria aqui (`city.ts:126-130`); o mundo é onde se saiu.
    expect(hurt.health).toBe(10);
    expect(hurt.mana).toBe(7);
    expect(hurt.alive).toBe(true);
    // Nem na colocação: 10 de vida num tile fora da PZ também continua 10.
    const outside = member('b', { health: 10, mana: 7, worldPosition: abs(8, 4) });
    session.enter(outside);
    expect(outside.health).toBe(10);
  });

  it('entra com a regeneração da hunt, em PZ e fora dela (ADR 0060 d.14d, pergunta 5 do dono)', () => {
    const session = newWorld();
    const inPz = member('a', { health: 10, mana: 7 });
    const outside = member('b', { health: 10, mana: 7, worldPosition: abs(8, 4) });
    session.enter(inPz);
    session.enter(outside);
    // O primeiro pulso vem DEPOIS de `ticksMs` (#678), e antes dele nada mudou.
    session.advanceBy(999);
    expect(inPz.health).toBe(10);
    session.advanceBy(1);
    expect([inPz.health, inPz.mana, outside.health, outside.mana]).toEqual([13, 9, 13, 9]);
    session.advanceBy(2_000);
    expect([inPz.health, inPz.mana, outside.health, outside.mana]).toEqual([19, 13, 19, 13]);
    // Um pulso por segundo, para sempre: 63 s de mundo são 63 pulsos de 3 de vida.
    session.advanceBy(60_000);
    expect(inPz.health).toBe(10 + 3 * 63);
  });

  it('o mundo não queima stamina por tempo: ela só queima ao ganhar XP (OW-46)', () => {
    const session = newWorld();
    const hero = member('a');
    session.enter(hero);
    session.advanceBy(60_000);
    expect(hero.staminaMs).toBe(stamina.maxMs);
  });

  it('registra a entrada como `entered-world`, com o dono, e não como `entered-hunt`', () => {
    const session = newWorld();
    session.enter(member('a'));
    expect(session.notableEvents.map((event) => event.type)).toEqual(['entered-world']);
    expect(session.notableEvents[0]?.detail).toBe('a');
  });
});

describe('a âncora do mundo (CharacterRuntime.worldPosition, OW-13)', () => {
  it('é um campo opcional que vai e volta pelo estado do personagem, e some quando ausente', () => {
    const none = member('a');
    expect(none.worldPosition).toBeNull();
    expect('worldPosition' in none.getState()).toBe(false);
    const anchored = member('b', { worldPosition: abs(8, 4) });
    expect(anchored.getState().worldPosition).toEqual(abs(8, 4));
    expect(new CharacterRuntime(anchored.getState()).worldPosition).toEqual(abs(8, 4));
  });

  it('`worldPositionOf` traduz o tile de agora para a coordenada absoluta do Tibia', () => {
    const session = newWorld();
    const hero = member('a');
    session.enter(hero);
    const ruleset = rulesetOf(session);
    expect(ruleset.worldPositionOf(hero)).toEqual(TEMPLE);
    ruleset.requestMove(session, 'a', { x: 4, y: 2 });
    expect(ruleset.worldPositionOf(hero)).toEqual({ x: 104, y: 202, z: 7 });
  });

  it('o ciclo inteiro: anda, grava a âncora, sai, e outra sessão o coloca no MESMO tile', () => {
    const first = newWorld('world-1');
    const hero = member('a');
    first.enter(hero);
    // Anda para fora da PZ, a quatro tiles do templo.
    rulesetOf(first).requestMove(first, 'a', { x: 7, y: 2 });
    first.advanceBy(10_000);
    expect(at(hero)).toEqual({ x: 7, y: 2, z: 7 });
    // O dono da sessão captura a âncora ANTES de a posição deixar de ser deste mundo.
    const anchor = rulesetOf(first).worldPositionOf(hero);
    expect(anchor).toEqual({ x: 107, y: 202, z: 7 });
    if (anchor === undefined) throw new Error('sem âncora');
    hero.worldPosition = anchor;
    first.leave('a');

    // O processo caiu, e o mundo é outra sessão (outro id, o seq do ledger recomeça): o personagem
    // do ticket novo traz só a âncora.
    const second = newWorld('world-2');
    const again = new CharacterRuntime({ ...hero.getState(), position: { x: 0, y: 0, z: 7 } });
    second.enter(again);
    expect(at(again)).toEqual({ x: 7, y: 2, z: 7 });
  });
});

describe('o portão de serviço de Cidade por tile PZ (OW-13, ADR 0060 d.4)', () => {
  it('aceita em tile PZ e recusa fora dele', () => {
    const session = newWorld();
    const ruleset = rulesetOf(session);
    const inside = member('a'); // o templo é PZ
    const outside = member('b', { worldPosition: abs(8, 4) }); // fora da faixa
    session.enter(inside);
    session.enter(outside);
    expect(ruleset.acceptsCityServices(session, 'a')).toBe(true);
    expect(ruleset.acceptsCityServices(session, 'b')).toBe(false);
  });

  it('acompanha o personagem: sair da PZ andando fecha o serviço, voltar a abre', () => {
    const session = newWorld();
    const ruleset = rulesetOf(session);
    const hero = member('a');
    session.enter(hero);
    expect(ruleset.acceptsCityServices(session, 'a')).toBe(true);
    ruleset.requestMove(session, 'a', { x: 7, y: 2 }); // a PZ acaba na coluna 5
    session.advanceBy(10_000);
    expect(at(hero)).toEqual({ x: 7, y: 2, z: 7 });
    expect(ruleset.acceptsCityServices(session, 'a')).toBe(false);
    ruleset.requestMove(session, 'a', { x: 4, y: 2 });
    session.advanceBy(10_000);
    expect(at(hero)).toEqual({ x: 4, y: 2, z: 7 });
    expect(ruleset.acceptsCityServices(session, 'a')).toBe(true);
  });

  it('o andar sem a camada `zones` é tile normal: sem dado, sem serviço', () => {
    const session = newWorld();
    const upstairs = member('a', { worldPosition: abs(3, 2, 6) }); // o z6 não tem zonas
    session.enter(upstairs);
    expect(at(upstairs)).toEqual({ x: 3, y: 2, z: 6 });
    expect(rulesetOf(session).acceptsCityServices(session, 'a')).toBe(false);
  });

  it('recusa quem não está na sessão e quem está morto', () => {
    const session = newWorld();
    const hero = member('a');
    session.enter(hero);
    const ruleset = rulesetOf(session);
    expect(ruleset.acceptsCityServices(session, 'ninguem')).toBe(false);
    hero.alive = false;
    expect(ruleset.acceptsCityServices(session, 'a')).toBe(false);
  });
});

describe('andar no relógio lógico: 1 Hz = 10 Hz (OW-13, invariante 2)', () => {
  /**
   * O roteiro de dois personagens com a vida abaixo do máximo (a regeneração também corre):
   * `a` pede uma caminhada LONGA no segundo 0 — os passos seguintes são eventos da fila, não do
   * hospedeiro —, e `b` pede um passo curto a cada segundo. As intenções chegam nos mesmos
   * instantes lógicos nos dois ritmos; o que muda é só a fatia com que o hospedeiro avança.
   */
  function run(stepMs: number) {
    const session = newWorld();
    const ruleset = rulesetOf(session);
    const [a, b] = [member('a', { health: 10, mana: 7 }), member('b', { health: 20, mana: 7 })];
    session.enter(a);
    session.enter(b);
    const events: DomainEvent[] = [];
    for (let t = 0; t < 20_000; t += stepMs) {
      if (t === 0) ruleset.requestMove(session, 'a', { x: 12, y: 5 });
      if (t > 0 && t % 1_000 === 0) {
        ruleset.requestMove(session, 'b', t % 2_000 === 0 ? { x: 3, y: 1 } : { x: 2, y: 1 });
      }
      session.advanceBy(stepMs);
      events.push(...session.drainEvents());
    }
    return { events, snapshot: session.snapshot(), a, b };
  }

  it('dez fatias de 100 ms e uma de 1 s produzem os mesmos eventos, as mesmas posições e o mesmo estado', () => {
    const fast = run(100);
    const slow = run(1_000);
    // A caminhada de verdade aconteceu: o roteiro não passa por acaso sobre um personagem parado.
    expect(at(fast.a)).toEqual({ x: 12, y: 5, z: 7 });
    expect(fast.events.filter((event) => event.kind === 'creature-moved').length).toBeGreaterThan(15);
    // E a regeneração também: 10 de vida + 3 por segundo, durante 20 s.
    expect(fast.a.health).toBe(10 + 3 * 20);
    expect(slow.events).toEqual(fast.events);
    expect(slow.snapshot).toEqual(fast.snapshot);
    expect(at(slow.a)).toEqual(at(fast.a));
    expect(at(slow.b)).toEqual(at(fast.b));
  });
});

describe('worldTopology (OW-13): cada pergunta da costura, ao contrário da instância', () => {
  const topology = worldTopology({ map, temple: TEMPLE });
  const killOf = (lastHitter: CharacterRuntime | null, diedToMonster = false): KillContext => ({
    lastHitter, diedToMonster,
    credit: {
      lastHitBy: lastHitter?.id ?? null, mostDamageBy: lastHitter?.id ?? null, damageByActor: {},
    },
  });
  const crowded = () => {
    const session = newWorld();
    const [a, b] = [member('a'), member('b')];
    session.enter(a);
    session.enter(b);
    return { session, a, b };
  };

  it('é um valor congelado e as chaves são as do mundo: sem rota, sem regra de saída, sem stamina por tempo', () => {
    expect(Object.isFrozen(topology)).toBe(true);
    expect(topology.runsRouteWalker).toBe(false);
    expect(topology.runsExitRules).toBe(false);
    expect(topology.burnsStaminaByTime).toBe(false);
    expect(instanceTopology.runsRouteWalker).toBe(true);
  });

  it('lança quando o templo não cabe no recorte, ou o mapa não foi importado', () => {
    expect(() => worldTopology({ map, temple: { x: 1, y: 1, z: 7 } })).toThrow(/outside the region/);
    expect(() => worldTopology({ map: { ...map, source: undefined } as unknown as Tilemap, temple: TEMPLE }))
      .toThrow(/outside the region/);
  });

  it('o abate conta para quem o deu, e só para ele (a instância conta para todo presente)', () => {
    const { session, a } = crowded();
    topology.creditKill(session, killOf(a));
    expect([session.aggregatesOf('a').kills, session.aggregatesOf('b').kills]).toEqual([1, 0]);
    topology.creditKill(session, killOf(null));
    expect(session.aggregates.kills).toBe(1);
    instanceTopology.creditKill(session, killOf(a));
    expect([session.aggregatesOf('a').kills, session.aggregatesOf('b').kills]).toEqual([2, 1]);
  });

  it('só o dono do golpe final, vivo e com stamina, é elegível à XP', () => {
    const { session, a, b } = crowded();
    expect(topology.rewardEligible(session, killOf(a))).toEqual([a]);
    // A instância, com dois presentes, pagaria os dois.
    expect(instanceTopology.rewardEligible(session, killOf(a))).toEqual([a, b]);
    expect(topology.rewardEligible(session, killOf(null))).toEqual([]);
    // Monstro que morreu para monstro (#619) não paga ninguém, nem o "único presente".
    expect(topology.rewardEligible(session, killOf(a, true))).toEqual([]);
    a.alive = false;
    expect(topology.rewardEligible(session, killOf(a))).toEqual([]);
    a.alive = true;
    a.staminaMs = 0;
    expect(topology.rewardEligible(session, killOf(a))).toEqual([]);
  });

  it('o loot é de quem pode recebê-lo, sem sortear: o `rng` da sessão não é tocado', () => {
    const { session, a, b } = crowded();
    const before = session.getRngState();
    expect(topology.lootRecipient(session, a, [a, b], undefined)).toBe(a);
    expect(topology.lootRecipient(session, null, [a, b], undefined)).toBeNull();
    // Nem em "party split": o mundo não tem party de hunt, e um sorteio mudaria o loot de todos.
    expect(topology.lootRecipient(session, a, [a, b], { splitLoot: false })).toBe(a);
    a.staminaMs = 0;
    expect(topology.lootRecipient(session, a, [a, b], undefined)).toBeNull();
    expect(session.getRngState()).toEqual(before);
  });

  it('não tem líder, não troca de líder e não acaba ao esvaziar', () => {
    const { session } = crowded();
    expect(topology.leaderOf(session, undefined)).toBeUndefined();
    expect(topology.leaderOf(session, 'a')).toBeUndefined();
    // A instância devolveria o mais antigo — e estranhos seguiriam o primeiro a chegar.
    expect(instanceTopology.leaderOf(session, undefined)?.id).toBe('a');
    const notes = session.notableEvents.length;
    topology.onLeaderGone(session, { leaderId: 'ninguem' });
    expect(session.notableEvents).toHaveLength(notes); // sem `leader-changed`
    topology.onEmpty(session, 'manual-exit');
    expect(session.ended).toBeNull();
    instanceTopology.onEmpty(session, 'manual-exit');
    expect(session.ended).toBe('manual-exit');
  });

  it('não semeia agenda de instância com quem entra, nem com o primeiro', () => {
    expect(topology.startsInstanceSchedules(1)).toBe(false);
    expect(topology.startsInstanceSchedules(2)).toBe(false);
    expect(instanceTopology.startsInstanceSchedules(1)).toBe(true);
  });

  it('o extrato nomeia o dono SEMPRE: o número de presentes não decide o que vai para o ledger', () => {
    const session = newWorld();
    expect(topology.namesOwnerInEvents(session)).toBe(true);
    session.enter(member('a'));
    expect(topology.namesOwnerInEvents(session)).toBe(true);
    // A instância solo mantém o formato de sempre.
    expect(instanceTopology.namesOwnerInEvents(session)).toBe(false);
    session.enter(member('b'));
    expect(topology.namesOwnerInEvents(session)).toBe(true);
  });
});
