import {
  BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, NEUTRAL_RATES, buildTilemap, botConfigV2Schema,
  botSlotSchema, compileItem, itemSchema,
} from '@draconya/content';
import type { BotConfigV2, BotSlot, Combat, Item, Progression, Spell } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { Rng } from '../rng.js';
import { Session, progressOf } from '../session.js';
import type { SlotOutcome, UseSlotTarget } from './hunt.js';
import { createCityRuleset } from './city.js';

/** A mesma interface estrutural que o host alcança via `ruleset as Partial<HuntRuleset>`. */
interface CityUseSlot {
  useSlot(
    session: Session, characterId: string, set: number, slotIndex: number,
    target?: UseSlotTarget,
  ): SlotOutcome;
  configureBot(session: Session, config: BotConfigV2, characterId?: string): void;
}

// O templo: duas salas separadas por uma parede, ligadas por um corredor que dá a volta por
// baixo. A entrada E é na sala da esquerda; a da direita está a dois tiles em linha reta — e a
// doze a pé. É o mapa de `placeReachable` em `movement.test.ts`, visto pela Cidade.
//
//     0 1 2 3 4 5 6
//   0 # # # # # # #
//   1 # . . # . . #
//   2 # . E # . . #
//   3 # . . # . . #
//   4 # . # # # . #
//   5 # . . . . . #
//   6 # # # # # # #
const temple = buildTilemap({
  id: 'templo', z: 7, entryPoint: { x: 2, y: 2, z: 7 },
  grid: ['#######', '#..#..#', '#..#..#', '#..#..#', '#.###.#', '#.....#', '#######'],
});

const citizen = (id: string): CharacterRuntime => new CharacterRuntime({
  id, position: { x: -1, y: -1, z: 0 },
  health: 150, maxHealth: 150, mana: 0, maxMana: 0,
  level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
});

describe('chegar na Cidade (FUN-120)', () => {
  const arrive = (count: number) => {
    const session = new Session({
      id: 'thais', contentVersion: 'v1', ruleset: createCityRuleset({ map: temple, stepDurationMs: 150 }),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    const people: CharacterRuntime[] = [];
    for (let i = 0; i < count; i++) {
      const person = citizen(`p${i}`);
      session.enter(person);
      people.push(person);
    }
    return { session, people };
  };

  it('o primeiro entra no ponto de entrada', () => {
    const { people } = arrive(1);
    expect(people[0]?.position).toEqual({ x: 2, y: 2, z: 7 });
  });

  it('com o templo lotado, o próximo fica no primeiro tile livre A PÉ — dentro do prédio, nunca do outro lado da parede', () => {
    // Seis tiles na sala da esquerda, seis pessoas: o sétimo não cabe nela. O anel geométrico
    // de antes o poria em (4,1), na sala da direita, atravessando a parede; a pé, o primeiro
    // livre é a boca do corredor.
    const { people } = arrive(7);
    const inLeftRoom = (p: CharacterRuntime) => p.position.x <= 2 && p.position.y <= 3;
    expect(people.slice(0, 6).every(inLeftRoom)).toBe(true);
    expect(people[6]?.position).toEqual({ x: 1, y: 4, z: 7 });
  });

  it('a posição que o personagem traz de outro mapa não ocupa tile nenhum da Cidade', () => {
    // O `Session.enter` já o pôs em `participants` quando o `onEnter` roda, com a posição da
    // sessão anterior. Contá-la na ocupação marcava um tile da praça por ninguém — e quando
    // ela caía no ponto de entrada, o primeiro a chegar numa praça VAZIA era desviado.
    const session = new Session({
      id: 'thais', contentVersion: 'v1', ruleset: createCityRuleset({ map: temple, stepDurationMs: 150 }),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    const person = citizen('p0');
    person.position = { x: 2, y: 2, z: 7 };
    session.enter(person);
    expect(person.position).toEqual({ x: 2, y: 2, z: 7 });
  });

  it('repõe a velocidade da tabela em quem chega com zero (SV-04, #340)', () => {
    // A Cidade anda em passo fixo e não usa `speed` para andar — mas `player-stats` a mostra,
    // e um personagem que nunca caçou chega com zero, que a tabela nunca produziu.
    const progression: Progression = {
      id: 'baseline',
      startingHealth: 150, startingMana: 0, startingCapacity: 400,
      healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
      vocationLevel: 8, startingKit: [], satchelInitialSlots: 10, containerRow: 5,
      startingSpeed: 300, speedPerLevel: 2,
      regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
      regeneration: { requiresFood: false },
      xp: { kind: 'power', base: 20, exponent: 2 },
      deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.56, promotionReduction: 0.3 },
      experienceBonusByLevel: [],
      skillMultipliers: {},
      mitigation: { multiplier: 1.3, primaryShield: 2.05, secondaryShield: 1.25 },
      rates: NEUTRAL_RATES,
    };
    const session = new Session({
      id: 'thais', contentVersion: 'v1',
      ruleset: createCityRuleset({
        map: temple, stepDurationMs: 150, containers: { items: new Map(), progression },
      }),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    const newcomer = citizen('p0');
    expect(newcomer.speed).toBe(0);
    session.enter(newcomer);
    expect(newcomer.speed).toBe(300);
    // Quem já traz a velocidade (um snapshot de hunt, com haste ou level maior) não é rebaixado.
    const veteran = citizen('p1');
    veteran.speed = 320;
    session.enter(veteran);
    expect(veteran.speed).toBe(320);
  });

  it('soma o bônus de equipamento ao repor a velocidade de quem chega com zero (#524, #527)', () => {
    // Um personagem que NUNCA entrou numa hunt — o kit level 200 do dragon-party (#526) já
    // nasce com a bota calçada, e a Cidade é a PRIMEIRA sessão dele. Sem somar o bônus aqui, o
    // HUD mostraria a mesma velocidade com ou sem a bota até a primeira entrada numa hunt.
    const progression: Progression = {
      id: 'baseline',
      startingHealth: 150, startingMana: 0, startingCapacity: 400,
      healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
      vocationLevel: 8, startingKit: [], satchelInitialSlots: 10, containerRow: 5,
      startingSpeed: 220, speedPerLevel: 2,
      regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
      regeneration: { requiresFood: false },
      xp: { kind: 'power', base: 20, exponent: 2 },
      deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.56, promotionReduction: 0.3 },
      experienceBonusByLevel: [],
      skillMultipliers: {},
      mitigation: { multiplier: 1.3, primaryShield: 2.05, secondaryShield: 1.25 },
      rates: NEUTRAL_RATES,
    };
    const items = new Map<string, Item>([[
      'boots-of-haste',
      {
        ...compileItem(itemSchema.parse({
          id: 'boots-of-haste', name: 'Boots of Haste', kind: 'armor', slot: 'feet',
          weight: 1, value: 0, bonuses: { speed: 40 },
        })),
        appearanceId: 1,
      },
    ]]);
    const session = new Session({
      id: 'thais', contentVersion: 'v1',
      ruleset: createCityRuleset({ map: temple, stepDurationMs: 150, containers: { items, progression } }),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    const newcomer = new CharacterRuntime({
      id: 'p0', position: { x: -1, y: -1, z: 0 },
      health: 150, maxHealth: 150, mana: 0, maxMana: 0,
      level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
      inventory: { backpack: [], equipped: { feet: { instanceId: 'b1', itemId: 'boots-of-haste', quantity: 1 } } },
    });
    expect(newcomer.speed).toBe(0);
    session.enter(newcomer);
    // 220 (level 1, sem incremento) + 40 da bota — nunca só a base.
    expect(newcomer.speed).toBe(260);
  });

  it('a Cidade diz qual mapa desenhar', () => {
    expect(createCityRuleset({ map: temple }).mapId).toBe('templo');
    expect(createCityRuleset().mapId).toBeUndefined();
  });

  it('a Cidade não declara `progress`: ausente, ela é shard e não credita, como sempre (OW-03)', () => {
    const ruleset = createCityRuleset({ map: temple });
    expect('progress' in ruleset).toBe(false);
    expect(progressOf(ruleset)).toBe('none');
  });
});

// --- conjurar na Cidade (#792, ADR 0044 d.2) --------------------------------------------------

const combat: Combat = {
  id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
  armorEffectiveness: {
    physical: 1, energy: 1, earth: 1, fire: 1, ice: 1, holy: 1, death: 1, drown: 1,
    lifedrain: 1, manadrain: 1, arcane: 1,
  },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0, damageType: 'physical' },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
};

const conjureRune: Spell = {
  id: 'conjure-test-rune', name: 'Test Rune', manaCost: 30, soulCost: 2, cooldownMs: 1_000, minLevel: 1,
  effect: { kind: 'conjure', supplyId: 'test-rune', charges: 5, blankPrice: 7 },
};
const attackSpell: Spell = {
  id: 'strike', name: 'Golpe', manaCost: 15, cooldownMs: 1_000, minLevel: 1,
  effect: { kind: 'damage', power: 40, range: 3, damageType: 'arcane' },
};
const healSpell: Spell = {
  id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000, minLevel: 1,
  effect: { kind: 'heal', amount: 60 },
};

const citizenWithGold = (over: Partial<{ mana: number; soul: number; gold: number }> = {}): CharacterRuntime =>
  new CharacterRuntime({
    id: 'hero', position: { x: -1, y: -1, z: 0 },
    health: 150, maxHealth: 150, mana: over.mana ?? 100, maxMana: 100, soul: over.soul ?? 100,
    level: 10, xp: 0, gold: over.gold ?? 100, goldDelta: 0, alive: true, cooldowns: {},
  });

/** Um conjunto v2 com os slots dados no ATIVO — mesmo helper de `hunt.test.ts`. */
const botConfigWithSlot = (do_: BotSlot['do']): BotConfigV2 => {
  const slots: (BotSlot | null)[] = [botSlotSchema.parse({ do: do_ })];
  while (slots.length < BOT_SLOTS_PER_SET) slots.push(null);
  const emptySet = () => {
    const empty: (BotSlot | null)[] = [];
    while (empty.length < BOT_SLOTS_PER_SET) empty.push(null);
    return { slots: empty };
  };
  return botConfigV2Schema.parse({
    version: BOT_VOCABULARY_VERSION, activeSet: 0,
    sets: [{ slots }, emptySet(), emptySet(), emptySet()],
  });
};

describe('conjurar na Cidade (#792, ADR 0044 d.2)', () => {
  const sessionWith = (character: CharacterRuntime, spells: readonly Spell[] = [conjureRune]) => {
    const ruleset = createCityRuleset({
      spells: new Map(spells.map((s) => [s.id, s])), combat,
    });
    const session = new Session({
      id: 'thais', contentVersion: 'v1', ruleset, rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    session.enter(character);
    return { session, ruleset: ruleset as unknown as CityUseSlot };
  };

  it('sem configuração de bot, o slot recusa `empty-slot`', () => {
    const { session, ruleset } = sessionWith(citizenWithGold());
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: false, reason: 'empty-slot', retryInMs: 0 });
  });

  it('credita o estoque abstrato, debita mana/alma/gold e leva o gold ao agregado da sessão', () => {
    // `session.enter` já rodou (dentro de `sessionWith`) e o `onEnter` da Cidade repõe a mana
    // cheia (§26.1) — a partida é do MÁXIMO (100), não do `mana: 30` da fixture.
    const { session, ruleset } = sessionWith(citizenWithGold({ soul: 2, gold: 7 }));
    ruleset.configureBot(session, botConfigWithSlot({ kind: 'spell', spellId: 'conjure-test-rune' }), 'hero');

    const outcome = ruleset.useSlot(session, 'hero', 0, 0);

    expect(outcome).toEqual({ ok: true });
    const hero = session.participants[0] as CharacterRuntime;
    expect((hero.supplyStock as Map<string, number>).get('test-rune')).toBe(5);
    expect(hero.mana).toBe(70);
    expect(hero.soul).toBe(0);
    expect(hero.goldDelta).toBe(-7);
    expect(session.aggregates.goldSpent).toBe(7);
  });

  it('magia de ataque é recusada com `protection-zone`, nunca lançada', () => {
    const { session, ruleset } = sessionWith(citizenWithGold(), [attackSpell]);
    ruleset.configureBot(session, botConfigWithSlot({ kind: 'spell', spellId: 'strike' }), 'hero');

    const outcome = ruleset.useSlot(session, 'hero', 0, 0);

    expect(outcome).toEqual({ ok: false, reason: 'protection-zone', retryInMs: 0 });
    const hero = session.participants[0] as CharacterRuntime;
    // Recusada ANTES de tocar mana ou cooldown — a Cidade nunca chega a chamar `castSpell`.
    expect(hero.mana).toBe(100);
    expect(hero.cooldowns.remainingMs('spell:strike', session.nowMs)).toBe(0);
  });

  it('magia não-conjuração (cura) é recusada com `not-in-catalog` — fora do escopo desta issue', () => {
    const { session, ruleset } = sessionWith(citizenWithGold(), [healSpell]);
    ruleset.configureBot(session, botConfigWithSlot({ kind: 'spell', spellId: 'heal' }), 'hero');

    expect(ruleset.useSlot(session, 'hero', 0, 0))
      .toEqual({ ok: false, reason: 'not-in-catalog', retryInMs: 0 });
  });

  it('supply (poção, runa de ataque) continua recusado na Cidade (ADR 0049 d.8)', () => {
    const { session, ruleset } = sessionWith(citizenWithGold());
    ruleset.configureBot(session, botConfigWithSlot({ kind: 'supply', supplyId: 'health-potion' }), 'hero');

    expect(ruleset.useSlot(session, 'hero', 0, 0))
      .toEqual({ ok: false, reason: 'not-in-catalog', retryInMs: 0 });
  });

  it('`characterId` ausente em `configureBot` é NO-OP: a Cidade é shard, não tem "o primeiro"', () => {
    const { session, ruleset } = sessionWith(citizenWithGold());
    ruleset.configureBot(session, botConfigWithSlot({ kind: 'spell', spellId: 'conjure-test-rune' }));
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: false, reason: 'empty-slot', retryInMs: 0 });
  });

  it('ida e volta: a config semeada por `configureBot` (o caminho do ticket na entrada) já basta para conjurar', () => {
    const character = citizenWithGold({ mana: 30, soul: 2, gold: 7 });
    const ruleset = createCityRuleset({
      spells: new Map([[conjureRune.id, conjureRune]]), combat,
    });
    const session = new Session({
      id: 'thais', contentVersion: 'v1', ruleset, rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    // A MESMA sequência do host: `configureBot` roda ANTES de `onEnter` colocar o personagem
    // no mapa (`#adoptTicketBotConfig` chega logo depois de `#createLocal`) — a config precisa
    // sobreviver a isso, porque a Cidade não tem "primeiro participante" como a hunt.
    (ruleset as unknown as CityUseSlot).configureBot(
      session, botConfigWithSlot({ kind: 'spell', spellId: 'conjure-test-rune' }), 'hero',
    );
    session.enter(character);

    const outcome = (ruleset as unknown as CityUseSlot).useSlot(session, 'hero', 0, 0);

    expect(outcome).toEqual({ ok: true });
    expect((character.supplyStock as Map<string, number>).get('test-rune')).toBe(5);
  });
});
