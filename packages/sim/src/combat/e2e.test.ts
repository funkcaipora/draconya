// Testes E2E do combate completo (M24-12, #477; RF-01..RF-06).
//
// A suíte de conformance (`combat/conformance.test.ts`) prende fórmula, ordem de RNG e
// arredondamento; os golden traces (`combat/traces/`) prendem a ORDEM de emissão de um ruleset
// sintético. O que faltava é o que este arquivo monta: a `HuntRuleset` de verdade, com o
// conteúdo real da runa, o bot, o alvo, o gold e os 37 tiles — o cenário do milestone inteiro
// num só lugar (ADR 0019, 0020 e 0031).
//
// Puro (invariante 1): sem I/O, sem relógio de processo. O tempo anda por `advanceBy(dtMs)` e a
// semente é a da sessão; a mesma execução roda igual com ou sem visualizador (invariante 3).
//
// A definição da Avalanche é a REAL — importada de `content/data/supplies/avalanche-rune.json`,
// com `requires.magicLevel: 4` e a fórmula canônica do Canary (#476). Fixture relaxada com ML 0
// mascarava justamente o bug que a #444 expôs: a runa só não rodava porque o requisito não
// estava sendo conferido no conteúdo. DT-01 da #477.

import { buildContent, botConfigSchema, botConfigV2Schema, placeholderAppearances } from '@draconya/content';
import type { BotConfig, BotConfigV2, Content, Progression, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { resolveDeath } from '../death.js';
import { statsForLevel, totalXpForLevel } from '../progression.js';
import { createHuntSession } from '../rulesets/hunt.js';
import type { HuntRuleset } from '../rulesets/hunt.js';
import type { DomainEvent, Session } from '../session.js';
import realAvalancheRune from '../../../content/data/supplies/avalanche-rune.json';

// --- a arena ---------------------------------------------------------------------------------

// Aberta de propósito: a runa alcança 8 e a área de 37 tiles precisa de espaço para projetar
// sem encostar na borda. 24×12 cabe o alvo a 11 tiles e a área inteira.
const MAP = {
  id: 'arena', z: 7,
  grid: [
    '########################',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '########################',
  ],
};

const ROUTE = {
  id: 'arena-loop', mapId: 'arena',
  // Laço MÍNIMO, de propósito: o herói não sai de um quadrado 2×2, então as posições que o teste
  // arruma à mão continuam válidas a execução inteira. Um laço grande levaria o herói na direção
  // do canto de RF-03, e o canto entraria no raio de busca e viraria alvo principal.
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 2, y: 2, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [{ routeIndex: 2, radius: 1 }],
};

const HUNT = {
  id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
  difficulties: {
    cautious: { monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000 },
    bold: { monsterCount: 3, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000 },
  },
};

// Ataque ZERO: o rato não encosta a vida do herói, então o teste mede o que ele se propôs a
// medir — alvo, runa, área e gold. `aggroRadius` baixo para ele não sair do lugar arrumado.
const RAT = {
  id: 'rat', name: 'Rat', recommendedLevel: 1,
  health: 50, experience: 5, attack: 0, armor: 0,
  attackIntervalMs: 2_000, speed: 300, aggroRadius: 1, attackRange: 1,
  loot: { gold: { chance: 0, min: 1, max: 1 }, items: [] },
};

const PROGRESSION = {
  id: 'baseline', startingHealth: 500_000, startingMana: 2_000, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { healthPerSecond: 0, manaPerSecond: 0 },
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
};

const COMBAT = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: {
    physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0,
  },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0 },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0 },
};

const STAMINA = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const PARTY = { id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 } };

const SPELLS = [
  { id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000, effect: { kind: 'heal', amount: 60 } },
  {
    id: 'strike', name: 'Golpe Arcano', manaCost: 15, cooldownMs: 2_000,
    effect: { kind: 'damage', power: 40, range: 3, damageType: 'fire' },
  },
];

const SKILLS = [
  {
    id: 'melee', name: 'Corpo a Corpo', startingLevel: 10,
    curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5,
  },
  {
    id: 'magic', name: 'Magia', startingLevel: 0,
    curve: { base: 100, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0,
  },
];

const WEAPON_FAMILIES = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'sword', name: 'Sword', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'wand', name: 'Wand', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
];

// A runa REAL, e a poção mínima para o conteúdo montar. O `id` e os números vêm do arquivo de
// `content/` — o teste os lê, não os reescreve.
const SUPPLIES = [
  { id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion', effect: { kind: 'heal', amount: 80 } },
  realAvalancheRune,
];

const raw = (over: Partial<RawContent> = {}): RawContent => {
  const base: RawContent = {
    monsters: [RAT], hunts: [HUNT], vocations: [], progression: [PROGRESSION], combat: [COMBAT],
    stamina: [STAMINA], party: [PARTY], spells: SPELLS, skills: SKILLS, weaponFamilies: WEAPON_FAMILIES,
    items: [], supplies: SUPPLIES, ammunition: [],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1_000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [MAP], routes: [ROUTE], ...over,
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};

const content = (over: Partial<RawContent> = {}): Content => buildContent(raw(over));

/** O bot v1 da #444: a categoria `rune` inteira apontando para a Avalanche. */
const runeBot = (): BotConfig => botConfigSchema.parse({
  version: 1,
  heal: [], potion: [], attack: [], support: [],
  rune: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'supply', supplyId: 'avalanche-rune' } }],
});

/** Um conjunto v2 com um único slot ocupado, na posição 0 — o que o `slotStates` precisa ler. */
const runeSlotBot = (): BotConfigV2 => botConfigV2Schema.parse({
  version: 2, activeSet: 0,
  sets: [
    { slots: [{ do: { kind: 'supply', supplyId: 'avalanche-rune' }, when: [] }, ...Array.from({ length: 23 }, () => null)] },
    { slots: Array.from({ length: 24 }, () => null) },
    { slots: Array.from({ length: 24 }, () => null) },
    { slots: Array.from({ length: 24 }, () => null) },
  ],
});

interface Started {
  readonly session: Session;
  readonly hero: CharacterRuntime;
  readonly ruleset: HuntRuleset;
}

/**
 * Uma hunt de verdade com bot, alvo e gold. O `magicLevel` entra como ESTADO de skill — é a
 * única forma de o gate da runa ser o real, e não um número trocado à mão no teste.
 */
function board(options: {
  id?: string; difficulty?: 'cautious' | 'bold'; bot?: BotConfig | BotConfigV2;
  health?: number; gold?: number; level?: number; magicLevel?: number;
  monsters?: readonly Record<string, unknown>[];
} = {}): Started {
  const loaded = content(options.monsters === undefined ? {} : { monsters: options.monsters });
  const session = createHuntSession({
    id: options.id ?? 'e2e',
    content: loaded,
    huntId: 'arena',
    difficulty: options.difficulty ?? 'bold',
    createdAtMs: 0,
    ...(options.bot === undefined ? {} : { botConfig: options.bot }),
  });
  const stats = statsForLevel(1, null, loaded.progression);
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 1, y: 1, z: 7 },
    health: options.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
    mana: stats.maxMana, maxMana: stats.maxMana,
    level: 1, xp: 0, vocationId: null,
    staminaMs: STAMINA.maxMs, staminaUpdatedAtMs: 0,
    gold: options.gold ?? 0, goldDelta: 0, alive: true, cooldowns: {},
    capacity: 1_000,
    ...(options.magicLevel === undefined
      ? {}
      : { skills: { magic: { level: options.magicLevel, points: 0 } } }),
  });
  session.enter(hero);
  if (options.level !== undefined) {
    hero.level = options.level;
    hero.xp = totalXpForLevel(options.level, loaded.progression as Progression);
  }
  return { session, hero, ruleset: session.ruleset as HuntRuleset };
}

function run(session: Session, durationMs: number, stepMs = 100): void {
  const steps = Math.floor(durationMs / stepMs);
  for (let i = 0; i < steps && session.ended === null; i += 1) session.advanceBy(stepMs);
}

const chosenOf = (ruleset: HuntRuleset, id: string): string | null =>
  ruleset.getState().runners?.[id]?.chosenTarget ?? null;

/** Drena UMA vez: `drainEvents` limpa a fila, e drenar duas vezes mediria a segunda como vazia. */
const drain = (session: Session): readonly DomainEvent[] => session.drainEvents();

const hitsIn = (events: readonly DomainEvent[]) =>
  events
    .filter((event) => event.kind === 'creature-hit')
    .map((event) => event as { creatureId: string; amount: number; source: string });

// --- RF-01: o caso #444 obrigatório, com a runa REAL -----------------------------------------

describe('combate E2E e paridade completa (M24-12, #477)', () => {
  it('RF-01: alvo a 8 com arma de alcance 1 — target, Avalanche, gold, míssil e 37 efeitos', () => {
    // O caso da #444, sem fixture relaxada: Knight de level 30, magic level 4 (o requisito REAL
    // da runa), arma de alcance 1. O monstro chega de 9 para 8 — o primeiro tile em que a runa
    // (alcance 8) o alcança. A 9 não há alvo: o rato está fora do alcance da runa.
    const { session, hero, ruleset } = board({
      id: 'e2e-rf01', difficulty: 'bold', gold: 10_000, magicLevel: 4, level: 30,
    });
    session.advanceBy(1);

    const [far, ...rest] = [...ruleset.monsters];
    if (far === undefined) throw new Error('faltou rato');
    far.position = { x: hero.position.x + 9, y: hero.position.y };
    for (const other of rest) other.position = { x: hero.position.x + 20, y: hero.position.y };

    // A 9 tiles não há runa possível: fora do alcance de 8, nenhum alvo e nenhum gold.
    ruleset.configureBot(session, runeBot(), 'hero');
    expect(chosenOf(ruleset, hero.id)).toBeNull();
    expect(session.aggregates.suppliesUsed).toBe(0);

    // O monstro avança para 8: entra no alcance da runa e vira alvo.
    far.position = { x: hero.position.x + 8, y: hero.position.y };
    ruleset.configureBot(session, runeBot(), 'hero');
    expect(chosenOf(ruleset, hero.id)).toBe(far.subject);
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(far.subject);

    run(session, 2_500);

    const uses = session.aggregates.suppliesUsed;
    expect(uses).toBeGreaterThan(0);
    // Gold debita no uso (§20.1), pelo preço REAL da runa — 14.
    expect(session.aggregates.goldSpent).toBe(uses * 14);
    expect(hero.goldDelta).toBe(-uses * 14);

    const events = drain(session);
    const used = events.filter((event) => event.kind === 'supply-used');
    expect(used).toHaveLength(uses);
    // A área da Avalanche é o círculo de raio 3: 37 tiles, com o alvo principal primeiro.
    for (const event of used) {
      if (event.kind !== 'supply-used') continue;
      expect(event.supplyId).toBe('avalanche-rune');
      expect(event.tiles).toHaveLength(37);
      expect(event.targets.length).toBeGreaterThan(0);
      expect(event.targets[0]?.creatureId).toBe(far.subject);
    }

    const hits = hitsIn(events);
    expect(hits.some((hit) => hit.creatureId === far.subject && hit.source === 'spell')).toBe(true);
  });

  // --- RF-02: magic level abaixo do requisito explica a recusa --------------------------------

  it('RF-02: magic level 3 — alvo aparece, Avalanche NÃO sai e o slot diz magic-level-too-low', () => {
    // Level 30, mas magic level 3: o gate da runa REAL (ML 4) segura o disparo. O alvo continua
    // sendo escolhido — a tela mostra em quem o bot miraria —, e a recusa chega com o motivo
    // ESPECÍFICO, não "ação indisponível".
    const { session, hero, ruleset } = board({
      id: 'e2e-rf02', difficulty: 'bold', gold: 10_000, magicLevel: 3, level: 30,
    });
    session.advanceBy(1);

    const [far, ...rest] = [...ruleset.monsters];
    if (far === undefined) throw new Error('faltou rato');
    far.position = { x: hero.position.x + 8, y: hero.position.y };
    for (const other of rest) other.position = { x: hero.position.x + 20, y: hero.position.y };

    ruleset.configureBot(session, runeSlotBot(), 'hero');
    run(session, 2_500);

    // O alvo aparece na tela mesmo com a runa bloqueada.
    expect(chosenOf(ruleset, hero.id)).toBe(far.subject);
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(far.subject);
    // E a runa não sai, nem gasta.
    expect(session.aggregates.suppliesUsed).toBe(0);
    expect(session.aggregates.goldSpent).toBe(0);

    // O motivo do SLOT é o específico (DT-08: o espelho coincide com o `#perform`).
    const slot = ruleset.slotStates(session, hero)[0];
    expect(slot).toMatchObject({ state: 'blocked', reason: 'magic-level-too-low' });
    // E o disparo manual recusa pelo mesmo motivo — a mesma verdade pelos dois caminhos.
    expect(ruleset.useSlot(session, 'hero', 0, 0))
      .toEqual({ ok: false, reason: 'magic-level-too-low', retryInMs: 0 });
  });

  // --- RF-03: a área de 37 tiles não pega o canto --------------------------------------------

  it('RF-03: monstro no canto (dx:3, dy:3) do alvo toma zero e não gera creature-hit', () => {
    // A área da Avalanche é o círculo de 37 tiles, não o quadrado 7×7: o canto (3,3) em relação
    // ao alvo fica FORA. O monstro ali não pode apanhar nem aparecer como `creature-hit`.
    const { session, hero, ruleset } = board({
      id: 'e2e-rf03', difficulty: 'bold', gold: 10_000, magicLevel: 4, level: 30,
    });
    session.advanceBy(1);

    const [primary, corner, ...rest] = [...ruleset.monsters];
    if (primary === undefined || corner === undefined) throw new Error('faltam ratos');
    primary.position = { x: hero.position.x + 8, y: hero.position.y };
    // O canto do quadrado 7×7 centrado no alvo principal: dx=3, dy=3. Fora dos 37.
    corner.position = { x: primary.position.x + 3, y: primary.position.y + 3 };
    for (const other of rest) other.position = { x: hero.position.x + 20, y: hero.position.y };

    ruleset.configureBot(session, runeBot(), 'hero');
    run(session, 2_500);

    expect(session.aggregates.suppliesUsed).toBeGreaterThan(0);
    const cornerHealth = corner.health;
    const hits = hitsIn(drain(session));
    expect(hits.some((hit) => hit.creatureId === primary.subject)).toBe(true);
    // Nenhum golpe no canto, e a vida dele intacta — a forma não é o quadrado inteiro.
    expect(hits.some((hit) => hit.creatureId === corner.subject)).toBe(false);
    expect(corner.health).toBe(cornerHealth);
  });

  // --- RF-04: elemental ignora armadura; imunidade zera --------------------------------------

  it('RF-04: armadura de 100 não reduz o dano de gelo (elemental ignora armadura)', () => {
    // Mesma semente (`id`), mesmo cenário, mesma posição: a ÚNICA diferença é a armadura. Com
    // `armorEffectiveness.ice = 0`, a armadura não entra na conta, e as duas sequências de dano
    // são idênticas. Se a armadura valesse para o gelo, a série armada cairia.
    const boardOne = (armor: number): readonly number[] => {
      const monsters = [{ ...RAT, armor }];
      const started = board({
        id: 'e2e-rf04', difficulty: 'cautious',
        gold: 10_000, magicLevel: 4, level: 30, monsters,
      });
      started.session.advanceBy(1);
      const monster = started.ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      monster.position = { x: started.hero.position.x + 8, y: started.hero.position.y };
      started.ruleset.configureBot(started.session, runeBot(), 'hero');
      run(started.session, 300);
      return hitsIn(drain(started.session))
        .filter((hit) => hit.source === 'spell')
        .map((hit) => hit.amount);
    };

    const bare = boardOne(0);
    const armored = boardOne(100);

    expect(bare.length).toBeGreaterThan(0);
    expect(armored).toEqual(bare);
  });

  it('RF-04: monstro imune a gelo toma exatamente zero', () => {
    // A mitigação é dado do conteúdo, e o boot a compila: aqui vai a forma crua do arquivo.
    const monsters = [{ ...RAT, mitigation: { resistances: {}, immunities: ['ice'] } }];
    const { session, hero, ruleset } = board({
      id: 'e2e-rf04-immune', difficulty: 'cautious',
      gold: 10_000, magicLevel: 4, level: 30, monsters,
    });
    session.advanceBy(1);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    monster.position = { x: hero.position.x + 8, y: hero.position.y };
    ruleset.configureBot(session, runeBot(), 'hero');
    const maxHealth = monster.health;
    run(session, 2_500);

    expect(session.aggregates.suppliesUsed).toBeGreaterThan(0);
    const spellHits = hitsIn(drain(session)).filter((hit) => hit.source === 'spell');
    expect(spellHits.length).toBeGreaterThan(0);
    expect(spellHits.every((hit) => hit.amount === 0)).toBe(true);
    expect(monster.health).toBe(maxHealth);
  });

  // --- RF-05: cooldown de cura independente do de ataque -------------------------------------

  it('RF-05: a cura de 1 s não atrasa o ataque de 2 s nem é atrasada por ele', () => {
    // Duas categorias independentes (FUN-84): a cura sai a cada 1 s e o ataque, a cada 2 s.
    // Em 10 s o esperado é ~10 curas e ~5 golpes; a desproporção é a prova de que uma cadência
    // não trava a outra.
    const config = botConfigSchema.parse({
      version: 1,
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'heal' } }],
      attack: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'strike' } }],
      potion: [], rune: [], support: [],
    });
    // O rato aguenta: o ataque é de alcance 3, e a vida alta o mantém vivo para o golpe medir a
    // cadência em vez do abate.
    const monsters = [{ ...RAT, health: 100_000 }];
    const { session, hero, ruleset } = board({
      id: 'e2e-rf05', difficulty: 'cautious', bot: config, monsters, level: 30,
    });
    session.advanceBy(1);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    monster.position = { x: hero.position.x + 2, y: hero.position.y };

    run(session, 10_000);

    const casts = drain(session).filter((event) => event.kind === 'spell-cast');
    const heals = casts.filter((event) => event.kind === 'spell-cast' && event.spellId === 'heal').length;
    const strikes = casts.filter((event) => event.kind === 'spell-cast' && event.spellId === 'strike').length;

    expect(heals).toBeGreaterThanOrEqual(8);
    expect(strikes).toBeGreaterThanOrEqual(4);
    // O ataque tranca 2 s e a cura 1 s: as contagens NÃO podem ser iguais, ou uma cadência
    // estaria ditando a outra.
    expect(heals).toBeGreaterThan(strikes);
    expect(strikes).toBeLessThanOrEqual(6);
  });

  // --- RF-06: troca rápida de target, sem race -----------------------------------------------

  it('RF-06: A → B antes do ack, e a morte de B no meio da troca não devolve A por engano', () => {
    // A troca é sequencial no motor: a última chamada vence, e não há dois alvos ao mesmo tempo.
    // Depois de B, a morte de B cai no próximo vivo — sem oscilar para A por ack atrasado.
    const { session, hero, ruleset } = board({ id: 'e2e-rf06', difficulty: 'bold', magicLevel: 4, level: 30 });
    session.advanceBy(1);
    const [a, b] = [...ruleset.monsters];
    if (a === undefined || b === undefined) throw new Error('faltam ratos');
    a.position = { x: hero.position.x + 2, y: hero.position.y };
    b.position = { x: hero.position.x + 3, y: hero.position.y };

    // A intenção do jogador: A e, antes do ack, B. O motor fica com B.
    ruleset.setAttackTarget(hero, a);
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(a.subject);
    ruleset.setAttackTarget(hero, b);
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(b.subject);
    expect(ruleset.getState().runners?.[hero.id]?.chosenTargetPinned).toBe(true);

    // B morre no meio da troca: o alvo cai no mais próximo vivo (A), uma vez, sem repique.
    b.receiveDamage(b.health);
    resolveDeath(session, { kind: 'monster', monster: b });
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(a.subject);
    expect(ruleset.getState().runners?.[hero.id]?.chosenTargetPinned).not.toBe(true);
  });
});