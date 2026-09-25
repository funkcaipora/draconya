// Como cada arma bate (#152, ADR 0026 decisões 3 e 4): o alcance é da arma, o bow atira a
// munição SELECIONADA da família (ou a básica) e debita o preço dela, a wand gasta mana e causa
// dano por faixa, e a skill certa sobe a cada uso. A arena é a mesma de `hunt.test.ts`, com o
// rato longe do começo da rota — é o que faz "alcança a 6 e não a 7" ser uma pergunta que dá
// para responder olhando.

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Content, Progression, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import type { InventoryState } from '../inventory.js';
import { statsForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import type { DomainEvent } from '../session.js';
import { Session } from '../session.js';
import { HuntRuleset, createHuntSession, huntRulesetFromSnapshot } from './hunt.js';

// A rota do herói são dois tiles lado a lado (y = 1); abaixo dela uma PAREDE (y = 2) e, atrás
// da parede, um bolsão vertical onde o rato é posto a `d` tiles do herói. A distância
// (Chebyshev) do rato aos dois tiles da rota é a mesma, e a parede impede o rato de vir até
// ele: o que alcança o rato é a ARMA, não onde cada um está. O rato NASCE do lado do herói (o
// spawn é na rota), leva o primeiro golpe em t = 0, e só então é posto no bolsão — por isso os
// testes comparam com a vida que ele tinha depois desse primeiro golpe.
const map = {
  id: 'corridor', z: 7,
  grid: ['####', '#..#', '####', '#..#', '#..#', '#..#', '#..#', '#..#', '#..#', '#..#', '####'],
};
const route = {
  id: 'corridor', mapId: 'corridor',
  tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
  spawnPoints: [{ routeIndex: 0, radius: 1 }],
};
// O rato é LENTO de propósito (`speed: 1` é um passo a cada 150 s pela fórmula do Tibia): depois
// do primeiro golpe ele quer vir atrás do herói, e com essa velocidade não sai do lugar em que o
// teste o pôs. Não bate: o teste mede o tiro, não a luta. Gold com chance zero: o que se conta
// aqui é o gold que SAI pela munição.
const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1,
  health: 1_000, experience: 5, attack: 0, armor: 0,
  attackIntervalMs: 2000, speed: 1, aggroRadius: 1, attackRange: 1,
  loot: { gold: { chance: 0, min: 1, max: 1 }, items: [] },
};
const hunt = {
  id: 'range', name: 'Range', recommendedLevel: 1, mapId: 'corridor', routeId: 'corridor',
  difficulties: {
    cautious: { monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 60_000 },
  },
};
const progression = {
  id: 'baseline', startingHealth: 1_000, startingMana: 10, startingCapacity: 1_000,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { healthPerSecond: 0, manaPerSecond: 1 },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessedReduction: 0.56, levelFloor: 8 },
  skillMultipliers: {},
};
const combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 }, minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 1000, attackRange: 1, armor: 0, dodgeChance: 0 },
};
const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const party = { id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 } };
const skills = [
  { id: 'melee', name: 'Melee', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'distance', name: 'Distance', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'distance-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'magic', name: 'Magic', startingLevel: 0, curve: { base: 4, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0 },
];
// As famílias de arma (CMB-05): a arma declara a sua, e a família aponta a skill e a prática.
const weaponFamilies = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'sword', name: 'Sword', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'axe', name: 'Axe', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'club', name: 'Club', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'distance', name: 'Distance', kind: 'distance', skillId: 'distance', range: 6, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'wand', name: 'Wand', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
  { id: 'rod', name: 'Rod', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
];
const items = [
  { id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand', weight: 1, value: 0, attack: 30 },
  { id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 1, value: 0, twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } },
  { id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 1, value: 0, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 10, max: 10 } } },
  { id: 'staff', name: 'Staff', kind: 'weapon', slot: 'hand', weight: 1, value: 0, requires: { vocationId: 'sorcerer' }, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 100, max: 100 } } },
  { id: 'shield', name: 'Shield', kind: 'shield', slot: 'shield', weight: 1, value: 0 },
];
// A munição é ABSTRATA (ADR 0026 d.3): sem item, sem pilha, sem peso. Cada tiro debita o preço.
const ammunition = [
  { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 20, price: 1 },
  { id: 'onyx-arrow', name: 'Onyx Arrow', family: 'arrow', attack: 40, price: 7, requires: { level: 1 } },
  { id: 'sniper-arrow', name: 'Sniper Arrow', family: 'arrow', attack: 30, price: 5, requires: { level: 20 } },
  { id: 'bolt', name: 'Bolt', family: 'bolt', attack: 30, price: 2 },
];

const raw = (over: Partial<RawContent> = {}): RawContent => {
  const base: RawContent = {
    monsters: [rat], hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
    stamina: [stamina], party: [party], spells: [], skills, weaponFamilies,
    items, ammunition,
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map], routes: [route], ...over,
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};
const content = (): Content => buildContent(raw());

const armed = (itemId: string): InventoryState => ({
  backpack: [], equipped: { hand: { instanceId: `i-${itemId}`, itemId, quantity: 1 } },
});

type AmmoSelection = Readonly<Partial<Record<'arrow' | 'bolt', string>>>;

function start(options: {
  inventory?: InventoryState; gold?: number; mana?: number; ammo?: AmmoSelection;
} = {}) {
  const loaded = content();
  const session = createHuntSession({
    id: 'session-1', content: loaded, huntId: 'range', difficulty: 'cautious', createdAtMs: 0,
  });
  const stats = statsForLevel(1, null, progression as Progression);
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: stats.maxHealth, maxHealth: stats.maxHealth,
    mana: options.mana ?? stats.maxMana, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: options.gold ?? 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    ...(options.inventory === undefined ? {} : { inventory: options.inventory }),
    ...(options.ammo === undefined ? {} : { ammo: options.ammo }),
  });
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset, loaded };
}

/** Avança até `durationMs` em passos de `stepMs`, drenando os eventos de domínio. */
function run(session: Session, durationMs: number, stepMs: number): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) {
    session.advanceBy(stepMs);
    events.push(...session.drainEvents());
  }
  return events;
}

/** Põe o rato no bolsão, a `distance` tiles da rota: o teste decide a distância, não o spawn. */
function ratAt(ruleset: HuntRuleset, distance: number) {
  const monster = ruleset.monsters[0];
  if (monster === undefined) throw new Error('sem rato');
  monster.position = { x: 1, y: 1 + distance };
  return monster;
}

describe('o alcance é da arma (#152)', () => {
  it('a espada bate a 1 tile; a 2 não', () => {
    const { session, ruleset } = start({ inventory: armed('sword') });
    session.advanceBy(50);
    const rat = ratAt(ruleset, 2);
    const h0 = rat.health;
    run(session, 3_000, 100);
    expect(rat.health).toBe(h0);
    // De volta ao lado do herói: o outro tile da rota é adjacente aos dois.
    rat.position = { x: 2, y: 1 };
    run(session, 3_000, 100);
    expect(rat.health).toBeLessThan(h0);
  });

  it('o bow alcança a 6 tiles e não a 7', () => {
    const { session, ruleset } = start({
      inventory: armed('bow'), gold: 100, ammo: { arrow: 'arrow' },
    });
    session.advanceBy(50);
    const rat = ratAt(ruleset, 7);
    const h0 = rat.health;
    run(session, 3_000, 100);
    expect(rat.health).toBe(h0);
    rat.position = { x: 1, y: 7 };
    run(session, 3_000, 100);
    expect(rat.health).toBeLessThan(h0);
  });

  it('a wand alcança a 3 tiles e não a 4', () => {
    const { session, ruleset } = start({ inventory: armed('wand') });
    session.advanceBy(50);
    const rat = ratAt(ruleset, 4);
    const h0 = rat.health;
    run(session, 3_000, 100);
    expect(rat.health).toBe(h0);
    rat.position = { x: 1, y: 4 };
    run(session, 3_000, 100);
    expect(rat.health).toBeLessThan(h0);
  });
});

describe('o bow atira a munição abstrata e debita o preço no tiro (#152, ADR 0026 d.3)', () => {
  it('cada tiro debita o `price` da munição selecionada no personagem E no agregado (RF-01)', () => {
    const { session, hero } = start({
      inventory: armed('bow'), gold: 100, ammo: { arrow: 'arrow' },
    });
    // O rato nasce ao lado do herói: o tiro de t = 0 acontece neste primeiro avanço.
    session.advanceBy(50);
    expect(hero.goldDelta).toBe(-1);
    expect(session.aggregates.goldSpent).toBe(1);
  });

  it('sem gold para a munição, o tiro NÃO sai: sem shot, sem dano, sem fallback (RF-03)', () => {
    const { session, ruleset } = start({
      inventory: armed('bow'), gold: 0, ammo: { arrow: 'arrow' },
    });
    session.advanceBy(50);
    const rat = ratAt(ruleset, 3);
    const h0 = rat.health;
    const events = run(session, 3_000, 50);
    expect(events.filter((e) => e.kind === 'shot')).toHaveLength(0);
    expect(rat.health).toBe(h0);
    // Não existe munição grátis (ADR 0026 d.3): não há evento de fallback para registrar.
    expect(session.notableEvents.filter((e) => e.type === 'ammo-fallback')).toHaveLength(0);
  });

  it('a seleção da FAMÍLIA manda: onyx-arrow dá o `attack` dela (RF-04)', () => {
    const { session, ruleset } = start({
      inventory: armed('bow'), gold: 100, ammo: { arrow: 'onyx-arrow' },
    });
    session.advanceBy(50);
    const rat = ruleset.monsters[0];
    if (rat === undefined) throw new Error('sem rato');
    // The bow has no attack of its own: the base comes from the selected ammunition (40).
    expect(rat.health).toBe(960);
  });

  it('sem seleção, usa a munição BÁSICA da família: o dano é o da arrow (RF-04)', () => {
    const { session, ruleset } = start({ inventory: armed('bow'), gold: 100 });
    session.advanceBy(50);
    const rat = ruleset.monsters[0];
    if (rat === undefined) throw new Error('sem rato');
    expect(rat.health).toBe(980);
  });

  it('a seleção de OUTRA família não arma o bow: cai na básica arrow', () => {
    const { session, ruleset } = start({
      inventory: armed('bow'), gold: 100, ammo: { bolt: 'bolt' },
    });
    session.advanceBy(50);
    const rat = ruleset.monsters[0];
    if (rat === undefined) throw new Error('sem rato');
    // A `bolt` selecionada é de `bolt`; o bow dispara `arrow`, então usa a básica (attack 20).
    expect(rat.health).toBe(980);
  });

  it('a skill de distância sobe por tiro, e a corpo a corpo não', () => {
    const { session, hero, ruleset, loaded } = start({
      inventory: armed('bow'), gold: 100, ammo: { arrow: 'arrow' },
    });
    session.advanceBy(50);
    ratAt(ruleset, 3);
    run(session, 4_050, 50);
    const distance = loaded.skills.get('distance');
    const melee = loaded.skills.get('melee');
    if (distance === undefined || melee === undefined) throw new Error('skills');
    // Curva de base 2: cinco tiros (t = 0 a 4 s) são dois níveis e um ponto sobrando.
    expect(hero.skills.levelOf(distance)).toBe(12);
    expect(hero.skills.levelOf(melee)).toBe(10);
  });
});

describe('a seleção de munição sobrevive ao snapshot (#152)', () => {
  it('a escolha viaja no personagem e volta na retomada', () => {
    const { session, hero, loaded } = start({
      inventory: armed('bow'), gold: 100, ammo: { arrow: 'onyx-arrow' },
    });
    expect(hero.getState().ammo).toEqual({ arrow: 'onyx-arrow' });
    session.advanceBy(50);
    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed('resume'),
    );
    const restored = resumed.participants[0] as CharacterRuntime;
    expect(restored.ammo.get('arrow')).toBe('onyx-arrow');
  });
});

describe('a wand gasta mana e causa dano por faixa (#152)', () => {
  it('cada golpe custa manaPerHit, para quando a mana acaba, e volta quando ela regenera', () => {
    const { session, hero, ruleset } = start({ inventory: armed('wand'), mana: 5 });
    session.advanceBy(50);
    const rat = ratAt(ruleset, 2);
    const h0 = rat.health;
    // 5 de mana, 2 por golpe, 1 de regeneração por segundo, um golpe por segundo: em dez
    // segundos a mana paga SEIS golpes (60), não os dez que o intervalo daria (100) — e mais
    // que os dois que a mana inicial pagaria sozinha: ele parou, e voltou quando a mana voltou.
    run(session, 10_000, 50);
    expect(h0 - rat.health).toBeGreaterThanOrEqual(50);
    expect(h0 - rat.health).toBeLessThanOrEqual(70);
    expect(hero.mana).toBeLessThan(2);
  });

  it('rende magia pela mana gasta, e não corpo a corpo', () => {
    const { session, hero, ruleset, loaded } = start({ inventory: armed('wand'), mana: 10 });
    session.advanceBy(50);
    ratAt(ruleset, 2);
    run(session, 4_050, 50);
    const magic = loaded.skills.get('magic');
    const melee = loaded.skills.get('melee');
    if (magic === undefined || melee === undefined) throw new Error('skills');
    // Curva de base 4 e 2 de mana por golpe: cinco golpes (t = 0 a 4 s) são dez pontos, dois
    // níveis e meio — e a mana de 10 mais a regeneração pagam os cinco.
    expect(hero.skills.levelOf(magic)).toBe(2);
    expect(hero.skills.levelOf(melee)).toBe(10);
  });
});

describe('a arma que o personagem não pode usar não bate por ele (#152)', () => {
  it('wand de vocação na mão de quem não tem vocação cai no desarmado: sem tiro, sem mana, punho', () => {
    // `equip` recusa `wrong-vocation`, mas um snapshot anterior à regra traz a arma na mão
    // por `fromState`. Ela conta como mão vazia: alcance 1, ataque do desarmado (25), nenhum
    // `shot`, nenhuma mana gasta — e não uma wand de 100 de dano por golpe.
    const { session, hero, ruleset } = start({ inventory: armed('staff') });
    session.advanceBy(50);
    const far = ratAt(ruleset, 2);
    const h0 = far.health;
    run(session, 2_000, 100);
    expect(far.health).toBe(h0);

    far.position = { x: 1, y: 2 };
    const events = run(session, 3_000, 100);
    expect(events.filter((e) => e.kind === 'shot')).toHaveLength(0);
    expect(hero.mana).toBe(hero.maxMana);
    expect(h0 - far.health).toBeGreaterThan(0);
    expect(h0 - far.health).toBeLessThan(100);
  });
});

describe('equivalência entre taxas com munição e arma na mão (#152, ADR 0020)', () => {
  it('1 Hz == 10 Hz: o bow debita o MESMO gold por tiro, e a wand a mesma mana', () => {
    const cases = [
      { inventory: armed('bow'), ammo: { arrow: 'arrow' } as AmmoSelection },
      { inventory: armed('wand'), ammo: undefined },
    ];
    for (const c of cases) {
      const fast = start({ inventory: c.inventory, mana: 10, gold: 100, ...(c.ammo === undefined ? {} : { ammo: c.ammo }) });
      const slow = start({ inventory: c.inventory, mana: 10, gold: 100, ...(c.ammo === undefined ? {} : { ammo: c.ammo }) });
      fast.session.advanceBy(50); slow.session.advanceBy(50);
      ratAt(fast.ruleset, 2); ratAt(slow.ruleset, 2);
      run(fast.session, 10_000, 100);
      run(slow.session, 10_000, 1_000);
      expect(fast.ruleset.monsters[0]?.health).toBe(slow.ruleset.monsters[0]?.health);
      expect(fast.hero.goldDelta).toBe(slow.hero.goldDelta);
      expect(fast.hero.mana).toBe(slow.hero.mana);
    }
  });
});