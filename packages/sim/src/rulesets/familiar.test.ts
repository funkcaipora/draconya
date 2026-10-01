// O familiar de vocação (M38-02, #599, ADR 0057 d.3; Canary `Player:CreateFamiliarSpell` e
// `data/scripts/creaturescripts/familiar/*.lua`): lançamento, duração e cooldown como eventos da
// fila, o carimbo de relógio de parede que atravessa a saída da hunt, a recriação ao entrar, a
// morte, o teleporte ao mestre, a onda que atinge os monstros e nunca a party, e a provocação.
//
// O conteúdo é sintético e os números são redondos de propósito — o que o teste prende é o
// MECANISMO (quando cada coisa acontece), não o balanceamento do Canary, que tem teste próprio
// (`packages/content/src/load.test.ts`, "os quatro familiares de vocação").

import { BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema, botSlotSchema, buildContent, placeholderAppearances } from '@draconya/content';
import type { BotConfigV2, Content, Progression, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { resolveDeath } from '../death.js';
import { FAMILIAR_TELEPORT_DISTANCE, isFamiliarState } from '../familiar.js';
import { learnedSpellsStateOf } from '../learned-spells.js';
import { CHALLENGE_CONDITION_KEY } from '../monster/monster.js';
import { statsForLevel, totalXpForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import type { DomainEvent } from '../session.js';
import { Session } from '../session.js';
import { HuntRuleset, createHuntSession, huntRulesetFromSnapshot } from './hunt.js';

/** Um instante de relógio de PAREDE realista: o `createdAtMs` que o servidor dá na criação. */
const EPOCH = 1_790_000_000_000;
const MIN = 60_000;
const DURATION_MS = 15 * MIN;
const COOLDOWN_MS = 30 * MIN;

const MAP_Z = 7;
// Uma sala aberta de 42 × 4, e um laço de duas fileiras (ida na y = 3, volta na y = 2) — o herói
// anda por ele quando o teste precisa dele longe do familiar. A fileira y = 3 tem duas livres ao
// norte (y = 1 e y = 2) e uma ao sul.
const wideMap = {
  id: 'field', z: MAP_Z,
  grid: [
    '#'.repeat(44),
    `#${'.'.repeat(42)}#`, `#${'.'.repeat(42)}#`, `#${'.'.repeat(42)}#`, `#${'.'.repeat(42)}#`,
    '#'.repeat(44),
  ],
};
const loopTiles = [
  ...Array.from({ length: 39 }, (_, i) => ({ x: 2 + i, y: 3, z: MAP_Z })),
  ...Array.from({ length: 39 }, (_, i) => ({ x: 40 - i, y: 2, z: MAP_Z })),
];
const wideRoute = { id: 'field', mapId: 'field', tiles: loopTiles, spawnPoints: [] as object[] };
const wideHunt = { id: 'field', name: 'Field', recommendedLevel: 1, mapId: 'field', routeId: 'field' };

// Um corredor de duas casas: o herói em (1, 1), a outra casa é o único tile livre em volta.
const closetMap = { id: 'closet', z: MAP_Z, grid: ['####', '#..#', '####'] };
const closetRoute = {
  id: 'closet', mapId: 'closet',
  tiles: [{ x: 1, y: 1, z: MAP_Z }, { x: 2, y: 1, z: MAP_Z }], spawnPoints: [] as object[],
};
const closetHunt = { id: 'closet', name: 'Closet', recommendedLevel: 1, mapId: 'closet', routeId: 'closet' };

const progression = {
  id: 'baseline', startingHealth: 100_000, startingMana: 10_000, startingCapacity: 1_000,
  healthPerLevel: 0, manaPerLevel: 0, capacityPerLevel: 0, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.08, promotionReduction: 0.3 },
  skillMultipliers: {},
};
const combat = {
  id: 'baseline', compatibilityProfile: 'combat-v4', dodgeMultiplier: 0.5,
  armorEffectiveness: {
    physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0,
    manadrain: 0, arcane: 0,
  },
  minimumDamageFraction: 0.1,
  // O herói é pacifista (`attackPower: 0`): todo dano num monstro, e todo crédito de abate, só pode
  // ter vindo do familiar.
  player: { attackPower: 0, attackIntervalMs: 1000, attackRange: 1, armor: 0, dodgeChance: 0 },
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
const knight = { id: 'knight', name: 'Knight', healthPerLevel: 0, manaPerLevel: 0, capacityPerLevel: 0 };

// O familiar: passivo (sem ataque), lento na tabela (a velocidade do mestre vence) e com vida de
// sobra. `familiar: true` liga o teleporte; `summonable` fica ausente, como no Canary.
const familiarMonster = {
  id: 'knight-familiar', name: 'Knight familiar', recommendedLevel: 1,
  health: 10_000, experience: 0, attack: 0, armor: 0,
  attackIntervalMs: 2_000, speed: 100, aggroRadius: 11, attackRange: 1,
  loot: { items: [] }, familiar: true, manaCost: 1_000,
};
// Um monstro hostil parado e indestrutível: alvo do familiar, sem bater em ninguém.
const dummy = {
  id: 'dummy', name: 'Dummy', recommendedLevel: 1,
  health: 1_000_000, experience: 0, attack: 0, armor: 0,
  attackIntervalMs: 2_000, speed: 1, aggroRadius: 0, attackRange: 1,
  loot: { items: [] },
};
// O que bate no mestre: uma ability corpo a corpo de valor FIXO a cada segundo.
const biter = {
  ...dummy, id: 'biter', name: 'Biter', aggroRadius: 8,
  abilities: [{
    id: 'bite', cadenceMs: 1_000, power: { min: 50, max: 50 }, damageType: 'physical', target: { range: 1 },
  }],
};
// A onda do familiar: um círculo de raio 4 (o 5×5 de monstro) centrado no ALVO, 40 de fogo em todo
// mundo dentro dele — vazia de sorteio de chance para o teste ser sobre QUEM leva, não quando.
const blastAbility = {
  id: 'blast', cadenceMs: 500, power: { min: 40, max: 40 }, damageType: 'fire', kind: 'combat',
  target: { range: 6, area: { shape: 'circle', radius: 4, centered: 'target' } },
};
// A provocação do "summon challenge": chance 1, 8 s, o círculo de raio 4 centrado no LANÇADOR.
const challengeAbility = {
  id: 'summon-challenge', cadenceMs: 500, chance: 1, power: 0, damageType: 'physical',
  target: { range: 11, area: { shape: 'circle', radius: 4, centered: 'caster' } },
  challenge: { durationMs: 8_000 },
};

const familiarSpell = {
  id: 'summon-knight-familiar', name: 'Summon Knight Familiar', vocationId: 'knight',
  minLevel: 200, manaCost: 1_000, cooldownMs: 2_000, group: 'support', groupCooldownMs: 2_000,
  effect: {
    kind: 'familiar', monsterId: 'knight-familiar', durationMs: DURATION_MS, cooldownMs: COOLDOWN_MS,
  },
};
// Uma haste no mesmo grupo `support` do familiar (como a haste real): quem a re-lança quando ela
// acaba prova que o grupo do bot não dormiu enquanto a regra do familiar era recusada.
const quickHaste = {
  id: 'quick-haste', name: 'Quick Haste', vocationId: 'knight', minLevel: 1, manaCost: 1,
  cooldownMs: 2_000, group: 'support', groupCooldownMs: 2_000,
  effect: { kind: 'haste', speedPercent: 30, durationMs: 30_000 },
};
// A Summon Creature de teste, para o teto: uma invocação comum ocupa um lugar do teto de 2.
const minion = {
  ...dummy, id: 'minion', name: 'Minion', summonable: true, manaCost: 20, speed: 300, aggroRadius: 11,
};
const summonSpell = {
  id: 'summon-test', name: 'Summon Creature', vocationId: 'knight', minLevel: 25, manaCost: 0,
  cooldownMs: 200, effect: { kind: 'summon' },
};

const raw = (over: Partial<RawContent> = {}): RawContent => {
  const base: RawContent = {
    monsters: [familiarMonster, dummy, biter, minion], hunts: [wideHunt], vocations: [knight],
    progression: [progression], combat: [combat], stamina: [stamina], party: [party],
    spells: [familiarSpell, summonSpell, quickHaste], skills, weaponFamilies, items: [], ammunition: [],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [wideMap], routes: [wideRoute], ...over,
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};

/** A config v2 com os slots no conjunto ATIVO, na ordem dada (a prioridade é a ordem). */
const botConfig = (given: readonly object[]): BotConfigV2 => {
  const slots = given.map((slot) => botSlotSchema.parse(slot));
  while (slots.length < BOT_SLOTS_PER_SET) slots.push(null as never);
  const empty = { slots: Array.from({ length: BOT_SLOTS_PER_SET }, () => null) };
  return botConfigV2Schema.parse({
    version: BOT_VOCABULARY_VERSION, activeSet: 0, sets: [{ slots }, empty, empty, empty],
  });
};
const castFamiliar = { do: { kind: 'spell', spellId: 'summon-knight-familiar' } };
/** O slot só de DISPARO MANUAL (`auto: false`): o bot não o lança sozinho, e o teste decide quando. */
const manual = (action: object) => ({ do: action, auto: false });
const manualFamiliar = manual(castFamiliar.do);
const manualSummon = manual({ kind: 'spell', spellId: 'summon-test', monsterId: 'minion' });

interface StartOptions {
  readonly content?: Content;
  readonly hunt?: 'field' | 'closet';
  readonly config?: BotConfigV2;
  readonly createdAtMs?: number;
  readonly hero?: CharacterRuntime;
  readonly mana?: number;
  readonly seed?: string;
}

function makeHero(options: { mana?: number; familiar?: CharacterRuntime['familiar'] } = {}): CharacterRuntime {
  const stats = statsForLevel(200, null, progression as Progression);
  return new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: MAP_Z },
    health: stats.maxHealth, maxHealth: stats.maxHealth,
    mana: options.mana ?? 10_000, maxMana: Math.max(options.mana ?? 10_000, 10_000),
    level: 200, xp: totalXpForLevel(200, progression as Progression), vocationId: 'knight',
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0, gold: 0, goldDelta: 0, alive: true,
    cooldowns: {}, capacity: 1_000,
    // Sabe TODA magia do conteúdo do teste (#624): o portão do aprendizado tem bloco próprio em
    // `hunt.test.ts`, e aqui o assunto é o familiar, não se o herói comprou a magia.
    learnedSpells: learnedSpellsStateOf([familiarSpell.id, summonSpell.id, quickHaste.id]),
    ...(options.familiar === undefined ? {} : { familiar: options.familiar }),
  });
}

function start(options: StartOptions = {}) {
  const closet = options.hunt === 'closet';
  const loaded = options.content ?? buildContent(raw(closet
    ? { hunts: [closetHunt], maps: [closetMap], routes: [closetRoute] }
    : {}));
  const session = createHuntSession({
    id: options.seed ?? 'familiar-session', content: loaded, huntId: closet ? 'closet' : 'field',
    difficulty: 'cautious', createdAtMs: options.createdAtMs ?? EPOCH,
    ...(options.config === undefined ? {} : { botConfig: options.config }),
  });
  const hero = options.hero ?? makeHero(options.mana === undefined ? {} : { mana: options.mana });
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset, loaded };
}

/** Avança `durationMs` em passos de `stepMs`, drenando os eventos de domínio. */
function run(session: Session, durationMs: number, stepMs = 1_000): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) {
    session.advanceBy(stepMs);
    events.push(...session.drainEvents());
  }
  return events;
}

const familiarsOf = (ruleset: HuntRuleset, heroId = 'hero') =>
  ruleset.monsters.filter((m) => m.masterId === heroId && m.monsterId === 'knight-familiar');
const useCast = (session: Session, ruleset: HuntRuleset) => ruleset.useSlot(session, 'hero', 0, 0);

describe('o lançamento (`Player:CreateFamiliarSpell`)', () => {
  it('nasce ao lado do mestre, debita a mana da MAGIA e grava os dois carimbos de parede', () => {
    const { session, hero, ruleset } = start({ config: botConfig([manualFamiliar]) });
    session.advanceBy(100);
    const manaBefore = hero.mana;
    expect(useCast(session, ruleset)).toEqual({ ok: true });

    const [familiar] = familiarsOf(ruleset);
    if (familiar === undefined) throw new Error('o familiar não nasceu');
    expect(familiarsOf(ruleset)).toHaveLength(1);
    // Um dos doze tiles da lista estendida em volta do mestre (raio máximo 2).
    expect(Math.abs(familiar.position.x - hero.position.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(familiar.position.y - hero.position.y)).toBeLessThanOrEqual(2);
    expect(hero.mana).toBe(manaBefore - 1_000);
    // O relógio de parede de agora = `createdAtMs` + relógio lógico (100 ms).
    const now = EPOCH + 100;
    expect(hero.familiar).toEqual({ version: 1, summonUntilMs: now + DURATION_MS, cooldownUntilMs: now + COOLDOWN_MS });
    // A magia rende skill pela mana gasta, como qualquer outra (`addManaSpent`).
    expect(hero.skills.levelOf({ id: 'magic' } as never)).toBeGreaterThan(0);
  });

  it('com o norte livre, nasce SEMPRE ao norte: os quatro tiles do norte vêm antes dos outros oito', () => {
    // `extendedRelList` do Canary: {0,−2}, {−1,−1}, {0,−1}, {1,−1} embaralhados entre si e só depois
    // os outros oito. O herói anda pela fileira y = 3, onde o norte inteiro (y = 1 e y = 2) é livre.
    const seen = new Set<string>();
    for (let seed = 0; seed < 12; seed += 1) {
      const { session, hero, ruleset } = start({ config: botConfig([manualFamiliar]), seed: `north-${String(seed)}` });
      session.advanceBy(100);
      ruleset.useSlot(session, 'hero', 0, 0);
      const [familiar] = familiarsOf(ruleset);
      if (familiar === undefined) throw new Error('o familiar não nasceu');
      const offset = `${String(familiar.position.x - hero.position.x)},${String(familiar.position.y - hero.position.y)}`;
      seen.add(offset);
      expect(['0,-2', '-1,-1', '0,-1', '1,-1']).toContain(offset);
    }
    // E o sorteio é de verdade: em doze sementes, mais de um dos quatro aparece.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('a velocidade é a MAIOR entre a do mestre e a do monstro, fixada no lançamento', () => {
    const { session, hero, ruleset } = start({ config: botConfig([manualFamiliar]) });
    session.advanceBy(100);
    // O mestre tem 300 (`startingSpeed`), o monstro 100: vale a do mestre.
    useCast(session, ruleset);
    expect(familiarsOf(ruleset)[0]?.speed).toBe(hero.speed);

    // Monstro mais rápido que o mestre: vale a do monstro.
    const fast = buildContent(raw({ monsters: [{ ...familiarMonster, speed: 900 }, dummy, biter, minion] }));
    const second = start({ content: fast, config: botConfig([manualFamiliar]) });
    second.session.advanceBy(100);
    useCast(second.session, second.ruleset);
    expect(familiarsOf(second.ruleset)[0]?.speed).toBe(900);
  });

  it('exige ZERO invocações vivas: recusa `has-summons` sem gastar mana nem armar o cooldown', () => {
    const config = botConfig([manualSummon, manualFamiliar]);
    const { session, hero, ruleset } = start({ config });
    session.advanceBy(100);
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true }); // uma Summon Creature
    const manaBefore = hero.mana;
    // A magia de grupo `support` trava 2 s: espera o grupo, o que NÃO é o assunto.
    session.advanceBy(2_100);
    const refused = ruleset.useSlot(session, 'hero', 0, 1);
    expect(refused).toEqual({ ok: false, reason: 'has-summons', retryInMs: 0 });
    expect(hero.mana).toBe(manaBefore);
    expect(hero.familiar).toEqual({ version: 1, summonUntilMs: 0, cooldownUntilMs: 0 });
    expect(familiarsOf(ruleset)).toHaveLength(0);
  });

  it('o familiar OCUPA um lugar do teto de 2: sobra UMA Summon Creature', () => {
    const config = botConfig([manualFamiliar, manualSummon]);
    const { session, hero, ruleset } = start({ config });
    session.advanceBy(100);
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    const summons = () => ruleset.monsters.filter((m) => m.masterId === hero.id);
    // Cada tentativa espera o grupo de 2 s; a segunda invocação cabe, a terceira não.
    session.advanceBy(2_100);
    expect(ruleset.useSlot(session, 'hero', 0, 1)).toEqual({ ok: true });
    session.advanceBy(2_100);
    expect(ruleset.useSlot(session, 'hero', 0, 1)).toMatchObject({ ok: false, reason: 'not-summonable' });
    expect(summons()).toHaveLength(2);
  });

  it('sem NENHUM tile livre em volta: recusa `not-enough-room` ANTES de gastar mana e de armar o cooldown', () => {
    // O corredor de duas casas, com um monstro parado na outra: o herói fica cercado, e os doze
    // tiles da lista estendida ou são parede ou estão ocupados.
    const content = buildContent(raw({
      hunts: [closetHunt], maps: [closetMap],
      routes: [{ ...closetRoute, spawnPoints: [{ routeIndex: 0, radius: 2, monsterId: 'dummy', respawnDelayMs: 600_000 }] }],
    }));
    const { session, hero, ruleset } = start({ content, hunt: 'closet', config: botConfig([manualFamiliar]) });
    session.advanceBy(100);
    expect(ruleset.monsters.filter((m) => m.monsterId === 'dummy')).toHaveLength(1);
    const manaBefore = hero.mana;
    expect(useCast(session, ruleset)).toEqual({ ok: false, reason: 'not-enough-room', retryInMs: 0 });
    expect(hero.mana).toBe(manaBefore);
    // Nenhum carimbo: `createFamiliar` devolveu `false` antes de `CreateFamiliarSpell` armar nada.
    expect(hero.familiar).toEqual({ version: 1, summonUntilMs: 0, cooldownUntilMs: 0 });
    expect(familiarsOf(ruleset)).toHaveLength(0);
  });
});

describe('a duração é um evento da fila (invariante 2)', () => {
  it('some aos 15 min exatos, com o mesmo resultado a 1 Hz e a 10 Hz', () => {
    const outcome = (stepMs: number) => {
      const { session, hero, ruleset } = start({ config: botConfig([manualFamiliar]) });
      useCast(session, ruleset); // no instante 0: o evento vence em 900 000 ms lógicos
      let vanishedAtMs: number | null = null;
      let vanished = 0;
      for (let t = 0; t < DURATION_MS + 60_000; t += stepMs) {
        session.advanceBy(stepMs);
        vanished += session.drainEvents().filter((e) => e.kind === 'creature-vanished').length;
        if (vanishedAtMs === null && familiarsOf(ruleset).length === 0) vanishedAtMs = session.nowMs;
      }
      return { vanishedAtMs, vanished, hero, snapshot: JSON.stringify(session.snapshot()) };
    };
    const slow = outcome(1_000);
    const fast = outcome(100);
    // Em 899 s ainda vive; o primeiro avanço que alcança 900 s é o que o remove — nos dois ritmos.
    expect(slow.vanishedAtMs).toBe(DURATION_MS);
    expect(fast.vanishedAtMs).toBe(DURATION_MS);
    expect(slow.vanished).toBe(1);
    expect(fast.vanished).toBe(1);
    // O carimbo NÃO muda quando a invocação acaba: o cooldown segue de onde estava.
    expect(slow.hero.familiar).toEqual({ version: 1, summonUntilMs: EPOCH + DURATION_MS, cooldownUntilMs: EPOCH + COOLDOWN_MS });
    expect(slow.hero.familiar).toEqual(fast.hero.familiar);
    // E o estado inteiro é o mesmo: a duração é um evento da fila, não um acumulador por tique.
    expect(slow.snapshot).toBe(fast.snapshot);
  });

  it('a duração sobrevive ao snapshot: retomar não reinicia nem cancela o evento', () => {
    const { session, ruleset } = start({ config: botConfig([manualFamiliar]) });
    session.advanceBy(100);
    useCast(session, ruleset);
    run(session, 5 * MIN);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as ReturnType<Session['snapshot']>;
    const resumed = Session.fromSnapshot(snapshot, huntRulesetFromSnapshot(snapshot, buildContent(raw())) as HuntRuleset, Rng.fromSeed('familiar-session'));
    const resumedRuleset = resumed.ruleset as HuntRuleset;
    expect(familiarsOf(resumedRuleset)).toHaveLength(1);
    // O carimbo do personagem voltou com o snapshot.
    expect(resumed.participants[0]?.familiar.summonUntilMs).toBe(EPOCH + 100 + DURATION_MS);
    run(resumed, 9 * MIN + 30_000);
    expect(familiarsOf(resumedRuleset)).toHaveLength(1); // 14 min 30 s: ainda vive
    run(resumed, MIN);
    expect(familiarsOf(resumedRuleset)).toHaveLength(0); // passou dos 15 min
  });
});

describe('o cooldown de PAREDE atravessa a saída da hunt (ADR 0052 d.6)', () => {
  it('conta do LANÇAMENTO: recusa durante 30 min, com o prazo real na barra, e libera depois', () => {
    const { session, hero, ruleset } = start({ config: botConfig([manualFamiliar]) });
    session.advanceBy(100);
    useCast(session, ruleset);
    run(session, 20 * MIN); // o familiar (15 min) já acabou; o cooldown ainda não
    expect(familiarsOf(ruleset)).toHaveLength(0);
    const wait = COOLDOWN_MS - (20 * MIN + 100 - 100) - 0;
    // O disparo manual recusa COM prazo, medido em relógio de parede.
    const refused = useCast(session, ruleset);
    expect(refused).toMatchObject({ ok: false, reason: 'on-cooldown' });
    expect((refused as { retryInMs: number }).retryInMs).toBe(wait);
    // A barra mostra o mesmo cooldown, em relógio de parede.
    expect(ruleset.slotStates(session, hero)[0])
      .toMatchObject({ set: 0, slot: 0, state: 'cooldown', remainingMs: wait, reason: 'on-cooldown' });
    expect(hero.mana).toBe(9_000);

    run(session, 10 * MIN + 1_000);
    expect(useCast(session, ruleset)).toEqual({ ok: true });
    expect(familiarsOf(ruleset)).toHaveLength(1);
  });

  it('a recusa do BOT não agenda o grupo: 30 min de sono trancariam a haste que vive no mesmo grupo', () => {
    // A regra "sem invocação viva → familiar" engatilha (não dorme): passados os 15 min do familiar
    // e antes dos 30 do cooldown, o bot a tenta a cada acordar e é recusado. `#onBot` agenda o grupo
    // para o MAIOR `retryInMs` quando NENHUM slot executa — se a recusa carregasse o prazo do
    // cooldown (~15 min), o grupo dormiria, `#armBot` só toca grupo engatilhado, e a haste do MESMO
    // grupo `support` (30 s de duração, na frente do laço só quando está ausente) nunca mais sairia.
    // Em quatro minutos de recusa, a haste sai a cada ~30 s: vê-la sair é a prova de que o grupo
    // continua acordado.
    const hasteRule = { do: { kind: 'spell', spellId: 'quick-haste' }, when: [{ kind: 'condition', conditionId: 'haste', present: false }] };
    const config = botConfig([{ do: castFamiliar.do, when: [{ kind: 'summons', op: '<=', count: 0 }] }, hasteRule]);
    const { session, hero, ruleset } = start({ config });
    run(session, 2_000);
    expect(familiarsOf(ruleset)).toHaveLength(1); // o bot lançou sozinho
    const firstUntil = hero.familiar.cooldownUntilMs;
    // Passa dos 15 min: o familiar acabou e o cooldown (30 min) ainda vale — a regra é recusada.
    run(session, 16 * MIN - 2_000);
    expect(familiarsOf(ruleset)).toHaveLength(0);
    const hasteCasts = (events: readonly DomainEvent[]) =>
      events.filter((e) => e.kind === 'spell-cast' && e.spellId === 'quick-haste').length;
    expect(hasteCasts(run(session, 3 * MIN))).toBeGreaterThanOrEqual(5);
    expect(hero.familiar.cooldownUntilMs).toBe(firstUntil); // nada de familiar foi lançado no meio
    run(session, 11 * MIN + 20_000);
    // 30 min passados: o bot lançou o familiar de novo, sem `retryInMs` nenhum.
    expect(familiarsOf(ruleset)).toHaveLength(1);
    expect(hero.familiar.cooldownUntilMs).toBeGreaterThan(firstUntil);
  });

  it('sair da hunt e voltar: o cooldown continua contando em relógio de parede, também na Cidade', () => {
    const first = start({ config: botConfig([manualFamiliar]), createdAtMs: EPOCH });
    first.session.advanceBy(100);
    useCast(first.session, first.ruleset);
    const { hero } = first;
    first.session.end('manual-exit');

    // 10 min de relógio de parede depois: uma hunt NOVA (o relógio lógico volta a zero), o MESMO
    // objeto de personagem — como uma transição faz.
    const second = start({ hero, config: botConfig([manualFamiliar]), createdAtMs: EPOCH + 10 * MIN });
    second.session.advanceBy(3_000); // o grupo `support` do primeiro lançamento não vale mais
    const refused = second.ruleset.useSlot(second.session, 'hero', 0, 0);
    expect(refused).toMatchObject({ ok: false, reason: 'on-cooldown' });
    // 30 min do lançamento (EPOCH + 100) − agora (EPOCH + 10 min + 3 s).
    expect((refused as { retryInMs: number }).retryInMs).toBe(COOLDOWN_MS + 100 - 10 * MIN - 3_000);

    // 31 min depois do lançamento: livre. (A mana é do herói de antes: 9 000.)
    const third = start({ hero, config: botConfig([manualFamiliar]), createdAtMs: EPOCH + 31 * MIN });
    third.session.advanceBy(3_000);
    expect(third.ruleset.useSlot(third.session, 'hero', 0, 0)).toEqual({ ok: true });
    expect(hero.mana).toBe(8_000);
  });
});

describe('os carimbos são INTEIROS mesmo com o relógio lógico fracionário (ADR 0052 d.6)', () => {
  // Em produção o relógio do hospedeiro é `performance.now()`: o relógio lógico para num instante
  // fracionário, e toda intenção do jogador (`use-slot`) roda nele. Os consumidores dos carimbos
  // (`CharacterRuntime`, extrato, ticket) validam inteiro seguro e trocam o inválido pelo vazio
  // EM SILÊNCIO — sem este arredondamento o cooldown de 30 min some.
  it('lançar depois de um avanço fracionário grava inteiros que o estado do personagem aceita', () => {
    const { session, hero, ruleset } = start({ config: botConfig([manualFamiliar]) });
    session.advanceBy(100.4);
    expect(useCast(session, ruleset)).toEqual({ ok: true });
    // Para CIMA: nunca encurta a invocação nem o cooldown.
    expect(hero.familiar).toEqual({
      version: 1,
      summonUntilMs: Math.ceil(EPOCH + 100.4 + DURATION_MS),
      cooldownUntilMs: Math.ceil(EPOCH + 100.4 + COOLDOWN_MS),
    });
    expect(isFamiliarState(hero.familiar)).toBe(true);
    // O mesmo caminho do snapshot e do extrato: o estado do personagem volta idêntico.
    expect(new CharacterRuntime(hero.getState()).familiar).toEqual(hero.familiar);
  });

  it('o cooldown de parede continua valendo ao reentrar, mesmo gravado num instante fracionário', () => {
    const first = start({ config: botConfig([manualFamiliar]) });
    first.session.advanceBy(100.4);
    useCast(first.session, first.ruleset);
    const { hero } = first;
    first.session.end('manual-exit');
    // O estado atravessa o personagem como atravessaria o ticket: serializado e relido.
    const reloaded = new CharacterRuntime(JSON.parse(JSON.stringify(hero.getState())) as ReturnType<CharacterRuntime['getState']>);
    expect(reloaded.familiar.cooldownUntilMs).toBe(hero.familiar.cooldownUntilMs);
    const second = start({ hero: reloaded, config: botConfig([manualFamiliar]), createdAtMs: EPOCH + 10 * MIN });
    second.session.advanceBy(3_000);
    expect(second.ruleset.useSlot(second.session, 'hero', 0, 0)).toMatchObject({ ok: false, reason: 'on-cooldown' });
  });

  it('a morte num instante fracionário grava inteiro, para BAIXO, e a entrada seguinte não recria', () => {
    const first = start({ config: botConfig([manualFamiliar]) });
    first.session.advanceBy(100.4);
    useCast(first.session, first.ruleset);
    const { hero } = first;
    first.session.advanceBy(5_000.7);
    const familiar = familiarsOf(first.ruleset)[0];
    if (familiar === undefined) throw new Error('o familiar não nasceu');
    familiar.health = 0;
    resolveDeath(first.session, { kind: 'monster', monster: familiar });
    expect(Number.isSafeInteger(hero.familiar.summonUntilMs)).toBe(true);
    expect(hero.familiar.summonUntilMs).toBeLessThanOrEqual(EPOCH + 100.4 + 5_000.7);
    first.session.end('manual-exit');
    // Entra no mesmo milissegundo: sem tempo sobrando, nada volta.
    const second = start({ hero, createdAtMs: EPOCH + 5_101 });
    expect(familiarsOf(second.ruleset)).toHaveLength(0);
  });

  it('recriar com tempo sobrando fracionário agenda uma duração INTEIRA', () => {
    const first = start({ config: botConfig([manualFamiliar]) });
    first.session.advanceBy(100.4);
    useCast(first.session, first.ruleset);
    const { hero } = first;
    first.session.end('manual-exit');
    const second = start({ hero, createdAtMs: EPOCH + 8 * MIN + 100 });
    expect(familiarsOf(second.ruleset)).toHaveLength(1);
    const queued = second.session.snapshot().schedule.events.find((e) => e.kind === 'familiar-expire');
    expect(queued).toBeDefined();
    expect(Number.isInteger(queued?.dueAtMs)).toBe(true);
  });
});

describe('a recriação ao entrar na hunt (`familiarOnLogin`)', () => {
  it('quem sai e volta dentro do tempo reencontra o familiar, com o tempo que SOBRA', () => {
    const first = start({ config: botConfig([manualFamiliar]) });
    first.session.advanceBy(100);
    useCast(first.session, first.ruleset);
    run(first.session, 5 * MIN); // sai aos 5 min e 0,1 s de vida do familiar
    const { hero } = first;
    first.session.end('manual-exit');
    expect(hero.familiar.summonUntilMs).toBe(EPOCH + 100 + DURATION_MS);

    // 3 min de relógio de parede depois: o familiar volta com 15 − 5 − 3 = 7 min (mais 0,1 s).
    const second = start({ hero, createdAtMs: EPOCH + 8 * MIN + 100 });
    expect(familiarsOf(second.ruleset)).toHaveLength(1);
    // Sem mana gasta na volta: recriar não é lançar.
    expect(hero.mana).toBe(9_000);
    run(second.session, 6 * MIN + 30_000);
    expect(familiarsOf(second.ruleset)).toHaveLength(1);
    run(second.session, MIN);
    expect(familiarsOf(second.ruleset)).toHaveLength(0);
  });

  it('o tempo que passou fora, na Cidade ou offline, também conta: passou dos 15 min, nada volta', () => {
    const first = start({ config: botConfig([manualFamiliar]) });
    first.session.advanceBy(100);
    useCast(first.session, first.ruleset);
    const { hero } = first;
    first.session.end('manual-exit');
    const second = start({ hero, createdAtMs: EPOCH + 16 * MIN });
    expect(familiarsOf(second.ruleset)).toHaveLength(0);
  });

  it('um familiar que MORREU não volta na entrada seguinte, e o cooldown segue de pé', () => {
    const first = start({ config: botConfig([manualFamiliar]) });
    first.session.advanceBy(100);
    useCast(first.session, first.ruleset);
    const { hero } = first;
    const familiar = familiarsOf(first.ruleset)[0];
    if (familiar === undefined) throw new Error('o familiar não nasceu');
    const cooldownUntilMs = hero.familiar.cooldownUntilMs;
    // Morre em combate: vida zerada e o pipeline de morte de sempre.
    familiar.health = 0;
    resolveDeath(first.session, { kind: 'monster', monster: familiar });
    expect(familiarsOf(first.ruleset)).toHaveLength(0);
    // `familiar-summon-time = os.time()`: o tempo que sobrava deixa de valer.
    expect(hero.familiar.summonUntilMs).toBe(EPOCH + 100);
    expect(hero.familiar.cooldownUntilMs).toBe(cooldownUntilMs);
    // Nada de abate, XP ou loot para uma invocação que morre (#546).
    expect(first.session.aggregates.xpGained).toBe(0);
    first.session.end('manual-exit');

    const second = start({ hero, createdAtMs: EPOCH + 60_000 });
    expect(familiarsOf(second.ruleset)).toHaveLength(0);
    second.session.advanceBy(3_000);
    expect(second.ruleset.useSlot(second.session, 'hero', 0, 0)).toMatchObject({ ok: false });
  });

  it('só recria para quem ainda pode tê-lo: vocação sem a magia, ou abaixo do level 200, não recebe', () => {
    const stamped = { version: 1, summonUntilMs: EPOCH + 5 * MIN, cooldownUntilMs: EPOCH + 5 * MIN };
    const low = makeHero({ familiar: stamped });
    // Level 100 com a mesma vocação: `familiarOnLogin` remove o familiar de quem caiu abaixo do 200.
    Object.assign(low, { level: 100 });
    const lowStart = start({ hero: low });
    expect(familiarsOf(lowStart.ruleset)).toHaveLength(0);
    // Sem vocação (o personagem de antes do level 8): a tabela por vocação não tem para quem.
    const none = makeHero({ familiar: stamped });
    Object.assign(none, { vocationId: null });
    expect(familiarsOf(start({ hero: none }).ruleset)).toHaveLength(0);
  });
});

describe('a morte e a saída do mestre', () => {
  it('o mestre que sai da hunt leva o familiar junto (#598, sem cadáver nem abate), e os carimbos ficam', () => {
    // Party de dois: `hero` invoca, `other` só está lá para a sessão continuar quando ele sai.
    const loaded = buildContent(raw());
    const session = createHuntSession({
      id: 'leave-session', content: loaded, huntId: 'field', difficulty: 'cautious', createdAtMs: EPOCH,
      botConfigs: { hero: botConfig([manualFamiliar]) },
    });
    const hero = makeHero();
    const other = makeHero();
    Object.assign(other, { id: 'other' });
    session.enter(hero);
    session.enter(other);
    const ruleset = session.ruleset as HuntRuleset;
    session.advanceBy(100);
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    expect(familiarsOf(ruleset)).toHaveLength(1);
    const stamps = hero.familiar;
    session.leave('hero', 'manual-exit');
    expect(session.ended).toBeNull();
    expect(familiarsOf(ruleset)).toHaveLength(0);
    // Nenhum evento de abate: a invocação que some não morre.
    expect(session.aggregates.kills).toBe(0);
    expect(hero.familiar).toEqual(stamps);
  });
});

describe('a invocação sem alvo SEGUE o mestre (`Monster::updateSummonTarget`)', () => {
  /** O maior afastamento (Chebyshev) entre o herói e a invocação, amostrado a cada 500 ms. */
  function followGap(
    session: Session, hero: CharacterRuntime, ruleset: HuntRuleset, monsterId: string, durationMs: number,
  ): { readonly maxGap: number; readonly moved: boolean; readonly spawnedAt: { x: number; y: number } } {
    const first = ruleset.monsters.find((m) => m.monsterId === monsterId);
    if (first === undefined) throw new Error('a invocação não nasceu');
    const spawnedAt = { x: first.position.x, y: first.position.y };
    let maxGap = 0;
    let moved = false;
    for (let t = 0; t < durationMs; t += 500) {
      session.advanceBy(500);
      session.drainEvents();
      const summon = ruleset.monsters.find((m) => m.monsterId === monsterId);
      if (summon === undefined) throw new Error('a invocação sumiu');
      if (summon.position.x !== spawnedAt.x || summon.position.y !== spawnedAt.y) moved = true;
      // Só depois do primeiro minuto de rota: antes, o herói ainda está saindo de junto dela.
      if (t >= 5_000) {
        maxGap = Math.max(maxGap, Math.abs(summon.position.x - hero.position.x), Math.abs(summon.position.y - hero.position.y));
      }
    }
    return { maxGap, moved, spawnedAt };
  }

  it('o familiar acompanha o herói que anda pela rota, a poucos tiles dele (e não fica onde nasceu)', () => {
    const { session, hero, ruleset } = start({ config: botConfig([manualFamiliar]) });
    session.advanceBy(100);
    expect(useCast(session, ruleset)).toEqual({ ok: true });
    const result = followGap(session, hero, ruleset, 'knight-familiar', 90_000);
    expect(result.moved).toBe(true);
    // 2 tiles é a distância de parada; +2 é o que o herói anda entre uma amostra e a seguinte.
    expect(result.maxGap).toBeLessThanOrEqual(4);
    // Nunca dois no mesmo tile, e o familiar segue vivo (nada o atacou).
    expect(familiarsOf(ruleset)).toHaveLength(1);
  });

  it('a Summon Creature comum também segue: é a mesma invocação de personagem', () => {
    const { session, hero, ruleset } = start({ config: botConfig([manualSummon]) });
    session.advanceBy(100);
    expect(useCast(session, ruleset)).toEqual({ ok: true });
    const result = followGap(session, hero, ruleset, 'minion', 90_000);
    expect(result.moved).toBe(true);
    expect(result.maxGap).toBeLessThanOrEqual(4);
  });

  it('com o mesmo resultado a 1 Hz e a 10 Hz (a perseguição é evento da fila, invariante 2)', () => {
    const at = (stepMs: number) => {
      const { session, ruleset } = start({ config: botConfig([manualFamiliar]) });
      session.advanceBy(100);
      useCast(session, ruleset);
      run(session, 60_000, stepMs);
      return ruleset.monsters.map((m) => [m.id, m.position.x, m.position.y]);
    };
    expect(at(1_000)).toEqual(at(100));
  });
});

describe('a invocação que NÃO consegue seguir o mestre (`Creature::goToFollowCreature`, `Monster::getNextStep`)', () => {
  /** Familiar (slot 0) e Summon Creature (slot 1) lançados; `invisible` liga a invisibilidade do mestre. */
  function summonBoth(invisible: boolean) {
    const { session, hero, ruleset } = start({ config: botConfig([manualFamiliar, manualSummon]) });
    session.advanceBy(100);
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    session.advanceBy(2_100);
    expect(ruleset.useSlot(session, 'hero', 0, 1)).toEqual({ ok: true });
    const minion = ruleset.monsters.find((m) => m.monsterId === 'minion');
    const familiar = familiarsOf(ruleset)[0];
    if (minion === undefined || familiar === undefined) throw new Error('faltam as invocações');
    if (invisible) {
      hero.conditions.apply({ key: 'invisible', targetId: hero.id, expiresAtMs: session.nowMs + 200_000 });
      expect(hero.invisible).toBe(true);
    }
    return { session, hero, ruleset, minion, familiar, minionAt: { x: minion.position.x, y: minion.position.y }, familiarAt: { x: familiar.position.x, y: familiar.position.y } };
  }
  const moved = (creature: { position: { x: number; y: number } }, from: { x: number; y: number }) =>
    creature.position.x !== from.x || creature.position.y !== from.y;

  it('mestre invisível: a Summon Creature comum fica parada, e o FAMILIAR segue', () => {
    // `isSummon() && !isFamiliar() && !canFollowMaster()` — o mestre invisível que ela não enxerga
    // esvazia a lista de passos; o familiar passa por cima da condição. Quatro segundos: o herói
    // anda 2 tiles por segundo e, passadas as 11 casas de visão, a invocação VAGUEIA (teste abaixo).
    const invisible = summonBoth(true);
    run(invisible.session, 4_000, 250);
    expect(moved(invisible.minion, invisible.minionAt)).toBe(false);
    expect(moved(invisible.familiar, invisible.familiarAt)).toBe(true);
    // Controle: com o mestre visível a mesma invocação o segue.
    const visible = summonBoth(false);
    run(visible.session, 4_000, 250);
    expect(moved(visible.minion, visible.minionAt)).toBe(true);
  });

  it('mestre invisível que a invocação ENXERGA (imune à condição `invisible`): ela segue', () => {
    const seer = { ...minion, id: 'seer', name: 'Seer', conditionImmunities: ['invisible'] };
    const content = buildContent(raw({ monsters: [familiarMonster, dummy, biter, minion, seer] }));
    const config = botConfig([manualFamiliar, manual({ kind: 'spell', spellId: 'summon-test', monsterId: 'seer' })]);
    const { session, hero, ruleset } = start({ content, config });
    session.advanceBy(100);
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    session.advanceBy(2_100);
    expect(ruleset.useSlot(session, 'hero', 0, 1)).toEqual({ ok: true });
    const watcher = ruleset.monsters.find((m) => m.monsterId === 'seer');
    if (watcher === undefined) throw new Error('a invocação não nasceu');
    const from = { x: watcher.position.x, y: watcher.position.y };
    hero.conditions.apply({ key: 'invisible', targetId: hero.id, expiresAtMs: session.nowMs + 200_000 });
    run(session, 4_000, 250);
    expect(moved(watcher, from)).toBe(true);
  });

  it('o mestre sai da área de visão: sem `followCreature`, a invocação VAGUEIA (`doRandomStep`) em vez de ficar parada', () => {
    // O herói é posto na outra ponta da sala, fora das 11 casas: `setFollowCreature` recusa quem
    // `canSee` não alcança e o `getNextStep` do Canary cai no passo aleatório — a invocação nunca
    // é ociosa. Seis segundos: o herói caminha para o leste, e só depois de ~11 s voltaria à vista.
    const { session, hero, minion } = summonBoth(false);
    hero.position = { x: 38, y: 3, z: MAP_Z };
    const stepsOf = (events: readonly DomainEvent[]) =>
      events.filter((e) => e.kind === 'creature-moved' && e.creatureId === minion.subject).length;
    const steps = stepsOf(run(session, 6_000, 250));
    expect(steps).toBeGreaterThan(0);
    // O passo aleatório respeita o intervalo mínimo de 1 s entre passos (`getTimeSinceLastMove`): no
    // máximo um por segundo, o primeiro sem espera (a invocação nunca andou).
    expect(steps).toBeLessThanOrEqual(7);
  });
});

describe('o teleporte ao mestre (`Creature::checkSummonMove`)', () => {
  it('passou de 15 tiles em x ou em y: o familiar vai até o mestre, num tile livre ao lado', () => {
    // A rota é um laço de 39 tiles por fileira. O familiar SEGUE o mestre enquanto o enxerga (11
    // tiles), e por isso o herói precisa de um jeito de deixá-lo para trás: a velocidade do
    // familiar é a do mestre NO LANÇAMENTO, e uma haste que vem depois (aqui, o triplo) o deixa
    // longe demais para segui-lo — ao passar de 15 tiles, ele é trazido.
    const { session, hero, ruleset } = start({ config: botConfig([manualFamiliar]) });
    session.advanceBy(100);
    useCast(session, ruleset);
    hero.speed *= 3;
    const spawnedAt = { ...(familiarsOf(ruleset)[0] as { position: { x: number; y: number } }).position };
    const familiarSubject = (familiarsOf(ruleset)[0] as { subject: string }).subject;
    const teleports: DomainEvent[] = [];
    let farBefore = false;
    for (let t = 0; t < 120_000; t += 500) {
      session.advanceBy(500);
      const events = session.drainEvents();
      // O teleporte é RELOCAÇÃO, não passo: `creature-moved` de duração zero seria descartado pelo
      // hospedeiro (o protocolo exige duração positiva) e o cliente nunca veria o familiar chegar.
      // Sai o par `creature-vanished` + `creature-appeared` do MESMO subject, com a posição nova.
      expect(events.some((e) => e.kind === 'creature-moved' && e.durationMs <= 0)).toBe(false);
      events.forEach((event, i) => {
        if (event.kind !== 'creature-vanished' || event.creatureId !== familiarSubject) return;
        const next = events[i + 1];
        expect(next).toMatchObject({
          kind: 'creature-appeared', creatureId: familiarSubject, monsterId: 'knight-familiar', masterId: 'hero',
          health: 10_000, maxHealth: 10_000,
        });
        teleports.push(next as DomainEvent);
      });
      const familiar = familiarsOf(ruleset)[0];
      if (familiar === undefined) throw new Error('o familiar sumiu');
      // Nunca passa de 15 tiles + o passo que o mestre acabou de dar.
      const gap = Math.max(Math.abs(familiar.position.x - hero.position.x), Math.abs(familiar.position.y - hero.position.y));
      expect(gap).toBeLessThanOrEqual(FAMILIAR_TELEPORT_DISTANCE + 1);
      if (gap > 5) farBefore = true;
    }
    expect(teleports.length).toBeGreaterThan(0);
    expect(farBefore).toBe(true);
    const familiar = familiarsOf(ruleset)[0];
    expect(familiar?.position.x).not.toBe(spawnedAt.x);
    // O tile de destino era livre: nunca dois no mesmo tile.
    const occupied = new Set([hero, ...ruleset.monsters].map((c) => `${String(c.position.x)},${String(c.position.y)}`));
    expect(occupied.size).toBe(1 + ruleset.monsters.length);
  });
});

describe('o jogador atravessa o familiar (`Player::canWalkthrough`)', () => {
  it('num corredor de duas casas o familiar ocupa a única casa da rota — e o herói passa, trocando de lugar com ele', () => {
    // O herói oscila entre as duas casas (a rota é `(1,1) ↔ (2,1)`); o familiar nasce na outra. Sem
    // a travessia o herói ficaria preso para sempre, e o `TileOccupancy` é exclusivo: a troca é a
    // tradução de "dividir o tile" do Canary.
    const { session, hero, ruleset } = start({ hunt: 'closet', config: botConfig([manualFamiliar]) });
    session.advanceBy(100);
    expect(useCast(session, ruleset)).toEqual({ ok: true });
    const familiar = familiarsOf(ruleset)[0];
    if (familiar === undefined) throw new Error('o familiar não nasceu');
    session.drainEvents();
    const events = run(session, 10_000, 250);
    const heroSteps = events.filter((e) => e.kind === 'creature-moved' && e.creatureId === 'hero');
    const familiarSteps = events.filter((e) => e.kind === 'creature-moved' && e.creatureId === familiar.subject);
    // O herói nunca parou de andar, e cada vez que atravessou o familiar foi para o tile que ele deixou.
    expect(heroSteps.length).toBeGreaterThan(3);
    expect(familiarSteps.length).toBeGreaterThan(0);
    for (const step of familiarSteps) {
      if (step.kind !== 'creature-moved') continue;
      const heroStep = heroSteps.find((h) => h.kind === 'creature-moved' && h.from.x === step.to.x && h.from.y === step.to.y);
      expect(heroStep, 'o familiar vai para o tile de onde o herói saiu').toBeDefined();
    }
    // Nunca dois no mesmo tile.
    expect(`${String(hero.position.x)},${String(hero.position.y)}`)
      .not.toBe(`${String(familiar.position.x)},${String(familiar.position.y)}`);
  });
});

describe('a troca com o familiar fora de um tile que fecha (a porta comum, ADR 0050 d.3)', () => {
  // Um beco de quatro casas com uma porta fechada em x = 3, e uma rota de ida e volta por ele. O
  // familiar nasce no fundo (x = 4), e sem tile a 2 do herói (o beco acaba) ele fica ali, a 1 do
  // herói que está na porta. O jogador atravessa o familiar trocando de lugar; o tile que ele deixa
  // é a PORTA, que fecha no `vacate` — e o familiar não cabe mais ali: a troca não pode deixar os dois
  // na mesma coordenada.
  const doorMap = {
    id: 'door-corridor', z: MAP_Z, grid: ['######', '#....#', '######'],
    interactables: [{ at: { x: 3, y: 1, z: MAP_Z }, kind: 'door', initialState: 'closed', appearanceKey: 'door-1' }],
  };
  const xs = [1, 2, 3, 4, 3, 2];
  const doorRoute = {
    id: 'door-corridor', mapId: 'door-corridor', tiles: xs.map((x) => ({ x, y: 1, z: MAP_Z })), spawnPoints: [] as object[],
  };
  const doorHunt = { id: 'door-corridor', name: 'Door corridor', recommendedLevel: 1, mapId: 'door-corridor', routeId: 'door-corridor' };

  it('nunca deixa duas criaturas no mesmo tile, e o familiar vai para o lado quando o tile do herói fechou', () => {
    const content = buildContent(raw({ hunts: [doorHunt], maps: [doorMap], routes: [doorRoute] }));
    const session = createHuntSession({
      id: 'door-session', content, huntId: 'door-corridor', difficulty: 'cautious', createdAtMs: EPOCH,
      botConfig: botConfig([manualFamiliar]),
    });
    const hero = makeHero();
    session.enter(hero);
    const ruleset = session.ruleset as HuntRuleset;
    session.advanceBy(100);
    expect(useCast(session, ruleset)).toEqual({ ok: true });
    const familiar = familiarsOf(ruleset)[0];
    if (familiar === undefined) throw new Error('o familiar não nasceu');
    const door = () => ruleset.tileOverrides.find((o) => o.kind === 'door');
    let opened = false;
    let relocated = 0;
    for (let t = 0; t < 120_000; t += 100) {
      session.advanceBy(100);
      for (const event of session.drainEvents()) {
        if (event.kind === 'creature-vanished' && event.creatureId === familiar.subject) relocated += 1;
      }
      if (door()?.state === 'open') opened = true;
      // Nunca dois no mesmo tile — o defeito era o familiar ficar na coordenada do herói.
      expect(
        `${String(hero.position.x)},${String(hero.position.y)}`,
        `t = ${String(t)} ms: o herói e o familiar dividem o tile`,
      ).not.toBe(`${String(familiar.position.x)},${String(familiar.position.y)}`);
    }
    // O cenário exercitou a porta de verdade (o walker a abriu) e a relocação que a troca recusada pede.
    expect(opened).toBe(true);
    expect(relocated).toBeGreaterThan(0);
  });
});

describe('a party que recria dois familiares na entrada (`familiarOnLogin`)', () => {
  it('nunca põe duas criaturas no mesmo tile: o familiar do primeiro membro continua ocupando o dele', () => {
    // Cada `onEnter` remonta a ocupação do zero. Sem os MONSTROS na conta, a entrada do segundo
    // membro liberava o tile do familiar do primeiro — e o herói ou o familiar do segundo nascia em
    // cima dele (12 de 40 sementes).
    const stamped = { version: 1, summonUntilMs: EPOCH + 10 * MIN, cooldownUntilMs: EPOCH + 20 * MIN };
    for (let seed = 0; seed < 40; seed += 1) {
      const session = createHuntSession({
        id: `party-${String(seed)}`, content: buildContent(raw()), huntId: 'field', difficulty: 'cautious',
        createdAtMs: EPOCH,
      });
      const hero = makeHero({ familiar: stamped });
      const other = makeHero({ familiar: stamped });
      Object.assign(other, { id: 'other' });
      session.enter(hero);
      session.enter(other);
      const ruleset = session.ruleset as HuntRuleset;
      expect(familiarsOf(ruleset, 'hero')).toHaveLength(1);
      expect(familiarsOf(ruleset, 'other')).toHaveLength(1);
      const creatures = [hero, other, ...ruleset.monsters];
      const tiles = creatures.map((c) => `${String(c.position.x)},${String(c.position.y)}`);
      expect(new Set(tiles).size, `semente ${String(seed)}: ${tiles.join(' | ')}`).toBe(creatures.length);
    }
  });
});

describe('a ability do familiar contra os monstros HOSTIS', () => {
  const withAbilities = (abilities: readonly object[]) => buildContent(raw({
    monsters: [{ ...familiarMonster, abilities }, dummy, biter, minion],
    routes: [{ ...wideRoute, tiles: [{ x: 10, y: 2, z: MAP_Z }, { x: 11, y: 2, z: MAP_Z }], spawnPoints: [
      { routeIndex: 0, radius: 3, monsterId: 'dummy', respawnDelayMs: 600_000 },
      { routeIndex: 0, radius: 3, monsterId: 'dummy', respawnDelayMs: 600_000 },
    ] }],
  }));

  it('a onda atinge os DOIS monstros na área e NUNCA o mestre; o crédito do dano é do mestre', () => {
    const { session, hero, ruleset } = start({
      content: withAbilities([blastAbility]), config: botConfig([manualFamiliar]),
    });
    session.advanceBy(100);
    const [a, b] = ruleset.monsters.filter((m) => m.monsterId === 'dummy');
    if (a === undefined || b === undefined) throw new Error('faltam os dois dummies');
    // Dois monstros colados, perto do herói: um é o alvo do mestre, o outro cai na área do primeiro.
    Object.assign(a, { position: { x: 13, y: 2, z: MAP_Z }, home: { x: 13, y: 2, z: MAP_Z } });
    Object.assign(b, { position: { x: 14, y: 3, z: MAP_Z }, home: { x: 14, y: 3, z: MAP_Z } });
    useCast(session, ruleset);
    const healthBefore = hero.health;
    const events = run(session, 10_000, 250);
    // Os dois levaram dano do familiar (vida abaixo do máximo).
    expect(a.health).toBeLessThan(1_000_000);
    expect(b.health).toBeLessThan(1_000_000);
    // O mestre nunca é atingido pela onda da própria invocação.
    expect(hero.health).toBe(healthBefore);
    const familiar = familiarsOf(ruleset)[0];
    expect(events.some((e) => e.kind === 'creature-hit' && e.creatureId === 'hero')).toBe(false);
    // O golpe sai com o familiar como atacante, e o dano soma no DPS do MESTRE (#431).
    const hits = events.filter((e) => e.kind === 'creature-hit' && e.attackerId === familiar?.subject);
    expect(hits.length).toBeGreaterThan(0);
    expect(session.aggregates.damageDealt).toBeGreaterThan(0);
  });

  it('a provocação (`summon challenge`) faz o hostil mirar o FAMILIAR e não some com o dano do mestre', () => {
    const content = buildContent(raw({
      monsters: [{ ...familiarMonster, abilities: [challengeAbility] }, dummy, biter, minion],
      routes: [{ ...wideRoute, tiles: [{ x: 10, y: 2, z: MAP_Z }, { x: 11, y: 2, z: MAP_Z }], spawnPoints: [
        { routeIndex: 0, radius: 3, monsterId: 'biter', respawnDelayMs: 600_000 },
      ] }],
    }));
    const { session, hero, ruleset } = start({ content, config: botConfig([manualFamiliar]) });
    session.advanceBy(100);
    const biterMonster = ruleset.monsters.find((m) => m.monsterId === 'biter');
    if (biterMonster === undefined) throw new Error('falta o biter');
    // O biter mira o HERÓI (colado nele), e o herói é pacifista: nada o mata nem o afasta.
    Object.assign(biterMonster, { position: { x: 12, y: 2, z: MAP_Z }, home: { x: 12, y: 2, z: MAP_Z }, targetId: 'hero' });
    useCast(session, ruleset);
    run(session, 2_000, 250);
    const familiar = familiarsOf(ruleset)[0];
    if (familiar === undefined) throw new Error('o familiar sumiu');
    // O familiar vai até o alvo do mestre (o biter), e a provocação o põe como alvo dele.
    expect(biterMonster.targetId).toBe(familiar.subject);
    expect(biterMonster.conditions.get(CHALLENGE_CONDITION_KEY)).not.toBeNull();
    // Depois da provocação o mestre para de apanhar: o biter (parado, `speed: 1`) segue mirando o
    // familiar, longe demais para alcançá-lo, e a mordida no herói deixa de sair.
    const healthAfterChallenge = hero.health;
    run(session, 4_000, 250);
    expect(hero.health).toBe(healthAfterChallenge);
    expect(biterMonster.targetId).toBe(familiar.subject);
  });

  it('a provocação não provoca o que é INVOCAÇÃO (`Monster::challengeCreature`: `isSummon()`)', () => {
    const content = buildContent(raw({
      monsters: [{ ...familiarMonster, abilities: [challengeAbility] }, dummy, biter, minion],
      routes: [{ ...wideRoute, tiles: [{ x: 10, y: 2, z: MAP_Z }, { x: 11, y: 2, z: MAP_Z }], spawnPoints: [
        { routeIndex: 0, radius: 3, monsterId: 'dummy', respawnDelayMs: 600_000 },
      ] }],
    }));
    const { session, ruleset } = start({ content, config: botConfig([manualFamiliar]) });
    session.advanceBy(100);
    const target = ruleset.monsters.find((m) => m.monsterId === 'dummy');
    if (target === undefined) throw new Error('falta o dummy');
    Object.assign(target, { position: { x: 12, y: 2, z: MAP_Z }, home: { x: 12, y: 2, z: MAP_Z }, masterId: 999 });
    useCast(session, ruleset);
    run(session, 2_000, 250);
    expect(target.conditions.get(CHALLENGE_CONDITION_KEY)).toBeNull();
    expect(target.targetId).not.toBe(familiarsOf(ruleset)[0]?.subject);
  });
});

describe('o snapshot do personagem', () => {
  it('o registro do familiar viaja no estado do personagem, e o vazio é omitido (sem bump de formato)', () => {
    const hero = makeHero();
    expect('familiar' in hero.getState()).toBe(false);
    const stamped = { version: 1, summonUntilMs: 5, cooldownUntilMs: 9 };
    const withFamiliar = makeHero({ familiar: stamped });
    expect(withFamiliar.getState().familiar).toEqual(stamped);
    expect(new CharacterRuntime(withFamiliar.getState()).familiar).toEqual(stamped);
    // Registro torto (ticket de outro formato) vira o vazio, nunca uma sessão que não abre.
    const broken = new CharacterRuntime({ ...hero.getState(), familiar: { version: 1, summonUntilMs: -1, cooldownUntilMs: 'x' } as never });
    expect(broken.familiar).toEqual({ version: 1, summonUntilMs: 0, cooldownUntilMs: 0 });
  });
});
