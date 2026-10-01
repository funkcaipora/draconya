// O Hazard numa hunt (M44-14, #632, ADR 0052 d.5/d.7): o nível escolhido na Cidade, FIXO na entrada,
// e os estágios do `combat-v4` — o crítico e o reforço do monstro, a esquiva do monstro, a XP, as
// rolagens extras de loot, a subida de nível e o Plunder Patriarch. A matemática de cada fórmula está
// em `combat/hazard.test.ts`; aqui prova-se o ENCAIXE: onde cada estágio entra, que perfil o liga, que
// party usa o menor nível e que nada disso depende de haver alguém olhando (invariantes 2 e 3).

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Content, Hazard, Progression, RawContent } from '@draconya/content';
import { describe, expect, it, vi } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { resolveDamage } from '../combat/damage.js';
import type { DamageIntent, DamageOutcome } from '../combat/damage.js';
import type { HazardState } from '../hazard.js';
import { statsForLevel, totalXpForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import type { DomainEvent } from '../session.js';
import { Session } from '../session.js';
import { HuntRuleset, createHuntSession, huntRulesetFromSnapshot } from './hunt.js';

// O resolver é ENVOLVIDO (delega para o real), como em `charms.test.ts`: a mitigação do jogador do
// `combat-v3` tira uma parte do golpe do monstro, então o número que o Hazard reforça é o que o
// `blockHit` deixou — e é esse que o teste lê do outcome, em vez de supor 100.
vi.mock('../combat/damage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../combat/damage.js')>();
  return { ...actual, resolveDamage: vi.fn(actual.resolveDamage) };
});

const ZONE_ID = 'pit-zone';
const MAP_Z = 7;

const map = {
  id: 'pit', z: MAP_Z,
  grid: ['#######', '#.....#', '#.....#', '#.....#', '#######'],
};
/** O herói fica na rota (1,1); o que nasce em (1,2) está ao lado dele. */
const NEXT_TO_HERO = { x: 1, y: 2, z: MAP_Z };
const route = {
  id: 'pit', mapId: 'pit',
  tiles: [{ x: 1, y: 1, z: MAP_Z }, { x: 2, y: 1, z: MAP_Z }],
};

// O rato é PASSIVO e lento: não anda e não bate. Vida grande: o golpe do herói não o mata.
const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1,
  health: 1_000_000, experience: 5, attack: 0, armor: 0,
  attackIntervalMs: 2_000, speed: 1, aggroRadius: 1, attackRange: 1,
  loot: { gold: { chance: 0, min: 1, max: 1 }, items: [] },
};
// O que bate no herói: uma ability corpo a corpo de valor FIXO, a cada 2 s.
const biter = {
  ...rat, id: 'biter', name: 'Biter', aggroRadius: 3,
  abilities: [{
    id: 'bite', cadenceMs: 2_000, power: { min: 100, max: 100 }, damageType: 'physical', target: { range: 1 },
  }],
};
// Morre no primeiro golpe e paga XP e ouro certos: o vetor de XP e de loot.
const weak = {
  ...rat, id: 'weak', name: 'Weak', health: 1, experience: 1_000,
  loot: { gold: { chance: 1, min: 10, max: 10 }, items: [] },
};
// O chefe que sobe o nível de hazard (The Primal Menace do Canary): morre no primeiro golpe.
const boss = { ...weak, id: 'the-primal-menace', name: 'The Primal Menace', experience: 0 };
const patriarch = { ...rat, id: 'plunder-patriarch', name: 'Plunder Patriarch', experience: 0 };

const progression = {
  id: 'baseline', startingHealth: 1_000, startingMana: 10, startingCapacity: 1_000,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.08, promotionReduction: 0.3 },
  skillMultipliers: {},
};
const combat = (profile: string) => ({
  id: 'baseline', compatibilityProfile: profile, dodgeMultiplier: 0.5,
  armorEffectiveness: {
    physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0,
    manadrain: 0, arcane: 0,
  },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 1000, attackRange: 1, armor: 0, dodgeChance: 0 },
  weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09, attackFactor: 1 },
  distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
});
const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const party = { id: 'baseline', maxMembers: 4 };
const skills = [
  { id: 'melee', name: 'Melee', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'magic', name: 'Magic', startingLevel: 0, curve: { base: 4, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0 },
];
const weaponFamilies = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
];

/**
 * Os multiplicadores do Canary, com os sorteios DESLIGADOS por padrão: crítico e esquiva nunca
 * rolam (`criticalChance`/`dodgeMultiplier` zerados) — o que sobra é o reforço de dano
 * determinístico. Cada teste liga só o que prova.
 */
const hazardBaseline = (over: Partial<Hazard> = {}, zone: Partial<Hazard['zones'][string]> = {}): Hazard => ({
  id: 'baseline', criticalIntervalMs: 2000, criticalChance: 0, criticalMultiplier: 25,
  damageMultiplier: 200, defenseMultiplier: 0, dodgeMultiplier: 0, expBonusMultiplier: 2,
  lootBonusMultiplier: 2, podDropMultiplier: 0, plunderSpawnMultiplier: 0,
  zones: {
    [ZONE_ID]: {
      name: 'Pit Zone', minLevel: 1, maxLevel: 12, crit: true, dodge: true, damageBoost: true,
      defenseBoost: true, levelUpMonsterId: 'the-primal-menace', plunderMonsterId: 'plunder-patriarch',
      ...zone,
    },
  },
  ...over,
});

/** Um ponto de spawn: o id, e onde nasce (sem `at` é um tile qualquer perto da rota). */
type Spawn = string | { readonly id: string; readonly at: { x: number; y: number; z: number } };

interface RawOptions {
  readonly profile?: string;
  readonly hazard?: Hazard | null;
  readonly hazardZoneId?: string | null;
  readonly spawns?: readonly Spawn[];
  readonly charms?: readonly object[];
}

const raw = (options: RawOptions = {}): RawContent => {
  const spawns = options.spawns ?? [{ id: 'rat', at: NEXT_TO_HERO }];
  const base: RawContent = {
    monsters: [rat, biter, weak, boss, patriarch],
    hunts: [{
      id: 'pit', name: 'Pit', recommendedLevel: 1, mapId: 'pit', routeId: 'pit',
      ...(options.hazardZoneId === null ? {} : { hazardZoneId: options.hazardZoneId ?? ZONE_ID }),
    }],
    vocations: [], progression: [progression],
    combat: [combat(options.profile ?? 'combat-v4')], stamina: [stamina], party: [party],
    spells: [], skills, weaponFamilies, items: [], ammunition: [],
    ...(options.charms === undefined ? {} : { charms: options.charms }),
    ...(options.hazard === null ? {} : { hazard: [options.hazard ?? hazardBaseline()] }),
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map],
    routes: [{ ...route, spawnPoints: spawns.map((spawn) => ({
      routeIndex: 0, radius: 3, respawnDelayMs: 600_000,
      monsterId: typeof spawn === 'string' ? spawn : spawn.id,
      ...(typeof spawn === 'string' ? {} : { at: spawn.at }),
    })) }],
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};

interface HeroOptions {
  readonly id?: string;
  readonly level?: number;
  /** O registro de Hazard do personagem (nível escolhido e teto), não o conteúdo. */
  readonly registry?: HazardState;
}

function newHero(options: HeroOptions = {}): CharacterRuntime {
  const stats = statsForLevel(1, null, progression as Progression);
  const maxHealth = 1_000_000;
  const level = options.level ?? 10;
  return new CharacterRuntime({
    id: options.id ?? 'hero', position: { x: 0, y: 0, z: MAP_Z },
    health: maxHealth, maxHealth, mana: stats.maxMana, maxMana: stats.maxMana, level,
    xp: totalXpForLevel(level, progression as Progression),
    vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    ...(options.registry === undefined ? {} : { hazard: options.registry }),
  });
}

/** O registro de um personagem: nível escolhido e teto desbloqueado na zona do teste. */
const hazardAt = (current: number, max = 12): HazardState => ({
  maxLevel: { [ZONE_ID]: max }, currentLevel: { [ZONE_ID]: current }, version: 1,
});

interface StartOptions extends HeroOptions, RawOptions {
  readonly content?: Content;
  readonly seed?: string;
  readonly heroes?: readonly HeroOptions[];
}

function start(options: StartOptions = {}) {
  const loaded = options.content ?? buildContent(raw(options));
  const heroes = (options.heroes ?? [options]).map((hero) => newHero(hero));
  const session = createHuntSession({
    id: options.seed ?? 'hazard-session', content: loaded, huntId: 'pit', difficulty: 'cautious',
    createdAtMs: 0,
    ...(heroes.length < 2 ? {} : { partyOptions: { leaderId: heroes[0]?.id ?? 'hero', mode: 'split' as const } }),
  });
  for (const hero of heroes) session.enter(hero);
  const ruleset = session.ruleset as HuntRuleset;
  return { session, hero: heroes[0] as CharacterRuntime, heroes, ruleset, loaded };
}

/** Avança `durationMs` em passos de `stepMs`, drenando os eventos de domínio. */
function run(session: Session, durationMs: number, stepMs = 100): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) {
    session.advanceBy(stepMs);
    events.push(...session.drainEvents());
  }
  return events;
}

type Hit = Extract<DomainEvent, { kind: 'creature-hit' }>;
const hits = (events: readonly DomainEvent[]): Hit[] => events.filter(
  (e): e is Hit => e.kind === 'creature-hit',
);
/** Os golpes que o herói levou. */
const takenByHero = (events: readonly DomainEvent[]): Hit[] => hits(events)
  .filter((e) => e.creatureId === 'hero');
/** Os golpes de arma do herói. */
const swings = (events: readonly DomainEvent[]): Hit[] => hits(events)
  .filter((e) => e.attackerId === 'hero' && e.source === 'melee');

/** O que o `blockHit` deixou de cada golpe de um monstro no herói, na ordem — ANTES do Hazard. */
const monsterHitBases = (): number[] => {
  const calls = vi.mocked(resolveDamage).mock.calls;
  const results = vi.mocked(resolveDamage).mock.results;
  const bases: number[] = [];
  calls.forEach((args, i) => {
    const intent = args[0] as DamageIntent;
    if (intent.source !== 'monster-attack') return;
    bases.push((results[i]?.value as DamageOutcome).resolvedDamage);
  });
  return bases;
};

/** O `biter` ao lado do herói, sozinho: todo `monster-attack` do teste é golpe dele. */
function withBiter(options: StartOptions = {}) {
  vi.mocked(resolveDamage).mockClear();
  return start({ spawns: [{ id: 'biter', at: NEXT_TO_HERO }], ...options });
}

/** O reforço de dano do Canary sobre um golpe já resolvido: `base + ceil(base × nível × 200 / 10000)`. */
const boosted = (base: number, level: number): number => base + Math.ceil((base * level * 200) / 10_000);

describe('o reforço de dano do monstro de hazard: nível × 200 em 10000 sobre o golpe que passou', () => {
  it.each([1, 2, 5, 12])('nível %i: cada golpe chega com base + ceil(base × nível × 2 %)', (level) => {
    const { session, hero } = withBiter({ registry: hazardAt(level) });
    const taken = takenByHero(run(session, 7_000));
    const bases = monsterHitBases();
    expect(taken.length).toBeGreaterThanOrEqual(3);
    expect(taken.map((e) => e.amount)).toEqual(bases.map((base) => boosted(base, level)));
    // A barra do herói desce exatamente o que os golpes mostram.
    expect(hero.maxHealth - hero.health).toBe(taken.reduce((sum, e) => sum + e.amount, 0));
    // O reforço existe: nenhum golpe ficou no valor base.
    expect(taken.every((e, i) => e.amount > (bases[i] as number))).toBe(true);
  });

  it('a hunt SEM zona de hazard bate o valor de sempre', () => {
    const { session } = withBiter({ registry: hazardAt(12), hazardZoneId: null });
    const taken = takenByHero(run(session, 7_000));
    expect(taken.length).toBeGreaterThanOrEqual(3);
    expect(taken.map((e) => e.amount)).toEqual(monsterHitBases());
  });

  it('o personagem que nunca escolheu nada luta no minLevel (1)', () => {
    const { session } = withBiter();
    const taken = takenByHero(run(session, 5_000));
    expect(taken.map((e) => e.amount)).toEqual(monsterHitBases().map((base) => boosted(base, 1)));
  });

  it('a zona sem o reforço nem o crítico ligados não muda o golpe', () => {
    const content = buildContent(raw({
      hazard: hazardBaseline({}, { damageBoost: false, crit: false }),
      spawns: [{ id: 'biter', at: NEXT_TO_HERO }],
    }));
    vi.mocked(resolveDamage).mockClear();
    const { session } = start({ content, registry: hazardAt(12) });
    const taken = takenByHero(run(session, 5_000));
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.map((e) => e.amount)).toEqual(monsterHitBases());
  });

  it('o perfil combat-v3 não roda o estágio: a sessão fixada em conteúdo anterior não muda (invariante 7)', () => {
    const { session } = withBiter({ registry: hazardAt(12), profile: 'combat-v3' });
    const taken = takenByHero(run(session, 5_000));
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.map((e) => e.amount)).toEqual(monsterHitBases());
  });
});

describe('o crítico do monstro de hazard: por golpe, com o intervalo por jogador', () => {
  // `criticalChance` no teto: a rolagem (1..10000) sempre passa. Sobra o intervalo.
  const crit = (intervalMs: number, zone: Partial<Hazard['zones'][string]> = {}) => hazardBaseline(
    { criticalChance: 10_000, criticalIntervalMs: intervalMs }, { damageBoost: false, ...zone },
  );
  const scene = (hazard: Hazard, registry: HazardState) => {
    const content = buildContent(raw({ hazard, spawns: [{ id: 'biter', at: NEXT_TO_HERO }] }));
    vi.mocked(resolveDamage).mockClear();
    return start({ content, registry });
  };

  it('o crítico soma 50 % ao golpe, e o intervalo de 5 s separa dois críticos (o monstro bate a cada 2 s)', () => {
    const { session } = scene(crit(5_000), hazardAt(1));
    const taken = takenByHero(run(session, 13_000)).map((e) => e.amount);
    const bases = monsterHitBases();
    const isCrit = taken.map((amount, i) => amount > (bases[i] as number));
    // Crítico, dois golpes dentro da janela de 5 s, crítico de novo.
    expect(isCrit.slice(0, 7)).toEqual([true, false, false, true, false, false, true]);
    expect(taken[0]).toBe((bases[0] as number) + Math.ceil(((bases[0] as number) * 5000) / 10_000));
  });

  it('o crítico por nível: 5000 + (nível − 1) × 25 em 10000', () => {
    const { session } = scene(crit(5_000), hazardAt(12));
    const first = takenByHero(run(session, 3_000))[0];
    const base = monsterHitBases()[0] as number;
    expect(first?.amount).toBe(base + Math.ceil((base * 5275) / 10_000));
  });

  it('o crítico desligado na zona nunca dispara', () => {
    const { session } = scene(crit(5_000, { crit: false }), hazardAt(1));
    const taken = takenByHero(run(session, 7_000));
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.map((e) => e.amount)).toEqual(monsterHitBases());
  });
});

describe('o golpe do monstro de hazard é EXTENSÃO: os charms defensivos nunca rolam contra ele', () => {
  // O Dodge do catálogo, com a chance no teto (1000): nenhuma das rolagens erra.
  const charms = [{
    id: 'dodge', name: 'Dodge', canaryCharmId: 0, category: 'major', type: 'defensive',
    chance: [1000, 1000, 1000], points: [240, 360, 1200],
  }];
  const fightWithDodge = (zone: string | null) => {
    const content = buildContent(raw({
      hazardZoneId: zone, charms, spawns: [{ id: 'biter', at: NEXT_TO_HERO }],
    }));
    vi.mocked(resolveDamage).mockClear();
    const session = createHuntSession({
      id: 'charm-session', content, huntId: 'pit', difficulty: 'cautious', createdAtMs: 0,
    });
    const hero = new CharacterRuntime({
      ...newHero({ registry: hazardAt(1) }).getState(),
      charms: {
        pointsSpent: 0, echoesSpent: 0, version: 1, tiers: { dodge: 3 }, assignments: { dodge: 'biter' },
      },
    });
    session.enter(hero);
    return takenByHero(run(session, 5_000));
  };

  it('sem hazard, o charm Dodge (100 %) nega o golpe inteiro', () => {
    const taken = fightWithDodge(null);
    expect(taken.length).toBeGreaterThan(0);
    expect(new Set(taken.map((e) => e.amount))).toEqual(new Set([0]));
  });

  it('com hazard, o golpe reforçado é extensão e o Dodge não rola: o dano chega', () => {
    const taken = fightWithDodge(ZONE_ID);
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.map((e) => e.amount)).toEqual(monsterHitBases().map((base) => boosted(base, 1)));
  });
});

describe('a esquiva do monstro de hazard: o golpe do jogador some', () => {
  // `dodgeMultiplier` no teto: nível 1 × 10000 cobre a rolagem inteira (1..10000).
  const dodging = (zone: Partial<Hazard['zones'][string]> = {}, over: Partial<RawOptions> = {}) =>
    buildContent(raw({
      hazard: hazardBaseline({ dodgeMultiplier: 10_000 }, zone),
      spawns: [{ id: 'rat', at: NEXT_TO_HERO }], ...over,
    }));

  const fight = (content: Content) => {
    const { session, ruleset } = start({ content, registry: hazardAt(1) });
    const events = run(session, 6_000);
    return { events, target: ruleset.monsters[0] };
  };

  it('o golpe é esquivado: zero de dano, e o rato fica com a vida toda', () => {
    const { events, target } = fight(dodging());
    const landed = swings(events);
    expect(landed.length).toBeGreaterThan(0);
    expect(landed.every((e) => e.amount === 0)).toBe(true);
    expect(target?.health).toBe(1_000_000);
  });

  it('a esquiva desligada na zona deixa o golpe passar', () => {
    const { events, target } = fight(dodging({ dodge: false }));
    expect(swings(events).some((e) => e.amount > 0)).toBe(true);
    expect(target?.health).toBeLessThan(1_000_000);
  });

  it('o mesmo conteúdo SEM hazardZoneId na hunt não esquiva', () => {
    const { events } = fight(dodging({}, { hazardZoneId: null }));
    expect(swings(events).some((e) => e.amount > 0)).toBe(true);
  });

  it('o perfil combat-v3 não esquiva', () => {
    const { events } = fight(dodging({}, { profile: 'combat-v3' }));
    expect(swings(events).some((e) => e.amount > 0)).toBe(true);
  });
});

describe('a XP e o loot do monstro de hazard', () => {
  /** O herói mata um `weak` (1 de vida, 1.000 de XP, 10 de ouro certos por rolagem). */
  const kill = (options: StartOptions = {}) => {
    const { session, hero } = start({ spawns: [{ id: 'weak', at: NEXT_TO_HERO }], ...options });
    run(session, 3_000);
    return { session, hero, xp: session.aggregates.xpGained, gold: session.aggregates.goldGained };
  };

  it.each([
    [1, 1_035], [2, 1_070], [12, 1_420],
  ])('nível %i: a XP do abate sobe 3,5 %% por nível (1.000 → %i)', (level, expected) => {
    expect(kill({ registry: hazardAt(level) }).xp).toBe(expected);
  });

  it('sem hazardZoneId, a XP é a de sempre', () => {
    expect(kill({ registry: hazardAt(12), hazardZoneId: null }).xp).toBe(1_000);
  });

  it('o perfil combat-v3 não paga o bônus', () => {
    expect(kill({ registry: hazardAt(12), profile: 'combat-v3' }).xp).toBe(1_000);
  });

  it('o loot ganha as rolagens extras: lootBonusMultiplier 50 faz o nível 2 render 2 tabelas a mais', () => {
    const content = buildContent(raw({
      hazard: hazardBaseline({ lootBonusMultiplier: 50 }), spawns: [{ id: 'weak', at: NEXT_TO_HERO }],
    }));
    // rolls = 2 × 2 × 50 / 100 = 2,0: duas rolagens extras, sem fração. 10 de ouro cada.
    expect(kill({ content, registry: hazardAt(2) }).gold).toBe(30);
    expect(kill({ content, registry: hazardAt(1) }).gold).toBe(20);
  });

  it('sem hazard o loot é UMA tabela: 10 de ouro', () => {
    expect(kill({ registry: hazardAt(12), hazardZoneId: null }).gold).toBe(10);
  });

  it('com o multiplicador do Canary (nível 12 → 0,48 rolagem) o ouro é 10 ou 20, nunca mais', () => {
    const golds = new Set<number>();
    for (let i = 0; i < 60; i += 1) {
      golds.add(kill({ registry: hazardAt(12), seed: `loot-${String(i)}` }).gold);
    }
    expect([...golds].sort()).toEqual([10, 20]);
  });
});

describe('a party usa o MENOR nível entre os membros', () => {
  it('o monstro bate com o nível do menor: 12 e 2 valem 2 nos dois', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session } = start({
      spawns: [{ id: 'biter', at: NEXT_TO_HERO }],
      heroes: [{ id: 'hero', registry: hazardAt(12) }, { id: 'ally', registry: hazardAt(2) }],
    });
    const taken = run(session, 5_000).filter((e): e is Hit => e.kind === 'creature-hit'
      && (e.creatureId === 'hero' || e.creatureId === 'ally') && e.amount > 0);
    const bases = monsterHitBases();
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.map((e) => e.amount)).toEqual(bases.map((base) => boosted(base, 2)));
  });

  it('a XP do abate usa o nível da party: o 12 do primeiro não vale sozinho', () => {
    const { session } = start({
      spawns: [{ id: 'weak', at: NEXT_TO_HERO }],
      heroes: [{ id: 'hero', registry: hazardAt(12) }, { id: 'ally', registry: hazardAt(1) }],
    });
    run(session, 3_000);
    // O aliado está longe e não bate: a XP vai por dano (`xpByDamage`) e sai inteira ao herói.
    // Com o nível 1 da party são 1.000 + 3,5 %; com o 12 do herói seriam 1.420.
    expect(session.aggregatesOf('hero').xpGained).toBe(1_035);
  });
});

describe('a subida de nível: matar o chefe da zona no nível máximo', () => {
  const zoneOf = (loaded: Content) => loaded.hazard?.zones[ZONE_ID] as NonNullable<Content['hazard']>['zones'][string];

  const killBoss = (registry: HazardState, options: StartOptions = {}) => {
    const started = start({ spawns: [{ id: 'the-primal-menace', at: NEXT_TO_HERO }], registry, ...options });
    run(started.session, 3_000);
    return started;
  };

  it('no nível máximo: o teto sobe um, e o abate vira evento notável', () => {
    const { hero, session, loaded } = killBoss(hazardAt(3, 3));
    expect(hero.hazard.maxLevelOf(ZONE_ID, zoneOf(loaded))).toBe(4);
    expect(session.notableEvents.some((e) => e.type === 'hazard-level-up' && e.detail === `${ZONE_ID}/4`))
      .toBe(true);
  });

  it('abaixo do teto: nada sobe (o nível escolhido não é o teto)', () => {
    const { hero, session, loaded } = killBoss(hazardAt(2, 3));
    expect(hero.hazard.maxLevelOf(ZONE_ID, zoneOf(loaded))).toBe(3);
    expect(session.notableEvents.some((e) => e.type === 'hazard-level-up')).toBe(false);
  });

  it('no teto da zona: fica em 12', () => {
    const { hero, loaded } = killBoss(hazardAt(12, 12));
    expect(hero.hazard.maxLevelOf(ZONE_ID, zoneOf(loaded))).toBe(12);
  });

  it('em party só sobe quem feriu o chefe: o aliado que não bateu nele fica como estava', () => {
    const { heroes, loaded } = killBoss(hazardAt(3, 3), {
      heroes: [
        { id: 'hero', registry: hazardAt(3, 3) },
        // O aliado escolheu 2 (teto 2): o herói mata o chefe sozinho, então o aliado não entra no
        // mapa de dano e o nível que conta é o do herói.
        { id: 'ally', registry: hazardAt(2, 2) },
      ],
    });
    const [hero, ally] = heroes as [CharacterRuntime, CharacterRuntime];
    expect(hero.hazard.maxLevelOf(ZONE_ID, zoneOf(loaded))).toBe(4);
    expect(ally.hazard.maxLevelOf(ZONE_ID, zoneOf(loaded))).toBe(2);
  });

  it('o monstro comum não sobe nada', () => {
    const { hero, loaded } = killBoss(hazardAt(3, 3), { spawns: [{ id: 'weak', at: NEXT_TO_HERO }] });
    expect(hero.hazard.maxLevelOf(ZONE_ID, zoneOf(loaded))).toBe(3);
  });

  it('o perfil combat-v3 não sobe nada', () => {
    const { hero, loaded } = killBoss(hazardAt(3, 3), { profile: 'combat-v3' });
    expect(hero.hazard.maxLevelOf(ZONE_ID, zoneOf(loaded))).toBe(3);
  });
});

describe('o Plunder Patriarch: a morte de um monstro da zona pode fazê-lo nascer', () => {
  const killWeak = (over: Partial<Hazard>, seed = 'plunder') => {
    const content = buildContent(raw({
      hazard: hazardBaseline(over), spawns: [{ id: 'weak', at: NEXT_TO_HERO }],
    }));
    const started = start({ content, registry: hazardAt(1), seed });
    run(started.session, 3_000);
    return started.ruleset.monsters.filter((m) => m.monsterId === 'plunder-patriarch');
  };

  it('com a chance no teto (nível × 100000 cobre a rolagem), nasce um', () => {
    expect(killWeak({ plunderSpawnMultiplier: 100_000 })).toHaveLength(1);
  });

  it('o casulo consome a morte: com a chance dele no teto, o Plunder não nasce', () => {
    expect(killWeak({ plunderSpawnMultiplier: 100_000, podDropMultiplier: 10_000 })).toHaveLength(0);
  });

  it('com o multiplicador zero, nunca nasce', () => {
    expect(killWeak({ plunderSpawnMultiplier: 0 })).toHaveLength(0);
  });

  it('nasce perto de onde o monstro morreu, sem mestre (não é invocação)', () => {
    const [patriarchMonster] = killWeak({ plunderSpawnMultiplier: 100_000 });
    expect(patriarchMonster?.masterId).toBeNull();
    expect(Math.max(
      Math.abs((patriarchMonster?.position.x ?? 0) - NEXT_TO_HERO.x),
      Math.abs((patriarchMonster?.position.y ?? 0) - NEXT_TO_HERO.y),
    )).toBeLessThanOrEqual(4);
  });

  it('a hunt sem zona de hazard nunca o faz nascer', () => {
    const content = buildContent(raw({
      hazard: hazardBaseline({ plunderSpawnMultiplier: 100_000 }), hazardZoneId: null,
      spawns: [{ id: 'weak', at: NEXT_TO_HERO }],
    }));
    const started = start({ content, registry: hazardAt(1) });
    run(started.session, 3_000);
    expect(started.ruleset.monsters.filter((m) => m.monsterId === 'plunder-patriarch')).toHaveLength(0);
  });
});

describe('o Hazard não depende de haver alguém olhando, e sobrevive ao snapshot (invariantes 2, 3 e 7)', () => {
  const busy = (seed: string) => {
    const hazard = hazardBaseline({ criticalChance: 5_000, dodgeMultiplier: 3_000 });
    const content = buildContent(raw({
      hazard, spawns: [
        { id: 'biter', at: NEXT_TO_HERO }, { id: 'rat', at: { x: 2, y: 2, z: MAP_Z } },
        { id: 'weak', at: { x: 3, y: 2, z: MAP_Z } },
      ],
    }));
    return start({ content, seed, registry: hazardAt(6) });
  };
  const fingerprint = (started: ReturnType<typeof busy>) => JSON.stringify({
    rng: started.session.snapshot().rng,
    hero: [started.hero.health, started.hero.hazardCriticalAtMs, started.session.aggregates.xpGained],
    monsters: started.ruleset.monsters.map((m) => [m.monsterId, m.health]),
  });

  it('1 Hz == 10 Hz == 20 Hz: nada aqui é decisão por tick', () => {
    const at = (stepMs: number): string => {
      const started = busy('invariance');
      run(started.session, 30_000, stepMs);
      return fingerprint(started);
    };
    const reference = at(100);
    expect(at(1_000)).toBe(reference);
    expect(at(50)).toBe(reference);
  });

  it('a luta rola de verdade: o crítico acontece e o carimbo dele viaja no snapshot do personagem', () => {
    const started = busy('stamp');
    run(started.session, 30_000);
    expect(started.hero.hazardCriticalAtMs).not.toBeNull();
    const clone = new CharacterRuntime(started.hero.getState());
    expect(clone.hazardCriticalAtMs).toBe(started.hero.hazardCriticalAtMs);
    expect(clone.hazard.getState()).toEqual(hazardAt(6));
  });

  it('a retomada de um snapshot no meio da luta rende o mesmo que a sessão que nunca caiu', () => {
    const straight = busy('restore');
    const interrupted = busy('restore');
    run(straight.session, 11_000);
    run(interrupted.session, 11_000);
    const snapshot = JSON.parse(JSON.stringify(interrupted.session.snapshot())) as ReturnType<Session['snapshot']>;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, interrupted.loaded) as HuntRuleset, new Rng(snapshot.rng),
    );
    run(straight.session, 19_000);
    run(resumed, 19_000);
    expect(resumed.participants[0]?.health).toBe(straight.hero.health);
    expect(resumed.snapshot().rng).toEqual(straight.session.snapshot().rng);
    expect((resumed.ruleset as HuntRuleset).monsters.map((m) => m.health))
      .toEqual(straight.ruleset.monsters.map((m) => m.health));
  });

  it('o carimbo do crítico zera ao entrar numa sessão nova (é do relógio lógico da anterior)', () => {
    const started = busy('fresh');
    run(started.session, 30_000);
    expect(started.hero.hazardCriticalAtMs).not.toBeNull();
    const next = createHuntSession({
      id: 'next', content: started.loaded, huntId: 'pit', difficulty: 'cautious', createdAtMs: 0,
    });
    next.enter(started.hero);
    expect(started.hero.hazardCriticalAtMs).toBeNull();
  });
});
