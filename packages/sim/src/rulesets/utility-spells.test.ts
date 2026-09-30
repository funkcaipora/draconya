// As magias utilitárias no ruleset da hunt (#623, M44-05): Light/Great/Ultimate Light, Levitate,
// Magic Rope, Find Person/Fiend e Food — disparadas pelo caminho REAL do jogador (`useSlot`), com
// o conteúdo montado por `buildContent`. As regras puras (bússola, sonda, pouso) têm tabela própria
// em `../utility-spells.test.ts`; aqui se prova o que só a sessão dá: custo, cooldown, evento,
// ocupação, stairhop e a ordem das recusas do Canary (requisito → destino → mana).

import { BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema, botSlotSchema, buildContent, placeholderAppearances } from '@draconya/content';
import type { BotConfigV2, BotSlot, Content, Progression, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { statsForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import { Session } from '../session.js';
import type { DomainEvent, SessionSnapshot } from '../session.js';
import { createHuntSession, huntRulesetFromSnapshot } from './hunt.js';
import type { HuntRuleset } from './hunt.js';

// --- fixtures -------------------------------------------------------------------------------

const progression = {
  id: 'baseline', startingHealth: 500, startingMana: 500, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  // Regeneração ZERADA: a mana que sobra depois de uma magia é o custo, não "o custo mais o que
  // regenerou" — um teste de custo que ninguém consegue conferir a olho é um teste que ninguém
  // confia (o mesmo argumento de `withSpells` em `hunt.test.ts`).
  regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.56, promotionReduction: 0.3 },
  skillMultipliers: {},
};

const combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: {
    physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0,
    manadrain: 0, arcane: 0,
  },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 0, dodgeChance: 0 },
};

/** O `combat-v3` do stairhop (o mesmo do #554): sem ele o salto não trava o ataque. */
const combatV3 = {
  ...combat, compatibilityProfile: 'combat-v3',
  weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
  distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
  stairhopDelayMs: 2_000,
};

const skills = [
  {
    id: 'melee', name: 'Corpo a Corpo', startingLevel: 10,
    curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5,
  },
  {
    id: 'magic', name: 'Magia', startingLevel: 0,
    curve: { base: 100, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0,
  },
];

const weaponFamilies = [
  {
    id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical',
    resource: 'none', formula: { levelFactor: 0, spread: 0 },
  },
];

/** As sete comidas do Canary, na ORDEM do `food.lua` — o índice do sorteio é a posição. */
const FOODS = ['meat', 'ham', 'grapes', 'red-apple', 'bread', 'roll', 'cheese'] as const;
const foodItem = (id: string, durationMs: number) => ({
  id, name: id, kind: 'consumable', weight: 2, value: 0, stackable: true,
  effect: { kind: 'food', durationMs },
});
const items = FOODS.map((id, index) => foodItem(id, (index + 1) * 12_000));

const support = { group: 'support', groupCooldownMs: 2_000, cooldownMs: 2_000 } as const;
const spells = [
  {
    id: 'light', name: 'Light', minLevel: 1, manaCost: 20, ...support,
    effect: { kind: 'light', level: 6, color: 215, durationMs: 370_000 },
  },
  {
    id: 'great-light', name: 'Great Light', minLevel: 1, manaCost: 60, ...support,
    effect: { kind: 'light', level: 8, color: 215, durationMs: 695_000 },
  },
  {
    id: 'levitate-up', name: 'Levitate (up)', minLevel: 12, manaCost: 50, ...support,
    effect: { kind: 'levitate', direction: 'up' },
  },
  {
    id: 'levitate-down', name: 'Levitate (down)', minLevel: 1, manaCost: 50, ...support,
    effect: { kind: 'levitate', direction: 'down' },
  },
  {
    id: 'magic-rope', name: 'Magic Rope', minLevel: 1, manaCost: 20, ...support,
    effect: { kind: 'magic-rope' },
  },
  {
    id: 'find-person', name: 'Find Person', minLevel: 1, manaCost: 20, ...support,
    effect: { kind: 'find', target: 'person' },
  },
  {
    id: 'find-fiend', name: 'Find Fiend', minLevel: 1, manaCost: 20, ...support,
    effect: { kind: 'find', target: 'fiend' },
  },
  {
    id: 'food', name: 'Food', minLevel: 1, manaCost: 120, soulCost: 1, ...support,
    effect: { kind: 'food', items: [...FOODS] },
  },
];

const hunt = {
  id: 'lift', name: 'Lift', recommendedLevel: 1, mapId: 'lift', routeId: 'lift-loop',
};

/** Uma sala 4×3 (`#` em volta) — o interior é (1..4, 1..3). */
const ROOM = ['######', '#....#', '#....#', '#....#', '######'];

interface World {
  /** Andar → grade. O andar de `z` é o padrão do mapa e onde a rota começa. */
  readonly floors: Readonly<Record<number, readonly string[]>>;
  readonly z: number;
  /** Onde o herói entra (o primeiro tile da rota) e o tile vizinho que fecha o laço. */
  readonly start: { readonly x: number; readonly y: number };
  readonly interactables?: readonly object[];
  readonly floorChanges?: readonly object[];
  /** A rota (laço fechado, todos os tiles andáveis). Ausente: o bloco 2×2 a partir de `start`. */
  readonly route?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

/** O conteúdo de um mundo de teste: um mapa multiandar, uma rota de dois tiles e nenhum monstro. */
function contentOf(world: World, over: Partial<RawContent> = {}): Content {
  const { x, y } = world.start;
  const map = {
    id: 'lift', z: world.z,
    floors: Object.fromEntries(Object.entries(world.floors).map(([z, grid]) => [z, { grid }])),
    ...(world.floorChanges === undefined ? {} : { floorChanges: world.floorChanges }),
    ...(world.interactables === undefined ? {} : { interactables: world.interactables }),
  };
  // Rota de quatro tiles em volta de `start` — o herói só precisa nascer em `start`, e o laço
  // precisa fechar (`validateRoute`). Nenhum teste aqui avança o relógio até o walker andar.
  const tiles = world.route ?? [{ x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 }];
  const route = {
    id: 'lift-loop', mapId: 'lift',
    tiles: tiles.map((tile) => ({ ...tile, z: world.z })),
    spawnPoints: [],
  };
  const base: RawContent = {
    monsters: [], hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
    stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
    party: [{ id: 'baseline', maxMembers: 4 }], spells, skills, weaponFamilies, items,
    supplies: [], ammunition: [],
    bot: [{
      id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
    }],
    maps: [map], routes: [route], ...over,
  };
  return buildContent({ appearances: [placeholderAppearances(base)], ...base });
}

const slotOf = (spellId: string, over: Partial<BotSlot> = {}) => ({
  do: { kind: 'spell' as const, spellId }, ...over,
});

/** Um conjunto v2 com os slots dados na frente: o slot N do teste é o N-ésimo. */
const configOf = (...spellIds: readonly string[]): BotConfigV2 => botConfigV2Schema.parse({
  version: BOT_VOCABULARY_VERSION, activeSet: 0,
  sets: [0, 1, 2, 3].map((set) => ({
    slots: Array.from({ length: BOT_SLOTS_PER_SET }, (_, slot) => {
      const spellId = set === 0 ? spellIds[slot] : undefined;
      // `auto: false`: o slot é MANUAL — o bot recastaria a luz e a comida a cada cooldown, e o
      // teste mede o disparo do jogador, não a automação.
      return spellId === undefined ? null : botSlotSchema.parse(slotOf(spellId, { auto: false }));
    }),
  })),
});

interface Started {
  readonly session: ReturnType<typeof createHuntSession>;
  readonly hero: CharacterRuntime;
  readonly ruleset: HuntRuleset;
  readonly events: () => readonly DomainEvent[];
}

interface StartOptions {
  readonly level?: number; readonly mana?: number; readonly soul?: number; readonly capacity?: number;
  readonly facing?: 'north' | 'south' | 'east' | 'west';
  readonly spellIds?: readonly string[];
}

function start(loaded: Content, options: StartOptions = {}): Started {
  const session = createHuntSession({
    id: 'utility-session', content: loaded, huntId: 'lift', difficulty: 'cautious', createdAtMs: 0,
    botConfig: configOf(...(options.spellIds ?? spells.map((spell) => spell.id))),
  });
  const stats = statsForLevel(1, null, loaded.progression as Progression);
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 }, health: stats.maxHealth, maxHealth: stats.maxHealth,
    mana: options.mana ?? 500, maxMana: 500, level: options.level ?? 20, xp: 0, vocationId: null,
    staminaMs: 86_400_000, staminaUpdatedAtMs: 0, gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    capacity: options.capacity ?? 1_000, soul: options.soul ?? 5,
  });
  session.enter(hero);
  if (options.facing !== undefined) hero.direction = options.facing;
  const seen: DomainEvent[] = [];
  return {
    session, hero, ruleset: session.ruleset as HuntRuleset,
    events: () => { seen.push(...session.drainEvents()); return seen; },
  };
}

/** Dispara o slot do MESMO índice que `spellIds` deu — o caminho manual do jogador. */
const cast = (run: Started, spellId: string, target?: Parameters<HuntRuleset['useSlot']>[4]) =>
  run.ruleset.useSlot(run.session, 'hero', 0, spells.findIndex((spell) => spell.id === spellId), target);

/** O cooldown da magia está rodando? (`remainingMs` no relógio lógico da sessão.) */
const cooldownOf = (run: Started, spellId: string): number =>
  run.hero.cooldowns.remainingMs(`spell:${spellId}`, run.session.nowMs);

// --- Light ----------------------------------------------------------------------------------

describe('Light, Great Light e Ultimate Light — a condição de luz (#623)', () => {
  const world: World = { floors: { 8: ROOM }, z: 8, start: { x: 1, y: 1 } };

  it('lança a luz: paga a mana, guarda nível/cor/prazo e a condição vence na fila', () => {
    const run = start(contentOf(world));
    expect(cast(run, 'light')).toEqual({ ok: true });

    expect(run.hero.mana).toBe(480);
    const condition = run.hero.conditions.get('light');
    expect(condition).toMatchObject({
      key: 'light', spellId: 'light', expiresAtMs: 370_000,
      light: { level: 6, color: 215, durationMs: 370_000 },
    });
    // Vence pelo evento da fila (invariante 2), no instante EXATO — não um tique antes nem depois.
    run.session.advanceBy(369_999);
    expect(run.hero.conditions.get('light')).not.toBeNull();
    run.session.advanceBy(1);
    expect(run.hero.conditions.get('light')).toBeNull();
  });

  it('uma luz de prazo MAIS CURTO não substitui a que ainda dura mais — e gasta a mana (updateCondition)', () => {
    const run = start(contentOf(world));
    expect(cast(run, 'great-light')).toEqual({ ok: true });
    run.session.advanceBy(2_000); // passa o cooldown de 2 s

    // O Light dura 370 s; o Great Light lançado antes ainda tem 693 s: o Canary NÃO troca.
    expect(cast(run, 'light')).toEqual({ ok: true });
    expect(run.hero.mana).toBe(500 - 60 - 20);
    expect(run.hero.conditions.get('light')).toMatchObject({
      spellId: 'great-light', expiresAtMs: 695_000, light: { level: 8, durationMs: 695_000 },
    });
  });

  it('uma luz de prazo MAIOR renova por inteiro: nível, cor e total novos', () => {
    const run = start(contentOf(world));
    expect(cast(run, 'light')).toEqual({ ok: true });
    run.session.advanceBy(2_000);
    expect(cast(run, 'great-light')).toEqual({ ok: true });
    expect(run.hero.conditions.get('light')).toMatchObject({
      spellId: 'great-light', expiresAtMs: 2_000 + 695_000, light: { level: 8, durationMs: 695_000 },
    });
    // O vencimento ANTIGO (370 s) não apaga a luz nova — o evento velho foi cancelado ao renovar.
    run.session.advanceBy(370_000);
    expect(run.hero.conditions.get('light')).not.toBeNull();
  });

  it('sem level, recusa e não gasta nada; nunca lança se a mana não cobre', () => {
    const run = start(contentOf(world), { mana: 10 });
    expect(cast(run, 'light')).toEqual({ ok: false, reason: 'not-enough-mana', retryInMs: 0 });
    expect(run.hero.conditions.get('light')).toBeNull();
    expect(cooldownOf(run, 'light')).toBe(0);
  });

  it('a luz é só apresentação: o mesmo mundo, com e sem luz, rende o mesmo estado (invariante 3)', () => {
    const runWith = (lit: boolean) => {
      const run = start(contentOf(world));
      if (lit) cast(run, 'light');
      run.session.advanceBy(60_000);
      return { health: run.hero.health, position: run.hero.position, xp: run.hero.xp };
    };
    expect(runWith(true)).toEqual(runWith(false));
  });
});

// --- Levitate -------------------------------------------------------------------------------

describe('Levitate — sobe e desce um andar pelas regras de tile (#623)', () => {
  // O herói está em (2,2). Andar 8: a sonda de cima (2,2) é PAREDE (`#`, "vazio" para o mapa) e o
  // tile da frente a leste (3,2) é chão livre — o pouso do `up`. Andar 9: o herói e o pouso do
  // `down` (3,2) livre, com a sonda da frente — o mesmo (3,2) DO ANDAR DO HERÓI — vazia.
  const UPPER = ['######', '#....#', '#.#..#', '#....#', '######'];
  const LOWER = ['######', '#....#', '#....#', '#....#', '######'];
  const world: World = { floors: { 8: UPPER, 9: LOWER }, z: 9, start: { x: 2, y: 2 } };

  it('levitate-up: sobe para o tile da frente um andar acima, paga a mana, inicia o cooldown', () => {
    const run = start(contentOf(world), { facing: 'east' });
    const moves = () => run.events().filter((event) => event.kind === 'creature-moved');
    expect(cast(run, 'levitate-up')).toEqual({ ok: true });

    expect(run.hero.position).toEqual({ x: 3, y: 2, z: 8 });
    expect(run.hero.mana).toBe(450);
    expect(cooldownOf(run, 'levitate-up')).toBe(2_000);
    // A direção NÃO muda (`creature:move` do Canary não passa direção) e o passo sai como evento.
    expect(run.hero.direction).toBe('east');
    expect(moves()).toEqual([expect.objectContaining({
      creatureId: 'hero', from: { x: 2, y: 2, z: 9 }, to: { x: 3, y: 2, z: 8 },
    })]);
  });

  it('a ocupação acompanha o salto: o tile de origem fica livre (quem entra depois pode ocupá-lo)', () => {
    const run = start(contentOf(world), { facing: 'east' });
    cast(run, 'levitate-up');
    // Um segundo personagem entra no primeiro tile da rota, o (2,2,9) de onde o herói saiu: se
    // a origem ficasse ocupada (um fantasma), `placeNear` o poria num vizinho.
    const other = new CharacterRuntime({ ...run.hero.getState(), id: 'other', cooldowns: {} });
    run.session.enter(other);
    expect(other.position).toEqual({ x: 2, y: 2, z: 9 });
    // E o tile de CHEGADA está ocupado pelo herói: um Levitate-up do outro para o MESMO tile
    // recusa — o destino ocupado é destino inválido (tile é exclusivo neste motor).
    other.direction = 'east';
    other.mana = 500;
    run.ruleset.configureBot(run.session, configOf(...spells.map((spell) => spell.id)), 'other');
    const index = spells.findIndex((spell) => spell.id === 'levitate-up');
    expect(run.ruleset.useSlot(run.session, 'other', 0, index))
      .toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(other.mana).toBe(500);
  });

  it('levitate-down: desce para o tile da frente um andar abaixo quando não há chão na frente', () => {
    // Andar 9 (o do herói): o tile da frente a leste é PAREDE ("sem chão" para o mapa); andar 10
    // (embaixo) tem o pouso livre.
    const ledge: World = {
      floors: { 9: ['######', '#..#.#', '#....#', '#....#', '######'], 10: LOWER }, z: 9,
      start: { x: 2, y: 1 }, route: [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }],
    };
    const run = start(contentOf(ledge), { facing: 'east' });
    expect(cast(run, 'levitate-down')).toEqual({ ok: true });
    expect(run.hero.position).toEqual({ x: 3, y: 1, z: 10 });
    expect(run.hero.mana).toBe(450);
  });

  it('recusa SEM custo e SEM cooldown quando a sonda tem chão (o Canary: "not possible")', () => {
    // Andar 8 com o tile de cima livre: quem levita para cima precisa de espaço vazio.
    const covered = { floors: { 8: LOWER, 9: LOWER }, z: 9, start: { x: 2, y: 2 } };
    const run = start(contentOf(covered), { facing: 'east' });
    expect(cast(run, 'levitate-up')).toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(run.hero.position).toEqual({ x: 2, y: 2, z: 9 });
    expect(run.hero.mana).toBe(500);
    expect(cooldownOf(run, 'levitate-up')).toBe(0);
  });

  it('a fronteira de andar: `up` recusa em z=8 e `down` recusa em z=7', () => {
    const boundaryUp: World = { floors: { 7: UPPER, 8: LOWER }, z: 8, start: { x: 2, y: 2 } };
    const up = start(contentOf(boundaryUp), { facing: 'east' });
    expect(cast(up, 'levitate-up')).toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });

    const boundaryDown: World = {
      floors: { 7: ['######', '#..#.#', '#....#', '#....#', '######'], 8: LOWER }, z: 7,
      start: { x: 2, y: 1 }, route: [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }],
    };
    const down = start(contentOf(boundaryDown), { facing: 'east' });
    expect(cast(down, 'levitate-down')).toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
  });

  it('o destino com escada (troca de andar) e o destino ocupado recusam', () => {
    const stairs = { ...world, floorChanges: [{ from: { x: 3, y: 2, z: 8 }, to: { x: 3, y: 2, z: 9 } }] };
    const run = start(contentOf(stairs), { facing: 'east' });
    expect(cast(run, 'levitate-up')).toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
  });

  it('a ordem do Canary: o requisito (level) vem ANTES do destino', () => {
    const covered = { floors: { 8: LOWER, 9: LOWER }, z: 9, start: { x: 2, y: 2 } };
    // Level 1 < 12 E sem destino: o Canary confere o level primeiro (`Spell::playerCastSpell`).
    const run = start(contentOf(covered), { facing: 'east', level: 1 });
    expect(cast(run, 'levitate-up')).toEqual({ ok: false, reason: 'not-in-catalog', retryInMs: 0 });
  });

  it('o slotStates espelha a recusa do destino (DT-08): blocked com o MESMO motivo', () => {
    const covered = { floors: { 8: LOWER, 9: LOWER }, z: 9, start: { x: 2, y: 2 } };
    const run = start(contentOf(covered), { facing: 'east' });
    const index = spells.findIndex((spell) => spell.id === 'levitate-up');
    expect(run.ruleset.slotStates(run.session, run.hero)[index])
      .toMatchObject({ state: 'blocked', reason: 'not-possible' });
    // E o que ele promete acontece igual: a mesma recusa, do outro caminho.
    expect(cast(run, 'levitate-up')).toMatchObject({ ok: false, reason: 'not-possible' });
  });

  it('o salto tranca o ataque por `stairhopDelayMs` sob o combat-v3 (`teleport || oldPos.z != newPos.z`)', () => {
    const run = start(contentOf(world, { combat: [combatV3] }), { facing: 'east' });
    expect(run.hero.attackLockedUntil).toBe(0);
    cast(run, 'levitate-up');
    expect(run.hero.attackLockedUntil).toBe(2_000);
  });

  it('sob combat-v1/v2 o salto não trava nada (ausente é identidade)', () => {
    const run = start(contentOf(world), { facing: 'east' });
    cast(run, 'levitate-up');
    expect(run.hero.attackLockedUntil).toBe(0);
  });
});

// --- Magic Rope -----------------------------------------------------------------------------

describe('Magic Rope — sobe pelo rope spot (#623)', () => {
  const ropeSpot = (x: number, y: number, z: number) => ({
    at: { x, y, z }, kind: 'rope-spot', initialState: 'default', appearanceKey: 'rope-1',
  });
  const UP = ['######', '#....#', '#....#', '#....#', '######'];
  const HERE = ['######', '#....#', '#....#', '#....#', '######'];
  const world = (upper: readonly string[]): World => ({
    floors: { 8: upper, 9: HERE }, z: 9, start: { x: 2, y: 2 },
    interactables: [ropeSpot(2, 2, 9)],
  });

  it('sobe para o tile ao SUL do rope spot no andar de cima, paga a mana e inicia o cooldown', () => {
    const run = start(contentOf(world(UP)));
    expect(cast(run, 'magic-rope')).toEqual({ ok: true });
    expect(run.hero.position).toEqual({ x: 2, y: 3, z: 8 });
    expect(run.hero.mana).toBe(480);
    expect(cooldownOf(run, 'magic-rope')).toBe(2_000);
  });

  it('sem o tile sul andável, procura na ordem do moveUpstairs: norte, leste, oeste, sudoeste…', () => {
    // Sul (2,3) fechado → norte (2,1).
    const northFirst = start(contentOf(world(['######', '#....#', '#....#', '#.#..#', '######'])));
    cast(northFirst, 'magic-rope');
    expect(northFirst.hero.position).toEqual({ x: 2, y: 1, z: 8 });
    // Sul e norte fechados → leste (3,2).
    const eastNext = start(contentOf(world(['######', '#.#..#', '#....#', '#.#..#', '######'])));
    cast(eastNext, 'magic-rope');
    expect(eastNext.hero.position).toEqual({ x: 3, y: 2, z: 8 });
    // Sul, norte e leste fechados → oeste (1,2).
    const westNext = start(contentOf(world(['######', '#.#..#', '#..#.#', '#.#..#', '######'])));
    cast(westNext, 'magic-rope');
    expect(westNext.hero.position).toEqual({ x: 1, y: 2, z: 8 });
  });

  it('fora de um rope spot: recusa `not-possible`, sem custo e sem cooldown', () => {
    const noSpot: World = { ...world(UP), interactables: [] };
    const run = start(contentOf(noSpot));
    expect(cast(run, 'magic-rope')).toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(run.hero.position).toEqual({ x: 2, y: 2, z: 9 });
    expect(run.hero.mana).toBe(500);
    expect(cooldownOf(run, 'magic-rope')).toBe(0);
  });

  it('sem andar acima no mapa, ou sem nenhum tile andável em volta: `not-enough-room`, sem custo', () => {
    const noFloorAbove: World = { floors: { 9: HERE }, z: 9, start: { x: 2, y: 2 }, interactables: [ropeSpot(2, 2, 9)] };
    const semAndar = start(contentOf(noFloorAbove));
    expect(cast(semAndar, 'magic-rope')).toEqual({ ok: false, reason: 'not-enough-room', retryInMs: 0 });

    const walled = ['######', '######', '######', '######', '######'];
    const semChao = start(contentOf(world(walled)));
    expect(cast(semChao, 'magic-rope')).toEqual({ ok: false, reason: 'not-enough-room', retryInMs: 0 });
    expect(semChao.hero.mana).toBe(500);
  });

  it('o salto tranca o ataque sob o combat-v3, como o Levitate', () => {
    const run = start(contentOf(world(UP), { combat: [combatV3] }));
    cast(run, 'magic-rope');
    expect(run.hero.attackLockedUntil).toBe(2_000);
  });

  it('o slotStates espelha o motivo: blocked/not-possible fora do rope spot', () => {
    const noSpot: World = { ...world(UP), interactables: [] };
    const run = start(contentOf(noSpot));
    const index = spells.findIndex((spell) => spell.id === 'magic-rope');
    expect(run.ruleset.slotStates(run.session, run.hero)[index])
      .toMatchObject({ state: 'blocked', reason: 'not-possible' });
  });
});

// --- Find -----------------------------------------------------------------------------------

describe('Find Person e Find Fiend — a mensagem de direção (#623)', () => {
  const wide: World = {
    floors: { 8: Array.from({ length: 30 }, (_, y) => (y === 0 || y === 29 ? '#'.repeat(30) : `#${'.'.repeat(28)}#`)) },
    z: 8, start: { x: 2, y: 2 },
  };

  /** Coloca um segundo personagem na sessão, num tile dado. */
  function withCompanion(run: Started, at: { x: number; y: number; z: number }): CharacterRuntime {
    const other = new CharacterRuntime({ ...run.hero.getState(), id: 'other' });
    run.session.enter(other);
    other.position = at;
    return other;
  }

  it('Find Person: emite UMA mensagem só para quem lançou, com a relação do alvo (mira = `use-slot.target`)', () => {
    const run = start(contentOf(wide));
    withCompanion(run, { x: 22, y: 2, z: 8 });
    run.events(); // drena o que a entrada produziu

    const result = cast(run, 'find-person', { kind: 'character', characterId: 'other' });
    expect(result).toEqual({ ok: true });
    expect(run.hero.mana).toBe(480);
    const found = run.events().filter((event) => event.kind === 'find-result');
    expect(found).toEqual([{
      kind: 'find-result', characterId: 'hero', target: 'person', subjectId: 'other',
      // 20 tiles a leste, mesmo andar: "perto" (5–100), direção leste.
      relation: { distance: 'close', level: 'same', direction: 'east' },
    }]);
  });

  it('Find Person sem alvo, ou com alvo que não é personagem da sessão: `person-not-found`, sem custo', () => {
    const run = start(contentOf(wide));
    withCompanion(run, { x: 22, y: 2, z: 8 });
    expect(cast(run, 'find-person')).toEqual({ ok: false, reason: 'person-not-found', retryInMs: 0 });
    expect(cast(run, 'find-person', { kind: 'monster', subject: 'm:1' }))
      .toEqual({ ok: false, reason: 'person-not-found', retryInMs: 0 });
    expect(cast(run, 'find-person', { kind: 'character', characterId: 'nobody' }))
      .toEqual({ ok: false, reason: 'person-not-found', retryInMs: 0 });
    expect(cast(run, 'find-person', { kind: 'invalid' }))
      .toEqual({ ok: false, reason: 'person-not-found', retryInMs: 0 });
    expect(run.hero.mana).toBe(500);
    expect(cooldownOf(run, 'find-person')).toBe(0);
  });

  it('Find Person em outro ANDAR diz o andar: o alvo mais fundo está "abaixo"', () => {
    const run = start(contentOf(wide));
    withCompanion(run, { x: 2, y: 3, z: 9 });
    run.events();
    cast(run, 'find-person', { kind: 'character', characterId: 'other' });
    expect(run.events().find((event) => event.kind === 'find-result')).toMatchObject({
      relation: { distance: 'beside', level: 'lower' },
    });
  });

  it('Find Fiend: sem monstro fiendish na sessão (o Forge está fora), recusa "No creatures around" e não gasta mana', () => {
    const run = start(contentOf(wide));
    expect(cast(run, 'find-fiend')).toEqual({ ok: false, reason: 'no-creatures-around', retryInMs: 0 });
    expect(run.hero.mana).toBe(500);
    expect(cooldownOf(run, 'find-fiend')).toBe(0);
  });

  it('o slotStates do Find Person diz `person-not-found` quando não há ninguém mais na sessão', () => {
    const run = start(contentOf(wide));
    const index = spells.findIndex((spell) => spell.id === 'find-person');
    expect(run.ruleset.slotStates(run.session, run.hero)[index])
      .toMatchObject({ state: 'blocked', reason: 'person-not-found' });
    withCompanion(run, { x: 22, y: 2, z: 8 });
    expect(run.ruleset.slotStates(run.session, run.hero)[index]).toMatchObject({ state: 'ready' });
  });
});

// --- Food -----------------------------------------------------------------------------------

describe('Food — cria comida na mochila (#623)', () => {
  const world: World = { floors: { 8: ROOM }, z: 8, start: { x: 1, y: 1 } };

  const carriedFoods = (run: Started): Record<string, number> => {
    const carried: Record<string, number> = {};
    for (const item of run.hero.inventory.items()) carried[item.itemId] = (carried[item.itemId] ?? 0) + item.quantity;
    return carried;
  };
  const total = (foods: Record<string, number>): number => Object.values(foods).reduce((a, b) => a + b, 0);

  it('paga mana e alma, cria UM ou DOIS itens da lista e reenvia o inventário', () => {
    const run = start(contentOf(world));
    run.events();
    expect(cast(run, 'food')).toEqual({ ok: true });

    expect(run.hero.mana).toBe(380);
    expect(run.hero.soul).toBe(4);
    const foods = carriedFoods(run);
    expect([1, 2]).toContain(total(foods));
    for (const id of Object.keys(foods)) expect(FOODS as readonly string[]).toContain(id);
    expect(run.events().some((event) => event.kind === 'equipment-changed')).toBe(true);
  });

  it('a mesma semente cria a mesma comida, e cada uma nasce com o `instanceId` da sessão (ledger)', () => {
    const once = () => {
      const run = start(contentOf(world));
      cast(run, 'food');
      return [...run.hero.inventory.items()].map((item) => [item.itemId, item.quantity, item.instanceId]);
    };
    expect(once()).toEqual(once());
    for (const [, , instanceId] of once()) expect(instanceId).toMatch(/^utility-session:\d+$/);
  });

  it('a distribuição: em 400 lançamentos, o segundo item sai perto de 50 % e as sete comidas aparecem', () => {
    // O `math.random(0, 1) == 1` do script: metade das vezes um item extra. Sorteia com o `Rng` da
    // sessão — o cooldown de 2 s espaçado com `advanceBy`, e mana/alma recarregadas a cada volta.
    const seen = new Set<string>();
    let singles = 0;
    let doubles = 0;
    const run = start(contentOf(world), { capacity: 1_000_000 });
    for (let i = 0; i < 400; i += 1) {
      const before = total(carriedFoods(run));
      run.hero.mana = 500;
      run.hero.soul = 5;
      cast(run, 'food');
      const created = total(carriedFoods(run)) - before;
      if (created === 1) singles += 1; else doubles += 1;
      run.session.advanceBy(2_000);
    }
    for (const id of Object.keys(carriedFoods(run))) seen.add(id);
    expect(singles + doubles).toBe(400);
    expect(doubles).toBeGreaterThan(140);
    expect(doubles).toBeLessThan(260);
    expect(seen.size).toBe(FOODS.length);
  });

  it('a comida criada é COMIDA: `use-item` soma `fedMs` (o efeito é de quem come, não da magia)', () => {
    const run = start(contentOf(world));
    cast(run, 'food');
    const carried = [...run.hero.inventory.items()][0];
    if (carried === undefined) throw new Error('a Food não criou nada');
    expect(run.hero.fedMs).toBe(0);
    expect(run.ruleset.useItem(run.session, 'hero', { instanceId: carried.instanceId }, 1)).toEqual({ ok: true });
    expect(run.hero.fedMs).toBeGreaterThan(0);
  });

  it('sem alma, recusa e não cria nada; sem capacidade, gasta e o item se perde (registrado)', () => {
    const noSoul = start(contentOf(world), { soul: 0 });
    expect(cast(noSoul, 'food')).toEqual({ ok: false, reason: 'not-enough-soul', retryInMs: 0 });
    expect(carriedFoods(noSoul)).toEqual({});

    // Capacidade 1 < peso 2 de qualquer comida: nada cabe. O Canary largaria no chão; aqui não há
    // item no chão, e o extrato acusa o que se perdeu.
    const full = start(contentOf(world), { capacity: 1 });
    expect(cast(full, 'food')).toEqual({ ok: true });
    expect(full.hero.mana).toBe(380);
    expect(carriedFoods(full)).toEqual({});
    expect(full.session.notableEvents.filter((event) => event.type === 'food-not-carried').length).toBeGreaterThan(0);
  });
});

// --- restore --------------------------------------------------------------------------------

describe('snapshot e retomada (invariante 3)', () => {
  it('a luz atravessa o snapshot e vence no MESMO instante do outro lado, sem o evento antigo', () => {
    const world: World = { floors: { 8: ROOM }, z: 8, start: { x: 1, y: 1 } };
    const loaded = contentOf(world);
    const run = start(loaded);
    cast(run, 'light');
    run.session.advanceBy(1_000);

    // Passa pelo JSON de verdade, como o snapshot do servidor (Redis): o campo `light` opcional
    // não pode se perder nem exigir bump de formato.
    const snapshot = JSON.parse(JSON.stringify(run.session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed('resume'),
    );
    const hero = resumed.participants[0] as CharacterRuntime;
    expect(hero.conditions.get('light')).toMatchObject({
      light: { level: 6, color: 215, durationMs: 370_000 }, expiresAtMs: 370_000,
    });
    resumed.advanceBy(368_999);
    expect(hero.conditions.get('light')).not.toBeNull();
    resumed.advanceBy(1);
    expect(hero.conditions.get('light')).toBeNull();
  });

  it('o mundo depois de um Levitate é o mesmo a 10 Hz e a 1 Hz (ADR 0020)', () => {
    const upper = ['######', '#....#', '#.#..#', '#....#', '######'];
    const world: World = { floors: { 8: upper, 9: ROOM }, z: 9, start: { x: 2, y: 2 } };
    const at = (stepMs: number) => {
      const run = start(contentOf(world), { facing: 'east' });
      cast(run, 'levitate-up');
      for (let t = 0; t < 10_000; t += stepMs) run.session.advanceBy(stepMs);
      return { position: run.hero.position, mana: run.hero.mana, lock: run.hero.attackLockedUntil };
    };
    expect(at(100)).toEqual(at(1_000));
  });
});
