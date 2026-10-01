// Facções de monstro (#619, M44-01, Canary `monster.faction`/`enemyFactions`): o Deepling ataca o
// Deathling, a Lion e os Usurpers se caçam, e o que o Canary decide com `isOpponent`, `isTarget`,
// `canDoCombat` e `updateIdleStatus` — a escolha de alvo, o golpe, a área, a morte e a
// "atividade sem jogador" — vale aqui pela posição de quem está NA SESSÃO, nunca por quem olha.
//
// A arena é um corredor de 28 tiles de comprimento e três de altura. O herói fica CONGELADO
// (`cancelEvents`) e é movido à mão — como no bloco do #655 de `hunt.test.ts` —, para o teste
// dizer exatamente quando ele entra e sai da vista (`aggroRadius` 11) de cada monstro.

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Content, Progression, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { DEPARTED_ACTOR, resolveDeath } from '../death.js';
import { MonsterRuntime } from '../monster/monster.js';
import { statsForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import type { DomainEvent, SessionSnapshot } from '../session.js';
import { Session } from '../session.js';
import { HuntRuleset, createHuntSession, huntRulesetFromSnapshot } from './hunt.js';

const wall = '#'.repeat(30);
const row = `#${'.'.repeat(28)}#`;
const map = { id: 'corridor', z: 7, grid: [wall, row, row, row, wall] };

/** Um ponto de spawn no tile `x` do meio do corredor. */
const point = (monsterId: string, x: number, respawnDelayMs = 600_000) => ({
  routeIndex: 0, radius: 1, at: { x, y: 2, z: 7 }, monsterId, respawnDelayMs,
});

const route = (points: ReturnType<typeof point>[]) => ({
  id: 'corridor', mapId: 'corridor',
  tiles: [{ x: 1, y: 2, z: 7 }, { x: 2, y: 2, z: 7 }],
  spawnPoints: points,
});

const hunt = { id: 'corridor', name: 'Corridor', recommendedLevel: 1, mapId: 'corridor', routeId: 'corridor' };

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
  // O herói nunca bate (`attackPower` 0): todo dano e todo abate do cenário é de MONSTRO.
  player: { attackPower: 0, attackIntervalMs: 2000, attackRange: 1, armor: 0, dodgeChance: 0 },
};
const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const partyConfig = { id: 'baseline', maxMembers: 4 };
const skills = [
  { id: 'melee', name: 'Melee', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0 },
];
const weaponFamilies = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
];

/**
 * Um monstro-base: vida enorme e nenhum golpe — o teste liga só o que precisa (`attack`,
 * `abilities`). `speed` alto deixa quem persegue chegar em segundos, e `aggroRadius: 11` é o do
 * Canary. `corpseTtlMs` faz o abate deixar cadáver, para o teste olhar o dono.
 */
const base = {
  name: 'X', recommendedLevel: 1, health: 1_000_000, experience: 100, attack: 0, armor: 0,
  attackIntervalMs: 1_000, speed: 300, aggroRadius: 11, attackRange: 1, corpseTtlMs: 60_000,
  loot: { gold: { chance: 1, min: 5, max: 5 }, items: [] },
};

const deepling = {
  ...base, id: 'deepling', name: 'Deepling', faction: 'deepling', enemyFactions: ['player', 'deathling'],
};
const deathling = {
  ...base, id: 'deathling', name: 'Deathling', faction: 'deathling', enemyFactions: ['player', 'deepling'],
};
// A Lion NÃO lista o jogador (`lion_knight.lua`); os Usurpers listam os dois.
const lion = { ...base, id: 'lion', name: 'Lion', faction: 'lion', enemyFactions: ['lion-usurpers'] };
const usurper = {
  ...base, id: 'usurper', name: 'Usurper', faction: 'lion-usurpers', enemyFactions: ['player', 'lion'],
};
// O monstro SEM facção: o de sempre.
const rat = { ...base, id: 'rat', name: 'Rat', health: 50 };

const raw = (monsters: Record<string, unknown>[], points: ReturnType<typeof point>[]): RawContent => {
  const content: RawContent = {
    monsters, hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
    stamina: [stamina], party: [partyConfig], spells: [], skills, weaponFamilies, items: [],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map], routes: [route(points)],
  };
  return { appearances: [placeholderAppearances(content)], ...content };
};

const content = (monsters: Record<string, unknown>[], points: ReturnType<typeof point>[]): Content =>
  buildContent(raw(monsters, points));

const makeHero = (id: string, x: number): CharacterRuntime => {
  const stats = statsForLevel(1, null, progression as Progression);
  return new CharacterRuntime({
    id, position: { x, y: 2, z: 7 }, health: stats.maxHealth, maxHealth: stats.maxHealth,
    mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0, gold: 0, goldDelta: 0, alive: true,
    cooldowns: {}, capacity: 1_000,
  });
};

/**
 * Monta a hunt, deixa os monstros nascerem nos pontos e congela o herói em `heroX`. O herói só
 * existe para a sessão ter um dono — a pergunta de quase todo teste é o que acontece SEM ele por
 * perto (`heroX: 1`, a 19+ tiles do primeiro monstro, fora da vista de 11).
 */
function arena(
  monsters: Record<string, unknown>[], points: ReturnType<typeof point>[], heroX = 1,
  loaded: Content = content(monsters, points),
) {
  const session = createHuntSession({
    id: 'factions', content: loaded, huntId: 'corridor', difficulty: 'cautious', createdAtMs: 0,
  });
  const hero = makeHero('hero', heroX);
  session.enter(hero);
  const ruleset = session.ruleset as HuntRuleset;
  // O herói vai para o tile e congela ANTES de os monstros nascerem: o primeiro `chooseTarget` de
  // cada um já o vê onde o teste quer — o monstro retém o alvo que escolheu (`Monster::onThink`),
  // então quem corrigisse a posição depois estaria testando a escolha de um herói na rota.
  hero.position = { x: heroX, y: 2, z: 7 };
  session.cancelEvents(hero.id);
  session.advanceBy(50);
  const byId = (monsterId: string): MonsterRuntime => {
    const found = ruleset.monsters.find((m) => m.monsterId === monsterId);
    if (found === undefined) throw new Error(`sem ${monsterId} na arena`);
    return found;
  };
  return { session, hero, ruleset, loaded, byId };
}

/** Planta o monstro num tile do corredor: posição E `home`, como o `plant` do #655. */
function plant(monster: MonsterRuntime, x: number, y = 2): void {
  monster.position = { x, y, z: 7 };
  Object.assign(monster, { home: { x, y, z: 7 } });
}

/** Avança em passos de `stepMs`, devolvendo os eventos de domínio que saíram. */
function run(session: Session, durationMs: number, stepMs: number): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) {
    session.advanceBy(stepMs);
    events.push(...session.drainEvents());
  }
  return events;
}

/** Os `creature-hit` de `attacker` em `victim`, na ordem em que saíram. */
const hitsOf = (events: readonly DomainEvent[], attacker: string, victim: string) =>
  events.filter((e) => e.kind === 'creature-hit' && e.attackerId === attacker && e.creatureId === victim);

describe('Deepling ataca Deathling — a briga de facções SEM ninguém por perto (#619)', () => {
  // Quatro tiles entre eles, o herói a 19+ da vista: a única coisa que os mantém acordados é o
  // outro — `isOpponent` de uma facção inimiga —, e é isso que a issue pede que exista.
  const monsters = [
    { ...deepling, attack: 10 }, { ...deathling, attack: 10 },
  ];
  const points = [point('deepling', 20), point('deathling', 24)];

  it('cada um vira alvo do outro, anda até ele e o fere — pelo mesmo golpe de sempre', () => {
    const { session, hero, byId } = arena(monsters, points);
    const a = byId('deepling');
    const b = byId('deathling');
    const events = run(session, 15_000, 100);

    expect(a.targetId).toBe(b.subject);
    expect(b.targetId).toBe(a.subject);
    expect(a.health).toBeLessThan(1_000_000);
    expect(b.health).toBeLessThan(1_000_000);
    expect(hitsOf(events, a.subject, b.subject).length).toBeGreaterThan(3);
    expect(hitsOf(events, b.subject, a.subject).length).toBeGreaterThan(3);
    // O herói, longe da vista de todos, não foi tocado nem paga nada.
    expect(hero.health).toBe(hero.maxHealth);
    expect(hero.xp).toBe(0);
  });

  it('o monstro SEM facção fica de fora: o rato ao lado do Deepling não é alvo nem ataca (`isOpponent` é falso)', () => {
    const arenaWithRat = arena(
      [{ ...deepling, attack: 50 }, { ...rat, attack: 50, aggroRadius: 11 }],
      [point('deepling', 20), point('rat', 22)],
    );
    const { session, byId } = arenaWithRat;
    const a = byId('deepling');
    const r = byId('rat');
    run(session, 10_000, 100);
    expect(a.targetId).toBeNull();
    expect(r.targetId).toBeNull();
    expect(a.health).toBe(1_000_000);
    expect(r.health).toBe(50);
  });

  it('duas do MESMO lado não se atacam: dois Deeplings vizinhos ficam intactos', () => {
    const { session, byId } = arena(
      [{ ...deepling, attack: 50 }], [point('deepling', 20), point('deepling', 22)],
    );
    const first = byId('deepling');
    run(session, 10_000, 100);
    expect(first.health).toBe(1_000_000);
    expect(session.ruleset instanceof HuntRuleset && (session.ruleset as HuntRuleset).monsters
      .every((m) => m.health === 1_000_000 && m.targetId === null)).toBe(true);
  });

  it('fora da vista (`aggroRadius`) eles não se enxergam, ficam ociosos no spawn e ninguém apanha', () => {
    // 12 tiles entre eles (a vista é 11) e o herói (x = 1) a 14 do Deepling: ninguém vê ninguém.
    const { session, byId } = arena(monsters, [point('deepling', 15), point('deathling', 27)]);
    const a = byId('deepling');
    const b = byId('deathling');
    const home = { ...a.home };
    run(session, 10_000, 100);
    expect(a.health).toBe(1_000_000);
    expect(b.health).toBe(1_000_000);
    expect(a.targetId).toBeNull();
    expect(a.position).toEqual(home);
  });

  it('1 Hz == 20 Hz: a briga inteira — posições, vidas, atribuição — é a mesma (invariante 2)', () => {
    const scenario = (stepMs: number) => {
      const { session, byId } = arena(monsters, points);
      run(session, 20_000, stepMs);
      return { snapshot: session.snapshot(), a: byId('deepling').getState(), b: byId('deathling').getState() };
    };
    const twentyHz = scenario(50);
    const oneHz = scenario(1_000);
    expect(oneHz.a.health).toBeLessThan(1_000_000);
    expect(oneHz.a).toEqual(twentyHz.a);
    expect(oneHz.b).toEqual(twentyHz.b);
    expect(oneHz.snapshot).toEqual(twentyHz.snapshot);
  });

  it('um snapshot NO MEIO da briga retoma e chega ao mesmo estado (restauração)', () => {
    const build = () => arena(monsters, points);
    const straight = build();
    const interrupted = build();
    run(straight.session, 6_000, 100);
    run(interrupted.session, 6_000, 100);

    const snapshot = JSON.parse(JSON.stringify(interrupted.session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, interrupted.loaded) as HuntRuleset, new Rng(snapshot.rng),
    );
    const hero = resumed.participants[0];
    if (hero === undefined) throw new Error('sem herói na retomada');
    resumed.cancelEvents(hero.id);

    run(straight.session, 10_000, 100);
    run(resumed, 10_000, 100);
    const stateOf = (ruleset: HuntRuleset) => ruleset.monsters.map((m) => m.getState());
    expect(stateOf(resumed.ruleset as HuntRuleset)).toEqual(stateOf(straight.ruleset));
  });
});

describe('a morte por monstro não paga o jogador (`Creature::onDeath`, `Monster::getCorpse`)', () => {
  // O Deepling mata o Deathling num golpe (100 de dano contra 40 de vida) e o Deathling não bate.
  const killer = { ...deepling, attack: 100, attackIntervalMs: 500 };
  const victim = { ...deathling, health: 40, experience: 100 };
  // Seis tiles entre eles: a vítima ainda existe quando `arena` devolve, e o teste a prepara (dano
  // do herói já registrado) antes de o Deepling chegar.
  const points = [point('deepling', 14), point('deathling', 20, 60_000)];

  const deathOf = (session: Session, victimId = 'deathling') => {
    const ruleset = session.ruleset as HuntRuleset;
    for (let t = 0; t < 30_000 && ruleset.monsters.some((m) => m.monsterId === victimId); t += 100) {
      session.advanceBy(100);
    }
    return ruleset;
  };

  it('só de monstro: sem XP, sem abate no analisador, cadáver SEM dono e sem loot', () => {
    const { session, hero } = arena([killer, victim], points);
    const ruleset = deathOf(session);
    expect(ruleset.monsters.some((m) => m.monsterId === 'deathling')).toBe(false);

    expect(hero.xp).toBe(0);
    expect(session.aggregates.xpGained).toBe(0);
    expect(session.aggregates.kills).toBe(0);
    expect(hero.goldDelta).toBe(0);
    // O cadáver existe (o Canary o cria sempre), mas sem dono: `CORPSEOWNER` só vai para jogador,
    // e o loot com chance 1 NÃO foi sorteado para ninguém (ADR 0048, sem dono não há loot).
    const corpse = ruleset.groundItems.find((c) => c.monsterId === 'deathling');
    expect(corpse).toBeDefined();
    expect(corpse?.ownerId ?? null).toBeNull();
    expect(corpse?.gold ?? 0).toBe(0);
    expect(corpse?.items ?? []).toEqual([]);
    // E o bestiário do herói não moveu.
    expect(hero.bestiary.getState()).toEqual({});
  });

  it('o lugar volta a contar: o Deathling respawna no ponto (o mesmo caminho da morte de sempre)', () => {
    const { session } = arena([killer, victim], points);
    const ruleset = deathOf(session);
    expect(ruleset.monsters.some((m) => m.monsterId === 'deathling')).toBe(false);
    session.drainEvents();
    // `respawnDelayMs` 60 000 + o telegraph de 4 200 ms do não bloqueável — e o Deepling, ainda
    // por perto, o mata de novo assim que ele volta, por isso o que se confere é o NASCIMENTO.
    const events = run(session, 70_000, 500);
    expect(events.some((e) => e.kind === 'creature-appeared' && e.monsterId === 'deathling')).toBe(true);
  });

  it('o herói que bateu ANTES leva a fatia dele do dano total: 60 de 100 → floor(0,6 × 100) = 60', () => {
    const { session, hero, byId } = arena([killer, victim], points);
    const target = byId('deathling');
    // O herói tirou 60 do Deathling (que tinha 100) e ficou com 40; o Deepling termina.
    target.health = 40;
    target.contribution.record(hero.id, 60);
    const ruleset = deathOf(session);

    expect(ruleset.monsters.some((m) => m.monsterId === 'deathling')).toBe(false);
    // 40 do Deepling + 60 do herói = 100 no total; a fatia do herói é 0,6 de 100 XP.
    expect(hero.xp).toBe(60);
    expect(session.aggregates.xpGained).toBe(60);
    expect(session.aggregates.kills).toBe(1);
    // E o dono do cadáver é quem causou MAIS dano: o herói (60 > 40) — o loot é dele.
    const corpse = ruleset.groundItems.find((c) => c.monsterId === 'deathling');
    expect(corpse?.ownerId).toBe(hero.id);
    expect(hero.goldDelta).toBe(5);
  });

  it('se o monstro causou MAIS dano que o herói, a XP é a fatia dele e o cadáver não tem dono', () => {
    const { session, hero, byId } = arena([killer, victim], points);
    const target = byId('deathling');
    // O herói tirou 30 e o Deepling 10 antes; sobram 40 para o golpe final do Deepling → 50 dele.
    target.health = 40;
    target.contribution.record(hero.id, 30);
    target.contribution.record(byId('deepling').subject, 30);
    const ruleset = deathOf(session);

    // Total 30 + 30 + 40 = 100; herói 30 → 30 XP. O Deepling (70) é o maior causador: sem dono.
    expect(hero.xp).toBe(30);
    expect(session.aggregates.kills).toBe(1);
    const corpse = ruleset.groundItems.find((c) => c.monsterId === 'deathling');
    expect(corpse?.ownerId ?? null).toBeNull();
    expect(hero.goldDelta).toBe(0);
  });

  it('a party também não é paga por morte só de monstro — nenhum membro', () => {
    const loaded = content([killer, victim], points);
    const session = createHuntSession({
      id: 'party', content: loaded, huntId: 'corridor', difficulty: 'cautious', createdAtMs: 0,
    });
    const a = makeHero('a', 1);
    const b = makeHero('b', 2);
    session.enter(a);
    session.enter(b);
    session.advanceBy(50);
    session.cancelEvents(a.id);
    session.cancelEvents(b.id);
    deathOf(session);
    for (const member of [a, b]) {
      expect(member.xp).toBe(0);
      expect(session.aggregatesOf(member.id).kills).toBe(0);
      expect(session.aggregatesOf(member.id).xpGained).toBe(0);
    }
  });
});

describe('o dano de quem já saiu continua no total do abate (`Creature::getDamageRatio`)', () => {
  // O Canary nunca apaga uma entrada do `damageMap`: o Deepling que feriu o Deathling e morreu ANTES
  // do abate ainda leva a fatia dele do total, e o jogador só a dele. Os golpes entram à mão
  // (`contribution.record`) — o herói nunca bate (`attackPower` 0) — e a morte passa pelo mesmo
  // `resolveDeath` de sempre, sem avançar o relógio: nada mais acontece entre uma e outra.
  const victim = { ...deathling, experience: 1000 };
  const points = [point('deepling', 14), point('deathling', 20)];

  /** Mata o Deepling pela mão do Deathling — morte só de monstro, sem abate para o herói. */
  const killDeepling = (
    session: Session, attacker: MonsterRuntime, killer: MonsterRuntime,
  ): void => {
    attacker.contribution.record(killer.subject, 5);
    attacker.health = 0;
    resolveDeath(session, { kind: 'monster', monster: attacker });
  };

  it('o atacante que morreu antes vira o balde `DEPARTED_ACTOR`: o total fica, só a chave some', () => {
    const { session, hero, byId } = arena([deepling, victim], points);
    const a = byId('deepling');
    const x = byId('deathling');
    x.contribution.record(hero.id, 400);
    x.contribution.record(a.subject, 300);
    killDeepling(session, a, x);

    expect(x.contribution.getState()).toEqual({
      damageByActor: { [hero.id]: 400, [DEPARTED_ACTOR]: 300 }, lastHitBy: DEPARTED_ACTOR,
    });
  });

  it('o herói que termina o abate depois leva `floor(dano ÷ total × XP)` com o dano do morto no total', () => {
    const { session, hero, byId } = arena([deepling, victim], points);
    const a = byId('deepling');
    const x = byId('deathling');
    x.contribution.record(hero.id, 400);
    x.contribution.record(a.subject, 300);
    killDeepling(session, a, x);
    // O herói dá os 300 finais: 700 dele de 1000 no total — e NÃO 700 de 700 (o jogador pago a
    // mais, 1000 XP, que era o que a poda do atacante morto produzia).
    x.contribution.record(hero.id, 300);
    x.health = 0;
    resolveDeath(session, { kind: 'monster', monster: x });

    expect(hero.xp).toBe(700);
    expect(session.aggregates.xpGained).toBe(700);
    expect(session.aggregates.kills).toBe(1);
  });

  it('o morto que bateu o MAIOR dano não é dono do cadáver nem tira o posto de quem ficou', () => {
    const { session, hero, ruleset, byId } = arena([deepling, victim], points);
    const a = byId('deepling');
    const x = byId('deathling');
    x.contribution.record(hero.id, 300);
    x.contribution.record(a.subject, 500);
    killDeepling(session, a, x);
    x.contribution.record(hero.id, 200);
    x.health = 0;
    resolveDeath(session, { kind: 'monster', monster: x });

    // O herói tem 500 de 1000 (o morto tinha os outros 500): a XP é a fatia dele — e o dono é ele,
    // o maior causador entre as criaturas que AINDA existem (`getCreatureByID` pula o morto).
    expect(hero.xp).toBe(500);
    const corpse = ruleset.groundItems.find((c) => c.monsterId === 'deathling');
    expect(corpse?.ownerId).toBe(hero.id);
    expect(hero.goldDelta).toBe(5);
  });

  it('o mapa do monstro fica limitado: vários atacantes que saíram viram UMA chave', () => {
    const { session, hero, ruleset, byId } = arena(
      [deepling, victim],
      [point('deepling', 14), point('deepling', 16), point('deepling', 18), point('deathling', 22)],
    );
    const x = byId('deathling');
    const attackers = ruleset.monsters.filter((m) => m.monsterId === 'deepling');
    expect(attackers).toHaveLength(3);
    x.contribution.record(hero.id, 10);
    for (const attacker of attackers) {
      x.contribution.record(attacker.subject, 20);
      killDeepling(session, attacker, x);
    }
    expect(x.contribution.getState().damageByActor).toEqual({ [hero.id]: 10, [DEPARTED_ACTOR]: 60 });
  });

  it('o veneno de um Deepling que já saiu continua tirando vida, mas não vira dano atribuído', () => {
    // Canary: `Creature::drainHealth` só atribui `if (attacker)`, e o dono morto não é achado.
    const venomous = {
      ...deepling, attack: 0,
      abilities: [{
        id: 'venom', cadenceMs: 60_000, target: { range: 6 }, power: 0, damageType: 'physical',
        condition: {
          key: 'venom', merge: 'refresh', durationMs: 4_000,
          effect: {
            kind: 'damage-over-time', form: 'rounds',
            rounds: [{ count: 4, intervalMs: 500, damage: 15 }], damageType: 'earth',
          },
        },
      }],
    };
    const { session, byId } = arena(
      [venomous, { ...victim, speed: 1 }], [point('deepling', 20), point('deathling', 23)],
    );
    const a = byId('deepling');
    const x = byId('deathling');
    plant(a, 20);
    plant(x, 23);
    for (let t = 0; t < 10_000 && x.contribution.damageBy(a.subject) === 0; t += 100) session.advanceBy(100);
    expect(x.contribution.damageBy(a.subject)).toBeGreaterThan(0);

    killDeepling(session, a, x);
    const attributed = x.contribution.getState().damageByActor[DEPARTED_ACTOR] ?? 0;
    const healthAfterDeath = x.health;
    run(session, 4_000, 100);

    expect(x.health).toBeLessThan(healthAfterDeath);
    expect(x.contribution.getState().damageByActor).toEqual({ [DEPARTED_ACTOR]: attributed });
  });
});

describe('o abate de monstro por monstro: kills, dono do cadáver e a invocação', () => {
  const victim = { ...deathling, experience: 1000 };
  const points = [point('deepling', 14), point('deathling', 20)];

  it('o herói dá o ÚLTIMO golpe mas um monstro causou mais dano: XP é a fatia dele, o cadáver não tem dono', () => {
    const { session, hero, ruleset, byId } = arena([deepling, victim], points);
    const a = byId('deepling');
    const x = byId('deathling');
    x.contribution.record(hero.id, 100);
    x.contribution.record(a.subject, 700);
    x.contribution.record(hero.id, 200);
    x.health = 0;
    resolveDeath(session, { kind: 'monster', monster: x });

    // `Monster::getCorpse` grava o dono pelo `mostDamageCreature`, não pelo último golpe: o Deepling
    // (700) é o maior causador e não é jogador — sem dono, sem loot. A XP é `floor(300 ÷ 1000)`.
    expect(hero.xp).toBe(300);
    expect(session.aggregates.kills).toBe(1);
    const corpse = ruleset.groundItems.find((c) => c.monsterId === 'deathling');
    expect(corpse).toBeDefined();
    expect(corpse?.ownerId ?? null).toBeNull();
    expect(hero.goldDelta).toBe(0);
  });

  it('CONTROLE: o herói dá o último golpe E causou mais dano que o monstro: o cadáver e o loot são dele', () => {
    const { session, hero, ruleset, byId } = arena([deepling, victim], points);
    const a = byId('deepling');
    const x = byId('deathling');
    x.contribution.record(a.subject, 200);
    x.contribution.record(hero.id, 500);
    x.health = 0;
    resolveDeath(session, { kind: 'monster', monster: x });

    // 500 de 700 no total — o Deepling ainda está vivo, e o dano dele é o que falta.
    expect(hero.xp).toBe(Math.floor((500 / 700) * 1000));
    const corpse = ruleset.groundItems.find((c) => c.monsterId === 'deathling');
    expect(corpse?.ownerId).toBe(hero.id);
    expect(hero.goldDelta).toBe(5);
  });

  describe('a invocação de um monstro de facção morta só por monstro', () => {
    const efreet = {
      ...base, id: 'efreet', name: 'Efreet', faction: 'efreet', enemyFactions: ['player', 'marid'],
      summons: { max: 1, entries: [{ monsterId: 'djinn', chance: 1, intervalMs: 500, count: 1 }] },
    };
    const djinn = { ...base, id: 'djinn', name: 'Djinn', attack: 10, health: 1_000_000 };
    const marid = {
      ...base, id: 'marid', name: 'Marid', faction: 'marid', enemyFactions: ['player', 'efreet'], speed: 1,
    };
    const build = () => {
      const started = arena([efreet, djinn, marid], [point('efreet', 20), point('marid', 23)], 1);
      plant(started.byId('efreet'), 20);
      plant(started.byId('marid'), 23);
      run(started.session, 3_000, 100);
      return started;
    };

    it('não conta abate: ninguém presente tocou nela', () => {
      const { session, byId } = build();
      const summon = byId('djinn');
      summon.contribution.record(byId('marid').subject, 10);
      summon.health = 0;
      resolveDeath(session, { kind: 'monster', monster: summon });

      expect(session.aggregates.kills).toBe(0);
      expect(session.aggregates.xpGained).toBe(0);
    });

    it('CONTROLE: se o herói bateu nela antes de o Marid terminar, o abate conta como sempre', () => {
      const { session, hero, byId } = build();
      const summon = byId('djinn');
      summon.contribution.record(hero.id, 3);
      summon.contribution.record(byId('marid').subject, 10);
      summon.health = 0;
      resolveDeath(session, { kind: 'monster', monster: summon });

      expect(session.aggregates.kills).toBe(1);
      // Invocação nunca paga XP, nem para quem bateu nela.
      expect(session.aggregates.xpGained).toBe(0);
    });
  });
});

describe('a ÁREA de um monstro de facção não golpeia a invocação que o mestre morto levou embora', () => {
  // A onda do Deepling (raio 3) pega o mestre E a invocação dele. O mestre nasceu antes, então vem
  // primeiro na lista de alvos colhida; quando ele morre, `#removeSummon` tira a invocação dos
  // índices SEM zerar a vida dela. Sem a conferência no laço a invocação seria golpeada de novo
  // (um `creature-hit` fantasma), morreria uma SEGUNDA vez e deixaria um cadáver que ela nunca teve.
  // A primeira onda sai no instante em que o Deepling vê o mestre (150 de vida, 100 de dano: ele
  // sobrevive, e a invocação ainda nem existe); a segunda, 4 s depois, mata o mestre E a invocação.
  const caster = {
    ...deepling, attack: 0,
    abilities: [{
      id: 'blast', cadenceMs: 4_000, target: { range: 6, area: { shape: 'circle', radius: 3, centered: 'target' } },
      power: 100, damageType: 'fire',
    }],
  };
  const master = {
    ...deathling, id: 'master', name: 'Master', health: 150, attack: 0, speed: 1,
    summons: { max: 1, entries: [{ monsterId: 'minion', chance: 1, intervalMs: 500, count: 1 }] },
  };
  const minion = { ...base, id: 'minion', name: 'Minion', health: 80, attack: 0, speed: 1 };

  it('uma morte, um `creature-vanished`, nenhum golpe depois dele e nenhum cadáver da invocação', () => {
    const { session, byId } = arena(
      [caster, master, minion], [point('deepling', 20), point('master', 23)],
    );
    plant(byId('deepling'), 20);
    plant(byId('master'), 23);
    const events = run(session, 8_000, 100);

    const appeared = events.find((e) => e.kind === 'creature-appeared' && e.monsterId === 'minion');
    if (appeared === undefined || appeared.kind !== 'creature-appeared') throw new Error('a invocação não nasceu');
    const summonSubject = appeared.creatureId;
    // O mestre morreu da onda, a invocação saiu junto, e a onda não a golpeou nem a matou de novo.
    expect(events.filter((e) => e.kind === 'creature-vanished' && e.creatureId === summonSubject)).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'creature-hit' && e.creatureId === summonSubject)).toHaveLength(0);
    // O mestre deixou o cadáver (sem dono); a invocação "some sem cadáver".
    expect(events.filter((e) => e.kind === 'ground-item-appeared' && e.monsterId === 'master')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'ground-item-appeared' && e.monsterId === 'minion')).toHaveLength(0);
    expect(session.aggregates.kills).toBe(0);
  });
});

describe('Lion × Usurpers — quem cada um enxerga como oponente e como alvo', () => {
  const monsters = [
    { ...lion, attack: 10 }, { ...usurper, attack: 10 },
  ];

  it('a Lion NÃO lista o jogador: ele é oponente dela (a mantém acordada) mas não é alvo, e ela não o fere', () => {
    const { session, hero, byId } = arena(monsters, [point('lion', 20)], 21);
    const l = byId('lion');
    const events = run(session, 10_000, 100);
    // O herói está colado (1 tile), ela o enxerga — não fica ociosa —, e nunca o mira.
    expect(l.targetId).toBeNull();
    expect(l.idle).toBe(false);
    expect(hero.health).toBe(hero.maxHealth);
    expect(events.some((e) => e.kind === 'creature-hit' && e.creatureId === hero.id)).toBe(false);
  });

  it('o Usurper lista o jogador e o fere; o mesmo herói no lugar dele é alvo', () => {
    const { session, hero, byId } = arena(monsters, [point('usurper', 20)], 21);
    const u = byId('usurper');
    run(session, 10_000, 100);
    expect(u.targetId).toBe(hero.id);
    expect(hero.health).toBeLessThan(hero.maxHealth);
  });

  it('o Usurper com o herói a 8 tiles e a Lion a 1 mira o HERÓI: 8 + 100 < 1 + 200 (facção 1 antes de 2)', () => {
    const { session, hero, byId } = arena(monsters, [point('usurper', 20), point('lion', 21)], 28);
    const u = byId('usurper');
    run(session, 300, 50);
    expect(u.targetId).toBe(hero.id);
  });

  it('sem o herói por perto, o Usurper caça a Lion — e ela o caça (`enemyFactions` de cada um)', () => {
    const { session, byId } = arena(monsters, [point('usurper', 20), point('lion', 24)]);
    const u = byId('usurper');
    const l = byId('lion');
    const events = run(session, 15_000, 100);
    expect(u.targetId).toBe(l.subject);
    expect(hitsOf(events, u.subject, l.subject).length).toBeGreaterThan(0);
    expect(hitsOf(events, l.subject, u.subject).length).toBeGreaterThan(0);
  });

  it('o jogador preso entre os dois lados é ferido só pelo Usurper — a Lion não o mira mesmo em briga', () => {
    const { session, hero, byId } = arena(monsters, [point('usurper', 20), point('lion', 22)], 21);
    run(session, 8_000, 100);
    const l = byId('lion');
    const u = byId('usurper');
    // A Lion só mira o Usurper; o Usurper prefere o herói (facção 1).
    expect(l.targetId).toBe(u.subject);
    expect(u.targetId).toBe(hero.id);
    expect(hero.health).toBeLessThan(hero.maxHealth);
  });
});

describe('a ÁREA de um monstro de facção só pega os inimigos dele (`Combat::canDoCombat`)', () => {
  // Uma onda circular de raio 2 centrada no alvo. O Deepling a solta no Deathling, e ao lado do
  // alvo estão um Deepling aliado e um rato: nenhum dos dois é inimigo (facção diferente / sem
  // facção), então nenhum leva dano.
  const thrower = {
    ...deepling, attack: 0,
    abilities: [{
      id: 'blast', cadenceMs: 1_000, target: { range: 6, area: { shape: 'circle', radius: 2, centered: 'target' } },
      power: 30, damageType: 'fire',
    }],
  };
  const dummy = { ...deathling, attack: 0, speed: 1 };
  const ally = { ...deepling, id: 'ally', name: 'Ally', attack: 0, speed: 1, aggroRadius: 0 };
  const bystander = { ...rat, speed: 1, aggroRadius: 0 };
  const points = [point('deepling', 20), point('deathling', 23), point('ally', 24), point('rat', 22)];

  it('fere o Deathling e poupa o aliado e o rato dentro do raio', () => {
    const { session, byId } = arena([thrower, dummy, ally, bystander], points);
    // Planta todos onde a geometria é limpa: alvo em 23, aliado e rato a 1 tile dele.
    plant(byId('deepling'), 20);
    plant(byId('deathling'), 23);
    plant(byId('ally'), 24);
    plant(byId('rat'), 22);
    run(session, 5_000, 100);

    expect(byId('deathling').health).toBeLessThan(1_000_000);
    expect(byId('ally').health).toBe(1_000_000);
    expect(byId('rat').health).toBe(50);
  });

  it('o monstro de facção não fere o herói que a facção dele não lista, mesmo dentro da área', () => {
    // A Lion solta a onda no Usurper; o herói está colado nele. `enemyFactions` da Lion não tem
    // `player`: o golpe que pegaria o herói é refutado, sem dano e sem sorteio.
    const lionThrower = {
      ...lion, attack: 0,
      abilities: [{
        id: 'blast', cadenceMs: 1_000, target: { range: 6, area: { shape: 'circle', radius: 2, centered: 'target' } },
        power: 30, damageType: 'fire',
      }],
    };
    const { session, hero, byId } = arena(
      [lionThrower, { ...usurper, attack: 0, speed: 1 }], [point('lion', 20), point('usurper', 23)], 24,
    );
    plant(byId('lion'), 20);
    plant(byId('usurper'), 23);
    run(session, 5_000, 100);
    expect(byId('usurper').health).toBeLessThan(1_000_000);
    expect(hero.health).toBe(hero.maxHealth);
  });
});

describe('a condição de uma ability entra no monstro-alvo, com a imunidade dele', () => {
  const venomous = {
    ...deepling, attack: 0,
    abilities: [{
      id: 'venom', cadenceMs: 60_000, target: { range: 6 }, power: 0, damageType: 'physical',
      condition: {
        key: 'venom', merge: 'refresh', durationMs: 4_000,
        effect: {
          kind: 'damage-over-time', form: 'rounds',
          rounds: [{ count: 4, intervalMs: 500, damage: 15 }], damageType: 'earth',
        },
      },
    }],
  };
  const points = [point('deepling', 20), point('deathling', 23)];

  it('o veneno do Deepling pinga no Deathling e o dano é ATRIBUÍDO ao Deepling', () => {
    const { session, byId } = arena([venomous, { ...deathling, speed: 1 }], points);
    plant(byId('deepling'), 20);
    plant(byId('deathling'), 23);
    run(session, 5_000, 100);
    const victim = byId('deathling');
    expect(victim.health).toBeLessThan(1_000_000);
    expect(victim.contribution.damageBy(byId('deepling').subject)).toBeGreaterThan(0);
  });

  it('a imunidade de condição do alvo (`poison`) recusa o veneno — a mesma que a magia do jogador respeita', () => {
    const immune = { ...deathling, speed: 1, conditionImmunities: ['poison'] };
    const { session, byId } = arena([venomous, immune], points);
    plant(byId('deepling'), 20);
    plant(byId('deathling'), 23);
    run(session, 5_000, 100);
    expect(byId('deathling').health).toBe(1_000_000);
    expect(byId('deathling').conditions.get('venom')).toBeNull();
  });
});

describe('a invocação de um monstro de facção herda a facção — e fica ociosa sem jogador na vista do mestre', () => {
  // A Efreet invoca o Green Djinn (`efreet.lua`); o djinn NÃO tem facção própria no conteúdo do
  // teste, e herda a da mestra (`Monster::getFaction`). Um Marid a 3 tiles mantém a Efreet
  // acordada, com alvo — e é o `hasFollowPath` que libera a invocação (`#onMonsterSummon`).
  const efreet = {
    ...base, id: 'efreet', name: 'Efreet', faction: 'efreet', enemyFactions: ['player', 'marid'],
    summons: { max: 1, entries: [{ monsterId: 'djinn', chance: 1, intervalMs: 500, count: 1 }] },
  };
  const djinn = { ...base, id: 'djinn', name: 'Djinn', attack: 10, health: 1_000_000 };
  const marid = {
    ...base, id: 'marid', name: 'Marid', faction: 'marid', enemyFactions: ['player', 'efreet'], speed: 1,
  };
  const points = [point('efreet', 20), point('marid', 23)];
  const build = (heroX: number) => {
    const started = arena([efreet, djinn, marid], points, heroX);
    plant(started.byId('efreet'), 20);
    plant(started.byId('marid'), 23);
    return started;
  };

  it('sem jogador à vista da Efreet, o djinn nasce e fica OCIOSO: sem alvo, sem golpe no Marid', () => {
    const { session, byId } = build(1);
    const events = run(session, 6_000, 100);
    const summon = byId('djinn');
    expect(summon.masterId).toBe(byId('efreet').id);
    expect(summon.idle).toBe(true);
    expect(summon.targetId).toBeNull();
    expect(hitsOf(events, summon.subject, byId('marid').subject)).toHaveLength(0);
  });

  it('com o herói à vista da Efreet o djinn acorda: mira o herói (facção 1 antes da 4) e o fere', () => {
    const { session, hero, byId } = build(14);
    const events = run(session, 6_000, 100);
    const summon = byId('djinn');
    expect(summon.idle).toBe(false);
    expect(summon.targetId).toBe(hero.id);
    expect(hitsOf(events, summon.subject, hero.id).length).toBeGreaterThan(0);
  });

  it('é estado da SESSÃO: mover o herói para dentro da vista da Efreet acorda o djinn no vencimento seguinte', () => {
    const { session, hero, byId } = build(1);
    run(session, 3_000, 100);
    const summon = byId('djinn');
    expect(summon.idle).toBe(true);
    hero.position = { x: 14, y: 2, z: 7 };
    run(session, 1_000, 100);
    expect(summon.idle).toBe(false);
  });
});

describe('a invocação de um monstro de facção persegue o alvo do MESTRE (`Monster::updateSummonTarget`)', () => {
  // A Lion-mestra só lista os Usurpers: o herói está à vista dela (a invocação não fica ociosa) mas
  // não é alvo dela. A invocação, que pelo desempate de facção preferiria o herói (1 antes de 3),
  // não escolhe sozinha — o `onThink_async` dela só chama `selectTarget(master->getAttackedCreature())`.
  const mistress = {
    ...lion, id: 'mistress', name: 'Mistress', attack: 0, speed: 1,
    summons: { max: 1, entries: [{ monsterId: 'cub', chance: 1, intervalMs: 500, count: 1 }] },
  };
  const cub = { ...base, id: 'cub', name: 'Cub', attack: 10 };
  const rival = { ...usurper, attack: 0, speed: 1 };
  const points = [point('mistress', 20), point('usurper', 25)];

  const build = (stepMs: number) => {
    const started = arena([mistress, cub, rival], points, 21);
    plant(started.byId('mistress'), 20);
    plant(started.byId('usurper'), 25);
    const events = run(started.session, 10_000, stepMs);
    return { ...started, events };
  };

  it('o filhote mira o Usurper que a mestra ataca, e não o herói que está ao lado dele', () => {
    const { hero, byId, events } = build(100);
    const summon = byId('cub');
    expect(summon.masterId).toBe(byId('mistress').id);
    expect(byId('mistress').targetId).toBe(byId('usurper').subject);
    expect(summon.targetId).toBe(byId('usurper').subject);
    expect(hitsOf(events, summon.subject, byId('usurper').subject).length).toBeGreaterThan(0);
    expect(hitsOf(events, summon.subject, hero.id)).toHaveLength(0);
    expect(hero.health).toBe(hero.maxHealth);
  });

  it('1 Hz == 20 Hz: o alvo e o estado da invocação são os mesmos (invariante 2)', () => {
    const twentyHz = build(50);
    const oneHz = build(1_000);
    expect(oneHz.byId('cub').getState()).toEqual(twentyHz.byId('cub').getState());
    expect(oneHz.byId('mistress').getState()).toEqual(twentyHz.byId('mistress').getState());
  });
});

describe('a volta ao spawn do monstro de facção com jogador à vista', () => {
  it('a Lion que voltava para casa desiste da volta quando o herói reaparece na vista (`doWalkBack`)', () => {
    // A Lion caça o Usurper, longe do spawn dela, e o mata: sem alvo e sem ninguém à vista, liga a
    // volta. O herói é OPONENTE dela (a lista de alvos não fica vazia) sem ser alvo — o caso em que
    // só o corte de `totalPlayersOnScreen` a impede de continuar voltando.
    const { session, hero, byId } = arena(
      [{ ...lion, attack: 100 }, { ...usurper, health: 40, speed: 1 }],
      [point('lion', 14), point('usurper', 24)], 1,
    );
    const l = byId('lion');
    for (let t = 0; t < 30_000 && !l.walkingBack; t += 100) session.advanceBy(100);
    expect(l.walkingBack).toBe(true);
    expect(l.position.x).toBeGreaterThan(l.home.x);

    // O herói entra na vista dela: o Canary desliga `isWalkingBack` no vencimento seguinte.
    hero.position = { x: l.position.x - 3, y: 2, z: 7 };
    run(session, 500, 50);
    expect(l.walkingBack).toBe(false);
    expect(l.targetId).toBeNull();
  });

  it('CONTROLE: sem o herói na vista a mesma Lion volta ao spawn e chega lá', () => {
    const { session, byId } = arena(
      [{ ...lion, attack: 100 }, { ...usurper, health: 40, speed: 1 }],
      [point('lion', 14), point('usurper', 24)], 1,
    );
    const l = byId('lion');
    run(session, 60_000, 100);
    expect(l.position).toEqual(l.home);
  });
});

describe('sem facção nenhuma na hunt o caminho é o de antes do #619', () => {
  it('um rato e um Deepling na mesma hunt: o Deepling caça o herói e o rato também — sem inimigo entre eles', () => {
    const { session, hero, byId } = arena(
      [{ ...deepling, attack: 5 }, { ...rat, attack: 5 }], [point('deepling', 20), point('rat', 22)], 21,
    );
    run(session, 5_000, 100);
    expect(byId('deepling').targetId).toBe(hero.id);
    expect(byId('rat').targetId).toBe(hero.id);
  });

  it('uma hunt SÓ de monstros sem facção não monta a tabela: o conteúdo carrega o catálogo inteiro, o spawn decide', () => {
    // O `deepling` existe no conteúdo, mas nenhum ponto o alcança — a hunt nunca paga facção.
    const { session, hero, byId } = arena([deepling, rat], [point('rat', 20)], 21);
    run(session, 2_000, 100);
    expect(byId('rat').targetId).toBe(hero.id);
  });
});
