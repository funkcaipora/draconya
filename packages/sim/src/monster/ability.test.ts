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
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
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

function raw(
  abilities?: readonly unknown[], monsterOverrides: Record<string, unknown> = {},
): RawContent {
  const base: RawContent = {
    monsters: [{ ...caster, ...(abilities === undefined ? {} : { abilities }), ...monsterOverrides }],
    hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
    stamina: [stamina], party: [party],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map], routes: [route],
  };
  return { ...base, appearances: [placeholderAppearances(base)] };
}

const content = (
  abilities?: readonly unknown[], monsterOverrides: Record<string, unknown> = {},
): Content => buildContent(raw(abilities, monsterOverrides));

const character = (id = 'hero', position = { x: 1, y: 1, z: 7 }): CharacterRuntime => {
  const stats = statsForLevel(1, null, progression as Progression);
  return new CharacterRuntime({
    id, position, health: stats.maxHealth, maxHealth: stats.maxHealth,
    mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0, goldDelta: 0, alive: true, cooldowns: {},
    capacity: 1_000,
  });
};

function start(
  abilities?: readonly unknown[], sessionId = 'ability-1',
  monsterOverrides: Record<string, unknown> = {},
): Session {
  const session = createHuntSession({
    id: sessionId, content: content(abilities, monsterOverrides), huntId: 'arena', difficulty: 'cautious',
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

  describe('onda direcional (#518, TFS Monster::updateLookDirection + length/spread)', () => {
    // O monstro fica em (5,5); o alvo principal a leste, em (7,5) — a onda tem que sair para
    // LESTE (na direção do alvo), não numa direção fixa. `wave` de `length: 2` cobre 1 tile na
    // primeira fileira e 3 na segunda (o cone `1, 3, 3` do Tibia, `area.ts`).
    const wave: MonsterAbility = {
      id: 'fire-wave', cadenceMs: 1_000, damageType: 'fire', power: { min: 1, max: 1 },
      target: { range: 8, area: { shape: 'wave', length: 2 } },
    };
    const target: Dummy = { id: 'primary', position: { x: 7, y: 5 }, alive: true };

    it('a onda sai na direção do ALVO, não numa direção fixa', () => {
      const east = abilityTiles(wave, { x: 5, y: 5, z: 7 }, { x: 7, y: 5, z: 7 });
      expect(east.every((t) => t.x > 5)).toBe(true);
      const west = abilityTiles(wave, { x: 5, y: 5, z: 7 }, { x: 3, y: 5, z: 7 });
      expect(west.every((t) => t.x < 5)).toBe(true);
    });

    it('acerta os dois membros DENTRO da forma e não o terceiro fora dela', () => {
      // A geometria simétrica do exemplo da issue #518 ("monstro a leste do alvo, onda a
      // oeste"): aqui o monstro está em (5,5) e o alvo a leste, em (7,5) — a onda sai para
      // leste. A segunda fileira (distância 2, largura 3) cobre (7,4), (7,5), (7,6) — dois
      // heróis caem nela, o terceiro fica dois tiles ao norte, fora da forma.
      const prey: Dummy[] = [
        { id: 'dentro-1', position: { x: 7, y: 4 }, alive: true },
        { id: 'dentro-2', position: { x: 7, y: 6 }, alive: true },
        { id: 'fora', position: { x: 7, y: 2 }, alive: true },
      ];
      const hit = abilityTargets(wave, { x: 5, y: 5, z: 7 }, target, prey)
        .map((t) => t.id).sort();
      expect(hit).toEqual(['dentro-1', 'dentro-2']);
    });

    it('`beam` também sai na direção do alvo, uma linha reta', () => {
      const beam: MonsterAbility = {
        ...wave, target: { range: 8, area: { shape: 'beam', length: 3 } },
      };
      const tiles = abilityTiles(beam, { x: 5, y: 5, z: 7 }, { x: 5, y: 8, z: 7 });
      expect(tiles).toEqual([
        { x: 5, y: 6, z: 7 }, { x: 5, y: 7, z: 7 }, { x: 5, y: 8, z: 7 },
      ]);
    });
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

// A IA do TFS (#518, referência §15-19): chance por intervalo, cura própria, troca de alvo e
// fuga. Cada mecanismo é uma entrada INDEPENDENTE que rola a própria chance — como a matriz de
// abilities acima, e pela mesma razão: um evento por entrada, nunca um cálculo por tick.

describe('chance por intervalo (#518, TFS Monster::doAttacking/onThinkDefense)', () => {
  const rollingAbility = (chance?: number): readonly unknown[] => [{
    id: 'roll', cadenceMs: 200, target: { range: 4 }, power: { min: 1, max: 1 },
    damageType: 'physical', ...(chance === undefined ? {} : { chance }),
  }];
  const castCount = (session: Session): number =>
    session.drainEvents().filter((e) => e.kind === 'monster-ability-cast').length;

  it('chance 0,3 com semente fixa cai numa faixa plausível — nem sempre, nem nunca', () => {
    // ~200 tentativas em 40 s (cadência 200 ms). p=0,3 → média 60, desvio ~6,5. A faixa
    // [30, 90] é folgada o bastante para não ser flaky e apertada o bastante para provar que
    // a rolagem filtra de verdade (nem 0, nem perto de 200).
    const session = start(rollingAbility(0.3), 'chance-0.3');
    run(session, 40_000);
    const casts = castCount(session);
    expect(casts).toBeGreaterThan(30);
    expect(casts).toBeLessThan(90);
  });

  it('a mesma semente reproduz a MESMA contagem — determinismo', () => {
    const countFor = (id: string): number => {
      const session = start(rollingAbility(0.3), id);
      run(session, 40_000);
      return castCount(session);
    };
    const first = countFor('mesma-chance');
    expect(countFor('mesma-chance')).toBe(first);
  });

  it('chance AUSENTE não consome sorteio — diverge de uma chance DECLARADA, mesmo em 1', () => {
    // O mesmo argumento do `blockChance` (CMB-04) e do `modifiers.critical` (CMB-08): ausente
    // preserva a sequência de RNG do rato/rotworm bit a bit; declarada, mesmo sempre passando,
    // consome UMA rolagem a cada vencimento — e a sequência diverge a partir dali.
    const rngAfter = (chance?: number) => {
      const session = start(rollingAbility(chance), 'rng-compat');
      run(session, 1_000, 100);
      return session.snapshot().rng;
    };
    expect(rngAfter(1)).not.toEqual(rngAfter(undefined));
  });

  it('chance 1 declarada continua sempre passando — só muda se consome sorteio, não o resultado', () => {
    const session = start(rollingAbility(1), 'chance-1-sempre');
    run(session, 5_000);
    expect(castCount(session)).toBeGreaterThan(0);
  });
});

describe('defesa: cura própria (#518, TFS Monster::onThinkDefense)', () => {
  it('cura ao longo do tempo, sem passar do máximo, e emite creature-healed com a chave semântica', () => {
    const session = start(undefined, 'defense-1', {
      health: 100_000,
      defenses: [{
        id: 'self-heal', cadenceMs: 200, chance: 1,
        heal: { min: 40, max: 40 }, presentation: { impactKey: 'blueshimmer' },
      }],
    });
    run(session, 100); // deixa o SPAWN (evento na fila) acontecer antes de pegar o monstro.
    const monster = (session.ruleset as HuntRuleset).monsters[0];
    if (monster === undefined) throw new Error('sem monstro');
    session.drainEvents();
    monster.receiveDamage(90_000);
    const before = monster.health;

    run(session, 3_000);
    expect(monster.health).toBeGreaterThan(before);
    expect(monster.health).toBeLessThanOrEqual(100_000);

    const healed = session.drainEvents().filter(
      (e): e is Extract<DomainEvent, { kind: 'creature-healed' }> => e.kind === 'creature-healed',
    );
    expect(healed.length).toBeGreaterThan(0);
    expect(healed[0]?.source).toBe('monster');
    expect(healed[0]?.amount).toBe(40);
    expect(healed[0]?.impactKey).toBe('blueshimmer');
    expect(healed[0]?.creatureId).toBe(monster.subject);
  });

  it('não passa do HP máximo, e de vida cheia não emite mais nenhum evento', () => {
    const session = start(undefined, 'defense-2', {
      health: 100_000,
      defenses: [{ id: 'self-heal', cadenceMs: 200, chance: 1, heal: { min: 40, max: 40 } }],
    });
    run(session, 100);
    const monster = (session.ruleset as HuntRuleset).monsters[0];
    if (monster === undefined) throw new Error('sem monstro');
    session.drainEvents();
    monster.receiveDamage(10); // falta só 10 para o teto — a PRIMEIRA cura já fecha.

    run(session, 3_000); // muitas cadências depois, de vida cheia o resto do tempo.
    expect(monster.health).toBe(100_000); // nunca passa do teto.
    // Nenhum evento de cura ZERADA: de vida cheia, `heal` devolve zero e o `sim` não emite —
    // a mesma regra de `#emitHealed` para o personagem. (O herói também belisca o monstro com
    // o próprio golpe desarmado, então mais de UMA cura de verdade pode acontecer — o que
    // importa aqui é que NENHUMA delas vem vazia.)
    const healed = session.drainEvents().filter(
      (e): e is Extract<DomainEvent, { kind: 'creature-healed' }> => e.kind === 'creature-healed',
    );
    expect(healed.length).toBeGreaterThan(0);
    expect(healed.every((e) => e.amount > 0)).toBe(true);
  });
});

describe('troca de alvo por tempo (#518, TFS Monster::onThinkTarget)', () => {
  it('troca para o OUTRO alvo válido quando a chance passa — com dois candidatos, é sempre o outro', () => {
    const session = createHuntSession({
      id: 'target-change-1',
      content: content(undefined, { health: 100_000, targetChange: { intervalMs: 300, chance: 1 } }),
      huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    });
    session.enter(character('h1'));
    session.enter(character('h2'));
    run(session, 100, 100);

    const monster = (session.ruleset as HuntRuleset).monsters[0];
    if (monster === undefined) throw new Error('sem monstro');
    // Força o alvo inicial: o teste não depende de qual `chooseTarget` escolheu primeiro.
    monster.targetId = 'h1';

    run(session, 400, 100);
    expect(monster.targetId).toBe('h2');
  });

  it('chance 0 nunca troca — o alvo atual sobrevive a qualquer número de vencimentos', () => {
    const session = createHuntSession({
      id: 'target-change-2',
      content: content(undefined, { health: 100_000, targetChange: { intervalMs: 200, chance: 0 } }),
      huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    });
    session.enter(character('h1'));
    session.enter(character('h2'));
    run(session, 100, 100);
    const monster = (session.ruleset as HuntRuleset).monsters[0];
    if (monster === undefined) throw new Error('sem monstro');
    monster.targetId = 'h1';

    run(session, 3_000, 100);
    expect(monster.targetId).toBe('h1');
  });
});

describe('fuga com HP baixo (#518, TFS Monster::isFleeing)', () => {
  it('para de bater corpo a corpo, mas continua atirando à distância', () => {
    const session = start([
      { id: 'bite', cadenceMs: 200, target: { range: 1 }, power: { min: 1, max: 1 }, damageType: 'physical' },
      { id: 'spit', cadenceMs: 200, target: { range: 4 }, power: { min: 1, max: 1 }, damageType: 'physical' },
    ], 'flee-1', { health: 300, runOnHealth: 300 }); // já nasce fugindo (§ isFleeing: `<=`).

    run(session, 5_000);
    const events = session.drainEvents();
    // A básica/corpo-a-corpo do MONSTRO nunca sai (o herói tem golpe desarmado próprio, que
    // também é `source: 'melee'` — daí o filtro por `attackerId`, o subject do monstro).
    // `spit` é `source: 'spell'` (`isMeleeAbility` só é true sem área e alcance 1).
    const monsterMeleeHits = events.filter((e) => e.kind === 'creature-hit'
      && e.source === 'melee' && String(e.attackerId).startsWith('m:'));
    expect(monsterMeleeHits).toHaveLength(0);
    const spitCasts = events.filter((e) => e.kind === 'monster-ability-cast' && e.abilityId === 'spit');
    expect(spitCasts.length).toBeGreaterThan(0);
  });

  it('acima do limiar, ataca normalmente — corpo a corpo incluso', () => {
    // Margem de sobra acima do limiar (o herói belisca de volta com o próprio golpe
    // desarmado): sem ela, o monstro cairia abaixo de `runOnHealth` no meio do teste, e
    // "acima do limiar" pararia de ser verdade antes do teste terminar.
    const session = start([
      { id: 'bite', cadenceMs: 200, target: { range: 1 }, power: { min: 1, max: 1 }, damageType: 'physical' },
    ], 'flee-2', { health: 100_000, runOnHealth: 300 });

    run(session, 10_000);
    const monsterMeleeHits = session.drainEvents().filter((e) => e.kind === 'creature-hit'
      && e.source === 'melee' && String(e.attackerId).startsWith('m:'));
    expect(monsterMeleeHits.length).toBeGreaterThan(0);
  });
});

describe('invariância de frequência com tudo junto (#518)', () => {
  it('1 Hz e 20 Hz dão o MESMO resultado com chance, defesa, troca de alvo e fuga', () => {
    // A propriedade que o pacote inteiro promete (invariante 2/3): nada aqui é "por tick", e
    // por isso rodar desanexado a 1 Hz tem que render EXATAMENTE o que 20 Hz rende — a mesma
    // vida do monstro, a mesma posição, o mesmo HP do herói.
    const monsterOverrides = {
      health: 150, runOnHealth: 200, // já nasce fugindo; a cura própria pode tirá-lo da fuga.
      defenses: [{ id: 'heal', cadenceMs: 700, chance: 1, heal: { min: 10, max: 30 } }],
      targetChange: { intervalMs: 900, chance: 0.5 },
    };
    const abilities = [
      { id: 'bite', cadenceMs: 500, target: { range: 1 }, power: { min: 5, max: 5 },
        damageType: 'physical', chance: 0.7 },
      { id: 'spit', cadenceMs: 500, target: { range: 4 }, power: { min: 5, max: 5 },
        damageType: 'physical', chance: 0.7 },
    ];
    const at = (hz: number) => {
      const session = start(abilities, 'freq-invariance-518', monsterOverrides);
      run(session, 20_000, 1000 / hz);
      const monster = (session.ruleset as HuntRuleset).monsters[0];
      const hero = session.participants[0];
      return {
        monsterHealth: monster?.health, monsterPosition: monster?.position,
        heroHealth: hero?.health, ended: session.ended,
      };
    };
    expect(at(20)).toEqual(at(1));
  });
});
