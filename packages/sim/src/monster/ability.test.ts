// As abilities de monstro (CMB-06): a seleção de alvo/forma PURA e o fluxo no motor.
//
// A parte pura mora em `ability.ts` e é testada por tabela — geometria e ordem de alvo. A parte
// de motor monta uma hunt de verdade e confere a ORDEM dos eventos (lançamento antes do golpe),
// o tipo do golpe e a determinismo do RNG, que é o contrato da sessão.

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Content, MonsterAbility, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { statsForLevel } from '../progression.js';
import type { Progression } from '@draconya/content';
import { Session } from '../session.js';
import type { DomainEvent } from '../session.js';
import { createHuntSession, HuntRuleset } from '../rulesets/hunt.js';
import type { WorldPoint } from '../movement.js';
import { abilityTargets, abilityTiles, isMeleeAbility } from './ability.js';

const map = { id: 'arena', z: 7, grid: ['######', '#....#', '#....#', '######'] };
const route = {
  id: 'arena-loop', mapId: 'arena',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 1, z: 7 }, { x: 4, y: 1, z: 7 },
    { x: 4, y: 2, z: 7 }, { x: 3, y: 2, z: 7 }, { x: 2, y: 2, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [{ routeIndex: 4, radius: 1 }],
};

const caster = {
  id: 'caster', name: 'Caster', recommendedLevel: 1, health: 100_000, experience: 5,
  attack: 6, armor: 0, attackIntervalMs: 2_000, speed: 300, aggroRadius: 8, attackRange: 1,
  loot: { gold: { chance: 1, min: 1, max: 1 }, items: [] },
};

const progression = {
  id: 'baseline', startingHealth: 500_000, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { healthPerSecond: 0, manaPerSecond: 0 },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessedReduction: 0.56, levelFloor: 8 },
  skillMultipliers: {},
};
const combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0 },
};
const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const party = { id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 } };
const hunt = {
  id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
  difficulties: {
    cautious: { monsterCount: 1, composition: [{ monsterId: 'caster', weight: 1 }], respawnDelayMs: 30_000 },
  },
};

function raw(abilities?: readonly unknown[]): RawContent {
  const base: RawContent = {
    monsters: [{ ...caster, ...(abilities === undefined ? {} : { abilities }) }],
    hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
    stamina: [stamina], party: [party],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map], routes: [route],
  };
  return { ...base, appearances: [placeholderAppearances(base)] };
}

const content = (abilities?: readonly unknown[]): Content => buildContent(raw(abilities));

const character = (id = 'hero', position = { x: 1, y: 1, z: 7 }): CharacterRuntime => {
  const stats = statsForLevel(1, null, progression as Progression);
  return new CharacterRuntime({
    id, position, health: stats.maxHealth, maxHealth: stats.maxHealth,
    mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0, goldDelta: 0, alive: true, cooldowns: {},
    capacity: 1_000,
  });
};

function start(abilities?: readonly unknown[], sessionId = 'ability-1'): Session {
  const session = createHuntSession({
    id: sessionId, content: content(abilities), huntId: 'arena', difficulty: 'cautious',
    createdAtMs: 0,
  });
  session.enter(character());
  return session;
}

function run(session: Session, durationMs: number, stepMs = 100): void {
  for (let i = 0; i < Math.floor(durationMs / stepMs) && session.ended === null; i++) {
    session.advanceBy(stepMs);
  }
}

const RANGED = {
  id: 'spit', cadenceMs: 1_000, target: { range: 4 }, power: { min: 5, max: 5 },
  damageType: 'energy', presentation: { missileKey: 'spit', impactKey: 'spit-hit' },
};

describe('abilityTargets (puro)', () => {
  const single: MonsterAbility = {
    id: 'single', cadenceMs: 1, target: { range: 3 }, power: { min: 1, max: 1 }, damageType: 'physical',
  };
  const area: MonsterAbility = {
    id: 'area', cadenceMs: 1, power: { min: 1, max: 1 }, damageType: 'fire',
    target: { range: 3, area: { shape: 'circle', radius: 1, centered: 'target' } },
  };
  const casterAt: WorldPoint = { x: 5, y: 5, z: 7 };
  interface Dummy { readonly id: string; readonly position: { readonly x: number; readonly y: number }; readonly alive: boolean }
  const primary: Dummy = { id: 'p', position: { x: 5, y: 5 }, alive: true };
  const prey: Dummy[] = [
    { id: 'a', position: { x: 5, y: 5 }, alive: true },
    { id: 'b', position: { x: 6, y: 5 }, alive: true },
    { id: 'longe', position: { x: 9, y: 9 }, alive: true },
  ];

  it('sem área devolve só o alvo principal', () => {
    expect(abilityTargets(single, casterAt, primary, prey).map((t) => t.id)).toEqual(['p']);
  });

  it('a área colhe na ORDEM da lista e ignora quem está fora', () => {
    // A ordem é contrato: cada alvo consome uma rolagem, e trocá-la troca qual sorteio cai em
    // quem — a mesma semente passaria a render uma hunt diferente.
    expect(abilityTargets(area, casterAt, primary, prey).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('alvo morto não é colhido, e a ordem dos vivos não muda', () => {
    const comMorto: Dummy[] = [
      { id: 'a', position: { x: 5, y: 5 }, alive: false },
      { id: 'b', position: { x: 6, y: 5 }, alive: true },
      { id: 'longe', position: { x: 9, y: 9 }, alive: true },
    ];
    expect(abilityTargets(area, casterAt, primary, comMorto).map((t) => t.id)).toEqual(['b']);
  });

  it('círculo centrado no LANÇADOR pega quem está em volta dele', () => {
    const casterArea: MonsterAbility = {
      ...area, target: { range: 1, area: { shape: 'circle', radius: 1, centered: 'caster' } },
    };
    expect(abilityTargets(casterArea, casterAt, primary, prey).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('abilityTiles devolve a forma; alvo único devolve vazio', () => {
    expect(abilityTiles(single, casterAt, { x: 5, y: 5, z: 7 })).toEqual([]);
    const tiles = abilityTiles(area, casterAt, { x: 5, y: 5, z: 7 });
    expect(tiles).toHaveLength(9);
  });

  it('alcance 1 sem área é corpo a corpo', () => {
    expect(isMeleeAbility(single)).toBe(false);
    expect(isMeleeAbility({ ...single, target: { range: 1 } })).toBe(true);
  });
});

describe('a ability de monstro no motor (CMB-06)', () => {
  it('a distância emite o lançamento ANTES do golpe, e o golpe é `spell`', () => {
    // O defeito que a issue corrige: um ataque de alcance > 1 caía como `creature-hit` melee,
    // sem projétil nem impacto. Agora o `monster-ability-cast` sai primeiro, com as chaves
    // semânticas; o host resolve a arte.
    const session = start([RANGED]);
    run(session, 5_000);
    const events = session.drainEvents();

    const casts = events.filter((e): e is Extract<DomainEvent, { kind: 'monster-ability-cast' }> =>
      e.kind === 'monster-ability-cast');
    expect(casts.length).toBeGreaterThan(0);
    const cast = casts[0] as (typeof casts)[number];
    expect(cast.abilityId).toBe('spit');
    expect(cast.missileKey).toBe('spit');
    expect(cast.impactKey).toBe('spit-hit');
    expect(cast.targets).toHaveLength(1);

    const castIndex = events.indexOf(cast);
    const hitIndex = events.findIndex((e, i) => i > castIndex
      && e.kind === 'creature-hit' && e.attackerId === cast.casterId);
    expect(hitIndex).toBeGreaterThan(castIndex);
    const hit = events[hitIndex] as Extract<DomainEvent, { kind: 'creature-hit' }>;
    expect(hit.source).toBe('spell');
    expect(hit.creatureId).toBe('hero');
  });

  it('a mesma semente dá a MESMA sequência de dano — o contrato do RNG', () => {
    const amounts = (id: string): number[] => {
      const session = start([RANGED], id);
      run(session, 8_000);
      return session.drainEvents()
        .filter((e): e is Extract<DomainEvent, { kind: 'creature-hit' }> =>
          e.kind === 'creature-hit' && String(e.attackerId).startsWith('m:'))
        .map((e) => e.amount);
    };
    const first = amounts('mesma-semente');
    expect(first.length).toBeGreaterThan(0);
    expect(amounts('mesma-semente')).toEqual(first);
  });

  it('a básica legada continua melee e NÃO emite lançamento', () => {
    // O rato não ganha um evento por golpe: a normalização do boot preserva a sequência.
    const session = start();
    run(session, 20_000);
    const events = session.drainEvents();
    const hits = events.filter((e): e is Extract<DomainEvent, { kind: 'creature-hit' }> =>
      e.kind === 'creature-hit' && e.creatureId === 'hero');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.source === 'melee')).toBe(true);
    expect(events.some((e) => e.kind === 'monster-ability-cast')).toBe(false);
  });

  it('a área colhe os dois heróis na ORDEM de entrada e atribui o dano a cada um', () => {
    // A ordem é contrato (cada alvo consome uma rolagem), e a atribuição é o que faz a morte
    // creditar quem realmente bateu. A forma é um círculo grande no lançador, para os dois
    // heróis caírem nela sem depender de posicionamento.
    const burst = {
      id: 'burst', cadenceMs: 500,
      target: { range: 20, area: { shape: 'circle', radius: 20, centered: 'caster' } },
      power: { min: 5, max: 5 }, damageType: 'fire',
    };
    const session = createHuntSession({
      id: 'area-1', content: content([burst]), huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0,
    });
    session.enter(character('h1'));
    session.enter(character('h2'));
    run(session, 3_000);

    const events = session.drainEvents();
    const cast = events.find((e) => e.kind === 'monster-ability-cast');
    if (cast?.kind !== 'monster-ability-cast') throw new Error('sem lançamento de área');
    expect(cast.targets.map((t) => t.creatureId)).toEqual(['h1', 'h2']);
    // Raio 20 com o recorte de Manhattan (`|dx| + |dy| <= 30`): 1.461 tiles, não o 41x41
    // cheio — a mesma geometria da magia vale para a ability de monstro (#472).
    expect(cast.tiles.length).toBe(1_461);

    const monster = (session.ruleset as HuntRuleset).monsters[0];
    if (monster === undefined) throw new Error('sem monstro');
    for (const id of ['h1', 'h2']) {
      const hero = session.participants.find((participant) => participant.id === id);
      expect(hero?.contribution.damageBy(monster.subject)).toBeGreaterThan(0);
    }
  });
});
