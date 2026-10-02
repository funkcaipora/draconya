// A costura de topologia do `HuntRuleset` (OW-12, ADR 0060 decisão 4).
//
// Dois tipos de afirmação, e o segundo é o que importa. O PRIMEIRO é que a instância é a de
// sempre: sem `topology`, ou com `instanceTopology` explícita, a sessão sai igual — o resto da
// suíte (as sequências do FUN-63, 1 Hz = 10 Hz, os blocos de party) é o portão de verdade, e este
// arquivo não o repete. O SEGUNDO é que CADA gancho é honrado: uma topologia de teste, que difere
// da instância em UMA pergunta, muda exatamente o que essa pergunta decide. É o que prova que a
// costura está ligada — um `session.participants` esquecido no `HuntRuleset` apareceria aqui como
// o gancho que a topologia de teste troca e a sessão não obedece.
//
// O conteúdo é o da sala pequena de `hunt.test.ts` (arena 4×3 e um laço de dez tiles), onde dá
// para dizer, olhando, onde cada criatura está.

import {
  BOT_VOCABULARY_VERSION_V1, botConfigSchema, botExitRuleSchema, buildContent, placeholderAppearances,
} from '@draconya/content';
import type { Content, Progression, RawContent, Tilemap } from '@draconya/content';
import { describe, expect, it, vi } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { resolveDeath } from '../death.js';
import type { HazardState } from '../hazard.js';
import { TileOccupancy, place } from '../movement.js';
import { statsForLevel, totalXpForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import { Session } from '../session.js';
import type { SessionSnapshot } from '../session.js';
import { HuntRuleset, createHuntSession, huntRulesetFromSnapshot } from './hunt.js';
import type { HuntSessionOptions } from './hunt.js';
import { ENTRY_RADIUS, instanceTopology } from './topology.js';
import type { SessionTopology } from './topology.js';

const map = {
  id: 'arena', z: 7,
  grid: ['######', '#....#', '#....#', '#....#', '######'],
};

const route = {
  id: 'arena-loop', mapId: 'arena',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 1, z: 7 }, { x: 4, y: 1, z: 7 },
    { x: 4, y: 2, z: 7 }, { x: 4, y: 3, z: 7 }, { x: 3, y: 3, z: 7 }, { x: 2, y: 3, z: 7 },
    { x: 1, y: 3, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [{ routeIndex: 4, radius: 2, monsterId: 'rat', respawnDelayMs: 10_000 }],
};
/** Três ratos no mesmo ponto: o que o `bold` dava de graça (#583). */
const threeRatsRoute = {
  ...route,
  spawnPoints: [0, 1, 2].map(() => (
    { routeIndex: 4, radius: 2, monsterId: 'rat', respawnDelayMs: 10_000 }
  )),
};
/** A mesma rota sem monstro: o personagem fica sozinho, e o que ele faz é só dele. */
const emptyRoute = { ...route, spawnPoints: [] };

const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1,
  health: 50, experience: 5, attack: 10, armor: 0,
  attackIntervalMs: 2000, speed: 300, aggroRadius: 4, attackRange: 1,
  // Gold fixo por abate: o que o teste confere é QUEM recebe, não o sorteio.
  loot: { gold: { chance: 1, min: 3, max: 3 }, items: [] },
};
/** O rato que mata quem tem 1 de vida no primeiro golpe. */
const killer = { ...rat, health: 30, attack: 50, experience: 0 };

const hunt = { id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop' };

const progression = {
  id: 'baseline', startingHealth: 500_000, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
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
    monsters: [rat], hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
    stamina: [stamina], party: [{ id: 'baseline', maxMembers: 4 }], spells: [], skills, weaponFamilies,
    items: [],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map], routes: [route], ...over,
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};
const content = (over: Partial<RawContent> = {}): Content => buildContent(raw(over));

const member = (
  id: string,
  over: Partial<{ health: number; xp: number; level: number; hazard: HazardState }> = {},
) => {
  const stats = statsForLevel(1, null, progression as Progression);
  return new CharacterRuntime({
    id, position: { x: 0, y: 0, z: 7 },
    health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
    mana: 0, maxMana: stats.maxMana, level: over.level ?? 1, xp: over.xp ?? 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    ...(over.hazard === undefined ? {} : { hazard: over.hazard }),
  });
};

const run = (session: Session, durationMs: number, stepMs = 100): void => {
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) session.advanceBy(stepMs);
};

/** A instância com UMA pergunta trocada: a unidade de prova de que o gancho está ligado. */
const topologyWith = (over: Partial<SessionTopology>): SessionTopology => ({ ...instanceTopology, ...over });

interface Setup {
  readonly loaded?: Content;
  readonly topology?: SessionTopology;
  readonly party?: HuntSessionOptions['partyOptions'];
  readonly botConfigs?: HuntSessionOptions['botConfigs'];
  readonly botConfig?: HuntSessionOptions['botConfig'];
}

/** Monta a sessão e põe os membros nela, na ordem dada. Não avança o relógio. */
function start(members: readonly CharacterRuntime[], setup: Setup = {}) {
  const session = createHuntSession({
    id: 'seam-session', content: setup.loaded ?? content({ routes: [threeRatsRoute] }),
    huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
    ...(setup.topology === undefined ? {} : { topology: setup.topology }),
    ...(setup.party === undefined ? {} : { partyOptions: setup.party }),
    ...(setup.botConfigs === undefined ? {} : { botConfigs: setup.botConfigs }),
    ...(setup.botConfig === undefined ? {} : { botConfig: setup.botConfig }),
  });
  for (const m of members) session.enter(m);
  return { session, ruleset: session.ruleset as HuntRuleset };
}

describe('a instância é a topologia default', () => {
  it('sem `topology` e com `instanceTopology` explícita a sessão sai igual — solo', () => {
    const at = (topology?: SessionTopology) => {
      const { session } = start([member('hero')], topology === undefined ? {} : { topology });
      run(session, 60_000);
      return { snapshot: JSON.stringify(session.snapshot()), events: session.drainEvents() };
    };
    const implicit = at();
    expect(implicit.events.length).toBeGreaterThan(0);
    expect(at(instanceTopology)).toEqual(implicit);
  });

  it('sem `topology` e com `instanceTopology` explícita a sessão sai igual — party de três', () => {
    const at = (topology?: SessionTopology) => {
      const { session } = start(
        [member('a'), member('b'), member('c')],
        { party: { leaderId: 'a', mode: 'split' }, ...(topology === undefined ? {} : { topology }) },
      );
      run(session, 60_000);
      return {
        snapshot: JSON.stringify(session.snapshot()), events: session.drainEvents(),
        rng: session.getRngState(),
      };
    };
    const implicit = at();
    expect(at(instanceTopology)).toEqual(implicit);
  });

  it('a topologia é um valor congelado, e a instância tem rota, regras de saída e stamina por tempo', () => {
    expect(Object.isFrozen(instanceTopology)).toBe(true);
    expect(instanceTopology).toMatchObject({
      runsRouteWalker: true, runsExitRules: true, burnsStaminaByTime: true,
    });
    // O segundo participante procura tile livre num anel de três (#203).
    expect(ENTRY_RADIUS).toBe(3);
  });

  it('a topologia NÃO entra no snapshot, e a sessão retomada pelo caminho de sempre segue como instância', () => {
    const { session } = start([member('a'), member('b')], { party: { leaderId: 'a', mode: 'split' } });
    run(session, 20_000);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    // Nenhum campo novo no formato: o snapshot de antes e o de agora são o mesmo.
    expect(JSON.stringify(snapshot)).not.toContain('topology');
    const restored = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content({ routes: [threeRatsRoute] })) as HuntRuleset,
      Rng.fromSeed('x'),
    );
    run(restored, 10_000);
    expect(restored.ended).toBeNull();
    expect(restored.participants.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('recompensa: cada pergunta é da topologia', () => {
  /** Dois heróis no mesmo laço, sem party: o caso em que "todo presente leva o abate". */
  const pair = (topology?: SessionTopology) => {
    const a = member('a');
    const b = member('b');
    const { session, ruleset } = start([a, b], topology === undefined ? {} : { topology });
    run(session, 60_000);
    return { session, ruleset, a, b };
  };

  it('creditKill decide quem leva a CONTAGEM de abates', () => {
    const instance = pair();
    const total = instance.session.aggregatesOf('a').kills;
    expect(total).toBeGreaterThan(0);
    // Na instância todo presente leva o abate inteiro.
    expect(instance.session.aggregatesOf('b').kills).toBe(total);

    // Mundo: só quem deu o golpe final. A simulação é a MESMA (a topologia só mexeu na contagem),
    // então a soma das duas é o número de abates — e ninguém leva o que não matou.
    const creditKill = vi.fn((session: Session, kill: { lastHitter: CharacterRuntime | null }) => {
      if (kill.lastHitter !== null) session.credit(kill.lastHitter.id, 'kills', 1);
    });
    const world = pair(topologyWith({ creditKill }));
    expect(creditKill).toHaveBeenCalledTimes(total);
    expect(world.session.aggregatesOf('a').kills + world.session.aggregatesOf('b').kills).toBe(total);
    expect(world.session.aggregatesOf('a').kills).toBeLessThan(total);
  });

  it('rewardEligible decide quem pode RECEBER a XP do abate', () => {
    const instance = pair();
    expect(instance.a.xp + instance.b.xp).toBeGreaterThan(0);

    // Ninguém é elegível: o abate conta, ninguém ganha XP — e o loot ainda é perguntado ao
    // `lootRecipient`, que é outra pergunta.
    const nobody = pair(topologyWith({ rewardEligible: () => [] }));
    expect(nobody.session.aggregatesOf('a').kills).toBeGreaterThan(0);
    expect(nobody.a.xp).toBe(0);
    expect(nobody.b.xp).toBe(0);

    // Só `a`: `b` bate nos mesmos ratos e não recebe nada.
    const onlyA = pair(topologyWith({
      rewardEligible: (session) => session.participants.filter((p) => p.id === 'a'),
    }));
    expect(onlyA.a.xp).toBeGreaterThan(0);
    expect(onlyA.b.xp).toBe(0);
  });

  it('rewardEligible só é perguntada quando o abate paga alguém, e recebe a atribuição do dano', () => {
    const seen: { lastHitter: string | null; diedToMonster: boolean; dealers: string[] }[] = [];
    pair(topologyWith({
      rewardEligible: (session, kill) => {
        seen.push({
          lastHitter: kill.lastHitter?.id ?? null, diedToMonster: kill.diedToMonster,
          dealers: Object.keys(kill.credit.damageByActor).sort(),
        });
        return instanceTopology.rewardEligible(session, kill);
      },
    }));
    expect(seen.length).toBeGreaterThan(0);
    for (const entry of seen) {
      // Sem facção, o golpe final é sempre de um participante, e ele está no mapa de dano.
      expect(entry.diedToMonster).toBe(false);
      expect(entry.lastHitter === 'a' || entry.lastHitter === 'b').toBe(true);
      expect(entry.dealers).toContain(entry.lastHitter);
    }
  });

  it('lootRecipient decide quem leva o loot, e recebe o dono do cadáver e a party', () => {
    const instance = pair();
    // Sem party, o matador recebe: o gold da hunt inteira está nos dois.
    expect(instance.a.goldDelta + instance.b.goldDelta).toBeGreaterThan(0);

    const calls: { killer: string | null; eligible: string[]; party: boolean }[] = [];
    const toB = pair(topologyWith({
      lootRecipient: (session, killer, eligible, party) => {
        calls.push({
          killer: killer?.id ?? null, eligible: eligible.map((p) => p.id), party: party !== undefined,
        });
        return session.participants.find((p) => p.id === 'b') ?? null;
      },
    }));
    // O loot vai para quem a topologia disse — mesmo quando não foi quem matou.
    expect(toB.a.goldDelta).toBe(0);
    expect(toB.b.goldDelta).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.killer !== null && !call.party)).toBe(true);
    expect(calls.every((call) => call.eligible.length === 2)).toBe(true);
  });

  it('lootRecipient recebe a party desta sessão — e `undefined` sem ela', () => {
    const parties: (boolean | undefined)[] = [];
    const topology = topologyWith({
      lootRecipient: (session, killer, eligible, party) => {
        parties.push(party?.splitLoot);
        return instanceTopology.lootRecipient(session, killer, eligible, party);
      },
    });
    const { session } = start(
      [member('a'), member('b')], { topology, party: { leaderId: 'a', mode: 'split' } },
    );
    run(session, 30_000);
    expect(parties.length).toBeGreaterThan(0);
    // `mode: 'split'` sorteia o destinatário entre os elegíveis: o loot NÃO vai para a bolsa.
    expect(parties.every((splitLoot) => splitLoot === false)).toBe(true);
  });
});

describe('vida da sessão: quem lidera, quando acaba, o que a saída e a morte fazem', () => {
  const party = { leaderId: 'a', mode: 'split' as const };

  it('leaderOf decide o líder que o resto do ruleset lê', () => {
    const lastIn = topologyWith({ leaderOf: (session) => session.participants.at(-1) });
    const leaderIn = (topology?: SessionTopology): string | undefined => {
      const { session } = start(
        [member('a'), member('b')], { party, ...(topology === undefined ? {} : { topology }) },
      );
      const states = session.drainEvents().filter((e) => e.kind === 'party-state');
      const last = states.at(-1);
      return last?.kind === 'party-state' ? last.leaderId : undefined;
    };
    expect(leaderIn()).toBe('a');
    expect(leaderIn(lastIn)).toBe('b');
    // Sem líder, o `party-state` cai para o que a party diz: o mundo nunca nomeia o mais antigo.
    expect(leaderIn(topologyWith({ leaderOf: () => undefined }))).toBe('a');
  });

  it('onEmpty decide o que acontece quando o último sai: a instância acaba, o mundo não', () => {
    const emptied = (topology?: SessionTopology) => {
      const { session } = start(
        [member('a'), member('b')], topology === undefined ? {} : { topology },
      );
      run(session, 5_000);
      // Os dois saem sem evento no meio: quem vê a sessão vazia é o primeiro evento seguinte.
      session.leave('a');
      session.leave('b');
      run(session, 5_000);
      return session;
    };
    expect(emptied().ended).toBe('manual-exit');

    const onEmpty = vi.fn();
    const world = emptied(topologyWith({ onEmpty }));
    expect(world.ended).toBeNull();
    expect(world.participants).toEqual([]);
    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(onEmpty.mock.calls[0]?.[1]).toBe('manual-exit');
  });

  it('onLeaderGone decide a troca de líder quando o líder sai', () => {
    const afterLeaderLeaves = (topology?: SessionTopology) => {
      const { session, ruleset } = start(
        [member('a'), member('b'), member('c')], { party, ...(topology === undefined ? {} : { topology }) },
      );
      run(session, 2_000);
      session.leave('a');
      run(session, 2_000);
      return { session, ruleset };
    };
    const instance = afterLeaderLeaves();
    expect(instance.ruleset.party?.leaderId).toBe('b');
    expect(instance.session.notableEvents.filter((e) => e.type === 'leader-changed')).toHaveLength(1);

    const onLeaderGone = vi.fn();
    const world = afterLeaderLeaves(topologyWith({ onLeaderGone }));
    // A topologia sem líder não reescreve nada e não grava `leader-changed`.
    expect(world.ruleset.party?.leaderId).toBe('a');
    expect(world.session.notableEvents.filter((e) => e.type === 'leader-changed')).toHaveLength(0);
    expect(onLeaderGone).toHaveBeenCalledTimes(1);
    expect(onLeaderGone.mock.calls[0]?.[1]).toMatchObject({ leaderId: 'a' });
  });

  it('onCharacterDied decide o que a morte faz com a SESSÃO', () => {
    const doomed = (topology?: SessionTopology) => {
      const hero = member('hero', { health: 1 });
      const { session } = start([hero], {
        loaded: content({ monsters: [killer], routes: [threeRatsRoute] }),
        ...(topology === undefined ? {} : { topology }),
      });
      run(session, 30_000);
      return { session, hero };
    };
    const instance = doomed();
    expect(instance.hero.alive).toBe(false);
    expect(instance.session.ended).toBe('death');

    // Mundo: a morte não encerra a sessão — o personagem morreu e a sessão segue de pé.
    const onCharacterDied = vi.fn();
    const world = doomed(topologyWith({ onCharacterDied }));
    expect(world.hero.alive).toBe(false);
    expect(world.session.ended).toBeNull();
    expect(onCharacterDied).toHaveBeenCalledTimes(1);
    expect(onCharacterDied.mock.calls[0]?.[1]).toBe(world.hero);
  });

  it('o `host` da topologia faz o personagem SAIR com o extrato, mesmo sozinho na sessão', () => {
    const hero = member('hero', { health: 1 });
    const { session } = start([hero], {
      loaded: content({ monsters: [killer], routes: [threeRatsRoute] }),
      topology: topologyWith({
        onCharacterDied: (s, character, host) => { host.depart(s, character.id, 'death'); },
        // Sem isto a instância encerraria a sessão vazia — e a pergunta de `onEmpty` é outra.
        onEmpty: () => undefined,
      }),
    });
    run(session, 30_000);
    // Saiu por `leave`, não por `end`: a sessão continua, vazia, e o hospedeiro recebeu o aviso.
    expect(session.ended).toBeNull();
    expect(session.participants).toEqual([]);
    const left = session.drainEvents().filter((e) => e.kind === 'member-left');
    expect(left).toHaveLength(1);
    const gone = left[0];
    if (gone?.kind !== 'member-left') throw new Error('sem member-left');
    expect(gone.reason).toBe('death');
    expect(gone.departure.receipt).toMatchObject({ characterId: 'hero', reason: 'death' });
  });

  it('onExitFinished decide o que a saída concluída faz com a sessão', () => {
    const exited = (topology?: SessionTopology) => {
      const { session, ruleset } = start([member('hero')], {
        loaded: content({ routes: [emptyRoute] }), ...(topology === undefined ? {} : { topology }),
      });
      run(session, 1_000);
      ruleset.requestExit(session, 'hero');
      run(session, 1_000);
      return { session, ruleset };
    };
    expect(exited().session.ended).toBe('manual-exit');

    const onExitFinished = vi.fn();
    const world = exited(topologyWith({ onExitFinished }));
    expect(world.session.ended).toBeNull();
    expect(onExitFinished).toHaveBeenCalledTimes(1);
    expect(onExitFinished.mock.calls[0]?.slice(1, 3)).toEqual(['hero', 'manual-exit']);
    // A saída foi consumida: não há mais pedido pendente.
    expect(world.ruleset.exitStatus(world.session, 'hero')).toBeNull();
  });
});

describe('começo: spawn, regras de saída e colocação na entrada', () => {
  it('startsInstanceSchedules decide se o spawn inicial nasce com quem entra', () => {
    const monstersAfter = (topology?: SessionTopology) => {
      const { session, ruleset } = start([member('hero')], topology === undefined ? {} : { topology });
      // O spawn inicial vence no instante zero: nenhum rato teve tempo de morrer.
      run(session, 200);
      return ruleset.monsters.length;
    };
    expect(monstersAfter()).toBe(3);
    const startsInstanceSchedules = vi.fn(() => false);
    expect(monstersAfter(topologyWith({ startsInstanceSchedules }))).toBe(0);
    expect(startsInstanceSchedules).toHaveBeenCalledWith(1);
  });

  it('startsInstanceSchedules recebe a contagem de corredores: o segundo não dobra a agenda', () => {
    const counts: number[] = [];
    const topology = topologyWith({
      startsInstanceSchedules: (runnerCount) => {
        counts.push(runnerCount);
        return instanceTopology.startsInstanceSchedules(runnerCount);
      },
    });
    const { session, ruleset } = start([member('a'), member('b')], { topology });
    run(session, 200);
    // Perguntada a cada entrada, com a contagem de quem JÁ está — só a primeira é verdadeira.
    expect(counts).toEqual([1, 2]);
    expect(ruleset.monsters.length).toBeGreaterThan(0);
    expect(ruleset.monsters.length).toBeLessThanOrEqual(3);
  });

  it('placeOnEnter decide ONDE quem entra é colocado, e recebe a rota e a contagem de corredores', () => {
    const entries: { runnerCount: number; routeStart: { x: number; y: number }; huntId: string }[] = [];
    const topology = topologyWith({
      placeOnEnter: (entry) => {
        entries.push({
          runnerCount: entry.runnerCount, routeStart: { x: entry.routeStart.x, y: entry.routeStart.y },
          huntId: entry.huntId,
        });
        instanceTopology.placeOnEnter(entry);
      },
    });
    const a = member('a');
    const b = member('b');
    start([a, b], { topology });
    expect(entries).toEqual([
      { runnerCount: 1, routeStart: { x: 1, y: 1 }, huntId: 'arena' },
      { runnerCount: 2, routeStart: { x: 1, y: 1 }, huntId: 'arena' },
    ]);
    // A instância: o primeiro no tile inicial da rota, o segundo no livre mais próximo.
    expect(a.position).toMatchObject({ x: 1, y: 1 });
    expect(b.position).not.toMatchObject({ x: 1, y: 1 });

    // Outra topologia coloca onde quiser — e a ocupação do mundo segue o personagem.
    const elsewhere = member('c');
    start([elsewhere], {
      topology: topologyWith({
        placeOnEnter: ({ world, character }) => { place(world, character, { x: 4, y: 3, z: 7 }); },
      }),
    });
    expect(elsewhere.position).toMatchObject({ x: 4, y: 3, z: 7 });
  });

  it('uma colocação recusada falha ALTO, com a hunt na mensagem (conteúdo quebrado)', () => {
    // O conteúdo valida o primeiro tile da rota no carregamento, então a recusa só se alcança
    // chamando a topologia diretamente — com um tile que é parede.
    const loaded = content();
    const world = new TileOccupancy(loaded.maps.get('arena') as Tilemap);
    const entry = (character: CharacterRuntime, runnerCount: number) => ({
      world, character, routeStart: { x: 0, y: 0, z: 7 }, runnerCount, huntId: 'arena',
    });
    expect(() => instanceTopology.placeOnEnter(entry(member('first'), 1)))
      .toThrowError(/hunt "arena".*\(0,0\).*foi recusado/u);
    // O segundo em diante procura o livre mais próximo num anel de três: acha dentro da sala.
    const second = member('second');
    instanceTopology.placeOnEnter(entry(second, 2));
    expect(second.position).toMatchObject({ x: 1, y: 1, z: 7 });
  });
});

describe('o que roda: rota, regras de saída e stamina por tempo', () => {
  it('runsRouteWalker decide se o personagem percorre a rota quando não tem o que fazer', () => {
    const positionAfter = (topology?: SessionTopology) => {
      const hero = member('hero');
      const { session } = start([hero], {
        loaded: content({ routes: [emptyRoute] }), ...(topology === undefined ? {} : { topology }),
      });
      const start0 = { ...hero.position };
      run(session, 10_000);
      return { start: start0, end: { ...hero.position } };
    };
    const instance = positionAfter();
    expect(instance.end).not.toEqual(instance.start);

    // Sem rota o personagem fica onde está — e nada além da rota deixa de valer.
    const world = positionAfter(topologyWith({ runsRouteWalker: false }));
    expect(world.end).toEqual(world.start);
  });

  it('runsRouteWalker: sem rota, o personagem ainda LUTA com o que está ao alcance', () => {
    const hero = member('hero');
    const { session } = start([hero], { topology: topologyWith({ runsRouteWalker: false }) });
    run(session, 60_000);
    // O rato vem até ele: o passo parou de andar a rota, não de combater.
    expect(session.aggregatesOf('hero').kills).toBeGreaterThan(0);
  });

  const exitOnHp = botConfigSchema.parse({
    version: BOT_VOCABULARY_VERSION_V1, heal: [], potion: [], attack: [], rune: [], support: [],
    exit: [botExitRuleSchema.parse({ kind: 'hp-below', percent: 50 })],
  });

  it('runsExitRules decide se a regra de saída do bot vale', () => {
    const lowHealth = (topology?: SessionTopology) => {
      const { session } = start([member('hero', { health: 100 })], {
        loaded: content({ routes: [emptyRoute] }), botConfig: exitOnHp,
        ...(topology === undefined ? {} : { topology }),
      });
      run(session, 5_000);
      return session.ended;
    };
    expect(lowHealth()).toBe('exit-rule');
    expect(lowHealth(topologyWith({ runsExitRules: false }))).toBeNull();
  });

  it('runsExitRules também desliga a cascata `party-member-lost`', () => {
    const exitOnLoss = botConfigSchema.parse({
      version: BOT_VOCABULARY_VERSION_V1, heal: [], potion: [], attack: [], rune: [], support: [],
      exit: [botExitRuleSchema.parse({ kind: 'party-member-lost' })],
    });
    const afterDeath = (topology?: SessionTopology) => {
      const frail = member('frail', { health: 1 });
      const { session } = start([frail, member('lead'), member('b')], {
        loaded: content({ routes: [emptyRoute] }),
        party: { leaderId: 'lead', mode: 'split' }, botConfigs: { b: exitOnLoss },
        ...(topology === undefined ? {} : { topology }),
      });
      // Mata `frail` direto: o assunto é a cascata, e não quem o rato persegue.
      frail.receiveDamage(frail.health);
      resolveDeath(session, { kind: 'character', character: frail });
      run(session, 2_000);
      return session.participants.map((p) => p.id);
    };
    // A instância: quem tem a regra sai atrás de quem saiu.
    expect(afterDeath()).toEqual(['lead']);
    // O mundo não a tem: um estranho que sai nunca tira ninguém da sessão.
    expect(afterDeath(topologyWith({ runsExitRules: false }))).toEqual(['lead', 'b']);
  });

  it('burnsStaminaByTime decide se a stamina queima com o tempo de sessão', () => {
    const staminaAfter = (topology?: SessionTopology) => {
      const hero = member('hero');
      const { session } = start([hero], {
        loaded: content({ routes: [emptyRoute] }), ...(topology === undefined ? {} : { topology }),
      });
      run(session, 60_000);
      return hero.staminaMs;
    };
    expect(staminaAfter()).toBeLessThan(stamina.maxMs);
    expect(staminaAfter(topologyWith({ burnsStaminaByTime: false }))).toBe(stamina.maxMs);
  });

  it('burnsStaminaByTime: false não congela a comida — `fedMs` drena pelo tempo em qualquer topologia', () => {
    const afterOneMinute = (topology?: SessionTopology) => {
      const hero = member('hero');
      hero.fedMs = 600_000;
      const { session } = start([hero], {
        loaded: content({ routes: [emptyRoute] }), ...(topology === undefined ? {} : { topology }),
      });
      run(session, 60_000);
      return { fedMs: hero.fedMs, staminaMs: hero.staminaMs };
    };
    const instance = afterOneMinute();
    const world = afterOneMinute(topologyWith({ burnsStaminaByTime: false }));
    // A comida: o mesmo minuto de sessão, com a chave ligada ou desligada.
    expect(instance.fedMs).toBe(540_000);
    expect(world.fedMs).toBe(540_000);
    // E a stamina continua sendo só da chave.
    expect(instance.staminaMs).toBeLessThan(stamina.maxMs);
    expect(world.staminaMs).toBe(stamina.maxMs);
  });

  it('burnsStaminaByTime: false também cala o aviso `stamina-exhausted`', () => {
    const warnings = (topology?: SessionTopology) => {
      const hero = member('hero');
      hero.staminaMs = 1_000;
      const { session } = start([hero], {
        loaded: content({ routes: [emptyRoute] }), ...(topology === undefined ? {} : { topology }),
      });
      run(session, 60_000);
      return session.notableEvents.filter((e) => e.type === 'stamina-exhausted').length;
    };
    expect(warnings()).toBe(1);
    expect(warnings(topologyWith({ burnsStaminaByTime: false }))).toBe(0);
  });
});

describe('extrato: o formato do detalhe não depende de quantos estão online', () => {
  it('namesOwnerInEvents decide se o level-up nomeia o dono', () => {
    const levelUpDetail = (members: readonly CharacterRuntime[], topology?: SessionTopology) => {
      const { session } = start(members, {
        ...(topology === undefined ? {} : { topology }),
        ...(members.length > 1 ? { party: { leaderId: 'hero', mode: 'split' as const } } : {}),
      });
      run(session, 60_000);
      return session.notableEvents.find((e) => e.type === 'level-up')?.detail;
    };
    // A um passo do level 2: o primeiro abate sobe.
    const nearLevelTwo = (id: string) =>
      member(id, { xp: totalXpForLevel(2, progression as Progression) - 1 });

    // Solo: o formato de sempre, que `event-text.ts` lê.
    expect(levelUpDetail([nearLevelTwo('hero')])).toBe('2');
    // A topologia que sempre nomeia o dono: o número de presentes não muda o formato do ledger.
    expect(levelUpDetail([nearLevelTwo('hero')], topologyWith({ namesOwnerInEvents: () => true })))
      .toBe('hero/2');
    // E a que nunca nomeia, com mais de um presente.
    const pairDetail = levelUpDetail(
      [nearLevelTwo('hero'), member('b')], topologyWith({ namesOwnerInEvents: () => false }),
    );
    expect(pairDetail).toBe('2');
    // Na instância, com dois presentes, o dono vem no detalhe.
    expect(levelUpDetail([nearLevelTwo('hero'), member('b')])).toBe('hero/2');
  });

  it('namesOwnerInEvents decide também o formato do bestiary-milestone e do bosstiary-level', () => {
    // Um marco no primeiro abate do Bestiário, e o nível 1 do Bosstiary (Nemesis) no primeiro boss.
    const bestiary = { id: 'baseline', milestones: [1], xpBonusPercentPerMilestone: 20 };
    const bosstiary = {
      id: 'baseline',
      levels: {
        bane: [{ kills: 25, points: 5 }, { kills: 100, points: 15 }, { kills: 300, points: 30 }],
        archfoe: [{ kills: 5, points: 10 }, { kills: 20, points: 30 }, { kills: 60, points: 60 }],
        nemesis: [{ kills: 1, points: 10 }, { kills: 3, points: 30 }, { kills: 5, points: 60 }],
      },
    };
    const bossRat = {
      ...rat, id: 'boss-rat', name: 'Boss Rat', boss: true, bosstiary: { rarity: 'nemesis', raceId: 9001 },
    };
    const bossRoute = {
      ...route,
      spawnPoints: [0, 1, 2].map(() => (
        { routeIndex: 4, radius: 2, monsterId: 'boss-rat', respawnDelayMs: 10_000 }
      )),
    };
    const detail = (type: string, loaded: Content, topology?: SessionTopology) => {
      const { session } = start([member('hero')], { loaded, ...(topology === undefined ? {} : { topology }) });
      run(session, 60_000);
      return session.notableEvents.find((e) => e.type === type)?.detail;
    };
    const comum = content({ bestiary: [bestiary], routes: [threeRatsRoute] });
    const chefe = content({ monsters: [bossRat], routes: [bossRoute], bosstiary: [bosstiary] });
    const names = topologyWith({ namesOwnerInEvents: () => true });

    expect(detail('bestiary-milestone', comum)).toBe('rat/1');
    expect(detail('bestiary-milestone', comum, names)).toBe('hero/rat/1');
    expect(detail('bosstiary-level', chefe)).toBe('boss-rat/1');
    expect(detail('bosstiary-level', chefe, names)).toBe('hero/boss-rat/1');
  });

  it('namesOwnerInEvents decide também o formato do hazard-level-up (#632)', () => {
    // O chefe da zona morre no primeiro golpe, e o herói está no teto: o teto sobe e vira evento.
    const zoneId = 'pit-zone';
    const boss = { ...rat, id: 'the-primal-menace', name: 'The Primal Menace', health: 1, experience: 0 };
    const hazard = {
      id: 'baseline', criticalIntervalMs: 2000, criticalChance: 0, criticalMultiplier: 25,
      damageMultiplier: 200, defenseMultiplier: 0, dodgeMultiplier: 0, expBonusMultiplier: 2,
      lootBonusMultiplier: 2, podDropMultiplier: 0, plunderSpawnMultiplier: 0,
      zones: {
        [zoneId]: {
          name: 'Pit Zone', minLevel: 1, maxLevel: 12, crit: true, dodge: true, damageBoost: true,
          defenseBoost: true, levelUpMonsterId: boss.id,
        },
      },
    };
    const combatV4 = {
      ...combat, compatibilityProfile: 'combat-v4',
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09, attackFactor: 1 },
      distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    };
    const loaded = content({
      monsters: [boss], combat: [combatV4], hazard: [hazard], hunts: [{ ...hunt, hazardZoneId: zoneId }],
      routes: [{
        ...route, spawnPoints: [{
          routeIndex: 0, radius: 3, respawnDelayMs: 600_000, monsterId: boss.id, at: { x: 1, y: 2, z: 7 },
        }],
      }],
    });
    const detail = (topology?: SessionTopology) => {
      const registry: HazardState = { maxLevel: { [zoneId]: 3 }, currentLevel: { [zoneId]: 3 }, version: 1 };
      const { session } = start([member('hero', { hazard: registry })], {
        loaded, ...(topology === undefined ? {} : { topology }),
      });
      run(session, 5_000);
      return session.notableEvents.find((e) => e.type === 'hazard-level-up')?.detail;
    };
    // Solo, o formato de sempre; a topologia que nomeia o dono põe o id na frente.
    expect(detail()).toBe(`${zoneId}/4`);
    expect(detail(topologyWith({ namesOwnerInEvents: () => true }))).toBe(`hero/${zoneId}/4`);
  });
});
