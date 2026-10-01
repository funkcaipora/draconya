// As duas runas de invocação restantes (M38-03, #600, ADR 0057 d.5–d.6): Convince Creature e Animate
// Dead. Canary `data/scripts/runes/convince_creature.lua` e `animate_dead_rune.lua`.
//
// O conteúdo é sintético e os números são redondos de propósito — o que o teste prende é o
// MECANISMO (o que o script recusa e em que ordem, quando o respawn começa, que cadáver a runa
// enxerga), não o balanceamento do Canary, que tem teste próprio em `packages/content/src/load.test.ts`.

import {
  BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema, botSlotSchema, buildContent,
  placeholderAppearances,
} from '@draconya/content';
import type { BotConfigV2, Content, Progression, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { resolveDeath } from '../death.js';
import type { MonsterRuntime } from '../monster/monster.js';
import { statsForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import type { DomainEvent } from '../session.js';
import { Session } from '../session.js';
import { HuntRuleset, createHuntSession, huntRulesetFromSnapshot } from './hunt.js';

const MAP_Z = 7;
// Uma sala de 7 × 3 com a rota em anel em volta dela (a rota precisa fechar o laço): nenhum ponto da
// sala fica a mais de 6 tiles de outro — o alcance 8 das duas runas cobre tudo.
const map = {
  id: 'field', z: MAP_Z,
  grid: ['#########', '#.......#', '#.......#', '#.......#', '#########'],
};
const ring = (points: readonly (readonly [number, number])[]) =>
  points.map(([x, y]) => ({ x, y, z: MAP_Z }));
const routeTiles = ring([
  [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [7, 2],
  [7, 3], [6, 3], [5, 3], [4, 3], [3, 3], [2, 3], [1, 3], [1, 2],
]);
const hunt = { id: 'field', name: 'Field', recommendedLevel: 1, mapId: 'field', routeId: 'field' };
const routeWith = (spawnPoints: readonly object[], tiles: readonly object[] = routeTiles) => (
  { id: 'field', mapId: 'field', tiles, spawnPoints }
);
/** Um ponto de spawn no tile `routeIndex` da rota: o monstro nasce ali (o centro vem primeiro na busca). */
const spawnAt = (routeIndex: number, monsterId: string, respawnDelayMs = 30_000) =>
  ({ routeIndex, radius: 1, monsterId, respawnDelayMs });

const progression = {
  id: 'baseline', startingHealth: 100_000, startingMana: 1_000, startingCapacity: 1_000,
  healthPerLevel: 0, manaPerLevel: 0, capacityPerLevel: 0, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.08, promotionReduction: 0.3 },
  skillMultipliers: {},
};
const combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: {
    physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0,
    manadrain: 0, arcane: 0,
  },
  minimumDamageFraction: 0.1,
  // O herói é pacifista (`attackPower: 0`), salvo onde o teste diz o contrário: nada morre por ele
  // sem o teste mandar.
  player: { attackPower: 0, attackIntervalMs: 1000, attackRange: 1, armor: 0, dodgeChance: 0 },
};
const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const party = { id: 'baseline', maxMembers: 4 };
const skills = [
  { id: 'melee', name: 'Melee', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'magic', name: 'Magic', startingLevel: 0, curve: { base: 100, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0 },
];
const weaponFamilies = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
];

const MIN = 1_000;
/** A cadeia de decaimento do Canary para um cadáver comum: 10 s `unmove`, depois movível até o fim. */
const CORPSE_TTL_MS = 670_000;
const UNMOVABLE_MS = 10_000;

/** Um monstro parado e inofensivo: nem ataca, nem persegue — o teste decide o que acontece. */
const base = {
  recommendedLevel: 1, experience: 30, attack: 0, armor: 0, attackIntervalMs: 2_000, speed: 300,
  aggroRadius: 0, attackRange: 1,
};
/** O que a Convince aceita: `convinceable`, com a mana do Canary (20). */
const convincible = {
  ...base, id: 'convincible', name: 'Convincible', health: 100,
  loot: { gold: { chance: 1, min: 7, max: 7 }, items: [] },
  convinceable: true, manaCost: 20,
  corpseTtlMs: CORPSE_TTL_MS, corpseAnimatable: [{ fromMs: UNMOVABLE_MS, untilMs: CORPSE_TTL_MS }],
};
/** Sem `convinceable` — a runa recusa. */
const stubborn = { ...convincible, id: 'stubborn', name: 'Stubborn', convinceable: false };
/** `convinceable` sem `manaCost`: o script debita `getManaCost()` zerado — de graça. */
const freebie = { ...convincible, id: 'freebie', name: 'Freebie', manaCost: undefined };
/** O alvo hostil das áreas: parado, inofensivo e com vida de sobra — só o dano que ele leva importa. */
const tough = {
  ...base, id: 'tough', name: 'Tough', health: 1_000_000, experience: 0, loot: { items: [] },
};
/** O que a Animate Dead ergue. */
const skeleton = {
  ...base, id: 'skeleton', name: 'Skeleton', health: 50, experience: 0, loot: { items: [] }, manaCost: 300,
};
/** Um monstro que deixa cadáver animável depois da janela `unmove`. */
const victim = {
  ...base, id: 'victim', name: 'Victim', health: 10,
  loot: { gold: { chance: 1, min: 5, max: 5 }, items: [] },
  corpseTtlMs: CORPSE_TTL_MS, corpseAnimatable: [{ fromMs: UNMOVABLE_MS, untilMs: CORPSE_TTL_MS }],
};
/** Um cadáver que NUNCA é movível (sem `corpseAnimatable`, como o de um estágio sempre `unmove`). */
const heavy = { ...victim, id: 'heavy', name: 'Heavy', corpseAnimatable: undefined };
/** O que deixa loot que NÃO cabe na mochila do herói (5 000 de peso contra 1 000 de capacidade): fica no cadáver. */
const richVictim = {
  ...victim, id: 'rich-victim', name: 'Rich Victim',
  loot: { gold: { chance: 1, min: 5, max: 5 }, items: [{ itemId: 'anvil', chance: 1, min: 1, max: 1 }] },
};
const anvil = { id: 'anvil', name: 'Anvil', kind: 'other', weight: 5_000, value: 0 };

const convinceRune = {
  id: 'convince-test', name: 'Convince Creature Rune', price: 80, group: 'support',
  groupCooldownMs: 1_000, effect: { kind: 'convince', range: 8 },
};
const animateRune = {
  id: 'animate-test', name: 'Animate Dead Rune', price: 375, group: 'support',
  groupCooldownMs: 1_000, effect: { kind: 'animate-dead', monsterId: 'skeleton', range: 8 },
};

const raw = (over: Partial<RawContent> = {}): RawContent => {
  const baseContent: RawContent = {
    monsters: [convincible, stubborn, freebie, skeleton, victim, heavy, richVictim, tough], hunts: [hunt],
    vocations: [], progression: [progression], combat: [combat], stamina: [stamina], party: [party],
    spells: [], skills, weaponFamilies, items: [anvil], ammunition: [],
    supplies: [convinceRune, animateRune],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map], routes: [routeWith([])], ...over,
  };
  return { appearances: [placeholderAppearances(baseContent)], ...baseContent };
};

/** A config v2 com os slots no conjunto ATIVO, na ordem dada. */
const botConfig = (given: readonly object[]): BotConfigV2 => {
  const slots = given.map((slot) => botSlotSchema.parse(slot));
  while (slots.length < BOT_SLOTS_PER_SET) slots.push(null as never);
  const empty = { slots: Array.from({ length: BOT_SLOTS_PER_SET }, () => null) };
  return botConfigV2Schema.parse({
    version: BOT_VOCABULARY_VERSION, activeSet: 0, sets: [{ slots }, empty, empty, empty],
  });
};
/** O slot só de DISPARO MANUAL (`auto: false`): o bot não o usa sozinho, e o teste decide quando. */
const manualRune = (supplyId: string) => botConfig([{ do: { kind: 'supply', supplyId }, auto: false }]);
/** O slot AUTOMÁTICO: o bot usa a runa sozinho, escolhendo a mira (o cadáver animável mais próximo). */
const autoRune = (supplyId: string) => botConfig([{ do: { kind: 'supply', supplyId } }]);

function makeHero(
  id: string,
  over: { mana?: number; gold?: number; capacity?: number; level?: number; attackPower?: number } = {},
): CharacterRuntime {
  const stats = statsForLevel(over.level ?? 30, null, progression as Progression);
  return new CharacterRuntime({
    id, position: { x: 0, y: 0, z: MAP_Z },
    health: stats.maxHealth, maxHealth: stats.maxHealth,
    mana: over.mana ?? 1_000, maxMana: Math.max(over.mana ?? 1_000, 1_000),
    level: over.level ?? 30, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0, gold: over.gold ?? 5_000, goldDelta: 0, alive: true,
    cooldowns: {}, capacity: over.capacity ?? 1_000,
  });
}

interface StartOptions {
  readonly spawnPoints?: readonly object[];
  readonly config?: BotConfigV2;
  readonly heroes?: readonly string[];
  readonly mana?: number;
  readonly gold?: number;
  readonly capacity?: number;
  readonly supplies?: readonly object[];
  readonly spells?: readonly object[];
  /** Outro mapa e outra rota (o corredor de um tile): o padrão é a sala de 7 × 3 em anel. */
  readonly layout?: { readonly map: typeof map; readonly tiles: readonly object[] };
  readonly attackPower?: number;
  readonly seed?: string;
}

function start(options: StartOptions = {}) {
  const config = options.config ?? botConfig([]);
  const heroIds = options.heroes ?? ['hero'];
  const loaded = buildContent(raw({
    routes: [routeWith(options.spawnPoints ?? [], options.layout?.tiles)],
    ...(options.layout === undefined ? {} : { maps: [options.layout.map] }),
    ...(options.supplies === undefined ? {} : { supplies: options.supplies }),
    ...(options.spells === undefined ? {} : { spells: options.spells }),
    combat: [{ ...combat, player: { ...combat.player, attackPower: options.attackPower ?? 0 } }],
  }));
  const botConfigs = Object.fromEntries(heroIds.map((id) => [id, config]));
  const session = createHuntSession({
    id: options.seed ?? 'runes-session', content: loaded, huntId: 'field', difficulty: 'cautious',
    createdAtMs: 0, botConfigs,
  });
  const heroes = heroIds.map((id) => makeHero(id, {
    ...(options.mana === undefined ? {} : { mana: options.mana }),
    ...(options.gold === undefined ? {} : { gold: options.gold }),
    ...(options.capacity === undefined ? {} : { capacity: options.capacity }),
  }));
  for (const hero of heroes) {
    // O herói sabe TODA magia do conteúdo do teste (#624): o portão do aprendizado tem bloco próprio
    // em `hunt.test.ts`, e aqui o assunto é a runa de invocação, não se o herói comprou a magia.
    for (const id of loaded.spells.keys()) hero.learnedSpells.grant(id);
    session.enter(hero);
  }
  const hero = heroes[0] as CharacterRuntime;
  return { session, hero, heroes, ruleset: session.ruleset as HuntRuleset, loaded };
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

const monstersOf = (ruleset: HuntRuleset, monsterId: string): MonsterRuntime[] =>
  ruleset.monsters.filter((m) => m.alive && m.monsterId === monsterId);
const onlyMonster = (ruleset: HuntRuleset, monsterId: string): MonsterRuntime => {
  const found = monstersOf(ruleset, monsterId)[0];
  if (found === undefined) throw new Error(`sem ${monsterId}`);
  return found;
};
const ownedBy = (ruleset: HuntRuleset, characterId: string): MonsterRuntime[] =>
  ruleset.monsters.filter((m) => m.alive && m.masterId === characterId);
const aimAt = (monster: MonsterRuntime) => ({ kind: 'monster' as const, subject: monster.subject });
const aimAtTile = (x: number, y: number) => ({ kind: 'position' as const, position: { x, y, z: MAP_Z } });

/** Mata o monstro AGORA, pelo pipeline de morte, sem ninguém creditado (sem XP nem loot). */
function kill(session: Session, monster: MonsterRuntime): void {
  monster.receiveDamage(monster.health);
  resolveDeath(session, { kind: 'monster', monster });
}

describe('Convince Creature (`convince_creature.lua`, ADR 0057 d.5)', () => {
  const withMonster = (extra: StartOptions = {}, monsterId = 'convincible') => {
    const started = start({
      spawnPoints: [spawnAt(5, monsterId)], config: manualRune('convince-test'), ...extra,
    });
    started.session.advanceBy(100);
    return { ...started, target: onlyMonster(started.ruleset, monsterId) };
  };

  it('transfere a posse: o monstro vira invocação do lançador, paga a mana DELE e o gold da runa', () => {
    const { session, hero, ruleset, target } = withMonster();
    session.drainEvents();
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(target))).toEqual({ ok: true });

    expect(target.masterId).toBe('hero');
    expect(ownedBy(ruleset, 'hero')).toEqual([target]);
    // 1 000 − 20: a mana é a do MONSTRO (`monsterType:getManaCost()`), e a runa em si não custa mana.
    expect(hero.mana).toBe(980);
    expect(hero.goldDelta).toBe(-80);
    // A magia rende skill pela mana gasta, como `addManaSpent` (100 de base, 1 ponto por mana).
    expect(hero.skills.getState()['magic']?.points ?? 0).toBeGreaterThan(0);

    const events = session.drainEvents();
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'creature-appeared', creatureId: target.subject, masterId: 'hero',
    }));
    // O efeito da runa sai no lançador (sem alvo, sem tile): o `CONST_ME_MAGIC_BLUE` do Canary.
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'supply-used', supplyId: 'convince-test', targets: [], tiles: [],
    }));
  });

  it('`convinceable` sem `manaCost` é de graça: o script debita `getManaCost()`, que é zero', () => {
    const { session, hero, ruleset, target } = withMonster({}, 'freebie');
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(target))).toEqual({ ok: true });
    expect(target.masterId).toBe('hero');
    expect(hero.mana).toBe(1_000);
  });

  it('recusa `not-possible` num monstro que não é `convinceable` — sem gastar gold, mana nem cooldown', () => {
    const { session, hero, ruleset, target } = withMonster({}, 'stubborn');
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(target)))
      .toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(target.masterId).toBeNull();
    expect(hero.mana).toBe(1_000);
    expect(hero.goldDelta).toBe(0);
    // Sem cooldown nenhum: a carga só é consumida quando o script devolve `true`.
    expect(hero.cooldowns.remainingMs('group:support', session.nowMs)).toBe(0);
  });

  it('recusa `not-possible` num monstro que JÁ tem mestre — o de outro personagem (`target:getMaster()`)', () => {
    const { session, ruleset, heroes, target } = withMonster({ heroes: ['a', 'b'] });
    expect(heroes).toHaveLength(2);
    expect(ruleset.useSlot(session, 'a', 0, 0, aimAt(target))).toEqual({ ok: true });
    session.advanceBy(1_100); // fora do cooldown de grupo de `b` (compartilhado com o de `a`? não — é por personagem).
    const refused = ruleset.useSlot(session, 'b', 0, 0, aimAt(target));
    expect(refused).toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(target.masterId).toBe('a');
  });

  it('recusa `too-many-summons` com duas invocações vivas — ANTES da mana, e sem gastar a carga', () => {
    const { session, hero, ruleset } = start({
      spawnPoints: [spawnAt(3, 'convincible'), spawnAt(4, 'convincible'), spawnAt(5, 'convincible')],
      config: manualRune('convince-test'),
    });
    session.advanceBy(100);
    const [first, second, third] = monstersOf(ruleset, 'convincible');
    if (first === undefined || second === undefined || third === undefined) throw new Error('faltam alvos');
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(first))).toEqual({ ok: true });
    session.advanceBy(1_100);
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(second))).toEqual({ ok: true });
    session.advanceBy(1_100);
    const goldBefore = hero.goldDelta;
    const manaBefore = hero.mana;

    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(third)))
      .toEqual({ ok: false, reason: 'too-many-summons', retryInMs: 0 });
    expect(third.masterId).toBeNull();
    expect(hero.goldDelta).toBe(goldBefore);
    expect(hero.mana).toBe(manaBefore);
    expect(ownedBy(ruleset, 'hero')).toHaveLength(2);
  });

  it('recusa `not-enough-mana` sem gastar a carga: a mana do monstro é conferida DEPOIS do teto', () => {
    const { session, hero, ruleset, target } = withMonster({ mana: 10 });
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(target)))
      .toEqual({ ok: false, reason: 'not-enough-mana', retryInMs: 0 });
    expect(target.masterId).toBeNull();
    expect(hero.mana).toBe(10);
    expect(hero.goldDelta).toBe(0);
  });

  it('recusa `not-enough-gold` (o saldo é o estoque da runa) e `out-of-range` (o alvo além do alcance)', () => {
    const poor = withMonster({ gold: 10 });
    expect(poor.ruleset.useSlot(poor.session, 'hero', 0, 0, aimAt(poor.target)))
      .toEqual({ ok: false, reason: 'not-enough-gold', retryInMs: 0 });
    expect(poor.target.masterId).toBeNull();

    const short = withMonster({
      supplies: [{ ...convinceRune, effect: { kind: 'convince', range: 1 } }, animateRune],
    });
    expect(short.ruleset.useSlot(short.session, 'hero', 0, 0, aimAt(short.target)))
      .toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
  });

  it('respeita level e magic level da runa, na ordem do Canary: requisitos antes do script', () => {
    const gated = { ...convinceRune, requires: { level: 40, magicLevel: 5 } };
    const { session, ruleset, target } = withMonster({ supplies: [gated, animateRune] });
    // Level 30 < 40: o mesmo `not-in-catalog` que toda runa devolve por level (`refusalOf`).
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(target)))
      .toEqual({ ok: false, reason: 'not-in-catalog', retryInMs: 0 });

    const noMagic = { ...convinceRune, requires: { magicLevel: 5 } };
    const other = withMonster({ supplies: [noMagic, animateRune] });
    expect(other.ruleset.useSlot(other.session, 'hero', 0, 0, aimAt(other.target)))
      .toEqual({ ok: false, reason: 'magic-level-too-low', retryInMs: 0 });
  });

  it('o ponto de spawn NÃO começa o respawn ao convencer: o Canary só o libera quando o monstro sai', () => {
    // `SpawnMonster::spawnedMonsterMap` continua contando o convencido — o respawn de 30 s só corre
    // depois que ele morre. (O ADR 0057 d.5 dizia "imediatamente"; a emenda corrige com a fonte.)
    const { session, ruleset, target } = withMonster();
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(target))).toEqual({ ok: true });

    run(session, 90_000);
    expect(ruleset.monsters.filter((m) => m.alive)).toEqual([target]);
    expect(monstersOf(ruleset, 'convincible').filter((m) => m.masterId === null)).toHaveLength(0);
  });

  it('o respawn começa quando o convencido MORRE, e ele não deixa XP, loot nem cadáver', () => {
    const { session, hero, ruleset, target } = withMonster();
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(target))).toEqual({ ok: true });
    run(session, 5_000);
    const killsBefore = session.aggregates.kills;

    kill(session, target);
    // O abate conta no extrato como o de qualquer invocação (#546) — e NADA mais paga.
    expect(session.aggregates.kills).toBe(killsBefore + 1);
    expect(hero.xp).toBe(0);
    expect(hero.goldDelta).toBe(-80);
    expect(session.aggregates.goldGained).toBe(0);
    expect(hero.bestiary.getState()).toEqual({});
    // Invocação nunca deixa cadáver (`Creature::dropCorpse`: `!lootDrop` → só um POFF).
    expect(ruleset.groundItems).toHaveLength(0);

    // O prazo do PONTO (30 s) conta a partir da morte, não do convencimento — mais os 4,2 s do aviso
    // de respawn de quem não é `blockable` (`SpawnMonster::scheduleSpawn`, #583).
    run(session, 29_000);
    expect(monstersOf(ruleset, 'convincible')).toHaveLength(0);
    run(session, 7_000);
    const respawned = monstersOf(ruleset, 'convincible');
    expect(respawned).toHaveLength(1);
    expect(respawned[0]?.masterId).toBeNull();
  });

  it('some com o mestre e devolve o lugar: o respawn começa quando ele SAI da hunt', () => {
    const { session, ruleset, target } = withMonster({ heroes: ['a', 'b'] });
    expect(ruleset.useSlot(session, 'a', 0, 0, aimAt(target))).toEqual({ ok: true });
    run(session, 5_000);

    session.leave('a', 'manual-exit');
    expect(session.ended).toBeNull();
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(0);
    expect(session.drainEvents().some((e) => e.kind === 'ground-item-appeared')).toBe(false);

    run(session, 29_000);
    expect(monstersOf(ruleset, 'convincible')).toHaveLength(0);
    run(session, 7_000);
    expect(monstersOf(ruleset, 'convincible')).toHaveLength(1);
  });

  it('o mestre larga o alvo que acabou de convencer: quem o atacava reavalia e a invocação herda o alvo dele', () => {
    const { session, hero, ruleset, target } = withMonster();
    // O herói fixou o monstro como alvo (clique) — depois convence exatamente ele.
    expect(ruleset.chooseTarget(session, 'hero', target.subject)).toBe(true);
    expect(ruleset.selectedTargetOf(hero)).toBe(target);

    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(target))).toEqual({ ok: true });
    expect(ruleset.selectedTargetOf(hero)).toBeNull();
    expect(ruleset.attackTargetOf(hero)).toBeNull();
    // E ele não o escolhe de novo: invocação de personagem nunca é alvo de ataque.
    expect(ruleset.chooseTarget(session, 'hero', target.subject)).toBe(false);
    run(session, 2_000);
    expect(ruleset.attackTargetOf(hero)).toBeNull();
    expect(target.targetId).toBeNull();
  });

  it('a lista de invocação PRÓPRIA do convencido deixa de armar (`!isSummon()`), as que ele já tinha continuam', () => {
    const summoner = {
      ...convincible, id: 'summoner', name: 'Summoner',
      summons: { max: 1, entries: [{ monsterId: 'skeleton', chance: 1, intervalMs: 1_000, count: 1 }] },
    };
    const loaded = buildContent(raw({
      monsters: [summoner, skeleton], routes: [routeWith([spawnAt(5, 'summoner')])],
    }));
    const session = createHuntSession({
      id: 'summoner-session', content: loaded, huntId: 'field', difficulty: 'cautious', createdAtMs: 0,
      botConfig: manualRune('convince-test'),
    });
    session.enter(makeHero('hero'));
    const ruleset = session.ruleset as HuntRuleset;
    session.advanceBy(100);
    const target = onlyMonster(ruleset, 'summoner');
    expect(target.scheduledSummons.size).toBe(1);

    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(target))).toEqual({ ok: true });
    expect(target.scheduledSummons.size).toBe(0);
    expect(session.dueAtOf('monster-summon', `m:${String(target.id)}:skeleton`)).toBeNull();
    run(session, 10_000);
    expect(ruleset.monsters.filter((m) => m.masterId === target.id)).toHaveLength(0);
  });

  it('a posse e o lugar no spawner sobrevivem ao snapshot: o respawn continua adiado', () => {
    const { session, ruleset, target, loaded } = withMonster();
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(target))).toEqual({ ok: true });
    run(session, 3_000);

    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed(snapshot.id),
    );
    const resumedRuleset = resumed.ruleset as HuntRuleset;
    const revived = resumedRuleset.monsters.find((m) => m.monsterId === 'convincible');
    expect(revived?.masterId).toBe('hero');

    run(resumed, 90_000);
    expect(resumedRuleset.monsters.filter((m) => m.alive)).toHaveLength(1);
  });
});

describe('Animate Dead (`animate_dead_rune.lua`, ADR 0057 d.6)', () => {
  /** Mata a `victim` no tile do spawn (sem crédito) e devolve o cadáver que ela deixou. */
  const withCorpse = (extra: StartOptions = {}, monsterId = 'victim') => {
    const started = start({
      spawnPoints: [spawnAt(4, monsterId)], config: manualRune('animate-test'), ...extra,
    });
    started.session.advanceBy(100);
    const dead = onlyMonster(started.ruleset, monsterId);
    const at = { x: dead.position.x, y: dead.position.y };
    kill(started.session, dead);
    const corpse = started.ruleset.groundItems[0];
    if (corpse === undefined) throw new Error('sem cadáver');
    return { ...started, corpse, at };
  };

  it('o cadáver RECÉM-abatido é `unmove` no Canary: a runa recusa `not-possible` até a cadeia decair', () => {
    const { session, hero, ruleset, corpse, at } = withCorpse();
    session.drainEvents();
    // 5 s depois da morte: o primeiro estágio ainda é `unmove`.
    run(session, 5_000);
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y)))
      .toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(hero.goldDelta).toBe(0);
    expect(ruleset.groundItems).toEqual([corpse]);
    expect(ownedBy(ruleset, 'hero')).toHaveLength(0);
  });

  it('depois da janela `unmove` a runa consome o cadáver e ergue o Skeleton como invocação do lançador', () => {
    const { session, hero, ruleset, corpse, at } = withCorpse();
    run(session, UNMOVABLE_MS + 500);
    session.drainEvents();
    expect(session.dueAtOf('corpse', String(corpse.id))).not.toBeNull();

    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y))).toEqual({ ok: true });

    // O cadáver SAIU (e o prazo dele junto — nada de `ground-item-vanished` duplicado depois).
    expect(ruleset.groundItems).toHaveLength(0);
    expect(session.dueAtOf('corpse', String(corpse.id))).toBeNull();
    // O Skeleton nasce NO tile do cadáver, sob o lançador, e a runa não custa mana (o script nunca
    // chama `addMana`) — só o gold.
    const [summon] = ownedBy(ruleset, 'hero');
    expect(summon?.monsterId).toBe('skeleton');
    expect({ x: summon?.position.x, y: summon?.position.y }).toEqual(at);
    expect(hero.mana).toBe(1_000);
    expect(hero.goldDelta).toBe(-375);

    const events = session.drainEvents();
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('supply-used');
    expect(events).toContainEqual({ kind: 'ground-item-vanished', itemId: corpse.id });
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'creature-appeared', monsterId: 'skeleton', masterId: 'hero',
    }));
    // `ground-item-vanished` antes de `creature-appeared`: o cadáver sai, e só então nasce a criatura.
    expect(kinds.indexOf('ground-item-vanished')).toBeLessThan(kinds.indexOf('creature-appeared'));
    // O cadáver não decai de novo mais tarde: nenhum segundo `ground-item-vanished`.
    expect(run(session, CORPSE_TTL_MS).filter((e) => e.kind === 'ground-item-vanished')).toHaveLength(0);
  });

  it('o loot que ainda estava no cadáver é DESTRUÍDO com ele (ADR 0048 d.5): não vai para o herói nem para o Skeleton', () => {
    // A bigorna que o `richVictim` larga pesa mais que a capacidade do herói: NÃO cabe e fica no cadáver.
    const { session, hero, ruleset } = start({
      spawnPoints: [spawnAt(3, 'rich-victim')], config: manualRune('animate-test'), attackPower: 1_000,
    });
    // O herói mata a vítima sozinho — é quem a credita, e por isso o loot é rolado.
    let corpse = ruleset.groundItems[0];
    for (let t = 0; t < 30_000 && corpse === undefined; t += 100) {
      session.advanceBy(100);
      corpse = ruleset.groundItems[0];
    }
    if (corpse === undefined) throw new Error('a vítima não morreu');
    expect(corpse.items?.map((item) => item.itemId)).toEqual(['anvil']);
    const at = { x: corpse.position.x, y: corpse.position.y };

    run(session, UNMOVABLE_MS + 1_000);
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y))).toEqual({ ok: true });

    expect(ruleset.groundItems).toHaveLength(0);
    // Não foi para lugar nenhum: o cadáver acabou, e nada chegou à mochila.
    expect(hero.inventory.getState().backpack).toEqual([]);
    expect(ruleset.openCorpse(session, 'hero', corpse.id)).toEqual({ ok: false, reason: 'not-found' });
    expect(ruleset.takeLoot(session, 'hero', corpse.id, null)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('recusa `not-possible` num tile sem cadáver, e num cadáver que nunca é movível', () => {
    const { session, hero, ruleset } = withCorpse();
    run(session, UNMOVABLE_MS + 500);
    // Um tile vazio da sala (o cadáver está em (5, 2)).
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(2, 3)))
      .toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(hero.goldDelta).toBe(0);

    const stuck = withCorpse({}, 'heavy');
    run(stuck.session, UNMOVABLE_MS + 500);
    expect(stuck.ruleset.useSlot(stuck.session, 'hero', 0, 0, aimAtTile(stuck.at.x, stuck.at.y)))
      .toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(stuck.ruleset.groundItems).toHaveLength(1);
  });

  it('recusa `too-many-summons` com duas invocações vivas, sem consumir o cadáver nem o gold', () => {
    const { session, hero, ruleset, at } = withCorpse({
      // Dois convencíveis para ocupar o teto (a Convince e a Animate Dead dividem o mesmo).
      spawnPoints: [spawnAt(4, 'victim'), spawnAt(2, 'convincible'), spawnAt(3, 'convincible')],
      config: botConfig([
        { do: { kind: 'supply', supplyId: 'animate-test' }, auto: false },
        { do: { kind: 'supply', supplyId: 'convince-test' }, auto: false },
      ]),
    });
    for (const summon of monstersOf(ruleset, 'convincible')) {
      expect(ruleset.useSlot(session, 'hero', 0, 1, aimAt(summon))).toEqual({ ok: true });
      session.advanceBy(1_100);
    }
    expect(ownedBy(ruleset, 'hero')).toHaveLength(2);
    run(session, UNMOVABLE_MS);
    const gold = hero.goldDelta;

    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y)))
      .toEqual({ ok: false, reason: 'too-many-summons', retryInMs: 0 });
    expect(ruleset.groundItems).toHaveLength(1);
    expect(hero.goldDelta).toBe(gold);
  });

  it('respeita o alcance da runa: cadáver além dele recusa `out-of-range`', () => {
    const { session, ruleset, at } = withCorpse({
      supplies: [convinceRune, { ...animateRune, effect: { kind: 'animate-dead', monsterId: 'skeleton', range: 1 } }],
    });
    run(session, UNMOVABLE_MS + 500);
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y)))
      .toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
    expect(ruleset.groundItems).toHaveLength(1);
  });

  it('a invocação que morre NUNCA deixa cadáver: sem isso o Skeleton animado seria animável de novo', () => {
    const { session, ruleset, at } = withCorpse();
    run(session, UNMOVABLE_MS + 500);
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y))).toEqual({ ok: true });
    const [summon] = ownedBy(ruleset, 'hero');
    if (summon === undefined) throw new Error('sem Skeleton');

    kill(session, summon);
    expect(ruleset.groundItems).toHaveLength(0);
  });

  it('o item do TOPO da pilha decide: um cadáver novo (ainda `unmove`) cobre o velho, que já era movível', () => {
    const { session, ruleset, corpse, at } = withCorpse({
      spawnPoints: [spawnAt(4, 'victim'), spawnAt(4, 'victim')],
    });
    run(session, UNMOVABLE_MS + 500);
    // O segundo `victim` nasce quando o primeiro sai do lugar do spawner: aqui ele já existe? Não —
    // o ponto 2 compartilha o tile, então nasceu num tile vizinho; leva-o para cima do cadáver.
    const second = monstersOf(ruleset, 'victim')[0];
    if (second === undefined) throw new Error('sem segunda vítima');
    Object.assign(second, { position: { x: at.x, y: at.y, z: MAP_Z }, home: { x: at.x, y: at.y, z: MAP_Z } });
    kill(session, second);
    expect(ruleset.groundItems).toHaveLength(2);

    // O de cima é recente: `unmove`. O de baixo, movível, NÃO conta — `getTopDownItem` olha um só.
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y)))
      .toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(ruleset.groundItems).toHaveLength(2);

    // Depois da janela do de cima, a runa consome ELE — e o velho continua lá.
    run(session, UNMOVABLE_MS + 500);
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y))).toEqual({ ok: true });
    expect(ruleset.groundItems.map((c) => c.id)).toEqual([corpse.id]);
  });

  it('o instante da janela sai da fila e sobrevive ao snapshot: retomar no meio dela não a reinicia', () => {
    const { session, ruleset, at, loaded } = withCorpse();
    run(session, 6_000);
    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed(snapshot.id),
    );
    const resumedRuleset = resumed.ruleset as HuntRuleset;
    // 6 s da morte: ainda `unmove`.
    expect(resumedRuleset.useSlot(resumed, 'hero', 0, 0, aimAtTile(at.x, at.y)))
      .toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    // 11 s da morte (6 + 5): já movível — a mesma conta que a sessão original faria.
    run(resumed, 5_000);
    expect(resumedRuleset.useSlot(resumed, 'hero', 0, 0, aimAtTile(at.x, at.y))).toEqual({ ok: true });
    expect(ruleset.groundItems).toHaveLength(1); // a original, sem tocar, ainda tem o dela.
  });

  it('o bot escolhe o cadáver animável mais próximo sozinho, e o resultado é o mesmo a 10 Hz e a 1 Hz', () => {
    const outcome = (stepMs: number) => {
      const { session, hero, ruleset } = start({
        spawnPoints: [spawnAt(2, 'victim'), spawnAt(5, 'victim')], config: autoRune('animate-test'),
      });
      session.advanceBy(100);
      for (const dead of monstersOf(ruleset, 'victim')) kill(session, dead);
      run(session, 30_000, stepMs);
      return {
        owned: ownedBy(ruleset, 'hero').map((m) => m.monsterId),
        gold: hero.goldDelta,
        corpses: ruleset.groundItems.length,
      };
    };
    const fast = outcome(100);
    expect(fast.owned).toEqual(['skeleton', 'skeleton']);
    // Duas runas (375 × 2): o teto de 2 pára o bot, e o gold só saiu duas vezes.
    expect(fast.gold).toBe(-750);
    expect(fast.corpses).toBe(0);
    expect(outcome(1_000)).toEqual(fast);
  });
});

// --- a invocação de jogador no CAMINHO e na ÁREA do mestre (revisão do #600) ---------------------
//
// As duas regras do mundo no-pvp (ADR 0060) que o #598 não precisava, porque o catálogo real ainda não
// tinha nenhuma invocação de jogador: o jogador ATRAVESSA a invocação (`Player::canWalkthrough`) e a área
// dele nunca a atinge (`Combat::canTargetCreature`).

/** Um corredor de UM tile de largura: nada contorna quem está no caminho, só passar por cima. */
const corridorMap = { id: 'field', z: MAP_Z, grid: ['#########', '#.......#', '#########'] };
const corridorRoute = ring([
  [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [6, 1], [5, 1], [4, 1], [3, 1], [2, 1],
]);
const corridor = { map: corridorMap, tiles: corridorRoute };

const heroMoves = (events: readonly DomainEvent[]) =>
  events.filter((e) => e.kind === 'creature-moved' && e.creatureId === 'hero');

describe('o jogador atravessa a invocação de jogador (`Player::canWalkthrough`, mundo no-pvp)', () => {
  it('o passo do herói para o tile da invocação troca os dois de lugar, e a ocupação não muda', () => {
    const { session, hero, ruleset, heroes } = start({
      spawnPoints: [spawnAt(1, 'convincible')], config: manualRune('convince-test'),
    });
    session.advanceBy(100);
    const pet = onlyMonster(ruleset, 'convincible');
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(pet))).toEqual({ ok: true });
    expect(heroes).toHaveLength(1);
    // A sala é de 7 × 3 e a invocação fica parada onde estava: o herói vem do tile vizinho dela.
    const from = { ...hero.position };
    const there = { ...pet.position };
    expect(Math.max(Math.abs(from.x - there.x), Math.abs(from.y - there.y))).toBe(1);
    session.drainEvents();

    expect(ruleset.requestMove(session, 'hero', { x: there.x, y: there.y }))
      .toMatchObject({ ok: true, from: { x: from.x, y: from.y }, to: { x: there.x, y: there.y } });

    expect({ x: hero.position.x, y: hero.position.y }).toEqual({ x: there.x, y: there.y });
    expect({ x: pet.position.x, y: pet.position.y }).toEqual({ x: from.x, y: from.y });
    expect(pet.alive).toBe(true);
    expect(pet.masterId).toBe('hero');
    // A apresentação vê as DUAS criaturas se mexerem, a do herói primeiro.
    const moved = session.drainEvents().filter((e) => e.kind === 'creature-moved');
    expect(moved.map((e) => e.kind === 'creature-moved' && e.creatureId)).toEqual(['hero', pet.subject]);
    // Os dois tiles continuam ocupados: um monstro hostil não entra em nenhum deles.
    const next = ruleset.requestMove(session, 'hero', { x: from.x, y: from.y });
    expect(next).toMatchObject({ ok: true });
    expect({ x: pet.position.x, y: pet.position.y }).toEqual({ x: there.x, y: there.y });
  });

  it('atravessa também a invocação de um companheiro de party, e só a de jogador: o monstro comum bloqueia', () => {
    const { session, ruleset, heroes } = start({
      spawnPoints: [spawnAt(1, 'convincible'), spawnAt(2, 'tough')], heroes: ['a', 'b'],
      config: manualRune('convince-test'),
    });
    session.advanceBy(100);
    const pet = onlyMonster(ruleset, 'convincible');
    const wall = onlyMonster(ruleset, 'tough');
    expect(ruleset.useSlot(session, 'a', 0, 0, aimAt(pet))).toEqual({ ok: true });
    const b = heroes[1];
    if (b === undefined) throw new Error('sem segundo herói');
    const apart = (target: MonsterRuntime) => Math.max(
      Math.abs(b.position.x - target.position.x), Math.abs(b.position.y - target.position.y),
    );
    // `b` entra ao lado da invocação de `a` (a sala é pequena e a partida da rota é a mesma).
    expect(apart(pet)).toBe(1);
    const beside = { x: b.position.x, y: b.position.y };
    const petAt = { x: pet.position.x, y: pet.position.y };

    expect(ruleset.requestMove(session, 'b', { x: petAt.x, y: petAt.y })).toMatchObject({ ok: true });
    expect({ x: b.position.x, y: b.position.y }).toEqual(petAt);
    expect({ x: pet.position.x, y: pet.position.y }).toEqual(beside);
    expect(pet.masterId).toBe('a');

    // Agora `b` está ao lado do monstro HOSTIL: esse não se atravessa.
    expect(apart(wall)).toBe(1);
    expect(ruleset.requestMove(session, 'b', { x: wall.position.x, y: wall.position.y }))
      .toEqual({ ok: false, reason: 'tile-occupied' });
  });

  /**
   * O corredor de UM tile, com a invocação parada na rota: a mesma hunt, sem a invocação, dá a volta no
   * corredor inteiro. A invocação (o convencido, ou o Skeleton erguido do cadáver) fica no caminho.
   */
  const lap = (stepMs: number, how: 'convince' | 'animate') => {
    const { session, hero, ruleset } = start({
      layout: corridor,
      // O ponto da vítima não renasce na janela do teste (uma hora): o herói é pacifista, e o monstro
      // hostil novo no meio do corredor o pararia por um motivo que não é o do teste.
      spawnPoints: [spawnAt(3, how === 'convince' ? 'convincible' : 'victim', 3_600_000)],
      config: manualRune(how === 'convince' ? 'convince-test' : 'animate-test'),
      seed: `lap-${how}`,
    });
    session.advanceBy(100);
    if (how === 'convince') {
      expect(ruleset.useSlot(session, 'hero', 0, 0, aimAt(onlyMonster(ruleset, 'convincible'))))
        .toEqual({ ok: true });
    } else {
      const dead = onlyMonster(ruleset, 'victim');
      const at = { x: dead.position.x, y: dead.position.y };
      kill(session, dead);
      // Um múltiplo dos DOIS passos (100 ms e 1 s): a runa sai no mesmo instante lógico nas duas taxas.
      run(session, UNMOVABLE_MS + 1_000, stepMs);
      expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y))).toEqual({ ok: true });
    }
    const pet = ownedBy(ruleset, 'hero')[0];
    if (pet === undefined) throw new Error('sem invocação');
    const events = run(session, 90_000, stepMs);
    const moves = heroMoves(events);
    return {
      moves: moves.length,
      farthest: Math.max(...moves.map((e) => (e.kind === 'creature-moved' ? e.to.x : 0))),
      hero: { x: hero.position.x, y: hero.position.y },
      pet: { x: pet.position.x, y: pet.position.y, alive: pet.alive, master: pet.masterId },
    };
  };

  it.each(['convince', 'animate'] as const)(
    'o herói NÃO trava na invocação (%s) em cima da rota de um corredor de um tile — 10 Hz e 1 Hz iguais',
    (how) => {
      const fast = lap(100, how);
      // Sem a travessia o herói parava no tile antes da invocação para sempre (2 ou 3 passos no
      // total): aqui ele dá a volta inteira, ida ao fim do corredor (x = 7) e volta, várias vezes.
      expect(fast.farthest).toBe(7);
      expect(fast.moves).toBeGreaterThan(60);
      expect(fast.pet).toMatchObject({ alive: true, master: 'hero' });
      expect(lap(1_000, how)).toEqual(fast);
    },
  );
});

describe('a área do mestre nunca atinge a invocação de jogador (`Combat::canTargetCreature`, mundo no-pvp)', () => {
  const fireRune = {
    id: 'fire-rune', name: 'Fire Rune', price: 10, group: 'attack', groupCooldownMs: 1_000,
    effect: {
      kind: 'damage', basePower: 400, range: 8, damageType: 'fire',
      area: { shape: 'circle', radius: 3, centered: 'target' },
    },
  };
  const singleRune = {
    id: 'single-rune', name: 'Single Rune', price: 10, group: 'attack', groupCooldownMs: 1_000,
    effect: { kind: 'damage', basePower: 400, range: 8, damageType: 'fire' },
  };
  const nova = {
    id: 'nova', name: 'Nova', manaCost: 10, cooldownMs: 1_000,
    effect: { kind: 'damage', basePower: 400, area: { shape: 'circle', radius: 3, centered: 'caster' }, damageType: 'fire' },
  };
  const config = botConfig([
    { do: { kind: 'supply', supplyId: 'convince-test' }, auto: false },
    { do: { kind: 'supply', supplyId: 'fire-rune' }, auto: false },
    { do: { kind: 'spell', spellId: 'nova' }, auto: false },
    { do: { kind: 'supply', supplyId: 'single-rune' }, auto: false },
  ]);

  /** O convencido (3, 1) ao lado do alvo hostil (4, 1), e o herói ainda na partida da rota. */
  const scene = () => {
    const started = start({
      spawnPoints: [spawnAt(2, 'convincible'), spawnAt(3, 'tough')], config, heroes: ['hero', 'friend'],
      supplies: [convinceRune, animateRune, fireRune, singleRune], spells: [nova],
    });
    started.session.advanceBy(100);
    const pet = onlyMonster(started.ruleset, 'convincible');
    const target = onlyMonster(started.ruleset, 'tough');
    expect(started.ruleset.useSlot(started.session, 'hero', 0, 0, aimAt(pet))).toEqual({ ok: true });
    expect(pet.masterId).toBe('hero');
    return { ...started, pet, target };
  };

  it('a runa em área centrada no alvo acerta o alvo e poupa a invocação ao lado dele', () => {
    const { session, ruleset, pet, target } = scene();
    const health = pet.health;
    expect(ruleset.useSlot(session, 'hero', 0, 1, aimAt(target))).toEqual({ ok: true });
    expect(target.health).toBeLessThan(1_000_000);
    expect(pet.health).toBe(health);
    expect(pet.alive).toBe(true);
  });

  it('a magia em área centrada no lançador também poupa a invocação', () => {
    const { session, ruleset, pet, target } = scene();
    const health = pet.health;
    expect(ruleset.useSlot(session, 'hero', 0, 2)).toEqual({ ok: true });
    expect(target.health).toBeLessThan(1_000_000);
    expect(pet.health).toBe(health);
    expect(pet.alive).toBe(true);
  });

  it('a invocação de um COMPANHEIRO também fica de fora da área, e a mira de dano nela é `no-target`', () => {
    const { session, ruleset, pet, target } = scene();
    const health = pet.health;
    // `friend` é outro personagem da party: a invocação é de `hero`, e a área dele não a acerta.
    expect(ruleset.useSlot(session, 'friend', 0, 1, aimAt(target))).toEqual({ ok: true });
    expect(target.health).toBeLessThan(1_000_000);
    expect(pet.health).toBe(health);

    session.advanceBy(1_100);
    // Clicar na invocação alheia com um efeito de dano: a mira é inválida, como no Canary.
    expect(ruleset.useSlot(session, 'friend', 0, 3, aimAt(pet)))
      .toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
    expect(pet.health).toBe(health);
    // E a do próprio mestre (o gate que já existia desde o #598).
    expect(ruleset.useSlot(session, 'hero', 0, 3, aimAt(pet)))
      .toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
    expect(pet.health).toBe(health);
  });
});

describe('Animate Dead num tile SÓLIDO (`rune:isBlocking(true)` → `RETURNVALUE_NOTENOUGHROOM`)', () => {
  const magicWall = {
    id: 'wall-rune', name: 'Magic Wall Rune', price: 45, group: 'attack', groupCooldownMs: 1_000,
    effect: {
      kind: 'field', range: 8,
      field: { id: 'wall-test', durationMs: 20_000, shape: { shape: 'point' }, blocksMovement: true },
    },
  };
  const config = botConfig([
    { do: { kind: 'supply', supplyId: 'animate-test' }, auto: false },
    { do: { kind: 'supply', supplyId: 'wall-rune' }, auto: false },
  ]);

  it('com um campo bloqueante em cima do cadáver a runa recusa, e nada é gasto — o cadáver fica', () => {
    const started = start({
      spawnPoints: [spawnAt(4, 'victim')], config, supplies: [convinceRune, animateRune, magicWall],
    });
    const { session, hero, ruleset } = started;
    session.advanceBy(100);
    const dead = onlyMonster(ruleset, 'victim');
    const at = { x: dead.position.x, y: dead.position.y };
    kill(session, dead);
    run(session, UNMOVABLE_MS + 500);
    expect(ruleset.useSlot(session, 'hero', 0, 1, aimAtTile(at.x, at.y))).toEqual({ ok: true });
    expect(ruleset.fields).toHaveLength(1);
    session.advanceBy(1_100);
    const gold = hero.goldDelta;

    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y)))
      .toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(ruleset.groundItems).toHaveLength(1);
    expect(ownedBy(ruleset, 'hero')).toHaveLength(0);
    expect(hero.goldDelta).toBe(gold);
    expect(hero.cooldowns.remainingMs('group:support', session.nowMs)).toBe(0);

    // O campo some (20 s): o tile volta a admitir, e a MESMA runa ergue o Skeleton NO tile do cadáver.
    run(session, 20_000);
    expect(ruleset.fields).toHaveLength(0);
    expect(ruleset.useSlot(session, 'hero', 0, 0, aimAtTile(at.x, at.y))).toEqual({ ok: true });
    const [summon] = ownedBy(ruleset, 'hero');
    expect({ x: summon?.position.x, y: summon?.position.y }).toEqual(at);
  });
});
