// A esfola de cadáver (#626, M44-08; ADR 0048 d.5/d.6, ADR 0053 d.5): o bot esfola no MESMO evento
// que coleta o loot, o jogador esfola à mão com o `use-item-on` da ferramenta no tile do cadáver, o
// material segue o filtro de Quick Loot, e o sorteio — declarado como estágio do `combat-v4` — só
// consome `session.rng` com ferramenta na mochila e um monstro esfolável.

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { BotConfigV2, Charm, Content, Progression, RawContent, Skinning } from '@draconya/content';
import { BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import type { CharmsState } from '../charms.js';
import type { CarriedItem } from '../inventory.js';
import { statsForLevel, totalXpForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import type { RngState } from '../rng.js';
import { Session } from '../session.js';
import { HuntRuleset, createHuntSession, huntRulesetFromSnapshot } from './hunt.js';
import type { CorpseState } from './hunt.js';

// A arena: cinco tiles de largura, três de altura, um rato só (não renasce dentro do teste).
const map = {
  id: 'pit', z: 7,
  grid: ['#######', '#.....#', '#.....#', '#.....#', '#######'],
};
/** A rota do herói (dois tiles) com UM ponto de spawn do monstro dado, que não renasce no teste. */
const routeOf = (monsterId: string, respawnDelayMs = 600_000) => ({
  id: 'pit', mapId: 'pit',
  tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
  spawnPoints: [{ routeIndex: 0, radius: 3, monsterId, respawnDelayMs }],
});
const hunt = { id: 'pit', name: 'Pit', recommendedLevel: 1, mapId: 'pit', routeId: 'pit' };
const MAP_Z = 7;

// Um rato de UMA vida (o primeiro golpe o mata), sem loot próprio, com a vida de cadáver do Dragon
// do Canary (670 s: `5973` 10 s, `4025` 300 s, `4026` 300 s, `4027` 60 s).
const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1, health: 1, experience: 5, attack: 0, armor: 0,
  attackIntervalMs: 2_000, speed: 1, aggroRadius: 1, attackRange: 1,
  loot: { gold: { chance: 0, min: 1, max: 1 }, items: [] }, corpseTtlMs: 670_000,
};
/** Um segundo monstro de OUTRO cadáver (`6017`), sem entrada de esfola. */
const bat = { ...rat, id: 'bat', name: 'Bat' };
/** Um terceiro, que COMPARTILHA o cadáver do rato (os dois estágios) — o Bruiser do Minotaur. */
const cousin = { ...rat, id: 'cousin', name: 'Cousin' };

const items = [
  { id: 'obsidian-knife', name: 'Obsidian Knife', kind: 'other', weight: 1, value: 0 },
  { id: 'blessed-wooden-stake', name: 'Blessed Wooden Stake', kind: 'other', weight: 5, value: 0 },
  { id: 'hide', name: 'Hide', kind: 'other', weight: 1, value: 40, creatureProduct: true },
  { id: 'heavy-hide', name: 'Heavy Hide', kind: 'other', weight: 5_000, value: 0 },
];

/** O rato do Canary: os dois estágios esfoláveis do Dragon (`5973`, `4025`). */
// O que resta de vida depois da tentativa: o `after` (`4026`, 300 s) e o `4027` (60 s) — 360 s.
const AFTER_TTL_MS = 360_000;
const STAGES = [
  { canaryItemId: 5973, durationMs: 10_000, afterTtlMs: AFTER_TTL_MS },
  { canaryItemId: 4025, durationMs: 300_000, afterTtlMs: AFTER_TTL_MS },
];
const skinRat = (over: Partial<Skinning> = {}): Skinning => ({
  id: 'rat', toolId: 'obsidian-knife', materialId: 'hide', chance: 25_000, stages: STAGES, ...over,
});
/** Chance 100 %: o `value` é a escala inteira, então nenhuma rolagem erra. */
const SURE = 100_000;

const scavenge: Charm = {
  id: 'scavenge', name: 'Scavenge', canaryCharmId: 13, category: 'minor', type: 'passive',
  chance: [60, 90, 120], points: [100, 150, 225],
};

const progression = {
  id: 'baseline', startingHealth: 1_000, startingMana: 10, startingCapacity: 1_000,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0, satchelInitialSlots: 10, containerRow: 5,
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

interface RawOptions {
  readonly profile?: string;
  readonly skinning?: readonly Skinning[];
  readonly monsters?: readonly object[];
  /** Quem nasce no único ponto de spawn (default: o rato). */
  readonly spawn?: string;
}

const raw = (options: RawOptions = {}): RawContent => {
  const base: RawContent = {
    monsters: options.monsters ?? [rat, bat, cousin], hunts: [hunt], vocations: [],
    progression: [progression], combat: [combat(options.profile ?? 'combat-v4')], stamina: [stamina],
    party: [party], spells: [], skills, weaponFamilies, items, ammunition: [],
    charms: [scavenge], skinning: options.skinning ?? [skinRat({ chance: SURE })],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map], routes: [routeOf(options.spawn ?? 'rat')],
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};

const KNIFE: CarriedItem = { instanceId: 'kit:knife', itemId: 'obsidian-knife', quantity: 1 };
const STAKE: CarriedItem = { instanceId: 'kit:stake', itemId: 'blessed-wooden-stake', quantity: 1 };

function charmed(monsterId: string, tier: 1 | 2 | 3): CharmsState {
  return {
    pointsSpent: 0, echoesSpent: 0, version: 1, tiers: { scavenge: tier }, assignments: { scavenge: monsterId },
  };
}

/** O filtro de Quick Loot (ADR 0048): o resto da config do bot vem do default do schema. */
function lootConfig(loot: BotConfigV2['loot']): BotConfigV2 {
  const emptySet = { slots: new Array(BOT_SLOTS_PER_SET).fill(null) as null[] };
  return botConfigV2Schema.parse({
    version: BOT_VOCABULARY_VERSION, activeSet: 0, sets: [emptySet, emptySet, emptySet, emptySet], loot,
  });
}

interface StartOptions {
  readonly content?: Content;
  readonly carrying?: readonly CarriedItem[];
  readonly scavenge?: { readonly monsterId: string; readonly tier: 1 | 2 | 3 };
  readonly loot?: BotConfigV2['loot'];
  readonly seed?: string;
  readonly capacity?: number;
}

function start(options: StartOptions = {}) {
  const loaded = options.content ?? buildContent(raw());
  const session = createHuntSession({
    id: options.seed ?? 'skin-session', content: loaded, huntId: 'pit', difficulty: 'cautious',
    createdAtMs: 0,
    ...(options.loot === undefined ? {} : { botConfigs: { hero: lootConfig(options.loot) } }),
  });
  const stats = statsForLevel(1, null, progression as Progression);
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
    level: 10, xp: totalXpForLevel(10, progression as Progression),
    vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: options.capacity ?? 1_000,
    inventory: { backpack: [], satchel: [...(options.carrying ?? [])], equipped: {} },
    ...(options.scavenge === undefined ? {} : { charms: charmed(options.scavenge.monsterId, options.scavenge.tier) }),
  });
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset, loaded };
}

/** Avança até `done()` ou o limite, em passos de `stepMs` — e devolve se chegou lá. */
function runUntil(session: Session, done: () => boolean, limitMs = 60_000, stepMs = 100): boolean {
  for (let t = 0; t < limitMs && !done(); t += stepMs) {
    session.advanceBy(stepMs);
    session.drainEvents();
  }
  return done();
}

/**
 * Deixa o herói matar o rato do único ponto: ele nasce no tile livre mais próximo do herói e, com
 * uma vida só, morre no primeiro golpe — o primeiro abate da sessão, na primeira janela de tempo.
 */
function killTheRat(session: Session, ruleset: HuntRuleset): CorpseState {
  expect(runUntil(session, () => session.aggregates.kills >= 1, 30_000, 50)).toBe(true);
  const corpse = ruleset.groundItems[0];
  if (corpse === undefined) throw new Error('o abate não deixou cadáver');
  return corpse;
}

const held = (hero: CharacterRuntime, itemId: string): number => [...hero.inventory.items()]
  .filter((item) => item.itemId === itemId).reduce((sum, item) => sum + item.quantity, 0);

/** O tile do cadáver como o alvo de um `use-item-on`. */
const tileOf = (corpse: CorpseState) => ({
  kind: 'position' as const, position: { x: corpse.position.x, y: corpse.position.y, z: corpse.position.z },
});

describe('o bot esfola no MESMO evento em que coleta (ADR 0048 d.5)', () => {
  it('com a ferramenta na mochila, o material entra na mochila pelo Quick Loot e o cadáver fica esfolado', () => {
    const { session, hero, ruleset } = start({ carrying: [KNIFE] });
    const corpse = killTheRat(session, ruleset);
    expect(held(hero, 'hide')).toBe(1);
    // A ferramenta NÃO é consumida.
    expect(held(hero, 'obsidian-knife')).toBe(1);
    expect(corpse.skinned).toBe(true);
    expect(corpse.items).toEqual([]);
    expect(session.aggregates.itemsLooted).toBe(1);
    // O `diedAtMs` é o relógio lógico da morte, e é ele que dá a idade para a esfola à mão.
    expect(corpse.diedAtMs).toBeDefined();
  });

  it('o material segue o filtro de Quick Loot: o que o filtro recusa fica NO CADÁVER, com id determinístico', () => {
    const { session, hero, ruleset } = start({
      carrying: [KNIFE], loot: { filter: 'accept', itemIds: [], autoSell: [] },
    });
    const corpse = killTheRat(session, ruleset);
    // `accept` com lista vazia não aceita nada: a pele espera no cadáver, ao lado de onde cairia o loot.
    expect(held(hero, 'hide')).toBe(0);
    expect(corpse.items).toEqual([{ instanceId: 'skin-session:0', itemId: 'hide', quantity: 1 }]);
    expect(corpse.skinned).toBe(true);
    // E dá para pegar de lá como qualquer item que o filtro deixou (`take-loot` de uma instância).
    hero.position = { ...corpse.position };
    expect(ruleset.takeLoot(session, 'hero', corpse.id, 'skin-session:0')).toEqual({ ok: true });
    expect(held(hero, 'hide')).toBe(1);
  });

  it('a autovenda individual vende o material na hora (ADR 0048 d.2)', () => {
    const { session, hero, ruleset } = start({
      carrying: [KNIFE], loot: { filter: 'skip', itemIds: [], autoSell: ['hide'] },
    });
    killTheRat(session, ruleset);
    expect(held(hero, 'hide')).toBe(0);
    expect(hero.goldDelta).toBe(40);
  });

  it('o material que não cabe pela capacidade fica no cadáver, como qualquer item', () => {
    const heavy = buildContent(raw({ skinning: [skinRat({ chance: SURE, materialId: 'heavy-hide' })] }));
    const { session, hero, ruleset } = start({ content: heavy, carrying: [KNIFE], capacity: 100 });
    const corpse = killTheRat(session, ruleset);
    expect(held(hero, 'heavy-hide')).toBe(0);
    expect(corpse.items?.map((item) => item.itemId)).toEqual(['heavy-hide']);
  });

  it('a faca esfola o monstro dela e a estaca não: cada ferramenta tem a sua tabela', () => {
    const { session, hero, ruleset } = start({ carrying: [STAKE] });
    const corpse = killTheRat(session, ruleset);
    expect(held(hero, 'hide')).toBe(0);
    // Sem a ferramenta CERTA não houve tentativa: o cadáver continua esfolável à mão.
    expect(corpse.skinned).toBeUndefined();
  });

  it('a chance do conteúdo (25 %) vale: 25 000 de 100 000, sem charm', () => {
    // Um rato de uma vida que renasce a cada segundo: centenas de abates com a faca na mochila.
    const many = { ...routeOf('rat', 1_000), spawnPoints: [
      { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 1_000 },
      { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 1_000 },
      { routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 1_000 },
    ] };
    const content = buildContent({ ...raw({ skinning: [skinRat()] }), routes: [many] });
    const { session, hero } = start({ content, carrying: [KNIFE] });
    runUntil(session, () => session.aggregates.kills >= 600, 3_000_000, 500);
    const kills = session.aggregates.kills;
    expect(kills).toBeGreaterThanOrEqual(600);
    const rate = held(hero, 'hide') / kills;
    expect(rate).toBeGreaterThan(0.19);
    expect(rate).toBeLessThan(0.31);
  });
});

describe('o sorteio da esfola é um estágio declarado: sem ferramenta não consome RNG', () => {
  /** O estado do `Rng` da sessão quando o rato acaba de morrer. */
  const rngAfterKill = (content: Content, carrying: readonly CarriedItem[], seed = 'rng'): RngState => {
    const { session, ruleset } = start({ content, carrying, seed });
    killTheRat(session, ruleset);
    return session.rng.getState();
  };
  const without = buildContent(raw({ skinning: [] }));
  const withSkinning = buildContent(raw({ skinning: [skinRat({ chance: SURE })] }));

  it('sem ferramenta, o abate consome exatamente o RNG de uma hunt sem esfola', () => {
    expect(rngAfterKill(withSkinning, [])).toEqual(rngAfterKill(without, []));
  });

  it('com a ferramenta errada também não', () => {
    expect(rngAfterKill(withSkinning, [STAKE])).toEqual(rngAfterKill(without, [STAKE]));
  });

  it('com a ferramenta, UMA rolagem a mais — e o Scavenge não muda a contagem, só o intervalo', () => {
    const plain = rngAfterKill(withSkinning, [KNIFE]);
    expect(plain).not.toEqual(rngAfterKill(without, [KNIFE]));
    // `chance` 25 000 e o charm no rato: a MESMA quantidade de sorteios (um), o estado final é igual.
    const sure = buildContent(raw({ skinning: [skinRat({ chance: 25_000 })] }));
    const charmedRun = start({ content: sure, carrying: [KNIFE], scavenge: { monsterId: 'rat', tier: 1 }, seed: 'rng' });
    killTheRat(charmedRun.session, charmedRun.ruleset);
    const plainRun = start({ content: sure, carrying: [KNIFE], seed: 'rng' });
    killTheRat(plainRun.session, plainRun.ruleset);
    expect(charmedRun.session.rng.getState()).toEqual(plainRun.session.rng.getState());
  });

  it('num monstro que não é esfolável a ferramenta não sorteia nada', () => {
    // O `bat` não tem entrada: a faca na mochila não toca o `session.rng`.
    const rngOf = (skinning: readonly Skinning[]) => {
      const content = buildContent(raw({ spawn: 'bat', skinning }));
      const { session, ruleset } = start({ content, carrying: [KNIFE], seed: 'bat' });
      killTheRat(session, ruleset);
      return session.rng.getState();
    };
    expect(rngOf([skinRat({ chance: SURE })])).toEqual(rngOf([]));
  });

  it('a sessão fixada em combat-v3 nunca esfola, mesmo com a faca e a tabela', () => {
    const v3 = buildContent(raw({ profile: 'combat-v3', skinning: [skinRat({ chance: SURE })] }));
    const { session, hero, ruleset } = start({ content: v3, carrying: [KNIFE], seed: 'rng' });
    const corpse = killTheRat(session, ruleset);
    expect(held(hero, 'hide')).toBe(0);
    expect(corpse.skinned).toBeUndefined();
    expect(session.rng.getState()).toEqual(rngAfterKill(buildContent(raw({ profile: 'combat-v3', skinning: [] })), [KNIFE]));
    // E à mão tampouco: a ferramenta não é reconhecida como tal neste perfil.
    hero.position = { ...corpse.position };
    expect(ruleset.useItemOn(session, 'hero', { instanceId: 'kit:knife' }, 1, tileOf(corpse)))
      .toMatchObject({ ok: false, reason: 'not-usable' });
  });
});

describe('a esfola à mão: use-item-on da ferramenta no tile do cadáver (ADR 0049 d.3)', () => {
  /** Um cadáver ainda não esfolado: o herói mata o rato SEM a faca e só depois a recebe. */
  function withUnskinnedCorpse(content?: Content) {
    const built = start(content === undefined ? {} : { content });
    const corpse = killTheRat(built.session, built.ruleset);
    expect(corpse.skinned).toBeUndefined();
    built.hero.inventory.forceAdd(KNIFE, built.loaded.items, { backpackSlots: 0, satchelSlots: 10, row: 5 });
    return { ...built, corpse };
  }

  it('esfola o cadáver: o material vai para a mochila pelo filtro, e o cadáver não esfola de novo', () => {
    const { session, hero, ruleset, corpse } = withUnskinnedCorpse();
    hero.position = { x: corpse.position.x, y: corpse.position.y + 1, z: MAP_Z };
    // Adjacente: alcance, linha de visão, janela do 1º estágio (a morte foi há poucos ms).
    expect(ruleset.useItemOn(session, 'hero', { instanceId: 'kit:knife' }, 1, tileOf(corpse))).toEqual({ ok: true });
    expect(held(hero, 'hide')).toBe(1);
    expect(held(hero, 'obsidian-knife')).toBe(1);
    expect(corpse.skinned).toBe(true);
    // Uma vez só: o cadáver "esfolado" não é chave de tabela nenhuma (o Canary responde "not possible").
    session.advanceBy(2_000);
    expect(ruleset.useItemOn(session, 'hero', { instanceId: 'kit:knife' }, 2, tileOf(corpse)))
      .toMatchObject({ ok: false, reason: 'not-usable' });
    expect(held(hero, 'hide')).toBe(1);
  });

  it('a tentativa que falha gasta o cadáver do mesmo jeito', () => {
    // `chance: 1` de 100 000: a rolagem só acerta em 1 caso em 100 000, e a semente fixa do teste erra.
    const never = buildContent(raw({ skinning: [skinRat({ chance: 1 })] }));
    const { session, hero, ruleset, corpse } = withUnskinnedCorpse(never);
    hero.position = { ...corpse.position };
    expect(ruleset.useItemOn(session, 'hero', { instanceId: 'kit:knife' }, 1, tileOf(corpse))).toEqual({ ok: true });
    expect(held(hero, 'hide')).toBe(0);
    expect(corpse.skinned).toBe(true);
  });

  it('a janela é por estágio: aos 305 s o cadáver ainda está no 2º estágio (`4025`, até 310 s) e se esfola', () => {
    const { session, hero, ruleset, corpse } = withUnskinnedCorpse();
    hero.position = { ...corpse.position };
    // 305 s depois da morte: 5 s antes de o cadáver decair para o `4026`.
    session.advanceBy(305_000);
    expect(ruleset.groundItems).toContain(corpse);
    const late = ruleset.useItemOn(session, 'hero', { instanceId: 'kit:knife' }, 1, tileOf(corpse));
    expect(late).toEqual({ ok: true });
    expect(held(hero, 'hide')).toBe(1);
  });

  it('depois de 310 s o cadáver está no `4026`: continua no chão, mas a ferramenta não o esfola mais', () => {
    const { session, hero, ruleset, corpse } = withUnskinnedCorpse();
    hero.position = { ...corpse.position };
    session.advanceBy(312_000);
    // Ele ainda está no chão (a vida dele é de 670 s) — só não é mais esfolável.
    expect(ruleset.groundItems).toContain(corpse);
    expect(ruleset.useItemOn(session, 'hero', { instanceId: 'kit:knife' }, 1, tileOf(corpse)))
      .toMatchObject({ ok: false, reason: 'not-usable' });
    expect(held(hero, 'hide')).toBe(0);
    expect(corpse.skinned).toBeUndefined();
  });

  it('recusas em palavras do Canary e NENHUMA consome sorteio', () => {
    const { session, hero, ruleset, corpse } = withUnskinnedCorpse();
    const before = session.rng.getState();
    const use = (target: Parameters<HuntRuleset['useItemOn']>[4], ref = 'kit:knife') => {
      // Um `seq` novo a cada chamada e a exaustão de ação vencida entre uma e outra.
      session.advanceBy(2_000);
      return ruleset.useItemOn(session, 'hero', { instanceId: ref }, 1, target);
    };
    hero.position = { ...corpse.position };

    // Sem alvo posicional: criatura, personagem, alvo inválido.
    expect(use({ kind: 'monster', subject: 'm:1' })).toMatchObject({ ok: false, reason: 'not-usable' });
    expect(use({ kind: 'invalid' })).toMatchObject({ ok: false, reason: 'not-usable' });
    // Um tile sem cadáver.
    expect(use({ kind: 'position', position: { x: 5, y: 3, z: MAP_Z } })).toMatchObject({ ok: false, reason: 'not-usable' });
    // A instância que não existe.
    expect(use(tileOf(corpse), 'nao-existe')).toMatchObject({ ok: false, reason: 'not-carried' });
    // Longe demais: a esfola é o `Actions::canUse` do Canary (adjacente, `areInRange<1, 1>`) — o
    // `skinning.lua` não chama `allowFarUse`, então 2 tiles já é `out-of-range`.
    hero.position = { x: corpse.position.x, y: corpse.position.y + 2, z: MAP_Z };
    expect(use(tileOf(corpse))).toMatchObject({ ok: false, reason: 'out-of-range' });
    hero.position = { x: corpse.position.x - 2, y: corpse.position.y, z: MAP_Z };
    expect(use(tileOf(corpse))).toMatchObject({ ok: false, reason: 'out-of-range' });
    // Muito longe (o que o `canUseFar` 7×5 das runas aceitaria, com linha de visão) também.
    hero.position = { x: corpse.position.x + 6, y: corpse.position.y, z: MAP_Z };
    expect(use(tileOf(corpse))).toMatchObject({ ok: false, reason: 'out-of-range' });
    // Outro andar, mesmo em cima do tile.
    hero.position = { x: corpse.position.x, y: corpse.position.y, z: MAP_Z + 1 };
    expect(use(tileOf(corpse))).toMatchObject({ ok: false, reason: 'out-of-range' });
    expect(session.rng.getState()).toEqual(before);
    expect(corpse.skinned).toBeUndefined();
  });

  it('adjacente vale na diagonal também: `|dx| <= 1` e `|dy| <= 1`, o `areInRange<1, 1>` do Canary', () => {
    const { session, hero, ruleset, corpse } = withUnskinnedCorpse();
    const { x, y } = corpse.position;
    hero.position = { x: x + 1, y: y + 1, z: MAP_Z };
    expect(ruleset.useItemOn(session, 'hero', { instanceId: 'kit:knife' }, 1, tileOf(corpse))).toEqual({ ok: true });
    expect(held(hero, 'hide')).toBe(1);
  });

  it('a ferramenta errada para o monstro é "not possible" e não gasta o cadáver', () => {
    const { session, hero, ruleset, corpse } = withUnskinnedCorpse();
    hero.inventory.forceAdd(STAKE, buildContent(raw()).items, { backpackSlots: 0, satchelSlots: 10, row: 5 });
    hero.position = { ...corpse.position };
    const before = session.rng.getState();
    expect(ruleset.useItemOn(session, 'hero', { instanceId: 'kit:stake' }, 1, tileOf(corpse)))
      .toMatchObject({ ok: false, reason: 'not-usable' });
    expect(session.rng.getState()).toEqual(before);
    expect(corpse.skinned).toBeUndefined();
  });

  it('use-item sem alvo na ferramenta não faz nada', () => {
    const { session, hero, ruleset } = withUnskinnedCorpse();
    expect(ruleset.useItem(session, 'hero', { instanceId: 'kit:knife' }, 1))
      .toMatchObject({ ok: false, reason: 'not-usable' });
    expect(held(hero, 'hide')).toBe(0);
  });

  it('o material que o filtro recusa fica no cadáver, e o resto que já esperava lá NÃO é reprocessado', () => {
    const { session, hero, ruleset, loaded } = start({ loot: { filter: 'accept', itemIds: [], autoSell: [] } });
    const corpse = killTheRat(session, ruleset);
    hero.inventory.forceAdd(KNIFE, loaded.items, { backpackSlots: 0, satchelSlots: 10, row: 5 });
    // Um item que espera no cadáver desde o abate (o filtro `accept []` o deixou lá).
    corpse.items = [{ instanceId: 'skin-session:99', itemId: 'heavy-hide', quantity: 1 }];
    hero.position = { ...corpse.position };
    expect(ruleset.useItemOn(session, 'hero', { instanceId: 'kit:knife' }, 1, tileOf(corpse))).toEqual({ ok: true });
    expect(corpse.items.map((item) => item.itemId)).toEqual(['heavy-hide', 'hide']);
    expect(held(hero, 'hide')).toBe(0);
  });
});

describe('a tentativa de esfola reinicia o decaimento do cadáver (o `transform(skin.after)` do Canary)', () => {
  // O Canary roda `topItem:transform(skin.after)` com ou sem sucesso, e o `Item::setID` do item
  // novo reinicia o `duration`: o Dragon esfolado vira o `4026` (300 s) e depois o `4027` (60 s),
  // 360 s a partir da TENTATIVA, e não mais o que faltava dos 670 s do abate.
  const alive = (ruleset: HuntRuleset, corpse: CorpseState) => ruleset.groundItems.includes(corpse);
  /** Avança o relógio da sessão até o instante lógico `atMs`. */
  const advanceTo = (session: Session, atMs: number) => {
    session.advanceBy(atMs - session.nowMs);
    session.drainEvents();
  };
  /** O cadáver ainda não esfolado, com a faca já na mochila do herói e o herói em cima dele. */
  function readyToSkin(content?: Content) {
    const built = start(content === undefined ? {} : { content });
    const corpse = killTheRat(built.session, built.ruleset);
    built.hero.inventory.forceAdd(KNIFE, built.loaded.items, { backpackSlots: 0, satchelSlots: 10, row: 5 });
    built.hero.position = { ...corpse.position };
    return { ...built, corpse, diedAt: corpse.diedAtMs as number };
  }
  const skin = (built: ReturnType<typeof readyToSkin>) => built.ruleset.useItemOn(
    built.session, 'hero', { instanceId: 'kit:knife' }, 1, tileOf(built.corpse),
  );

  it('controle: sem esfola o cadáver vive os 670 s inteiros (`corpseTtlMs`)', () => {
    const { session, ruleset } = start();
    const corpse = killTheRat(session, ruleset);
    const diedAt = corpse.diedAtMs as number;
    advanceTo(session, diedAt + 669_999);
    expect(alive(ruleset, corpse)).toBe(true);
    advanceTo(session, diedAt + 670_000);
    expect(alive(ruleset, corpse)).toBe(false);
  });

  it('esfolado no abate pelo bot: vive 360 s a partir do abate, e some com o que o filtro deixou', () => {
    // O filtro `accept []` não leva nada: o material espera no cadáver e some junto com ele.
    const { session, ruleset } = start({ carrying: [KNIFE], loot: { filter: 'accept', itemIds: [], autoSell: [] } });
    const corpse = killTheRat(session, ruleset);
    expect(corpse.skinned).toBe(true);
    expect(corpse.items?.map((item) => item.itemId)).toEqual(['hide']);
    const diedAt = corpse.diedAtMs as number;
    advanceTo(session, diedAt + 359_999);
    expect(alive(ruleset, corpse)).toBe(true);
    advanceTo(session, diedAt + 360_000);
    expect(alive(ruleset, corpse)).toBe(false);
  });

  it('a tentativa que FALHA reinicia do mesmo jeito (o transform roda nos dois casos)', () => {
    const never = buildContent(raw({ skinning: [skinRat({ chance: 1 })] }));
    const { session, hero, ruleset } = start({ content: never, carrying: [KNIFE] });
    const corpse = killTheRat(session, ruleset);
    expect(corpse.skinned).toBe(true);
    expect(held(hero, 'hide')).toBe(0);
    const diedAt = corpse.diedAtMs as number;
    advanceTo(session, diedAt + 359_999);
    expect(alive(ruleset, corpse)).toBe(true);
    advanceTo(session, diedAt + 360_000);
    expect(alive(ruleset, corpse)).toBe(false);
  });

  it('esfolado À MÃO aos 100 s: some 360 s depois da tentativa (aos 460 s), não aos 670 s', () => {
    const built = readyToSkin();
    advanceTo(built.session, built.diedAt + 100_000);
    expect(skin(built)).toEqual({ ok: true });
    const skinnedAt = built.session.nowMs;
    expect(skinnedAt).toBe(built.diedAt + 100_000);
    advanceTo(built.session, skinnedAt + 359_999);
    expect(alive(built.ruleset, built.corpse)).toBe(true);
    advanceTo(built.session, skinnedAt + 360_000);
    expect(alive(built.ruleset, built.corpse)).toBe(false);
  });

  it('esfolado à mão no fim da janela (305 s): vive até 665 s, 5 s ANTES dos 670 s do abate', () => {
    const built = readyToSkin();
    advanceTo(built.session, built.diedAt + 305_000);
    expect(skin(built)).toEqual({ ok: true });
    advanceTo(built.session, built.diedAt + 664_999);
    expect(alive(built.ruleset, built.corpse)).toBe(true);
    advanceTo(built.session, built.diedAt + 665_000);
    expect(alive(built.ruleset, built.corpse)).toBe(false);
  });

  it('a tentativa RECUSADA não mexe no prazo: fora da janela (312 s) o cadáver ainda vive os 670 s', () => {
    const built = readyToSkin();
    advanceTo(built.session, built.diedAt + 312_000);
    expect(skin(built)).toMatchObject({ ok: false, reason: 'not-usable' });
    advanceTo(built.session, built.diedAt + 669_999);
    expect(alive(built.ruleset, built.corpse)).toBe(true);
    advanceTo(built.session, built.diedAt + 670_000);
    expect(alive(built.ruleset, built.corpse)).toBe(false);
  });

  it('o prazo novo é o do ESTÁGIO: o `afterTtlMs` do conteúdo manda, não a constante dos 360 s', () => {
    // O `after` de cada estágio é o dele — aqui o primeiro (abate) deixa 100 s e o segundo 200 s.
    const custom = buildContent(raw({
      skinning: [skinRat({
        chance: SURE,
        stages: [
          { canaryItemId: 5973, durationMs: 10_000, afterTtlMs: 100_000 },
          { canaryItemId: 4025, durationMs: 300_000, afterTtlMs: 200_000 },
        ],
      })],
    }));
    const atKill = start({ content: custom, carrying: [KNIFE] });
    const killed = killTheRat(atKill.session, atKill.ruleset);
    const diedAt = killed.diedAtMs as number;
    advanceTo(atKill.session, diedAt + 99_999);
    expect(alive(atKill.ruleset, killed)).toBe(true);
    advanceTo(atKill.session, diedAt + 100_000);
    expect(alive(atKill.ruleset, killed)).toBe(false);

    const byHand = readyToSkin(custom);
    advanceTo(byHand.session, byHand.diedAt + 50_000);
    expect(skin(byHand)).toEqual({ ok: true });
    const skinnedAt = byHand.session.nowMs;
    advanceTo(byHand.session, skinnedAt + 199_999);
    expect(alive(byHand.ruleset, byHand.corpse)).toBe(true);
    advanceTo(byHand.session, skinnedAt + 200_000);
    expect(alive(byHand.ruleset, byHand.corpse)).toBe(false);
  });

  it('em party com bolsa compartilhada o cadáver esfolado no abate também vive 360 s', () => {
    const stats = statsForLevel(1, null, progression as Progression);
    const member = (id: string, carrying: readonly CarriedItem[]) => new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 }, health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 10, xp: totalXpForLevel(10, progression as Progression),
      vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0, gold: 0, goldDelta: 0,
      alive: true, cooldowns: {}, capacity: 1_000,
      inventory: { backpack: [], satchel: [...carrying], equipped: {} },
    });
    const session = createHuntSession({
      id: 'skin-party-ttl', content: buildContent(raw()), huntId: 'pit', difficulty: 'cautious', createdAtMs: 0,
      partyOptions: { leaderId: 'lead', mode: 'split', shareCosts: false, splitLoot: true },
    });
    session.enter(member('lead', []));
    session.enter(member('mate', [KNIFE]));
    const ruleset = session.ruleset as HuntRuleset;
    const corpse = killTheRat(session, ruleset);
    expect(corpse.skinned).toBe(true);
    const diedAt = corpse.diedAtMs as number;
    advanceTo(session, diedAt + 359_999);
    expect(alive(ruleset, corpse)).toBe(true);
    advanceTo(session, diedAt + 360_000);
    expect(alive(ruleset, corpse)).toBe(false);
  });

  it('o prazo novo sobrevive ao snapshot: o cadáver restaurado também some aos 360 s da tentativa', () => {
    const built = readyToSkin();
    advanceTo(built.session, built.diedAt + 100_000);
    expect(skin(built)).toEqual({ ok: true });
    const skinnedAt = built.session.nowMs;

    const snapshot = built.session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, built.loaded) as HuntRuleset, Rng.fromSeed('resume'),
    );
    const resumedRuleset = resumed.ruleset as HuntRuleset;
    const stillThere = () => resumedRuleset.groundItems.some((c) => c.id === built.corpse.id);
    advanceTo(resumed, skinnedAt + 359_999);
    expect(stillThere()).toBe(true);
    advanceTo(resumed, skinnedAt + 360_000);
    expect(stillThere()).toBe(false);
  });
});

describe('o Scavenge encolhe o intervalo — no cadáver do monstro escolhido e nos que compartilham o dele', () => {
  // O rato e o primo compartilham os DOIS estágios do cadáver (`5973`/`4025`, como o Minotaur e o
  // Bruiser); o morcego tem o dele (`6017`).
  const skinning = [
    skinRat(), skinRat({ id: 'cousin' }),
    skinRat({ id: 'bat', stages: [{ canaryItemId: 6017, durationMs: 10_000, afterTtlMs: AFTER_TTL_MS }] }),
  ];
  /** Abates de `monster` (renasce a cada segundo, três pontos) com o charm dado, chance real de 25 %. */
  const farm = (
    assign: { monsterId: string; tier: 1 | 2 | 3 } | undefined, n = 600, stepMs = 500,
  ) => {
    const spawns = [1, 2, 3].map(() => ({
      routeIndex: 0, radius: 3, monsterId: 'rat', respawnDelayMs: 1_000,
    }));
    const content = buildContent({
      ...raw({ skinning }), routes: [{ ...routeOf('rat'), spawnPoints: spawns }],
    });
    const { session, hero } = start({
      content, carrying: [KNIFE], seed: 'scavenge', ...(assign === undefined ? {} : { scavenge: assign }),
    });
    runUntil(session, () => session.aggregates.kills >= n, 3_000_000, stepMs);
    return { kills: session.aggregates.kills, hides: held(hero, 'hide'), rng: session.rng.getState() };
  };

  it.each([
    [1, 25_000 / 60_000],
    [2, 25_000 / 90_000],
    [3, 25_000 / 120_000],
  ] as const)('tier %i: a taxa de esfola é 25 000 / (100 000 × chance / 100)', (tier, expected) => {
    const { kills, hides } = farm({ monsterId: 'rat', tier });
    expect(Math.abs(hides / kills - expected)).toBeLessThan(0.06);
  });

  it('o tier 1 aumenta a taxa sobre o 25 % sem charm; o tier 3 a REDUZ (a fórmula do Canary)', () => {
    const plain = farm(undefined);
    const tier1 = farm({ monsterId: 'rat', tier: 1 });
    const tier3 = farm({ monsterId: 'rat', tier: 3 });
    expect(tier1.hides / tier1.kills).toBeGreaterThan(plain.hides / plain.kills);
    expect(tier3.hides / tier3.kills).toBeLessThan(plain.hides / plain.kills);
  });

  it('o charm num monstro que COMPARTILHA o cadáver vale exatamente como no dono dele', () => {
    expect(farm({ monsterId: 'cousin', tier: 1 })).toEqual(farm({ monsterId: 'rat', tier: 1 }));
  });

  it('o charm num monstro de OUTRO cadáver, ou num que nem é esfolável, não muda nada', () => {
    const plain = farm(undefined);
    expect(farm({ monsterId: 'bat', tier: 1 })).toEqual(plain);
    // O `bat` do conteúdo de teste acima é esfolável; um monstro fora da tabela também não conta.
    expect(farm({ monsterId: 'nao-existe', tier: 1 })).toEqual(plain);
  });

  it('1 Hz == 10 Hz: as mesmas peles e o mesmo estado do gerador, com ou sem charm', () => {
    for (const assign of [undefined, { monsterId: 'rat', tier: 2 as const }]) {
      const slow = farm(assign, 120, 1_000);
      const fast = farm(assign, 120, 100);
      expect(fast).toEqual(slow);
    }
  });
});

describe('em party: o material da esfola vai para a bolsa (modalidade compartilhada) ou para o dono do cadáver', () => {
  const member = (id: string, carrying: readonly CarriedItem[]) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 }, health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 10, xp: totalXpForLevel(10, progression as Progression),
      vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0, gold: 0, goldDelta: 0,
      alive: true, cooldowns: {}, capacity: 1_000,
      inventory: { backpack: [], satchel: [...carrying], equipped: {} },
    });
  };
  const party = (
    splitLoot: boolean, members: readonly [string, readonly CarriedItem[]][], skinning?: readonly Skinning[],
  ) => {
    const session = createHuntSession({
      id: 'skin-party', content: buildContent(raw(skinning === undefined ? {} : { skinning })),
      huntId: 'pit', difficulty: 'cautious', createdAtMs: 0,
      partyOptions: { leaderId: 'lead', mode: 'split', shareCosts: false, splitLoot },
    });
    for (const [id, carrying] of members) session.enter(member(id, carrying));
    return { session, ruleset: session.ruleset as HuntRuleset };
  };

  it('splitLoot ligado: quem entre os elegíveis tem a ferramenta esfola, e a pele cai na BOLSA da party', () => {
    const { session, ruleset } = party(true, [['lead', []], ['mate', [KNIFE]]]);
    killTheRat(session, ruleset);
    const bag = ruleset.getState().partyBag;
    expect(bag?.items.map((entry) => entry.item.itemId)).toEqual(['hide']);
  });

  it('splitLoot ligado e ninguém com a ferramenta: nenhuma pele, e o RNG é o de uma party sem esfola', () => {
    const noTool = party(true, [['lead', []], ['mate', []]]);
    killTheRat(noTool.session, noTool.ruleset);
    expect(noTool.ruleset.getState().partyBag?.items ?? []).toEqual([]);
    const plain = party(true, [['lead', []], ['mate', []]], []);
    killTheRat(plain.session, plain.ruleset);
    expect(noTool.session.rng.getState()).toEqual(plain.session.rng.getState());
  });

  it('splitLoot desligado: o dono sorteado do cadáver esfola com a ferramenta DELE', () => {
    // Os dois têm a faca; o material vai para o cadáver e, pelo filtro padrão, para a mochila do dono.
    const { session, ruleset } = party(false, [['lead', [KNIFE]], ['mate', [{ ...KNIFE, instanceId: 'kit:knife2' }]]]);
    const corpse = killTheRat(session, ruleset);
    const owner = session.participants.find((p) => p.id === corpse.ownerId) as CharacterRuntime;
    expect(owner).toBeDefined();
    expect(held(owner, 'hide')).toBe(1);
    const other = session.participants.find((p) => p.id !== corpse.ownerId) as CharacterRuntime;
    expect(held(other, 'hide')).toBe(0);
    expect(corpse.skinned).toBe(true);
  });
});

describe('o cadáver esfolado e a idade sobrevivem ao snapshot (restore-invariance)', () => {
  it('skinned e diedAtMs voltam do snapshot, e a esfola à mão continua recusada do outro lado', () => {
    const { session, ruleset, loaded } = start({ carrying: [KNIFE] });
    const corpse = killTheRat(session, ruleset);
    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed('resume'),
    );
    const back = (resumed.ruleset as HuntRuleset).groundItems.find((c) => c.id === corpse.id);
    expect(back).toMatchObject({ skinned: true, diedAtMs: corpse.diedAtMs });
    const hero = resumed.participants[0] as CharacterRuntime;
    hero.position = { ...corpse.position };
    expect((resumed.ruleset as HuntRuleset).useItemOn(resumed, 'hero', { instanceId: 'kit:knife' }, 1, tileOf(corpse)))
      .toMatchObject({ ok: false, reason: 'not-usable' });
  });

  it('um cadáver de snapshot anterior (sem diedAtMs) não se esfola à mão — a idade é desconhecida', () => {
    const { session, hero, ruleset, loaded } = start();
    const corpse = killTheRat(session, ruleset);
    hero.inventory.forceAdd(KNIFE, loaded.items, { backpackSlots: 0, satchelSlots: 10, row: 5 });
    hero.position = { ...corpse.position };
    Object.assign(corpse, { diedAtMs: undefined });
    expect(ruleset.useItemOn(session, 'hero', { instanceId: 'kit:knife' }, 1, tileOf(corpse)))
      .toMatchObject({ ok: false, reason: 'not-usable' });
    expect(corpse.skinned).toBeUndefined();
  });
});
