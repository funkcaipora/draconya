// A saída do Tibia no mundo aberto (OW-14, #835, ADR 0060 d.7): o `logout` que passa por
// `canLogout` e a perda de conexão, que solta o alvo, para a automação e tenta sair aos 60 s — e,
// em luta, quando a janela de luta vence.
//
// Os critérios da issue, um a um:
// - na PZ, logout imediato;
// - em luta, recusa;
// - x-log em luta sai quando a janela de luta vence;
// - reanexar antes de 60 s cancela a saída;
// - a linha do tempo do x-log é igual a 1 Hz e a 10 Hz;
// - nenhum resultado depende de `attached` (invariante 3), tudo acontece por evento (invariante 2).
//
// O mapa é a vila de DOIS andares do `world.test.ts`, com duas marcas de no-logout a mais. O templo
// (3, 2) está no meio de uma faixa de PZ; (9, 4) é no-logout sozinho; (2, 3) é PZ + no-logout.
//
//   z7   x  0 1 2 3 4 5 6 7 8 9 …
//   y1      # p p p p p . . . . …      p = PZ, # = parede, T = templo
//   y2      # p p T p p . . . . …
//   y3      # p P p p p # . . . …      P = PZ + no-logout; o # em (6, 3) é a parede de teste
//   y4      # . . . . . . . . l …      l = no-logout

import {
  BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, BOT_VOCABULARY_VERSION_V1, botConfigSchema,
  botConfigV2Schema, buildContent, placeholderAppearances,
} from '@draconya/content';
import type {
  BotConfigV2, Content, Progression, RawContent, Route, Tilemap, World,
} from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { IN_FIGHT_WINDOW_MS } from '../combat/in-fight.js';
import { resolveDeath } from '../death.js';
import type { InventoryState } from '../inventory.js';
import { statsForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import { Session } from '../session.js';
import type { DomainEvent } from '../session.js';
import { NO_WORLD_POSITION, XLOG_DELAY_MS } from '../world-exit.js';
import type { DepartureRequested, LogoutRefused } from '../world-exit.js';
import { contentOptionsOf } from './hunt.js';
import { worldTopology } from './topology.js';
import type { SessionTopology } from './topology.js';
import { WORLD_SESSION_LIMITS, WorldRuleset, createWorldSession } from './world.js';

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
      zones: ['...............', '.ppppp.........', '.ppppp.........', '.pPppp.........',
        '.........l.....', '...............', '...............'],
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

// Um rato com vida de sobra: sobrevive a minutos de pancada do herói, e bate no vizinho a cada 2 s.
const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1,
  health: 5_000, experience: 5, attack: 10, armor: 0,
  attackIntervalMs: 2000, speed: 300, aggroRadius: 4, attackRange: 1,
  loot: { gold: { chance: 1, min: 3, max: 3 }, items: [] },
};
// Uma poção abstrata (§20.1): usar debita gold, sem pilha.
const supplies = [{
  id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion',
  effect: { kind: 'heal', amount: 80 },
}];
const otherRing = {
  id: 'other-ring', name: 'Other Ring', kind: 'ring', slot: 'finger', weight: 1, value: 0, armor: 1,
};

const raw = (over: Partial<RawContent> = {}): RawContent => {
  const base: RawContent = {
    monsters: [], hunts: [], vocations: [], progression: [progression], combat: [combat],
    stamina: [stamina], party: [{ id: 'baseline', maxMembers: 4 }], spells: [], skills, weaponFamilies,
    items: [otherRing], supplies,
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [vila], routes: [], worlds: [world], ...over,
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};
const content: Content = buildContent(raw());
const fightContent: Content = buildContent(raw({ monsters: [rat] }));
const map = content.maps.get('vila') as Tilemap;
const main = content.worlds.get('main') as World;

const stats = statsForLevel(1, null, progression as Progression);

/** Um personagem de ticket: o `position` que traz é de OUTRA sessão — o mundo o recoloca. */
const member = (
  id: string,
  over: Partial<{
    health: number; worldPosition: { x: number; y: number; z: number }; gold: number;
    inventory: InventoryState;
  }> = {},
) => new CharacterRuntime({
  id, position: { x: 0, y: 0, z: 7 },
  health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
  mana: stats.maxMana, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
  staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
  gold: over.gold ?? 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
  ...(over.worldPosition === undefined ? {} : { worldPosition: over.worldPosition }),
  ...(over.inventory === undefined ? {} : { inventory: over.inventory }),
});

// A coordenada ABSOLUTA de um tile local da vila: a origem do recorte é (100, 200).
const abs = (x: number, y: number, z = 7) => ({ x: x + 100, y: y + 200, z });
const OUTSIDE = abs(8, 2); // fora da PZ, chão normal
const NO_LOGOUT = abs(9, 4); // `l`
const PZ_NO_LOGOUT = abs(2, 3); // `P`

const newWorld = (id = 'world-1') => createWorldSession({
  id, map, world: main, content, seed: 'seed', createdAtMs: 0,
});

/**
 * O mundo COM um rato: a topologia de mundo com UMA pergunta trocada — o spawn nasce na primeira
 * entrada, que o mundo de hoje ainda não faz (a OW-31 semeia o spawn do mundo). O rato nasce em
 * (9, 2), e não volta depois de morto (o respawn é de 10^7 ms).
 */
function newFight(id = 'fight'): Session {
  const fightMap = fightContent.maps.get('vila') as Tilemap;
  const topology: SessionTopology = { ...worldTopology({ map: fightMap, temple: TEMPLE }), startsInstanceSchedules: () => true };
  const route: Route = {
    id: 'world:main', mapId: 'vila',
    tiles: [{ x: 3, y: 2, z: 7 }, { x: 9, y: 2, z: 7 }],
    spawnPoints: [{ routeIndex: 1, radius: 1, at: { x: 9, y: 2, z: 7 }, monsterId: 'rat', respawnDelayMs: 10_000_000 }],
  };
  const ruleset = new WorldRuleset({
    hunt: { id: 'world:main', name: 'Draconya', recommendedLevel: 1, mapId: 'vila', routeId: 'world:main' },
    difficulty: 'world', map: fightMap, route, ...contentOptionsOf(fightContent), topology,
  });
  return new Session({
    id, contentVersion: fightContent.version, ruleset, rng: Rng.fromSeed('seed'), createdAtMs: 0,
    ...WORLD_SESSION_LIMITS,
  });
}

const rulesetOf = (session: Session): WorldRuleset => {
  if (!(session.ruleset instanceof WorldRuleset)) throw new Error('a sessão não é um mundo');
  return session.ruleset;
};

const XLOG = 'xlog-attempt';

/** Anda a sessão `durationMs` em fatias de `stepMs`, e devolve tudo o que ela emitiu. */
function run(session: Session, durationMs: number, stepMs = 100): DomainEvent[] {
  const emitted: DomainEvent[] = [];
  for (let t = 0; t < durationMs; t += stepMs) {
    session.advanceBy(Math.min(stepMs, durationMs - t));
    emitted.push(...session.drainEvents());
  }
  return emitted;
}

const departuresOf = (events: readonly DomainEvent[]): DepartureRequested[] =>
  events.filter((event): event is DepartureRequested => event.kind === 'departure-requested');
const refusalsOf = (events: readonly DomainEvent[]): LogoutRefused[] =>
  events.filter((event): event is LogoutRefused => event.kind === 'logout-refused');

/** Anota o instante lógico exato de CADA evento da fila que o ruleset recebe. */
function traceEvents(session: Session): Array<readonly [number, string, string]> {
  const ruleset = rulesetOf(session);
  const original = ruleset.onEvent.bind(ruleset);
  const seen: Array<readonly [number, string, string]> = [];
  ruleset.onEvent = (s, event) => {
    seen.push([s.nowMs, event.kind, event.subject]);
    original(s, event);
  };
  return seen;
}

/** Os instantes em que a tentativa de x-log de `characterId` venceu. */
const attemptsOf = (trace: ReturnType<typeof traceEvents>, characterId: string): number[] =>
  trace.filter(([, kind, subject]) => kind === XLOG && subject === characterId).map(([at]) => at);

/** O personagem sem conexão, parado onde o jogador estava, num mundo que já avançou até agora. */
function arrive(session: Session, id: string, at?: { x: number; y: number; z: number }): CharacterRuntime {
  const hero = member(id, at === undefined ? {} : { worldPosition: at });
  session.enter(hero);
  return hero;
}

describe('o vocabulário da saída (OW-14)', () => {
  it('o x-log espera os 60 s do `noPongTime` do Canary, e o "sem posição" é o 0,0,0', () => {
    expect(XLOG_DELAY_MS).toBe(60_000);
    expect(IN_FIGHT_WINDOW_MS).toBe(60_000);
    expect(NO_WORLD_POSITION).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('logout: passa por canLogout (OW-14, ADR 0060 d.7)', () => {
  it.each([
    ['sem luta', null],
    ['COM luta, a PZ isenta', 0],
  ] as const)('na PZ o logout é imediato, %s', (_name, lastCombat) => {
    const session = newWorld();
    const hero = arrive(session, 'a'); // o templo é PZ
    hero.lastCombatActionAtMs = lastCombat;
    session.drainEvents();

    expect(rulesetOf(session).requestLogout(session, 'a')).toEqual({ ok: true });

    const events = session.drainEvents();
    expect(events).toEqual([{
      kind: 'departure-requested', characterId: 'a', reason: 'logout', worldPosition: TEMPLE,
    }]);
    // É um PEDIDO: tirar o personagem é do hospedeiro (checkpoint antes de `leave`).
    expect(session.participants.map((p) => p.id)).toEqual(['a']);
  });

  it('fora da PZ e sem luta passa, com a posição ABSOLUTA do tile de agora', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    session.drainEvents();
    expect(rulesetOf(session).requestLogout(session, 'a')).toEqual({ ok: true });
    expect(session.drainEvents()).toEqual([{
      kind: 'departure-requested', characterId: 'a', reason: 'logout', worldPosition: OUTSIDE,
    }]);
  });

  it('em luta fora da PZ, recusa com `in-fight` — e nada muda no personagem', () => {
    const session = newWorld();
    const hero = arrive(session, 'a', OUTSIDE);
    session.advanceBy(5_000);
    hero.lastCombatActionAtMs = 5_000;
    const before = { ...hero.position };
    session.drainEvents();

    expect(rulesetOf(session).requestLogout(session, 'a')).toEqual({ ok: false, reason: 'in-fight' });

    expect(session.drainEvents()).toEqual([{ kind: 'logout-refused', characterId: 'a', reason: 'in-fight' }]);
    expect(session.participants.map((p) => p.id)).toEqual(['a']);
    expect(hero.position).toEqual(before);
    expect(hero.alive).toBe(true);
  });

  it('a recusa por luta acaba EXATAMENTE quando a janela vence', () => {
    const session = newWorld();
    const hero = arrive(session, 'a', OUTSIDE);
    session.advanceBy(5_000);
    hero.lastCombatActionAtMs = 5_000;
    // Um instante antes dos 60 s da janela: ainda em luta.
    session.advanceBy(IN_FIGHT_WINDOW_MS - 1);
    expect(rulesetOf(session).requestLogout(session, 'a')).toEqual({ ok: false, reason: 'in-fight' });
    // E no instante em que `isInFight` deixa de valer, passa.
    session.advanceBy(1);
    session.drainEvents();
    expect(rulesetOf(session).requestLogout(session, 'a')).toEqual({ ok: true });
    expect(departuresOf(session.drainEvents())).toHaveLength(1);
  });

  it('tile de no-logout recusa com `no-logout-tile`, em luta ou não — e a PZ não o salva', () => {
    const session = newWorld();
    const inNoLogout = arrive(session, 'a', NO_LOGOUT);
    const inPzNoLogout = arrive(session, 'b', PZ_NO_LOGOUT);
    session.drainEvents();
    const ruleset = rulesetOf(session);

    expect(ruleset.requestLogout(session, 'a')).toEqual({ ok: false, reason: 'no-logout-tile' });
    // `P` (PZ + no-logout): a PZ isenta da luta, nunca do tile — o Canary testa o no-logout primeiro.
    expect(ruleset.requestLogout(session, 'b')).toEqual({ ok: false, reason: 'no-logout-tile' });
    // A recusa por tile vence a por luta.
    inNoLogout.lastCombatActionAtMs = 0;
    inPzNoLogout.lastCombatActionAtMs = 0;
    expect(ruleset.requestLogout(session, 'a')).toEqual({ ok: false, reason: 'no-logout-tile' });
    expect(refusalsOf(session.drainEvents()).map((event) => [event.characterId, event.reason])).toEqual([
      ['a', 'no-logout-tile'], ['b', 'no-logout-tile'], ['a', 'no-logout-tile'],
    ]);
  });

  it('resulta em UM evento por pedido: ou sai, ou recusa — e cada um é do personagem que pediu', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    const busy = arrive(session, 'b', abs(8, 4));
    busy.lastCombatActionAtMs = 0;
    session.drainEvents();
    const ruleset = rulesetOf(session);
    ruleset.requestLogout(session, 'a');
    ruleset.requestLogout(session, 'b');
    const events = session.drainEvents();
    expect(events.map((event) => event.kind)).toEqual(['departure-requested', 'logout-refused']);
    expect(departuresOf(events).map((event) => event.characterId)).toEqual(['a']);
    expect(refusalsOf(events).map((event) => event.characterId)).toEqual(['b']);
  });

  it('quem não está na sessão, ou já morreu, não gera evento: `null`', () => {
    const session = newWorld();
    const hero = arrive(session, 'a');
    session.drainEvents();
    const ruleset = rulesetOf(session);
    expect(ruleset.requestLogout(session, 'ninguem')).toBeNull();
    hero.alive = false;
    expect(ruleset.requestLogout(session, 'a')).toBeNull();
    expect(session.drainEvents()).toEqual([]);
  });

  it('o logout não escreve no personagem nem agenda nada: a decisão é do relógio lógico', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    const pending = session.pendingEvents;
    const rng = session.getRngState();
    rulesetOf(session).requestLogout(session, 'a');
    expect(session.pendingEvents).toBe(pending);
    expect(session.getRngState()).toEqual(rng);
  });
});

describe('perda de conexão: o x-log aos 60 s (OW-14, ADR 0060 d.7)', () => {
  it('na PZ e sem luta, pede a saída `xlog` aos 60 s EXATOS — antes disso, nada', () => {
    const session = newWorld();
    const trace = traceEvents(session);
    const hero = arrive(session, 'a');
    rulesetOf(session).presenceLost(session, 'a');
    expect(session.dueAtOf(XLOG, 'a')).toBe(XLOG_DELAY_MS);

    expect(departuresOf(run(session, XLOG_DELAY_MS - 1))).toEqual([]);
    expect(departuresOf(run(session, 1))).toEqual([{
      kind: 'departure-requested', characterId: 'a', reason: 'xlog', worldPosition: TEMPLE,
    }]);
    expect(attemptsOf(trace, 'a')).toEqual([XLOG_DELAY_MS]);
    // É um pedido: o personagem continua na sessão até o hospedeiro o soltar.
    expect(session.participants).toContain(hero);
  });

  it('fora da PZ e sem luta também, com a posição de onde ele ficou', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    rulesetOf(session).presenceLost(session, 'a');
    const events = run(session, XLOG_DELAY_MS);
    expect(departuresOf(events)).toEqual([{
      kind: 'departure-requested', characterId: 'a', reason: 'xlog', worldPosition: OUTSIDE,
    }]);
  });

  it('a contagem é do instante da queda, não do começo da sessão', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    session.advanceBy(17_300);
    rulesetOf(session).presenceLost(session, 'a');
    expect(session.dueAtOf(XLOG, 'a')).toBe(17_300 + XLOG_DELAY_MS);
    expect(departuresOf(run(session, XLOG_DELAY_MS - 1))).toEqual([]);
    expect(departuresOf(run(session, 1))).toHaveLength(1);
  });

  it('em luta sai quando a janela de luta vence: reagenda UM evento por vez, e o golpe novo o empurra', () => {
    const session = newWorld();
    const trace = traceEvents(session);
    const hero = arrive(session, 'a', OUTSIDE);
    rulesetOf(session).presenceLost(session, 'a');
    // Um golpe aos 20 s: aos 60 s o personagem ainda está em luta (40 s de janela), então a tentativa
    // não sai — reagenda para o instante em que a janela vence, 20 s + 60 s.
    run(session, 20_000);
    hero.lastCombatActionAtMs = 20_000;
    expect(departuresOf(run(session, 40_000))).toEqual([]);
    expect(session.dueAtOf(XLOG, 'a')).toBe(20_000 + IN_FIGHT_WINDOW_MS);
    // Outro golpe aos 70 s renova a janela: aos 80 s a tentativa lê o carimbo NOVO e reagenda de
    // novo, para 70 s + 60 s. A decisão é do estado de agora, não do de quando foi agendada.
    run(session, 10_000);
    hero.lastCombatActionAtMs = 70_000;
    expect(departuresOf(run(session, 10_000))).toEqual([]);
    expect(session.dueAtOf(XLOG, 'a')).toBe(70_000 + IN_FIGHT_WINDOW_MS);
    // E sai no instante exato em que a janela vence.
    expect(departuresOf(run(session, 50_000 - 1))).toEqual([]);
    expect(departuresOf(run(session, 1))).toHaveLength(1);
    expect(attemptsOf(trace, 'a')).toEqual([60_000, 80_000, 130_000]);
  });

  it('na PZ a luta não segura o x-log: a PZ isenta (`canLogout`)', () => {
    const session = newWorld();
    const hero = arrive(session, 'a'); // o templo é PZ
    rulesetOf(session).presenceLost(session, 'a');
    run(session, 50_000);
    hero.lastCombatActionAtMs = 50_000;
    expect(departuresOf(run(session, 10_000))).toHaveLength(1);
  });

  it.each([
    ['no-logout sozinho', NO_LOGOUT],
    ['PZ + no-logout', PZ_NO_LOGOUT],
  ] as const)('tile de %s: a tentativa desiste e NÃO vira varredura (o idle kick é o teto)', (_name, at) => {
    const session = newWorld();
    const trace = traceEvents(session);
    arrive(session, 'a', at);
    rulesetOf(session).presenceLost(session, 'a');
    // Nem com luta: o tile vence.
    expect(departuresOf(run(session, XLOG_DELAY_MS))).toEqual([]);
    // Uma tentativa, e nenhuma depois: o personagem não anda sem dono, então o tile não muda.
    expect(session.dueAtOf(XLOG, 'a')).toBeNull();
    expect(departuresOf(run(session, 20 * 60_000))).toEqual([]);
    expect(attemptsOf(trace, 'a')).toEqual([XLOG_DELAY_MS]);
    expect(session.participants.map((p) => p.id)).toEqual(['a']);
  });

  it('o carimbo de luta velho não segura: só `isInFight` vale, no relógio lógico', () => {
    const session = newWorld();
    const hero = arrive(session, 'a', OUTSIDE);
    hero.lastCombatActionAtMs = 0; // um golpe no instante da chegada
    rulesetOf(session).presenceLost(session, 'a');
    // A janela de 60 s do golpe vence junto com os 60 s do x-log: não há mais luta, e sai.
    expect(departuresOf(run(session, XLOG_DELAY_MS))).toHaveLength(1);
  });
});

describe('reanexar e as bordas da presença (OW-14)', () => {
  it('reanexar ANTES dos 60 s cancela a saída, e o personagem segue no mundo', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    const ruleset = rulesetOf(session);
    ruleset.presenceLost(session, 'a');
    run(session, XLOG_DELAY_MS - 1);
    ruleset.presenceRestored(session, 'a');
    expect(session.dueAtOf(XLOG, 'a')).toBeNull();
    expect(departuresOf(run(session, 30 * 60_000))).toEqual([]);
    expect(session.participants.map((p) => p.id)).toEqual(['a']);
  });

  it('cair de novo depois de reanexar recomeça a contagem dos 60 s do ZERO', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    const ruleset = rulesetOf(session);
    ruleset.presenceLost(session, 'a');
    run(session, 30_000);
    ruleset.presenceRestored(session, 'a');
    run(session, 10_000);
    ruleset.presenceLost(session, 'a'); // t = 40 s
    expect(session.dueAtOf(XLOG, 'a')).toBe(40_000 + XLOG_DELAY_MS);
    // Os 60 s da primeira queda (t = 60 s) passaram sem saída: aquela tentativa foi cancelada.
    expect(departuresOf(run(session, 60_000 - 1))).toEqual([]);
    expect(departuresOf(run(session, 1))).toHaveLength(1);
  });

  it('um segundo `presence-lost` de quem JÁ está sem conexão não empurra a saída', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    const ruleset = rulesetOf(session);
    ruleset.presenceLost(session, 'a');
    run(session, 30_000);
    ruleset.presenceLost(session, 'a'); // t = 30 s
    expect(session.dueAtOf(XLOG, 'a')).toBe(XLOG_DELAY_MS);
    expect(departuresOf(run(session, 30_000))).toHaveLength(1);
  });

  it('`presence-restored` de quem nunca caiu é ignorado', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    const pending = session.pendingEvents;
    rulesetOf(session).presenceRestored(session, 'a');
    rulesetOf(session).presenceRestored(session, 'ninguem');
    expect(session.pendingEvents).toBe(pending);
  });

  it('quem não está na sessão e quem já morreu não agendam saída nenhuma', () => {
    const session = newWorld();
    const hero = arrive(session, 'a', OUTSIDE);
    const ruleset = rulesetOf(session);
    const pending = session.pendingEvents;
    ruleset.presenceLost(session, 'ninguem');
    hero.alive = false;
    ruleset.presenceLost(session, 'a');
    expect(session.pendingEvents).toBe(pending);
    expect(session.dueAtOf(XLOG, 'a')).toBeNull();
    expect(session.dueAtOf(XLOG, 'ninguem')).toBeNull();
  });

  it('o hospedeiro soltou o personagem antes dos 60 s: a tentativa vence e não encontra ninguém', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    rulesetOf(session).presenceLost(session, 'a');
    run(session, 10_000);
    session.leave('a');
    expect(departuresOf(run(session, 2 * XLOG_DELAY_MS))).toEqual([]);
  });

  it('o MESMO id que relogou dentro dos 60 s não herda a queda: a tentativa velha morreu com a entrada', () => {
    const session = newWorld();
    arrive(session, 'a', OUTSIDE);
    const ruleset = rulesetOf(session);
    ruleset.presenceLost(session, 'a');
    run(session, 10_000);
    session.leave('a');
    // O relogin chega com visualizador: a sessão do mundo é a MESMA, e o id também.
    const again = arrive(session, 'a', OUTSIDE);
    expect(session.dueAtOf(XLOG, 'a')).toBeNull();
    expect(departuresOf(run(session, 2 * XLOG_DELAY_MS))).toEqual([]);
    expect(session.participants).toContain(again);
    // E ele pode cair de novo: a suspensão da vida anterior foi embora com o `onLeave`.
    ruleset.presenceLost(session, 'a');
    expect(session.dueAtOf(XLOG, 'a')).toBe(session.nowMs + XLOG_DELAY_MS);
    expect(departuresOf(run(session, XLOG_DELAY_MS))).toHaveLength(1);
  });

  it('dois personagens caem em instantes diferentes: cada um sai no SEU instante', () => {
    const session = newWorld();
    const trace = traceEvents(session);
    arrive(session, 'a', OUTSIDE);
    arrive(session, 'b', abs(8, 4));
    const ruleset = rulesetOf(session);
    ruleset.presenceLost(session, 'a');
    run(session, 25_000);
    ruleset.presenceLost(session, 'b');
    const events = run(session, 2 * XLOG_DELAY_MS);
    expect(departuresOf(events).map((event) => event.characterId)).toEqual(['a', 'b']);
    expect(attemptsOf(trace, 'a')).toEqual([60_000]);
    expect(attemptsOf(trace, 'b')).toEqual([85_000]);
  });

  it('com visualizador ou sem, o resultado é o mesmo: `attached` não decide nada (invariante 3)', () => {
    const outcome = (attached: boolean) => {
      const session = newWorld();
      if (attached) session.attach('viewer');
      const trace = traceEvents(session);
      arrive(session, 'a', OUTSIDE);
      rulesetOf(session).presenceLost(session, 'a');
      const events = run(session, 2 * XLOG_DELAY_MS);
      return { trace, events, hz: session.currentHz() };
    };
    expect(outcome(true)).toEqual(outcome(false));
  });
});

describe('o alvo é solto e a automação para (OW-14, ADR 0060 d.7)', () => {
  /** O herói em (8, 2) e o rato em (9, 2): colados, e o rato só bate em quem estiver à vista. */
  function duel() {
    const session = newFight();
    const hero = arrive(session, 'a', OUTSIDE);
    return { session, hero, ruleset: rulesetOf(session) };
  }
  const ratOf = (ruleset: WorldRuleset) => {
    const found = ruleset.monsters.find((monster) => monster.monsterId === 'rat');
    if (found === undefined) throw new Error('o rato não nasceu');
    return found;
  };
  const hitsOn = (events: readonly DomainEvent[], characterId: string): number =>
    events.filter((event) => event.kind === 'creature-hit' && event.creatureId === characterId).length;

  it('presente, o herói mira o rato e bate nele sem parar (o controle do teste)', () => {
    const { session, hero, ruleset } = duel();
    run(session, 10_000);
    const rat = ratOf(ruleset);
    expect(ruleset.selectedTargetOf(hero)).toBe(rat);
    const before = rat.health;
    run(session, 10_000);
    expect(rat.health).toBeLessThan(before);
  });

  it('sem conexão, o alvo é solto NA HORA e o herói para de bater — mas o rato continua batendo nele', () => {
    const { session, hero, ruleset } = duel();
    run(session, 10_000);
    const rat = ratOf(ruleset);
    expect(ruleset.selectedTargetOf(hero)).toBe(rat);

    ruleset.presenceLost(session, 'a');
    // Solto no instante, sem esperar o próximo passo.
    expect(ruleset.selectedTargetOf(hero)).toBeNull();

    const ratHealth = rat.health;
    const events = run(session, 20_000);
    // Parado, vulnerável: o monstro bate nele, e ele não revida (nem acha outro alvo).
    expect(rat.health).toBe(ratHealth);
    expect(hitsOn(events, 'a')).toBeGreaterThan(0);
    expect(ruleset.selectedTargetOf(hero)).toBeNull();
    expect(hero.lastCombatActionAtMs).not.toBeNull();
    expect(events.filter((event) => event.kind === 'creature-hit' && event.attackerId === 'a')).toEqual([]);
  });

  it('reanexar devolve o herói a quem o dirige: o alvo é reeleito e ele volta a bater', () => {
    const { session, hero, ruleset } = duel();
    run(session, 10_000);
    ruleset.presenceLost(session, 'a');
    run(session, 20_000);
    const rat = ratOf(ruleset);
    const ratHealth = rat.health;

    ruleset.presenceRestored(session, 'a');
    run(session, 10_000);
    expect(ruleset.selectedTargetOf(hero)).toBe(rat);
    expect(rat.health).toBeLessThan(ratHealth);
  });

  it('o personagem com o rato em cima continua levando golpe e sai quando a luta acaba, 60 s depois do último', () => {
    const { session, hero, ruleset } = duel();
    const trace = traceEvents(session);
    ruleset.presenceLost(session, 'a');
    // O rato nasce em (9, 2) e bate no herói parado a cada 2 s: a janela de luta é renovada a cada
    // golpe, e a tentativa dos 60 s não passa — enquanto houver rato, ninguém foge da luta
    // fechando o navegador.
    const during = run(session, 30_000);
    expect(departuresOf(during)).toEqual([]);
    expect(hitsOn(during, 'a')).toBeGreaterThan(5);
    // O rato morre aos 30 s (por um terceiro, aqui por conta do teste); o último golpe fica para trás.
    const rat = ratOf(ruleset);
    rat.receiveDamage(rat.health);
    resolveDeath(session, { kind: 'monster', monster: rat });
    const lastHit = hero.lastCombatActionAtMs;
    expect(lastHit).not.toBeNull();
    const events = run(session, 3 * XLOG_DELAY_MS);
    const [departure] = departuresOf(events);
    expect(departure).toMatchObject({ characterId: 'a', reason: 'xlog', worldPosition: OUTSIDE });
    expect(departuresOf(events)).toHaveLength(1);
    // A saída vem na ÚLTIMA tentativa, no primeiro instante em que a janela venceu.
    const attempts = attemptsOf(trace, 'a');
    expect(attempts.at(-1)).toBe((lastHit as number) + IN_FIGHT_WINDOW_MS);
    expect(attempts.length).toBeGreaterThan(1);
  });

  it('a caminhada atrás do alvo (postura `follow`) também para: o herói sem conexão não sai do tile', () => {
    const emptySet = () => ({ slots: Array.from({ length: BOT_SLOTS_PER_SET }, () => null) });
    const chase: BotConfigV2 = botConfigV2Schema.parse({
      version: BOT_VOCABULARY_VERSION, activeSet: 0,
      sets: [emptySet(), emptySet(), emptySet(), emptySet()],
      targeting: { policy: 'nearest', posture: { kind: 'follow' } },
    });
    // O herói a três tiles do rato, e a postura manda ir atrás dele.
    const stepsOfHero = (connected: boolean) => {
      const session = newFight();
      const hero = arrive(session, 'a', abs(12, 2));
      const ruleset = rulesetOf(session);
      ruleset.configureBot(session, chase, 'a');
      if (!connected) ruleset.presenceLost(session, 'a');
      const events = run(session, 20_000);
      return {
        hero, ruleset,
        steps: events.filter((event) => event.kind === 'creature-moved' && event.creatureId === 'a').length,
      };
    };
    const present = stepsOfHero(true);
    expect(present.steps).toBeGreaterThan(0);
    expect(present.hero.position).not.toEqual({ x: 12, y: 2, z: 7 });
    // Sem conexão: parado onde estava, mesmo com o rato (que persegue) logo ali.
    const absent = stepsOfHero(false);
    expect(absent.steps).toBe(0);
    expect(absent.hero.position).toEqual({ x: 12, y: 2, z: 7 });
  });

  it('o bot de poção para sem conexão e retoma ao reanexar: a automação é do jogador presente', () => {
    const session = newWorld();
    const trace = traceEvents(session);
    const hero = member('a', { health: 1_000, gold: 100_000, worldPosition: OUTSIDE });
    session.enter(hero);
    const ruleset = rulesetOf(session);
    // Poção quando o HP está em 100% ou abaixo: vale sempre, e cada uso debita o `price`.
    ruleset.configureBot(session, botConfigSchema.parse({
      version: BOT_VOCABULARY_VERSION_V1, heal: [], attack: [], rune: [], support: [],
      potion: [{
        when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'supply', supplyId: 'health-potion' },
      }],
    }), 'a');
    const used = () => session.aggregatesOf('a').suppliesUsed;
    const botEventsAfter = (atMs: number) =>
      trace.filter(([at, kind]) => at > atMs && kind.startsWith('bot:')).length;

    run(session, 5_000);
    const whilePresent = used();
    expect(whilePresent).toBeGreaterThan(0);
    expect(botEventsAfter(0)).toBeGreaterThan(0);

    ruleset.presenceLost(session, 'a');
    const lostAtMs = session.nowMs;
    run(session, 30_000);
    const atLoss = used();
    run(session, 20_000);
    expect(used()).toBe(atLoss);
    // Os grupos que já estavam agendados vencem, encontram o personagem sem dono e não fazem nada;
    // e NADA os reagenda — nem o ciclo do bot nem o dano, o passo ou a regeneração (`#armBot`).
    expect(botEventsAfter(lostAtMs + 2_000)).toBe(0);

    ruleset.presenceRestored(session, 'a');
    run(session, 5_000);
    expect(used()).toBeGreaterThan(atLoss);
  });

  it('a automação da barra (swap-ring) também para sem conexão e retoma ao reanexar', () => {
    const emptySet = () => ({ slots: Array.from({ length: BOT_SLOTS_PER_SET }, () => null) });
    const config: BotConfigV2 = botConfigV2Schema.parse({
      version: BOT_VOCABULARY_VERSION, activeSet: 0,
      sets: [emptySet(), emptySet(), emptySet(), emptySet()],
      automations: [{
        model: 'swap-ring',
        params: { itemId: 'other-ring', manaFloor: 0, restorePrevious: true },
        enter: [{ kind: 'hp', op: '<', percent: 40 }],
        exit: [{ kind: 'hp', op: '>', percent: 90 }],
      }],
    });
    const session = newWorld();
    const trace = traceEvents(session);
    const hero = member('a', {
      health: 1_000, worldPosition: OUTSIDE,
      inventory: { backpack: [{ instanceId: 'bag-0', itemId: 'other-ring', quantity: 1 }], equipped: {} },
    });
    session.enter(hero);
    const ruleset = rulesetOf(session);
    ruleset.presenceLost(session, 'a');
    // A configuração chega com o jogador ausente (o hospedeiro a reaplica, ou o ticket a semeia):
    // nada arma o ciclo das automações nem acorda o bot.
    ruleset.configureBot(session, config, 'a');
    run(session, 10_000);
    expect(hero.inventory.equippedAt('finger')).toBeNull();
    expect(trace.filter(([, kind]) => kind === 'bot-automation')).toEqual([]);
    // Reanexou: o ciclo volta a andar sozinho, no instante lógico atual, e o anel é vestido.
    ruleset.presenceRestored(session, 'a');
    run(session, 2_000);
    expect(hero.inventory.equippedAt('finger')?.itemId).toBe('other-ring');
    expect(trace.filter(([, kind]) => kind === 'bot-automation').length).toBeGreaterThan(0);
  });
});

describe('a linha do tempo do x-log é a mesma a 1 Hz e a 10 Hz (OW-14, invariantes 2 e 3)', () => {
  /**
   * O roteiro: o herói chega sem visualizador ao lado do rato, apanha por 30 s, o rato morre e a
   * saída sai 60 s depois do último golpe. As intenções (a queda e a morte do rato) chegam nos
   * MESMOS instantes lógicos nos dois ritmos — o que muda é só a fatia com que o hospedeiro avança.
   */
  function scenario(stepMs: number) {
    const session = newFight();
    const trace = traceEvents(session);
    const hero = arrive(session, 'a', OUTSIDE);
    const ruleset = rulesetOf(session);
    ruleset.presenceLost(session, 'a');
    const events: DomainEvent[] = [];
    events.push(...run(session, 30_000, stepMs));
    const rat = ruleset.monsters.find((monster) => monster.monsterId === 'rat');
    if (rat === undefined) throw new Error('o rato não nasceu');
    rat.receiveDamage(rat.health);
    resolveDeath(session, { kind: 'monster', monster: rat });
    events.push(...session.drainEvents());
    events.push(...run(session, 150_000, stepMs));
    return { trace, events, hero, snapshot: session.snapshot() };
  }

  it('o mesmo fluxo de eventos de domínio, os mesmos instantes de evento e o mesmo estado', () => {
    const fast = scenario(100);
    const slow = scenario(1_000);
    // O roteiro aconteceu de verdade: houve luta, mais de uma tentativa e UMA saída.
    expect(fast.events.filter((event) => event.kind === 'creature-hit').length).toBeGreaterThan(5);
    expect(attemptsOf(fast.trace, 'a').length).toBeGreaterThan(1);
    expect(departuresOf(fast.events)).toHaveLength(1);
    expect(slow.events).toEqual(fast.events);
    expect(slow.trace).toEqual(fast.trace);
    expect(slow.snapshot).toEqual(fast.snapshot);
    expect(slow.hero.lastCombatActionAtMs).toBe(fast.hero.lastCombatActionAtMs);
    expect(slow.hero.health).toBe(fast.hero.health);
  });

  it('o x-log sem luta, e o logout em luta, também: a linha do tempo é a mesma nos dois ritmos', () => {
    const quiet = (stepMs: number) => {
      const session = newWorld();
      const trace = traceEvents(session);
      const hero = arrive(session, 'a', OUTSIDE);
      const busy = arrive(session, 'b', abs(8, 4));
      busy.lastCombatActionAtMs = 0;
      const ruleset = rulesetOf(session);
      ruleset.presenceLost(session, 'a');
      const events: DomainEvent[] = [];
      for (let t = 0; t < 130_000; t += stepMs) {
        // O logout de `b` é pedido a cada 20 s: em luta até os 60 s, depois passa.
        if (t % 20_000 === 0) ruleset.requestLogout(session, 'b');
        session.advanceBy(stepMs);
        events.push(...session.drainEvents());
      }
      return { trace, events, hero };
    };
    const fast = quiet(100);
    const slow = quiet(1_000);
    expect(refusalsOf(fast.events)).toHaveLength(3);
    expect(departuresOf(fast.events).map((event) => [event.characterId, event.reason]).sort()).toEqual([
      ['a', 'xlog'], ['b', 'logout'], ['b', 'logout'], ['b', 'logout'], ['b', 'logout'],
    ].sort());
    expect(slow.events).toEqual(fast.events);
    expect(slow.trace).toEqual(fast.trace);
  });
});
