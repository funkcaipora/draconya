import { buildContent, placeholderAppearances } from '@draconya/content';
import type { BotConfigV2, Content, OutfitLook, RawContent } from '@draconya/content';
import { BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema, botSlotSchema } from '@draconya/content';
import type { BotSlot } from '@draconya/content';
import { describe, expect, it, vi } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { resolveDamage } from '../combat/damage.js';
import type { InventoryState } from '../inventory.js';
import { MonsterRuntime } from '../monster/monster.js';
import { statsForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import { Session } from '../session.js';
import type { DomainEvent, SessionSnapshot } from '../session.js';
import { HuntRuleset, createHuntSession, huntRulesetFromSnapshot } from './hunt.js';

// O resolver canônico é ENVOLVIDO, não substituído (como em `hunt.test.ts`): delega para o real, e o
// teste do ataque `outfit` prova que NENHUM golpe de monstro passou por ele.
vi.mock('../combat/damage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../combat/damage.js')>();
  return { ...actual, resolveDamage: vi.fn(actual.resolveDamage) };
});

// A condição `outfit` no motor (#621, M44-03, ADR 0041 d.1): o ataque e a defesa `outfit` de
// monstro, a Creature Illusion e a Chameleon Rune do jogador, a imunidade, a fusão do Canary e a
// expiração na fila. Sala pequena, como `hunt.test.ts`: num mapa de 4×3 dá para dizer, olhando,
// quem está onde — e o que entra na área é o que a geometria diz, não o acaso.

const map = {
  id: 'arena', z: 7,
  grid: ['######', '#....#', '#....#', '#....#', '######'],
};
const route = {
  id: 'arena-loop', mapId: 'arena',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 1, z: 7 }, { x: 4, y: 1, z: 7 },
    { x: 4, y: 2, z: 7 }, { x: 4, y: 3, z: 7 }, { x: 3, y: 3, z: 7 }, { x: 2, y: 3, z: 7 },
    { x: 1, y: 3, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [] as unknown[],
};
const hunt = { id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop' };
const progression = {
  id: 'baseline', startingHealth: 500_000, startingMana: 500, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
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
const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const party = { id: 'baseline', maxMembers: 4 };
const skills = [
  { id: 'melee', name: 'Corpo a Corpo', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5 },
  { id: 'magic', name: 'Magia', startingLevel: 10, curve: { base: 100, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0 },
];
const weaponFamilies = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
];
const items = [
  { id: 'worm', name: 'Worm', kind: 'other', weight: 1, value: 0 },
];

/** Um monstro parado e inofensivo: só existe para ser DESENHADO ou para ficar na área de alguém. */
const inert = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, recommendedLevel: 1, health: 100_000, experience: 0, attack: 0, armor: 0,
  attackIntervalMs: 2_000, speed: 300, aggroRadius: 0, attackRange: 1, loot: { items: [] },
  ...extra,
});

const disguise = (look: OutfitLook, durationMs: number) => ({
  key: 'outfit', merge: 'strongest' as const, durationMs, effect: { kind: 'outfit' as const, look },
});

const illusionSpell = {
  id: 'creature-illusion-test', name: 'Creature Illusion', manaCost: 100, cooldownMs: 2_000,
  group: 'support', groupCooldownMs: 2_000, effect: { kind: 'illusion' as const, durationMs: 3_000 },
};
const longIllusionSpell = {
  ...illusionSpell, id: 'creature-illusion-long', effect: { kind: 'illusion' as const, durationMs: 10_000 },
};
const chameleonRune = {
  id: 'chameleon-rune-test', name: 'Chameleon Rune', price: 210, group: 'support',
  groupCooldownMs: 2_000, cooldownMs: 2_000, actionExhaustMs: 1_000,
  requires: { level: 1, magicLevel: 0 },
  effect: { kind: 'chameleon' as const, durationMs: 3_000 },
};

const raw = (over: Partial<RawContent> = {}): RawContent => {
  const base: RawContent = {
    monsters: [inert('rat', { illusionable: true })], hunts: [hunt], vocations: [],
    progression: [progression], combat: [combat], stamina: [stamina], party: [party],
    spells: [illusionSpell, longIllusionSpell], skills, weaponFamilies, items, supplies: [chameleonRune], ammunition: [],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map], routes: [route], ...over,
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};

const v2Set = (given: readonly (Partial<BotSlot> | null)[]) => {
  // `auto: false`: o slot é só do disparo MANUAL (`use-slot`) — um `support` sem condição o bot
  // relançaria a cada vencimento do cooldown, e o teste mediria o bot em vez da magia.
  const slots = given.map((slot) => (slot === null ? null : botSlotSchema.parse({ auto: false, ...slot })));
  while (slots.length < BOT_SLOTS_PER_SET) slots.push(null);
  return { slots };
};
const botConfig = (active: readonly (Partial<BotSlot> | null)[]): BotConfigV2 =>
  botConfigV2Schema.parse({
    version: BOT_VOCABULARY_VERSION, activeSet: 0,
    sets: [v2Set(active), v2Set([]), v2Set([]), v2Set([])],
  });

interface Started {
  readonly session: Session;
  readonly hero: CharacterRuntime;
  readonly ruleset: HuntRuleset;
  readonly loaded: Content;
}

/** Uma hunt com o herói e, opcionalmente, o bot configurado. `spawn` planta os monstros na rota. */
function start(
  over: {
    rawOver?: Partial<RawContent>;
    /** Quem nasce, e onde: um id (perto do índice 4 da rota) ou `id@índice` (perto DAQUELE tile da rota). */
    spawn?: readonly string[]; config?: BotConfigV2;
    inventory?: InventoryState; gold?: number; loaded?: Content; heroAt?: { x: number; y: number };
    /** `false` deixa o nascimento inicial para o primeiro `advanceBy` do teste. */
    advance?: boolean;
  } = {},
): Started {
  const spawnPoints = (over.spawn ?? []).map((entry) => {
    const [monsterId, index] = entry.split('@');
    return index === undefined
      ? { routeIndex: 4, radius: 2, monsterId, respawnDelayMs: 600_000 }
      : { routeIndex: Number(index), radius: 1, monsterId, respawnDelayMs: 600_000 };
  });
  const loaded = over.loaded ?? buildContent(raw({
    routes: [{ ...route, spawnPoints }], ...over.rawOver,
  }));
  const session = createHuntSession({
    id: 'outfit-session', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    ...(over.config === undefined ? {} : { botConfig: over.config }),
  });
  const stats = statsForLevel(1, null, loaded.progression);
  const hero = new CharacterRuntime({
    id: 'hero', position: { ...(over.heroAt ?? { x: 1, y: 1 }), z: 7 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: 500, maxMana: 500,
    level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: over.gold ?? 1_000, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    ...(over.inventory === undefined ? {} : { inventory: over.inventory }),
  });
  // O herói sabe toda magia do conteúdo do teste (#624): o portão do aprendizado não é o assunto
  // deste arquivo (a Creature Illusion de teste é uma magia como as outras).
  for (const id of loaded.spells.keys()) hero.learnedSpells.grant(id);
  session.enter(hero);
  // O nascimento inicial é um evento da fila (`SPAWN`, atraso 0): sem este primeiro avanço a cena
  // ainda não tem monstro nenhum.
  if ((over.spawn ?? []).length > 0 && over.advance !== false) session.advanceBy(1);
  return { session, hero, ruleset: session.ruleset as HuntRuleset, loaded };
}

function run(session: Session, durationMs: number, stepMs: number): void {
  const steps = Math.floor(durationMs / stepMs);
  for (let i = 0; i < steps && session.ended === null; i++) session.advanceBy(stepMs);
}

/**
 * Avança e devolve as trocas de aparência que saíram — drenando a CADA passo: o buffer de eventos
 * da sessão tem teto, e uma hunt de trinta segundos o estoura se ninguém o esvaziar.
 */
function runLooks(session: Session, durationMs: number, stepMs: number) {
  const out: Extract<DomainEvent, { kind: 'creature-look-changed' }>[] = [];
  out.push(...looksIn(session.drainEvents()));
  for (let t = 0; t + stepMs <= durationMs && session.ended === null; t += stepMs) {
    session.advanceBy(stepMs);
    out.push(...looksIn(session.drainEvents()));
  }
  return out;
}

const looksIn = (events: readonly DomainEvent[]) => events.filter(
  (event): event is Extract<DomainEvent, { kind: 'creature-look-changed' }> => event.kind === 'creature-look-changed',
);

/** Planta o monstro num tile — a posição E o `home`, como `hunt.test.ts` (#655). */
function plant(monster: MonsterRuntime, at: { x: number; y: number; z: number }): void {
  monster.position = at;
  Object.assign(monster, { home: at });
}

const monsterOf = (ruleset: HuntRuleset, id: string): MonsterRuntime => {
  const found = ruleset.monsters.find((monster) => monster.monsterId === id);
  if (found === undefined) throw new Error(`sem ${id} nesta cena`);
  return found;
};

describe('a defesa `outfit` de monstro — o disfarce próprio (#621, `{ name = "outfit" }` em `monster.defenses`)', () => {
  // `cadenceMs` maior que a duração: a defesa NÃO rola no nascimento (#518), então a primeira
  // aplicação cai em ~5 000 ms, vence em ~6 000 e só volta em ~10 000 — a janela em que o teste olha.
  const shapeshifter = inert('shapeshifter', {
    aggroRadius: 11,
    defenses: [{
      id: 'disguise', cadenceMs: 5_000, chance: 1,
      condition: disguise({ monsterId: 'rat' }, 1_000),
    }],
  });
  const monsters = [inert('rat', { illusionable: true }), shapeshifter];

  it('veste a aparência, anuncia a troca e devolve a dele quando o prazo vence — tudo na fila', () => {
    const { session, ruleset } = start({ rawOver: { monsters }, spawn: ['shapeshifter'] });
    const monster = monsterOf(ruleset, 'shapeshifter');
    expect(ruleset.lookOf(session, monster.subject)).toBeNull();

    const worn = runLooks(session, 5_500, 100);
    expect(ruleset.lookOf(session, monster.subject)).toEqual({ monsterId: 'rat' });
    expect(worn).toEqual([
      { kind: 'creature-look-changed', creatureId: monster.subject, look: { monsterId: 'rat' } },
    ]);

    const returned = runLooks(session, 1_000, 100);
    expect(ruleset.lookOf(session, monster.subject)).toBeNull();
    expect(monster.conditions.get('outfit')).toBeNull();
    expect(returned).toEqual([
      { kind: 'creature-look-changed', creatureId: monster.subject, look: null },
    ]);
  });

  it('a troca de aparência não muda NENHUM número — vida, mana, XP e posição do herói ficam onde estavam', () => {
    const at = (list: readonly unknown[]) => {
      const { session, hero } = start({ rawOver: { monsters: list }, spawn: ['shapeshifter'] });
      run(session, 12_000, 100);
      return [hero.health, hero.mana, hero.xp, hero.position];
    };
    const disguised = at(monsters);
    const plain = at([monsters[0], { ...shapeshifter, defenses: undefined }]);
    expect(disguised).toEqual(plain);
  });
});

describe('o ataque `outfit` de monstro — uma condição NÃO agressiva (#621, `COMBAT_PARAM_AGGRESSIVE 0`)', () => {
  const single = (condition = disguise({ monsterId: 'rat' }, 4_000)) => inert('charmer', {
    aggroRadius: 20,
    abilities: [{
      id: 'outfit', cadenceMs: 60_000, chance: 1, target: { range: 20 }, power: 0, damageType: 'physical',
      condition,
    }],
  });
  const monstersWith = (...extra: unknown[]) => [inert('rat', { illusionable: true }), ...extra];

  it('sem área, atinge o ALVO (o herói): ele veste o outfit e nada no combate muda', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, hero, ruleset } = start({ rawOver: { monsters: monstersWith(single()) }, spawn: ['charmer'] });
    const before = hero.health;
    const events: DomainEvent[] = [];
    for (let t = 0; t < 500; t += 100) { session.advanceBy(100); events.push(...session.drainEvents()); }
    expect(ruleset.lookOf(session, hero.id)).toEqual({ monsterId: 'rat' });
    expect(looksIn(events)).toEqual([
      { kind: 'creature-look-changed', creatureId: 'hero', look: { monsterId: 'rat' } },
    ]);
    // Não é golpe: nenhum `creature-hit` NO herói, nenhum dano, e o resolver nunca foi chamado por
    // um monstro — o `COMBAT_NONE` do Canary pula o bloqueio, a esquiva e o crítico.
    expect(events.some((event) => event.kind === 'creature-hit' && event.creatureId === 'hero')).toBe(false);
    expect(hero.health).toBe(before);
    const monsterStrikes = vi.mocked(resolveDamage).mock.calls
      .filter(([intent]) => intent.source === 'monster-attack');
    expect(monsterStrikes).toHaveLength(0);
    // E acaba na hora: a condição vence em 4 s e o herói volta à aparência dele.
    expect(runLooks(session, 4_000, 100)).toEqual([
      { kind: 'creature-look-changed', creatureId: 'hero', look: null },
    ]);
    expect(ruleset.lookOf(session, hero.id)).toBeNull();
  });

  it('`outfitItem` (objeto) veste a aparência por `objectKey` — a condição é a mesma', () => {
    const { session, hero, ruleset } = start({
      rawOver: { monsters: monstersWith(single(disguise({ objectKey: 'worm' }, 4_000))) }, spawn: ['charmer'],
    });
    run(session, 500, 100);
    expect(ruleset.lookOf(session, hero.id)).toEqual({ objectKey: 'worm' });
  });

  describe('com ÁREA centrada no lançador — entra TODO MUNDO na forma, o lançador e os outros monstros inclusive', () => {
    const halloween = inert('halloween', {
      aggroRadius: 20,
      abilities: [{
        id: 'outfit', cadenceMs: 60_000, chance: 1,
        target: { range: 1, area: { shape: 'circle', radius: 3, centered: 'caster' } },
        power: 0, damageType: 'physical', condition: disguise({ monsterId: 'rat' }, 4_000),
      }],
    });
    const monsters = monstersWith(
      halloween, inert('bystander'), inert('immune', { conditionImmunities: ['outfit'] }), inert('far'),
    );
    // A ability tem alcance 1 (abaixo), e o herói nasce longe (1,2): ninguém dispara enquanto os
    // monstros nascem no lado leste. Então cada um é PLANTADO num tile exato — o lançador em (2,1),
    // o vizinho em (3,1), o imune em (1,1), o distante em (4,3), a 2 tiles, fora do alcance de 1
    // do círculo de raio 3 — e o herói fica na diagonal do lançador. O primeiro vencimento de
    // monstro acha o herói ao alcance e dispara.
    const scene = (list: readonly unknown[] = monsters) => {
      const started = start({
        rawOver: { monsters: list }, heroAt: { x: 1, y: 2 },
        spawn: ['halloween@4', 'bystander@4', 'immune@4', 'far@4'],
      });
      const at = (id: string, x: number, y: number) => {
        const monster = started.ruleset.monsters.find((candidate) => candidate.monsterId === id);
        if (monster !== undefined) plant(monster, { x, y, z: 7 });
      };
      at('halloween', 2, 1); at('bystander', 3, 1); at('immune', 1, 1); at('far', 4, 3);
      return started;
    };

    it('o lançador, o herói e o vizinho vestem; quem está fora da forma não', () => {
      const { session, hero, ruleset } = scene();
      run(session, 500, 100);
      expect(ruleset.lookOf(session, monsterOf(ruleset, 'halloween').subject)).toEqual({ monsterId: 'rat' });
      expect(ruleset.lookOf(session, hero.id)).toEqual({ monsterId: 'rat' });
      expect(ruleset.lookOf(session, monsterOf(ruleset, 'bystander').subject)).toEqual({ monsterId: 'rat' });
      expect(ruleset.lookOf(session, monsterOf(ruleset, 'far').subject)).toBeNull();
    });

    it('o monstro IMUNE (`conditionImmunities: ["outfit"]`) recusa — o Canary confere `isImmune(CONDITION_OUTFIT)`', () => {
      const { session, ruleset } = scene();
      run(session, 500, 100);
      // Está na forma (adjacente ao lançador), e mesmo assim não veste: a recusa é da IMUNIDADE.
      const immune = monsterOf(ruleset, 'immune');
      expect(immune.position).toEqual({ x: 1, y: 1, z: 7 });
      expect(ruleset.lookOf(session, immune.subject)).toBeNull();
      expect(immune.conditions.get('outfit')).toBeNull();
    });

    it('a auto-aplicação pula a imunidade: o lançador imune ainda se disfarça (`caster == target`)', () => {
      const selfImmune = { ...halloween, conditionImmunities: ['outfit'] };
      const { session, ruleset } = start({
        rawOver: { monsters: monstersWith(selfImmune) }, heroAt: { x: 1, y: 2 }, spawn: ['halloween@4'],
      });
      plant(monsterOf(ruleset, 'halloween'), { x: 2, y: 1, z: 7 });
      run(session, 500, 100);
      expect(ruleset.lookOf(session, monsterOf(ruleset, 'halloween').subject)).toEqual({ monsterId: 'rat' });
    });

    it('não passa pelo resolver de dano: nenhum golpe de monstro, nenhuma rolagem de bloqueio por alvo', () => {
      vi.mocked(resolveDamage).mockClear();
      const { session, hero } = scene();
      const before = hero.health;
      run(session, 500, 100);
      expect(hero.health).toBe(before);
      const monsterStrikes = vi.mocked(resolveDamage).mock.calls
        .filter(([intent]) => intent.source === 'monster-attack');
      expect(monsterStrikes).toHaveLength(0);
    });
  });

  describe('a fusão do Canary entre fontes — `Condition::updateCondition`', () => {
    const cast = (session: Session, ruleset: HuntRuleset) =>
      expect(ruleset.useSlot(session, 'hero', 0, 0).ok).toBe(true);
    const longConfig = botConfig([{
      do: { kind: 'spell', spellId: 'creature-illusion-long', monsterId: 'dragon' },
    }]);
    const dragonAndRat = [
      inert('rat', { illusionable: true }), inert('dragon', { illusionable: true }),
    ];

    it('o outfit que acabaria ANTES do ativo é recusado — sem troca e sem evento', () => {
      // O herói vira dragão por 10 s (a magia longa), ANTES de o monstro nascer; o ataque dele, de
      // 4 s, acabaria antes e `updateCondition` o recusa: nem a aparência nem o prazo mudam.
      const { session, hero, ruleset } = start({
        rawOver: { monsters: [...dragonAndRat, single()] }, spawn: ['charmer'], advance: false,
        config: longConfig,
      });
      cast(session, ruleset);
      const worn = hero.conditions.get('outfit');
      session.drainEvents();
      const events = runLooks(session, 500, 100); // o ataque do `charmer` sai aqui
      expect(hero.conditions.get('outfit')).toEqual(worn);
      expect(ruleset.lookOf(session, hero.id)).toEqual({ monsterId: 'dragon' });
      expect(events).toEqual([]);
    });

    it('o que acaba DEPOIS do ativo vence — a aparência e o prazo passam a ser os dele', () => {
      const { session, hero, ruleset } = start({
        rawOver: { monsters: [...dragonAndRat, single(disguise({ monsterId: 'rat' }, 20_000))] },
        spawn: ['charmer'], advance: false, config: longConfig,
      });
      cast(session, ruleset);
      session.drainEvents();
      const events = runLooks(session, 500, 100);
      expect(ruleset.lookOf(session, hero.id)).toEqual({ monsterId: 'rat' });
      expect(hero.conditions.get('outfit')?.expiresAtMs).toBeGreaterThan(10_000);
      expect(events).toEqual([
        { kind: 'creature-look-changed', creatureId: 'hero', look: { monsterId: 'rat' } },
      ]);
    });
  });
});

describe('Creature Illusion — o jogador veste o outfit de um monstro `illusionable` (#621, `creature_illusion.lua`)', () => {
  const config = (monsterId?: string) => botConfig([{
    do: monsterId === undefined
      ? { kind: 'spell', spellId: 'creature-illusion-test' }
      : { kind: 'spell', spellId: 'creature-illusion-test', monsterId },
  }]);
  const monsters = [
    inert('rat', { illusionable: true }),
    inert('dragon', { illusionable: true }),
    inert('boss'), // `illusionable` ausente é `false` — o default do Canary.
  ];

  it('veste o monstro pedido, gasta a mana do catálogo e entra em cooldown', () => {
    const { session, hero, ruleset } = start({ rawOver: { monsters }, config: config('dragon') });
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    expect(hero.mana).toBe(400);
    expect(ruleset.lookOf(session, hero.id)).toEqual({ monsterId: 'dragon' });
    expect(looksIn(session.drainEvents())).toEqual([
      { kind: 'creature-look-changed', creatureId: 'hero', look: { monsterId: 'dragon' } },
    ]);
    // O segundo lançamento imediato é recusado pelo cooldown — a magia é de grupo, como no Canary.
    expect(ruleset.useSlot(session, 'hero', 0, 0).ok).toBe(false);
  });

  it('expira na fila: o herói volta à aparência dele no instante exato do prazo', () => {
    const { session, hero, ruleset } = start({ rawOver: { monsters }, config: config('dragon') });
    expect(ruleset.useSlot(session, 'hero', 0, 0).ok).toBe(true);
    run(session, 2_900, 100);
    expect(ruleset.lookOf(session, hero.id)).toEqual({ monsterId: 'dragon' });
    session.drainEvents();
    expect(runLooks(session, 100, 100)).toEqual([
      { kind: 'creature-look-changed', creatureId: 'hero', look: null },
    ]);
    expect(ruleset.lookOf(session, hero.id)).toBeNull();
    expect(hero.conditions.get('outfit')).toBeNull();
  });

  it('recusa `not-illusionable` — monstro que não é ilusionável, que não existe, ou sem parâmetro — e não gasta nada', () => {
    for (const monsterId of ['boss', 'does-not-exist', undefined]) {
      const { session, hero, ruleset } = start({ rawOver: { monsters }, config: config(monsterId) });
      const outcome = ruleset.useSlot(session, 'hero', 0, 0);
      expect(outcome, String(monsterId)).toEqual({ ok: false, reason: 'not-illusionable', retryInMs: 0 });
      expect(hero.mana, String(monsterId)).toBe(500);
      expect(hero.conditions.get('outfit'), String(monsterId)).toBeNull();
      // Nenhum cooldown foi iniciado: a recusa veio ANTES da mana, como o `return false` do Lua.
      expect(hero.cooldowns.remainingMs('spell:creature-illusion-test', 0)).toBe(0);
    }
  });

  it('o monstro imune a `outfit` NÃO protege o jogador — o imune só barra o que vem do combate contra ELE', () => {
    // O herói não tem `conditionImmunities` (só item suprime condição); a ilusão é `addCondition`
    // direto no Lua, sem o portão de `CombatConditionFunc`.
    const { session, hero, ruleset } = start({
      rawOver: { monsters: [inert('rat', { illusionable: true, conditionImmunities: ['outfit'] })] },
      config: config('rat'),
    });
    expect(ruleset.useSlot(session, 'hero', 0, 0).ok).toBe(true);
    expect(hero.conditions.look()).toEqual({ monsterId: 'rat' });
  });
});

describe('Chameleon Rune — o jogador veste a aparência de um item que carrega (#621, `chameleon.lua`)', () => {
  const inventory: InventoryState = {
    backpack: [{ instanceId: 'w1', itemId: 'worm', quantity: 1 }], satchel: [], equipped: {},
  };

  it('`use-item-on` com o item apontado veste `{ itemId }`, cobra o gold da runa e tranca os dois livros', () => {
    const { session, hero, ruleset } = start({ inventory });
    const outcome = ruleset.useItemOn(
      session, 'hero', { supplyId: 'chameleon-rune-test' }, 1, { kind: 'item', instanceId: 'w1' },
    );
    expect(outcome).toEqual({ ok: true });
    expect(hero.conditions.look()).toEqual({ itemId: 'worm' });
    expect(hero.goldDelta).toBe(-210);
    expect(looksIn(session.drainEvents())).toEqual([
      { kind: 'creature-look-changed', creatureId: 'hero', look: { itemId: 'worm' } },
    ]);
    // Os dois livros do Canary (`cooldown` 2 s AO LADO do `groupCooldown` 2 s).
    expect(hero.cooldowns.remainingMs('supply:chameleon-rune-test', 0)).toBeGreaterThan(0);
    expect(hero.cooldowns.remainingMs('group:support', 0)).toBeGreaterThan(0);
  });

  it('expira na fila — o mesmo caminho da ilusão', () => {
    const { session, hero, ruleset } = start({ inventory });
    ruleset.useItemOn(
      session, 'hero', { supplyId: 'chameleon-rune-test' }, 1, { kind: 'item', instanceId: 'w1' },
    );
    run(session, 2_900, 100);
    expect(hero.conditions.look()).toEqual({ itemId: 'worm' });
    run(session, 100, 100);
    expect(hero.conditions.look()).toBeNull();
  });

  it('sem item apontado, ou com uma instância que o personagem não tem, recusa `not-illusionable` SEM cobrar', () => {
    const { session, hero, ruleset } = start({ inventory });
    const noTarget = ruleset.useItem(session, 'hero', { supplyId: 'chameleon-rune-test' }, 1);
    expect(noTarget).toEqual({ ok: false, reason: 'not-illusionable', retryInMs: 0 });
    const ghost = ruleset.useItemOn(
      session, 'hero', { supplyId: 'chameleon-rune-test' }, 2, { kind: 'item', instanceId: 'ghost' },
    );
    expect(ghost).toEqual({ ok: false, reason: 'not-illusionable', retryInMs: 0 });
    expect(hero.goldDelta).toBe(0);
    expect(hero.conditions.get('outfit')).toBeNull();
  });

  it('um item vestido também serve — `chameleon.lua` lê o container OU o slot do corpo', () => {
    const { session, hero, ruleset } = start({
      inventory: { backpack: [], satchel: [], equipped: { hand: { instanceId: 'e1', itemId: 'worm', quantity: 1 } } },
    });
    const outcome = ruleset.useItemOn(
      session, 'hero', { supplyId: 'chameleon-rune-test' }, 1, { kind: 'item', instanceId: 'e1' },
    );
    expect(outcome).toEqual({ ok: true });
    expect(hero.conditions.look()).toEqual({ itemId: 'worm' });
  });

  it('pelo slot da barra (`use-slot`) com a mira num item — o MESMO caminho do `use-item-on`', () => {
    const { session, hero, ruleset } = start({
      inventory, config: botConfig([{ do: { kind: 'supply', supplyId: 'chameleon-rune-test' } }]),
    });
    expect(ruleset.useSlot(session, 'hero', 0, 0, { kind: 'item', instanceId: 'w1' })).toEqual({ ok: true });
    expect(hero.conditions.look()).toEqual({ itemId: 'worm' });
  });

  it('a mira num item é ruído para uma ação que não é a Chameleon — ignorada, como um personagem numa runa de dano', () => {
    const { session, hero, ruleset } = start({
      rawOver: { supplies: [chameleonRune, {
        id: 'mana-potion', name: 'Poção de Mana', price: 50, group: 'potion', effect: { kind: 'mana', amount: 100 },
      }] },
      inventory,
    });
    hero.mana = 100;
    const outcome = ruleset.useItemOn(
      session, 'hero', { supplyId: 'mana-potion' }, 1, { kind: 'item', instanceId: 'w1' },
    );
    expect(outcome).toEqual({ ok: true });
    expect(hero.mana).toBe(200);
  });
});

describe('a aparência emprestada atravessa o tempo, o snapshot e a taxa sem mudar o resultado (invariantes 2 e 3)', () => {
  const shapeshifter = inert('shapeshifter', {
    aggroRadius: 11,
    defenses: [{
      id: 'disguise', cadenceMs: 2_000, chance: 0.5,
      condition: disguise({ monsterId: 'rat' }, 3_000),
    }],
  });
  const rawOver = { monsters: [inert('rat', { illusionable: true }), shapeshifter] };

  it('1 Hz == 10 Hz: as mesmas trocas, na mesma ordem, e o mesmo estado ao fim', () => {
    const at = (hz: number) => {
      const { session, ruleset } = start({ rawOver, spawn: ['shapeshifter'] });
      const looks = runLooks(session, 60_000, 1000 / hz);
      return { looks, state: ruleset.monsters.map((monster) => monster.conditions.getState()) };
    };
    const base = at(10);
    expect(base.looks.length).toBeGreaterThan(2);
    expect(at(1)).toEqual(base);
    expect(at(20)).toEqual(base);
  });

  it('o snapshot no meio da ilusão volta com a aparência, e as trocas seguintes são as mesmas', () => {
    const uninterrupted = start({ rawOver, spawn: ['shapeshifter'] });
    const expected = runLooks(uninterrupted.session, 30_000, 100);

    const first = start({ rawOver, spawn: ['shapeshifter'] });
    // Para no MEIO de uma troca: anda até um instante em que o monstro está disfarçado.
    const seen = [...runLooks(first.session, 0, 100)];
    let cursor = 0;
    while (cursor < 30_000 && monsterOf(first.ruleset, 'shapeshifter').conditions.look() === null) {
      first.session.advanceBy(100);
      cursor += 100;
      seen.push(...looksIn(first.session.drainEvents()));
    }
    expect(monsterOf(first.ruleset, 'shapeshifter').conditions.look()).toEqual({ monsterId: 'rat' });
    // Pelo JSON, como o snapshot vai para o Redis: o `look` precisa sobreviver à serialização.
    const snapshot = JSON.parse(JSON.stringify(first.session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, first.loaded) as HuntRuleset, new Rng(snapshot.rng),
    );
    const resumedRuleset = resumed.ruleset as HuntRuleset;
    const restored = monsterOf(resumedRuleset, 'shapeshifter');
    expect(restored.conditions.look()).toEqual({ monsterId: 'rat' });
    expect(resumedRuleset.lookOf(resumed, restored.subject)).toEqual({ monsterId: 'rat' });

    // O que sobra da hunt, contado junto com o que já saiu, é a mesma história da hunt que nunca
    // parou — incluindo o instante em que a aparência volta ao normal.
    seen.push(...runLooks(resumed, 30_000 - cursor, 100));
    expect(seen).toEqual(expected);
  });
});
