// Os Charms em combate (#603, M39-03, ADR 0053 d.5): um vetor por charm no perfil `combat-v4`, a
// ordem das rolagens, o gate por perfil e a conformance de RNG com e sem charms.
//
// A chance dos charms do catálogo real é baixa e cai ainda mais pelas rolagens de normal truncada
// (`combat/charms.test.ts` mede as probabilidades). Para um VETOR determinístico, o catálogo deste
// arquivo troca a chance de cada charm por `ALWAYS` (1000: nenhuma das quatro rolagens erra) ou
// `NEVER` (0: nenhuma acerta) — o que este arquivo testa é o EFEITO e a POSIÇÃO de cada charm, não a
// probabilidade dele.

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Charm, Content, Progression, RawContent } from '@draconya/content';
import { describe, expect, it, vi } from 'vitest';
import { CharacterRuntime } from '../character.js';
import type { CharmsState } from '../charms.js';
import type { ConditionState } from '../conditions.js';
import { resolveDamage } from '../combat/damage.js';
import type { DamageIntent, DamageOutcome } from '../combat/damage.js';
import { resolveDeath } from '../death.js';
import { statsForLevel, totalXpForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import type { DomainEvent } from '../session.js';
import { Session } from '../session.js';
import { HuntRuleset, createHuntSession, huntRulesetFromSnapshot } from './hunt.js';

// O resolver é ENVOLVIDO (delega para o real), como em `hunt.test.ts`: o que os testes leem é o
// intent que chegou a ele — `modifiers`, `extension`, `neutral` — e o outcome que saiu.
vi.mock('../combat/damage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../combat/damage.js')>();
  return { ...actual, resolveDamage: vi.fn(actual.resolveDamage) };
});

const ALWAYS = 1000;
const NEVER = 0;

// A arena: cinco tiles de largura, três de altura. A rota do herói são dois tiles lado a lado
// (y = 1); os monstros ficam em y = 2 e y = 3, adjacentes à rota — o herói não precisa andar.
const map = {
  id: 'pit', z: 7,
  grid: ['#######', '#.....#', '#.....#', '#.....#', '#######'],
};
const route = {
  id: 'pit', mapId: 'pit',
  tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
  spawnPoints: [
    { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 600_000 },
    { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 600_000 },
    { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 600_000 },
  ],
};
const hunt = { id: 'pit', name: 'Pit', recommendedLevel: 1, mapId: 'pit', routeId: 'pit' };
/** O andar da arena (`map.z`): os monstros nascem nele, e `FloorPoint.z` é opcional. */
const MAP_Z = 7;

// O rato é PASSIVO e lento (`speed: 1`, um passo a cada 150 s): não anda e não bate. Vida grande:
// o golpe do herói não o mata no meio do vetor.
const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1,
  health: 1_000, experience: 5, attack: 0, armor: 0,
  attackIntervalMs: 2_000, speed: 1, aggroRadius: 1, attackRange: 1,
  loot: { gold: { chance: 0, min: 1, max: 1 }, items: [] },
};
// O que bate no herói: uma ability corpo a corpo de valor FIXO, a cada 2 s.
const biter = {
  ...rat, id: 'biter', name: 'Biter', aggroRadius: 3, health: 1_000_000,
  abilities: [{
    id: 'bite', cadenceMs: 2_000, power: { min: 100, max: 100 }, damageType: 'physical', target: { range: 1 },
  }],
};
const bat = { ...rat, id: 'bat', name: 'Bat' };

const progression = {
  id: 'baseline', startingHealth: 1_000, startingMana: 10, startingCapacity: 1_000,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.08, promotionReduction: 0.3 },
  skillMultipliers: {},
};
const combatV4 = {
  id: 'baseline', compatibilityProfile: 'combat-v4', dodgeMultiplier: 0.5,
  armorEffectiveness: {
    physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0,
    manadrain: 0, arcane: 0,
  },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 1000, attackRange: 1, armor: 0, dodgeChance: 0 },
  weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09, attackFactor: 1 },
  distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
};
const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const party = { id: 'baseline', maxMembers: 4 };
const skills = [
  { id: 'melee', name: 'Melee', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'magic', name: 'Magic', startingLevel: 0, curve: { base: 4, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0 },
];
const weaponFamilies = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
];

// O catálogo REAL dos 25 (`content/data/charms/generated/charms.json`), com a chance trocada.
type Tuple3 = [number, number, number];
const CATALOGUE: readonly { readonly base: Omit<Charm, 'chance' | 'points' | 'name' | 'canaryCharmId'>; readonly points: Tuple3 }[] = [
  { base: { id: 'wound', category: 'major', type: 'offensive', damageType: 'physical', percent: 5 }, points: [240, 360, 1200] },
  { base: { id: 'enflame', category: 'major', type: 'offensive', damageType: 'fire', percent: 5 }, points: [400, 600, 2000] },
  { base: { id: 'poison', category: 'major', type: 'offensive', damageType: 'earth', percent: 5 }, points: [240, 360, 1200] },
  { base: { id: 'freeze', category: 'major', type: 'offensive', damageType: 'ice', percent: 5 }, points: [320, 480, 1600] },
  { base: { id: 'zap', category: 'major', type: 'offensive', damageType: 'energy', percent: 5 }, points: [320, 480, 1600] },
  { base: { id: 'curse', category: 'major', type: 'offensive', damageType: 'death', percent: 5 }, points: [360, 540, 1800] },
  { base: { id: 'divine-wrath', category: 'major', type: 'offensive', damageType: 'holy', percent: 5 }, points: [600, 900, 3000] },
  { base: { id: 'carnage', category: 'major', type: 'offensive', damageType: 'neutral', percent: 15 }, points: [600, 900, 3000] },
  { base: { id: 'overpower', category: 'major', type: 'offensive', damageType: 'neutral', percent: 5 }, points: [600, 900, 3000] },
  { base: { id: 'overflux', category: 'major', type: 'offensive', damageType: 'neutral', percent: 2.5 }, points: [600, 900, 3000] },
  { base: { id: 'cripple', category: 'minor', type: 'offensive' }, points: [100, 150, 225] },
  { base: { id: 'parry', category: 'major', type: 'defensive', damageType: 'physical' }, points: [400, 600, 2000] },
  { base: { id: 'dodge', category: 'major', type: 'defensive' }, points: [240, 360, 1200] },
  { base: { id: 'adrenaline-burst', category: 'minor', type: 'defensive' }, points: [100, 150, 225] },
  { base: { id: 'numb', category: 'minor', type: 'defensive' }, points: [100, 150, 225] },
  { base: { id: 'cleanse', category: 'minor', type: 'defensive' }, points: [100, 150, 225] },
  { base: { id: 'bless', category: 'minor', type: 'passive', percent: 10 }, points: [100, 150, 225] },
  { base: { id: 'low-blow', category: 'major', type: 'passive' }, points: [800, 1200, 4000] },
  { base: { id: 'savage-blow', category: 'major', type: 'passive' }, points: [800, 1200, 4000] },
  { base: { id: 'vampiric-embrace', category: 'minor', type: 'passive' }, points: [100, 150, 225] },
  { base: { id: 'voids-call', category: 'minor', type: 'passive' }, points: [100, 150, 225] },
  { base: { id: 'fatal-hold', category: 'minor', type: 'passive' }, points: [100, 150, 225] },
  { base: { id: 'void-inversion', category: 'minor', type: 'passive' }, points: [100, 150, 225] },
  { base: { id: 'gut', category: 'minor', type: 'passive' }, points: [100, 150, 225] },
  { base: { id: 'scavenge', category: 'minor', type: 'passive' }, points: [100, 150, 225] },
];
/** A chance REAL (por tier) dos charms cujos números o teste precisa exatos. */
const REAL_CHANCE: Readonly<Record<string, Tuple3>> = {
  bless: [6, 9, 12], 'low-blow': [4, 8, 9], 'savage-blow': [20, 40, 44],
  'vampiric-embrace': [1.6, 2.4, 3.2], 'voids-call': [0.8, 1.2, 1.6],
};
function catalogue(chances: Readonly<Record<string, number>> = {}): Charm[] {
  return CATALOGUE.map(({ base, points }) => {
    const override = chances[base.id];
    const chance: Tuple3 = override !== undefined
      ? [override, override, override]
      : REAL_CHANCE[base.id] ?? [ALWAYS, ALWAYS, ALWAYS];
    return { ...base, name: base.id, canaryCharmId: 0, chance, points };
  });
}

const raw = (over: Partial<RawContent> = {}): RawContent => {
  const base: RawContent = {
    monsters: [rat, biter, bat], hunts: [hunt], vocations: [], progression: [progression],
    combat: [combatV4], stamina: [stamina], party: [party], spells: [], skills, weaponFamilies,
    items: [], ammunition: [], charms: catalogue(),
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map], routes: [route], ...over,
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};

/** Os charms de um personagem: cada id no tier 3, atribuído ao monstro dado. */
function charmed(assign: Readonly<Record<string, string>>): CharmsState {
  return {
    pointsSpent: 0, echoesSpent: 0, version: 1,
    tiers: Object.fromEntries(Object.keys(assign).map((id) => [id, 3])) as CharmsState['tiers'],
    assignments: assign,
  };
}

interface StartOptions {
  readonly content?: Content;
  readonly assign?: Readonly<Record<string, string>>;
  readonly level?: number;
  readonly maxHealth?: number;
  readonly health?: number;
  readonly maxMana?: number;
  readonly mana?: number;
  readonly xp?: number;
  readonly conditions?: readonly ConditionState[];
  readonly seed?: string;
}

function start(options: StartOptions = {}) {
  const loaded = options.content ?? buildContent(raw());
  const session = createHuntSession({
    id: options.seed ?? 'charms-session', content: loaded, huntId: 'pit', difficulty: 'cautious',
    createdAtMs: 0,
  });
  const stats = statsForLevel(1, null, progression as Progression);
  const maxHealth = options.maxHealth ?? stats.maxHealth;
  const maxMana = options.maxMana ?? stats.maxMana;
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: options.health ?? maxHealth, maxHealth,
    // A XP acompanha o level: um abate re-deriva o level da XP (`grantXp`), e um herói de level 10
    // com XP zero voltaria ao level 1 no primeiro abate.
    mana: options.mana ?? maxMana, maxMana, level: options.level ?? 10,
    xp: options.xp ?? totalXpForLevel(options.level ?? 10, progression as Progression),
    vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    ...(options.assign === undefined ? {} : { charms: charmed(options.assign) }),
    ...(options.conditions === undefined ? {} : { conditions: options.conditions }),
  });
  session.enter(hero);
  const ruleset = session.ruleset as HuntRuleset;
  return { session, hero, ruleset, loaded };
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

/** Os hits que o herói deu (`attackerId === 'hero'`). */
const heroHits = (events: readonly DomainEvent[]) => events.filter(
  (e): e is Extract<DomainEvent, { kind: 'creature-hit' }> => e.kind === 'creature-hit' && e.attackerId === 'hero',
);
/** Os hits que o herói levou. */
const hitsOnHero = (events: readonly DomainEvent[]) => events.filter(
  (e): e is Extract<DomainEvent, { kind: 'creature-hit' }> => e.kind === 'creature-hit' && e.creatureId === 'hero',
);
/** Os hits que o herói levou de UM monstro (`m:<id>`): os ratos passivos também "batem", com zero. */
const hitsFrom = (events: readonly DomainEvent[], attacker: string) => hitsOnHero(events)
  .filter((e) => e.attackerId === attacker);
/** O dano de CHARM (evento `spell` do herói) — o golpe da arma é `melee`. */
const charmHits = (events: readonly DomainEvent[]) => heroHits(events).filter((e) => e.source === 'spell');

/** Põe os ratos ao lado da rota: o teste decide onde cada um fica. */
function place(ruleset: HuntRuleset, positions: readonly { x: number; y: number }[]) {
  positions.forEach((position, i) => {
    const monster = ruleset.monsters[i];
    if (monster === undefined) throw new Error(`falta o rato ${String(i)}`);
    monster.position = { x: position.x, y: position.y, z: MAP_Z };
  });
}

/** Deixa só o primeiro rato perto do herói; os outros vão para o fundo da arena. */
const isolate = (ruleset: HuntRuleset) => place(ruleset, [
  { x: 1, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 2 },
]);

const intents = (source: DamageIntent['source']) => vi.mocked(resolveDamage).mock.calls
  .map((args, i) => ({
    intent: args[0], outcome: vi.mocked(resolveDamage).mock.results[i]?.value as DamageOutcome,
  }))
  .filter(({ intent }) => intent.source === source);

describe('os charms ofensivos: cada um bate DEPOIS do golpe, com o tipo e o teto do Canary', () => {
  const elementals: readonly [string, string][] = [
    ['wound', 'physical'], ['enflame', 'fire'], ['poison', 'earth'], ['freeze', 'ice'],
    ['zap', 'energy'], ['curse', 'death'], ['divine-wrath', 'holy'],
  ];

  it.each(elementals)('%s causa dano %s: min(2× o level, 5 % da vida do rato) por golpe', (id, type) => {
    // Level 10, rato de 1.000: min(20, ceil(50)) = 20 — todo golpe da arma rola o charm (100 %).
    const { session, ruleset } = start({ assign: { [id]: 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    const events = run(session, 6_000);
    const swings = heroHits(events).filter((e) => e.source === 'melee');
    const hits = charmHits(events);
    expect(swings.length).toBeGreaterThan(0);
    expect(hits).toHaveLength(swings.length);
    for (const hit of hits) {
      expect(hit.damageType).toBe(type);
      expect(hit.amount).toBe(20);
    }
  });

  it('o teto pela vida do alvo: 5 % de um rato de 100 são 5, mesmo no level 100', () => {
    const small = buildContent(raw({ monsters: [{ ...rat, health: 100 }, biter, bat] }));
    const { session, ruleset } = start({ content: small, assign: { wound: 'rat' }, level: 100 });
    session.advanceBy(50);
    isolate(ruleset);
    const hits = charmHits(run(session, 4_000));
    expect(hits.length).toBeGreaterThan(0);
    // O PRIMEIRO charm: depois dele o rato de 100 já está tão ferido que o dano é o que resta.
    expect(hits[0]?.amount).toBe(5);
  });

  it('o charm respeita a resistência e a imunidade do monstro ao tipo (o golpe passa pelo resolver)', () => {
    const resistant = buildContent(raw({
      monsters: [{ ...rat, mitigation: { resistances: { fire: 0.5 }, immunities: ['ice'] } }, biter, bat],
    }));
    const fire = start({ content: resistant, assign: { enflame: 'rat' } });
    fire.session.advanceBy(50);
    isolate(fire.ruleset);
    const fireHits = charmHits(run(fire.session, 4_000));
    expect(fireHits.length).toBeGreaterThan(0);
    expect(fireHits.every((e) => e.amount === 10)).toBe(true); // 20 × (1 − 0,5)
    const ice = start({ content: resistant, assign: { freeze: 'rat' } });
    ice.session.advanceBy(50);
    isolate(ice.ruleset);
    const iceHits = charmHits(run(ice.session, 4_000));
    expect(iceHits.length).toBeGreaterThan(0);
    expect(iceHits.every((e) => e.amount === 0)).toBe(true);
  });

  it('só dispara contra o monstro ao qual foi atribuído', () => {
    const { session, ruleset } = start({ assign: { wound: 'bat' } });
    session.advanceBy(50);
    isolate(ruleset);
    const events = run(session, 4_000);
    expect(heroHits(events).filter((e) => e.source === 'melee').length).toBeGreaterThan(0);
    expect(charmHits(events)).toHaveLength(0);
  });

  it('chance zero: nunca dispara', () => {
    const never = buildContent(raw({ charms: catalogue({ wound: NEVER }) }));
    const { session, ruleset } = start({ content: never, assign: { wound: 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    expect(charmHits(run(session, 6_000))).toHaveLength(0);
  });

  it('o dano do charm é EXTENSÃO: sem crítico, sem leech, sem reflexo; só o aumento por tipo vale', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, ruleset } = start({ assign: { enflame: 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    run(session, 4_000);
    const charmCalls = intents('charm');
    expect(charmCalls.length).toBeGreaterThan(0);
    for (const { intent } of charmCalls) {
      expect(intent.extension).toBe(true);
      expect(intent.neutral).toBeUndefined();
      expect(intent.modifiers).toBeUndefined();
      expect(intent.blockable).toEqual({ armor: false, shield: false });
    }
  });

  it('Overpower: min(8 % do alvo, 5 % da vida MÁXIMA do jogador), NEUTRO — ignora a resistência', () => {
    // Jogador de 1.000 de vida máxima → 50; o rato tem resistência física de 50 %, que o golpe da
    // arma sofre e o charm neutro não.
    const resistant = buildContent(raw({
      monsters: [{ ...rat, mitigation: { resistances: { physical: 0.5 } } }, biter, bat],
    }));
    vi.mocked(resolveDamage).mockClear();
    const { session, ruleset } = start({ content: resistant, assign: { overpower: 'rat' }, maxHealth: 1_000 });
    session.advanceBy(50);
    isolate(ruleset);
    const hits = charmHits(run(session, 4_000));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => e.amount === 50)).toBe(true);
    expect(intents('charm').every(({ intent }) => intent.neutral === true)).toBe(true);
  });

  it('Overpower é cortado pelo teto de 8 % da vida do alvo quando o jogador tem muita vida', () => {
    const { session, ruleset } = start({ assign: { overpower: 'rat' }, maxHealth: 5_000 });
    session.advanceBy(50);
    isolate(ruleset);
    const hits = charmHits(run(session, 4_000));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => e.amount === 80)).toBe(true);
  });

  it('Overflux usa a MANA máxima (2,5 %)', () => {
    const { session, ruleset } = start({ assign: { overflux: 'rat' }, maxMana: 2_000 });
    session.advanceBy(50);
    isolate(ruleset);
    const hits = charmHits(run(session, 4_000));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => e.amount === 50)).toBe(true);
  });

  it('Cripple (minor) paraliza o monstro por 10 s: velocidade 40, e some no vencimento', () => {
    const { session, ruleset } = start({ assign: { cripple: 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem rato');
    // O golpe seguinte à posição de `isolate` cai em ~1 s.
    run(session, 1_200);
    const speed = target.conditions.get('speed');
    expect(speed).not.toBeNull();
    // Paralisia do Canary: a velocidade cai para 40 (o piso de `paralyze`), qualquer que seja a base.
    expect(target.speed * (1 + (speed?.speedPercent ?? 0) / 100)).toBeCloseTo(40, 5);
    expect((speed?.expiresAtMs ?? 0) - session.nowMs).toBeLessThanOrEqual(10_000);
  });

  it('Cripple paraliza até o monstro IMUNE a `paralyze`: o Canary chama `addCondition` direto, sem o portão (#603)', () => {
    // `iobestiary.cpp` aplica a condição com `target->addCondition`; a imunidade por condição só é
    // conferida em `Combat::CombatConditionFunc`, que o charm não atravessa. 685 dos 1.028 monstros
    // importados declaram `paralyze`: sem isto o charm seria inerte em dois terços do catálogo.
    // Velocidade 200: com a base abaixo de 40 a "paralisia" (piso de 40) SOBE a velocidade e o portão
    // de imunidade nem a reconheceria como paralisia — o vetor só prende com uma base rápida.
    const immuneRat = { ...rat, speed: 200, conditionImmunities: ['paralyze'] };
    const { session, ruleset } = start({
      content: buildContent(raw({ monsters: [immuneRat, biter, bat] })), assign: { cripple: 'rat' },
    });
    session.advanceBy(50);
    isolate(ruleset);
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem rato');
    run(session, 1_200);
    const speed = target.conditions.get('speed');
    expect(speed).not.toBeNull();
    expect(target.speed * (1 + (speed?.speedPercent ?? 0) / 100)).toBeCloseTo(40, 5);
    expect((speed?.expiresAtMs ?? 0) - session.nowMs).toBeLessThanOrEqual(10_000);
  });

  it('major E minor: os dois rolam, na ordem major → minor', () => {
    const { session, ruleset } = start({ assign: { wound: 'rat', cripple: 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem rato');
    const events = run(session, 2_000);
    expect(charmHits(events).length).toBeGreaterThan(0);
    expect(target.conditions.get('speed')).not.toBeNull();
  });

  it('nunca em golpe que não tirou vida: monstro imune ao tipo da arma não rola charm', () => {
    const immune = buildContent(raw({
      monsters: [{ ...rat, mitigation: { resistances: {}, immunities: ['physical'] } }, biter, bat],
    }));
    const { session, ruleset } = start({ content: immune, assign: { wound: 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    const events = run(session, 4_000);
    expect(heroHits(events).filter((e) => e.source === 'melee').every((e) => e.amount === 0)).toBe(true);
    expect(charmHits(events)).toHaveLength(0);
  });
});

describe('Carnage: na morte do monstro, dano neutro nos quatro vizinhos ORTOGONAIS', () => {
  // O herói em (1, 1); o rato que morre A em (2, 1) — à direita —; B em (3, 1), a leste de A
  // (ortogonal); C em (3, 2), diagonal de A (NÃO atinge); D em (2, 2), ao sul de A (ortogonal).
  function scene(level: number, assign: Readonly<Record<string, string>> = { carnage: 'rat' }) {
    const started = start({ assign, level });
    started.session.advanceBy(50);
    const { ruleset } = started;
    place(ruleset, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }]);
    const [a, b, c] = ruleset.monsters;
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    started.hero.position = { x: 1, y: 1, z: started.hero.position.z };
    // O rato A já quase morto: um golpe de qualquer tamanho o mata.
    a.receiveDamage(a.health - 1);
    return { ...started, a, b, c };
  }

  it('cada vizinho ortogonal leva min(15 % da vida do morto, 6× o level); o diagonal não', () => {
    // Level 10: min(ceil(1000 × 0,15) = 150, 60) = 60.
    const { session, a, b, c } = scene(10);
    const bBefore = b.health;
    const cBefore = c.health;
    run(session, 1_500);

    expect(a.alive).toBe(false);
    expect(b.health).toBe(bBefore - 60);
    expect(c.health).toBe(cBefore);
  });

  it('o teto de level sobe com o level: no 100 são 15 % inteiros', () => {
    const { session, a, b } = scene(100);
    const bBefore = b.health;
    run(session, 1_500);
    expect(a.alive).toBe(false);
    expect(b.health).toBe(bBefore - 150);
  });

  it('é dano NEUTRO — ignora a resistência do vizinho', () => {
    const resistant = buildContent(raw({
      monsters: [{ ...rat, mitigation: { resistances: { physical: 0.9 } } }, biter, bat],
    }));
    const started = start({ content: resistant, assign: { carnage: 'rat' }, level: 10 });
    started.session.advanceBy(50);
    place(started.ruleset, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 5, y: 3 }]);
    const [a, b] = started.ruleset.monsters;
    if (a === undefined || b === undefined) throw new Error('faltam ratos');
    started.hero.position = { x: 1, y: 1, z: started.hero.position.z };
    a.receiveDamage(a.health - 1);
    const bBefore = b.health;
    run(started.session, 1_500);
    expect(a.alive).toBe(false);
    // Neutro pula a resistência de 90 % — o golpe físico da arma é que a sofre.
    expect(bBefore - b.health).toBeGreaterThanOrEqual(60);
  });

  it('as mortes que o Carnage causa são resolvidas e CREDITAM o herói (e podem encadear)', () => {
    const { session, hero, a, b } = scene(100);
    // B também quase morto: o Carnage de A o mata, e o de B (mesmo charm, mesmo monstro) pode atingir
    // quem estiver ao redor dele.
    b.receiveDamage(b.health - 1);
    const kills0 = session.aggregates.kills;
    run(session, 1_500);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
    expect(session.aggregates.kills).toBeGreaterThanOrEqual(kills0 + 2);
    expect(hero.xp).toBeGreaterThan(0);
  });

  it('o monstro INVOCADO por outro monstro também rola o Carnage: o `Monster::death` do Canary não confere `isSummon()`', () => {
    const { session, a, b, c } = scene(10);
    // A é uma invocação de um mestre qualquer (id numérico, o de um monstro): loot, XP e Bestiário
    // a excluem, o Carnage não.
    Object.assign(a, { masterId: 999_999 });
    expect(a.masterId).not.toBeNull();
    const bBefore = b.health;
    const cBefore = c.health;
    run(session, 1_500);
    expect(a.alive).toBe(false);
    expect(b.health).toBe(bBefore - 60);
    expect(c.health).toBe(cBefore);
  });

  it('sem o charm atribuído ao monstro que morreu, nada acontece com os vizinhos', () => {
    const { session, b } = scene(10, { carnage: 'bat' });
    const bBefore = b.health;
    run(session, 1_500);
    expect(b.health).toBe(bBefore);
  });
});

describe('os charms defensivos: DEPOIS do blockHit, ANTES do mana shield, minor antes de major', () => {
  const biterScene = (options: StartOptions) => {
    const started = start({ maxHealth: 100_000, ...options });
    started.session.advanceBy(50);
    // O bicho fica ao lado do herói e é o ÚNICO na arena que bate.
    place(started.ruleset, [{ x: 1, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 2 }]);
    // O que aconteceu antes do teste começar a medir (o primeiro golpe pode sair na entrada).
    started.session.drainEvents();
    return started;
  };
  const biterContent = (charms = catalogue()) => buildContent(raw({
    monsters: [biter, { ...rat, id: 'idle' }, bat], charms,
    routes: [{ ...route, spawnPoints: [
      { routeIndex: 0, radius: 3, monsterId: 'biter', respawnDelayMs: 600_000 },
      { routeIndex: 0, radius: 3, monsterId: 'idle', respawnDelayMs: 600_000 },
      { routeIndex: 0, radius: 3, monsterId: 'idle', respawnDelayMs: 600_000 },
    ] }],
  }));

  it('sem charm, o golpe tira 100 da vida (a linha de base dos vetores abaixo)', () => {
    const { session, hero, ruleset } = biterScene({ content: biterContent() });
    const before = hero.health;
    const biterSubject = ruleset.monsters[0]?.subject ?? '';
    const hits = hitsFrom(run(session, 4_500), biterSubject);
    expect(hits.length).toBeGreaterThan(0);
    // O que o herói perdeu é a soma do que os hits mostram (a mitigação do jogador do `combat-v3`
    // tira uma parte dos 100 — o número exato não é o assunto).
    expect(hero.health).toBe(before - hits.reduce((sum, e) => sum + e.amount, 0));
    expect(hits.every((e) => e.amount > 0 && e.amount <= 100)).toBe(true);
  });

  it('Dodge (major) nega o golpe INTEIRO: dano zero, e o monstro continua batendo', () => {
    const { session, hero, ruleset } = biterScene({ content: biterContent(), assign: { dodge: 'biter' } });
    const before = hero.health;
    const hits = hitsFrom(run(session, 6_500), ruleset.monsters[0]?.subject ?? '');
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.every((e) => e.amount === 0)).toBe(true);
    expect(hero.health).toBe(before);
  });

  it('Parry (major) devolve o dano recebido ao monstro como NEUTRO — só o segundo ponto do Canary', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, ruleset, hero } = biterScene({ content: biterContent(), assign: { parry: 'biter' } });
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem biter');
    const events = run(session, 4_500);
    const taken = hitsFrom(events, target.subject);
    const parried = charmHits(events).filter((e) => e.creatureId === target.subject);
    expect(taken.length).toBeGreaterThan(0);
    // Um Parry por golpe recebido, com o MESMO dano que o herói levou, neutro; o monstro NUNCA é curado.
    expect(parried.map((e) => e.amount)).toEqual(taken.map((e) => e.amount));
    expect(events.filter((e) => e.kind === 'creature-healed' && e.creatureId === target.subject)).toHaveLength(0);
    expect(hero.health).toBeLessThan(hero.maxHealth);
    expect(intents('charm').every(({ intent }) => intent.neutral === true)).toBe(true);
  });

  it('Adrenaline Burst (minor) dá haste de 10 s ao herói: 2,5 × (base − 40) + 40', () => {
    const { session, hero } = biterScene({ content: biterContent(), assign: { 'adrenaline-burst': 'biter' } });
    run(session, 2_500);
    const haste = hero.conditions.get('speed');
    expect(haste).not.toBeNull();
    const base = hero.speed;
    const expected = 2.5 * (base - 40) + 40; // min === max: nenhum sorteio
    expect(base * (1 + (haste?.speedPercent ?? 0) / 100)).toBeCloseTo(expected, 5);
  });

  it('Numb (minor) paraliza o monstro que bateu por 10 s', () => {
    const { session, ruleset } = biterScene({ content: biterContent(), assign: { numb: 'biter' } });
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem biter');
    run(session, 2_500);
    const paralysis = target.conditions.get('speed');
    expect(paralysis).not.toBeNull();
    expect(target.speed * (1 + (paralysis?.speedPercent ?? 0) / 100)).toBeCloseTo(40, 5);
  });

  it('Numb paraliza até o monstro IMUNE a `paralyze` (o mesmo `addCondition` direto do Cripple, #603)', () => {
    const immune = buildContent(raw({
      monsters: [{ ...biter, speed: 200, conditionImmunities: ['paralyze'] }, { ...rat, id: 'idle' }, bat],
      routes: [{ ...route, spawnPoints: [
        { routeIndex: 0, radius: 3, monsterId: 'biter', respawnDelayMs: 600_000 },
        { routeIndex: 0, radius: 3, monsterId: 'idle', respawnDelayMs: 600_000 },
        { routeIndex: 0, radius: 3, monsterId: 'idle', respawnDelayMs: 600_000 },
      ] }],
    }));
    const { session, ruleset } = biterScene({ content: immune, assign: { numb: 'biter' } });
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem biter');
    run(session, 2_500);
    const paralysis = target.conditions.get('speed');
    expect(paralysis).not.toBeNull();
    expect(target.speed * (1 + (paralysis?.speedPercent ?? 0) / 100)).toBeCloseTo(40, 5);
  });

  it('ORDEM: o minor rola ANTES do major — o Dodge que encerra o golpe não impede o Adrenaline', () => {
    const { session, hero, ruleset } = biterScene({
      content: biterContent(), assign: { dodge: 'biter', 'adrenaline-burst': 'biter' },
    });
    const events = run(session, 2_500);
    const bites = hitsFrom(events, ruleset.monsters[0]?.subject ?? '');
    expect(bites.length).toBeGreaterThan(0);
    expect(bites.every((e) => e.amount === 0)).toBe(true);
    // Se o major rolasse primeiro, o Dodge encerraria e o minor nunca chegaria a rolar.
    expect(hero.conditions.get('speed')).not.toBeNull();
  });

  it('golpe que já chegou a zero (armadura, imunidade) não rola charm', () => {
    const immune = buildContent(raw({
      monsters: [{ ...biter, abilities: [{ ...biter.abilities[0], power: { min: 0, max: 0 } }] }, bat],
      routes: [{ ...route, spawnPoints: [{ routeIndex: 0, radius: 3, monsterId: 'biter', respawnDelayMs: 600_000 }] }],
    }));
    const { session, hero } = start({
      content: immune, assign: { 'adrenaline-burst': 'biter' }, maxHealth: 100_000,
    });
    session.advanceBy(50);
    place(session.ruleset as HuntRuleset, [{ x: 1, y: 2 }]);
    run(session, 4_500);
    expect(hero.conditions.get('speed')).toBeNull();
  });

  it('Void Inversion converte o dreno de mana em GANHO de mana, com o valor bruto', () => {
    const drainer = {
      ...biter, id: 'drainer', name: 'Drainer',
      abilities: [{
        id: 'drain', cadenceMs: 2_000, power: { min: 100, max: 100 }, damageType: 'manadrain', target: { range: 1 },
      }],
    };
    const content = buildContent(raw({
      monsters: [drainer, bat],
      routes: [{ ...route, spawnPoints: [{ routeIndex: 0, radius: 3, monsterId: 'drainer', respawnDelayMs: 600_000 }] }],
    }));
    const inverted = start({ content, assign: { 'void-inversion': 'drainer' }, maxMana: 1_000, mana: 500 });
    inverted.session.advanceBy(50);
    place(inverted.ruleset, [{ x: 1, y: 2 }]);
    run(inverted.session, 3_000);
    expect(inverted.hero.mana).toBeGreaterThan(500);
    const plain = start({ content, maxMana: 1_000, mana: 500 });
    plain.session.advanceBy(50);
    place(plain.ruleset, [{ x: 1, y: 2 }]);
    run(plain.session, 3_000);
    expect(plain.hero.mana).toBeLessThan(500);
  });

  it('o Dodge do charm também nega o dreno de mana, e o Parry não rola nesse ramo', () => {
    const drainer = {
      ...biter, id: 'drainer', name: 'Drainer',
      abilities: [{
        id: 'drain', cadenceMs: 2_000, power: { min: 100, max: 100 }, damageType: 'manadrain', target: { range: 1 },
      }],
    };
    const content = buildContent(raw({
      monsters: [drainer, bat],
      routes: [{ ...route, spawnPoints: [{ routeIndex: 0, radius: 3, monsterId: 'drainer', respawnDelayMs: 600_000 }] }],
    }));
    const dodged = start({ content, assign: { dodge: 'drainer' }, maxMana: 1_000, mana: 500 });
    dodged.session.advanceBy(50);
    place(dodged.ruleset, [{ x: 1, y: 2 }]);
    run(dodged.session, 3_000);
    expect(dodged.hero.mana).toBe(500);
    vi.mocked(resolveDamage).mockClear();
    const parried = start({ content, assign: { parry: 'drainer' }, maxMana: 1_000, mana: 500 });
    parried.session.advanceBy(50);
    place(parried.ruleset, [{ x: 1, y: 2 }]);
    run(parried.session, 3_000);
    expect(parried.hero.mana).toBeLessThan(500);
    expect(intents('charm')).toHaveLength(0);
  });
});

describe('Cleanse: remove UMA condição negativa, imuniza o tipo por 11 s e impede a condição nova', () => {
  const poison = {
    key: 'poison', durationMs: 60_000, merge: 'refresh',
    effect: {
      kind: 'damage-over-time', form: 'rounds',
      rounds: [{ count: 10, intervalMs: 1_000, damage: 1 }], damageType: 'earth',
    },
  };
  const spitter = {
    ...biter, id: 'spitter', name: 'Spitter',
    abilities: [{
      id: 'spit', cadenceMs: 4_000, power: { min: 100, max: 100 }, damageType: 'physical',
      target: { range: 1 }, condition: poison,
    }],
  };
  const content = (chance = ALWAYS) => buildContent(raw({
    monsters: [spitter, bat], charms: catalogue({ cleanse: chance }),
    routes: [{ ...route, spawnPoints: [{ routeIndex: 0, radius: 3, monsterId: 'spitter', respawnDelayMs: 600_000 }] }],
  }));
  const scene = (assign: Readonly<Record<string, string>> | undefined, chance = ALWAYS) => {
    const started = start({ content: content(chance), maxHealth: 100_000, ...(assign === undefined ? {} : { assign }) });
    started.session.advanceBy(50);
    place(started.ruleset, [{ x: 1, y: 2 }]);
    return started;
  };
  /** As condições do herói a cada golpe do spitter, na ordem. */
  const afterEachHit = (started: ReturnType<typeof scene>, hits: number) => {
    const seen: (readonly string[])[] = [];
    let counted = 0;
    for (let t = 0; t < 40_000 && counted < hits; t += 50) {
      started.session.advanceBy(50);
      // O golpe do spitter (~50 depois da mitigação): os tiques do veneno (1) também são
      // `creature-hit` no herói.
      const events = started.session.drainEvents().filter(
        (e) => e.kind === 'creature-hit' && e.creatureId === 'hero' && e.amount >= 10,
      );
      if (events.length > 0) {
        counted += events.length;
        seen.push(started.hero.conditions.getState().map((c) => c.key));
      }
    }
    return seen;
  };

  it('sem o charm, cada golpe (re)aplica o veneno', () => {
    const seen = afterEachHit(scene(undefined), 3);
    expect(seen).toEqual([['poison'], ['poison'], ['poison']]);
  });

  it('com o charm: o 1º golpe envenena; o 2º limpa o veneno e NÃO aplica o novo; o 3º, ainda imune, também não', () => {
    const started = scene({ cleanse: 'spitter' });
    const seen = afterEachHit(started, 3);
    // 1º golpe: nada a limpar → a condição da ability entra.
    expect(seen[0]).toEqual(['poison']);
    // 2º: o Cleanse remove o veneno ativo, e a condição nova NÃO entra nessa rodada.
    expect(seen[1]).toEqual([]);
    // 3º (4 s depois, dentro dos 11 s de imunidade): o veneno não entra.
    expect(seen[2]).toEqual([]);
    expect(started.hero.cleanseImmunity.get('poison')).toBeDefined();
  });

  it('passados 11 s, o tipo deixa de estar imune e o veneno volta a entrar', () => {
    const started = scene({ cleanse: 'spitter' });
    const seen = afterEachHit(started, 6);
    // golpes em t ≈ 0, 4, 8, 12, 16, 20 s; a imunidade nasce no 2º (t ≈ 4) e vale até ≈ 15 s.
    expect(seen[2]).toEqual([]);
    expect(seen[3]).toEqual([]);
    expect(seen[4]).toEqual(['poison']);
  });

  it('a imunidade atravessa o snapshot (estado do jogador, não do charm)', () => {
    const started = scene({ cleanse: 'spitter' });
    afterEachHit(started, 2);
    const state = started.hero.getState();
    expect(state.cleanseImmunity?.['poison']).toBeGreaterThan(started.session.nowMs);
    expect(new CharacterRuntime(state).cleanseImmunity.get('poison'))
      .toBe(started.hero.cleanseImmunity.get('poison'));
  });

  it('chance zero: não limpa nada', () => {
    const seen = afterEachHit(scene({ cleanse: 'spitter' }, NEVER), 3);
    expect(seen).toEqual([['poison'], ['poison'], ['poison']]);
  });

  it('o tique de veneno de um monstro VIVO também rola os charms defensivos (ConditionDamage::doDamage)', () => {
    // O `owner` da condição é o atacante do `combatChangeHealth`: com o Dodge (chance 1000) TODO
    // tique é negado — e o veneno continua aplicado (o Dodge nega o golpe, não a condição).
    const dodged = scene({ dodge: 'spitter' });
    const events = run(dodged.session, 6_000);
    const ticks = hitsOnHero(events).filter((e) => e.source === 'spell');
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((e) => e.amount === 0)).toBe(true);
    expect(dodged.hero.conditions.get('poison')).not.toBeNull();
    // A linha de base: sem o charm o mesmo veneno tira vida.
    const plain = scene(undefined);
    const plainEvents = run(plain.session, 6_000);
    expect(plainEvents.some((e) => e.kind === 'creature-hit' && e.creatureId === 'hero'
      && e.source === 'spell' && e.amount > 0)).toBe(true);
  });

  it('o Parry devolve o tique ao monstro dono do veneno, como neutro', () => {
    const parried = scene({ parry: 'spitter' });
    const events = run(parried.session, 6_000);
    const owner = parried.ruleset.monsters[0];
    if (owner === undefined) throw new Error('sem spitter');
    const reflected = events.filter((e) => e.kind === 'creature-hit' && e.creatureId === owner.subject
      && e.attackerId === 'hero' && e.source === 'spell');
    const ticksOnHero = events.filter((e) => e.kind === 'creature-hit' && e.creatureId === 'hero'
      && e.source === 'spell' && e.amount > 0);
    expect(ticksOnHero.length).toBeGreaterThan(0);
    // Um Parry por golpe (mordida e tiques), com o dano que o herói levou.
    expect(reflected.length).toBeGreaterThan(ticksOnHero.length);
  });

  it('o tique de um monstro que JÁ MORREU não tem atacante: nenhum charm rola', () => {
    const started = scene({ dodge: 'spitter' });
    run(started.session, 1_500);
    expect(started.hero.conditions.get('poison')).not.toBeNull();
    // O dono morre; o veneno dele continua no herói, e agora nada nega os tiques.
    const owner = started.ruleset.monsters[0];
    if (owner === undefined) throw new Error('sem spitter');
    owner.receiveDamage(owner.health);
    resolveDeath(started.session, { kind: 'monster', monster: owner });
    started.session.drainEvents();
    const events = run(started.session, 2_500);
    expect(events.some((e) => e.kind === 'creature-hit' && e.creatureId === 'hero' && e.amount > 0)).toBe(true);
  });
});

describe('Fatal Hold: o monstro não foge por vida baixa por 30 s', () => {
  const runner = { ...rat, runOnHealth: 2_000, targetChange: { intervalMs: 5_000, chance: 0 } };
  const stubborn = { ...rat, id: 'stubborn', name: 'Stubborn', runOnHealth: 2_000 };

  it('cria a condição, mantém `isMonsterFleeing` falso e vence em 30 s', () => {
    const content = buildContent(raw({ monsters: [runner, biter, bat] }));
    const { session, ruleset } = start({ content, assign: { 'fatal-hold': 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem rato');
    run(session, 1_500);
    const hold = target.conditions.get('fatal-hold');
    expect(hold).not.toBeNull();
    expect(target.health).toBeLessThanOrEqual(2_000);
    expect(hold?.expiresAtMs).toBeLessThanOrEqual(session.nowMs + 30_000);
    // Sem golpe novo (o herói sai do alcance), o prazo vence e a condição some.
    target.position = { x: 5, y: 3, z: MAP_Z };
    ruleset.monsters.forEach((m, i) => { if (i > 0) m.position = { x: 5, y: 2, z: MAP_Z }; });
    session.advanceBy(31_000);
    expect(target.conditions.get('fatal-hold')).toBeNull();
  });

  it('o monstro que foge e NÃO troca de alvo fica preso PARA SEMPRE (o prazo do Canary nunca corre)', () => {
    const content = buildContent(raw({
      monsters: [stubborn, biter, bat],
      routes: [{ ...route, spawnPoints: [
        { routeIndex: 0, radius: 3, monsterId: 'stubborn', respawnDelayMs: 600_000 },
        { routeIndex: 0, radius: 3, monsterId: 'stubborn', respawnDelayMs: 600_000 },
        { routeIndex: 0, radius: 3, monsterId: 'stubborn', respawnDelayMs: 600_000 },
      ] }],
    }));
    const { session, ruleset } = start({ content, assign: { 'fatal-hold': 'stubborn' } });
    session.advanceBy(50);
    isolate(ruleset);
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem monstro');
    run(session, 1_500);
    const hold = target.conditions.get('fatal-hold');
    expect(hold?.expiresAtMs).toBe(Number.MAX_SAFE_INTEGER);
    // Some do alcance do herói e deixa correr muito além dos 30 s: a condição continua.
    ruleset.monsters.forEach((m) => { m.position = { x: 5, y: 3, z: MAP_Z }; });
    session.advanceBy(120_000);
    expect(target.conditions.get('fatal-hold')).not.toBeNull();
    // E sobrevive ao snapshot (o inteiro seguro cabe no JSON).
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as ReturnType<Session['snapshot']>;
    const restored = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, content) as HuntRuleset, new Rng(snapshot.rng),
    );
    const revived = (restored.ruleset as HuntRuleset).monsters[0];
    expect(revived?.conditions.get('fatal-hold')?.expiresAtMs).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('monstro que nunca foge (sem `runOnHealth`) não é preso — nenhuma condição', () => {
    const { session, ruleset } = start({ assign: { 'fatal-hold': 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    run(session, 3_000);
    expect(ruleset.monsters[0]?.conditions.get('fatal-hold')).toBeNull();
  });
});

describe('os charms passivos entram nos termos que já existem (crítico, leech)', () => {
  // O crítico BASE do conteúdo real (`baseline.json`): 5 % e +10 %. Aqui `chance: 0` para o
  // vetor ser determinístico — o Low Blow é quem abre a chance.
  const withBaseCrit = (chances: Readonly<Record<string, number>> = {}) => buildContent(raw({
    combat: [{ ...combatV4, modifiers: { critical: { chance: 0, multiplier: 1.1 } } }],
    charms: catalogue(chances),
  }));
  const weaponIntents = () => intents('basic-attack')
    .filter(({ intent }) => intent.extension !== true);

  it('sem charm, o golpe carrega só o crítico base', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, ruleset } = start({ content: withBaseCrit() });
    session.advanceBy(50);
    isolate(ruleset);
    run(session, 3_000);
    const calls = weaponIntents();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(({ intent }) => intent.modifiers?.critical?.multiplier === 1.1)).toBe(true);
    expect(calls.every(({ intent }) => intent.modifiers?.lifeLeech === undefined)).toBe(true);
  });

  it('Low Blow: o crítico base falhou (chance 0) e o SEGUNDO sorteio abre a chance — o golpe critica', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, ruleset } = start({
      content: withBaseCrit({ 'low-blow': ALWAYS }), assign: { 'low-blow': 'rat' },
    });
    session.advanceBy(50);
    isolate(ruleset);
    run(session, 3_000);
    const calls = weaponIntents();
    expect(calls.length).toBeGreaterThan(0);
    for (const { intent, outcome } of calls) {
      expect(intent.modifiers?.critical).toEqual({ chance: 1, multiplier: 1.1 });
      expect(outcome.critical).toBe(true);
    }
  });

  it('Low Blow só vale contra o monstro do charm', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, ruleset } = start({
      content: withBaseCrit({ 'low-blow': ALWAYS }), assign: { 'low-blow': 'bat' },
    });
    session.advanceBy(50);
    isolate(ruleset);
    run(session, 3_000);
    expect(weaponIntents().every(({ outcome }) => !outcome.critical)).toBe(true);
  });

  it('Savage Blow soma 44 % (tier 3) ao multiplicador do crítico', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, ruleset } = start({ content: withBaseCrit(), assign: { 'savage-blow': 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    run(session, 3_000);
    const calls = weaponIntents();
    expect(calls.length).toBeGreaterThan(0);
    for (const { intent } of calls) {
      expect(intent.modifiers?.critical?.multiplier).toBeCloseTo(1.54, 10);
    }
  });

  it('Vampiric Embrace (3,2 % no tier 3) soma ao life leech do golpe', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, ruleset } = start({ content: withBaseCrit(), assign: { 'vampiric-embrace': 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    run(session, 3_000);
    const calls = weaponIntents();
    expect(calls.length).toBeGreaterThan(0);
    for (const { intent } of calls) {
      expect(intent.modifiers?.lifeLeech).toBeCloseTo(0.032, 10);
      expect(intent.modifiers?.manaLeech).toBeUndefined();
    }
  });

  it('Void\'s Call (1,6 % no tier 3) soma ao mana leech do golpe', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, ruleset } = start({ content: withBaseCrit(), assign: { 'voids-call': 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    run(session, 3_000);
    const calls = weaponIntents();
    expect(calls.length).toBeGreaterThan(0);
    for (const { intent } of calls) {
      expect(intent.modifiers?.manaLeech).toBeCloseTo(0.016, 10);
      expect(intent.modifiers?.lifeLeech).toBeUndefined();
    }
  });

  it('o leech do Vampiric Embrace cura o herói de verdade', () => {
    const big = buildContent(raw({
      combat: [{ ...combatV4, player: { ...combatV4.player, attackPower: 5_000 } }],
      monsters: [{ ...rat, health: 1_000_000 }, biter, bat],
    }));
    const { session, ruleset, hero } = start({
      content: big, assign: { 'vampiric-embrace': 'rat' }, maxHealth: 5_000, health: 1_000, level: 30,
    });
    session.advanceBy(50);
    isolate(ruleset);
    const before = hero.health;
    const events = run(session, 3_000);
    const healed = events.filter((e) => e.kind === 'creature-healed' && e.source === 'leech');
    expect(healed.length).toBeGreaterThan(0);
    expect(hero.health).toBeGreaterThan(before);
  });
});

describe('o gate por perfil: os charms são do `combat-v4`, e o Dodge do PRD sai com ele', () => {
  const asV3 = (over: Record<string, unknown> = {}) => buildContent(raw({
    combat: [{ ...combatV4, compatibilityProfile: 'combat-v3', ...over }],
  }));

  it('sob `combat-v3` um charm atribuído não dispara NADA (a sessão fixada não muda no meio)', () => {
    const { session, ruleset } = start({ content: asV3(), assign: { wound: 'rat', cripple: 'rat' } });
    session.advanceBy(50);
    isolate(ruleset);
    const events = run(session, 6_000);
    expect(heroHits(events).filter((e) => e.source === 'melee').length).toBeGreaterThan(0);
    expect(charmHits(events)).toHaveLength(0);
    expect(ruleset.monsters[0]?.conditions.get('speed')).toBeNull();
  });

  it('sob `combat-v3` o Dodge de um charm atribuído também não nega golpe', () => {
    const content = buildContent(raw({
      combat: [{ ...combatV4, compatibilityProfile: 'combat-v3' }],
      monsters: [biter, { ...rat, id: 'idle' }, bat],
      routes: [{ ...route, spawnPoints: [
        { routeIndex: 0, radius: 3, monsterId: 'biter', respawnDelayMs: 600_000 },
        { routeIndex: 0, radius: 3, monsterId: 'idle', respawnDelayMs: 600_000 },
        { routeIndex: 0, radius: 3, monsterId: 'idle', respawnDelayMs: 600_000 },
      ] }],
    }));
    const { session, ruleset, hero } = start({ content, assign: { dodge: 'biter' }, maxHealth: 100_000 });
    session.advanceBy(50);
    place(ruleset, [{ x: 1, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 2 }]);
    const before = hero.health;
    run(session, 4_500);
    expect(hero.health).toBeLessThan(before);
  });

  it('o Dodge do PRD (`combat.player.dodgeChance`) NÃO existe no `combat-v4` — nem o sorteio', () => {
    const biterContent = (combat: object) => buildContent(raw({
      combat: [combat], monsters: [biter, { ...rat, id: 'idle' }, bat],
      routes: [{ ...route, spawnPoints: [
        { routeIndex: 0, radius: 3, monsterId: 'biter', respawnDelayMs: 600_000 },
        { routeIndex: 0, radius: 3, monsterId: 'idle', respawnDelayMs: 600_000 },
        { routeIndex: 0, radius: 3, monsterId: 'idle', respawnDelayMs: 600_000 },
      ] }],
    }));
    const lostWith = (combat: object): number => {
      const { session, ruleset, hero } = start({ content: biterContent(combat), maxHealth: 100_000 });
      session.advanceBy(50);
      place(ruleset, [{ x: 1, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 2 }]);
      const before = hero.health;
      run(session, 8_500);
      return before - hero.health;
    };
    const noDodge = { ...combatV4, player: { ...combatV4.player, dodgeChance: 0 } };
    const alwaysDodge = { ...combatV4, player: { ...combatV4.player, dodgeChance: 1 } };
    // v4: dodgeChance 1 é ignorado — o mesmo dano, ao byte.
    expect(lostWith(alwaysDodge)).toBe(lostWith(noDodge));
    // v3: o mesmo dodgeChance corta o dano pela metade (a exceção de produto que o v4 revoga).
    const v3 = (dodgeChance: number) => ({
      ...combatV4, compatibilityProfile: 'combat-v3', player: { ...combatV4.player, dodgeChance },
    });
    expect(lostWith(v3(1))).toBeLessThan(lostWith(v3(0)) * 0.6);
  });
});

describe('Bless: reduz a perda de XP quando o último golpe é do monstro do charm', () => {
  // Level 40 (fórmula cúbica), morre nos primeiros golpes do `biter`.
  const killerContent = () => buildContent(raw({
    monsters: [{ ...biter, abilities: [{ ...biter.abilities[0], power: { min: 5_000, max: 5_000 } }] }, bat],
    routes: [{ ...route, spawnPoints: [
      { routeIndex: 0, radius: 3, monsterId: 'biter', respawnDelayMs: 600_000 },
    ] }],
  }));
  const xpAfterDeath = (assign: Readonly<Record<string, string>> | undefined) => {
    const { session, ruleset, hero } = start({
      content: killerContent(), ...(assign === undefined ? {} : { assign }),
      level: 40, maxHealth: 300, health: 300,
    });
    // A XP ANTES de o tempo andar: o biter bate na entrada e pode matar dentro do primeiro avanço.
    const xpBefore = hero.xp;
    session.advanceBy(50);
    place(ruleset, [{ x: 1, y: 2 }]);
    run(session, 6_000);
    expect(hero.alive).toBe(false);
    return xpBefore - hero.xp;
  };

  it('sem o charm a perda é a de sempre; com Bless (tier 3, 12 %) cai 12 %', () => {
    const plain = xpAfterDeath(undefined);
    const blessed = xpAfterDeath({ bless: 'biter' });
    expect(plain).toBeGreaterThan(0);
    expect(blessed).toBe(Math.round(plain * 0.88));
  });

  it('o charm de OUTRO monstro não vale', () => {
    const plain = xpAfterDeath(undefined);
    expect(xpAfterDeath({ bless: 'bat' })).toBe(plain);
  });
});

describe('Gut: mais creature products no cadáver do monstro do charm', () => {
  // Um rato de 1 de vida que renasce a cada 1 s: dezenas de abates numa sessão curta. Pele
  // (`creatureProduct`) e presunto (não) caem com a MESMA chance na tabela `canary`.
  const items = [
    { id: 'fur', name: 'Fur', kind: 'other', weight: 0.1, value: 0, creatureProduct: true },
    { id: 'ham', name: 'Ham', kind: 'other', weight: 0.1, value: 0 },
  ];
  const fodder = {
    ...rat, health: 1,
    loot: {
      rollModel: 'canary', gold: { chance: 0, min: 1, max: 1 },
      items: [
        { itemId: 'fur', chance: 0.5, min: 1, max: 1 },
        { itemId: 'ham', chance: 0.5, min: 1, max: 1 },
      ],
    },
  };
  const farm = (assign: Readonly<Record<string, string>> | undefined) => {
    const content = buildContent(raw({
      items, monsters: [fodder, biter, bat],
      routes: [{ ...route, spawnPoints: [
        { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 1_000 },
        { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 1_000 },
        { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 1_000 },
      ] }],
    }));
    const { session, hero } = start({ content, ...(assign === undefined ? {} : { assign }) });
    run(session, 300_000, 500);
    // O loot cai na bolsa (`satchel`) do herói — é onde o abate o entrega.
    const stock = (itemId: string): number => (hero.inventory.getState().satchel ?? []).reduce(
      (sum: number, item) => (item !== null && item.itemId === itemId ? sum + item.quantity : sum), 0,
    );
    return { kills: session.aggregates.kills, fur: stock('fur'), ham: stock('ham') };
  };

  it('com o Gut o herói colhe MAIS pele e o MESMO presunto (a mesma sequência de RNG: o Gut não sorteia)', () => {
    const plain = farm(undefined);
    const gutted = farm({ gut: 'rat' });
    expect(plain.kills).toBeGreaterThan(50);
    expect(gutted.kills).toBe(plain.kills);
    expect(gutted.ham).toBe(plain.ham);
    expect(gutted.fur).toBeGreaterThan(plain.fur);
  });

  it('o Gut de OUTRO monstro não vale', () => {
    expect(farm({ gut: 'bat' })).toEqual(farm(undefined));
  });
});

describe('a conformance de RNG com e sem charms (combat-v4)', () => {
  // Uma luta com TUDO: o herói bate nos ratos, o biter bate no herói, e os charms rolam de verdade
  // (chance moderada — nem "sempre" nem "nunca").
  const busy = () => {
    const chances = {
      wound: 30, enflame: 30, cripple: 30, dodge: 60, parry: 60, 'adrenaline-burst': 60, numb: 60,
    };
    return buildContent(raw({
      charms: catalogue(chances), monsters: [{ ...rat, health: 100_000 }, biter, bat],
      routes: [{ ...route, spawnPoints: [
        { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 600_000 },
        { routeIndex: 0, radius: 3, monsterId: 'biter', respawnDelayMs: 600_000 },
        { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 600_000 },
      ] }],
    }));
  };
  const fight = (assign: Readonly<Record<string, string>> | undefined, seed = 'conformance') => {
    const started = start({
      content: busy(), maxHealth: 1_000_000, seed, ...(assign === undefined ? {} : { assign }),
    });
    started.session.advanceBy(50);
    place(started.ruleset, [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 5, y: 3 }]);
    return started;
  };
  const fingerprint = ({ session, hero, ruleset }: ReturnType<typeof fight>) => JSON.stringify({
    rng: session.snapshot().rng,
    hero: [hero.health, hero.mana, hero.conditions.getState(), hero.blockCharge],
    monsters: ruleset.monsters.map((m) => [m.health, m.conditions.getState()]),
  });

  it('sem charm nenhum e com charm de OUTRO monstro, a luta é bit a bit a mesma (o gate é aditivo)', () => {
    const plain = fight(undefined);
    const unrelated = fight({ wound: 'bat', dodge: 'bat' });
    run(plain.session, 30_000);
    run(unrelated.session, 30_000);
    expect(fingerprint(unrelated)).toBe(fingerprint(plain));
  });

  it('com charm no monstro que luta, a sequência muda (os charms rolam de verdade)', () => {
    const plain = fight(undefined);
    const charmedFight = fight({ wound: 'rat', dodge: 'biter', cripple: 'rat' });
    run(plain.session, 30_000);
    run(charmedFight.session, 30_000);
    expect(fingerprint(charmedFight)).not.toBe(fingerprint(plain));
  });

  it('1 Hz == 10 Hz == 20 Hz com charms rolando: nada aqui é decisão por tick (invariantes 2 e 3)', () => {
    const at = (stepMs: number): string => {
      const f = fight({ wound: 'rat', dodge: 'biter', cripple: 'rat', 'adrenaline-burst': 'biter' });
      run(f.session, 60_000, stepMs);
      return fingerprint(f);
    };
    const reference = at(100);
    expect(at(1_000)).toBe(reference);
    expect(at(50)).toBe(reference);
  });

  it('a retomada de um snapshot no meio da luta rende o mesmo que a sessão que nunca caiu', () => {
    const straight = fight({ wound: 'rat', dodge: 'biter', cripple: 'rat', numb: 'biter' });
    const interrupted = fight({ wound: 'rat', dodge: 'biter', cripple: 'rat', numb: 'biter' });
    run(straight.session, 20_000);
    run(interrupted.session, 20_000);
    const snapshot = JSON.parse(JSON.stringify(interrupted.session.snapshot())) as ReturnType<Session['snapshot']>;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, busy()) as HuntRuleset, new Rng(snapshot.rng),
    );
    run(straight.session, 40_000);
    run(resumed, 40_000);
    const hero = resumed.participants[0];
    expect(hero?.health).toBe(straight.hero.health);
    expect(resumed.snapshot().rng).toEqual(straight.session.snapshot().rng);
    expect((resumed.ruleset as HuntRuleset).monsters.map((m) => m.health))
      .toEqual(straight.ruleset.monsters.map((m) => m.health));
  });
});

describe('Cleanse também limpa rooted e feared (M44-04, #622, `Creature::getCleansableConditions`)', () => {
  const binder = (kind: 'rooted' | 'feared') => ({
    ...biter, id: 'binder', name: 'Binder',
    abilities: [{
      id: kind, cadenceMs: 1_000, power: { min: 100, max: 100 }, damageType: 'physical',
      target: { range: 1 },
      condition: { key: kind, merge: 'longest', durationMs: 3_000, effect: { kind } },
    }],
  });
  const scene = (kind: 'rooted' | 'feared', chance = ALWAYS) => {
    const loaded = buildContent(raw({
      monsters: [binder(kind), bat], charms: catalogue({ cleanse: chance }),
      routes: [{ ...route, spawnPoints: [{ routeIndex: 0, radius: 3, monsterId: 'binder', respawnDelayMs: 600_000 }] }],
    }));
    const started = start({ content: loaded, maxHealth: 100_000, assign: { cleanse: 'binder' } });
    started.session.advanceBy(50);
    place(started.ruleset, [{ x: 1, y: 2 }]);
    return started;
  };
  /** O instante do primeiro golpe que deixou a condição no herói, e o do primeiro que a tirou. */
  const timeline = (started: ReturnType<typeof scene>, key: string) => {
    let applied = -1;
    let cleaned = -1;
    for (let t = 0; t < 6_000; t += 50) {
      started.session.advanceBy(50);
      const has = started.hero.conditions.get(key) !== null;
      if (has && applied < 0) applied = started.session.nowMs;
      if (!has && applied >= 0 && cleaned < 0) cleaned = started.session.nowMs;
    }
    return { applied, cleaned };
  };

  for (const kind of ['rooted', 'feared'] as const) {
    it(`${kind}: o 1º golpe aplica; o seguinte limpa, imuniza o tipo por 11 s e não aplica de novo`, () => {
      const started = scene(kind);
      const { applied, cleaned } = timeline(started, kind);
      expect(applied).toBeGreaterThan(0);
      // Limpou LOGO no golpe seguinte (1 s depois), muito antes de os 3 s da condição acabarem.
      expect(cleaned).toBeGreaterThan(applied);
      expect(cleaned - applied).toBeLessThanOrEqual(1_500);
      // A imunidade é do TIPO e dura 11 s (`Player::setImmuneCleanse` → `setImmuneFear(11000)`).
      const until = started.hero.cleanseImmunity.get(kind) ?? -1;
      expect(until).toBeGreaterThan(cleaned + 9_000);
      expect(until).toBeLessThanOrEqual(cleaned + 11_100);
      // E a condição NÃO voltou nos golpes seguintes, dentro da janela.
      expect(started.hero.conditions.get(kind)).toBeNull();
    });

    it(`${kind}: chance zero não limpa nada — a condição segue nos golpes seguintes`, () => {
      const started = scene(kind, NEVER);
      // Espera a condição entrar e confere que 2 s depois ela ainda está lá: sem Cleanse, nenhum
      // golpe a tira, e a ability só a renova (`longest`).
      let applied = -1;
      for (let t = 0; t < 6_000 && applied < 0; t += 50) {
        started.session.advanceBy(50);
        if (started.hero.conditions.get(kind) !== null) applied = started.session.nowMs;
      }
      expect(applied).toBeGreaterThan(0);
      run(started.session, 2_000);
      expect(started.hero.conditions.get(kind)).not.toBeNull();
    });
  }
});
