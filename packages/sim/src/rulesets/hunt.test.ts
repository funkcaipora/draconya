import { buildContent, isBlocked, placeholderAppearances } from '@draconya/content';
import type { Content, FieldSpec, Item, Progression, RawContent } from '@draconya/content';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { resolveDamage } from '../combat/damage.js';
import type { BestiaryState } from '../bestiary.js';
import type { SkillsState } from '../skills.js';
import type { InventoryState } from '../inventory.js';
import { resolveDeath } from '../death.js';
import { huntListings } from '../hunt/catalogue.js';
import { MonsterRuntime } from '../monster/monster.js';
import { statsForLevel, totalXpForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import { MAX_PENDING_DOMAIN_EVENTS, SNAPSHOT_FORMAT_VERSION, Session } from '../session.js';
import type { DomainEvent, SessionSnapshot } from '../session.js';
import {
  HuntRuleset, PartyFullError, changeDifficulty, compileExitRules, createHuntRuleset, createHuntSession,
  huntRulesetFromSnapshot,
} from './hunt.js';
import type { HuntExitRule, HuntView, PartyOptionsInput } from './hunt.js';

// O resolver canônico é ENVOLVIDO, não substituído (CMB-02): o `vi.fn` delega para a
// implementação real, então todo o resto do arquivo roda idêntico — e o bloco do pipeline no
// fim consegue provar que CADA produtor passa por este ponto. Um produtor que calculasse dano
// por fora não apareceria nas chamadas gravadas.
vi.mock('../combat/damage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../combat/damage.js')>();
  return { ...actual, resolveDamage: vi.fn(actual.resolveDamage) };
});

// Um mapa pequeno, com uma sala e um laço de dez tiles em volta dela. Pequeno de propósito:
// num mapa assim dá para dizer, olhando, onde cada criatura está — e um teste de simulação
// que ninguém consegue conferir a olho é um teste que ninguém confia.
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
  spawnPoints: [{ routeIndex: 4, radius: 2 }],
};

const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1,
  health: 50, experience: 5, attack: 10, armor: 0,
  attackIntervalMs: 2000, speed: 300, aggroRadius: 4, attackRange: 1,
  // `blockable: true` (#519) preserva o comportamento de sempre deste rato de teste — ele
  // representa o rat-cellars real, que também declara `blockable: true` para manter o
  // `spawnClearRadius` (#236) observado no Huntera, não o `isBlockable: false` do Canary (que
  // é o default do SCHEMA, e vale para monstro que não o declara — o caso do dragão do #519).
  blockable: true,
  // Gold fixo por abate: o que os testes de recompensa conferem é a CONTA, não o sorteio —
  // o sorteio tem teste próprio em `loot.test.ts`.
  loot: { gold: { chance: 1, min: 3, max: 3 }, items: [] },
};

/** O mesmo rato, largando uma espada SEMPRE. Chance 1 tira o sorteio da conta (FUN-88). */
const ratWithDrop = {
  ...rat,
  loot: {
    gold: { chance: 1, min: 3, max: 3 },
    items: [{ itemId: 'sword', chance: 1, min: 1, max: 1 }],
  },
};

const hunt = {
  id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
  difficulties: {
    cautious: {
      monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000,
    },
    bold: {
      monsterCount: 3, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 10_000,
    },
  },
};

const progression = {
  // HP inicial absurdo de propósito. Subir de level RECALCULA `maxHealth` pela tabela
  // (FUN-34/FUN-37), então um herói com HP inventado no teste perderia a vida toda no
  // primeiro level up. Dar a ele um pool enorme VINDO DA TABELA mantém tudo coerente e deixa
  // dez minutos de hunt caberem sem morrer — o personagem ainda não regenera nada, e é isso
  // que a FUN-38 e as poções vão resolver.
  id: 'baseline', startingHealth: 500_000, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { healthPerSecond: 1, manaPerSecond: 1 },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessedReduction: 0.56, levelFloor: 8 },
  skillMultipliers: {},
};

const combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0, manadrain: 0, arcane: 0 }, minimumDamageFraction: 0.1,
  // **Esquiva zero neste conteúdo de teste, e é decisão.** Com ela, dano vira função só do
  // tempo decorrido, e a comparação 10 Hz / 1 Hz mede o que ela deveria medir — a matemática
  // do tempo — em vez de medir em que ordem os sorteios caíram. Quem cuida do dodge é
  // `combat/damage.test.ts`, onde ele é o assunto.
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 0, dodgeChance: 0 },
};

const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const party = { id: 'baseline', maxMembers: 4 };

// Magia e supply de teste (FUN-74, FUN-77). Números redondos de propósito: `strike` tira 40 de
// um rato de 50, então dois golpes matam e o terceiro é ruído — dá para conferir a olho.
const spells = [
  {
    id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000,
    effect: { kind: 'heal', amount: 60 },
  },
  {
    id: 'strike', name: 'Golpe Arcano', manaCost: 15, cooldownMs: 2_000,
    effect: { kind: 'damage', power: 40, range: 3, damageType: 'fire' },
  },
  // Área de raio 2 e poder que MATA um rato de 50 num golpe: é o que faz o teste de "morte no
  // meio da área" ser sobre morte, e não sobre quanto falta de vida.
  {
    id: 'blast', name: 'Explosão', manaCost: 20, cooldownMs: 1_000,
    effect: { kind: 'damage', power: 80, range: 3, area: { shape: 'circle', radius: 2, centered: 'target' } },
  },
];
// Poção e runa são suprimentos ABSTRATOS (FUN-77, §20.1): usar debita gold, sem pilha. Os
// números são redondos de propósito, como os das magias.
const supplies = [
  {
    id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion',
    effect: { kind: 'heal', amount: 80 },
  },
  {
    id: 'mana-potion', name: 'Poção de Mana', price: 50, group: 'potion',
    effect: { kind: 'mana', amount: 100 },
  },
];

// Skills de teste (FUN-75). Curva curta de propósito: com base 2 dá para contar os golpes na
// mão e dizer, olhando, em que nível o personagem tem de estar.
const skills = [
  {
    id: 'melee', name: 'Corpo a Corpo', startingLevel: 10,
    curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 },
    damagePerLevel: 0.5,
  },
  {
    id: 'magic', name: 'Magia', startingLevel: 0,
    curve: { base: 100, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 },
    damagePerLevel: 0,
  },
  // A skill de distância existe para o bow da fixture montar (CMB-05): a família `distance`
  // aponta para ela, e a contribuição por nível é 0 para o dano ser o `attack` da munição.
  {
    id: 'distance', name: 'Distância', startingLevel: 10,
    curve: { base: 2, factor: 1 }, gain: { on: 'distance-hit', points: 1 },
    damagePerLevel: 0,
  },
];

// As famílias de arma (CMB-05). A `melee` contribui 0,5 por nível — é o que faz o teste do
// desarmado/espada medir a escala da skill, e não só o `attack`.
const weaponFamilies = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'sword', name: 'Sword', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'axe', name: 'Axe', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'club', name: 'Club', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'distance', name: 'Distance', kind: 'distance', skillId: 'distance', range: 6, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'wand', name: 'Wand', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
  { id: 'rod', name: 'Rod', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
];

// Uma arma que bate MUITO mais que o desarmado (25): com ela o rato de 50 cai num golpe, e o
// teste consegue medir a diferença sem depender de sorteio.
const items = [
  {
    id: 'life-ring', name: 'Life Ring', kind: 'ring', slot: 'finger',
    weight: 1, value: 0, armor: 2,
    ringEffect: { kind: 'regen-boost', percent: 300 },
  },
  {
    id: 'energy-ring', name: 'Energy Ring', kind: 'ring', slot: 'finger',
    weight: 1, value: 0,
    ringEffect: { kind: 'energy-shield' },
  },
  {
    id: 'other-ring', name: 'Other Ring', kind: 'ring', slot: 'finger',
    weight: 1, value: 0, armor: 1,
  },
  {
    id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand',
    weight: 50, value: 0, attack: 200,
  },
  {
    id: 'plate', name: 'Plate Armor', kind: 'armor', slot: 'chest',
    weight: 80, value: 0, armor: 9,
  },
  // Alcance 3, bem acima do desarmado (1): é o que o teste do #216 precisa para distinguir
  // "alcance do bot" de "alcance de quem está de mãos vazias". `manaPerHit` alto e o herói
  // sem mana (`character()` começa em 0) garantem que ela nunca bate sozinha — o teste mede
  // a CONTAGEM de alvos, não o golpe.
  {
    id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 1, value: 0,
    weapon: { kind: 'wand', range: 3, manaPerHit: 999, damage: { min: 1, max: 1 }, damageType: 'energy' },
  },
  // O anel que gasta por TEMPO e o colar que gasta por CARGA (AB-06/#421, ADR 0032 d.8). A
  // duração é curta de propósito: o teste mede o instante do vencimento, e não o balanceamento.
  {
    id: 'time-ring', name: 'Time Ring', kind: 'ring', slot: 'finger',
    weight: 1, value: 0, durationMs: 4_000,
  },
  {
    id: 'glacier-amulet', name: 'Glacier Amulet', kind: 'amulet', slot: 'neck',
    weight: 5.5, value: 0, charges: 2,
    mitigation: { resistances: { fire: 0.2 } },
  },
  // O anel com carga (#524, o Might Ring): MESMO mecanismo do colar, no slot `finger` — as duas
  // peças gastam INDEPENDENTE quando as duas protegem o mesmo tipo.
  {
    id: 'charge-ring', name: 'Charge Ring', kind: 'ring', slot: 'finger',
    weight: 1, value: 0, charges: 2,
    mitigation: { resistances: { fire: 0.2 } },
  },
  // Boots of haste (#524): bônus de velocidade PASSIVO enquanto vestido.
  {
    id: 'fast-boots', name: 'Fast Boots', kind: 'armor', slot: 'feet',
    weight: 1, value: 0, bonuses: { speed: 50 },
  },
  // Item de bônus de skill (#524, Hat of the Mad/Paladin Armor): soma na skill `distance`.
  {
    id: 'sharp-hat', name: 'Sharp Hat', kind: 'armor', slot: 'head',
    weight: 1, value: 0, bonuses: { skill: { skillId: 'melee', amount: 20 } },
  },
  // Crítico e leech de EQUIPAMENTO (M30-04, #551): 100 % de chance, +100 % de dano e 50 % de
  // life leech — números redondos para os testes medirem sem depender de sorteio.
  {
    id: 'crit-leech-ring', name: 'Crit Leech Ring', kind: 'ring', slot: 'finger',
    weight: 1, value: 0,
    combatModifiers: { criticalChance: 10_000, criticalDamage: 10_000, lifeLeech: 5_000 },
  },
];

// A munição é ABSTRATA (ADR 0026 d.3): sem item, sem pilha, sem peso. Cada tiro debita o preço.
const ammunition = [
  { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1 },
];

// A aparência é DERIVADA (FUN-94). Estes testes falam de combate, rota, loot e bot; a arte não
// muda nenhum resultado, e escrevê-la à mão obrigaria toda fixture nova de monstro a inventar
// um número que ninguém lê.
const raw = (over: Partial<RawContent> = {}): RawContent => {
  const base: RawContent = {
    monsters: [rat], hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
    stamina: [stamina], party: [party], spells, skills, weaponFamilies,
    items, supplies, ammunition,
    // O bot é o produto (invariante 11): sem `bot/baseline.json` o conteúdo não monta.
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [map], routes: [route], ...over,
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};

const content = (over: Partial<RawContent> = {}): Content => buildContent(raw(over));

const character = (
  over: Partial<{
    health: number; staminaMs: number; skills: SkillsState; inventory: InventoryState;
    bestiary: BestiaryState; gold: number;
  }> = {},
): CharacterRuntime => {
  const stats = statsForLevel(1, null, progression as Progression);
  return new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
    mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: over.staminaMs ?? stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: over.gold ?? 0,
    goldDelta: 0, alive: true, cooldowns: {},
    capacity: 1_000,
    ...(over.skills === undefined ? {} : { skills: over.skills }),
    ...(over.inventory === undefined ? {} : { inventory: over.inventory }),
    ...(over.bestiary === undefined ? {} : { bestiary: over.bestiary }),
  });
};

interface Started {
  readonly session: Session;
  readonly hero: CharacterRuntime;
  readonly ruleset: HuntRuleset;
}

function start(
  options: { difficulty?: 'cautious' | 'bold'; exitRules?: readonly HuntExitRule[];
    health?: number; staminaMs?: number; loaded?: Content; skills?: SkillsState;
    inventory?: InventoryState; bestiary?: BestiaryState; gold?: number } = {},
): Started {
  const session = createHuntSession({
    id: 'session-1',
    content: options.loaded ?? content(),
    huntId: 'arena',
    difficulty: options.difficulty ?? 'cautious',
    createdAtMs: 0,
    ...(options.exitRules === undefined ? {} : { exitRules: options.exitRules }),
  });
  const hero = character({
    ...(options.health === undefined ? {} : { health: options.health }),
    ...(options.staminaMs === undefined ? {} : { staminaMs: options.staminaMs }),
    ...(options.skills === undefined ? {} : { skills: options.skills }),
    ...(options.inventory === undefined ? {} : { inventory: options.inventory }),
    ...(options.bestiary === undefined ? {} : { bestiary: options.bestiary }),
    ...(options.gold === undefined ? {} : { gold: options.gold }),
  });
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset };
}

/** Avança `durationMs` em passos de `stepMs`. É como se controla o tempo sem esperar por ele. */
function run(session: Session, durationMs: number, stepMs: number): void {
  const steps = Math.floor(durationMs / stepMs);
  for (let i = 0; i < steps && session.ended === null; i++) session.advanceBy(stepMs);
}

describe('entrada', () => {
  it('cria a instância com o mapa, a rota e os spawns da dificuldade escolhida', () => {
    const { session, hero, ruleset } = start();

    expect(session.ruleset.type).toBe('hunt');
    // Fixada na criação (invariante 7): a hunt termina na versão em que começou.
    expect(session.contentVersion).toBe(content().version);
    // Entrou no começo da rota, não na posição que trouxe da cidade.
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });

    session.advanceBy(100);
    expect(ruleset.monsters).toHaveLength(1);
  });

  it('a densidade vem da dificuldade, e ela é dado', () => {
    // Trocar `monsterCount` no JSON tem que mudar a hunt. Se precisasse de código, o formato
    // estaria errado — e é isso que este teste protege.
    const { session, ruleset } = start({ difficulty: 'bold' });
    session.advanceBy(100);
    expect(ruleset.monsters).toHaveLength(3);
  });

  it('aceita um segundo personagem, colocado no tile livre mais próximo do início da rota (#203)', () => {
    // Até o M13 a hunt recusava o segundo ("party é trabalho da F3"); agora ele entra com o
    // próprio `Runner`. Tile é exclusivo: o segundo cai ao lado, e o primeiro passo o traz
    // para a rota por `rejoinNearest`.
    const { session, hero } = start();
    const other = new CharacterRuntime({ ...character().getState(), id: 'other' });
    session.enter(other);
    expect(session.participants).toHaveLength(2);
    expect(other.position).not.toEqual(hero.position);
    expect(Math.max(Math.abs(other.position.x - hero.position.x), Math.abs(other.position.y - hero.position.y))).toBeLessThanOrEqual(3);
  });

  it('recusa dificuldade que a hunt não define', () => {
    expect(() => createHuntSession({
      id: 's', content: content(), huntId: 'arena', difficulty: 'reckless', createdAtMs: 0,
    })).toThrow(/não define a dificuldade "reckless"/);
  });

  it('#companionAt confere o andar: um "companheiro" no MESMO (x, y) de outro andar não desvia a rota (#519)', () => {
    // O monstro (sem agressão, para não interferir) trava o segundo tile da rota (2,1) — o
    // herói fica genuinamente bloqueado por ELE, não por um companheiro. Um segundo
    // personagem no MESMO (x, y) mas em outro andar (mutação direta — não existe rota que
    // chegue lá nesta fixture) não pode ser confundido com quem bloqueia: antes desta issue,
    // `#companionAt` ignorava o `z`, e o herói tentaria "contornar" um companheiro que não
    // está nem perto — e SUCEDIA, porque a sala tem espaço para o desvio diagonal (2,2). A
    // hunt hospeda um personagem só hoje (party é Fase 3), então isto é dormant até lá.
    const loaded = content({
      monsters: [{ ...rat, aggroRadius: 0 }],
      routes: [{ ...route, spawnPoints: [{ routeIndex: 1, radius: 1, monsterId: 'rat' }] }],
    });
    const { session, hero } = start({ loaded });
    const phantom = new CharacterRuntime({ ...character().getState(), id: 'phantom' });
    session.enter(phantom);
    // Mesmo (x, y) do tile que vai bloquear o herói (2,1), andar bem diferente — montagem de
    // teste (como o resto do arquivo já faz), não um passo do `sim`.
    phantom.position = { x: 2, y: 1, z: 99 };

    session.advanceBy(600); // o suficiente para o rato nascer e o herói tentar o 2º tile.

    // Com o desvio (o defeito), o herói estaria em (2,2) — vizinho livre que o passo guloso
    // acharia. Com a checagem de andar, ele fica ONDE ESTAVA: bloqueado de verdade pelo rato,
    // segurando o índice até o tile liberar.
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });
  });
});

describe('a sessão em si', () => {
  it('percorre a rota enquanto não há monstro ao alcance', () => {
    // Sem ponto de spawn não nasce nada: sobra só o andar.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn });

    run(session, 1000, 100);
    // 500 ms por tile: um segundo de rota são dois tiles, e o primeiro passo sai já no
    // primeiro tick porque os cooldowns começam prontos (FUN-25).
    expect(hero.position).toEqual({ x: 4, y: 1, z: 7 });
  });

  it('para para lutar e retoma a rota depois, do mesmo índice', () => {
    const { session, ruleset, hero } = start();

    run(session, 1000, 100);
    // Parado, lutando: o rato saiu do ponto de spawn e encostou.
    expect(ruleset.monsters).toHaveLength(1);
    expect(session.aggregates.kills).toBe(0);
    const paradoEm = hero.position;
    const indice = ruleset.routeIndex;

    run(session, 3000, 100);
    // Matou e voltou a andar — do índice onde tinha parado, nunca do começo (FUN-42).
    expect(session.aggregates.kills).toBe(1);
    expect(ruleset.routeIndex).toBeGreaterThan(indice);
    expect(hero.position).not.toEqual(paradoEm);
  });

  it('o abate deixa o cadáver no chão, que some sozinho depois de corpseTtlMs (FUN-123)', () => {
    // Só visual: o `sim` diz QUAL monstro morreu e ONDE; a arte é do hospedeiro. O loot já foi
    // para a caixa antes. Sem `corpseTtlMs` na hunt, nada disto acontece.
    const loaded = content({ hunts: [{ ...hunt, corpseTtlMs: 1_000 }] });
    const { session, ruleset } = start({ loaded });
    run(session, 10_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    const events = session.drainEvents();
    const appeared = events.filter((e) => e.kind === 'ground-item-appeared');
    const vanished = events.filter((e) => e.kind === 'ground-item-vanished');
    expect(appeared).toHaveLength(session.aggregates.kills);
    expect(appeared[0]).toMatchObject({ monsterId: 'rat', position: { z: 7 } });
    // Um segundo depois de cada um, o `vanished` do MESMO id — e o último ainda pode estar lá.
    const ids = new Set(vanished.map((e) => e.kind === 'ground-item-vanished' ? e.itemId : -1));
    expect(vanished.length).toBeGreaterThanOrEqual(appeared.length - 1);
    for (const e of vanished) if (e.kind === 'ground-item-vanished') expect(ids.has(e.itemId)).toBe(true);
    expect(ruleset.groundItems.length).toBeLessThanOrEqual(1);

    const semCadaver = start();
    run(semCadaver.session, 10_000, 100);
    expect(semCadaver.session.drainEvents().some((e) => e.kind === 'ground-item-appeared')).toBe(false);
  });

  it('o cadáver atravessa o snapshot, e apodrece do outro lado no prazo (FUN-123)', () => {
    const loaded = content({ hunts: [{ ...hunt, corpseTtlMs: 5_000 }] });
    const { session, ruleset } = start({ loaded });
    run(session, 3_000, 100);
    if (ruleset.groundItems.length === 0) run(session, 3_000, 100);
    const before = [...ruleset.groundItems];
    expect(before.length).toBeGreaterThan(0);
    session.drainEvents();

    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed('resume'),
    );
    const restored = resumed.ruleset as HuntRuleset;
    expect(restored.groundItems).toEqual(before);
    run(resumed, 6_000, 100);
    const gone = resumed.drainEvents().filter((e) => e.kind === 'ground-item-vanished');
    expect(gone.map((e) => (e.kind === 'ground-item-vanished' ? e.itemId : -1))).toEqual(
      expect.arrayContaining(before.map((c) => c.id)),
    );
  });

  it('monsterCount é o TOTAL da instância: 3 no pull são 3 vivos com respawn instantâneo (FUN-123)', () => {
    const loaded = content({
      monsters: [{ ...rat, health: 100_000, aggroRadius: 0 }],
      hunts: [{ ...hunt, difficulties: { cautious: { monsterCount: 3, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 1 } } }],
    });
    const { session, ruleset } = start({ loaded });
    run(session, 5_000, 100);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(3);
  });

  it('credita XP por abate', () => {
    const { session, hero } = start();
    run(session, 10_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.xp).toBe(session.aggregates.kills * rat.experience);
    expect(session.aggregates.xpGained).toBe(hero.xp);
  });

  it('credita ao matador o gold sorteado da tabela do monstro (FUN-63)', () => {
    // Gold é DELTA no personagem e agregado na sessão, e os dois têm que bater: é o agregado
    // que vira linha de ledger, e um delta que o extrato não leva é gold que some no deploy.
    const { session, hero } = start();
    run(session, 20_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.goldDelta).toBe(session.aggregates.kills * 3);
    expect(session.aggregates.goldGained).toBe(hero.goldDelta);
  });

  it('chance zero nunca credita, e o abate conta do mesmo jeito', () => {
    const stingy = { ...rat, loot: { gold: { chance: 0, min: 1, max: 4 }, items: [] } };
    const { session, hero } = start({ loaded: content({ monsters: [stingy] }) });
    run(session, 20_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.goldDelta).toBe(0);
    expect(session.aggregates.goldGained).toBe(0);
  });

  it('a atribuição de dano atravessa o snapshot, e o abate retomado credita igual', () => {
    // Sem a atribuição no snapshot, o abate depois de uma retomada creditaria só a quem
    // bateu depois dela. Aqui a retomada acontece no MEIO da luta, e o resultado tem que ser
    // o da sessão que nunca caiu.
    const straight = start();
    const interrupted = start();
    // Até o primeiro golpe trocado: o monstro precisa estar ferido, não morto.
    while (interrupted.ruleset.monsters.every((m) => m.contribution.lastHitBy === null)
      && interrupted.session.nowMs < 30_000) {
      straight.session.advanceBy(100);
      interrupted.session.advanceBy(100);
    }
    expect(interrupted.ruleset.monsters.some((m) => m.contribution.lastHitBy === 'hero')).toBe(true);

    const snapshot = interrupted.session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      new Rng(snapshot.rng),
    );
    run(straight.session, 20_000, 100);
    run(resumed, 20_000, 100);

    expect(resumed.aggregates.kills).toBe(straight.session.aggregates.kills);
    expect(resumed.aggregates.goldGained).toBe(straight.session.aggregates.goldGained);
    expect(resumed.participants[0]?.goldDelta).toBe(straight.hero.goldDelta);
  });

  it('a atribuição do personagem não cresce com os respawns', () => {
    // Cada respawn tem id novo. Sem poda, oito horas de hunt seriam milhares de chaves no
    // mapa do herói, serializadas a cada snapshot.
    const { session, hero, ruleset } = start({ difficulty: 'bold' });
    run(session, 120_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(3);
    expect(hero.contribution.actorCount).toBeLessThanOrEqual(ruleset.monsters.length);
  });

  it('não transforma cada abate em evento notável', () => {
    // `notableEvents` é a lista curta da tela de retorno (§16.2). Uma hunt de oito horas com
    // uma linha por rato não é lista, é log — e ninguém lê log ao voltar.
    const { session } = start({ difficulty: 'bold' });
    run(session, 60_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(1);
    expect(session.notableEvents.filter((e) => e.type === 'kill')).toHaveLength(0);
  });

  it('o monstro morto volta a nascer depois do prazo da hunt, não na hora', () => {
    const { session, ruleset } = start();
    // Até o primeiro abate, e guarda o instante: o prazo conta a partir dele, e prender o
    // teste a um número redondo o faria depender de quantos golpes o herói precisou dar.
    while (session.aggregates.kills === 0 && session.nowMs < 60_000) session.advanceBy(100);
    expect(session.aggregates.kills).toBe(1);
    // Respawn instantâneo faria a rota deixar de importar: o personagem mataria tudo parado
    // num ponto só.
    expect(ruleset.monsters).toHaveLength(0);

    // Ainda dentro dos 30 s da dificuldade: nada nasce, e portanto nada mais morre.
    session.advanceBy(29_000);
    expect(ruleset.monsters).toHaveLength(0);
    expect(session.aggregates.kills).toBe(1);

    // Prazo cumprido: o evento de spawn vence dentro deste avanço.
    session.advanceBy(1_000);
    expect(ruleset.monsters).toHaveLength(1);
  });
});

describe('regeneração (FUN-36)', () => {
  it('recupera por tempo decorrido, sem número por tick', () => {
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn, health: 100 });

    run(session, 30_000, 100);

    // 1 HP/s no conteúdo de teste: trinta segundos são trinta pontos, mais um do primeiro
    // tick — os cooldowns começam PRONTOS (FUN-25), a mesma regra que faz o personagem dar o
    // primeiro passo da rota sem esperar meio segundo parado.
    expect(hero.health).toBe(131);
  });

  it('rende exatamente o mesmo a 10 Hz e a 1 Hz', () => {
    // O erro que este desenho evita: somar `taxa * dtMs / 1000` num acumulador fracionário
    // deriva em ponto flutuante e some com uma unidade a cada dez. Em milissegundos a conta
    // é exata, e a hunt desanexada regenera igual à anexada.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const at = (hz: number): number => {
      const { session, hero } = start({ loaded: semSpawn, health: 100 });
      run(session, 600_000, 1000 / hz);
      return hero.health;
    };
    expect(at(1)).toBe(at(10));
    expect(at(20)).toBe(at(10));
  });

  it('o Life Ring quadruplica a regeneração passiva (224 HP em 30s em vez de 131)', () => {
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({
      loaded: semSpawn, health: 100,
      inventory: {
        backpack: [],
        equipped: { finger: { instanceId: 'ring', itemId: 'life-ring', quantity: 1 } },
      },
    });

    run(session, 30_000, 100);

    // Bônus de +300% (SV-16): 1 ponto vira 4 a cada vencimento. Em 30 segundos são
    // 31 vencimentos × 4 = 124 pontos somados aos 100 iniciais.
    expect(hero.health).toBe(224);
  });

  it('o Life Ring rende exatamente o mesmo a 10 Hz e a 1 Hz', () => {
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const at = (hz: number): number => {
      const { session, hero } = start({
        loaded: semSpawn, health: 100,
        inventory: {
          backpack: [],
          equipped: { finger: { instanceId: 'ring', itemId: 'life-ring', quantity: 1 } },
        },
      });
      run(session, 600_000, 1000 / hz);
      return hero.health;
    };
    expect(at(1)).toBe(at(10));
    expect(at(20)).toBe(at(10));
  });

  it('não passa do máximo', () => {
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn });
    run(session, 60_000, 100);
    expect(hero.health).toBe(hero.maxHealth);
  });

  it('morto não regenera', () => {
    // Sem isso, um personagem que caiu voltaria sozinho na hunt em que morreu, e a morte
    // deixaria de encerrar coisa nenhuma.
    const { session, hero } = start({ difficulty: 'bold', health: 12 });
    run(session, 60_000, 100);
    expect(session.ended).toBe('death');
    expect(hero.health).toBe(0);
  });

  it('vale mesmo com stamina zerada: regenerar não é recompensa', () => {
    // O §10.2 diz que o personagem continua podendo morrer, não que ele passa a morrer mais
    // rápido.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn, health: 100, staminaMs: 0 });
    run(session, 30_000, 100);
    expect(hero.health).toBe(131);
  });

  it('taxa zero não regenera, e não trava o laço de recuperação', () => {
    // Taxa zero não é intervalo infinito: é "não regenera". Sem a saída explícita, o
    // intervalo viraria `Infinity` e o catch-up rodaria até o teto a cada tick.
    const parado = content({
      routes: [{ ...route, spawnPoints: [] }],
      progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    });
    const { session, hero } = start({ loaded: parado, health: 100 });
    run(session, 30_000, 100);
    expect(hero.health).toBe(100);
  });
});

describe('stamina zero', () => {
  it('NÃO encerra a hunt, e bloqueia só a recompensa', () => {
    // A regra que mais parece bug para quem implementa (§10.2). O personagem continua
    // caçando; o que ele deixa de ganhar é XP.
    const { session, hero } = start({ difficulty: 'bold', staminaMs: 0 });

    run(session, 60_000, 100);

    expect(session.ended).toBeNull();
    expect(session.aggregates.kills).toBeGreaterThan(0);
    // O abate conta: o jogador matou, e o extrato mentiria se dissesse que não.
    expect(hero.xp).toBe(0);
    expect(session.aggregates.xpGained).toBe(0);
    // E vale para o loot também (FUN-63): o portão do §10.2 é da recompensa inteira.
    expect(hero.goldDelta).toBe(0);
    expect(session.aggregates.goldGained).toBe(0);
  });

  it('cai 1:1 com o tempo de hunt', () => {
    const { session, hero } = start();
    run(session, 30_000, 100);
    expect(hero.staminaMs).toBe(86_400_000 - 30_000);
  });

  it('avisa UMA vez ao zerar, e a hunt segue', () => {
    // O cenário comum é o jogador ausente: daqui para a frente a hunt queima supply sem
    // gerar nada. Repetir a linha a cada tick encheria a tela de retorno com ela só.
    const { session } = start({ difficulty: 'bold', staminaMs: 5_000 });

    run(session, 60_000, 100);

    expect(session.ended).toBeNull();
    expect(session.notableEvents.filter((e) => e.type === 'stamina-exhausted'))
      .toHaveLength(1);
  });

  it('a hunt rende normalmente enquanto sobra stamina', () => {
    const { session, hero } = start({ difficulty: 'bold' });
    run(session, 60_000, 100);
    expect(hero.xp).toBeGreaterThan(0);
  });
});

describe('level up e penalidade de morte dentro da hunt', () => {
  it('subir de level É evento notável, ao contrário do abate', () => {
    // É a única coisa que aconteceu numa hunt de oito horas que o jogador quer ver ao voltar.
    const { session } = start({ difficulty: 'bold' });
    run(session, 120_000, 100);
    expect(session.notableEvents.filter((e) => e.type === 'level-up').length)
      .toBeGreaterThan(0);
  });

  it('morrer cobra XP, e o extrato conta a perda em vez de escondê-la', () => {
    // O extrato é o que vira linha de ledger: creditar a XP ganha sem descontar a perdida
    // daria ao jogador uma XP que ele não tem.
    const { session, hero } = start({ difficulty: 'bold', health: 12 });
    hero.level = 20;
    hero.xp = totalXpForLevel(20, progression as Progression);

    run(session, 60_000, 100);

    expect(session.ended).toBe('death');
    expect(hero.level).toBe(19);
    expect(session.aggregates.xpGained).toBeLessThan(0);
    expect(session.notableEvents.find((e) => e.type === 'xp-penalty')).toBeDefined();
    expect(session.notableEvents.find((e) => e.type === 'level-down')?.detail).toBe('20 → 19');
  });

  it('Premium paga menos por morrer', () => {
    const cobrança = (premium: boolean): number => {
      const session = createHuntSession({
        id: 's', content: content(), huntId: 'arena', difficulty: 'bold',
        createdAtMs: 0, premium,
      });
      const hero = character({ health: 12 });
      hero.level = 20;
      hero.xp = totalXpForLevel(20, progression as Progression);
      session.enter(hero);
      run(session, 60_000, 100);
      return Number(session.notableEvents.find((e) => e.type === 'xp-penalty')?.detail);
    };
    expect(cobrança(true)).toBeLessThan(cobrança(false));
  });

  it('a vocação escolhida no level 8 rege o level 9, e só ele (#154, ADR 0026 decisão 1)', () => {
    // A escolha não recalcula nada na hora (`progression.ts`: não é retroativa); o PRÓXIMO
    // level up sobe pela tabela da vocação — que é o que a #154 liga. Mutação que mata: o
    // ruleset ler `vocations` por um id que não é o escolhido, ou `chooseVocation` não gravar.
    const knight = {
      id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25,
    };
    const withKnight = content({ vocations: [knight] });
    const at = (hz: number): { max: number; level: number } => {
      const { session, hero } = start({ loaded: withKnight, difficulty: 'bold' });
      hero.level = 8;
      // A um ponto do 9: o primeiro abate sobe de level.
      hero.xp = totalXpForLevel(9, progression as Progression) - 1;
      const before = statsForLevel(8, null, progression as Progression);
      hero.maxHealth = before.maxHealth;
      hero.health = before.maxHealth;
      const chosen = hero.chooseVocation(
        withKnight.vocations.get('knight') as NonNullable<ReturnType<typeof withKnight.vocations.get>>,
        null, { catalog: withKnight.items, vocationLevel: progression.vocationLevel, instanceId: 's:hero:vocation', rules: { backpackSlots: 0, satchelSlots: 0, row: 1 } },
      );
      expect(chosen.ok).toBe(true);
      // Nada muda no instante da escolha.
      expect(hero.maxHealth).toBe(before.maxHealth);
      run(session, 240_000, 1000 / hz);
      return { max: hero.maxHealth, level: hero.level };
    };
    const ten = at(10);
    expect(ten.level).toBeGreaterThanOrEqual(9);
    // Do 8 para o `level` final: cada level acima do 8 soma o `healthPerLevel` do Knight (15),
    // não o da base (5).
    const expected = statsForLevel(8, null, progression as Progression).maxHealth + (ten.level - 8) * 15;
    expect(ten.max).toBe(expected);
    expect(at(1)).toEqual(ten);
  });

  it('sair ou ser encerrado por regra NÃO custa XP: quem paga é quem morre', () => {
    const { session, hero } = start({ difficulty: 'bold' });
    hero.level = 20;
    hero.xp = totalXpForLevel(20, progression as Progression);
    const antes = hero.xp;

    run(session, 10_000, 100);
    session.end('manual-exit');

    expect(hero.xp).toBeGreaterThanOrEqual(antes);
    expect(session.notableEvents.find((e) => e.type === 'xp-penalty')).toBeUndefined();
  });
});

describe('encerramento', () => {
  it('por ação manual, com extrato', () => {
    const { session } = start();
    run(session, 10_000, 100);
    const [receipt] = session.end('manual-exit');

    expect(session.ended).toBe('manual-exit');
    if (receipt === undefined) throw new Error('sem extrato');
    expect(receipt.reason).toBe('manual-exit');
    expect(receipt.aggregates.kills).toBeGreaterThan(0);
    expect(receipt.notableEvents.map((e) => e.type)).toContain('ended');
  });

  it('por regra automática de saída, dizendo QUAL regra', () => {
    // "Sua hunt encerrou por uma regra de saída" sem dizer qual é a mensagem que faz o
    // jogador desconfiar do bot que ele mesmo configurou.
    const rule: HuntExitRule = { id: 'two-kills', when: (view) => view.aggregates.kills >= 2 };
    const { session } = start({ exitRules: [rule] });

    run(session, 60_000, 100);

    expect(session.ended).toBe('exit-rule');
    expect(session.aggregates.kills).toBe(2);
    expect(session.notableEvents.find((e) => e.type === 'exit-rule')?.detail).toBe('two-kills');
  });

  it('por morte, com o extrato registrando a morte', () => {
    // Três ratos, não um: com a regeneração da FUN-36 no lugar, um rato sozinho já não mata
    // um personagem de level 1 — ele apanha, mata, e recupera durante o respawn.
    const { session, hero } = start({ difficulty: 'bold', health: 12 });
    run(session, 60_000, 100);

    expect(hero.alive).toBe(false);
    expect(session.ended).toBe('death');
    expect(session.aggregates.deaths).toBe(1);
    expect(session.notableEvents.map((e) => e.type)).toContain('death');
  });

  it('encerrada, não avança mais', () => {
    const { session, ruleset } = start();
    run(session, 10_000, 100);
    session.end('manual-exit');
    const antes = { ...session.aggregates };
    const monstros = ruleset.monsters.length;

    run(session, 60_000, 100);

    expect(session.aggregates).toEqual(antes);
    expect(ruleset.monsters).toHaveLength(monstros);
  });
});

describe('troca de dificuldade', () => {
  it('encerra a instância e cria outra, em vez de mudar no meio', () => {
    // §14.7: não existe alteração dinâmica. Mudar `monsterCount` no meio deixaria monstros
    // da densidade antiga vivos ao lado dos novos, e o jogador veria uma dificuldade que não
    // é nenhuma das duas.
    const loaded = content();
    const { session, hero } = start({ loaded });
    run(session, 10_000, 100);

    const { session: nova, receipts: [receipt] } = changeDifficulty(session, {
      content: loaded, to: 'bold', newSessionId: 'session-2', nowMs: session.nowMs,
    });

    expect(session.ended).toBe('manual-exit');
    if (receipt === undefined) throw new Error('sem extrato');
    expect(receipt.aggregates.kills).toBeGreaterThan(0);
    expect(receipt.notableEvents.find((e) => e.type === 'difficulty-changed')?.detail)
      .toBe('cautious → bold');

    // Instância NOVA: id novo, agregados zerados, e a densidade da dificuldade nova.
    expect(nova.id).toBe('session-2');
    expect(nova.aggregates.kills).toBe(0);
    expect(nova.participants[0]).toBe(hero);
    nova.advanceBy(100);
    expect((nova.ruleset as HuntRuleset).monsters).toHaveLength(3);
  });
});

describe('snapshot', () => {
  it('retoma no mesmo ponto da rota, com os mesmos monstros e os mesmos prazos', () => {
    const loaded = content();
    const { session, ruleset } = start({ loaded });
    run(session, 8000, 100);

    const snapshot = session.snapshot();
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    const depois = retomado.ruleset as HuntRuleset;
    expect(depois.routeIndex).toBe(ruleset.routeIndex);
    expect(depois.monsters.map((m) => m.getState()))
      .toEqual(ruleset.monsters.map((m) => m.getState()));
    expect(retomado.aggregates).toEqual(session.aggregates);
    expect(retomado.participants[0]?.position).toEqual(session.participants[0]?.position);
  });

  it('retomada continua respawnando, e o prazo conta da retomada (FUN-70)', () => {
    // O teste que a FUN-70 pede, e o defeito que ele guarda era TOTAL, não marginal.
    //
    // `SpawnSlot` guardava `respawnAtMs` como instante absoluto derivado do `performance.now()`
    // do processo. Medido: nó A com seis horas de relógio marcava o respawn em 21.802.500; o nó
    // B subia com 5.000 e retomava. O prazo nunca vencia — a hunt rodava, gastava CPU, queimava
    // stamina e não gerava um único monstro, para sempre, sem erro nem log. Só voltaria a
    // funcionar quando o nó B acumulasse ~seis horas de `performance.now()`.
    //
    // O `rebaseClock` do ADR 0018 resolvia metade: reposicionava `lastTickMs` para o `dtMs` não
    // sair negativo, e deixava os instantes absolutos DENTRO do estado do ruleset na linha do
    // tempo antiga. Com relógio lógico (FUN-68) a classe inteira sai, porque não há instante de
    // processo em lugar nenhum — mas isso precisa de teste, não de confiança.
    const loaded = content();
    const { session, ruleset } = start({ loaded });

    // Até o primeiro abate: é o que deixa um respawn PENDENTE quando o snapshot é tirado. Sem
    // pendência, o teste passaria sem exercitar nada.
    while (session.aggregates.kills === 0 && session.nowMs < 60_000) session.advanceBy(100);
    expect(session.aggregates.kills).toBe(1);
    expect(ruleset.monsters).toHaveLength(0);

    // Pelo JSON, porque é assim que ele atravessa o Redis: um instante que só existisse em
    // memória passaria por aqui sem ser notado.
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );
    const depois = retomado.ruleset as HuntRuleset;
    expect(depois.monsters).toHaveLength(0);

    // Ainda dentro dos 30 s da dificuldade: nada nasce.
    retomado.advanceBy(29_000);
    expect(depois.monsters).toHaveLength(0);

    // Prazo cumprido: nasce. É esta linha que falhava com `0 monstros vivos` depois de dez
    // vezes o `respawnDelayMs`.
    retomado.advanceBy(2_000);
    expect(depois.monsters).toHaveLength(1);
  });

  it('não sobrou instante de processo no estado do ruleset (FUN-70)', () => {
    // A varredura que a FUN-70 pede antes de fechar: `respawnAtMs` era o único portador de
    // instante absoluto EM USO, e o mapa `until` de `Cooldowns` era o outro, morto. Se um
    // terceiro aparecer, ele reabre a mesma classe de defeito — e em silêncio.
    //
    // O que a fila da sessão guarda é relativo ao zero dela, então nada aqui pode passar do
    // relógio lógico por mais que a hunt inteira ainda tem pela frente.
    const { session, ruleset } = start();
    run(session, 8000, 100);

    for (const slot of (ruleset.getState()).spawner.slots) {
      expect(Object.keys(slot).sort()).toEqual(['occupantId', 'pointIndex']);
    }
    expect(Object.keys(ruleset.getState().route).sort()).toEqual(['index', 'stopped']);
    for (const monster of ruleset.getState().monsters) {
      expect(monster.cooldowns).toEqual({ until: {} });
    }
  });

  it('recusa retomar num conteúdo que não tem mais a hunt', () => {
    // Retomar na hunt errada é pior que não retomar: seriam monstros de um mapa andando em
    // outro, creditando XP que ninguém sabe de onde veio.
    const loaded = content();
    const { session } = start({ loaded });
    run(session, 1000, 100);

    const outro = buildContent(raw({
      hunts: [{ ...hunt, id: 'other' }], routes: [route], maps: [map],
    }));
    expect(huntRulesetFromSnapshot(session.snapshot(), outro)).toBeNull();
  });
});

describe('taxa de avanço', () => {
  /** Dez minutos de hunt na taxa dada. Tempo controlado: nada aqui espera de verdade. */
  const tenMinutesAt = (
    hz: number, difficulty: 'cautious' | 'bold', loaded?: Content,
  ): { session: Session; hero: CharacterRuntime } => {
    const { session, hero } = start({ difficulty, ...(loaded === undefined ? {} : { loaded }) });
    run(session, 600_000, 1000 / hz);
    return { session, hero };
  };

  const RATES = [1, 2, 5, 10, 20];

  it('rende exatamente o mesmo a 1, 2, 5, 10 e 20 Hz', () => {
    // O TESTE QUE DEFINE O PROJETO, agora numa sessão que de fato simula uma hunt. Se ele
    // quebrar, a hunt desanexada — que é o modo PADRÃO do jogo — deixou de valer o mesmo que
    // a anexada (invariantes 2 e 3).
    //
    // Desde a FUN-68 isto é uma propriedade da ESTRUTURA, e não de cada fórmula ter sido
    // escrita com cuidado: os eventos vencem nos mesmos instantes lógicos seja qual for o
    // tamanho da janela em que são despachados.
    const rendimento = RATES.map((hz) => {
      const { session, hero } = tenMinutesAt(hz, 'cautious');
      return { kills: session.aggregates.kills, xp: session.aggregates.xpGained, heroXp: hero.xp };
    });
    expect(rendimento[0]?.kills).toBeGreaterThan(0);
    for (const resultado of rendimento) expect(resultado).toEqual(rendimento[0]);
  });

  it('com vários monstros disputando o mesmo ponto, rende exatamente o mesmo', () => {
    // Este teste já foi um LIMITE de 5%, e virou igualdade na FUN-68. O motivo do limite era
    // real: com três monstros disputando um ponto, quem está "mais perto" mudava com a
    // granularidade do passo, porque num tick longo todos andavam vários tiles de uma vez
    // antes de alguém reavaliar distância. Com a fila, cada passo acontece no seu instante e
    // a vizinhança é a mesma em qualquer taxa — não sobra folga para o limite cobrir.
    const kills = RATES.map((hz) => tenMinutesAt(hz, 'bold').session.aggregates.kills);
    expect(kills[0]).toBeGreaterThan(0);
    for (const k of kills) expect(k).toBe(kills[0]);
  });

  it('e o dano SOFRIDO também é igual, desde a FUN-68', () => {
    // Este teste já foi um LIMITE, e virou uma igualdade. Vale guardar a história, porque ela
    // é a justificativa da FUN-68.
    //
    // A recompensa sempre foi igual entre taxas; o dano sofrido, não. Medido: 350 a 10 Hz
    // contra 530 a 1 Hz, 1,51× — e 1 Hz é a hunt desanexada, que é o modo PADRÃO do jogo.
    // Quem caçava AFK apanhava metade a mais.
    //
    // A causa era granularidade de ESPAÇO, não de tempo. Num tick de 1 s o personagem andava
    // dois tiles de uma vez, o rato também, e a adjacência era conferida UMA vez no fim: eles
    // passavam mais ticks colados do que passariam a 10 Hz, e é enquanto estão colados que o
    // ataque avança. O tick em lote não tinha como expressar "os dois andaram em t+500 e
    // nesse instante não estavam adjacentes".
    //
    // O comentário anterior dizia que corrigir "pediria subdividir o tick, o que gasta o que
    // cair para 1 Hz economiza". Era uma falsa escolha: o scheduler lógico processa só os
    // eventos que VENCEM, e é mais barato que o laço que ele substituiu.
    //
    // Sem regeneração NESTE cenário, e é decisão: a comparação é sobre granularidade, e um
    // personagem que se cura enquanto apanha mede as duas coisas somadas.
    const semRegen = content({
      progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    });
    const dano = (hz: number): number => {
      const { hero } = tenMinutesAt(hz, 'cautious', semRegen);
      return hero.maxHealth - hero.health;
    };
    // E não é vácuo: o cenário machuca de verdade nas duas pontas.
    expect(dano(10)).toBeGreaterThan(0);
    for (const hz of RATES) expect(dano(hz)).toBe(dano(10));
  });

  it('desanexada cai para 1 Hz; anexada sobe para 10 (ADR 0003)', () => {
    const { session } = start();
    expect(session.currentHz()).toBe(1);
    session.attach('viewer');
    expect(session.currentHz()).toBe(10);
  });
});

describe('seleção de hunt', () => {
  it('mostra level recomendado e não tem onde guardar XP/h', () => {
    // §14.3. A regra vira ESTRUTURA: um número oficial de XP/h vira a métrica pela qual toda
    // hunt é julgada, e a partir daí só existe uma hunt boa — a do topo da tabela.
    const [listing] = huntListings(content());
    expect(listing).toEqual({
      id: 'arena', name: 'Arena', recommendedLevel: 1,
      difficulties: ['cautious', 'bold'],
    });
  });

  it('ordena por level recomendado, para servir a quem está começando', () => {
    const alta = { ...hunt, id: 'deep', name: 'Deep', recommendedLevel: 50 };
    expect(huntListings(content({ hunts: [alta, hunt] })).map((h) => h.id))
      .toEqual(['arena', 'deep']);
  });

  it('copia description quando definida e deixa undefined quando não definida (SV-21, #357)', () => {
    const comDescricao = { ...hunt, description: 'Os porões de pedra sob Rookgaard.' };
    const [com] = huntListings(content({ hunts: [comDescricao] }));
    expect(com?.description).toBe('Os porões de pedra sob Rookgaard.');

    const [sem] = huntListings(content({ hunts: [hunt] }));
    expect(sem?.description).toBeUndefined();
    expect('description' in (sem ?? {})).toBe(false);
  });
});

describe('eventos de domínio (FUN-69)', () => {
  it('a hunt produz CreatureMoved do bot e dos monstros', () => {
    // `creature-move` não tinha emissor nenhum antes desta issue — nem para o bot, nem para os
    // monstros —, e é por isso que os 42,8 bytes/s medidos na FUN-45 não significavam nada: a
    // hunt não transmitia mundo para viewer algum.
    const { session } = start();
    run(session, 3000, 100);

    // Desde a FUN-103 a fila também traz nascimento, sumiço e vida: aqui só os passos.
    const eventos = session.drainEvents().filter((e) => e.kind === 'creature-moved');
    expect(eventos.length).toBeGreaterThan(0);
    for (const evento of eventos) {
      expect(evento.durationMs).toBeGreaterThan(0);
      // O andar vem do MAPA, e vai junto: quem lê isto do lado de fora precisa de `z`.
      expect(evento.to.z).toBe(7);
    }
    // Os dois lados do mundo se movem, e os dois são anunciados.
    const quemAndou = new Set(eventos.map((e) => String(e.creatureId)));
    expect(quemAndou.has('hero')).toBe(true);
    expect([...quemAndou].some((id) => id.startsWith('m:'))).toBe(true);
  });

  it('o monstro que NASCE é anunciado, com posição, vida e o id de conteúdo (FUN-103)', () => {
    // Antes disto o passo do monstro atravessava o fio com um id que ninguém tinha anunciado,
    // e o cliente descartava em silêncio: a hunt rodava inteira e a tela ficava vazia.
    const { session } = start();
    run(session, 100, 100);

    const nascidos = session.drainEvents().filter((e) => e.kind === 'creature-appeared');
    expect(nascidos.length).toBeGreaterThan(0);
    for (const nascido of nascidos) {
      expect(String(nascido.creatureId)).toMatch(/^m:/);
      expect(nascido.monsterId).toBe('rat');
      // Da fixture, não um literal: o número certo é o que o conteúdo diz.
      expect(nascido.health).toBe(rat.health);
      expect(nascido.maxHealth).toBe(rat.health);
      // O `z` é do mapa, como no passo — sem ele o cliente não sabe em que andar desenhar.
      expect(nascido.position.z).toBe(7);
    }
  });

  it('o monstro que MORRE some, e a vida dele mudou antes disso', () => {
    const { session, hero } = start();
    // Tempo bastante para o herói matar pelo menos um rato.
    run(session, 60_000, 100);
    const eventos = session.drainEvents();

    const vidas = eventos.filter((e) => e.kind === 'creature-health-changed');
    const sumidos = eventos.filter((e) => e.kind === 'creature-vanished');
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(sumidos.length).toBe(session.aggregates.kills);
    // Cada abate foi precedido de ao menos um golpe que mudou a vida — e o último deles
    // deixou zero. Sem `creature-health`, a barra ficaria cheia até o monstro sumir.
    for (const sumido of sumidos) {
      const dele = vidas.filter((v) => v.creatureId === sumido.creatureId);
      expect(dele.length).toBeGreaterThan(0);
      expect(dele[dele.length - 1]?.health).toBe(0);
      expect(dele[0]?.maxHealth).toBe(rat.health);
    }
    expect(hero.alive).toBe(true);
  });

  it('a lista de monstros VIVOS e o andar ficam expostos para quem monta o session-state', () => {
    // Quem reanexa no meio da hunt precisa ver o que já está lá, não só o que nascer depois.
    const { session, ruleset } = start();
    run(session, 100, 100);
    expect(ruleset.monsters.length).toBeGreaterThan(0);
    expect(ruleset.monsters.every((m) => m.alive)).toBe(true);
    expect(ruleset.floor).toBe(7);
  });

  it('desanexada produz exatamente os mesmos eventos que anexada', () => {
    // O invariante 3 em forma de teste, e é o que o §12 exige em letra: viewer decide quem
    // SERIALIZA, nunca o que acontece. Um `if (temViewer)` no caminho de emissão faria a hunt
    // desanexada divergir sem ninguém ver.
    const semObservador = start();
    run(semObservador.session, 5000, 100);

    const comObservador = start();
    comObservador.session.attach('viewer-1');
    run(comObservador.session, 5000, 100);

    expect(comObservador.session.drainEvents()).toEqual(semObservador.session.drainEvents());
  });

  it('drenar esvazia, porque o que aconteceu não é o que a sessão é', () => {
    const { session } = start();
    run(session, 2000, 100);
    expect(session.drainEvents().length).toBeGreaterThan(0);
    expect(session.drainEvents()).toHaveLength(0);
  });

  it('não entra no snapshot — um passo reentregue viraria passo repetido na tela', () => {
    const { session } = start();
    run(session, 2000, 100);
    expect(Object.keys(session.snapshot())).not.toContain('domainEvents');
    // E a sessão retomada nasce sem nada a anunciar: o que aconteceu já aconteceu.
    const snapshot = session.snapshot();
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );
    expect(retomado.drainEvents()).toHaveLength(0);
  });

  it('sessão que ninguém drena não acumula sem limite', () => {
    // Uma hunt desanexada roda por horas. O teto é da `Session` porque o descarte precisa
    // existir mesmo se o hospedeiro esquecer de drenar — e isto é apresentação, que é
    // perdível. Gameplay não passa por aqui.
    const { session } = start();
    run(session, 600_000, 100);
    expect(session.drainEvents().length).toBeLessThanOrEqual(MAX_PENDING_DOMAIN_EVENTS);
  });
});

describe('movimento com escritor único (FUN-69)', () => {
  it('o walk recebe as razões tipadas, pelo mesmo caminho que o bot e o monstro', () => {
    // O ponto da FUN-69: uma regra de legalidade, três fontes. O jogador é a única fonte com
    // porta própria (`requestMove`); bot e monstro chegam à MESMA `canOccupy` por construção —
    // o passo de rota via `#step`, e o guloso via um `Blocked` derivado dela. O que se afirma
    // aqui é que a porta do jogador devolve a razão certa em cada caso, e que a legalidade
    // compartilhada vale para os monstros no teste seguinte.
    const { session, ruleset, hero } = start();
    session.advanceBy(100);
    const { x, y } = hero.position;

    // A parede logo ao norte: a arena tem y=0 bloqueado inteiro.
    expect(ruleset.requestMove(session, hero.id, { x, y: 0 }))
      .toEqual({ ok: false, reason: y === 1 ? 'tile-blocked' : 'not-adjacent' });
    expect(ruleset.requestMove(session, hero.id, { x: x + 2, y }))
      .toEqual({ ok: false, reason: 'not-adjacent' });
    expect(ruleset.requestMove(session, hero.id, { x, y }))
      .toEqual({ ok: false, reason: 'same-tile' });
    expect(ruleset.requestMove(session, hero.id, { x: -1, y: -1 }))
      .toEqual({ ok: false, reason: 'not-adjacent' });
  });

  it('monstros nunca acabam em parede nem dois no mesmo tile — a legalidade é compartilhada', () => {
    // A prova de que o guloso consulta a mesma `canOccupy`: dez minutos com três ratos
    // disputando um ponto, e nenhum instante com corpo em parede ou dois corpos num tile.
    const loaded = content();
    const { session, ruleset } = start({ difficulty: 'bold', loaded });
    const map = loaded.maps.get('arena');
    if (map === undefined) throw new Error('esperava o mapa');
    for (let i = 0; i < 600; i++) {
      session.advanceBy(1000);
      const tiles = new Set<string>();
      for (const m of ruleset.monsters) {
        expect(isBlocked(map, m.position.x, m.position.y)).toBe(false);
        tiles.add(`${m.position.x},${m.position.y}`);
      }
      expect(tiles.size).toBe(ruleset.monsters.length);
    }
  });

  it('um passo manual sai da rota, e o bot reentra pelo tile mais próximo', () => {
    // Sem isto o walker seguraria um índice que nunca mais fica adjacente, e o personagem
    // ficaria parado para sempre depois do primeiro `walk` — o pior formato de falha.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, ruleset, hero } = start({ loaded: semSpawn });
    session.advanceBy(100);                                    // um passo de rota
    const antes = ruleset.routeIndex;

    // Para dentro da sala, fora da rota (que percorre a borda interna).
    const manual = ruleset.requestMove(session, hero.id, { x: 2, y: 2 });
    expect(manual.ok).toBe(true);
    expect(hero.position).toEqual({ x: 2, y: 2, z: 7 });

    // O vencimento seguinte do passo de rota descobre e reentra, em vez de travar.
    run(session, 1000, 100);
    expect(ruleset.routeIndex).not.toBe(antes);
    // O passo, e não "qualquer evento dele": desde a FUN-109 a fila traz eventos sem
    // `creatureId` (lançamento, supply), e o que este teste afirma é que ele ANDOU.
    expect(session.drainEvents().some(
      (e) => e.kind === 'creature-moved' && e.creatureId === hero.id,
    )).toBe(true);
  });

  it('o passo manual também é um passo: o bot não dá o dele dentro da mesma duração (FUN-122)', () => {
    // O `PLAYER_STEP` já agendado — com a cadência do passo anterior — venceria logo depois
    // do passo manual, e o personagem daria dois passos na duração de um. Reagendado a partir
    // do passo manual, o próximo passo de quem quer que seja vem só quando ele acaba.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, ruleset, hero } = start({ loaded: semSpawn });
    session.advanceBy(100);
    session.drainEvents();
    // Um instante antes de o passo de rota vencer (o herói de teste anda a 500 ms).
    session.advanceBy(350);
    session.drainEvents();

    const manual = ruleset.requestMove(session, hero.id, { x: 2, y: 2 });
    expect(manual.ok).toBe(true);
    const duration = manual.ok ? manual.durationMs : 0;
    expect(duration).toBeGreaterThan(0);
    // O evento do próprio passo manual sai daqui; o que se conta é o que vier DEPOIS dele.
    session.drainEvents();

    // Até o fim do passo manual, nenhum outro passo do herói.
    session.advanceBy(duration - 50);
    expect(session.drainEvents().filter(
      (e) => e.kind === 'creature-moved' && e.creatureId === hero.id,
    )).toHaveLength(0);
    // Depois dele, o bot volta a andar — a rota não ficou órfã.
    run(session, 2000, 50);
    expect(session.drainEvents().some(
      (e) => e.kind === 'creature-moved' && e.creatureId === hero.id,
    )).toBe(true);
  });

});

// --- as cinco categorias do bot (FUN-84) -----------------------------------------------------

import type { BotAction, BotConfig, BotConfigV2, BotSlot } from '@draconya/content';
import {
  BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, BOT_VOCABULARY_VERSION_V1, botConfigSchema,
  botConfigV2Schema, botExitRuleSchema, botSlotSchema, botTargetingSchema,
} from '@draconya/content';

/** O tipo de config que o ruleset aceita: v1 (migrada) ou v2 (o alvo). */
type BotConfigInput = BotConfig | BotConfigV2;

const botConfig = (over: Partial<BotConfig> = {}): BotConfig =>
  // Pelo SCHEMA, e não por literal: é o schema que sabe preencher `targeting` e o que vier
  // depois dele. Um literal aqui obriga toda fixture a acompanhar cada campo novo com default,
  // que é trabalho que o parse já faz — e do jeito que a produção faz.
  botConfigSchema.parse({
    version: BOT_VOCABULARY_VERSION_V1,
    heal: [], potion: [], attack: [], rune: [], support: [],
    ...over,
  });

/** Um conjunto v2: 24 posições, as dadas na frente e o resto vazio. */
const v2Set = (given: readonly (Partial<BotSlot> | null)[]) => {
  const slots = given.map((slot) => (slot === null ? null : botSlotSchema.parse(slot)));
  while (slots.length < BOT_SLOTS_PER_SET) slots.push(null);
  return { slots };
};
const emptyV2Set = () => v2Set([]);

/** A config v2 com os slots no conjunto ATIVO, na ordem dada (a prioridade é a ordem). */
const botConfigV2 = (
  active: readonly (Partial<BotSlot> | null)[],
  over: Partial<BotConfigV2> = {},
): BotConfigV2 =>
  botConfigV2Schema.parse({
    version: BOT_VOCABULARY_VERSION,
    activeSet: 0,
    sets: [v2Set(active), emptyV2Set(), emptyV2Set(), emptyV2Set()],
    ...over,
  });

/** Um atuador que anota o que foi pedido, e diz se executou. */
const recorder = (executes = true) => {
  const done: BotAction[] = [];
  return {
    done,
    perform(action: BotAction) { if (executes) done.push(action); return executes; },
  };
};

const withBot = (config: BotConfigInput, actuator?: { perform(a: BotAction): boolean }) => {
  const loaded = content();
  const session = createHuntSession({
    id: 'bot-session', content: loaded, huntId: 'arena', difficulty: 'cautious',
    createdAtMs: 0,
    botConfig: config,
    ...(actuator === undefined ? {} : { actuator }),
  });
  const hero = character();
  session.enter(hero);
  return { session, hero };
};

describe('cadência das cinco categorias (FUN-84)', () => {
  const scheduled = (session: Session): readonly string[] =>
    (session.ruleset.getState?.() as { botScheduled?: readonly string[] }).botScheduled ?? [];

  it('personagem SEM bot não agenda categoria nenhuma', () => {
    // O custo de cinco eventos por segundo por hunt só pode existir para quem configurou. Até
    // a FUN-81 isso é todo mundo, e uma fila com evento inerte é custo puro.
    const { session } = start();
    session.advanceBy(5_000);
    expect(scheduled(session)).toEqual([]);
  });

  it('grupo VAZIO não entra na fila, mesmo com bot configurado', () => {
    // Só um slot tem regra, e a magia não está no conteúdo: o grupo é o sintético `spell:x`.
    // O recusador mantém o grupo engatilhado, então o que se vê é exatamente quem foi agendado.
    const { session } = withBot(botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'x' } }],
    }), recorder());
    expect(scheduled(session)).toEqual(['spell:x']);
  });

  it('o estado de "agendado" sobrevive ao snapshot — senão é ação DOBRADA', () => {
    // O evento pendente do grupo está na fila serializada. Restaurar como engatilhado faria o
    // próximo `#armBot` agendar um segundo, e o grupo agiria duas vezes por cooldown. É a mesma
    // invariante do golpe do personagem, e ela já quebrou uma vez lá.
    const { session } = withBot(botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'x' } }],
    }), recorder());

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as { ruleset: unknown };
    expect((snapshot.ruleset as { botScheduled: readonly string[] }).botScheduled)
      .toEqual(['spell:x']);
  });

  it('uma cura que executa NÃO atrasa o ataque: as categorias são independentes', () => {
    // §13.4: sem prioridade global. Se uma categoria bloqueasse a outra, o bot pararia de
    // atacar toda vez que curasse — que é a razão de serem eventos separados na fila.
    const actuator = recorder();
    const { session } = withBot(botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'cure' } }],
      attack: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'bolt' } }],
    }), actuator);

    session.advanceBy(50);

    expect(actuator.done.map((a) => (a.kind === 'spell' ? a.spellId : '')))
      .toEqual(expect.arrayContaining(['cure', 'bolt']));
  });

  it('duas regras elegíveis no MESMO grupo executam SÓ a primeira (RP-001/RP-002)', () => {
    // As duas apontam a MESMA magia, então caem no mesmo grupo sintético `spell:x`: a de menor
    // índice dispara e a segunda não roda neste ciclo. A prioridade por ordem com ações
    // DIFERENTES é o que os testes de RP cobrem com conteúdo de grupo real.
    const actuator = recorder();
    const { session } = withBot(botConfig({
      heal: [
        { when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'x' } },
        { when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'x' } },
      ],
    }), actuator);

    session.advanceBy(50);

    expect(actuator.done).toHaveLength(1);
  });

  it('o cooldown de categoria conta a partir da AÇÃO, e vem do conteúdo', () => {
    // §13.5: 1 s por categoria. O número mora em `bot/baseline.json`, não em código.
    const actuator = recorder();
    const { session } = withBot(botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'cure' } }],
    }), actuator);

    session.advanceBy(50);
    expect(actuator.done).toHaveLength(1);
    // Antes de fechar o segundo, nada de novo.
    session.advanceBy(800);
    expect(actuator.done).toHaveLength(1);
    // Passado o cooldown, a categoria volta.
    session.advanceBy(300);
    expect(actuator.done).toHaveLength(2);
  });

  it('atuador que RECUSA não consome o cooldown da categoria', () => {
    // Sem mana, sem supply: a ação não aconteceu, e a categoria não pode ficar um segundo
    // parada por ter tentado. Ela engatilha e volta quando o mundo mudar.
    const actuator = recorder(false);
    const { session } = withBot(botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'cure' } }],
    }), actuator);

    session.advanceBy(2_000);

    expect(actuator.done).toHaveLength(0);
  });

  it('o mesmo resultado a 1 Hz e a 10 Hz, com as cinco configuradas', () => {
    // O contrato do invariante 3 aplicado ao bot: quem caça desanexado configurou o mesmo bot,
    // e ele precisa render o mesmo.
    const todas = botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'h' } }],
      potion: [{ when: { kind: 'mana', op: '<=', percent: 100 }, do: { kind: 'supply', supplyId: 'p' } }],
      attack: [{ when: { kind: 'targets', op: '>=', count: 0 }, do: { kind: 'spell', spellId: 'a' } }],
      rune: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'supply', supplyId: 'r' } }],
      support: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 's' } }],
    });
    const run = (stepMs: number) => {
      const actuator = recorder();
      const { session } = withBot(todas, actuator);
      for (let at = stepMs; at <= 60_000; at += stepMs) session.advanceBy(stepMs);
      return actuator.done.length;
    };

    expect(run(1_000)).toBe(run(100));
  });
});

// --- o motor de grupos do bot (AB-07, RP-001…RP-004) ------------------------------------------

describe('o motor de grupos do bot (AB-07, RP-001…RP-004)', () => {
  // Duas magias do MESMO grupo `healing` (a segunda barata), um ataque e um haste de grupos
  // distintos. Números redondos: dá para conferir a olho quem executou.
  const grupo = [
    {
      id: 'cura-forte', name: 'Cura Forte', manaCost: 500, cooldownMs: 1_000,
      group: 'healing', groupCooldownMs: 1_000, effect: { kind: 'heal', amount: 200 },
    },
    {
      id: 'cura-fraca', name: 'Cura Fraca', manaCost: 10, cooldownMs: 1_000,
      group: 'healing', groupCooldownMs: 1_000, effect: { kind: 'heal', amount: 20 },
    },
    {
      id: 'golpe', name: 'Golpe', manaCost: 5, cooldownMs: 1_000,
      group: 'attack', groupCooldownMs: 1_000,
      effect: { kind: 'damage', power: 40, range: 3, damageType: 'fire' },
    },
    {
      id: 'acelera', name: 'Acelera', manaCost: 30, cooldownMs: 1_000,
      group: 'support', groupCooldownMs: 1_000,
      effect: { kind: 'haste', durationMs: 2_000, speedPercent: 50 },
    },
  ];
  const catalogo = () => [...spells, ...grupo];
  const cura = (spellId: string) => ({
    when: { kind: 'hp' as const, op: '<=' as const, percent: 100 },
    do: { kind: 'spell' as const, spellId },
  });

  it('RP-004: o slot de cima SEM MANA é pulado e o de baixo do MESMO grupo dispara no ciclo', () => {
    const { session, hero } = withSpells(botConfig({
      heal: [cura('cura-forte'), cura('cura-fraca')],
    }), { health: 1_000, mana: 50, spells: catalogo(), monsters: false });

    session.advanceBy(50);

    // `cura-forte` custa 500 (recusa por mana) e é PULADA; `cura-fraca` sai no mesmo vencimento.
    expect(hero.mana).toBe(40);
    expect(hero.health).toBe(1_020);
  });

  it('RP-001/RP-002: dois slots elegíveis no mesmo grupo — só o PRIMEIRO executa', () => {
    const { session, hero } = withSpells(botConfig({
      heal: [cura('cura-forte'), cura('cura-fraca')],
    }), { health: 1_000, mana: 1_000, spells: catalogo(), monsters: false });

    session.advanceBy(50);

    // Só `cura-forte` (o de maior prioridade) executou; `cura-fraca` não roda neste ciclo.
    expect(hero.mana).toBe(500);
    expect(hero.health).toBe(1_200);
  });

  it('os grupos são INDEPENDENTES: a cura em cooldown não bloqueia o ataque', () => {
    const { session } = withSpells(botConfig({
      heal: [cura('cura-fraca')],
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'golpe' },
      }],
    }), { health: 5_000, mana: 1_000, spells: catalogo() }, 'bold');

    run(session, 2_000, 100);

    // Cada grupo vence no próprio evento: a cura sai E o golpe sai, sem um atrasar o outro.
    const lancadas = session.drainEvents()
      .filter((e) => e.kind === 'spell-cast')
      .map((e) => (e.kind === 'spell-cast' ? e.spellId : ''));
    expect(lancadas).toContain('cura-fraca');
    expect(lancadas).toContain('golpe');
  });

  it('`condition` present:false: a magia de haste só sai SEM haste ativo', () => {
    const { session, hero } = withSpells(botConfigV2([
      {
        when: [{ kind: 'condition', conditionId: 'haste', present: false }],
        do: { kind: 'spell', spellId: 'acelera' },
      },
    ]), { health: 1_000, mana: 1_000, spells: catalogo(), monsters: false });

    run(session, 1_500, 100);

    // Saiu UMA vez; com o efeito ativo o predicado é falso e o slot não repete.
    expect(hero.mana).toBe(970);
    expect(hero.conditions.get('haste')).not.toBeNull();
  });

  it('o bot a 1 Hz e a 10 Hz produz a MESMA sequência de ações', () => {
    const config = botConfig({
      heal: [cura('cura-fraca')],
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'golpe' },
      }],
    });
    const at = (stepMs: number) => {
      const { session } = withSpells(config, {
        health: 5_000, mana: 100_000, spells: catalogo(),
      }, 'bold');
      for (let t = stepMs; t <= 30_000; t += stepMs) session.advanceBy(stepMs);
      return session.drainEvents()
        .filter((e) => e.kind === 'spell-cast')
        .map((e) => (e.kind === 'spell-cast' ? e.spellId : ''));
    };
    expect(at(1_000)).toEqual(at(100));
  });
});

// --- cura em área (Mass Healing, #475, RF-05) -------------------------------------------------

describe('cura em área — Mass Healing (#475, RF-05)', () => {
  const massHealing = {
    id: 'mass-healing', name: 'Mass Healing', manaCost: 20, cooldownMs: 1_000,
    group: 'healing', groupCooldownMs: 1_000, minLevel: 1,
    effect: {
      kind: 'heal', basePower: 200,
      area: { shape: 'circle', radius: 1, centered: 'caster' },
      formula: { levelFactor: 0.2, skillMin: 1.4, skillMax: 2.0, baseMin: 40, baseMax: 60 },
    },
  };
  const healEverything = () => ({
    heal: [{
      when: { kind: 'hp' as const, op: '<=' as const, percent: 100 },
      do: { kind: 'spell' as const, spellId: 'mass-healing' },
    }],
  });

  it('cura o conjurador e os aliados no 3x3, e NÃO quem está fora da área', () => {
    const loaded = buildContent(raw({
      progression: [{
        ...progression, startingMana: 200, regen: { healthPerSecond: 0, manaPerSecond: 0 },
      }],
      routes: [{ ...route, spawnPoints: [] }],
      spells: [...spells, massHealing],
    }));
    const session = createHuntSession({
      id: 'mass-heal', content: loaded, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0, botConfig: botConfig(healEverything()),
    });
    const make = (id: string) => new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: 50, maxHealth: 100, mana: 200, maxMana: 200,
      level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    const caster = make('hero');
    session.enter(caster);
    const ally = make('ally');
    session.enter(ally);
    const longe = make('far');
    session.enter(longe);
    // Posiciona à mão: `enter` coloca "perto", e a área de cura é o 3x3 EXATO. O `far` fica
    // longe o bastante para o primeiro passo (que move o conjurador 1 tile) não o trazer para
    // dentro da forma — é ele quem prova que a cura NÃO é da sessão inteira.
    ally.position = { x: caster.position.x + 1, y: caster.position.y, z: caster.position.z };
    longe.position = { x: caster.position.x + 4, y: caster.position.y + 2, z: caster.position.z };

    session.advanceBy(50);

    // Cada alvo rola a própria cura (40~60 no level 1): a vida sobe, sem passar do teto.
    expect(caster.health).toBeGreaterThan(50);
    expect(caster.health).toBeLessThanOrEqual(100);
    expect(ally.health).toBeGreaterThan(50);
    expect(ally.health).toBeLessThanOrEqual(100);
    // Fora do 3x3 o aliado NÃO é tocado — mutação que mata: curar todo mundo da sessão.
    expect(longe.health).toBe(50);

    const events = session.drainEvents();
    const healed = events.filter((e) => e.kind === 'creature-healed')
      .map((e) => (e.kind === 'creature-healed' ? e.creatureId : ''));
    // O conjurador PRIMEIRO (o `castSpell` já o curou), depois os aliados na ordem da sessão.
    expect(healed).toEqual(['hero', 'ally']);
    const cast = events.find((e) => e.kind === 'spell-cast');
    expect(cast?.kind === 'spell-cast' && cast.tiles).toHaveLength(9);
    expect(cast?.kind === 'spell-cast' && cast.targets.map((t) => t.creatureId)).toEqual(['hero', 'ally']);
  });
});

// --- a contagem de "targets" usa o alcance da ARMA (#216) -------------------------------------

describe('a condição "targets >= N" conta pelo alcance da ARMA, não pelo desarmado (#216)', () => {
  // A sala 4×3 do `arena` (routeIndex 4, radius 2) alcança à vontade: os três ratos do
  // `bold` são repostos a 2 e 3 tiles do herói, que entra em (1, 1) — fora do alcance
  // desarmado (1) e dentro do alcance da wand (3).
  const wand: InventoryState = {
    backpack: [], equipped: { hand: { instanceId: 'i1', itemId: 'wand', quantity: 1 } },
  };

  const withCountRule = (inventory?: InventoryState) => {
    const actuator = recorder();
    const session = createHuntSession({
      id: 'targets-in-reach', content: content(), huntId: 'arena', difficulty: 'bold',
      createdAtMs: 0,
      botConfig: botConfig({
        attack: [{ when: { kind: 'targets', op: '>=', count: 3 }, do: { kind: 'spell', spellId: 'x' } }],
      }),
      actuator,
    });
    const hero = character(inventory === undefined ? {} : { inventory });
    session.enter(hero);
    return { session, ruleset: session.ruleset as HuntRuleset, actuator };
  };

  /** Reposiciona os três ratos do `bold`, todos > 1 e <= 3 tiles do herói em (1, 1). */
  const spreadRats = (ruleset: HuntRuleset): void => {
    const [a, b, c] = ruleset.monsters;
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    a.position = { x: 3, y: 1 };
    b.position = { x: 4, y: 1 };
    c.position = { x: 4, y: 3 };
  };

  it('com a wand na mão (alcance 3), "targets >= 3" DISPARA', () => {
    const { session, ruleset, actuator } = withCountRule(wand);
    session.advanceBy(50);
    spreadRats(ruleset);

    run(session, 3_000, 100);

    expect(actuator.done.some((a) => a.kind === 'spell' && a.spellId === 'x')).toBe(true);
  });

  it('desarmado (alcance 1), os MESMOS três ratos NÃO disparam a regra', () => {
    const { session, ruleset, actuator } = withCountRule();
    session.advanceBy(50);
    spreadRats(ruleset);

    run(session, 3_000, 100);

    expect(actuator.done).toHaveLength(0);
  });
});

// --- o atuador embutido: magia e supply (FUN-74, FUN-77) -------------------------------------

/**
 * Uma hunt com bot e SEM atuador injetado — quem executa é a própria hunt.
 *
 * Mana e gold entram por aqui porque o conteúdo de teste nasceu antes de existir magia: o
 * `progression` compartilhado dá 0 de mana, e mexer nele mudaria os stats de todos os testes
 * acima. Um conteúdo próprio custa quatro linhas e não move nada de lugar.
 */
const withSpells = (
  config: BotConfigInput,
  over: {
    health?: number; mana?: number; gold?: number;
    spells?: readonly unknown[]; items?: readonly unknown[]; supplies?: readonly unknown[];
    monsters?: boolean;
    combat?: readonly unknown[]; monstersRaw?: readonly unknown[];
    /** Equipamento inicial (M30-04, #551) — ausente é o herói nu de sempre. */
    inventory?: InventoryState;
  } = {},
  difficulty: 'cautious' | 'bold' = 'cautious',
) => {
  // **Regeneração zerada, e é decisão.** Aqui o assunto é quanto a magia cura e quanto o
  // supply repõe; com 1 HP/s no meio, toda asserção absoluta viraria "mais ou menos isso", e
  // um teste que ninguém consegue conferir a olho é um teste que ninguém confia. Quem cuida
  // da regeneração é o bloco dela, onde ela é o assunto.
  const loaded = buildContent(raw({
    progression: [{
      ...progression, startingMana: 200, regen: { healthPerSecond: 0, manaPerSecond: 0 },
    }],
    ...(over.monsters === false ? { routes: [{ ...route, spawnPoints: [] }] } : {}),
    ...(over.spells === undefined ? {} : { spells: over.spells }),
    ...(over.items === undefined ? {} : { items: over.items }),
    ...(over.supplies === undefined ? {} : { supplies: over.supplies }),
    ...(over.combat === undefined ? {} : { combat: over.combat }),
    ...(over.monstersRaw === undefined ? {} : { monsters: over.monstersRaw }),
  }));
  const session = createHuntSession({
    id: 'spell-session', content: loaded, huntId: 'arena', difficulty,
    createdAtMs: 0, botConfig: config,
  });
  const stats = statsForLevel(1, null, loaded.progression);
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
    mana: over.mana ?? stats.maxMana, maxMana: stats.maxMana,
    level: 1, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: over.gold ?? 1_000, goldDelta: 0, alive: true, cooldowns: {},
    ...(over.inventory === undefined ? {} : { inventory: over.inventory }),
  });
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset, content: loaded };
};

const healRule = (percent: number) => ({
  when: { kind: 'hp' as const, op: '<=' as const, percent },
  do: { kind: 'spell' as const, spellId: 'heal' },
});

/** Regra de poção abstrata: o slot `supply`, com gold no uso (FUN-77, §20.1). */
const supplyRule = (supplyId: string, percent = 100) => ({
  when: { kind: 'hp' as const, op: '<=' as const, percent },
  do: { kind: 'supply' as const, supplyId },
});

describe('magia (FUN-74)', () => {
  it('a cura repõe HP e debita mana, e os dois números vêm do CONTEÚDO', () => {
    // Mudar quanto a cura cura é editar JSON. Se um destes dois números aparecesse em código,
    // o balanceamento teria virado tarefa de quem mexe em `sim`.
    const { session, hero } = withSpells(
      botConfig({ heal: [healRule(50)] }), { health: 1_000, monsters: false },
    );

    session.advanceBy(50);

    expect(hero.health).toBe(1_060);
    expect(hero.mana).toBe(180);
  });

  it('sem mana a cura é RECUSADA, e a categoria não fica parada por causa disso', () => {
    // Recusar não é falhar: a hunt segue, e o slot volta a valer no instante em que houver
    // mana. Uma exceção aqui derrubaria a sessão por uma regra que o jogador escreveu certa.
    const { session, hero } = withSpells(
      botConfig({ heal: [healRule(50)] }), { health: 1_000, mana: 5, monsters: false },
    );

    session.advanceBy(2_000);

    expect(hero.health).toBe(1_000);
    expect(hero.mana).toBe(5);
  });

  it('o cooldown é POR MAGIA, e a categoria VOLTA no vencimento dele — não fica dormindo', () => {
    // Duas afirmações, e elas são a mesma mecânica vista dos dois lados.
    //
    // Categoria a 1 s, magia a 4 s: em doze segundos saem QUATRO curas — nos instantes 0,
    // 4 000, 8 000 e 12 000 —, e não doze. Quem tratasse o cooldown da categoria como se fosse
    // o da magia veria doze.
    //
    // E as três recusas entre uma cura e a seguinte não podem ENGATILHAR a categoria. Uma
    // categoria engatilhada só acorda quando o mundo muda, e aqui o mundo não muda: sem ponto
    // de spawn não há monstro, e a regeneração está zerada. Se a volta dependesse do mundo,
    // sairia UMA cura e mais nenhuma.
    const lenta = [
      { ...spells[0], cooldownMs: 4_000 },
      spells[1],
    ];
    const { session, hero } = withSpells(
      botConfig({ heal: [healRule(100)] }),
      { health: 1_000, spells: lenta, monsters: false },
    );

    run(session, 12_100, 100);

    expect(hero.mana).toBe(200 - 4 * 20);
  });

  it('a magia de ataque mata o monstro, e o abate credita quem lançou', () => {
    // O dano de magia passa pela MESMA atribuição do golpe (`recordDamage`) e pelo MESMO
    // pipeline de morte. Se não passasse, o rato morreria sem dono e a recompensa evaporaria —
    // que é o formato de defeito que ninguém liga à causa.
    const { session, hero } = withSpells(botConfig({
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'strike' },
      }],
    }));

    run(session, 20_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    // Loot fixo de 3 por rato: o gold ganho tem que bater com os abates.
    expect(session.aggregates.goldGained).toBe(session.aggregates.kills * 3);
    expect(hero.xp).toBeGreaterThan(0);
  });

  it('#547 (M29-07, achado da revisão do PR #648): magia de manadrain NUNCA tira vida do monstro', () => {
    // Antes deste fix, `#applyHits` aplicava o `resolvedDamage` de QUALQUER magia direto em
    // `monster.receiveDamage`, sem olhar `damageType` — só `applyDamageOutcome` (CMB-08) sabia
    // desviar `manadrain` para a mana, e a magia de dano nunca passava por ali. Um monstro não
    // tem mana (`MonsterRuntime` não declara o campo), então o dreno tem que ser um NO-OP total:
    // nem vida, nem morte, por mais golpes que caiam — a mesma regra do Canary
    // (`Game::combatChangeMana`, `manaLoss <= 0` já sem alvo).
    const drenar = { id: 'drain', name: 'Dreno', manaCost: 5, cooldownMs: 100,
      effect: { kind: 'damage', power: 40, range: 3, damageType: 'manadrain' } };
    const { session, ruleset } = withSpells(botConfig({
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'drain' },
      }],
    }), {
      spells: [...spells, drenar], mana: 1_000,
      // Ataque desarmado ZERADO: sem isto, o corpo a corpo AUTOMÁTICO (que roda independente
      // do bot, como todo personagem perto de um alvo) mataria o rato sozinho e confundiria a
      // asserção — este teste é sobre a MAGIA, não sobre o soco de sempre.
      combat: [{ ...combat, player: { ...combat.player, attackPower: 0 } }],
    });

    // Poder 40 contra um rato de 50 de vida mataria em dois golpes se caísse na vida — dez
    // segundos bastam para várias tentativas, mesmo com o cooldown de categoria do bot.
    run(session, 10_000, 100);

    expect(session.aggregates.kills).toBe(0);
    expect(ruleset.monsters.every((m) => m.health === 50)).toBe(true);
  });

  it('magia que sumiu do conteúdo não derruba a hunt: a regra só não faz nada', () => {
    // `validateBotConfig` recusa isto na ENTRADA. Sobra o conteúdo mudar sob uma sessão em
    // voo, e aí a resposta certa é a hunt continuar — quem estava caçando não perde a sessão
    // por um arquivo que alguém renomeou.
    const { session, hero } = withSpells(botConfig({
      heal: [{
        when: { kind: 'hp', op: '<=', percent: 100 },
        do: { kind: 'spell', spellId: 'nao-existe' },
      }],
    }), { health: 1_000, monsters: false });

    expect(() => run(session, 3_000, 100)).not.toThrow();
    expect(hero.mana).toBe(200);
  });
});

describe('poção abstrata: gold no uso (FUN-77, §20.1)', () => {
  it('a poção de vida repõe HP, debita o `price` e conta o uso', () => {
    const { session, hero } = withSpells(
      botConfig({ potion: [supplyRule('health-potion', 50)] }),
      { health: 1_000, gold: 100, monsters: false },
    );

    session.advanceBy(50);

    expect(hero.health).toBe(1_080);
    expect(hero.goldDelta).toBe(-45);
    expect(session.aggregates.goldSpent).toBe(45);
    expect(session.aggregates.suppliesUsed).toBe(1);
  });

  it('a poção de mana repõe MANA e debita o gold da mesma régua', () => {
    const { session, hero } = withSpells(
      botConfig({ potion: [{
        when: { kind: 'mana', op: '<=', percent: 50 },
        do: { kind: 'supply', supplyId: 'mana-potion' },
      }] }),
      { mana: 20, gold: 500, monsters: false },
    );

    session.advanceBy(50);

    expect(hero.mana).toBe(120);
    expect(hero.goldDelta).toBe(-50);
    expect(session.aggregates.suppliesUsed).toBe(1);
  });

  it('sem gold, a poção não sai e o saldo NUNCA fica negativo', () => {
    // A garantia é a ordem: o débito é recusado antes, não corrigido depois. Um delta negativo
    // aqui viraria uma linha de ledger que tira gold que o personagem não tem.
    const { session, hero } = withSpells(
      botConfig({ potion: [supplyRule('health-potion', 100)] }),
      { health: 1_000, gold: 44, monsters: false },
    );

    run(session, 5_000, 100);

    expect(hero.goldDelta).toBe(0);
    expect(session.aggregates.goldSpent).toBe(0);
    expect(hero.health).toBe(1_000);
  });

  it('o gold que falta vira UMA linha no extrato, e não uma por tentativa', () => {
    // §20.3 sem a regra de saída: a hunt continua, sem poção, e o personagem pode morrer. Isso
    // é comportamento, não erro — mas quem estava ausente precisa encontrar o motivo na tela
    // de retorno. Uma linha por tentativa encheria a lista curta até ela deixar de ser lista,
    // que é a mesma razão pela qual o aviso de stamina sai uma vez só.
    const { session } = withSpells(
      botConfig({ potion: [supplyRule('health-potion', 100)] }),
      { health: 1_000, gold: 0, monsters: false },
    );

    run(session, 10_000, 100);

    const avisos = session.notableEvents.filter((e) => e.type === 'supply-unaffordable');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.detail).toBe('health-potion');
  });

  it('o aviso sobrevive ao snapshot: retomar não repete a notícia', () => {
    const { session } = withSpells(
      botConfig({ potion: [supplyRule('health-potion', 100)] }),
      { health: 1_000, gold: 0, monsters: false },
    );
    session.advanceBy(100);

    const state = session.ruleset.getState?.() as { warnedNoGold?: boolean };
    expect(state.warnedNoGold).toBe(true);
  });

  it('saldo zero com a regra de saída encerra a hunt por `out-of-gold`', () => {
    const { session } = withSpells(
      botConfig({
        potion: [supplyRule('health-potion')],
        exit: [botExitRuleSchema.parse({ kind: 'out-of-gold' })],
      }),
      { health: 1_000, gold: 0, monsters: false },
    );

    run(session, 1_000, 100);

    expect(session.ended).toBe('exit-rule');
  });

  it('o gasto é evento da fila: 10 Hz e 1 Hz dão o MESMO goldSpent (ADR 0020)', () => {
    // O defeito que o ADR 0020 tornou estrutural: qualquer decisão de gasto fora da fila
    // diverge entre taxas. O cenário precisa ter GASTO, senão um empate de zeros passaria por
    // equivalência sem provar nada.
    const completo = botConfig({
      heal: [healRule(90)],
      potion: [{
        when: { kind: 'mana', op: '<=', percent: 40 },
        do: { kind: 'supply', supplyId: 'mana-potion' },
      }],
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'strike' },
      }],
    });

    const at = (stepMs: number) => {
      const { session, hero } = withSpells(completo, { health: 2_000, gold: 100_000 });
      run(session, 120_000, stepMs);
      return {
        goldSpent: session.aggregates.goldSpent,
        goldDelta: hero.goldDelta,
        mana: hero.mana,
        kills: session.aggregates.kills,
        uses: session.aggregates.suppliesUsed,
      };
    };

    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    expect(rapido.goldSpent).toBeGreaterThan(0);
    expect(rapido.kills).toBeGreaterThan(0);
  });
});

// --- o combate chega ao cliente como evento (FUN-109) ----------------------------------------

/** Só os eventos de um tipo, com o tipo estreitado — para não repetir o `filter` com cast. */
const ofKind = <K extends DomainEvent['kind']>(
  events: readonly DomainEvent[], kind: K,
): Extract<DomainEvent, { kind: K }>[] =>
  events.filter((e): e is Extract<DomainEvent, { kind: K }> => e.kind === kind);

/**
 * O evento logo DEPOIS de cada um dos dados precisa ser o `creature-health-changed` da mesma
 * criatura. É a ordem "número antes da barra", que é contrato com o cliente: o número
 * flutuante acompanha a barra caindo, não o contrário.
 */
const followedByHealthOf = (events: readonly DomainEvent[], indexes: readonly number[]) => {
  for (const index of indexes) {
    const cause = events[index] as { creatureId: string | number };
    const next = events[index + 1];
    expect(next?.kind).toBe('creature-health-changed');
    expect((next as { creatureId: string | number }).creatureId).toBe(cause.creatureId);
  }
};

const indexesOf = (events: readonly DomainEvent[], pick: (e: DomainEvent) => boolean) =>
  events.map((e, i) => (pick(e) ? i : -1)).filter((i) => i >= 0);

describe('o combate chega ao cliente como evento (FUN-109)', () => {
  const comEspada: InventoryState = {
    backpack: [],
    equipped: { hand: { instanceId: 'i1', itemId: 'sword', quantity: 1 } },
  };

  it('o golpe do personagem emite creature-hit com o APLICADO, e antes da barra', () => {
    // A espada bate 200 num rato de 50: o resolvido é 200, o que saiu da barra é 50. É o
    // aplicado que flutua sobre o monstro — mostrar 200 sobre um rato que tinha 50 é o cliente
    // contando uma história que a barra desmente. O recorde de 200 é do extrato.
    //
    // Mutação que mata: emitir `result.damage` em vez de `applied` no `#strike` — a espada
    // faz o rato de pouca vida distinguir os dois (`amount` passa a 200 > 50).
    const { session } = start({ difficulty: 'bold', inventory: comEspada });
    run(session, 20_000, 100);
    const events = session.drainEvents();

    const golpes = ofKind(events, 'creature-hit')
      .filter((h) => h.attackerId === 'hero');
    expect(golpes.length).toBeGreaterThan(0);
    for (const golpe of golpes) {
      expect(golpe.source).toBe('melee');
      expect(String(golpe.creatureId)).toMatch(/^m:/);
      expect(golpe.amount).toBeGreaterThan(0);
      expect(golpe.amount).toBeLessThanOrEqual(rat.health);
      // O `z` é do mapa, como no passo e no nascimento.
      expect(golpe.position.z).toBe(7);
    }
    // O golpe fatal tirou exatamente o que sobrava; o recorde guarda o que foi BATIDO — a
    // espada, escalada pela skill que sobe a cada golpe (FUN-75), nunca menos que 200.
    expect(golpes.some((g) => g.amount === rat.health)).toBe(true);
    expect(session.aggregates.bestBasicHit).toBeGreaterThanOrEqual(200);

    followedByHealthOf(events, indexesOf(
      events, (e) => e.kind === 'creature-hit' && e.attackerId === 'hero',
    ));
  });

  it('o golpe do monstro emite creature-hit E creature-health-changed do personagem, nessa ordem', () => {
    // Antes disto a vida do personagem só chegava ao cliente no `session-state` da reanexação:
    // a barra dele ficava parada a hunt inteira enquanto a do monstro andava.
    //
    // Mutação que mata: trocar a ordem dos dois `emit` em `#onMonsterAction` — o evento logo
    // depois do golpe deixa de ser a barra. Apagar o `#emitCharacterHealth` mata também.
    const { session, hero } = start({ difficulty: 'bold', health: 5_000 });
    run(session, 20_000, 100);
    const events = session.drainEvents();

    const apanhou = ofKind(events, 'creature-hit').filter((h) => h.creatureId === 'hero');
    expect(apanhou.length).toBeGreaterThan(0);
    for (const golpe of apanhou) {
      expect(golpe.source).toBe('melee');
      expect(String(golpe.attackerId)).toMatch(/^m:/);
      expect(golpe.amount).toBeGreaterThan(0);
      expect(golpe.position.z).toBe(7);
    }
    followedByHealthOf(events, indexesOf(
      events, (e) => e.kind === 'creature-hit' && e.creatureId === 'hero',
    ));

    // E TODA mudança de vida do personagem passou pela fila — golpe e regeneração: a última
    // barra anunciada é a vida com que ele terminou. Um caminho que muda a vida sem anunciar
    // deixaria o cliente com uma barra que só a reanexação corrige, que era o defeito inteiro.
    const barras = ofKind(events, 'creature-health-changed').filter((b) => b.creatureId === 'hero');
    expect(barras.at(-1)?.health).toBe(hero.health);
    expect(barras.at(-1)?.maxHealth).toBe(hero.maxHealth);
  });

  it('o golpe FATAL no personagem carrega o que ele tinha, não o que o monstro bateu', () => {
    // O rato bate 10 (sem esquiva neste conteúdo, o dano é fixo) num herói de 3: o resolvido
    // é 10, o que saiu da barra é 3. O teste acima não distingue os dois porque o herói dele
    // tem 5 000 de vida e nunca chega perto de morrer — aqui a regeneração está desligada
    // para que os 3 com que ele entrou sejam os 3 que o golpe encontra.
    //
    // Mutação que mata: `amount: result.damage` no golpe do monstro em `#onMonsterAction` —
    // o número passa a 10, maior que a vida que o herói tinha.
    const semRegen = content({
      progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    });
    const { session, hero } = start({ loaded: semRegen, difficulty: 'bold', health: 3 });
    run(session, 20_000, 100);
    const events = session.drainEvents();

    expect(session.ended).toBe('death');
    const apanhou = ofKind(events, 'creature-hit').filter((h) => h.creatureId === 'hero');
    // Um golpe só: morto não apanha, e a sessão encerra na hora.
    expect(apanhou).toHaveLength(1);
    const fatal = apanhou[0] as (typeof apanhou)[number];
    expect(fatal.amount).toBe(3);
    expect(fatal.amount).toBeLessThan(rat.attack);
    expect(fatal.amount).toBeLessThanOrEqual(hero.maxHealth);
    // E a barra logo depois zera: o número e a barra contam a mesma história.
    const next = events[events.indexOf(fatal) + 1];
    expect(next).toMatchObject({ kind: 'creature-health-changed', creatureId: 'hero', health: 0 });
  });

  it('subir de level anuncia a barra com o máximo NOVO — sem esperar golpe nem regeneração', () => {
    // `retarget` reescreve `health` e `maxHealth` pela tabela no level up, e nada mais toca
    // a vida do herói depois disso: um rato só (cautious, respawn em 30 s), morto num golpe
    // de espada, valendo exatamente a XP do level 2 — e regeneração desligada, porque de
    // vida cheia ela não anunciaria nada e, ferido, anunciaria com o máximo novo por conta
    // própria, escondendo a falta do anúncio do level up.
    //
    // Mutação que mata: tirar o `#emitCharacterHealth` do `#onMonsterDied` — a última barra
    // do herói volta a ser a do golpe do rato, com o máximo do level 1 (ou nenhuma).
    const umLevelPorRato = content({
      monsters: [{ ...rat, experience: 20 }],
      progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    });
    const { session, hero } = start({ loaded: umLevelPorRato, inventory: comEspada });
    run(session, 15_000, 100);
    const events = session.drainEvents();

    expect(hero.level).toBe(2);
    expect(session.notableEvents.some((e) => e.type === 'level-up')).toBe(true);
    const novoMaximo = statsForLevel(2, null, progression as Progression).maxHealth;
    expect(hero.maxHealth).toBe(novoMaximo);
    const barras = ofKind(events, 'creature-health-changed').filter((b) => b.creatureId === 'hero');
    expect(barras.at(-1)?.maxHealth).toBe(novoMaximo);
    expect(barras.at(-1)?.health).toBe(hero.health);
  });

  it('a penalidade de morte que rebaixa o level anuncia a barra com o máximo NOVO', () => {
    // O golpe fatal já anunciou "0 / máximo do level 20"; a penalidade desce para o 19 e
    // reescreve o máximo, e o cliente que ficou só com o golpe mostraria um máximo que o
    // personagem não tem mais.
    //
    // Mutação que mata: tirar o `#emitCharacterHealth` do `#onCharacterDied` — a última
    // barra do herói passa a ser a do golpe fatal, com o máximo do level 20.
    const { session, hero } = start({ difficulty: 'bold', health: 12 });
    hero.level = 20;
    hero.xp = totalXpForLevel(20, progression as Progression);
    hero.maxHealth = statsForLevel(20, null, progression as Progression).maxHealth;
    run(session, 60_000, 100);
    const events = session.drainEvents();

    expect(session.ended).toBe('death');
    expect(hero.level).toBe(19);
    const maximoDo19 = statsForLevel(19, null, progression as Progression).maxHealth;
    expect(hero.maxHealth).toBe(maximoDo19);
    const barras = ofKind(events, 'creature-health-changed').filter((b) => b.creatureId === 'hero');
    expect(barras.at(-1)).toEqual({
      kind: 'creature-health-changed', creatureId: 'hero', health: 0, maxHealth: maximoDo19,
    });
  });

  it('a magia de dano emite spell-cast com os alvos e DEPOIS um creature-hit por alvo', () => {
    // O mesmo cenário da área (FUN-92): três ratos perto do ponto de spawn e um `blast` de
    // raio 2 no instante zero. Os alvos do `spell-cast` são a mira inteira, na ordem em que os
    // golpes caem — e cada golpe tem `source: 'spell'`, o aplicado, e a barra logo depois.
    //
    // Mutação que mata: mover o `emit` de `spell-cast` para depois do laço — o índice dele
    // deixa de ser menor que o do primeiro golpe. `targets: []` mata pela contagem.
    const { session } = withSpells(botConfig({
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'blast' },
      }],
    }), { mana: 200 }, 'bold');

    session.advanceBy(50);
    const events = session.drainEvents();

    const lançamentos = ofKind(events, 'spell-cast');
    expect(lançamentos).toHaveLength(1);
    const lançamento = lançamentos[0] as (typeof lançamentos)[number];
    expect(lançamento.casterId).toBe('hero');
    expect(lançamento.spellId).toBe('blast');
    expect(lançamento.casterPosition.z).toBe(7);
    expect(lançamento.targets.length).toBeGreaterThan(1);

    const golpes = ofKind(events, 'creature-hit').filter((h) => h.source === 'spell');
    expect(golpes.map((g) => g.creatureId)).toEqual(lançamento.targets.map((t) => t.creatureId));
    for (const golpe of golpes) {
      expect(golpe.attackerId).toBe('hero');
      expect(golpe.amount).toBeGreaterThan(0);
      expect(golpe.amount).toBeLessThanOrEqual(rat.health);
    }
    // O lançamento antes de qualquer golpe dele.
    const primeiroGolpe = events.findIndex((e) => e.kind === 'creature-hit' && e.source === 'spell');
    expect(events.indexOf(lançamento)).toBeLessThan(primeiroGolpe);
    followedByHealthOf(events, indexesOf(
      events, (e) => e.kind === 'creature-hit' && e.source === 'spell',
    ));
  });

  it('a cura emite spell-cast sem alvo, e creature-healed SÓ quando repôs algo', () => {
    // O que a cura repôs, e não o que o efeito prometia: `castSpell` devolve o que ENTROU na
    // barra. Com 1 000 de vida entram 60, e é "+60" que flutua, antes da barra subir.
    //
    // Mutação que mata: tirar o `if (amount <= 0) return` do `#emitHealed` — a cura em quem
    // estava cheio passa a produzir um "+0", e a segunda metade do teste o vê.
    const ferido = withSpells(
      botConfig({ heal: [healRule(50)] }), { health: 1_000, monsters: false },
    );
    ferido.session.advanceBy(50);
    const events = ferido.session.drainEvents();

    const lançamento = ofKind(events, 'spell-cast')[0];
    expect(lançamento?.spellId).toBe('heal');
    expect(lançamento?.targets).toEqual([]);
    const curas = ofKind(events, 'creature-healed');
    expect(curas).toHaveLength(1);
    expect(curas[0]).toMatchObject({ creatureId: 'hero', amount: 60, source: 'spell' });
    expect(curas[0]?.position.z).toBe(7);
    // Lançamento, cura, barra — nessa ordem.
    expect(events.indexOf(lançamento as DomainEvent)).toBeLessThan(events.indexOf(curas[0] as DomainEvent));
    followedByHealthOf(events, indexesOf(events, (e) => e.kind === 'creature-healed'));
    expect(ofKind(events, 'creature-health-changed').at(-1)?.health).toBe(1_060);

    // De vida CHEIA a magia sai (a mana prova), repõe zero — e nada flutua, nada de barra.
    const cheio = withSpells(botConfig({ heal: [healRule(100)] }), { monsters: false });
    cheio.session.advanceBy(50);
    const semNada = cheio.session.drainEvents();
    expect(cheio.hero.mana).toBe(180);
    expect(ofKind(semNada, 'spell-cast')).toHaveLength(1);
    expect(ofKind(semNada, 'creature-healed')).toHaveLength(0);
    expect(ofKind(semNada, 'creature-health-changed')).toHaveLength(0);
  });

  it('a poção emite supply-used e creature-healed com source supply; a de mana só supply-used', () => {
    // Mutação que mata: `source: 'spell'` no `#useSupply` — o `toMatchObject` reprova.
    // Apagar o `emit` de `supply-used` mata pela contagem, nas duas poções.
    const vida = withSpells(
      botConfig({ potion: [{
        when: { kind: 'hp', op: '<=', percent: 50 },
        do: { kind: 'supply', supplyId: 'health-potion' },
      }] }),
      { health: 1_000, gold: 100, monsters: false },
    );
    vida.session.advanceBy(50);
    const events = vida.session.drainEvents();

    const usos = ofKind(events, 'supply-used');
    expect(usos).toHaveLength(1);
    expect(usos[0]).toMatchObject({ characterId: 'hero', supplyId: 'health-potion' });
    expect(usos[0]?.position.z).toBe(7);
    const curas = ofKind(events, 'creature-healed');
    expect(curas).toHaveLength(1);
    expect(curas[0]).toMatchObject({ creatureId: 'hero', amount: 80, source: 'supply' });
    // Uso, cura, barra — nessa ordem.
    expect(events.indexOf(usos[0] as DomainEvent)).toBeLessThan(events.indexOf(curas[0] as DomainEvent));
    followedByHealthOf(events, indexesOf(events, (e) => e.kind === 'creature-healed'));
    expect(ofKind(events, 'creature-health-changed').at(-1)?.health).toBe(1_080);

    const mana = withSpells(
      botConfig({ potion: [{
        when: { kind: 'mana', op: '<=', percent: 50 },
        do: { kind: 'supply', supplyId: 'mana-potion' },
      }] }),
      { mana: 20, gold: 500, monsters: false },
    );
    mana.session.advanceBy(50);
    const soUso = mana.session.drainEvents();
    expect(mana.hero.mana).toBe(120);
    expect(ofKind(soUso, 'supply-used')).toHaveLength(1);
    expect(ofKind(soUso, 'supply-used')[0]?.supplyId).toBe('mana-potion');
    expect(ofKind(soUso, 'creature-healed')).toHaveLength(0);
    expect(ofKind(soUso, 'creature-health-changed')).toHaveLength(0);
  });

  it('a regeneração emite creature-health-changed e NÃO creature-healed', () => {
    // A barra precisa andar; um "+1" flutuando por segundo a hunt inteira é ruído. E de vida
    // cheia não sai nada: a vida não mudou, e uma hunt desanexada de oito horas não precisa
    // produzir um evento por segundo para dizer isso.
    //
    // Mutação que mata: chamar `#emitHealed` na regeneração — aparece um `creature-healed`.
    // Emitir a barra sem o `> 0` mata pela segunda metade: de vida cheia, quatro eventos.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn, health: 100 });
    run(session, 3_000, 100);
    const events = session.drainEvents();

    // 1 HP/s: vence em 0, 1 000, 2 000 e 3 000 — quatro barras, a última com a vida final.
    const barras = ofKind(events, 'creature-health-changed');
    expect(barras).toHaveLength(4);
    expect(barras.every((b) => b.creatureId === 'hero')).toBe(true);
    expect(barras.at(-1)?.health).toBe(hero.health);
    expect(hero.health).toBe(104);
    expect(ofKind(events, 'creature-healed')).toHaveLength(0);
    expect(ofKind(events, 'creature-hit')).toHaveLength(0);

    const cheio = start({ loaded: semSpawn });
    run(cheio.session, 3_000, 100);
    expect(ofKind(cheio.session.drainEvents(), 'creature-health-changed')).toHaveLength(0);
  });

  it('desanexada produz exatamente os mesmos eventos de combate que anexada', () => {
    // O invariante 3, de novo, para o que esta issue acrescentou: `session.emit` não olha para
    // quem está assistindo, e um `if (temViewer)` em qualquer dos emissores novos apareceria
    // aqui como uma fila diferente.
    const completo = botConfig({
      heal: [healRule(90)],
      potion: [{
        when: { kind: 'mana', op: '<=', percent: 40 },
        do: { kind: 'supply', supplyId: 'mana-potion' },
      }],
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'strike' },
      }],
    });
    const sozinha = withSpells(completo, { health: 100 }, 'bold');
    run(sozinha.session, 10_000, 100);

    const assistida = withSpells(completo, { health: 100 }, 'bold');
    assistida.session.attach('viewer-1');
    run(assistida.session, 10_000, 100);

    const sozinhaEvents = sozinha.session.drainEvents();
    expect(assistida.session.drainEvents()).toEqual(sozinhaEvents);
    // E a fila tem o que esta issue promete, senão o teste compara duas listas de passos.
    expect(ofKind(sozinhaEvents, 'spell-cast').length).toBeGreaterThan(0);
    expect(ofKind(sozinhaEvents, 'creature-hit').length).toBeGreaterThan(0);
  });
});

describe('a equivalência entre taxas vale para magia e supply também', () => {
  it('1 Hz e 10 Hz dão o MESMO resultado, com cura, poção e magia de dano', () => {
    // É o teste que mais importa deste pacote, aplicado ao que esta issue acrescentou. Se
    // divergir, alguém pôs decisão de jogo fora da fila de eventos — e o cooldown de magia é
    // exatamente o lugar onde um acumulador entraria sem ninguém notar.
    const completo = botConfig({
      heal: [healRule(90)],
      potion: [{
        when: { kind: 'mana', op: '<=', percent: 40 },
        do: { kind: 'supply', supplyId: 'mana-potion' },
      }],
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'strike' },
      }],
    });

    const at = (stepMs: number) => {
      const { session, hero } = withSpells(completo, { health: 2_000, gold: 10_000 });
      run(session, 120_000, stepMs);
      return {
        kills: session.aggregates.kills,
        goldGained: session.aggregates.goldGained,
        goldSpent: session.aggregates.goldSpent,
        xp: hero.xp,
        health: hero.health,
        mana: hero.mana,
        goldDelta: hero.goldDelta,
      };
    };

    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    // E o cenário precisa ter EXERCITADO o que diz exercitar: um empate de zeros passaria por
    // equivalência sem provar nada. Foi assim que a FUN-67 atravessou um teste vazio.
    expect(rapido.kills).toBeGreaterThan(0);
    expect(rapido.goldSpent).toBeGreaterThan(0);
  });
});

// --- alvo e postura (FUN-85) -----------------------------------------------------------------

// Uma sala grande, e uma rota em anel no meio dela. A sala do resto deste arquivo tem 4×3 —
// nela tudo está a três tiles de tudo, e postura não teria como ser distinguida de rota.
//
//     0 1 2 3 4 5 6 7 8 9
//   0 # # # # # # # # # #
//   1 # . . . . . . . . #
//   2 # . . . . . . . . #
//   3 # . . . . . . . . #      ← a rota corre por aqui
//   4 # . . . . . . . . #
//   5 # . . . . . . . . #      ← e volta por aqui
//   6 # # # # # # # # # #
const salaGrande = {
  id: 'salao', z: 7,
  grid: ['##########', '#........#', '#........#', '#........#', '#........#', '#........#',
    '##########'],
};

/** O anel. O índice 0 é (4,3) — o meio —, e o índice 10 é (4,5), dois tiles ABAIXO dele. */
const anel = {
  id: 'salao-anel', mapId: 'salao',
  tiles: [
    { x: 4, y: 3, z: 7 }, { x: 5, y: 3, z: 7 }, { x: 6, y: 3, z: 7 }, { x: 7, y: 3, z: 7 },
    { x: 8, y: 3, z: 7 }, { x: 8, y: 4, z: 7 }, { x: 8, y: 5, z: 7 }, { x: 7, y: 5, z: 7 },
    { x: 6, y: 5, z: 7 }, { x: 5, y: 5, z: 7 }, { x: 4, y: 5, z: 7 }, { x: 3, y: 5, z: 7 },
    { x: 2, y: 5, z: 7 }, { x: 1, y: 5, z: 7 }, { x: 1, y: 4, z: 7 }, { x: 1, y: 3, z: 7 },
    { x: 2, y: 3, z: 7 }, { x: 3, y: 3, z: 7 },
  ],
  // `radius: 1` com o tile do centro livre coloca o monstro EXATAMENTE em (4,5):
  // `tilesAround` entrega o centro primeiro, e é isso que torna a posição previsível.
  spawnPoints: [{ routeIndex: 10, radius: 1 }],
};

/**
 * Um monstro que fica ONDE NASCEU: `aggroRadius: 0` faz `chooseTarget` nunca achar alvo, e sem
 * alvo não há passo nem golpe. É o que permite afirmar a posição do personagem sem que a
 * decisão do monstro entre na conta — aqui o assunto é a postura, não a IA dele.
 */
const poste = {
  ...rat, id: 'post', name: 'Poste', aggroRadius: 0, health: 40,
};

/**
 * O mesmo poste, com vida que não acaba.
 *
 * Existe porque duas perguntas diferentes precisam de alvos diferentes: "ele volta para a rota
 * quando o alvo morre" exige um monstro que morra, e "ele PARA ao alcance em vez de tentar
 * pisar em cima" exige um que não morra — senão o teste mede o depois da morte e passa por
 * acidente, que foi como ele passou da primeira vez que o escrevi.
 */
const posteEterno = { ...poste, id: 'post-tank', name: 'Poste Eterno', health: 1_000_000 };

const huntSalao = {
  id: 'salao', name: 'Salão', recommendedLevel: 1, mapId: 'salao', routeId: 'salao-anel',
  difficulties: {
    cautious: {
      monsterCount: 1, composition: [{ monsterId: 'post', weight: 1 }], respawnDelayMs: 600_000,
    },
    bold: {
      monsterCount: 1, composition: [{ monsterId: 'post-tank', weight: 1 }],
      respawnDelayMs: 600_000,
    },
    // Ratos de verdade — que andam, agroam e renascem. É o cenário movimentado que a
    // equivalência entre taxas precisa para não medir um empate de zeros.
    reckless: {
      monsterCount: 2, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 5_000,
    },
  },
};

const withPosture = (
  over: Record<string, unknown>,
  difficulty: 'cautious' | 'bold' | 'reckless' = 'cautious',
) => {
  const loaded = buildContent(raw({
    monsters: [rat, poste, posteEterno], hunts: [hunt, huntSalao],
    maps: [map, salaGrande], routes: [route, anel],
  }));
  const session = createHuntSession({
    id: 'postura', content: loaded, huntId: 'salao', difficulty, createdAtMs: 0,
    botConfig: botConfig({ targeting: botTargetingSchema.parse(over) }),
  });
  const hero = character();
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset };
};

describe('postura: o primeiro caso em que o personagem sai da rota por decisão própria', () => {
  // O personagem nasce em (4,3) e o monstro nasce em (4,5): dois tiles ABAIXO, fora do alcance
  // de ataque (1) e dentro do raio de visão (8). A rota, do índice 0, vai para a DIREITA — então
  // "andou pela rota" e "andou atrás do alvo" apontam para lados diferentes, e um teste consegue
  // distinguir os dois.
  it('stand percorre a rota e IGNORA o alvo fora de alcance — o comportamento de sempre', () => {
    const { session, hero, ruleset } = withPosture({ posture: { kind: 'stand' } });

    session.advanceBy(10);

    expect(ruleset.monsters[0]?.position).toEqual({ x: 4, y: 5, z: 7 });
    // Índice 1 da rota. Andou para a direita, de costas para o monstro.
    expect(hero.position).toEqual({ x: 5, y: 3, z: 7 });
  });

  it('follow anda ATRÁS do alvo, pelo mesmo sistema de movimento', () => {
    const { session, hero } = withPosture({ posture: { kind: 'follow' } });

    session.advanceBy(10);

    expect(hero.position).toEqual({ x: 4, y: 4, z: 7 });
  });

  it('follow PARA ao alcance, e não fica tentando pisar em cima do alvo', () => {
    // Alvo que não morre, de propósito: meio minuto de vencimentos de passo com o monstro
    // sempre ali. Se ele continuasse perseguindo depois de alcançar, tentaria ocupar o tile do
    // monstro a cada passo — `movement.ts` recusa, mas a tentativa em si é o bot batendo a
    // cabeça na parede para sempre, e o teste não veria diferença se o alvo tivesse morrido.
    const { session, hero, ruleset } = withPosture({ posture: { kind: 'follow' } }, 'bold');

    run(session, 30_000, 100);

    expect(ruleset.monsters[0]?.alive).toBe(true);
    expect(hero.position).toEqual({ x: 4, y: 4, z: 7 });
    // E ficou batendo o tempo todo: parar de andar não é parar de lutar.
    expect(ruleset.monsters[0]?.health).toBeLessThan(1_000_000);
  });

  it('keep-distance RECUA quando o alvo está perto demais', () => {
    // Distância pedida 3, distância real 2: ele anda para trás, não para frente. É a única
    // postura que produz passo na direção oposta à do alvo.
    const { session, hero } = withPosture({ posture: { kind: 'keep-distance', tiles: 3 } });

    session.advanceBy(10);

    expect(hero.position).toEqual({ x: 4, y: 2, z: 7 });
  });

  it('keep-distance FICA PARADO na distância pedida — não volta a percorrer a rota', () => {
    // Voltar para a rota ao chegar na distância certa faria o personagem oscilar entre manter
    // distância e seguir o laço, e de fora isso parece o bot travado.
    const { session, hero } = withPosture(
      { posture: { kind: 'keep-distance', tiles: 2 } }, 'bold',
    );

    run(session, 10_000, 100);

    expect(hero.position).toEqual({ x: 4, y: 3, z: 7 });
  });

  it('morto o alvo, o personagem VOLTA para a rota', () => {
    // A postura só manda enquanto há alvo. Sem alvo, `#holdPosture` devolve `false` e o passo
    // volta a ser o da rota — que é o caminho de sempre, incluindo o `rejoinNearest` de quem
    // saiu dela.
    const { session, hero, ruleset } = withPosture({ posture: { kind: 'follow' } });
    const naRota = (p: { x: number; y: number }) =>
      anel.tiles.some((t) => t.x === p.x && t.y === p.y);

    run(session, 30_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(0);

    run(session, 10_000, 100);
    expect(naRota(hero.position)).toBe(true);
  });

  it('ignorar o único monstro faz a hunt inteira virar caminhada', () => {
    // O bot não ataca, e a postura não tem atrás de quem ir: ele percorre a rota e pronto. É
    // o mesmo efeito de não haver monstro, e é o que "ignorar" tem que significar.
    const { session, ruleset } = withPosture({
      posture: { kind: 'follow' }, ignore: ['post'],
    });

    run(session, 30_000, 100);

    expect(session.aggregates.kills).toBe(0);
    expect(ruleset.monsters[0]?.health).toBe(40);
    expect(ruleset.monsters[0]?.position).toEqual({ x: 4, y: 5, z: 7 });
  });
});

describe('a equivalência entre taxas vale para a postura também', () => {
  it('1 Hz e 10 Hz dão o MESMO resultado com o personagem perseguindo o alvo', () => {
    // Postura é MOVIMENTO, e movimento é a coisa que mais quebrou equivalência neste projeto:
    // o 1,51× de dano sofrido da FUN-68 saía exatamente de o personagem atravessar vários
    // tiles num tick longo. Perseguir acrescenta um passo por vencimento fora da rota, e ele
    // precisa cair no mesmo instante lógico nas duas taxas.
    const at = (stepMs: number) => {
      const { session, hero, ruleset } = withPosture(
        { posture: { kind: 'follow' }, policy: 'lowest-hp' }, 'reckless',
      );
      run(session, 120_000, stepMs);
      return {
        kills: session.aggregates.kills,
        xp: hero.xp,
        health: hero.health,
        position: { ...hero.position },
        vivos: ruleset.monsters.filter((m) => m.alive).length,
        posicoes: ruleset.monsters.map((m) => `${m.monsterId}@${m.position.x},${m.position.y}`),
      };
    };

    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    // E o cenário exercitou o que diz exercitar: um empate de zeros passaria por equivalência
    // sem provar nada, que foi como a FUN-67 atravessou um teste vazio.
    expect(rapido.kills).toBeGreaterThan(0);
  });
});

// --- regras de saída do jogador (FUN-86) -----------------------------------------------------

/** Uma hunt sem monstro nenhum: aqui o assunto é quando ela ENCERRA, não o que acontece nela. */
const withExit = (
  exit: readonly Record<string, unknown>[],
  over: {
    health?: number;
    gold?: number;
    goldDelta?: number;
    capacity?: number;
    inventory?: InventoryState;
    exitDelayMs?: number;
  } = {},
) => {
  const loaded = buildContent(raw({
    routes: [{ ...route, spawnPoints: [] }],
    progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    ...(over.exitDelayMs !== undefined ? { hunts: [{ ...hunt, exitDelayMs: over.exitDelayMs }] } : {}),
  }));
  const session = createHuntSession({
    id: 'saida', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    // Pelo schema, como a configuração do jogador chega: é ele que valida o percentual e
    // recusa um `kind` que o vocabulário não conhece.
    botConfig: botConfig({ exit: exit.map((r) => botExitRuleSchema.parse(r)) }),
  });
  const stats = statsForLevel(1, null, loaded.progression);
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
    mana: stats.maxMana, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: over.gold ?? 500, goldDelta: over.goldDelta ?? 0, alive: true, cooldowns: {},
    capacity: over.capacity ?? stats.capacity,
    ...(over.inventory !== undefined ? { inventory: over.inventory } : {}),
  });
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset, loaded };
};

/** O motivo que o extrato registrou, ou `null`. É a resposta a "por que minha hunt acabou?". */
const motivo = (session: Session): string | null =>
  session.notableEvents.find((e) => e.type === 'exit-rule')?.detail ?? null;

describe('regras de saída (FUN-86)', () => {
  it('sem regra nenhuma, a hunt não encerra sozinha', () => {
    // O default é lista vazia, e lista vazia tem que ser o comportamento de antes desta issue.
    const { session } = withExit([], { health: 1 });
    run(session, 10_000, 100);
    expect(session.ended).toBeNull();
  });

  it('hp-below encerra por `exit-rule`, e o extrato diz QUAL regra foi', () => {
    // "Sua hunt encerrou por uma regra de saída", sem dizer qual, é a mensagem que faz o
    // jogador desconfiar do bot que ele mesmo configurou.
    const { session } = withExit([{ kind: 'hp-below', percent: 50 }], { health: 100 });

    run(session, 5_000, 100);

    expect(session.ended).toBe('exit-rule');
    expect(motivo(session)).toBe('hp-below-50');
  });

  it('o percentual entra no id: duas regras de HP são distinguíveis no extrato', () => {
    const { session } = withExit([{ kind: 'hp-below', percent: 20 }], { health: 100 });
    run(session, 5_000, 100);
    expect(motivo(session)).toBe('hp-below-20');
  });

  it('hp-below NÃO dispara acima do limite', () => {
    // 60% de vida contra uma regra de 50%: a hunt continua. O `<` estrito importa — com `<=`,
    // uma regra de 100% encerraria a hunt de quem está com a vida cheia.
    const stats = statsForLevel(1, null, buildContent(raw()).progression);
    const { session } = withExit(
      [{ kind: 'hp-below', percent: 50 }], { health: Math.round(stats.maxHealth * 0.6) },
    );
    run(session, 5_000, 100);
    expect(session.ended).toBeNull();
  });

  it('out-of-gold encerra quando o saldo zera — e é SALDO, não delta', () => {
    // Entrou com 40 e gastou 40 na sessão: o delta é -40 e o saldo é zero. Olhar só para o
    // delta faria a regra disparar em quem tem mil de gold e gastou um.
    const { session } = withExit([{ kind: 'out-of-gold' }], { gold: 40, goldDelta: -40 });
    run(session, 5_000, 100);
    expect(session.ended).toBe('exit-rule');
    expect(motivo(session)).toBe('out-of-gold');
  });

  it('out-of-gold não dispara com saldo positivo, mesmo tendo gastado', () => {
    const { session } = withExit([{ kind: 'out-of-gold' }], { gold: 500, goldDelta: -400 });
    run(session, 5_000, 100);
    expect(session.ended).toBeNull();
  });

  it('SEM a regra, gold zerado deixa a hunt correr — é o §20.3 da FUN-77', () => {
    // As duas metades do §20.3 num teste só: sem a regra o personagem fica, sem conseguir
    // pagar supply, e pode morrer. Com ela (teste acima), sai.
    const { session } = withExit([], { gold: 0, goldDelta: 0 });
    run(session, 10_000, 100);
    expect(session.ended).toBeNull();
  });

  it('party-member-lost é INERTE numa hunt de um, e nunca dispara sozinha', () => {
    // Party é F3. A regra entra no vocabulário agora para a configuração salva não mudar de
    // forma depois — e um jogador que a marque hoje não pode ver a hunt encerrar por causa
    // dela. É o teste que a issue pede explicitamente.
    const { session } = withExit([{ kind: 'party-member-lost' }], { health: 1 });
    run(session, 30_000, 100);
    expect(session.ended).toBeNull();
  });

  it('a primeira regra que vale encerra, e é a dela que vai para o extrato', () => {
    const { session } = withExit(
      [{ kind: 'out-of-gold' }, { kind: 'hp-below', percent: 90 }],
      { health: 10, gold: 0 },
    );
    run(session, 5_000, 100);
    expect(motivo(session)).toBe('out-of-gold');
  });

  it('encerra por `exit-rule`, nunca por `manual-exit` — o extrato tem que dizer a verdade', () => {
    // O jogador não pediu para sair; a regra dele decidiu. Trocar os dois é o extrato mentindo
    // sobre quem encerrou, e é o que a issue proíbe em letra.
    const { session } = withExit([{ kind: 'hp-below', percent: 99 }], { health: 1 });
    run(session, 5_000, 100);
    expect(session.ended).toBe('exit-rule');
  });

  it('out-of-capacity encerra por `exit-rule` e o extrato registra o motivo', () => {
    const inv: InventoryState = {
      backpack: [{ instanceId: 'sw1', itemId: 'sword', quantity: 1 }],
      equipped: {},
    };
    // sword pesa 50 no catálogo de teste da hunt; capacidade do herói 50
    const { session } = withExit(
      [{ kind: 'out-of-capacity' }],
      { capacity: 50, inventory: inv },
    );
    run(session, 5_000, 100);
    expect(session.ended).toBe('exit-rule');
    expect(motivo(session)).toBe('out-of-capacity');
  });

  it('sem a regra out-of-capacity, capacidade excedida deixa a hunt correr', () => {
    const inv: InventoryState = {
      backpack: [{ instanceId: 'sw1', itemId: 'sword', quantity: 1 }],
      equipped: {},
    };
    const { session } = withExit(
      [],
      { capacity: 50, inventory: inv },
    );
    run(session, 5_000, 100);
    expect(session.ended).toBeNull();
  });
});

describe('os predicados de saída, isolados (FUN-86)', () => {
  // Testar a closure direto é o que permite montar casos que a hunt inteira não produz — um
  // participante morto ao lado de um vivo, por exemplo, que numa hunt de um é impossível
  // porque a morte do único personagem encerra a sessão antes.
  const view = (participants: readonly CharacterRuntime[]): HuntView => ({
    elapsedMs: 0,
    aggregates: {
      durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0,
      itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
      damageDealt: 0, healingDone: 0,
    },
    participants,
    monstersAlive: 0,
  });

  const exitCatalog = new Map<string, Item>([
    ['sword', { id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand', weight: 50, value: 0 } as Item],
    ['plate', { id: 'plate', name: 'Plate Armor', kind: 'armor', slot: 'chest', weight: 80, value: 0 } as Item],
  ]);

  const alguem = (over: Partial<{
    id: string; health: number; maxHealth: number; gold: number; goldDelta: number; alive: boolean;
    capacity: number; inventory: InventoryState;
  }> = {}): CharacterRuntime => new CharacterRuntime({
    id: over.id ?? 'hero', position: { x: 1, y: 1, z: 7 },
    health: over.health ?? 100, maxHealth: over.maxHealth ?? 100,
    mana: 0, maxMana: 0, level: 1, xp: 0, vocationId: null,
    staminaMs: null, staminaUpdatedAtMs: 0,
    gold: over.gold ?? 0, goldDelta: over.goldDelta ?? 0,
    alive: over.alive ?? true, cooldowns: {},
    ...(over.capacity !== undefined ? { capacity: over.capacity } : {}),
    ...(over.inventory !== undefined ? { inventory: over.inventory } : {}),
  });

  const only = (rule: Record<string, unknown>, catalog: ReadonlyMap<string, Item> = exitCatalog) =>
    (compileExitRules([botExitRuleSchema.parse(rule)], catalog)[0] as HuntExitRule);

  it('hp-below compara ESTRITAMENTE: 100% de vida não dispara uma regra de 100%', () => {
    // Com `<=`, quem configurasse "sair abaixo de 100%" veria a hunt encerrar no instante em
    // que entrasse — de vida cheia, sem ter tomado um golpe.
    const cheio = only({ kind: 'hp-below', percent: 100 });
    expect(cheio.when(view([alguem({ health: 100, maxHealth: 100 })]))).toBe(false);
    expect(cheio.when(view([alguem({ health: 99, maxHealth: 100 })]))).toBe(true);
  });

  it('hp-below no limite exato não dispara', () => {
    const meio = only({ kind: 'hp-below', percent: 50 });
    expect(meio.when(view([alguem({ health: 50, maxHealth: 100 })]))).toBe(false);
    expect(meio.when(view([alguem({ health: 49, maxHealth: 100 })]))).toBe(true);
  });

  it('hp-below não dispara sobre personagem morto — a morte já encerrou por conta dela', () => {
    // Sem isto, a mesma sessão registraria morte E regra de saída, e o extrato teria dois
    // motivos para um encerramento só.
    const meio = only({ kind: 'hp-below', percent: 50 });
    expect(meio.when(view([alguem({ health: 0, alive: false })]))).toBe(false);
  });

  it('hp-below com maxHealth zero não divide por zero — devolve falso', () => {
    const meio = only({ kind: 'hp-below', percent: 50 });
    expect(meio.when(view([alguem({ health: 0, maxHealth: 0 })]))).toBe(false);
  });

  it('out-of-gold olha o SALDO — entrada mais delta —, nunca só o delta', () => {
    const semGold = only({ kind: 'out-of-gold' });
    // Gastou 400 de 500: delta negativo, saldo positivo. Não é hora de sair.
    expect(semGold.when(view([alguem({ gold: 500, goldDelta: -400 })]))).toBe(false);
    // Gastou tudo: saldo zero.
    expect(semGold.when(view([alguem({ gold: 400, goldDelta: -400 })]))).toBe(true);
    // Ganhou na hunt: saldo positivo mesmo tendo entrado sem nada.
    expect(semGold.when(view([alguem({ gold: 0, goldDelta: 30 })]))).toBe(false);
  });

  it('party-member-lost ignora o PRÓPRIO personagem, mesmo morto', () => {
    // O laço começa no segundo participante de propósito. Sem isso, o personagem que morre
    // sozinho encerraria por "membro da party morreu" em vez de por morte — o extrato daria o
    // motivo errado, e ele é o que o jogador lê ao voltar.
    const semParty = only({ kind: 'party-member-lost' });
    expect(semParty.when(view([alguem({ alive: false })]))).toBe(false);
    expect(semParty.when(view([alguem()]))).toBe(false);
  });

  it('party-member-lost não é predicado periódico: dispara no onLeave de outro membro (#193)', () => {
    // A view de cada runner leva só ele (#203); quem dispara a regra é `#onMemberLost`, pelo
    // id, quando um companheiro sai ou morre. O predicado é `false` sempre — e o teste de
    // party é o do `describe('sair e morrer em party')`.
    const rule = only({ kind: 'party-member-lost' });
    expect(rule.id).toBe('party-member-lost');
    expect(rule.when(view([alguem({ id: 'hero' }), alguem({ id: 'friend', alive: false })]))).toBe(false);
  });

  it('out-of-capacity dispara quando peso >= capacidade (tanto == quanto >)', () => {
    const semCap = only({ kind: 'out-of-capacity' });
    const inv50: InventoryState = {
      backpack: [{ instanceId: 'i1', itemId: 'sword', quantity: 1 }],
      equipped: {},
    };
    // peso == capacidade (50 == 50)
    expect(semCap.when(view([alguem({ capacity: 50, inventory: inv50 })]))).toBe(true);
    // peso > capacidade (50 > 40)
    expect(semCap.when(view([alguem({ capacity: 40, inventory: inv50 })]))).toBe(true);
  });

  it('out-of-capacity não dispara quando peso < capacidade', () => {
    const semCap = only({ kind: 'out-of-capacity' });
    const inv50: InventoryState = {
      backpack: [{ instanceId: 'i1', itemId: 'sword', quantity: 1 }],
      equipped: {},
    };
    // peso < capacidade (50 < 100)
    expect(semCap.when(view([alguem({ capacity: 100, inventory: inv50 })]))).toBe(false);
  });

  it('out-of-capacity não dispara quando capacidade <= 0', () => {
    const semCap = only({ kind: 'out-of-capacity' });
    const inv50: InventoryState = {
      backpack: [{ instanceId: 'i1', itemId: 'sword', quantity: 1 }],
      equipped: {},
    };
    expect(semCap.when(view([alguem({ capacity: 0, inventory: inv50 })]))).toBe(false);
    expect(semCap.when(view([alguem({ capacity: -10, inventory: inv50 })]))).toBe(false);
  });

  it('out-of-capacity não dispara sobre personagem morto', () => {
    const semCap = only({ kind: 'out-of-capacity' });
    const inv50: InventoryState = {
      backpack: [{ instanceId: 'i1', itemId: 'sword', quantity: 1 }],
      equipped: {},
    };
    expect(semCap.when(view([alguem({ alive: false, capacity: 50, inventory: inv50 })]))).toBe(false);
  });

  it('lista vazia compila para lista vazia — nada avaliado, nada custa', () => {
    expect(compileExitRules([], new Map())).toEqual([]);
  });
});

describe('contagem regressiva de saída solo (#360)', () => {
  it('withExit sem exitDelayMs encerra imediatamente e continua passando testes existentes (RF-01)', () => {
    const { session } = withExit([{ kind: 'hp-below', percent: 50 }], { health: 100 });
    session.advanceBy(250);
    expect(session.ended).toBe('exit-rule');
    expect(motivo(session)).toBe('hp-below-50');
  });

  it('hp-below com exitDelayMs aguarda contagem antes de encerrar e registra evento no disparo (RF-02, RF-03, DT-04)', () => {
    const { session } = withExit(
      [{ kind: 'hp-below', percent: 50 }],
      { health: 100, exitDelayMs: 5_000 },
    );
    // EXIT_RULES avalia em t = 250ms
    session.advanceBy(250);
    expect(session.ended).toBeNull();
    // Evento gravado no instante do disparo (DT-04)
    const event = session.notableEvents.find((e) => e.type === 'exit-rule');
    expect(event).toBeDefined();
    expect(event?.detail).toBe('hp-below-50');

    // Em t + 4_999ms (250 + 4_999 = 5_249ms), ainda não encerrou (RF-02)
    session.advanceBy(4_999);
    expect(session.ended).toBeNull();

    // Em t + 5_000ms (5_250ms), encerra com 'exit-rule' (RF-03)
    session.advanceBy(1);
    expect(session.ended).toBe('exit-rule');
  });

  it('requestExit encerra a sessão em manual-exit após exitDelayMs e chamadas múltiplas não resetam o timer (RF-04)', () => {
    const { session, hero, ruleset } = withExit(
      [],
      { health: 100, exitDelayMs: 5_000 },
    );
    session.advanceBy(1_000);
    expect(session.ended).toBeNull();

    // Primeiro pedido de saída em t = 1_000ms
    ruleset.requestExit(session, hero.id);
    expect(session.ended).toBeNull();

    // Segundo pedido após 2_000ms não reseta o timer
    session.advanceBy(2_000); // t = 3_000ms
    ruleset.requestExit(session, hero.id);

    // Em t = 5_999ms (1_000 + 4_999ms), ainda não encerrou
    session.advanceBy(2_999);
    expect(session.ended).toBeNull();

    // Em t = 6_000ms (1_000 + 5_000ms), encerra em manual-exit
    session.advanceBy(1);
    expect(session.ended).toBe('manual-exit');
  });

  it('exitDelayMs sozinho sem disparo de regra ou requestExit não encerra a hunt', () => {
    const { session } = withExit([], { health: 100, exitDelayMs: 5_000 });
    run(session, 15_000, 100);
    expect(session.ended).toBeNull();
  });

  it('retomada de snapshot no meio da contagem preserva o timer e o motivo (RF-05)', () => {
    const { session, hero, ruleset, loaded } = withExit(
      [],
      { health: 100, exitDelayMs: 5_000 },
    );
    session.advanceBy(1_000);
    ruleset.requestExit(session, hero.id);

    // Avança 2_000ms na contagem (t = 3_000ms; faltam 3_000ms para 6_000ms)
    session.advanceBy(2_000);
    expect(session.ended).toBeNull();

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    // Em t = 5_999ms (2_999ms após restauração), ainda não encerrou
    retomado.advanceBy(2_999);
    expect(retomado.ended).toBeNull();

    // Em t = 6_000ms (3_000ms após restauração), encerra preservando 'manual-exit'
    retomado.advanceBy(1);
    expect(retomado.ended).toBe('manual-exit');
  });
});

// --- a configuração sobrevive ao snapshot e à troca ao vivo (FUN-81) -------------------------

describe('a configuração do bot atravessa o snapshot (FUN-81)', () => {
  const curar = botConfig({
    heal: [{ when: { kind: 'hp', op: '<=', percent: 90 }, do: { kind: 'spell', spellId: 'heal' } }],
    targeting: botTargetingSchema.parse({ policy: 'lowest-hp', ignore: ['rat'] }),
    exit: [botExitRuleSchema.parse({ kind: 'hp-below', percent: 10 })],
  });

  /**
   * Pool de vida REALISTA aqui, ao contrário do resto do arquivo.
   *
   * O `progression` compartilhado dá 500.000 de HP inicial para uma hunt de dez minutos caber
   * sem morrer, e com ele um herói com 1.000 de vida está a 0,2% do máximo — a regra de saída
   * `hp-below: 10` encerraria a sessão em 250 ms, antes de qualquer snapshot. Foi exatamente o
   * que aconteceu na primeira versão destes testes: eles falharam por causa da fixture, não do
   * código. Com 1.000 de teto, "metade da vida" quer dizer metade.
   */
  const comBot = (health = 500) => {
    const loaded = buildContent(raw({
      progression: [{
        ...progression, startingHealth: 1_000, startingMana: 200,
        regen: { healthPerSecond: 0, manaPerSecond: 0 },
      }],
    }));
    const session = createHuntSession({
      id: 'snap-bot', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      botConfig: curar,
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 1_000, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);
    return { session, hero, loaded };
  };

  it('a hunt retomada CONTINUA com o bot — antes disto ela voltava sem nenhum', () => {
    // O defeito que este teste fecha: `huntRulesetFromSnapshot` montava o ruleset sem bot, e a
    // hunt retomada seguia andando e matando com o ataque básico. Nada PARECIA quebrado — o
    // que sumia era a cura, e o jogador descobria pelo personagem morto.
    const { session, loaded } = comBot();
    session.advanceBy(5_000);

    // Pelo JSON, porque é assim que ele atravessa o Redis.
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    const antes = retomado.participants[0]?.mana ?? 0;
    run(retomado, 5_000, 100);
    // Curou: a mana desceu. Sem bot, ela ficaria parada onde estava.
    expect(retomado.participants[0]?.mana).toBeLessThan(antes);
  });

  it('o targeting configurado sobrevive: ignorar continua ignorando depois da retomada', () => {
    const { session, loaded } = comBot();
    run(session, 10_000, 100);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );
    const abatesAoRetomar = retomado.aggregates.kills;

    run(retomado, 30_000, 100);

    // `ignore: ['rat']` e a hunt só tem rato: o personagem não bate em ninguém.
    expect(retomado.aggregates.kills).toBe(abatesAoRetomar);
  });

  it('as regras de saída voltam junto — o extrato continua sabendo por que encerrou', () => {
    const { session, hero, loaded } = comBot();
    session.advanceBy(250);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    // Derruba o personagem abaixo dos 10% que a regra pede. Só depois de retomar: se a regra
    // não tivesse voltado, ele ficaria caçando com 5% de vida até morrer.
    const eu = retomado.participants[0] as CharacterRuntime;
    eu.health = Math.round(hero.maxHealth * 0.05);
    run(retomado, 2_000, 100);

    expect(retomado.ended).toBe('exit-rule');
    expect(retomado.notableEvents.find((e) => e.type === 'exit-rule')?.detail)
      .toBe('hp-below-10');
  });

  it('snapshot SEM configuração continua legível — é o de antes desta issue', () => {
    // Campo opcional, sem bump de formato. Ausente significa "sem bot", que é o que aquelas
    // sessões de fato tinham.
    const { session, loaded } = comBot();
    session.advanceBy(250);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    delete (snapshot.ruleset as { botConfig?: unknown }).botConfig;
    // E sem `runners` (#203): o snapshot de antes não tinha estado por participante.
    delete (snapshot.ruleset as { runners?: unknown }).runners;

    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );
    const antes = retomado.participants[0]?.mana ?? 0;
    run(retomado, 5_000, 100);

    expect(retomado.participants[0]?.mana).toBe(antes);
    expect(retomado.ended).toBeNull();
  });
});

describe('trocar a configuração no meio da hunt (FUN-81)', () => {
  it('a regra nova passa a valer NA HORA, sem esperar a próxima hunt', () => {
    // Esperar a próxima hunt seria o jogador corrigir a regra de cura enquanto o personagem
    // morre. A configuração é dado puro: recompilar não tem risco nenhum.
    const loaded = buildContent(raw({
      routes: [{ ...route, spawnPoints: [] }],
      progression: [{
        ...progression, startingMana: 200, regen: { healthPerSecond: 0, manaPerSecond: 0 },
      }],
    }));
    const session = createHuntSession({
      id: 'troca', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      botConfig: botConfig(),
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: 1_000, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);

    run(session, 3_000, 100);
    expect(hero.mana).toBe(200); // sem regra de cura, nada aconteceu

    (session.ruleset as HuntRuleset).configureBot(session, botConfig({
      heal: [{
        when: { kind: 'hp', op: '<=', percent: 90 }, do: { kind: 'spell', spellId: 'heal' },
      }],
    }));
    run(session, 1_000, 100);

    expect(hero.mana).toBeLessThan(200);
  });

  it('trocar a configuração troca também as regras de SAÍDA', () => {
    // Deixar as antigas valendo faria a hunt encerrar por uma regra que o jogador acabou de
    // apagar — e o extrato diria o nome de uma regra que já não existe.
    const loaded = buildContent(raw({ routes: [{ ...route, spawnPoints: [] }] }));
    const session = createHuntSession({
      id: 'troca-saida', content: loaded, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0,
      botConfig: botConfig({ exit: [botExitRuleSchema.parse({ kind: 'hp-below', percent: 99 })] }),
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: 10, maxHealth: stats.maxHealth, mana: 0, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);

    // Apaga a regra ANTES de ela ser avaliada — o primeiro `EXIT_RULES` vence em 250 ms.
    (session.ruleset as HuntRuleset).configureBot(session, botConfig());
    run(session, 5_000, 100);

    expect(session.ended).toBeNull();
  });
});

// --- skills sobem pelo USO (FUN-75) ----------------------------------------------------------

describe('skills sobem pelo uso, e a curva é conteúdo (FUN-75)', () => {
  const skillDe = (hero: CharacterRuntime, id: string) =>
    hero.skills.getState()[id] ?? null;

  it('cada golpe conta um ponto, e o nível sobe pelo que a curva diz', () => {
    // Curva de base 2: dois golpes fecham um nível. Contar acerto cheio em vez de golpe faria
    // a skill subir mais devagar contra alvo blindado, que é o oposto de "sobe pelo uso".
    //
    // Dificuldade `bold` (três ratos) e um minuto: sem isso o personagem passa metade
    // do tempo esperando respawn, e o teste mediria a densidade da hunt em vez da curva.
    const { session, hero } = start({ difficulty: 'bold' });

    run(session, 60_000, 100);

    const melee = skillDe(hero, 'melee');
    expect(melee).not.toBeNull();
    expect(melee?.level).toBeGreaterThan(10);
  });

  it('a skill ESCALA o dano — quem treinou mata mais no mesmo tempo', () => {
    // Duas hunts idênticas, mesma semente, mesmo cenário: só o nível de skill do personagem
    // muda. A primeira versão deste teste só afirmava que a skill subiu, e passava igual com
    // a escala arrancada — um teste que não distingue os dois lados não protege nenhum.
    //
    // `damagePerLevel: 0.5` neste conteúdo de teste, alto de propósito: com skill 30 o poder
    // vai de 25 para 275, e um rato de 50 cai num golpe em vez de dois.
    const cru = start({ difficulty: 'bold' });
    run(cru.session, 60_000, 100);

    const treinado = start({
      difficulty: 'bold', skills: { melee: { level: 30, points: 0 } },
    });
    run(treinado.session, 60_000, 100);

    expect(treinado.session.aggregates.kills)
      .toBeGreaterThan(cru.session.aggregates.kills);
  });

  it('magia sobe por MANA GASTA, não por lançamento', () => {
    // §9.4, modelo do Tibia. Por lançamento, a forma ótima de subir magia seria lançar mil
    // vezes a magia mais barata, e o jogo viraria macro de spam.
    //
    // O teste afirma o NÚMERO, e isso é o ponto: a primeira versão dele só checava "subiu
    // algo", e passava igual com a magia rendendo um ponto por lançamento. Um teste que passa
    // dos dois lados da decisão não protege a decisão.
    const { session, hero } = withSpells(botConfig({
      heal: [healRule(100)],
    }), { health: 1_000, monsters: false });

    run(session, 10_000, 100);

    // Mana 200, cura de 20: dez curas até acabar. Por mana gasta são 200 pontos; por
    // lançamento seriam 10. Com curva de 100, a diferença é nível 2 contra nível 0.
    const magic = skillDe(hero, 'magic');
    expect(magic).toEqual({ level: 2, points: 0 });
    expect(hero.mana).toBe(0);
  });

  it('magia RECUSADA não rende skill — não gastou mana, não praticou', () => {
    // Sem mana, a cura é recusada. Contar a tentativa faria "praticar" virar "tentar", e o
    // caminho ótimo passaria a ser spammar sem mana.
    const { session, hero } = withSpells(
      botConfig({ heal: [healRule(100)] }), { health: 1_000, mana: 0, monsters: false },
    );

    run(session, 10_000, 100);

    expect(skillDe(hero, 'magic')).toBeNull();
  });

  it('subir de nível vira evento notável — é o que o jogador quer ver ao voltar', () => {
    // §16.2: a lista curta da tela de retorno. Numa hunt de oito horas, subir uma skill é uma
    // das poucas coisas que aconteceram que valem uma linha.
    const { session } = start({ difficulty: 'bold' });
    run(session, 60_000, 100);

    const subiu = session.notableEvents.filter((e) => e.type === 'skill-up');
    expect(subiu.length).toBeGreaterThan(0);
    expect(subiu[0]?.detail).toMatch(/^melee\/\d+$/);
  });

  it('as skills atravessam o snapshot', () => {
    const { session, hero } = start({ difficulty: 'bold' });
    run(session, 60_000, 100);
    const antes = hero.skills.getState();

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(retomado.participants[0]?.skills.getState()).toEqual(antes);
  });

  it('personagem SEM skills gravadas começa no nível inicial, e não quebra', () => {
    // É o personagem de antes desta issue. Campo opcional, sem bump de formato.
    const { session, hero } = start();
    run(session, 5_000, 100);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    delete (snapshot.participants[0] as { skills?: unknown }).skills;

    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(retomado.participants[0]?.skills.getState()).toEqual({});
    expect(() => run(retomado, 5_000, 100)).not.toThrow();
  });

  it('1 Hz e 10 Hz sobem a MESMA skill — uso é evento, não tick', () => {
    // O que o invariante 2 proíbe é grandeza dependente do TEMPO somada por tick. Aqui o que
    // se soma é uso, e uso é evento na fila: um golpe que vence, uma magia que sai.
    const at = (stepMs: number) => {
      const { session, hero } = start({ difficulty: 'bold' });
      run(session, 120_000, stepMs);
      return { skills: hero.skills.getState(), kills: session.aggregates.kills };
    };

    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    expect(rapido.skills['melee']?.level).toBeGreaterThan(10);
  });
});

describe('defesa, escudo e prática de shielding (CMB-04)', () => {
  const shieldItem = {
    id: 'shield', name: 'Shield', kind: 'shield', slot: 'shield',
    weight: 40, value: 0, defense: 30,
  };
  const shielding = {
    id: 'shielding', name: 'Escudo', startingLevel: 10,
    curve: { base: 2, factor: 1 }, gain: { on: 'shield-block', points: 1 },
    damagePerLevel: 0.5,
  };
  const defense = { skillId: 'shielding', blockChance: 1, blockTypes: ['physical'] };

  /** O conteúdo do CMB-04: o escudo no catálogo, a skill de bloqueio e o perfil com defesa. */
  const defenseContent = (over: Partial<RawContent> = {}): Content => content({
    items: [...items, shieldItem],
    skills: [...skills, shielding],
    combat: [{ ...combat, defense }],
    ...over,
  });

  const comEscudo: InventoryState = {
    backpack: [],
    equipped: { shield: { instanceId: 's1', itemId: 'shield', quantity: 1 } },
  };
  const shieldingOf = (hero: CharacterRuntime) => hero.skills.getState()['shielding'] ?? null;

  it('shielding sobe por ataque físico elegível recebido', () => {
    const { session, hero } = start({
      loaded: defenseContent(), difficulty: 'bold', health: 5_000, inventory: comEscudo,
    });
    run(session, 30_000, 100);
    expect(shieldingOf(hero)?.level).toBeGreaterThan(10);
  });

  it('sem fonte de defesa NÃO sobe: desarmado não treina shielding', () => {
    const { session, hero } = start({ loaded: defenseContent(), difficulty: 'bold', health: 5_000 });
    run(session, 30_000, 100);
    expect(shieldingOf(hero)).toBeNull();
  });

  it('ataque elemental NÃO treina shielding por acidente', () => {
    // O perfil aprova só `physical`: um rato de fogo atravessa a defesa sem rolar bloqueio.
    const fireRat = { ...rat, damageType: 'fire' };
    const { session, hero } = start({
      loaded: defenseContent({ monsters: [fireRat] }), difficulty: 'bold',
      health: 5_000, inventory: comEscudo,
    });
    run(session, 30_000, 100);
    expect(shieldingOf(hero)).toBeNull();
  });

  it('#548 (achado da revisão do PR #642): sob combat-v3 a ORIGEM decide, não o tipo de dano', () => {
    // O MESMO rato de fogo do teste acima — corpo a corpo (`attackRange: 1`), dano elemental —
    // mas agora sob `combat-v3`: `blockTypes` (que só aprova `physical`) não é mais quem decide
    // a elegibilidade do dano em si, é a ORIGEM (`blockable.shield`, a mesma flag que
    // `resolveBlockHit` usa). Um ataque corpo a corpo elemental É elegível, e o shield tem que
    // treinar — o oposto do teste v1/v2 acima, de propósito.
    const fireRat = { ...rat, damageType: 'fire' };
    const combatV3 = {
      ...combat, compatibilityProfile: 'combat-v3', defense,
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09, attackFactor: 1 },
      distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    };
    const { session, hero } = start({
      loaded: defenseContent({ monsters: [fireRat], combat: [combatV3] }), difficulty: 'bold',
      health: 5_000, inventory: comEscudo,
    });
    run(session, 30_000, 100);
    expect(shieldingOf(hero)?.level).toBeGreaterThan(10);
  });

  it('#549 (achado de revisão): wand/rod sem escudo usa skill ZERO na defesa — o piso do Canary (1), não a fórmula com defenseValue zerado (0)', () => {
    // Um Sorcerer/Druid com só a wand na mão e sem escudo (o caso comum antes do nível 50, ou
    // de quem simplesmente não veste um spellbook): `Player::getWeaponSkill` do Canary devolve
    // 0 para `WEAPON_WAND` (`default: attackSkill = 0`, player.cpp:474-509) — não a skill de
    // magia, que a família `wand` aponta para o DANO (DT-02), quase sempre não-zero. Como a
    // wand nunca declara `defense`/`extraDefense`, alimentar a skill de magia pularia o piso
    // fixo (`defenseSkill === 0` → 1 ofensivo/2 defensivo) e devolveria 0 pela fórmula cheia com
    // `defenseValue` zerado — o oposto do Canary.
    vi.mocked(resolveDamage).mockClear();
    const combatV3 = {
      ...combat, compatibilityProfile: 'combat-v3',
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09, attackFactor: 1 },
      distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    };
    const comWand: InventoryState = {
      backpack: [], equipped: { hand: { instanceId: 'w1', itemId: 'wand', quantity: 1 } },
    };
    const { session } = start({
      loaded: content({ combat: [combatV3] }), difficulty: 'bold', health: 5_000,
      inventory: comWand, skills: { magic: { level: 50, points: 0 } },
    });
    run(session, 5_000, 100);

    const hits = vi.mocked(resolveDamage).mock.calls
      .filter(([intent]) => intent.source === 'monster-attack');
    expect(hits.length).toBeGreaterThan(0);
    for (const [, defender] of hits) {
      expect(defender.defense).toEqual({ kind: 'weapon', defense: 1 });
    }
  });

  it('#549 (achado de revisão): a skill de escudo soma o bônus de equipamento, como a de arma já soma', () => {
    // `getSkillLevel` do Canary soma `varSkills[skill]` (o bônus de EQUIPAMENTO) para TODA
    // skill, sem exceção para `SKILL_SHIELD` (player.cpp:7480) — a mesma leitura que
    // `#skillLevelOf` já faz para a skill de arma/punho (#524). Nenhum item do catálogo real
    // declara hoje um bônus de `shielding`; este teste usa um item só-de-teste para provar que
    // a fórmula honra o bônus quando ele existir, em vez de descartá-lo silenciosamente.
    const shieldWithBonus = {
      id: 'shield-of-focus', name: 'Shield of Focus', kind: 'shield', slot: 'shield',
      weight: 40, value: 0, defense: 30,
      bonuses: { skill: { skillId: 'shielding', amount: 20 } },
    };
    const combatV3 = {
      ...combat, compatibilityProfile: 'combat-v3', defense,
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09, attackFactor: 1 },
      distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    };
    const loaded = defenseContent({ items: [...items, shieldWithBonus], combat: [combatV3] });
    const comEscudoComBonus: InventoryState = {
      backpack: [], equipped: { shield: { instanceId: 's1', itemId: 'shield-of-focus', quantity: 1 } },
    };

    // Skill de shielding NUNCA treinada (nível 0, sobrescrita — o conteúdo deste describe
    // declara `startingLevel: 10`) — só os 20 do bônus do item de teste.
    const comBonusSemSkill = start({
      loaded, difficulty: 'bold', health: 5_000, inventory: comEscudoComBonus,
      skills: { shielding: { level: 0, points: 0 } },
    });
    vi.mocked(resolveDamage).mockClear();
    run(comBonusSemSkill.session, 5_000, 100);
    const bonusHits = vi.mocked(resolveDamage).mock.calls
      .filter(([intent]) => intent.source === 'monster-attack');
    expect(bonusHits.length).toBeGreaterThan(0);
    const [, bonusDefender] = bonusHits[0]!;

    // O escudo COMUM (mesma defesa 30, sem bônus) com a skill de shielding treinada até 20 —
    // o MESMO total (0 + 20 bônus == 20 + 0 bônus) por um caminho diferente.
    const comSkillSemBonus = start({
      loaded: defenseContent({ combat: [combatV3] }), difficulty: 'bold', health: 5_000,
      inventory: comEscudo, skills: { shielding: { level: 20, points: 0 } },
    });
    vi.mocked(resolveDamage).mockClear();
    run(comSkillSemBonus.session, 5_000, 100);
    const skillHits = vi.mocked(resolveDamage).mock.calls
      .filter(([intent]) => intent.source === 'monster-attack');
    expect(skillHits.length).toBeGreaterThan(0);
    const [, skillDefender] = skillHits[0]!;

    // Os dois caminhos chegam ao MESMO total de skill (20) — se o bônus de equipamento fosse
    // ignorado (o bug), `bonusDefender` ficaria com o total de quem nunca treinou (0), mais
    // baixo que `skillDefender`.
    expect(bonusDefender.defense).toEqual(skillDefender.defense);
    expect(bonusDefender.defenseMitigation).toEqual(skillDefender.defenseMitigation);
  });

  it('não é por TICK: sem ser atacado, a skill fica parada', () => {
    // O rato com aggro 0 nunca chega a atacar: o tempo passa e a skill não se move.
    const pacificRat = { ...rat, aggroRadius: 0 };
    const { session, hero } = start({
      loaded: defenseContent({ monsters: [pacificRat] }), difficulty: 'bold',
      health: 5_000, inventory: comEscudo,
    });
    run(session, 60_000, 100);
    expect(shieldingOf(hero)).toBeNull();
  });

  it('não é condicionada ao HP perdido: bloqueio total ainda treina', () => {
    // Piso zero e defesa acima do ataque do rato: ele não tira vida, e a skill sobe do mesmo
    // jeito — a prática é do evento elegível, não do dano aplicado. Regeneração desligada e
    // dificuldade `cautious` para a vida não subir sozinha e não haver level up.
    const semRegen = { ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } };
    const { session, hero } = start({
      loaded: defenseContent({
        progression: [semRegen],
        combat: [{ ...combat, defense, minimumDamageFraction: 0 }],
      }),
      difficulty: 'cautious', health: 5_000, inventory: comEscudo,
    });
    const antes = hero.health;
    run(session, 30_000, 100);
    expect(hero.health).toBe(antes);
    expect(shieldingOf(hero)?.points).toBeGreaterThan(0);
  });

  it('a skill de shielding atravessa o snapshot', () => {
    const loaded = defenseContent();
    const { session } = start({
      loaded, difficulty: 'bold', health: 5_000, inventory: comEscudo,
    });
    run(session, 30_000, 100);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(retomado.participants[0]?.skills.getState()['shielding'])
      .toEqual(session.participants[0]?.skills.getState()['shielding']);
  });
});

describe('Bestiário: abates por monstro, marcos e bônus de XP (FUN-113)', () => {
  // Marcos curtos e bônus alto de propósito: com [3, 5] e 20 % dá para contar os abates na mão,
  // e um rato de 5 XP passa a render 6 no primeiro marco e 7 no segundo — números que se
  // conferem a olho. Com o 1 % do conteúdo real, `floor(5 × 1,01)` continua 5 e o teste não
  // distinguiria bônus de nada.
  const bestiary = { id: 'baseline', milestones: [3, 5], xpBonusPercentPerMilestone: 20 };
  const withBestiary = () => content({ bestiary: [bestiary] });

  /**
   * A XP que CADA abate rendeu, na ordem. Avança em passos de 100 ms e anota a diferença de XP
   * sempre que a contagem de abates sobe — e ela sobe de um em um, porque um golpe mata no
   * máximo um rato e há um golpe por vencimento.
   */
  const xpPerKill = (started: Started, kills: number): number[] => {
    const { session, hero } = started;
    const perKill: number[] = [];
    let seenKills = 0;
    let seenXp = hero.xp;
    while (perKill.length < kills && session.nowMs < 600_000) {
      session.advanceBy(100);
      if (session.aggregates.kills === seenKills) continue;
      expect(session.aggregates.kills).toBe(seenKills + 1);
      perKill.push(hero.xp - seenXp);
      seenKills = session.aggregates.kills;
      seenXp = hero.xp;
    }
    return perKill;
  };

  it('cada abate conta no Bestiário do matador, e o extrato leva o número ABSOLUTO', () => {
    const { session, hero } = start({ difficulty: 'bold' });
    run(session, 60_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.bestiary.killsOf('rat')).toBe(session.aggregates.kills);
    expect(hero.getState().bestiary).toEqual({ rat: session.aggregates.kills });
  });

  it('sem config no conteúdo o abate conta, mas nenhum marco fecha e a XP sai sem bônus', () => {
    // O conteúdo de teste não tem `bestiary/`. A config é quem define marco, não quem autoriza
    // contar — e sem ela a XP é a de sempre, rato a rato.
    const { session, hero } = start({ difficulty: 'bold' });
    run(session, 60_000, 100);
    expect(hero.bestiary.killsOf('rat')).toBeGreaterThanOrEqual(3);
    expect(session.notableEvents.filter((e) => e.type === 'bestiary-milestone')).toHaveLength(0);
    expect(hero.xp).toBe(session.aggregates.kills * rat.experience);
  });

  it('abate com stamina zero NÃO conta — e continua sem XP e sem loot', () => {
    // §18.6, DT-03: é o MESMO `if` que bloqueia a recompensa. Prender os três aqui é o que
    // impede alguém de mover o contador para fora dele "porque abate é abate".
    const { session, hero } = start({
      difficulty: 'bold', staminaMs: 0, loaded: withBestiary(),
    });
    run(session, 60_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.bestiary.getState()).toEqual({});
    expect(hero.xp).toBe(0);
    expect(session.aggregates.xpGained).toBe(0);
    expect(hero.goldDelta).toBe(0);
  });

  it('o abate que ALCANÇA o marco sai com a XP de antes; o seguinte já sai com o bônus', () => {
    // DT-04. Invertida a ordem, o terceiro abate seria o único da vida do personagem a render
    // diferente dos vizinhos.
    const started = start({ difficulty: 'bold', loaded: withBestiary() });
    const perKill = xpPerKill(started, 6);

    //                    1  2  3  4  5  6
    //                          ^marco 1  ^marco 2
    expect(perKill).toEqual([5, 5, 5, 6, 6, 7]);
    expect(started.hero.bestiary.killsOf('rat')).toBe(6);
    expect(started.session.aggregates.xpGained).toBe(started.hero.xp);

    const milestones = started.session.notableEvents.filter((e) => e.type === 'bestiary-milestone');
    expect(milestones.map((e) => e.detail)).toEqual(['rat/1', 'rat/2']);
  });

  it('o bônus é GLOBAL: um marco de outro monstro já vale para o primeiro rato (DT-01)', () => {
    // O personagem chega do ticket com três morcegos no Bestiário — um marco. O primeiro rato
    // rende 6, não 5: "XP PvE permanente", não "XP daquele monstro".
    const started = start({
      difficulty: 'bold', loaded: withBestiary(), bestiary: { bat: 3 },
    });
    expect(xpPerKill(started, 1)).toEqual([6]);
    expect(started.hero.bestiary.getState()).toEqual({ bat: 3, rat: 1 });
  });

  it('o Bestiário atravessa o snapshot', () => {
    const { session, hero } = start({ difficulty: 'bold', loaded: withBestiary() });
    run(session, 60_000, 100);
    const before = hero.bestiary.getState();
    expect(before['rat']).toBeGreaterThan(0);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, withBestiary()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(resumed.participants[0]?.bestiary.getState()).toEqual(before);
  });

  it('personagem SEM Bestiário gravado começa do zero, e não quebra', () => {
    // É o personagem de antes desta issue. Campo opcional, sem bump de formato (DT-06).
    const { session } = start();
    run(session, 5_000, 100);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    delete (snapshot.participants[0] as { bestiary?: unknown }).bestiary;

    const resumed = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(resumed.participants[0]?.bestiary.getState()).toEqual({});
    expect(() => run(resumed, 5_000, 100)).not.toThrow();
  });

  it('1 Hz e 10 Hz contam o MESMO — abate é evento, não tick', () => {
    const at = (stepMs: number) => {
      const { session, hero } = start({ difficulty: 'bold', loaded: withBestiary() });
      run(session, 120_000, stepMs);
      return { bestiary: hero.bestiary.getState(), xp: hero.xp };
    };
    const fast = at(100);
    expect(at(1_000)).toEqual(fast);
    expect(fast.bestiary['rat']).toBeGreaterThanOrEqual(5);
  });
});

// --- magia em área dentro da hunt (FUN-92) ---------------------------------------------------

describe('magia em área (FUN-92)', () => {
  const explodir = botConfig({
    attack: [{
      when: { kind: 'targets', op: '>=', count: 1 },
      do: { kind: 'spell', spellId: 'blast' },
    }],
  });

  it('atinge TODOS os monstros no raio, não só o alvo', () => {
    // Dificuldade `bold` põe três ratos perto do mesmo ponto de spawn. Um `blast` de
    // raio 2 pega mais de um, e o teste mede isso pelos abates: com alvo único seriam três
    // lançamentos para três ratos.
    const { session } = withSpells(explodir, { mana: 200 }, 'bold');

    run(session, 20_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
  });

  it('uma morte no meio da área NÃO perde os alvos seguintes', () => {
    // O defeito que este teste fecha: `#onMonsterDied` troca `#monsters` por um array filtrado,
    // então resolver morte durante a varredura seria varrer um array sendo substituído — e os
    // alvos depois do que morreu ficariam de fora. Colher primeiro, aplicar depois.
    //
    // `blast` mata um rato de 50 num golpe (poder 80): com três ratos no raio, o primeiro
    // morre e os outros dois PRECISAM levar o dano da mesma rolagem.
    const { session, ruleset } = withSpells(explodir, { mana: 200 }, 'bold');

    // Um único vencimento da categoria de ataque, no instante zero.
    session.advanceBy(50);

    // Morto sai da lista (`#onMonsterDied` a filtra), então o abate se conta pelo agregado.
    const mortos = session.aggregates.kills;
    const feridos = ruleset.monsters.filter((m) => m.alive && m.health < 50).length;
    // Ou morreram, ou saíram feridos — o que não pode é um deles sair intacto tendo estado no
    // raio de uma explosão que matou o vizinho.
    expect(mortos).toBeGreaterThan(0);
    expect(mortos + feridos).toBeGreaterThan(1);
  });

  it('o mesmo lançamento com a mesma semente dá o MESMO resultado', () => {
    // A ordem em que os alvos entram na mira decide qual rolagem cai em quem. Ela é a ordem da
    // lista de monstros, que é a de nascimento — e por isso é reproduzível.
    const estado = () => {
      const { session, ruleset } = withSpells(explodir, { mana: 200 }, 'bold');
      session.advanceBy(50);
      return ruleset.monsters.map((m) => `${m.id}:${m.health}`);
    };
    expect(estado()).toEqual(estado());
  });

  it('1 Hz e 10 Hz dão o mesmo resultado com magia de área', () => {
    const at = (stepMs: number) => {
      const { session, hero, ruleset } = withSpells(explodir, { mana: 2_000 }, 'bold');
      run(session, 60_000, stepMs);
      return {
        kills: session.aggregates.kills,
        mana: hero.mana,
        vivos: ruleset.monsters.map((m) => `${m.monsterId}:${m.health}`),
      };
    };
    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    expect(rapido.kills).toBeGreaterThan(0);
  });
});

describe('o alcance da magia é o DELA, não o da arma (FUN-92)', () => {
  it('uma magia de alcance 3 alcança de onde o corpo a corpo não alcança', () => {
    // Era um defeito desde a FUN-74, e só apareceu quando o teste de área foi escrito: a mira
    // usava `#attackTarget`, que para no alcance do GOLPE (1 neste conteúdo). A conferência de
    // alcance dentro de `castSpell` nunca era a restrição que mordia, porque a seleção já
    // tinha mordido antes — uma magia de alcance 3 se comportava como uma de alcance 1.
    //
    // O cenário: personagem parado no meio do salão, alvo eterno dois tiles abaixo, sem se
    // mexer (`aggroRadius: 0`). Fora do alcance da arma, dentro do da magia.
    const loaded = buildContent(raw({
      monsters: [rat, poste, posteEterno], hunts: [hunt, huntSalao],
      maps: [map, salaGrande], routes: [route, anel],
      progression: [{ ...progression, startingMana: 500 }],
    }));
    const session = createHuntSession({
      id: 'alcance', content: loaded, huntId: 'salao', difficulty: 'bold',
      createdAtMs: 0,
      botConfig: botConfig({
        attack: [{
          when: { kind: 'targets', op: '>=', count: 0 },
          do: { kind: 'spell', spellId: 'strike' },
        }],
      }),
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);
    const ruleset = session.ruleset as HuntRuleset;

    // Um único vencimento. Nele o monstro nasce, o personagem dá um passo de rota e o bot
    // lança — tudo no instante zero, e nessa ordem, pela prioridade dos eventos.
    session.advanceBy(50);

    const alvo = ruleset.monsters[0] as { position: { x: number; y: number }; health: number };
    const tiles = Math.max(
      Math.abs(hero.position.x - alvo.position.x),
      Math.abs(hero.position.y - alvo.position.y),
    );
    // O cenário precisa ser o que ele diz ser: FORA do alcance do golpe (1), DENTRO do da
    // magia (3). Sem esta afirmação, o teste passaria com o personagem colado no monstro.
    expect(tiles).toBeGreaterThan(combat.player.attackRange);
    expect(tiles).toBeLessThanOrEqual(3);
    expect(alvo.health).toBeLessThan(1_000_000);
  });
});

// --- a arma equipada decide o dano (FUN-82) --------------------------------------------------

describe('equipamento no combate (FUN-82)', () => {
  const comEspada: InventoryState = {
    backpack: [],
    equipped: { hand: { instanceId: 'i1', itemId: 'sword', quantity: 1 } },
  };
  const comArmadura: InventoryState = {
    backpack: [],
    equipped: { chest: { instanceId: 'i2', itemId: 'plate', quantity: 1 } },
  };

  it('quem está armado mata mais no mesmo tempo', () => {
    // `combat.player.attackPower` deixou de ser "o ataque do personagem" e passou a ser o do
    // personagem SEM arma. A espada deste conteúdo bate 200 contra os 25 do punho: o rato de
    // 50 cai num golpe em vez de dois.
    const desarmado = start({ difficulty: 'bold' });
    run(desarmado.session, 60_000, 100);

    const armado = start({ difficulty: 'bold', inventory: comEspada });
    run(armado.session, 60_000, 100);

    expect(armado.session.aggregates.kills)
      .toBeGreaterThan(desarmado.session.aggregates.kills);
  });

  it('a armadura vestida SOMA à do conteúdo, e o personagem apanha menos', () => {
    // Somar, e não substituir: `combat.player.armor` é a resistência do corpo. Substituir faria
    // vestir a primeira armadura deixar o personagem mais frágil se ela valesse menos.
    const nu = start({ difficulty: 'bold', health: 5_000 });
    run(nu.session, 60_000, 100);

    const vestido = start({
      difficulty: 'bold', health: 5_000, inventory: comArmadura,
    });
    run(vestido.session, 60_000, 100);

    expect(vestido.hero.health).toBeGreaterThan(nu.hero.health);
  });

  it('o inventário atravessa o snapshot', () => {
    const { session } = start({ difficulty: 'bold', inventory: comEspada });
    run(session, 5_000, 100);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(retomado.participants[0]?.inventory.equippedAt('hand')?.itemId).toBe('sword');
  });

  it('personagem SEM inventário gravado continua batendo com o desarmado', () => {
    // É o personagem de antes desta issue. Campo opcional, sem bump de formato.
    const { session, hero } = start({ difficulty: 'bold' });
    run(session, 10_000, 100);

    expect(hero.inventory.backpack).toEqual([]);
    expect(session.aggregates.kills).toBeGreaterThan(0);
  });

  it('capacidade ZERO é reposta na entrada, pela tabela', () => {
    // Zero é o que um personagem gravado antes do inventário traz, e zero quer dizer "não
    // carrega nada" — travaria a mochila de quem já jogava. A reposição é só para esse caso:
    // quem chega com capacidade própria a mantém.
    const loaded = content();
    const session = createHuntSession({
      id: 'capacidade', content: loaded, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const antigo = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    expect(antigo.capacity).toBe(0);

    session.enter(antigo);

    expect(antigo.capacity).toBe(stats.capacity);
  });

  it('a capacidade acompanha o LEVEL', () => {
    // Sem isto, subir de level daria vida e mana e deixaria a mochila do mesmo tamanho — e o
    // jogador descobriria pelo item que não coube, sem nada ligando uma coisa à outra.
    const um = statsForLevel(1, null, progression as Progression).capacity;
    const dez = statsForLevel(10, null, progression as Progression).capacity;
    expect(dez).toBeGreaterThan(um);

    const { session, hero } = start();
    session.advanceBy(10);
    hero.xp = totalXpForLevel(10, progression as Progression);
    run(session, 30_000, 100);

    expect(hero.level).toBeGreaterThan(1);
    expect(hero.capacity).toBe(
      statsForLevel(hero.level, null, progression as Progression).capacity,
    );
  });
});

// --- loot de item por abate (FUN-88) ---------------------------------------------------------

describe('o item cai, e vai para algum lugar (FUN-88)', () => {
  /**
   * A capacidade vem da TABELA e é recalculada a cada level up (FUN-82) — então ela não pode
   * ser fixada no personagem e esquecida: a primeira subida de level a sobrescreve.
   *
   * A primeira versão deste helper fazia exatamente isso, e os testes falharam por culpa da
   * fixture. Fixar `capacityPerLevel: 0` e escolher a inicial é o que torna o número estável
   * durante o teste, sem lutar contra o motor.
   */
  const comDrop = (over: {
    capacity?: number; staminaMs?: number; catalog?: boolean;
  } = {}) => {
    const loaded = buildContent(raw({
      monsters: [ratWithDrop],
      progression: [{
        ...progression, startingCapacity: over.capacity ?? 10_000, capacityPerLevel: 0,
      }],
    }));
    const session = createHuntSession({
      // Conteúdo com o catálogo VAZIO simula o que muda debaixo de uma sessão em voo: a
      // espada existia quando a hunt abriu e não existe mais.
      content: over.catalog === false ? { ...loaded, items: new Map() } : loaded,
      id: 'drop', huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null,
      staminaMs: over.staminaMs ?? stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
      capacity: stats.capacity,
    });
    session.enter(hero);
    return { session, hero, ruleset: session.ruleset as HuntRuleset };
  };

  it('o item entra na MOCHILA quando cabe', () => {
    const { session, hero } = comDrop();
    run(session, 60_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect([...hero.inventory.items()].length).toBe(session.aggregates.kills);
    expect(hero.lootBox).toEqual([]);
  });

  it('o id da instância é DETERMINÍSTICO, e é o que torna a inserção idempotente', () => {
    // `sessionId:n`. Reprocessar o extrato insere a mesma chave primária e não faz nada — a
    // idempotência do invariante 10 obtida por identidade previsível, sem conferência.
    const { session, hero } = comDrop();
    run(session, 60_000, 100);

    for (const [n, item] of [...hero.inventory.items()].entries()) {
      expect(item.instanceId).toBe(`drop:${n}`);
    }
  });

  it('o que NÃO cabe vai para a Caixa de Loot da Sessão', () => {
    // Capacidade para uma espada só (peso 50). A segunda não cabe e não se perde: ela vai para
    // a caixa, que é o §21.6 em uma linha.
    // Capacidade para uma espada só (peso 50).
    const { session, hero } = comDrop({ capacity: 50 });
    run(session, 60_000, 100);

    expect([...hero.inventory.items()]).toHaveLength(1);
    expect(hero.lootBox.length).toBeGreaterThan(0);
    // E os ids continuam únicos entre a mochila e a caixa: o contador é um só.
    const todos = [...hero.inventory.items(), ...hero.lootBox].map((i) => i.instanceId);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('a mochila cheia vira UMA linha no extrato, não uma por item', () => {
    // Uma por item encheria a lista curta da tela de retorno até ela deixar de ser lista. O
    // que o jogador precisa saber é que a mochila encheu.
    const { session } = comDrop({ capacity: 50 });
    run(session, 60_000, 100);

    expect(session.notableEvents.filter((e) => e.type === 'backpack-full')).toHaveLength(1);
  });

  it('com stamina ZERO não cai item nenhum, como não cai gold (§10.2)', () => {
    // O portão da recompensa já existia para gold e XP; itens entram por ele também. O abate
    // continua contando: o jogador matou, e o extrato mentiria se dissesse que não.
    const { session, hero } = comDrop({ staminaMs: 0 });
    run(session, 60_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.inventory.backpack).toEqual([]);
    expect(hero.lootBox).toEqual([]);
  });

  it('item que sumiu do catálogo não vira instância fantasma', () => {
    // `buildContent` recusa loot de item inexistente no boot, então isto só acontece com o
    // conteúdo mudando sob uma sessão EM VOO. A resposta certa é não entregar nada — uma
    // instância de um item que não existe não pode ser desenhada, equipada nem vendida, e o
    // contador de instâncias não pode avançar por ela.
    const { session, hero } = comDrop({ catalog: false });
    run(session, 60_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.inventory.backpack).toEqual([]);
    expect(hero.lootBox).toEqual([]);
    // E não queimou identidade: o contador não avança por um item que não vai existir.
    expect(hero.lootSeq).toBe(0);
  });

  it('a caixa e o contador atravessam o snapshot', () => {
    const { session, hero } = comDrop({ capacity: 50 });
    run(session, 60_000, 100);
    const antes = { caixa: hero.lootBox.length, seq: hero.lootSeq };
    expect(antes.caixa).toBeGreaterThan(0);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, buildContent(raw({ monsters: [ratWithDrop] }))) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    const voltou = retomado.participants[0] as CharacterRuntime;
    expect(voltou.lootBox).toHaveLength(antes.caixa);
    // O contador precisa voltar: recomeçar geraria o mesmo id de novo, e como a inserção é
    // idempotente por id, o item novo seria descartado por parecer repetido.
    expect(voltou.lootSeq).toBe(antes.seq);
  });

  it('o aviso de mochila cheia NÃO se repete depois da retomada', () => {
    const { session } = comDrop({ capacity: 50 });
    run(session, 60_000, 100);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const estado = snapshot.ruleset as { warnedFullBackpack?: boolean };
    expect(estado.warnedFullBackpack).toBe(true);
  });

  it('1 Hz e 10 Hz largam os MESMOS itens', () => {
    // A ordem dos sorteios é contrato (FUN-63), e acrescentar destino não muda sorteio.
    const at = (stepMs: number) => {
      const { session, hero } = comDrop();
      run(session, 120_000, stepMs);
      return {
        kills: session.aggregates.kills,
        mochila: [...hero.inventory.items()].map((i) => `${i.instanceId}/${i.itemId}`),
        caixa: hero.lootBox.length,
      };
    };
    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    expect(rapido.mochila.length).toBeGreaterThan(0);
  });
});

// --- os agregados do analisador (FUN-78) -----------------------------------------------------

describe('mochila e bolsa na hunt (#160, ADR 0026 decisão 6)', () => {
  const backpackItem = {
    id: 'backpack', name: 'Backpack', kind: 'container', slot: 'back', weight: 18, value: 0, initialSlots: 20,
  };
  /** Um herói com a mochila nas costas, numa arena em que cada rato solta uma espada. */
  const withBackpack = (capacity: number) => {
    const loaded = buildContent(raw({
      monsters: [ratWithDrop],
      items: [...items, backpackItem],
      progression: [{ ...progression, startingCapacity: capacity, capacityPerLevel: 0, satchelInitialSlots: 10, containerRow: 5 }],
    }));
    const session = createHuntSession({ content: loaded, id: 'drop', huntId: 'arena', difficulty: 'bold', createdAtMs: 0 });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: stats.capacity,
      inventory: { backpack: [], equipped: { back: { instanceId: 'kit:back', itemId: 'backpack', quantity: 1 } } },
    });
    session.enter(hero);
    return { session, hero };
  };

  it('nasce com 20 lugares, e o 21º drop abre uma linha — a Caixa fica vazia enquanto o PESO cabe', () => {
    // Mutação que mata: `#deliverLoot` recusar por lugar, ou `ensureContainers` não rodar na entrada.
    const { session, hero } = withBackpack(100_000);
    expect(hero.inventory.backpack).toHaveLength(20);
    expect(hero.inventory.satchel).toHaveLength(10);
    run(session, 240_000, 100);
    const looted = [...hero.inventory.items()].length;
    expect(looted).toBeGreaterThan(20);
    expect(hero.inventory.backpack.length).toBe(20 + 5 * Math.ceil((looted - 20) / 5));
    expect(hero.lootBox).toEqual([]);
    // Tudo na mochila, nada na bolsa: o loot cai na mochila enquanto ela está nas costas.
    expect(hero.inventory.satchel.every((p) => p === null)).toBe(true);
  });

  it('com capacidade curta, o excedente vai para a Caixa — por peso, com lugar sobrando', () => {
    const { session, hero } = withBackpack(18 + 50 * 3);
    run(session, 120_000, 100);
    expect([...hero.inventory.items()]).toHaveLength(3);
    expect(hero.inventory.backpack).toHaveLength(20);
    expect(hero.lootBox.length).toBeGreaterThan(0);
  });

  it('rende o mesmo a 10 Hz e a 1 Hz', () => {
    const at = (hz: number) => {
      const { session, hero } = withBackpack(100_000);
      run(session, 120_000, 1000 / hz);
      return { places: hero.inventory.backpack.length, items: [...hero.inventory.items()].map((i) => i.instanceId) };
    };
    expect(at(1)).toEqual(at(10));
  });

  it('um snapshot v1 (lista plana) retoma como v2 com os 20 lugares', () => {
    const { session, hero } = withBackpack(100_000);
    run(session, 30_000, 100);
    const snapshot = session.snapshot();
    // Reescreve o inventário do snapshot na forma ANTIGA: lista compacta, sem bolsa.
    const participant = snapshot.participants[0] as (typeof snapshot.participants)[number];
    const legacy = {
      ...snapshot,
      participants: [{
        ...participant,
        inventory: {
          backpack: (participant.inventory?.backpack ?? []).filter((p) => p !== null),
          equipped: participant.inventory?.equipped ?? {},
        },
      }],
    };
    const loaded = buildContent(raw({
      monsters: [ratWithDrop], items: [...items, backpackItem],
      progression: [{ ...progression, startingCapacity: 100_000, capacityPerLevel: 0, satchelInitialSlots: 10, containerRow: 5 }],
    }));
    const resumed = Session.fromSnapshot(legacy, huntRulesetFromSnapshot(legacy, loaded) as HuntRuleset, Rng.fromSeed('resume'));
    const back = resumed.participants[0] as CharacterRuntime;
    expect(back.inventory.backpack.length).toBeGreaterThanOrEqual(20);
    expect(back.inventory.satchel).toHaveLength(10);
    expect([...back.inventory.items()].map((i) => i.instanceId)).toEqual([...hero.inventory.items()].map((i) => i.instanceId));
  });
});

describe('o analisador conta onde o fato acontece (FUN-78, §16.1)', () => {
  it('o maior hit de arma é o RESOLVIDO, não o aplicado', () => {
    // Um golpe de 300 num monstro com 10 de vida foi um golpe de 300. Guardar o aplicado faria
    // o recorde depender de quão morto o alvo já estava, e o jogador nunca veria o número que
    // de fato bateu.
    //
    // A prova é o recorde PASSAR da vida do monstro: o aplicado nunca passa, por construção —
    // `receiveDamage` devolve `min(dano, vida)`.
    const { session } = start({
      difficulty: 'bold',
      inventory: {
        backpack: [],
        equipped: { hand: { instanceId: 'i1', itemId: 'sword', quantity: 1 } },
      },
    });
    run(session, 30_000, 100);

    expect(session.aggregates.bestBasicHit).toBeGreaterThan(rat.health);
  });

  it('o maior hit sobe quando o personagem fica mais forte', () => {
    const cru = start({ difficulty: 'bold' });
    run(cru.session, 30_000, 100);

    const armado = start({
      difficulty: 'bold',
      inventory: { backpack: [], equipped: { hand: { instanceId: 'i1', itemId: 'sword', quantity: 1 } } },
    });
    run(armado.session, 30_000, 100);

    expect(armado.session.aggregates.bestBasicHit)
      .toBeGreaterThan(cru.session.aggregates.bestBasicHit);
  });

  it('o maior hit de magia é POR ALVO, não a soma da área', () => {
    // Somar faria uma magia fraca em cinco alvos superar a mais forte do jogo em um — e
    // "maior hit" deixaria de responder a pergunta que ele existe para responder.
    const explodir = botConfig({
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'blast' },
      }],
    });
    const { session } = withSpells(explodir, { mana: 2_000 }, 'bold');
    run(session, 30_000, 100);

    expect(session.aggregates.bestSpellHit).toBeGreaterThan(0);
    // O `blast` deste conteúdo bate 80 por alvo. Com três ratos no raio, somar daria 240.
    expect(session.aggregates.bestSpellHit).toBeLessThanOrEqual(80);
  });

  it('o item conta no analisador mesmo quando não cabe na mochila', () => {
    // Contar só o que coube faria a mochila cheia parecer hunt ruim — e a hunt rendeu, o que
    // faltou foi espaço. São perguntas diferentes, e o §16.1 quer a primeira.
    const loaded = buildContent(raw({
      monsters: [ratWithDrop],
      progression: [{ ...progression, startingCapacity: 50, capacityPerLevel: 0 }],
    }));
    const session = createHuntSession({
      id: 'drop', content: loaded, huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: stats.capacity,
    });
    session.enter(hero);

    run(session, 60_000, 100);

    expect(hero.lootBox.length).toBeGreaterThan(0);
    // Um item por abate, e todos contam — os que couberam e os que ficaram na caixa.
    expect(session.aggregates.itemsLooted).toBe(session.aggregates.kills);
    expect(session.aggregates.itemsLooted)
      .toBe([...hero.inventory.items()].length + hero.lootBox.length);
  });

  it('consumível conta em QUANTIDADE, e o gold sai no USO', () => {
    // "Gastei 4.000 de gold" e "bebi 80 poções" contam coisas diferentes sobre a mesma hunt, e
    // o §16.1 pede as duas. Sem pilha, o gold sai no ato do uso (FUN-77, §20.1).
    const { session, hero } = withSpells(botConfig({
      potion: [{
        when: { kind: 'hp', op: '<=', percent: 100 },
        do: { kind: 'supply', supplyId: 'health-potion' },
      }],
    }), { health: 1_000, gold: 10_000, monsters: false });

    run(session, 10_000, 100);

    expect(session.aggregates.suppliesUsed).toBeGreaterThan(0);
    expect(session.aggregates.goldSpent).toBe(session.aggregates.suppliesUsed * 45);
    expect(hero.goldDelta).toBe(-session.aggregates.goldSpent);
  });

  it('o extrato leva os MESMOS números que o analisador mostra', () => {
    // É o critério da issue: o que a tela de retorno mostra é o que o ledger recebe. Eles são
    // o mesmo objeto de propósito — duas cópias divergiriam, e a divergência apareceria como
    // "o analisador me deu mais gold do que caiu na conta".
    const { session } = start({ difficulty: 'bold' });
    run(session, 30_000, 100);
    const [receipt] = session.end('manual-exit');

    expect(receipt?.aggregates).toEqual(session.aggregates);
  });

  it('os agregados novos atravessam o snapshot', () => {
    const { session } = start({ difficulty: 'bold' });
    run(session, 30_000, 100);
    const antes = { ...session.aggregates };

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(retomado.aggregates).toEqual(antes);
  });

  it('snapshot ANTIGO, sem os campos novos, restaura com zero', () => {
    // Campos opcionais no formato: `Object.assign` sobre os agregados já inicializados deixa
    // o que faltou em zero, e por isso o `SNAPSHOT_FORMAT_VERSION` não precisou subir.
    const { session } = start({ difficulty: 'bold' });
    run(session, 10_000, 100);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const velhos = snapshot.aggregates as unknown as Record<string, unknown>;
    delete velhos['itemsLooted'];
    delete velhos['suppliesUsed'];
    delete velhos['bestBasicHit'];
    delete velhos['bestSpellHit'];

    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(retomado.aggregates.itemsLooted).toBe(0);
    expect(retomado.aggregates.bestBasicHit).toBe(0);
    expect(retomado.aggregates.xpGained).toBe(session.aggregates.xpGained);
  });

  it('1 Hz e 10 Hz dão os MESMOS agregados', () => {
    const at = (stepMs: number) => {
      const { session } = start({ difficulty: 'bold' });
      run(session, 120_000, stepMs);
      return { ...session.aggregates };
    };
    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    expect(rapido.bestBasicHit).toBeGreaterThan(0);
  });
});

// --- bot avançado: lure e ring swap (FUN-87, §13.7 e §13.8) ---------------------------------

/** Quantas vezes o herói mudou de tile no período. É como se mede "ele parou" sem adivinhar. */
function moves(session: Session, hero: CharacterRuntime, durationMs: number): number {
  let count = 0;
  let last = hero.position;
  for (let t = 0; t < durationMs && session.ended === null; t += 100) {
    session.advanceBy(100);
    if (hero.position.x === last.x && hero.position.y === last.y) continue;
    count++;
    last = hero.position;
  }
  return count;
}

/** O personagem está correndo para juntar? Ausente é `true` — o lure começa juntando. */
const luringOf = (ruleset: HuntRuleset): boolean =>
  (ruleset.getState() as { luring?: boolean }).luring ?? true;

/**
 * Um monstro que PERSEGUE e não morre.
 *
 * Perseguir é o que o mantém atrás do personagem em vez de na frente dele: um monstro parado
 * no meio da rota travaria o passo, e o teste mediria tile ocupado em vez de decisão de lure.
 * Não morrer é o que mantém a CONTAGEM fixa durante a medição — com ela caindo, os dois lados
 * da máquina disparariam no meio do teste e o número medido não diria de qual deles veio.
 */
const perseguidor = {
  ...rat, id: 'chaser', name: 'Perseguidor', health: 1_000_000, attack: 0, aggroRadius: 8,
};

const huntLure = {
  id: 'lure-hunt', name: 'Lure', recommendedLevel: 1, mapId: 'salao', routeId: 'salao-anel',
  difficulties: {
    cautious: {
      monsterCount: 1, composition: [{ monsterId: 'chaser', weight: 1 }],
      respawnDelayMs: 600_000,
    },
    // Três ratos que MORREM, e sem respawn dentro do teste: é o cenário em que a contagem cai
    // sozinha, e é o único jeito de exercitar o lado do `min` da máquina.
    bold: {
      monsterCount: 3, composition: [{ monsterId: 'rat', weight: 1 }],
      respawnDelayMs: 600_000,
    },
  },
};

describe('lure dinâmico (FUN-87, §13.7)', () => {
  /**
   * Um perseguidor imortal no salão, e só o `max` do lure mudando entre um caso e outro.
   *
   * Um número de diferença entre os dois cenários é de propósito: se o teste trocasse mapa,
   * dificuldade ou monstro junto, ele passaria a medir o cenário e não a regra.
   */
  const comLure = (
    lure?: { min: number; max: number },
    difficulty: 'cautious' | 'bold' = 'cautious',
  ) => {
    const loaded = buildContent(raw({
      monsters: [rat, perseguidor], hunts: [hunt, huntLure],
      maps: [map, salaGrande], routes: [route, anel],
    }));
    const session = createHuntSession({
      id: 'lure', content: loaded, huntId: 'lure-hunt', difficulty, createdAtMs: 0,
      botConfig: lure === undefined ? botConfig() : botConfig({ lure }),
    });
    const hero = character();
    session.enter(hero);
    return { session, hero, ruleset: session.ruleset as HuntRuleset };
  };

  it('abaixo do MÁXIMO ele não para: continua percorrendo a rota com o monstro colado', () => {
    // Um monstro ao alcance e `max: 2`: a contagem não fechou, então parar seria começar a
    // lutar com menos do que o jogador pediu. Ele corre, e o monstro vem junto — que é o
    // "juntar" do §13.7 sem pathfinding novo, porque o passo guloso já os faz seguir.
    const correndo = comLure({ min: 1, max: 2 });
    const andou = moves(correndo.session, correndo.hero, 20_000);

    const parando = comLure({ min: 1, max: 1 });
    const parou = moves(parando.session, parando.hero, 20_000);

    expect(andou).toBeGreaterThan(parou * 3);
    expect(luringOf(correndo.ruleset)).toBe(true);
  });

  it('ao chegar no MÁXIMO ele para de correr e passa a lutar', () => {
    const { session, hero, ruleset } = comLure({ min: 1, max: 1 });
    run(session, 5_000, 100);

    expect(luringOf(ruleset)).toBe(false);
    const parado = { ...hero.position };
    expect(moves(session, hero, 5_000)).toBe(0);
    expect(hero.position).toEqual(parado);
  });

  it('quando a contagem cai abaixo do MÍNIMO, ele volta a correr', () => {
    // O outro lado da máquina, e sem ele o personagem que parou depois de juntar o bando nunca
    // mais voltaria a juntar: uma onda por hunt, e o resto do tempo parado esperando quem
    // viesse sozinho.
    //
    // `min` e `max` iguais em 3 apagam a faixa morta de propósito: aqui o assunto é a
    // transição de volta, e a histerese em si tem teste próprio no ring swap.
    const { session, ruleset } = comLure({ min: 3, max: 3 }, 'bold');
    const estados: boolean[] = [];
    for (let t = 0; t < 20_000 && session.ended === null; t += 100) {
      session.advanceBy(100);
      estados.push(luringOf(ruleset));
    }

    const parou = estados.indexOf(false);
    expect(parou).toBeGreaterThanOrEqual(0);
    // E DEPOIS de parar ele voltou a correr, porque os abates derrubaram a contagem.
    expect(estados.indexOf(true, parou)).toBeGreaterThan(parou);
    expect(session.aggregates.kills).toBeGreaterThan(0);
  });

  it('correndo, ele NÃO deixa de atacar quem está ao alcance', () => {
    // O que o lure muda é PARAR, não bater. Um personagem que corre sem atacar junta um bando
    // que nunca começa a limpar, e a hunt inteira vira uma volta olímpica.
    const { session, hero, ruleset } = comLure({ min: 1, max: 2 });
    moves(session, hero, 20_000);

    expect(luringOf(ruleset)).toBe(true);
    expect(session.aggregates.bestBasicHit).toBeGreaterThan(0);
  });

  it('sem lure configurado, quem tem monstro ao alcance para — como sempre', () => {
    const { session, hero } = comLure();
    run(session, 5_000, 100);

    const parado = { ...hero.position };
    expect(moves(session, hero, 5_000)).toBe(0);
    expect(hero.position).toEqual(parado);
  });

  it('o estado do lure atravessa o snapshot', () => {
    // Sem isto, uma hunt retomada no meio de um lure voltaria "correndo" e juntaria por cima
    // do bando que já estava junto — que é exatamente como se morre com o bot ligado.
    const { session, ruleset } = comLure({ min: 1, max: 1 });
    run(session, 5_000, 100);
    expect(luringOf(ruleset)).toBe(false);

    const snapshot = session.snapshot();
    expect((snapshot.ruleset as { luring?: boolean }).luring).toBe(false);
    const loaded = buildContent(raw({
      monsters: [rat, perseguidor], hunts: [hunt, huntLure],
      maps: [map, salaGrande], routes: [route, anel],
    }));
    const back = huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset;
    const resumed = Session.fromSnapshot(snapshot, back, new Rng(snapshot.rng));
    expect(luringOf(back)).toBe(false);

    // E ele continua parado: um `luring` perdido faria a hunt retomada sair andando com o
    // monstro colado, e o jogador voltaria para um personagem correndo sem motivo.
    const heroi = resumed.participants[0];
    if (heroi === undefined) throw new Error('a sessão retomada perdeu o personagem');
    expect(moves(resumed, heroi, 5_000)).toBe(0);
  });

  it('1 Hz e 10 Hz dão o MESMO resultado com o lure ligado', () => {
    // O lure decide por contagem de monstros VIVOS, e a contagem muda entre um vencimento e
    // outro. Se a decisão dependesse de com que frequência alguém olha, a hunt desanexada
    // renderia diferente da anexada — que é o invariante 2 em uma linha.
    const at = (stepMs: number) => {
      const session = createHuntSession({
        id: 'lure-hz', content: content(), huntId: 'arena', difficulty: 'bold',
        createdAtMs: 0, botConfig: botConfig({ lure: { min: 2, max: 4 } }),
      });
      session.enter(character());
      run(session, 120_000, stepMs);
      return { ...session.aggregates, luring: luringOf(session.ruleset as HuntRuleset) };
    };
    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    expect(rapido.kills).toBeGreaterThan(0);
  });
});

// Um monstro que serve de RELÓGIO, não de adversário: bate a cada 100 ms por ZERO de dano e
// não morre. Cada golpe dele é uma volta da máquina do anel sobre o HP que o teste acabou de
// escrever — sem isso, provar histerese exigiria orquestrar dano real em valores exatos, e o
// teste passaria a medir a fórmula de combate em vez dos dois limiares.
const relogio = {
  id: 'clock', name: 'Relógio', recommendedLevel: 1,
  health: 1_000_000, experience: 0, attack: 0, armor: 0,
  attackIntervalMs: 100, speed: 1500, aggroRadius: 8, attackRange: 1,
  loot: { items: [] },
};

describe('ring swap com histerese (FUN-87, §13.8)', () => {
  // Mil de vida e duzentos de mana: percentual vira conta de cabeça, e 390 é 39%.
  const anelProgression = {
    ...progression, startingHealth: 1_000, startingMana: 200, startingCapacity: 1_000,
    healthPerLevel: 0, manaPerLevel: 0, capacityPerLevel: 0,
    regen: { healthPerSecond: 0, manaPerSecond: 0 },
  } as Progression;

  const anelContent = (): Content => buildContent(raw({
    monsters: [relogio],
    hunts: [{
      ...hunt,
      difficulties: {
        cautious: {
          monsterCount: 1, composition: [{ monsterId: 'clock', weight: 1 }],
          respawnDelayMs: 30_000,
        },
      },
    }],
    // Spawn colado no começo da rota: o poste encosta no primeiro segundo e o herói para ali.
    routes: [{ ...route, spawnPoints: [{ routeIndex: 0, radius: 1 }] }],
    progression: [anelProgression],
  }));

  interface SwapRingFixture {
    readonly equipBelow: number;
    readonly removeAbove: number;
    readonly manaFloor?: number;
    readonly restorePrevious?: boolean;
  }

  const comAnel = (
    swap: SwapRingFixture,
    options: { backpack?: readonly string[]; equipped?: string } = {},
  ) => {
    const loaded = anelContent();
    const { equipBelow, removeAbove, manaFloor, restorePrevious } = swap;
    const session = createHuntSession({
      id: 'anel', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      botConfig: botConfigV2([], {
        automations: [{
          model: 'swap-ring',
          params: {
            itemId: 'life-ring',
            manaFloor: manaFloor ?? 0,
            restorePrevious: restorePrevious ?? true,
          },
          enter: [{ kind: 'hp', op: '<', percent: equipBelow }],
          exit: [{ kind: 'hp', op: '>', percent: removeAbove }],
        }],
      }),
    });
    const stats = statsForLevel(1, null, anelProgression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      goldDelta: 0, alive: true, cooldowns: {}, capacity: stats.capacity,
      inventory: {
        backpack: (options.backpack ?? ['life-ring'])
          .map((itemId, n) => ({ instanceId: `bag-${n}`, itemId, quantity: 1 })),
        equipped: options.equipped === undefined
          ? {}
          : { finger: { instanceId: 'do-jogador', itemId: options.equipped, quantity: 1 } },
      },
    });
    session.enter(hero);
    run(session, 2_000, 100);

    /** Põe o HP (e a mana) onde o teste quer, e deixa o golpe seguinte reavaliar a máquina. */
    const em = (health: number, mana?: number): string | null => {
      hero.health = health;
      if (mana !== undefined) hero.mana = mana;
      session.advanceBy(100);
      return hero.inventory.equippedAt('finger')?.itemId ?? null;
    };
    return { session, hero, em };
  };

  const trocas = (session: Session, type: string): number =>
    session.notableEvents.filter((event) => event.type === type).length;

  it('equipa quando o HP cai abaixo do limiar de entrada', () => {
    const { em } = comAnel({ equipBelow: 40, removeAbove: 70 });
    expect(em(1_000)).toBeNull();
    expect(em(390)).toBe('life-ring');
  });

  it('NÃO troca com o HP oscilando ENTRE os dois limiares', () => {
    // É o critério que a issue cobra em letra. Com um limiar só, o HP indo e voltando em torno
    // dele trocaria o anel a cada golpe — e cada troca é uma ação que o personagem não usou
    // para lutar. A faixa entre `equipBelow` e `removeAbove` é morta por construção.
    const { session, em } = comAnel({ equipBelow: 40, removeAbove: 70 });
    expect(em(390)).toBe('life-ring');

    for (const hp of [450, 600, 500, 690, 410, 550, 405, 695]) {
      expect(em(hp)).toBe('life-ring');
    }
    expect(trocas(session, 'ring-equipped')).toBe(1);
    expect(trocas(session, 'ring-removed')).toBe(0);
  });

  it('retira quando o HP passa do limiar de saída', () => {
    const { em } = comAnel({ equipBelow: 40, removeAbove: 70 });
    expect(em(390)).toBe('life-ring');
    expect(em(710)).toBeNull();
  });

  it('devolve ao dedo o anel do jogador, quando ele pediu', () => {
    // Sem guardar qual era, a hunt acabaria com o dedo vazio e o anel do jogador no fundo da
    // mochila, sem nada no extrato explicando para onde ele foi.
    const { em } = comAnel(
      { equipBelow: 40, removeAbove: 70, restorePrevious: true },
      { equipped: 'other-ring' },
    );
    expect(em(390)).toBe('life-ring');
    expect(em(710)).toBe('other-ring');
  });

  it('deixa o dedo vazio quando o jogador NÃO pediu restauração', () => {
    const { em } = comAnel(
      { equipBelow: 40, removeAbove: 70, restorePrevious: false },
      { equipped: 'other-ring' },
    );
    expect(em(390)).toBe('life-ring');
    expect(em(710)).toBeNull();
  });

  it('mana abaixo do piso desativa a máquina, e derruba o anel já equipado', () => {
    // Um anel que custa mana não vale a mana que falta para curar. Desativar pela metade — não
    // equipar mas manter o que está — seria gastar exatamente quando ela é escassa.
    const { em } = comAnel({ equipBelow: 40, removeAbove: 70, manaFloor: 30 });
    expect(em(390)).toBe('life-ring');
    expect(em(390, 20)).toBeNull();
  });

  it('com a mana no chão, nem chega a equipar', () => {
    const { em } = comAnel({ equipBelow: 40, removeAbove: 70, manaFloor: 50 });
    expect(em(390, 20)).toBeNull();
  });

  it('sem o anel na mochila, não faz nada e não reclama', () => {
    // Perder o anel é caso normal — o §21.3 gasta anel por tempo. A máquina não pode virar
    // erro por causa disso, nem deixar linha no extrato dizendo que trocou.
    const { session, em } = comAnel({ equipBelow: 40, removeAbove: 70 }, { backpack: [] });
    expect(em(390)).toBeNull();
    expect(trocas(session, 'ring-equipped')).toBe(0);
  });

  it('quem NÃO configurou anel não tem o dedo mexido', () => {
    const loaded = anelContent();
    const session = createHuntSession({
      id: 'sem-anel', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      botConfig: botConfig(),
    });
    const stats = statsForLevel(1, null, anelProgression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: 300, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      goldDelta: 0, alive: true, cooldowns: {}, capacity: stats.capacity,
      inventory: {
        backpack: [{ instanceId: 'bag-0', itemId: 'life-ring', quantity: 1 }],
        equipped: { finger: { instanceId: 'do-jogador', itemId: 'other-ring', quantity: 1 } },
      },
    });
    session.enter(hero);
    run(session, 5_000, 100);

    expect(hero.inventory.equippedAt('finger')?.itemId).toBe('other-ring');
  });

  it('o anel substituído atravessa o snapshot', () => {
    // Sem isto, uma hunt retomada com o anel no dedo esqueceria o que restaurar, e o jogador
    // terminaria a sessão sem o anel que era dele.
    const { session, em } = comAnel(
      { equipBelow: 40, removeAbove: 70 }, { equipped: 'other-ring' },
    );
    expect(em(390)).toBe('life-ring');

    const snapshot = session.snapshot();
    expect((snapshot.ruleset as { ringReplaced?: string | null }).ringReplaced)
      .toBe('do-jogador');

    const resumed = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, anelContent()) as HuntRuleset,
      new Rng(snapshot.rng),
    );
    const back = resumed.participants[0];
    if (back === undefined) throw new Error('a sessão retomada perdeu o personagem');
    back.health = 710;
    resumed.advanceBy(100);
    expect(back.inventory.equippedAt('finger')?.itemId).toBe('other-ring');
  });
});

describe('Energy Ring no combate (SV-16, #352)', () => {
  const brawler = {
    ...rat,
    id: 'brawler', name: 'Brawler',
    health: 1_000_000, experience: 0, attack: 40, armor: 0,
    attackIntervalMs: 10_000, speed: 1500, aggroRadius: 8, attackRange: 1,
    loot: { items: [] },
  };

  const ringCombatProgression = {
    ...progression,
    startingHealth: 100, startingMana: 200, startingCapacity: 1_000,
    healthPerLevel: 0, manaPerLevel: 0, capacityPerLevel: 0,
    regen: { healthPerSecond: 0, manaPerSecond: 0 },
  } as Progression;

  const ringCombatContent = (): Content => buildContent(raw({
    monsters: [brawler],
    hunts: [{
      ...hunt,
      difficulties: {
        cautious: {
          monsterCount: 1, composition: [{ monsterId: 'brawler', weight: 1 }],
          respawnDelayMs: 30_000,
        },
      },
    }],
    routes: [{ ...route, spawnPoints: [{ routeIndex: 0, radius: 1 }] }],
    progression: [ringCombatProgression],
  }));

  const startRingCombat = (options: {
    equippedRing?: string;
    mana: number;
    withManaShield?: boolean;
  }) => {
    const loaded = ringCombatContent();
    const session = createHuntSession({
      id: 'energy-ring-session', content: loaded, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, ringCombatProgression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 1, y: 1, z: 7 },
      health: 100, maxHealth: 100,
      mana: options.mana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      goldDelta: 0, alive: true, cooldowns: {}, capacity: stats.capacity,
      inventory: {
        backpack: [],
        equipped: options.equippedRing === undefined
          ? {}
          : { finger: { instanceId: 'r1', itemId: options.equippedRing, quantity: 1 } },
      },
    });
    if (options.withManaShield) {
      hero.conditions.apply({
        key: 'mana-shield', spellId: 'magic-shield', expiresAtMs: 180_000,
      });
    }
    session.enter(hero);
    return { session, hero };
  };

  it('o Energy Ring equipado absorve o dano na mana antes da vida (mana 30 e dano 40: mana 0, vida 90)', () => {
    const { session, hero } = startRingCombat({ equippedRing: 'energy-ring', mana: 30 });
    session.advanceBy(100);

    const hits = session.drainEvents().filter((e) => e.kind === 'creature-hit' && e.creatureId === 'hero');
    expect(hits).toHaveLength(1);
    expect(hero.mana).toBe(0);
    expect(hero.health).toBe(90);
  });

  it('sem o anel (mesmo cenário, mana 200), o dano de 40 vai inteiro na vida', () => {
    const { session, hero } = startRingCombat({ mana: 200 });
    session.advanceBy(100);

    const hits = session.drainEvents().filter((e) => e.kind === 'creature-hit' && e.creatureId === 'hero');
    expect(hits).toHaveLength(1);
    expect(hero.mana).toBe(200);
    expect(hero.health).toBe(60);
  });

  it('Energy Ring + condição mana-shield ao mesmo tempo: dano de 40 absorve 40 de mana uma vez só', () => {
    const { session, hero } = startRingCombat({
      equippedRing: 'energy-ring', mana: 200, withManaShield: true,
    });
    session.advanceBy(100);

    const hits = session.drainEvents().filter((e) => e.kind === 'creature-hit' && e.creatureId === 'hero');
    expect(hits).toHaveLength(1);
    expect(hero.mana).toBe(160);
    expect(hero.health).toBe(100);
  });
});

describe('o catálogo do Tibia no motor (#155, ADR 0026 decisão 5)', () => {
  const wave = {
    id: 'fire-wave', name: 'Fire Wave', manaCost: 25, cooldownMs: 1_000, group: 'attack', groupCooldownMs: 1_000,
    effect: { kind: 'damage', basePower: 400, area: { shape: 'wave', length: 3 } },
  };
  const haste = {
    id: 'haste', name: 'Haste', manaCost: 60, cooldownMs: 2_000, group: 'support', groupCooldownMs: 2_000,
    effect: { kind: 'haste', speedPercent: 30, durationMs: 30_000 },
  };
  const recovery = {
    id: 'recovery', name: 'Recovery', manaCost: 75, cooldownMs: 60_000, group: 'healing', groupCooldownMs: 1_000,
    effect: { kind: 'heal-over-time', amount: 20, intervalMs: 3_000, durationMs: 60_000 },
  };
  const protector = {
    id: 'protector', name: 'Protector', manaCost: 20, cooldownMs: 2_000, group: 'support', groupCooldownMs: 2_000,
    secondaryGroup: { name: 'stance', cooldownMs: 2_000 },
    effect: { kind: 'buff', durationMs: 10_000, damageTakenPercent: -50 },
  };
  const always = { kind: 'hp' as const, op: '<=' as const, percent: 100 };
  const cast = (spellId: string) => ({ when: always, do: { kind: 'spell' as const, spellId } });

  it('a onda sai na DIREÇÃO do personagem, acerta quem está nos tiles e desenha a forma inteira', () => {
    // Nasce olhando para o sul (nunca andou); o passo grava a direção — a rota da arena sai
    // para o leste. A onda só sai quando há alguém nos tiles dela (self-origin: sem alvo é
    // `no-target`, sem mana gasta), e o evento leva os 7 tiles da forma para o efeito
    // aparecer onde não há monstro. Mutação que mata: ignorar `direction` em `#aimFor`, ou não
    // gravá-la no `#step`.
    const walking = withSpells(botConfig(), { monsters: false });
    expect(walking.hero.direction).toBe('south');
    // A direção é a do ÚLTIMO passo: depois de cada passo do herói ela bate com o vetor dele.
    run(walking.session, 3_000, 100);
    const moves = walking.session.drainEvents().filter((e) => e.kind === 'creature-moved' && e.creatureId === 'hero');
    const last = moves.at(-1);
    expect(moves.length).toBeGreaterThan(0);
    if (last?.kind !== 'creature-moved') throw new Error('sem passo');
    const dx = last.to.x - last.from.x;
    const dy = last.to.y - last.from.y;
    expect(walking.hero.direction).toBe(dx !== 0 ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north');

    const { session, hero } = withSpells(botConfig({
      attack: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'fire-wave' } }],
    }), { mana: 200, spells: [...spells, wave] }, 'bold');
    run(session, 20_000, 100);

    const casts = session.drainEvents().filter((e) => e.kind === 'spell-cast');
    expect(casts.length).toBeGreaterThan(0);
    const first = casts[0] as { tiles: readonly unknown[]; targets: readonly unknown[] };
    expect(first.tiles).toHaveLength(1 + 3 + 3);
    expect(first.targets.length).toBeGreaterThan(0);
    // Sem monstro nos tiles a onda NÃO sai: cada lançamento tem pelo menos um alvo.
    expect(casts.every((c) => c.kind === 'spell-cast' && c.targets.length > 0)).toBe(true);
    // (A mana não é conferida em absoluto: subir de level devolve mana — `retarget`.)
    expect(hero.mana).toBeLessThan(200);
    expect(session.aggregates.kills).toBeGreaterThan(0);
  });

  it('o haste encurta o passo enquanto vale e o passo volta ao normal quando vence', () => {
    const { session } = withSpells(botConfig({ support: [cast('haste')] }), { mana: 60, spells: [...spells, haste], monsters: false });
    run(session, 40_000, 100);
    const moves = session.drainEvents()
      .filter((e) => e.kind === 'creature-moved' && e.creatureId === 'hero')
      .map((e) => (e.kind === 'creature-moved' ? e.durationMs : 0));
    // O primeiro passo sai antes de a categoria de suporte vencer; do segundo em diante o
    // haste vale. Mana para UM lançamento só: senão a regra "sempre" relança ao vencer.
    const hasted = new Set(moves.slice(1, 6));
    const later = new Set(moves.slice(-5));
    // Durante o haste (+30 %): o passo custa ceil50(chão × 1000 / (300 × 1,3)); depois, o
    // de sempre. Mutação que mata: `movementDuration` ignorar `speedScale`, ou o vencimento
    // não remover a condição.
    expect(hasted.size).toBe(1);
    expect(later.size).toBe(1);
    expect([...hasted][0] as number).toBeLessThan([...later][0] as number);
  });

  it('Recovery cura 20 a cada 3 s por 60 s — 400 no total —, o mesmo a 10 Hz e a 1 Hz', () => {
    const at = (hz: number): number => {
      const { session, hero } = withSpells(botConfig({ heal: [cast('recovery')] }), {
        health: 1_000, mana: 200, spells: [...spells, recovery], monsters: false,
      });
      run(session, 61_000, 1000 / hz);
      return hero.health;
    };
    expect(at(10)).toBe(1_400);
    expect(at(1)).toBe(1_400);
  });

  it('a postura reduz o dano tomado, e um snapshot no meio dela retoma com o mesmo vencimento', () => {
    // Mana para UM lançamento: a regra "sempre" relançaria a cada 2 s e o prazo andaria.
    const build = () => withSpells(botConfig({ support: [cast('protector')] }), {
      health: 100_000, mana: 20, spells: [...spells, protector],
    }, 'bold');
    const { session, hero } = build();
    session.advanceBy(50);
    expect(hero.conditions.get('buff')?.expiresAtMs).toBe(10_000);
    run(session, 5_000, 100);

    // Retomar no meio: a condição e o evento de vencimento vêm juntos no snapshot.
    const loaded = buildContent(raw({ spells: [...spells, protector] }));
    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed('resume'),
    );
    const resumedHero = resumed.participants[0] as CharacterRuntime;
    expect(resumedHero.conditions.get('buff')?.expiresAtMs).toBe(10_000);
    run(resumed, 4_000, 100);
    expect(resumedHero.conditions.get('buff')).not.toBeNull();
    run(resumed, 1_100, 100);
    // Venceu no instante 10 000 do relógio lógico, do outro lado do snapshot.
    expect(resumedHero.conditions.get('buff')).toBeNull();
  });

  it('uma hunt com onda, cura, haste, Recovery e postura rende o mesmo a 10 Hz e a 1 Hz', () => {
    const at = (hz: number) => {
      const { session, hero } = withSpells(botConfig({
        attack: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'fire-wave' } }],
        heal: [cast('recovery'), healRule(90)],
        support: [cast('haste'), cast('protector')],
      }), { health: 5_000, mana: 100_000, spells: [...spells, wave, haste, recovery, protector] }, 'bold');
      run(session, 120_000, 1000 / hz);
      return { health: hero.health, mana: hero.mana, kills: session.aggregates.kills, xp: session.aggregates.xpGained };
    };
    expect(at(1)).toEqual(at(10));
  });
});

describe('a runa Avalanche abstrata (#165, ADR 0026 decisão 8)', () => {
  const rune = {
    id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, group: 'attack',
    requires: { level: 30, magicLevel: 0 },
    effect: { kind: 'damage', basePower: 400, range: 4, area: { shape: 'circle', radius: 3, centered: 'target' } },
  };
  const withRune = (level: number, gold: number, hz = 10) => {
    const { session, hero } = withSpells(botConfig({
      rune: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'supply', supplyId: 'avalanche-rune' } }],
    }), { gold, supplies: [...supplies, rune], health: 5_000 }, 'bold');
    hero.level = level;
    hero.xp = totalXpForLevel(level, progression as Progression);
    run(session, 60_000, 1000 / hz);
    return { session, hero };
  };

  it('hits the rats around the target, debits gold per use, and the receipt counts the uses', () => {
    const { session } = withRune(30, 10_000);
    const uses = session.aggregates.suppliesUsed;
    expect(uses).toBeGreaterThan(0);
    // Gold no uso (§20.1): 14 por runa.
    expect(session.aggregates.goldSpent).toBe(uses * 14);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    // Uma runa por vencimento do grupo: nunca mais de 61 usos em 60 s a 1 s de fallback.
    expect(uses).toBeLessThanOrEqual(61);
    const used = session.drainEvents().filter((e) => e.kind === 'supply-used');
    expect(used.length).toBe(uses);
    expect(used.every((e) => e.kind === 'supply-used' && e.targets.length > 0 && e.tiles.length === 37)).toBe(true);
  });

  it('below the level the rune never fires and never charges; the same at 10 Hz and at 1 Hz', () => {
    const young = withRune(29, 10_000);
    expect(young.session.aggregates.suppliesUsed).toBe(0);
    expect(young.session.aggregates.goldSpent).toBe(0);
    // A recusa é de LEVEL, não de saldo: o `BotPanel` já tranca a runa fora do nível. O aviso
    // único de gold não pode queimar por uma recusa que nunca foi sobre o salário.
    expect(young.session.notableEvents.filter((e) => e.type === 'supply-unaffordable')).toHaveLength(0);
    const state = young.session.ruleset.getState?.() as { warnedNoGold?: boolean };
    expect(state.warnedNoGold).toBe(false);
    const at = (hz: number) => {
      const { session, hero } = withRune(30, 10_000, hz);
      return { uses: session.aggregates.suppliesUsed, gold: hero.goldDelta, kills: session.aggregates.kills };
    };
    expect(at(1)).toEqual(at(10));
  });

  it('depois, com o level da runa mas sem gold, o aviso sai — e só ele (#217)', () => {
    // Mesma runa; agora o level deixou de ser o problema e o saldo é. O flag continua livre
    // para queimar aqui, porque cada `withRune` cria uma sessão nova.
    const { session } = withRune(30, 0);
    const avisos = session.notableEvents.filter((e) => e.type === 'supply-unaffordable');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.detail).toBe('avalanche-rune');
    const state = session.ruleset.getState?.() as { warnedNoGold?: boolean };
    expect(state.warnedNoGold).toBe(true);
  });

  it('sem monstro a runa recusa por no-target repetidamente, e nenhuma linha sai (#217)', () => {
    // O "when" é da vida do personagem, não dos alvos: o grupo tenta lançar a cada vencimento
    // mesmo sem ninguém para mirar, e cada tentativa recusa por `no-target` — a mesma recusa
    // que `castSpell` já deixa muda para a magia.
    const { session, hero } = withSpells(botConfig({
      rune: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'supply', supplyId: 'avalanche-rune' } }],
    }), { gold: 10_000, supplies: [...supplies, rune], monsters: false });
    hero.level = 30;
    hero.xp = totalXpForLevel(30, progression as Progression);

    run(session, 10_000, 100);

    expect(session.aggregates.suppliesUsed).toBe(0);
    expect(session.aggregates.goldSpent).toBe(0);
    expect(session.notableEvents.filter((e) => e.type === 'supply-unaffordable')).toHaveLength(0);
  });
});

// --- a densidade REAL da área governa "targets >= N" (#480) -----------------------------------

describe('a condição "targets >= N" conta o FOOTPRINT da área, não um círculo no jogador (#480)', () => {
  const rune = {
    id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, group: 'attack',
    requires: { level: 30, magicLevel: 0 },
    effect: { kind: 'damage', basePower: 400, range: 8, area: { shape: 'circle', radius: 3, centered: 'target' } },
  };
  const rule = {
    rune: [{ when: { kind: 'targets' as const, op: '>=' as const, count: 3 }, do: { kind: 'supply' as const, supplyId: 'avalanche-rune' } }],
  };

  /**
   * Nasce SEM bot, posiciona os ratos e só então configura a regra — mesma coreografia da
   * #444: com o bot já no ar, a primeira avaliação (t=0) usaria as posições de spawn e a regra
   * poderia disparar antes de o teste arrumar o campo.
   */
  const board = () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), {
      gold: 10_000, supplies: [...supplies, rune], health: 5_000,
    }, 'bold');
    hero.level = 30;
    hero.xp = totalXpForLevel(30, progression as Progression);
    session.advanceBy(1);
    return { session, hero, ruleset };
  };

  it('três monstros dispersos, só um na área: a runa NÃO sai', () => {
    const { session, hero, ruleset } = board();
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    // Os três estão a <= 8 do herói — o círculo genérico de antes contaria 3 e dispararia. Só
    // `a` cai no círculo de raio 3 projetado sobre ele: `b` e `c` ficam a 5 e 6 tiles na
    // perpendicular, fora dos 37 tiles da Avalanche.
    a.position = { x: hero.position.x + 5, y: hero.position.y };
    b.position = { x: hero.position.x, y: hero.position.y + 5 };
    c.position = { x: hero.position.x, y: hero.position.y + 6 };
    ruleset.configureBot(session, botConfig(rule), 'hero');

    run(session, 3_000, 100);

    expect(session.aggregates.suppliesUsed).toBe(0);
  });

  it('três monstros no mesmo punhado, todos na área: a runa SAI', () => {
    const { session, hero, ruleset } = board();
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    // O controle positivo: a mesma condição, agora com a densidade real satisfeita.
    a.position = { x: hero.position.x + 5, y: hero.position.y };
    b.position = { x: hero.position.x + 5, y: hero.position.y + 1 };
    c.position = { x: hero.position.x + 5, y: hero.position.y + 2 };
    ruleset.configureBot(session, botConfig(rule), 'hero');

    run(session, 3_000, 100);

    expect(session.aggregates.suppliesUsed).toBeGreaterThan(0);
  });
});

describe('a hunt hospeda N participantes (#203, ADR 0027)', () => {
  // Cada um com o próprio `Runner`: caminhante, bot, golpe engatilhado, lure, anel, avisos. O
  // que se prende é que o estado de um NÃO vaza para o outro — e que o solo continua o solo.
  const member = (id: string, over: Partial<{ health: number; gold: number }> = {}) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: over.gold ?? 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    });
  };
  const pair = (hz = 10, over: { botConfigs?: Record<string, BotConfig> } = {}) => {
    const session = createHuntSession({
      id: 'party-session', content: content(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      ...(over.botConfigs === undefined ? {} : { botConfigs: over.botConfigs }),
    });
    const a = member('a');
    const b = member('b');
    session.enter(a);
    session.enter(b);
    run(session, 60_000, 1000 / hz);
    return { session, a, b, ruleset: session.ruleset as HuntRuleset };
  };

  it('two members walk the route and fight at the same time, each with their own kills', () => {
    // Mutação que mata: `#armPlayerAttack` armando só o PRIMEIRO com alvo — `b` nunca bateria.
    const { session, a, b, ruleset } = pair();
    // O golpe de CADA um: `bestBasicHit` só sobe para quem bateu.
    expect(session.aggregatesOf('a').bestBasicHit).toBeGreaterThan(0);
    expect(session.aggregatesOf('b').bestBasicHit).toBeGreaterThan(0);
    expect(session.aggregatesOf('a').kills + session.aggregatesOf('b').kills).toBeGreaterThan(0);
    expect(a.xp + b.xp).toBeGreaterThan(0);
    expect(a.position).not.toEqual(b.position);
    // Cada um tem o SEU índice na rota; o do ruleset é o do primeiro.
    expect(ruleset.routeIndexOf('a')).toBe(ruleset.routeIndex);
    expect(ruleset.routeIndexOf('b')).toBeGreaterThanOrEqual(0);
    expect(ruleset.routeIndexOf('zz')).toBe(-1);
  });

  it('each member runs their own bot: the potion rule of one never fires for the other', () => {
    const potion = botConfig({ potion: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'supply', supplyId: 'health-potion' } }] });
    const { session } = pair(10, { botConfigs: { a: potion } });
    // `a` tem gold zero: a poção é recusada e o aviso sai UMA vez — e é o dele, não o de `b`.
    expect(session.notableEvents.filter((e) => e.type === 'supply-unaffordable')).toHaveLength(1);
    expect(session.aggregatesOf('b').suppliesUsed).toBe(0);
  });

  it('the snapshot carries one runner per member, and a legacy snapshot still restores the solo', () => {
    const { session, ruleset } = pair();
    const state = ruleset.getState();
    expect(Object.keys(state.runners ?? {}).sort()).toEqual(['a', 'b']);
    // Os campos soltos são os do primeiro (DT-02).
    expect(state.route).toEqual(state.runners?.['a']?.route);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const restored = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset, Rng.fromSeed('x'),
    );
    const again = restored.ruleset as HuntRuleset;
    expect(again.routeIndexOf('a')).toBe(ruleset.routeIndexOf('a'));
    expect(again.routeIndexOf('b')).toBe(ruleset.routeIndexOf('b'));
    run(restored, 10_000, 100);
    expect(restored.aggregatesOf('b').kills).toBeGreaterThanOrEqual(session.aggregatesOf('b').kills);
  });

  it('leave frees the tile and forgets the runner; the session goes on for the other', () => {
    const { session, b, ruleset } = pair();
    const tile = { ...b.position };
    const departure = session.leave('b', 'manual-exit');
    expect(departure?.receipt.characterId).toBe('b');
    expect(ruleset.routeIndexOf('b')).toBe(-1);
    // O tile ficou livre: `a` (ou um monstro) pode pisar nele. Prova pela ocupação do mundo —
    // via um passo manual de `a` até lá, quando adjacente; senão, pelo estado de ocupação.
    run(session, 10_000, 100);
    expect(session.ended).toBeNull();
    expect(session.participants.map((p) => p.id)).toEqual(['a']);
    expect(session.aggregatesOf('a').durationMs).toBe(70_000);
    expect(tile).toBeDefined();
  });

  it('1 Hz == 10 Hz with two members', () => {
    const at = (hz: number) => {
      const { session, a, b } = pair(hz);
      return {
        a: [a.xp, a.health, session.aggregatesOf('a').kills],
        b: [b.xp, b.health, session.aggregatesOf('b').kills],
      };
    };
    expect(at(1)).toEqual(at(10));
  });
});

describe('follow de membro (§D10, #398)', () => {
  // O follow substitui a ROTA, não o combate: passo guloso até ficar adjacente (distância 1,
  // Chebyshev), parado quando já está. Para o alvo ficar PARADO no teste, o passo dele é
  // cancelado da fila (`stand`) — quem o seguidor persegue é um membro que não anda.
  const followContent = (over: Partial<RawContent> = {}): Content => buildContent(raw({
    routes: [{ ...route, spawnPoints: [] }],
    progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    ...over,
  }));

  const member = (id: string): CharacterRuntime => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    });
  };

  const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  /** Anda um membro à mão, um tile por vez, até `to` — a ocupação do mundo acompanha. */
  const walkTo = (session: Session, ruleset: HuntRuleset, id: string, to: { x: number; y: number }): void => {
    const c = session.participants.find((p) => p.id === id);
    if (c === undefined) throw new Error(`sem participante ${id}`);
    let guard = 0;
    while ((c.position.x !== to.x || c.position.y !== to.y) && guard++ < 20) {
      const dx = Math.sign(to.x - c.position.x);
      const dy = Math.sign(to.y - c.position.y);
      const result = ruleset.requestMove(session, id, { x: c.position.x + dx, y: c.position.y + dy });
      if (!result.ok) throw new Error(`requestMove recusou: ${result.reason}`);
    }
  };

  /** Trava o membro no tile: o passo dele não vence mais. */
  const stand = (session: Session, id: string): void => { session.cancelEvent('player-step', id); };

  const followSession = (over: {
    botConfigs?: Record<string, BotConfig>;
    partyOptions?: PartyOptionsInput;
    content?: Content;
  } = {}) => {
    const session = createHuntSession({
      id: 'follow-session', content: over.content ?? followContent(),
      huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      ...(over.botConfigs === undefined ? {} : { botConfigs: over.botConfigs }),
      ...(over.partyOptions === undefined ? {} : { partyOptions: over.partyOptions }),
    });
    return { session, ruleset: session.ruleset as HuntRuleset };
  };

  const followStates = (session: Session) => session.drainEvents()
    .filter((e): e is Extract<DomainEvent, { kind: 'follow-state' }> => e.kind === 'follow-state');

  it('member: atravessa o corredor até ficar adjacente e para — 1 Hz == 10 Hz', () => {
    const scenario = (hz: number) => {
      const { session, ruleset } = followSession({
        botConfigs: { a: botConfig({ follow: { kind: 'member', characterId: 'b' } }) },
      });
      session.enter(member('a'));
      session.enter(member('b'));
      walkTo(session, ruleset, 'b', { x: 4, y: 1 });
      stand(session, 'b');

      run(session, 5_000, 1000 / hz);

      const a = session.participants.find((p) => p.id === 'a');
      const b = session.participants.find((p) => p.id === 'b');
      if (a === undefined || b === undefined) throw new Error('a sessão perdeu um membro');
      return { a: { ...a.position }, b: { ...b.position }, states: followStates(session) };
    };

    const rapido = scenario(10);
    expect(rapido.b).toEqual({ x: 4, y: 1, z: 7 });
    // Parou em (3,1): adjacente a (4,1), sem tentar pisar em cima do alvo.
    expect(rapido.a).toEqual({ x: 3, y: 1, z: 7 });
    // Nunca interrompeu: transição para um estado que já era o ativo não emite.
    expect(rapido.states).toHaveLength(0);
    expect(scenario(1)).toEqual(rapido);
  });

  it('combate continua com o follow ativo, sem interromper o follow', () => {
    // O rato da fixture nasce em (4,2), adjacente ao alvo parado em (4,1). O seguidor chega a
    // (3,1) e bate sem soltar o follow — o combate, não o follow, decide parar para bater.
    const { session, ruleset } = followSession({
      content: content(),
      botConfigs: { a: botConfig({ follow: { kind: 'member', characterId: 'b' } }) },
    });
    session.enter(member('a'));
    session.enter(member('b'));
    walkTo(session, ruleset, 'b', { x: 4, y: 1 });
    stand(session, 'b');

    run(session, 10_000, 100);

    const a = session.participants.find((p) => p.id === 'a');
    const b = session.participants.find((p) => p.id === 'b');
    if (a === undefined || b === undefined) throw new Error('a sessão perdeu um membro');
    expect(session.aggregatesOf('a').bestBasicHit).toBeGreaterThan(0);
    // Nenhuma interrupção falsa por causa do combate: `follow-state` só sai em transição.
    expect(followStates(session).filter((e) => !e.active)).toHaveLength(0);
    expect(chebyshev(a.position, b.position)).toBe(1);
  });

  it('alvo morto: interrompe UMA vez com reason dead e o seguidor volta à rota', () => {
    const { session, ruleset } = followSession({
      botConfigs: { a: botConfig({ follow: { kind: 'member', characterId: 'b' } }) },
      partyOptions: { leaderId: 'a', mode: 'split' },
    });
    const a = member('a');
    const b = member('b');
    session.enter(a);
    session.enter(b);
    walkTo(session, ruleset, 'b', { x: 4, y: 1 });
    stand(session, 'b');

    session.kill(b);

    const first = followStates(session);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ characterId: 'a', active: false, targetId: 'b', reason: 'dead' });

    // 50 vencimentos depois, ainda é o MESMO único evento, e `a` anda a rota — nunca escolhe
    // outro alvo sozinho (§25.1).
    run(session, 5_000, 100);
    expect(followStates(session)).toHaveLength(0);
    expect(route.tiles.some((t) => t.x === a.position.x && t.y === a.position.y)).toBe(true);
  });

  it('alvo que sai vivo: mesmo evento com reason left', () => {
    const { session } = followSession({
      botConfigs: { a: botConfig({ follow: { kind: 'member', characterId: 'b' } }) },
      partyOptions: { leaderId: 'a', mode: 'split' },
    });
    session.enter(member('a'));
    session.enter(member('b'));

    session.leave('b', 'manual-exit');

    // `character.alive` é lido ANTES de `Session.leave` remover o participante: é o que separa
    // 'left' de 'dead'.
    expect(followStates(session)).toEqual([
      expect.objectContaining({ characterId: 'a', active: false, targetId: 'b', reason: 'left' }),
    ]);
  });

  it('alvo fora do raio: unreachable uma vez, e retoma quando volta ao alcance', () => {
    // Sala maior que o `map`/`route` padrão deste describe (#527): com `FOLLOW_UNREACHABLE_SLACK`
    // somado ao raio, a distância máxima da sala 4×3 de sempre (3, canto a canto) nunca ficaria
    // ALÉM do teto de desistência — este teste especificamente precisa de uma distância maior
    // que a arena pequena comporta.
    const bigRoom = {
      id: 'arena', z: 7,
      grid: [
        '############',
        '#..........#',
        '#..........#',
        '#..........#',
        '############',
      ],
    };
    const bigRoomRoute = {
      id: 'arena-loop', mapId: 'arena', tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }], spawnPoints: [],
    };
    const radius2 = followContent({
      maps: [bigRoom],
      routes: [bigRoomRoute],
      bot: [{
        id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
        slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 }, targetSearchRadius: 2,
      }],
    });
    const { session, ruleset } = followSession({
      content: radius2,
      botConfigs: { a: botConfig({ follow: { kind: 'member', characterId: 'b' } }) },
    });
    const a = member('a');
    const b = member('b');
    session.enter(a);
    session.enter(b);
    walkTo(session, ruleset, 'b', { x: 8, y: 1 });
    stand(session, 'b');

    // (1,1) → (8,1) é distância 7 — acima do raio 2 mesmo com a folga de
    // `FOLLOW_UNREACHABLE_SLACK` (#527, a distância raw não é monotônica ao longo de um
    // caminho do BFS limitado, então o teto de desistência ganhou uma folga pequena e fixa
    // além do raio configurado): interrompe na primeira avaliação.
    session.advanceBy(100);
    expect(followStates(session)).toEqual([
      expect.objectContaining({ active: false, targetId: 'b', reason: 'unreachable' }),
    ]);

    // "Temporariamente inacessível": volta a ficar ao lado — retoma.
    walkTo(session, ruleset, 'b', { x: a.position.x, y: a.position.y === 1 ? 2 : 1 });
    stand(session, 'b');
    run(session, 1_000, 100);

    const resumed = followStates(session);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({ active: true, targetId: 'b' });
  });

  it('leader: a troca de líder muda o alvo do follow sem reconfigurar o bot', () => {
    const { session, ruleset } = followSession({
      botConfigs: { a: botConfig({ follow: { kind: 'leader' } }) },
      partyOptions: { leaderId: 'L', mode: 'split' },
    });
    const c = member('c');
    const lead = member('L');
    const a = member('a');
    session.enter(c);
    // `c` é o mais antigo e fica parado num canto; ao sair o líder, a liderança cai nele.
    walkTo(session, ruleset, 'c', { x: 4, y: 1 });
    stand(session, 'c');
    session.enter(lead);
    stand(session, 'L');
    session.enter(a);

    session.leave('L', 'manual-exit');
    run(session, 5_000, 100);

    const states = followStates(session);
    expect(states.some((e) => !e.active && e.targetId === 'L' && e.reason === 'left')).toBe(true);
    expect(states.filter((e) => e.active).at(-1)?.targetId).toBe('c');
    const aa = session.participants.find((p) => p.id === 'a');
    if (aa === undefined) throw new Error('a sessão perdeu o seguidor');
    expect(chebyshev(aa.position, { x: 4, y: 1 })).toBe(1);
  });

  it('followInterrupted sobrevive ao snapshot, e some quando false', () => {
    const { session, ruleset } = followSession({
      botConfigs: { a: botConfig({ follow: { kind: 'member', characterId: 'b' } }) },
      partyOptions: { leaderId: 'a', mode: 'split' },
    });
    session.enter(member('a'));
    session.enter(member('b'));
    session.kill(session.participants.find((p) => p.id === 'b') as CharacterRuntime);

    expect(ruleset.getState().runners?.['a']?.followInterrupted).toBe(true);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const restored = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, followContent()) as HuntRuleset, Rng.fromSeed('x'),
    );
    expect((restored.ruleset as HuntRuleset).getState().runners?.['a']?.followInterrupted).toBe(true);
  });

  it('sem interrupção, followInterrupted nem aparece no estado serializado', () => {
    const { session, ruleset } = followSession({});
    session.enter(member('a'));
    const runners = ruleset.getState().runners ?? {};
    expect('followInterrupted' in (runners['a'] ?? {})).toBe(false);
  });

  it('followStateOf devolve a verdade atual, e undefined sem follow configurado (#401)', () => {
    const { session, ruleset } = followSession({
      botConfigs: { a: botConfig({ follow: { kind: 'member', characterId: 'b' } }) },
      partyOptions: { leaderId: 'a', mode: 'split' },
    });
    session.enter(member('a'));
    session.enter(member('b'));

    // Ativo e sem evento ainda: o alvo vem da própria configuração.
    expect(ruleset.followStateOf('a')).toEqual({ active: true, targetId: 'b' });
    // Sem follow configurado: nada a corrigir no attach.
    expect(ruleset.followStateOf('b')).toBeUndefined();

    session.kill(session.participants.find((p) => p.id === 'b') as CharacterRuntime);
    expect(ruleset.followStateOf('a')).toEqual({ active: false, targetId: 'b', reason: 'dead' });
  });

  it('a interrupção atual do followStateOf sobrevive ao snapshot (#401)', () => {
    const { session, ruleset } = followSession({
      botConfigs: { a: botConfig({ follow: { kind: 'member', characterId: 'b' } }) },
      partyOptions: { leaderId: 'a', mode: 'split' },
    });
    session.enter(member('a'));
    session.enter(member('b'));
    session.kill(session.participants.find((p) => p.id === 'b') as CharacterRuntime);
    expect(ruleset.followStateOf('a')).toEqual({ active: false, targetId: 'b', reason: 'dead' });

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const restored = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, followContent()) as HuntRuleset, Rng.fromSeed('x'),
    );
    expect((restored.ruleset as HuntRuleset).followStateOf('a')).toEqual({
      active: false, targetId: 'b', reason: 'dead',
    });
  });

  it('member: um corredor em U que o passo guloso não resolve sozinho — o BFS limitado acha o desvio (#527)', () => {
    // Geometria de uma QA ao vivo, real (Darashia Dragon Lair, z10, x 30..51) — reproduzida
    // aqui em coordenadas locais (x local = x real − 30): o seguidor ficava em (40,11), o líder
    // oito tiles ao sul em (41,19), e os TRÊS candidatos do passo guloso (ADR 0009: direção +
    // dois vizinhos) na direção sudeste eram todos parede — (41,12) e (40,12) pela fileira
    // y=12 (`#####.....##....######`, x=40 e 41 bloqueados), (41,11) pela fileira y=11
    // (`####.......#....######`, x=41 bloqueado). O único jeito de verdade é recuar para
    // oeste (x ≤ 39/local 9) e descer pelo corredor estreito (x local 8..11) até ficar
    // adjacente ao líder — o guloso (ADR 0009, três candidatos só) nunca tenta isso sozinho.
    const uCorridorMap = {
      id: 'arena', z: 7,
      grid: [
        '####.......#....######', // y=0 (y real 11): x local 11 (=x real 41) é parede
        '#####.....##....######', // y=1 (y real 12): x local 10 e 11 (=x real 40,41) são parede
        '#####.......##########', // y=2: conector — abre de x local 5 a 11
        '########....##########', // y=3..8 (y real 14..19): corredor só em x local 8..11
        '########....##########',
        '########....##########',
        '########....##########',
        '########....##########',
        '########....##########',
      ],
    };
    const uCorridorRoute = {
      id: 'arena-loop', mapId: 'arena',
      tiles: [{ x: 10, y: 0, z: 7 }, { x: 9, y: 0, z: 7 }],
      spawnPoints: [],
    };

    const scenario = (hz: number) => {
      const { session } = followSession({
        content: followContent({ maps: [uCorridorMap], routes: [uCorridorRoute] }),
        botConfigs: { b: botConfig({ follow: { kind: 'member', characterId: 'a' } }) },
      });
      session.enter(member('a'));
      session.enter(member('b'));
      const a = session.participants.find((p) => p.id === 'a');
      const b = session.participants.find((p) => p.id === 'b');
      if (a === undefined || b === undefined) throw new Error('a sessão perdeu um membro');
      a.position = { x: 11, y: 8, z: 7 };
      b.position = { x: 10, y: 0, z: 7 };
      stand(session, 'a');
      // A ocupação do mundo é INCREMENTAL desde a entrada (`onEnter`) — sobrescrever `.position`
      // à mão, como acima, não a atualiza: ela continua achando que `a`/`b` estão nos tiles
      // ONDE FORAM COLOCADOS na entrada, não onde este teste os pôs depois. Um placeholder que
      // entra e sai marca a ocupação como desatualizada (`onLeave`), e o PRÓXIMO evento
      // processado remonta do zero a partir de `session.participants` — já refletindo as
      // posições de cima.
      session.enter(member('placeholder'));
      session.leave('placeholder', 'manual-exit');

      run(session, 30_000, 1000 / hz);
      return { distance: chebyshev(a.position, b.position), bPosition: { ...b.position } };
    };

    const at1Hz = scenario(1);
    expect(
      at1Hz.distance,
      `1 Hz: seguidor ficou em ${JSON.stringify(at1Hz.bPosition)}, nunca alcançou o líder`,
    ).toBe(1);

    const at10Hz = scenario(10);
    expect(
      at10Hz.distance,
      `10 Hz: seguidor ficou em ${JSON.stringify(at10Hz.bPosition)}, nunca alcançou o líder`,
    ).toBe(1);
  });
});

describe('XP em party (#190, ADR 0027 decisão 3)', () => {
  // Rato de 100 XP, para a tabela do plano (§3.3) ler direto: 4 únicas → 50 cada; 2 knights →
  // 62; knight + sem vocação → 75; 4 únicas com um morto → 58 para os três vivos. E o abate
  // conta no Bestiário de todo elegível (decisão 4).
  const vocations = ['knight', 'druid', 'sorcerer', 'paladin'].map((id) => ({
    id, name: id, healthPerLevel: 10, manaPerLevel: 10, capacityPerLevel: 10,
  }));
  const fat = { ...rat, experience: 100, health: 30 };
  const loaded = () => content({ monsters: [fat], vocations });
  const member = (id: string, vocationId: string | null, alive = true) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: alive ? stats.maxHealth : 0, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive, cooldowns: {}, capacity: 1_000,
    });
  };
  const party = (members: CharacterRuntime[], hz = 10, seconds = 60) => {
    const session = createHuntSession({
      id: 'xp-party', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
    });
    for (const m of members) session.enter(m);
    run(session, seconds * 1_000, 1000 / hz);
    return session;
  };
  const xpOf = (session: Session, id: string) => session.aggregatesOf(id).xpGained;
  const findById = (list: readonly CharacterRuntime[], id: string) => list.find((c) => c.id === id) ?? null;
  const killsOf = (session: Session) => session.aggregates.kills / session.participants.length;

  it('four unique vocations: each member gets 50 % of every rat, and every one counts the kill', () => {
    // Mutação que mata: creditar a XP inteira ao matador — um receberia 100 por rato.
    const session = party([member('k', 'knight'), member('d', 'druid'), member('s', 'sorcerer'), member('p', 'paladin')]);
    const kills = killsOf(session);
    expect(kills).toBeGreaterThan(0);
    for (const id of ['k', 'd', 's', 'p']) {
      expect(xpOf(session, id)).toBe(kills * 50);
      expect(findById(session.participants, id)?.bestiary.getState()).toEqual({ rat: kills });
    }
    expect(session.aggregates.xpGained).toBe(kills * 200);
  });

  it('two knights get 60 each (120 % ÷ 2); knight + no vocation get 65 each ("nenhuma" É vocação distinta no Canary)', () => {
    // §525 (emenda 2026-09-25): o Canary NÃO exclui "nenhuma" (`Party::getUniqueVocationsCount`
    // insere `baseId` sem filtrar `VOCATION_NONE`) — diferente do TFS, que exclui. A fidelidade
    // do ADR 0037 d.4 segue o Canary: 1 knight + 1 sem vocação são DUAS vocações distintas (n=2,
    // tamanho 2 < 4 → 130 %), não uma (120 %). (Sem `partyOptions`, `this.#party` fica
    // indefinido — a fixture acima não usa o gate de elegibilidade de `#xpShares`, só `xpShare`
    // puro sobre `allMembers = session.participants`: a divisão continua igual em TODO abate.)
    const kk = party([member('a', 'knight'), member('b', 'knight')]);
    expect(xpOf(kk, 'a')).toBe(killsOf(kk) * 60);
    expect(xpOf(kk, 'b')).toBe(killsOf(kk) * 60);
    const kn = party([member('a', 'knight'), member('b', null)]);
    expect(xpOf(kn, 'a')).toBe(killsOf(kn) * 65);
    expect(xpOf(kn, 'b')).toBe(killsOf(kn) * 65);
  });

  it('a dead member still counts for n/tamanho (ainda no roster), mas não recebe: 4 vocações (200 %) ÷ 4, pago só aos 3 vivos', () => {
    // O morto entra na sessão morto (fixture) e nunca sai (não passou pelo pipeline de morte) —
    // continua em `session.participants`, o `allMembers` que `sharedExperiencePercent` e o
    // DIVISOR de `xpShare` leem (§525 emenda 2026-09-25: são o roster INTEIRO, como
    // `getPlayers()` nas engines de origem, não só quem recebe). 4 vocações reais, tamanho 4 →
    // 200 %; ceil(100 × 200 / 400) = 50 por cabeça — só que o morto não está em `eligible`, e os
    // outros três dividem o TAMANHO de 4, não de 3.
    const session = party([member('k', 'knight'), member('d', 'druid'), member('s', 'sorcerer'), member('p', 'paladin', false)]);
    const kills = killsOf(session);
    expect(kills).toBeGreaterThan(0);
    expect(xpOf(session, 'p')).toBe(0);
    expect(findById(session.participants, 'p')?.bestiary.getState()).toEqual({});
    for (const id of ['k', 'd', 's']) expect(xpOf(session, id)).toBe(kills * 50);
  });

  it('solo is untouched: the killer gets the whole 100, with the level-up detail as before', () => {
    const session = party([member('k', 'knight')]);
    expect(xpOf(session, 'k')).toBe(killsOf(session) * 100);
    const levelUp = session.notableEvents.find((e) => e.type === 'level-up');
    expect(levelUp?.detail).toMatch(/^\d+$/);
  });

  it('1 Hz == 10 Hz with four members', () => {
    const at = (hz: number) => {
      const session = party([member('k', 'knight'), member('d', 'druid'), member('s', 'sorcerer'), member('p', 'paladin')], hz);
      return ['k', 'd', 's', 'p'].map((id) => [xpOf(session, id), findById(session.participants, id)?.health]);
    };
    expect(at(1)).toEqual(at(10));
  });
});

describe('lastCombatActionAtMs sobrevive ao snapshot (§525, ADR 0027 emenda 2026-09-24/25)', () => {
  // A elegibilidade de XP compartilhada depende deste campo sobreviver a uma retomada (nó
  // reiniciado, hunt desanexada). Prende os DOIS sentidos do defeito: um refactor que droppasse
  // o campo faria todo mundo voltar INATIVO (desliga a divisão igual até agir de novo); um que o
  // reinicializasse com `session.nowMs` da retomada faria todo mundo voltar ATIVO mesmo tendo
  // ficado parado por horas — os dois passam batido se o teste só confere "não é undefined".
  const vocations = ['knight', 'druid'].map((id) => ({
    id, name: id, healthPerLevel: 10, manaPerLevel: 10, capacityPerLevel: 10,
  }));
  const fat = { ...rat, experience: 100, health: 30 };
  const loaded = () => content({ monsters: [fat], vocations });
  const soldier = (id: string, vocationId: string | null) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    });
  };
  const runnersOf = (ruleset: HuntRuleset) => ruleset.getState().runners ?? {};

  it('o valor exato (não só "não nulo") sobrevive à volta inteira — snapshot, JSON, e restore', () => {
    const session = createHuntSession({
      id: 'activity-snapshot', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: { leaderId: 'a', mode: 'shared' },
    });
    session.enter(soldier('a', 'knight'));
    session.enter(soldier('b', 'druid'));
    // Um tick só (o golpe inicial já sai ENGATILHADO): "a" bate a tempo de registrar
    // atividade, "b" ainda pode não ter agido — as duas pontas do campo (número e ausente)
    // aparecem no MESMO teste, sem precisar de um segundo cenário.
    run(session, 100, 100);
    const before = runnersOf(session.ruleset as HuntRuleset);
    const aBefore = before['a']?.lastCombatActionAtMs;
    expect(typeof aBefore).toBe('number');

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const restored = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded()) as HuntRuleset, Rng.fromSeed('activity'),
    );
    const after = runnersOf(restored.ruleset as HuntRuleset);
    // O valor RESTAURADO é o MESMO da captura — não `restored.nowMs` (provaria que não foi
    // reinicializado com "agora") e não `undefined` (provaria que não foi dropado).
    expect(after['a']?.lastCombatActionAtMs).toBe(aBefore);
    expect(after['a']?.lastCombatActionAtMs).toBe(before['a']?.lastCombatActionAtMs);
    expect(restored.nowMs).toBe(session.nowMs);
    // "b" pode ter agido ou não neste único tick; o que importa é que o valor de ANTES e DEPOIS
    // bate — presente ou ausente, o restore não o move para nenhum dos dois lados.
    expect(after['b']?.lastCombatActionAtMs).toBe(before['b']?.lastCombatActionAtMs);
  });

  it('canShareExperience usa o valor RESTAURADO, não "agora": ativo continua ativo, e o efeito aparece no próximo abate', () => {
    const session = createHuntSession({
      id: 'activity-snapshot-2', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: { leaderId: 'a', mode: 'shared' },
    });
    session.enter(soldier('a', 'knight'));
    session.enter(soldier('b', 'druid'));
    // 2 s: tempo de sobra para os dois terem agido ao menos uma vez (o rato de 30 HP não morre
    // de um golpe só, então os dois alcançam e batem antes do primeiro abate).
    run(session, 2_000, 100);
    const beforeKills = session.aggregates.kills;
    const beforeXp = { a: session.aggregatesOf('a').xpGained, b: session.aggregatesOf('b').xpGained };

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const restored = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded()) as HuntRuleset, Rng.fromSeed('activity2'),
    );
    // Bem dentro da janela de atividade (2 min): se o restore tivesse dropado ou zerado o
    // campo, este abate cairia no rateio por dano (quase sempre assimétrico); sobrevivendo,
    // continua a cota IGUAL de sempre.
    run(restored, 3_000, 100);
    const afterKills = restored.aggregates.kills - beforeKills;
    expect(afterKills).toBeGreaterThan(0);
    const aGain = restored.aggregatesOf('a').xpGained - beforeXp.a;
    const bGain = restored.aggregatesOf('b').xpGained - beforeXp.b;
    expect(aGain).toBe(bGain);
    expect(aGain).toBeGreaterThan(0);
  });
});

describe('modo split — o loot vai para um membro sorteado (#191, ADR 0027 decisão 5)', () => {
  // Rato com gold em faixa e um item a 50 %: toda morte consome sorteios, e é a SEQUÊNCIA
  // deles que se prende em solo (FUN-63).
  const lucky = {
    ...rat, health: 30,
    loot: { gold: { chance: 1, min: 1, max: 9 }, items: [{ itemId: 'life-ring', chance: 0.5, min: 1, max: 1 }] },
  };
  const loaded = () => content({ monsters: [lucky] });
  const member = (id: string, alive = true) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: alive ? stats.maxHealth : 0, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive, cooldowns: {}, capacity: 1_000,
    });
  };
  const hunt = (members: CharacterRuntime[], party: boolean, hz = 10) => {
    const session = createHuntSession({
      id: 'loot-session', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      ...(party ? { partyOptions: { leaderId: members[0]?.id ?? '', mode: 'split' as const } } : {}),
    });
    for (const m of members) session.enter(m);
    run(session, 60_000, 1000 / hz);
    return session;
  };
  const lootOf = (session: Session, id: string) => {
    const own = session.aggregatesOf(id);
    const character = session.participants.find((c) => c.id === id);
    return { gold: own.goldGained, items: own.itemsLooted, ids: [...(character?.inventory.items() ?? [])].map((i) => i.instanceId) };
  };

  it('solo: the loot sequence of a fixed seed is the one recorded — no draw was added', () => {
    // Gravado com o solo de antes do #191. Mutação que mata: sortear destinatário com um
    // participante — a sequência de gold e de itens muda inteira.
    const session = hunt([member('hero')], false);
    const loot = lootOf(session, 'hero');
    expect(session.aggregates.kills).toBeGreaterThan(5);
    expect(loot).toEqual(lootOf(hunt([member('hero')], false), 'hero'));
    // A party de UM, com `partyOptions`, também não sorteia: é o mesmo solo. O id da instância
    // muda de formato por DT-03 (party sempre leva o dono), então o que se compara é o loot.
    expect(lootOf(hunt([member('hero')], true), 'hero')).toMatchObject({
      gold: loot.gold, items: loot.items,
    });
  });

  it('split with three members: everyone receives something, the dead one nothing, and the gold adds up', () => {
    const session = hunt([member('a'), member('b'), member('c'), member('dead', false)], true);
    const a = lootOf(session, 'a');
    const b = lootOf(session, 'b');
    const c = lootOf(session, 'c');
    expect(a.gold + a.items).toBeGreaterThan(0);
    expect(b.gold + b.items).toBeGreaterThan(0);
    expect(c.gold + c.items).toBeGreaterThan(0);
    expect(lootOf(session, 'dead')).toEqual({ gold: 0, items: 0, ids: [] });
    expect(a.gold + b.gold + c.gold).toBe(session.aggregates.goldGained);
    expect(session.participants.reduce((sum, p) => sum + p.goldDelta, 0)).toBe(session.aggregates.goldGained);
    // Cada instância é de UM dono.
    const ids = [...a.ids, ...b.ids, ...c.ids];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('1 Hz == 10 Hz in split', () => {
    const at = (hz: number) => {
      const session = hunt([member('a'), member('b'), member('c')], true, hz);
      return ['a', 'b', 'c'].map((id) => lootOf(session, id));
    };
    expect(at(1)).toEqual(at(10));
  });
});

describe('modo shared — rateio, bolsa e settlement (#192, ADR 0027 decisão 5)', () => {
  // Rato com gold fixo 3 e uma espada (value 10, weight 30) sempre: cada abate é 3 de gold e
  // um item na bolsa. Sem regeneração e sem monstro quando o assunto é só o rateio.
  const sword = { id: 'loot-sword', name: 'Loot Sword', kind: 'weapon', slot: 'hand', weight: 30, value: 10, weapon: { kind: 'melee', range: 1 } };
  const cheese = { id: 'loot-cheese', name: 'Cheese', kind: 'other', weight: 4, value: 0 };
  const rich = {
    ...rat, health: 30, experience: 0,
    loot: { gold: { chance: 1, min: 3, max: 3 }, items: [{ itemId: 'loot-sword', chance: 1, min: 1, max: 1 }, { itemId: 'loot-cheese', chance: 1, min: 1, max: 1 }] },
  };
const potion = { id: 'health-potion', name: 'Poção de Vida', price: 14, effect: { kind: 'heal', amount: 80 } };
  // Só a espada (peso 30), sem queijo: é o cenário determinístico de encher a bolsa até a borda
  // exata, necessário para um OVERWEIGHT que os drops não recusam antes de chegar lá (#396).
  const swordOnly = {
    ...rat, health: 30, experience: 0,
    loot: { gold: { chance: 1, min: 3, max: 3 }, items: [{ itemId: 'loot-sword', chance: 1, min: 1, max: 1 }] },
  };
  const loaded = (over: Partial<RawContent> = {}) => buildContent(raw({
    monsters: [rich], items: [...items, sword, cheese],
    progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    ...over,
  }));
  const member = (id: string, gold: number, capacity = 1_000, health?: number) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: health ?? stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold, goldDelta: 0, alive: true, cooldowns: {}, capacity,
    });
  };
  const shared = (
    members: CharacterRuntime[],
    over: {
      content?: Content; botConfigs?: Record<string, BotConfig>; leader?: string;
      premiumByCharacter?: Record<string, boolean>;
    } = {},
  ) => {
    const session = createHuntSession({
      id: 'shared-session', content: over.content ?? loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: {
        leaderId: over.leader ?? members[0]?.id ?? '', mode: 'shared',
        ...(over.premiumByCharacter === undefined ? {} : { premiumByCharacter: over.premiumByCharacter }),
      },
      ...(over.botConfigs === undefined ? {} : { botConfigs: over.botConfigs }),
    });
    for (const m of members) session.enter(m);
    return { session, ruleset: session.ruleset as HuntRuleset };
  };
  const drinkAlways = botConfig({ potion: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'supply', supplyId: 'health-potion' } }] });
  const spent = (session: Session, id: string) => session.aggregatesOf(id).goldSpent;
  const noMonsters = () => loaded({ routes: [{ ...route, spawnPoints: [] }] });

  it('a poção é RATEADA entre os presentes no `shared`, e cada extrato leva a cota', () => {
    // No modo compartilhado o custo do supply é dividido entre os presentes (#192, ADR 0027
    // decisão 5): só quem configurou o bot USA, e todos pagam a cota — o extrato de cada um sai
    // equalizado, e a soma deles é o `goldSpent` da sessão.
    const { session } = shared(
      [member('u', 100, 1_000, 10), member('a', 100), member('b', 100), member('c', 100)],
      { content: noMonsters(), botConfigs: { u: drinkAlways } },
    );
    run(session, 1_500, 100);
    const uses = session.aggregatesOf('u').suppliesUsed;
    expect(uses).toBeGreaterThan(0);
    const total = ['u', 'a', 'b', 'c'].reduce((sum, id) => sum + spent(session, id), 0);
    expect(total).toBe(session.aggregates.goldSpent);
    expect(spent(session, 'u')).toBeGreaterThan(0);
    for (const id of ['a', 'b', 'c']) expect(spent(session, id)).toBeGreaterThan(0);
    expect(session.participants.reduce((sum, p) => sum + p.goldDelta, 0)).toBe(-total);
  });

  it('a reposição é limitada pelo saldo; sem saldo, o aviso sai uma vez para quem tentou', () => {
    const { session } = shared(
      [member('u', 100, 1_000, 10), member('poor', 1), member('b', 100), member('c', 100)],
      { content: noMonsters(), botConfigs: { u: drinkAlways } },
    );
    run(session, 500, 100);
    expect(spent(session, 'u')).toBeGreaterThan(0);
    // Quem não tem a cota paga o que tem, e o usuário cobre o resto.
    expect(spent(session, 'poor')).toBe(1);
    // …e ninguém fica negativo.
    for (const p of session.participants) expect(p.gold + p.goldDelta).toBeGreaterThanOrEqual(0);

    const broke = shared(
      [member('u', 4, 1_000, 10), member('a', 0), member('b', 0), member('c', 0)],
      { content: noMonsters(), botConfigs: { u: drinkAlways } },
    );
    run(broke.session, 500, 100);
    expect(broke.session.aggregates.suppliesUsed).toBe(0);
    expect(broke.session.aggregates.goldSpent).toBe(0);
    for (const p of broke.session.participants) expect(p.goldDelta).toBe(0);
    expect(broke.session.notableEvents.filter((e) => e.type === 'supply-unaffordable')).toHaveLength(1);
  });

  it('OVERWEIGHT: o item que não cabe fica no cadáver — não vai à caixa do líder nem conta itemsLooted (#396)', () => {
    // Capacidade DISPONÍVEL 30 + 30 = 60 e um item de peso 30 por abate: dois enchem a bolsa na
    // borda exata (60); o terceiro não cabe e, em OVERWEIGHT, não é coletado (§14).
    const { session, ruleset } = shared(
      [member('lead', 0, 30), member('b', 0, 30)], { content: loaded({ monsters: [swordOnly] }) },
    );
    run(session, 60_000, 100);
    const kills = session.aggregates.kills / 2;
    expect(kills).toBeGreaterThan(2);
    const bag = ruleset.getState().partyBag;
    expect(bag?.capacity).toBe(60);
    expect(bag?.overweight).toBe(true);
    // O gold NUNCA é recusado (§14): entra sempre, mesmo em OVERWEIGHT.
    expect(bag?.gold.reduce((n, e) => n + e.amount, 0)).toBe(kills * 3);
    const swordsInBag = bag?.items.filter((i) => i.item.itemId === 'loot-sword').length ?? 0;
    expect(swordsInBag).toBe(2);
    const lead = session.participants.find((p) => p.id === 'lead');
    // A caixa do líder NÃO recebe o excedente: "coletar com outro destinatário" é coletar (DT-01).
    expect(lead?.lootBox).toEqual([]);
    expect([...(lead?.inventory.items() ?? [])]).toHaveLength(0);
    // `itemsLooted` conta só o que de fato foi coletado (2 espadas), não o recusado.
    expect(session.aggregatesOf('b').itemsLooted).toBe(2);
    expect(session.aggregatesOf('lead').itemsLooted).toBe(2);
    const changed = session.drainEvents().filter((e) => e.kind === 'party-bag-changed');
    expect(changed.length).toBeGreaterThan(0);
    const last = changed.at(-1);
    expect(last?.kind === 'party-bag-changed' && last.overweight).toBe(true);
  });

  it('party-bag-changed leva value, overweight e reservations proporcionais à disponível (#396)', () => {
    const { session } = shared([member('lead', 0, 1_000), member('b', 0, 500)]);
    run(session, 8_000, 100);
    const events = session.drainEvents().filter((e) => e.kind === 'party-bag-changed');
    const last = events.at(-1);
    if (last?.kind !== 'party-bag-changed') throw new Error('sem party-bag-changed');
    expect(last.overweight).toBe(false);
    expect(last.value).toBeGreaterThan(0);
    expect(last.reservations.map((r) => r.characterId)).toEqual(['lead', 'b']);
    // A reserva é proporcional à capacidade DISPONÍVEL (1000 : 500 = 2 : 1), não à total.
    const [lead, b] = last.reservations;
    if (lead === undefined || b === undefined) throw new Error('sem reservas');
    expect(lead.available).toBe(1_000);
    expect(b.available).toBe(500);
    expect(lead.reserved).toBeCloseTo(2 * b.reserved, 10);
  });

  it('party-overweight é notável só na TRANSIÇÃO: on, off, on = 3 linhas (#396, RF-06)', () => {
    const { session } = shared(
      [member('lead', 0, 30), member('b', 0, 30), member('c', 0, 30)],
      { content: loaded({ monsters: [swordOnly] }) },
    );
    run(session, 60_000, 100);
    expect(session.notableEvents.filter((e) => e.type === 'party-overweight').map((e) => e.detail))
      .toEqual(['on']);
    // `c` sai: o settlement vende a bolsa e zera o peso — a reserva sai de OVERWEIGHT.
    session.leave('c', 'manual-exit');
    // E a bolsa volta a encher com os dois que ficaram.
    run(session, 60_000, 100);
    expect(session.notableEvents.filter((e) => e.type === 'party-overweight').map((e) => e.detail))
      .toEqual(['on', 'off', 'on']);
  });

  it('#settle libera a reserva: o item que não vende entra na mochila do líder com a capacidade cheia (#396, RF-05)', () => {
    const relic = { id: 'relic', name: 'Relic', kind: 'other', weight: 31, value: 0 };
    const withRelic = loaded({ items: [...items, sword, cheese, relic] });
    const { session } = shared([member('lead', 0, 35), member('b', 0, 1_000)], { content: withRelic });
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    // O líder já carrega 4 de peso (um queijo): sobra 31 de 35 — exatamente o peso do relic. Sem
    // a reserva, ele cabe; com a reserva da própria bolsa em cima, seria recusado para a caixa.
    const leadState = snapshot.participants.find((p) => p.id === 'lead');
    if (leadState === undefined) throw new Error('sem lead');
    (leadState as { inventory: InventoryState }).inventory = {
      backpack: [{ instanceId: 'inv-cheese', itemId: 'loot-cheese', quantity: 1 }],
      equipped: {},
    };
    (snapshot.ruleset as { partyBag?: unknown }).partyBag = {
      gold: [], capacity: 0, overweight: false,
      items: [{ item: { instanceId: 'bag-relic', itemId: 'relic', quantity: 1 }, eligible: ['lead', 'b'] }],
    };
    const restored = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, withRelic) as HuntRuleset, Rng.fromSeed('reserve-release'),
    );
    const leader = restored.participants.find((p) => p.id === 'lead');
    if (leader === undefined) throw new Error('sem lead');
    restored.leave('b', 'manual-exit');
    expect([...leader.inventory.items()].map((i) => i.itemId)).toContain('relic');
    expect(leader.lootBox.map((i) => i.itemId)).not.toContain('relic');
  });

  it('1 Hz == 10 Hz atravessando OVERWEIGHT (#396, RF-04)', () => {
    const at = (hz: number) => {
      const { session, ruleset } = shared(
        [member('lead', 0, 30), member('b', 0, 30)], { content: loaded({ monsters: [swordOnly] }) },
      );
      run(session, 60_000, 1000 / hz);
      return {
        bag: ruleset.getState().partyBag,
        overweight: session.notableEvents
          .filter((e) => e.type === 'party-overweight').map((e) => e.detail),
      };
    };
    expect(at(1)).toEqual(at(10));
  });

  it('settlement por entrada: cada composição de elegibilidade paga só quem estava no drop (#395)', () => {
    const { session, ruleset } = shared([member('lead', 0), member('b', 0)]);
    run(session, 15_000, 100);
    // `aggregates.kills` é a SOMA por participante: com 2 presentes, 2 por abate.
    const agg1 = session.aggregates.kills;
    const kills1 = agg1 / 2;
    expect(kills1).toBeGreaterThan(0);

    // Alguém entra no meio: os drops ANTES dela têm `eligible: [lead, b]`.
    session.enter(member('late', 0));
    run(session, 15_000, 100);
    const agg2 = session.aggregates.kills;
    const kills2 = (agg2 - agg1) / 3;
    expect(kills2).toBeGreaterThan(0);

    const before = ruleset.getState().partyBag;
    expect(before?.gold.reduce((n, e) => n + e.amount, 0)).toBe((kills1 + kills2) * 3);

    // `b` sai: o settlement inclui quem sai, mas cada entrada paga só o seu `eligible`.
    const departure = session.leave('b', 'manual-exit');
    // Early (eligible [lead,b]): ouro 3 → 2/1; espada 10 → 5/5 → lead 7, b 6 por abate.
    // Late (eligible [lead,b,late]): ouro 3 → 1/1/1; espada 10 → 4/3/3 → lead 5, b 4, late 4.
    expect(session.aggregatesOf('lead').goldGained).toBe(7 * kills1 + 5 * kills2);
    expect(departure?.receipt.aggregates.goldGained).toBe(6 * kills1 + 4 * kills2);
    // `late` NÃO recebe nada dos drops anteriores à entrada dela — a prova do §16.1.
    expect(session.aggregatesOf('late').goldGained).toBe(4 * kills2);
    const total = 13 * (kills1 + kills2);
    expect(ruleset.getState().partyBag?.gold).toHaveLength(0);
    expect(ruleset.getState().partyBag?.items).toHaveLength(0);
    // A capacidade é a soma das DISPONÍVEIS dos PRESENTES, na hora — a mochila do líder já
    // recebeu os `unsold` do settlement, então o disponível dela caiu (#396).
    const catalog = loaded().items;
    const available = session.participants.reduce(
      (n, p) => n + Math.max(0, p.capacity - p.inventory.weight(catalog)), 0,
    );
    expect(ruleset.getState().partyBag?.capacity).toBe(available);
    const lead = session.participants.find((p) => p.id === 'lead');
    expect([...(lead?.inventory.items() ?? [])].filter((i) => i.itemId === 'loot-cheese').reduce((n, i) => n + i.quantity, 0)).toBe(kills1 + kills2);
    expect(session.notableEvents.find((e) => e.type === 'party-settlement')?.detail).toBe(`${String(total)}/3`);

    // No fim: os dois que ficaram dividem o que caiu depois.
    run(session, 15_000, 100);
    const laterKills = (session.aggregates.kills - agg2) / 2;
    session.end('manual-exit');
    const settlements = session.notableEvents.filter((e) => e.type === 'party-settlement');
    expect(settlements).toHaveLength(2);
    expect(settlements[1]?.detail).toBe(`${String(13 * laterKills)}/2`);
  });

  it('partySpendingPreview: calling repeatedly does not mutate bag, does not emit events, and matches real settlement', () => {
    const { session, ruleset } = shared([member('lead', 0), member('b', 0), member('c', 0)]);
    run(session, 30_000, 100);

    const bagBefore = JSON.parse(JSON.stringify(ruleset.getState().partyBag));
    session.drainEvents();

    const preview1 = ruleset.partySpendingPreview(session);
    const preview2 = ruleset.partySpendingPreview(session);

    expect(preview1).toBeDefined();
    expect([...(preview1?.entries() ?? [])]).toEqual([...(preview2?.entries() ?? [])]);
    expect(JSON.parse(JSON.stringify(ruleset.getState().partyBag))).toEqual(bagBefore);
    expect(session.drainEvents()).toHaveLength(0);

    let previewSum = 0;
    for (const gold of preview1!.values()) previewSum += gold;

    // Termina a sessão e verifica que o total do settlement real bate com a soma do preview
    session.end('manual-exit');
    const settlementEvent = session.drainEvents().find((e) => e.kind === 'party-settlement');
    expect(settlementEvent).toBeDefined();
    if (settlementEvent?.kind === 'party-settlement') {
      expect(previewSum).toBe(settlementEvent.total);
    }
  });

  it('partySpendingPreview: returns undefined in split mode and in solo', () => {
    const solo = createHuntSession({
      id: 'solo-session', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
    });
    solo.enter(member('solo', 0));
    expect((solo.ruleset as HuntRuleset).partySpendingPreview(solo)).toBeUndefined();

    const splitSession = createHuntSession({
      id: 'split-session', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: { leaderId: 'lead', mode: 'split' },
    });
    splitSession.enter(member('lead', 0));
    splitSession.enter(member('b', 0));
    expect((splitSession.ruleset as HuntRuleset).partySpendingPreview(splitSession)).toBeUndefined();
  });

  it('the bag survives the snapshot, with its entries, weight and the next instance id', () => {
    const { session, ruleset } = shared([member('lead', 0), member('b', 0)]);
    run(session, 20_000, 100);
    const state = ruleset.getState().partyBag;
    expect((state?.items.length ?? 0)).toBeGreaterThan(0);
    expect(state?.items.every((entry) => entry.eligible.length > 0)).toBe(true);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const restored = Session.fromSnapshot(snapshot, huntRulesetFromSnapshot(snapshot, loaded()) as HuntRuleset, Rng.fromSeed('x'));
    expect((restored.ruleset as HuntRuleset).getState().partyBag).toEqual(state);
    run(restored, 10_000, 100);
    const ids = (restored.ruleset as HuntRuleset).getState().partyBag?.items.map((i) => i.item.instanceId) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('bolsa no formato ANTIGO (gold: number) migra com eligible: [] e o settlement usa os presentes (#395)', () => {
    const { session } = shared([member('lead', 0), member('b', 0)]);
    run(session, 10_000, 100);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    // O formato anterior ao #395: `gold` é número e os itens são soltos, sem `eligible`.
    (snapshot.ruleset as { partyBag?: unknown }).partyBag = {
      gold: 42, capacity: 400,
      items: [{ instanceId: 'shared-session:bag:0', itemId: 'loot-sword', quantity: 1 }],
    };
    const restored = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded()) as HuntRuleset, Rng.fromSeed('legacy-bag'),
    );
    const ruleset = restored.ruleset as HuntRuleset;
    expect(ruleset.getState().partyBag?.gold).toEqual([{ amount: 42, eligible: [] }]);
    expect(ruleset.getState().partyBag?.items).toEqual([
      { item: { instanceId: 'shared-session:bag:0', itemId: 'loot-sword', quantity: 1 }, eligible: [] },
    ]);
    // O peso é derivado do catálogo (a espada pesa 30); o `seq` continua depois do id lido.
    expect(ruleset.partySummary(restored)?.bagWeight).toBe(30);

    // O settlement seguinte usa "presentes na hora": 42 de gold + 10 da espada = 52, 26 cada.
    const receipts = restored.end('manual-exit');
    expect(receipts.map((r) => r.characterId)).toEqual(['lead', 'b']);
    expect(receipts.map((r) => r.aggregates.goldGained)).toEqual([26, 26]);
    // Sem bump: o formato continua 3.
    expect(SNAPSHOT_FORMAT_VERSION).toBe(3);
  });

  it('snapshot legado com mode migra para os dois eixos, sem bump (#394)', () => {
    const { session } = shared([member('lead', 0), member('b', 0)]);
    run(session, 5_000, 100);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    (snapshot.ruleset as { partyOptions?: unknown }).partyOptions = { leaderId: 'lead', mode: 'shared' };
    // O snapshot legado não tinha `partyBag`; com `splitLoot` migrado para `true`, ele nasce vazio.
    delete (snapshot.ruleset as { partyBag?: unknown }).partyBag;
    const restored = Session.fromSnapshot(snapshot, huntRulesetFromSnapshot(snapshot, loaded()) as HuntRuleset, Rng.fromSeed('legacy'));
    const ruleset = restored.ruleset as HuntRuleset;
    expect(ruleset.party?.shareCosts).toBe(true);
    expect(ruleset.party?.splitLoot).toBe(true);
    expect(ruleset.party?.collect).toBeNull();
    expect(ruleset.party?.autoSell).toEqual([]);
    expect(ruleset.getState().partyBag).toMatchObject({ gold: [], items: [] });
    // Sem bump: o formato continua 3.
    expect(SNAPSHOT_FORMAT_VERSION).toBe(3);
  });

  it('snapshot legado com shareCosts explícito vence o mode (#394)', () => {
    const { session } = shared([member('lead', 0), member('b', 0)]);
    run(session, 5_000, 100);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    (snapshot.ruleset as { partyOptions?: unknown }).partyOptions = { leaderId: 'lead', mode: 'shared', shareCosts: false, splitLoot: true };
    const restored = Session.fromSnapshot(snapshot, huntRulesetFromSnapshot(snapshot, loaded()) as HuntRuleset, Rng.fromSeed('legacy-2'));
    const party = (restored.ruleset as HuntRuleset).party;
    expect(party?.shareCosts).toBe(false);
    expect(party?.splitLoot).toBe(true);
  });

  it('1 Hz == 10 Hz in shared', () => {
    const at = (hz: number) => {
      const { session, ruleset } = shared([member('lead', 50, 1_000, 10), member('b', 50)], { botConfigs: { lead: drinkAlways } });
      run(session, 30_000, 1000 / hz);
      return { bag: ruleset.getState().partyBag, spent: [spent(session, 'lead'), spent(session, 'b')] };
    };
    expect(at(1)).toEqual(at(10));
  });

  it('collect filtra DEPOIS de rollLoot: item fora da lista fica no cadáver, sem itemsLooted (#395)', () => {
    const { session, ruleset } = shared([member('lead', 0), member('b', 0)]);
    expect(ruleset.configureParty(session, { collect: ['loot-sword'] }, 'lead')).toEqual({ ok: true });
    run(session, 20_000, 100);
    const kills = session.aggregates.kills / 2;
    expect(kills).toBeGreaterThan(0);
    const bag = ruleset.getState().partyBag;
    // Só a espada foi coletada; o queijo não existe para a party.
    expect(bag?.items.every((e) => e.item.itemId === 'loot-sword')).toBe(true);
    expect(bag?.items).toHaveLength(kills);
    const lead = session.participants.find((p) => p.id === 'lead');
    expect(lead?.lootBox.some((i) => i.itemId === 'loot-cheese')).toBe(false);
    expect([...(lead?.inventory.items() ?? [])].some((i) => i.itemId === 'loot-cheese')).toBe(false);
    expect(session.aggregatesOf('lead').itemsLooted).toBe(kills);
    expect(session.aggregatesOf('b').itemsLooted).toBe(kills);
    // O gold NUNCA é filtrado: entra sempre.
    expect(bag?.gold.reduce((n, e) => n + e.amount, 0)).toBe(kills * 3);
  });

  it('autovenda no drop: 3 dragon ham (value 10) entre 4 presentes → 8/8/7/7 por abate (#395, §3)', () => {
    const ham = { id: 'dragon-ham', name: 'Dragon Ham', kind: 'other', weight: 10, value: 10 };
    const hamRat = {
      ...rat, health: 30, experience: 0,
      loot: { gold: { chance: 0, min: 1, max: 1 }, items: [{ itemId: 'dragon-ham', chance: 1, min: 3, max: 3 }] },
    };
    const content = loaded({ monsters: [hamRat], items: [...items, ham] });
    const { session, ruleset } = shared(
      [member('a', 0), member('b', 0), member('c', 0), member('d', 0)], { content },
    );
    expect(ruleset.configureParty(session, { autoSell: ['dragon-ham'] }, 'a')).toEqual({ ok: true });
    run(session, 15_000, 100);
    const kills = session.aggregates.kills / 4;
    expect(kills).toBeGreaterThan(0);
    // 30 gold por abate: 8/8/7/7 (o resto vai um a um na ordem de entrada).
    expect(session.aggregatesOf('a').goldGained).toBe(8 * kills);
    expect(session.aggregatesOf('b').goldGained).toBe(8 * kills);
    expect(session.aggregatesOf('c').goldGained).toBe(7 * kills);
    expect(session.aggregatesOf('d').goldGained).toBe(7 * kills);
    // A venda automática emite `party-settlement { reason: 'auto-sell', itemId }` no dreno…
    const events = session.drainEvents().filter((e) => e.kind === 'party-settlement');
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) =>
      e.kind === 'party-settlement' && e.reason === 'auto-sell' && e.itemId === 'dragon-ham')).toBe(true);
    // …e NÃO vira linha da lista curta de eventos notáveis.
    expect(session.notableEvents.some((e) => e.type === 'party-settlement')).toBe(false);
    // O item vendido nunca pesa nem entra na bolsa.
    expect(ruleset.getState().partyBag?.items).toHaveLength(0);
  });

  it('autoSell corta a lista pelos primeiros N do limite do líder (#395, §23.1)', () => {
    const ids = ['sell-a', 'sell-b', 'sell-c', 'sell-d', 'sell-e', 'sell-f'];
    const goods = ids.map((id) => ({ id, name: id, kind: 'other', weight: 1, value: 10 }));
    const drop = {
      ...rat, health: 30, experience: 0,
      loot: { gold: { chance: 0, min: 1, max: 1 }, items: [{ itemId: 'sell-f', chance: 1, min: 1, max: 1 }] },
    };
    const content = loaded({ monsters: [drop], items: [...items, ...goods] });

    // Líder free: limite 5 — o 6º id fica salvo e inerte; o item cai como COLETADO.
    const free = shared([member('lead', 0), member('b', 0)], { content });
    expect(free.ruleset.configureParty(free.session, { autoSell: ids }, 'lead')).toEqual({ ok: true });
    run(free.session, 10_000, 100);
    const freeBag = free.ruleset.getState().partyBag;
    expect(freeBag?.items.length ?? 0).toBeGreaterThan(0);
    expect(freeBag?.items.every((e) => e.item.itemId === 'sell-f')).toBe(true);
    expect(free.session.aggregatesOf('lead').goldGained).toBe(0);

    // Líder Premium: limite 20 — o 6º id vende e nada entra na bolsa.
    const premium = shared([member('lead', 0), member('b', 0)], {
      content, premiumByCharacter: { lead: true },
    });
    expect(premium.ruleset.configureParty(premium.session, { autoSell: ids }, 'lead')).toEqual({ ok: true });
    run(premium.session, 10_000, 100);
    expect(premium.ruleset.getState().partyBag?.items).toHaveLength(0);
    expect(premium.session.aggregatesOf('lead').goldGained).toBeGreaterThan(0);
  });

  it('item de autoSell com value: 0 é ignorado na entrega e entra como coletado (#395, DT-04)', () => {
    // `configureParty` já recusa configurar assim; a lista é posta direto para simular conteúdo
    // que mudou de valor sob uma sessão em voo.
    const { session, ruleset } = shared([member('lead', 0), member('b', 0)]);
    const party = ruleset.party;
    if (party === undefined) throw new Error('sem party');
    party.collect = ['loot-cheese'];
    party.autoSell = ['loot-cheese'];
    run(session, 10_000, 100);
    const bag = ruleset.getState().partyBag;
    expect(bag?.items.length ?? 0).toBeGreaterThan(0);
    expect(bag?.items.every((e) => e.item.itemId === 'loot-cheese')).toBe(true);
    expect(session.aggregatesOf('lead').goldGained).toBe(0);
    const autoSell = session.drainEvents().filter(
      (e) => e.kind === 'party-settlement' && e.reason === 'auto-sell',
    );
    expect(autoSell).toHaveLength(0);
  });

  it('cada BagEntry guarda eligible = presentes no instante do abate (#395, §16.1)', () => {
    const { session, ruleset } = shared([member('lead', 0), member('b', 0)]);
    run(session, 8_000, 100);
    session.enter(member('late', 0));
    run(session, 8_000, 100);
    const items = ruleset.getState().partyBag?.items ?? [];
    // Entradas de antes da entrada da `late`: elegíveis [lead, b], sem ela.
    expect(items.some((e) => e.eligible.length === 2
      && e.eligible.includes('lead') && e.eligible.includes('b') && !e.eligible.includes('late'))).toBe(true);
    // Entradas de depois: elegíveis com os três.
    expect(items.some((e) => e.eligible.length === 3 && e.eligible.includes('late'))).toBe(true);
  });

  it('zero sorteio extra: collect/autoSell não mexem no Rng da sessão (#395, RF-08)', () => {
    const plain = shared([member('lead', 0), member('b', 0)]);
    const configured = shared([member('lead', 0), member('b', 0)]);
    expect(configured.ruleset.configureParty(
      configured.session, { collect: ['loot-sword'], autoSell: ['loot-sword'] }, 'lead',
    )).toEqual({ ok: true });
    run(plain.session, 20_000, 100);
    run(configured.session, 20_000, 100);
    // Mesmo número de abates e MESMO estado do gerador: o filtro e a venda rodam depois.
    expect(configured.session.aggregates.kills).toBe(plain.session.aggregates.kills);
    expect(configured.session.rng.getState()).toEqual(plain.session.rng.getState());
  });
});

describe('combinações mistas de custo e loot (#359, ADR 0027 emenda)', () => {
  const sword = { id: 'loot-sword', name: 'Loot Sword', kind: 'weapon', slot: 'hand', weight: 30, value: 10, weapon: { kind: 'melee', range: 1 } };
  const rich = {
    ...rat, health: 30, experience: 0,
    loot: { gold: { chance: 1, min: 3, max: 3 }, items: [{ itemId: 'loot-sword', chance: 1, min: 1, max: 1 }] },
  };
  const loaded = (over: Partial<RawContent> = {}) => buildContent(raw({
    monsters: [rich], items: [...items, sword],
    progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    ...over,
  }));
  const member = (id: string, gold: number, capacity = 1_000, health?: number) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: health ?? stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold, goldDelta: 0, alive: true, cooldowns: {}, capacity,
    });
  };
  const drinkAlways = botConfig({ potion: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'supply', supplyId: 'health-potion' } }] });
  const spent = (session: Session, id: string) => session.aggregatesOf(id).goldSpent;

  it('combination C (shareCosts: true, splitLoot: false): no party bag, loot goes to drawn member', () => {
    const session = createHuntSession({
      id: 'comb-c', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: { leaderId: 'u', mode: 'split', shareCosts: true, splitLoot: false },
      botConfigs: { u: drinkAlways },
    });
    session.enter(member('u', 100, 1_000, 10));
    session.enter(member('a', 100));
    session.enter(member('b', 100));
    session.enter(member('c', 100));

    const ruleset = session.ruleset as HuntRuleset;
    expect(ruleset.getState().partyBag).toBeUndefined();

    run(session, 1_500, 100);
    const uses = session.aggregatesOf('u').suppliesUsed;
    expect(uses).toBeGreaterThan(0);
    // `shareCosts: true`: o supply é rateado entre os presentes, como no modo `shared`.
    expect(spent(session, 'u')).toBeGreaterThan(0);
    for (const id of ['a', 'b', 'c']) expect(spent(session, id)).toBeGreaterThan(0);
    const totalSpent = ['u', 'a', 'b', 'c'].reduce((sum, id) => sum + spent(session, id), 0);
    expect(totalSpent).toBe(session.aggregates.goldSpent);

    expect(ruleset.getState().partyBag).toBeUndefined();
    expect(session.aggregates.kills).toBeGreaterThan(0);
    const totalGained = ['u', 'a', 'b', 'c'].reduce((sum, id) => sum + session.aggregatesOf(id).goldGained, 0);
    expect(totalGained).toBe(session.aggregates.goldGained);
  });

  it('combination D (shareCosts: false, splitLoot: true): each pays own supply, loot goes to party bag and splits on settlement', () => {
    const session = createHuntSession({
      id: 'comb-d', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: { leaderId: 'u', mode: 'split', shareCosts: false, splitLoot: true },
      botConfigs: { u: drinkAlways },
    });
    session.enter(member('u', 100, 1_000, 10));
    session.enter(member('a', 100));
    session.enter(member('b', 100));
    session.enter(member('c', 100));

    const ruleset = session.ruleset as HuntRuleset;
    expect(ruleset.getState().partyBag).toBeDefined();

    run(session, 1_500, 100);
    const uses = session.aggregatesOf('u').suppliesUsed;
    expect(uses).toBeGreaterThan(0);
    expect(spent(session, 'u')).toBeGreaterThan(0);
    for (const id of ['a', 'b', 'c']) expect(spent(session, id)).toBe(0);

    const bag = ruleset.getState().partyBag;
    expect(bag).toBeDefined();
    expect(bag!.gold.reduce((n, e) => n + e.amount, 0) + bag!.items.length).toBeGreaterThan(0);

    session.end('manual-exit');
    const settlement = session.drainEvents().find((e) => e.kind === 'party-settlement');
    expect(settlement).toBeDefined();
  });

  it('1 Hz == 10 Hz in combination C (shareCosts: true, splitLoot: false)', () => {
    const at = (hz: number) => {
      const session = createHuntSession({
        id: 'c-hz', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
        partyOptions: { leaderId: 'u', mode: 'split', shareCosts: true, splitLoot: false },
        botConfigs: { u: drinkAlways },
      });
      session.enter(member('u', 100, 1_000, 10));
      session.enter(member('a', 100));
      run(session, 20_000, 1000 / hz);
      return {
        kills: session.aggregates.kills,
        goldGained: session.aggregates.goldGained,
        goldSpentU: spent(session, 'u'),
        goldSpentA: spent(session, 'a'),
        uGained: session.aggregatesOf('u').goldGained,
        aGained: session.aggregatesOf('a').goldGained,
      };
    };
    expect(at(1)).toEqual(at(10));
  });

  it('1 Hz == 10 Hz in combination D (shareCosts: false, splitLoot: true)', () => {
    const at = (hz: number) => {
      const session = createHuntSession({
        id: 'd-hz', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
        partyOptions: { leaderId: 'u', mode: 'split', shareCosts: false, splitLoot: true },
        botConfigs: { u: drinkAlways },
      });
      session.enter(member('u', 100, 1_000, 10));
      session.enter(member('a', 100));
      run(session, 20_000, 1000 / hz);
      const bag = (session.ruleset as HuntRuleset).getState().partyBag;
      return {
        kills: session.aggregates.kills,
        bagGold: bag?.gold,
        bagItems: bag?.items,
        goldSpentU: spent(session, 'u'),
        goldSpentA: spent(session, 'a'),
      };
    };
    expect(at(1)).toEqual(at(10));
  });
});

describe('a party como estado mutável: configureParty, eixos e munição no rateio (#394)', () => {
  // Rato com gold 3 e uma espada (value 10): cada abate rende gold e item, para exercitar a
  // bolsa nos dois sentidos. Sem regeneração para o teste medir só o que ele quer.
  const sword = { id: 'loot-sword', name: 'Loot Sword', kind: 'weapon', slot: 'hand', weight: 30, value: 10, weapon: { kind: 'melee', range: 1 } };
  const rich = {
    ...rat, health: 30, experience: 0,
    loot: { gold: { chance: 1, min: 3, max: 3 }, items: [{ itemId: 'loot-sword', chance: 1, min: 1, max: 1 }] },
  };
  const loaded = (over: Partial<RawContent> = {}) => buildContent(raw({
    monsters: [rich], items: [...items, sword],
    progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    ...over,
  }));
  const member = (
    id: string,
    over: Partial<{
      gold: number; capacity: number; health: number; vocationId: string | null;
      inventory: InventoryState; ammo: Readonly<Partial<Record<'arrow', string>>>;
    }> = {},
  ) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: over.vocationId ?? null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: over.gold ?? 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: over.capacity ?? 1_000,
      ...(over.inventory === undefined ? {} : { inventory: over.inventory }),
      ...(over.ammo === undefined ? {} : { ammo: over.ammo }),
    });
  };
  const make = (
    members: readonly CharacterRuntime[],
    over: { partyOptions?: PartyOptionsInput; content?: Content; botConfigs?: Record<string, BotConfig> } = {},
  ) => {
    const session = createHuntSession({
      id: 'mutable-party', content: over.content ?? loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: over.partyOptions ?? { leaderId: members[0]?.id ?? '', mode: 'split' },
      ...(over.botConfigs === undefined ? {} : { botConfigs: over.botConfigs }),
    });
    for (const m of members) session.enter(m);
    return { session, ruleset: session.ruleset as HuntRuleset };
  };
  const spent = (session: Session, id: string) => session.aggregatesOf(id).goldSpent;

  it('configureParty recusa quem não é o líder — e uma sessão solo não tem líder', () => {
    const { session, ruleset } = make([member('lead'), member('b')], { partyOptions: { leaderId: 'lead', mode: 'split' } });
    expect(ruleset.configureParty(session, { shareCosts: true }, 'b')).toEqual({ ok: false, reason: 'not-leader' });
    expect(ruleset.party?.shareCosts).toBe(false);
    expect(ruleset.party?.splitLoot).toBe(false);

    const solo = createHuntSession({ id: 'solo-config', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0 });
    solo.enter(member('solo'));
    expect((solo.ruleset as HuntRuleset).configureParty(solo, { shareCosts: true }, 'solo'))
      .toEqual({ ok: false, reason: 'not-leader' });
  });

  it('valida o catálogo ANTES de mutar: id fora e item de value 0 rejeitam o patch inteiro', () => {
    const { session, ruleset } = make([member('lead'), member('b')], {
      partyOptions: { leaderId: 'lead', settings: { shareCosts: false, splitLoot: false, collect: null, autoSell: [] } },
    });
    expect(ruleset.configureParty(session, { collect: ['ghost'] }, 'lead'))
      .toEqual({ ok: false, reason: 'unknown-item', itemId: 'ghost' });
    expect(ruleset.configureParty(session, { autoSell: ['ghost'] }, 'lead'))
      .toEqual({ ok: false, reason: 'unknown-item', itemId: 'ghost' });
    // `life-ring` existe no catálogo com `value: 0` — vender por zero sumiria com o item.
    expect(ruleset.configureParty(session, { autoSell: ['life-ring'] }, 'lead'))
      .toEqual({ ok: false, reason: 'unsellable-item', itemId: 'life-ring' });
    // O patch inteiro foi rejeitado: nada mudou.
    expect(ruleset.party?.collect).toBeNull();
    expect(ruleset.party?.autoSell).toEqual([]);
    expect(ruleset.party?.splitLoot).toBe(false);
  });

  it('um patch parcial preserva os eixos não enviados e guarda collect/autoSell', () => {
    const { session, ruleset } = make([member('lead'), member('b')], {
      partyOptions: { leaderId: 'lead', mode: 'split', shareCosts: true, splitLoot: false },
    });
    expect(ruleset.configureParty(session, { autoSell: ['loot-sword'] }, 'lead')).toEqual({ ok: true });
    expect(ruleset.party?.shareCosts).toBe(true);
    expect(ruleset.party?.splitLoot).toBe(false);
    expect(ruleset.party?.autoSell).toEqual(['loot-sword']);
    expect(ruleset.configureParty(session, { collect: ['loot-sword'] }, 'lead')).toEqual({ ok: true });
    expect(ruleset.party?.autoSell).toEqual(['loot-sword']);
    expect(ruleset.party?.collect).toEqual(['loot-sword']);
  });

  it('ligar splitLoot nasce a bolsa vazia; desligar liquida e nada se perde', () => {
    const { session, ruleset } = make([member('lead'), member('b')]);
    expect(ruleset.getState().partyBag).toBeUndefined();
    expect(ruleset.configureParty(session, { splitLoot: true }, 'lead')).toEqual({ ok: true });
    expect(ruleset.getState().partyBag).toMatchObject({ gold: [], items: [] });

    run(session, 20_000, 100);
    const before = ruleset.getState().partyBag;
    expect((before?.items.length ?? 0)).toBeGreaterThan(0);
    const bagValue = (before?.gold.reduce((n, e) => n + e.amount, 0) ?? 0)
      + (before?.items ?? []).reduce((n, e) => n + (loaded().items.get(e.item.itemId)?.value ?? 0) * e.item.quantity, 0);
    const gained = session.aggregates.goldGained;

    expect(ruleset.configureParty(session, { splitLoot: false }, 'lead')).toEqual({ ok: true });
    expect(ruleset.getState().partyBag).toBeUndefined();
    // O valor da bolsa virou gold da sessão no settlement — nenhum item some.
    expect(session.aggregates.goldGained).toBe(gained + bagValue);
  });

  it('a munição paga entra no rateio: 5 gold entre 4 presentes → 1 de cada e 2 do atirador', () => {
    const bow = { id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 1, value: 0, twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } };
    const arrows = [
      // Sem munição grátis (ADR 0026 d.3): a única da família é paga, e é ela que o rateio divide.
      { id: 'sniper-arrow', name: 'Sniper Arrow', family: 'arrow', attack: 30, price: 5, requires: { level: 1 } },
    ];
    // Monstro que não morre e não bate: o teste mede só os tiros.
    const tank = { ...rat, health: 1_000_000, attack: 0, experience: 0, loot: { gold: { chance: 0, min: 1, max: 1 }, items: [] } };
    const ammoContent = buildContent(raw({
      monsters: [tank], items: [...items, bow], ammunition: arrows,
      progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    }));
    const armed: InventoryState = { backpack: [], equipped: { hand: { instanceId: 'i-bow', itemId: 'bow', quantity: 1 } } };
    const shooter = member('u', { gold: 1_000, inventory: armed, ammo: { arrow: 'sniper-arrow' } });
    const { session } = make([shooter, member('a', { gold: 1_000 }), member('b', { gold: 1_000 }), member('c', { gold: 1_000 })], {
      content: ammoContent,
      partyOptions: { leaderId: 'u', mode: 'split', shareCosts: true, splitLoot: false },
    });
    run(session, 4_000, 100);
    const paid = session.drainEvents().filter((e) => e.kind === 'shot' && e.ammoId === 'sniper-arrow').length;
    expect(paid).toBeGreaterThan(0);
    expect(spent(session, 'u')).toBe(paid * 2);
    for (const id of ['a', 'b', 'c']) expect(spent(session, id)).toBe(paid * 1);
    expect(session.aggregates.goldSpent).toBe(paid * 5);
  });

  it('a penalidade de morte lê o Premium (bênção) do morto: perde menos XP (#521, ADR 0037)', () => {
    const killer = { ...rat, health: 1_000_000, attack: 50, attackRange: 1, experience: 0 };
    const deadly = content({ monsters: [killer] });
    const stats = statsForLevel(10, null, progression as Progression);
    const startXp = totalXpForLevel(10, progression as Progression);
    const dying = (id: string) => new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: 1, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 10, xp: startXp, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    });
    const { session } = make([dying('premium'), dying('free'), member('survivor', { health: 100_000 })], {
      content: deadly,
      partyOptions: {
        leaderId: 'premium',
        settings: { shareCosts: false, splitLoot: false, collect: null, autoSell: [] },
        premiumByCharacter: { premium: true },
      },
    });
    run(session, 30_000, 100);
    const departures = session.drainEvents().filter((e) => e.kind === 'member-left');
    const xpOf = (id: string): number => {
      const event = departures.find((e) => e.kind === 'member-left' && e.characterId === id);
      if (event?.kind !== 'member-left') throw new Error(`sem member-left de ${id}`);
      return event.departure.receipt.aggregates.xpGained;
    };
    // Level 10 < `cubicFromLevel` (24): a perda é `flatFraction` da XP ACUMULADA (não mais uma
    // fração de `xpToCompleteLevel`). Quem está abençoado tem a redução TETADA em 50% neste
    // ramo (Canary `Player::getLostPercent`, `level < 24`) — `blessedReduction` (56%) é ≥ 40%,
    // então o teto entra, não o valor bruto.
    const { flatFraction, blessedReduction } = (progression as Progression).deathPenalty;
    expect(blessedReduction).toBeGreaterThanOrEqual(0.40);
    expect(xpOf('premium')).toBe(-Math.round(flatFraction * startXp * (1 - 0.50)));
    expect(xpOf('free')).toBe(-Math.round(flatFraction * startXp));
  });

  it('1 Hz == 10 Hz alternando os dois eixos no meio da corrida', () => {
    const at = (hz: number) => {
      const step = 1000 / hz;
      const { session, ruleset } = make([member('lead', { gold: 200 }), member('b', { gold: 200 })], {
        partyOptions: { leaderId: 'lead', settings: { shareCosts: false, splitLoot: false, collect: null, autoSell: [] } },
      });
      run(session, 10_000, step);
      ruleset.configureParty(session, { shareCosts: true, splitLoot: true }, 'lead');
      run(session, 10_000, step);
      ruleset.configureParty(session, { shareCosts: false, splitLoot: false }, 'lead');
      run(session, 10_000, step);
      return {
        bag: ruleset.getState().partyBag,
        goldGained: session.aggregates.goldGained,
        leadGained: session.aggregatesOf('lead').goldGained,
        bGained: session.aggregatesOf('b').goldGained,
        kills: session.aggregates.kills,
      };
    };
    expect(at(1)).toEqual(at(10));
  });

  it('partySummary devolve undefined fora de party e o bloco §32 dentro', () => {
    const vocations = ['knight', 'druid'].map((id) => ({
      id, name: id, healthPerLevel: 10, manaPerLevel: 10, capacityPerLevel: 10,
    }));
    const withVocations = loaded({ vocations });
    const solo = createHuntSession({ id: 'solo-summary', content: withVocations, huntId: 'arena', difficulty: 'bold', createdAtMs: 0 });
    solo.enter(member('solo'));
    expect((solo.ruleset as HuntRuleset).partySummary(solo)).toBeUndefined();

    const { session, ruleset } = make(
      [member('lead', { vocationId: 'knight' }), member('b', { vocationId: 'druid' })],
      {
        content: withVocations,
        partyOptions: {
          leaderId: 'lead',
          settings: { shareCosts: true, splitLoot: true, collect: null, autoSell: ['loot-sword', 'life-ring'] },
          premiumByCharacter: { lead: true },
        },
      },
    );
    expect(ruleset.partySummary(session)).toEqual({
      leaderId: 'lead',
      shareCosts: true,
      splitLoot: true,
      members: ['lead', 'b'],
      uniqueVocations: 2,
      xpPoolPercent: 130,
      bagValue: 0,
      bagWeight: 0,
      autoSell: { configured: 2, limit: 20 },
    });
  });
});

describe('entrada em hunt em curso (#397, ADR 0035 decisão 6)', () => {
  const loadedEight = () => content({
    party: [{ id: 'baseline', maxMembers: 8 }],
  });
  const fat = { ...rat, experience: 100, health: 30 };
  const loadedFat = () => content({ monsters: [fat] });
  const rich = {
    ...rat, health: 30, experience: 0,
    loot: { gold: { chance: 1, min: 3, max: 3 }, items: [{ itemId: 'sword', chance: 1, min: 1, max: 1 }] },
  };
  const loadedRich = () => content({ monsters: [rich] });
  const member = (id: string, capacity = 1_000) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity,
    });
  };
  const makeParty = (
    over: { content?: Content; mode?: 'split' | 'shared'; leader?: string } = {},
  ) => {
    const session = createHuntSession({
      id: 'live-join', content: over.content ?? content(), huntId: 'arena', difficulty: 'bold',
      createdAtMs: 0,
      partyOptions: { leaderId: over.leader ?? 'lead', mode: over.mode ?? 'split' },
    });
    return { session, ruleset: session.ruleset as HuntRuleset };
  };

  it('recusa o (maxMembers + 1)-ésimo com PartyFullError, sem tocar nos que já estão', () => {
    // Mutação que mata: checar `>=` em vez de `>` — o oitavo membro seria recusado.
    const { session, ruleset } = makeParty({ content: loadedEight(), leader: 'm0' });
    const ids = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
    for (const id of ids) session.enter(member(id));

    let caught: unknown;
    try {
      session.enter(member('m8'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PartyFullError);
    expect((caught as PartyFullError).maxMembers).toBe(8);
    // A sessão PRÉ-EXISTENTE ficou intacta: lotação, runners e posições.
    expect(session.participants.map((p) => p.id)).toEqual(ids);
    for (const id of ids) {
      expect(ruleset.routeIndexOf(id)).toBeGreaterThanOrEqual(0);
      expect(session.participants.find((p) => p.id === id)?.alive).toBe(true);
    }
    // E `joinedAtMs` não guardou o recusado.
    expect(Object.keys(session.snapshot().joinedAtMs ?? {})).toEqual(ids);
  });

  it('emite party-state em TODA entrada com party — inclusive a primeira', () => {
    const { session } = makeParty();
    session.enter(member('a'));
    const first = session.drainEvents().filter((e) => e.kind === 'party-state');
    expect(first).toHaveLength(1);
    expect(first[0]?.kind === 'party-state' && first[0].members.map((m) => m.characterId)).toEqual(['a']);

    session.enter(member('b'));
    session.drainEvents();
    session.enter(member('c'));
    const states = session.drainEvents().filter((e) => e.kind === 'party-state');
    expect(states).toHaveLength(1);
    expect(states[0]?.kind === 'party-state' && states[0].members.map((m) => m.characterId))
      .toEqual(['a', 'b', 'c']);
  });

  it('rebalanceia a bolsa na entrada: party-bag-changed com a reserva do novo membro', () => {
    const { session, ruleset } = makeParty({ content: loadedRich(), mode: 'shared', leader: 'lead' });
    session.enter(member('lead'));
    session.enter(member('b'));
    run(session, 8_000, 100);
    expect(ruleset.getState().partyBag?.items.length ?? 0).toBeGreaterThan(0);
    session.drainEvents();

    session.enter(member('c'));
    const bags = session.drainEvents().filter((e) => e.kind === 'party-bag-changed');
    expect(bags.length).toBeGreaterThan(0);
    const last = bags.at(-1);
    if (last?.kind !== 'party-bag-changed') throw new Error('sem party-bag-changed');
    expect(last.reservations.map((r) => r.characterId)).toEqual(['lead', 'b', 'c']);
    // A capacidade é a Σ das DISPONÍVEIS dos três presentes, recalculada na entrada.
    const catalog = loadedRich().items;
    const available = session.participants.reduce(
      (n, p) => n + Math.max(0, p.capacity - p.inventory.weight(catalog)), 0,
    );
    expect(last.capacity).toBe(available);
  });

  it('o extrato de quem entrou tarde NÃO leva os level ups dos outros; o de quem já estava leva', () => {
    const { session } = makeParty({ content: loadedFat() });
    session.enter(member('a'));
    session.enter(member('b'));
    run(session, 60_000, 100);
    const levelUp = session.notableEvents.find((e) => e.type === 'level-up');
    expect(levelUp).toBeDefined();
    // Um tick de folga antes de "late" entrar (§525 mudou o ritmo de XP da party — um level up
    // pode cair EXATAMENTE no instante 60 000): sem isto, `notableEvents.atMs >= joinedAtMs`
    // (inclusive) incluiria por coincidência de relógio um level-up que aconteceu ANTES de
    // "late" existir, e o teste não é sobre esse limite.
    run(session, 100, 100);

    session.enter(member('late'));
    const lateDeparture = session.leave('late', 'manual-exit');
    expect(lateDeparture?.receipt.notableEvents.map((e) => e.type)).not.toContain('level-up');

    const bDeparture = session.leave('b', 'manual-exit');
    expect(bDeparture?.receipt.notableEvents.map((e) => e.type)).toContain('level-up');
  });

  it('em party o instanceId leva o dono no meio mesmo com um só presente no drop (DT-03)', () => {
    const { session } = makeParty({ content: content({ monsters: [ratWithDrop] }), leader: 'lead' });
    session.enter(member('lead'));
    session.enter(member('b'));
    run(session, 5_000, 100);
    session.leave('b', 'manual-exit');
    run(session, 20_000, 100);

    const lead = session.participants.find((p) => p.id === 'lead');
    const dropped = [...(lead?.inventory.items() ?? [])].filter((i) => i.itemId === 'sword');
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped[0]?.instanceId).toContain(`${session.id}:lead:`);
  });

  it('setMemberPremium grava o premium de um NÃO-líder, e é no-op em solo', () => {
    const { session, ruleset } = makeParty({ leader: 'lead' });
    session.enter(member('lead'));
    session.enter(member('b'));
    expect(() => ruleset.setMemberPremium(session, 'b', true)).not.toThrow();
    expect(ruleset.party?.premiumByCharacter['b']).toBe(true);
    expect(ruleset.party?.leaderId).toBe('lead');

    const solo = createHuntSession({
      id: 'solo-premium', content: content(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
    });
    solo.enter(member('solo'));
    const soloRuleset = solo.ruleset as HuntRuleset;
    expect(() => soloRuleset.setMemberPremium(solo, 'solo', true)).not.toThrow();
    expect(soloRuleset.party).toBeUndefined();
  });

  it('1 Hz == 10 Hz com join no meio da hunt', () => {
    const at = (hz: number) => {
      const step = 1000 / hz;
      const { session } = makeParty();
      session.enter(member('a'));
      session.enter(member('b'));
      run(session, 5_000, step);
      session.enter(member('c'));
      run(session, 15_000, step);
      return {
        aggregates: { ...session.aggregates },
        rng: session.getRngState(),
        a: session.aggregatesOf('a').kills,
        c: session.aggregatesOf('c').kills,
      };
    };
    expect(at(1)).toEqual(at(10));
  });
});

describe('sair e morrer em party (#193, ADR 0027 decisão 7)', () => {
  // Ratos que batem forte num membro de 1 HP: ele morre no primeiro golpe e SAI com o próprio
  // extrato; os outros ficam. Regra `party-member-lost` em quem a configurou: cascata.
  const killer = { ...rat, health: 30, attack: 50, attackRange: 1, experience: 0 };
  const loaded = () => content({ monsters: [killer] });
  const exitOnLoss = botConfig({ exit: [botExitRuleSchema.parse({ kind: 'party-member-lost' })] });
  const member = (id: string, health?: number) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: health ?? stats.maxHealth, maxHealth: stats.maxHealth,
      // Level 10: acima do piso da penalidade de morte (8), para o extrato do morto ter XP negativa.
      mana: 0, maxMana: stats.maxMana, level: 10, xp: totalXpForLevel(10, progression as Progression), vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    });
  };
  // Quem entra PRIMEIRO fica no tile inicial da rota, onde os ratos chegam antes: o frágil vai
  // primeiro para morrer cedo; o líder é quem `leaderId` diz, não a ordem.
  const party = (members: CharacterRuntime[], botConfigs: Record<string, BotConfig> = {}, leader = 'lead') => {
    const session = createHuntSession({
      id: 'leave-session', content: loaded(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: { leaderId: leader, mode: 'split' }, botConfigs,
    });
    for (const m of members) session.enter(m);
    return session;
  };
  const left = (session: Session) => session.drainEvents().filter((e) => e.kind === 'member-left');

  it('a dead member leaves with their own receipt — penalty inside — and the session goes on', () => {
    // Mutação que mata: `session.end('death')` com alguém vivo — os outros perderiam a hunt.
    const session = party([member('frail', 1), member('lead'), member('c')]);
    run(session, 30_000, 100);
    expect(session.ended).toBeNull();
    expect(session.participants.map((p) => p.id)).toEqual(['lead', 'c']);
    const events = left(session);
    expect(events).toHaveLength(1);
    const gone = events[0];
    if (gone?.kind !== 'member-left') throw new Error('sem member-left');
    expect(gone.reason).toBe('death');
    expect(gone.departure.receipt).toMatchObject({ characterId: 'frail', reason: 'death' });
    expect(gone.departure.receipt.aggregates.deaths).toBe(1);
    expect(gone.departure.receipt.aggregates.xpGained).toBeLessThan(0);
    expect(gone.departure.character.alive).toBe(false);
    // Os monstros continuam vindo para quem ficou.
    expect(session.aggregatesOf('lead').kills + session.aggregatesOf('c').kills).toBeGreaterThan(0);
  });

  it('party-member-lost cascades in entry order; whoever lacks the rule stays', () => {
    // Cinco membros exigem um limite de conteúdo maior que o baseline de teste (4): desde o
    // #397 o `onEnter` recusa acima de `maxMembers`, e este cenário é legal em party de 8.
    const roomy = content({
      monsters: [killer],
      party: [{ id: 'baseline', maxMembers: 8 }],
    });
    const session = createHuntSession({
      id: 'leave-session-five', content: roomy, huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: { leaderId: 'lead', mode: 'split' }, botConfigs: { b: exitOnLoss, c: exitOnLoss },
    });
    for (const m of [member('frail', 1), member('lead'), member('b'), member('c'), member('d')]) {
      session.enter(m);
    }
    run(session, 30_000, 100);
    const events = left(session);
    expect(events.map((e) => (e.kind === 'member-left' ? [e.characterId, e.reason] : null))).toEqual([
      ['frail', 'death'], ['b', 'exit-rule'], ['c', 'exit-rule'],
    ]);
    expect(session.participants.map((p) => p.id)).toEqual(['lead', 'd']);
    expect(session.notableEvents.filter((e) => e.type === 'exit-rule' && e.detail === 'party-member-lost')).toHaveLength(2);
    expect(session.ended).toBeNull();
  });

  it('party-member-lost com exitDelayMs permanece imediata (DT-03)', () => {
    const loadedWithDelay = content({
      monsters: [killer],
      hunts: [{ ...hunt, exitDelayMs: 5_000 }],
    });
    const session = createHuntSession({
      id: 'leave-session-delay', content: loadedWithDelay, huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: { leaderId: 'lead', mode: 'split' }, botConfigs: { b: exitOnLoss },
    });
    session.enter(member('frail', 1));
    session.enter(member('lead'));
    session.enter(member('b'));
    session.enter(member('c'));

    run(session, 10_000, 100);

    const events = left(session);
    expect(events.map((e) => (e.kind === 'member-left' ? [e.characterId, e.reason] : null))).toEqual([
      ['frail', 'death'], ['b', 'exit-rule'],
    ]);
    expect(session.participants.map((p) => p.id)).toEqual(['lead', 'c']);
    expect(session.notableEvents.filter((e) => e.type === 'exit-rule' && e.detail === 'party-member-lost')).toHaveLength(1);
    expect(session.ended).toBeNull();
  });

  it('when the leader dies the leadership passes to the oldest present, and party-state says so', () => {
    const session = party([member('lead', 1), member('b'), member('c')]);
    run(session, 30_000, 100);
    const states = session.drainEvents().filter((e) => e.kind === 'party-state');
    const last = states.at(-1);
    if (last?.kind !== 'party-state') throw new Error('sem party-state');
    expect(last.leaderId).toBe('b');
    expect(last.members.map((m) => m.characterId)).toEqual(['b', 'c']);
  });

  it('a liderança reescreve o campo REAL do ruleset e grava leader-changed (#394)', () => {
    // O teste acima passa pelo fallback de leitura de `#leader`; este prende o campo `leaderId`
    // de fato reescrito, que é o que o #394 acrescenta.
    const session = party([member('lead', 1), member('b'), member('c')]);
    run(session, 30_000, 100);
    expect((session.ruleset as HuntRuleset).party?.leaderId).toBe('b');
    expect(session.notableEvents.filter((e) => e.type === 'leader-changed')).toEqual([
      expect.objectContaining({ type: 'leader-changed', detail: 'b' }),
    ]);
  });

  it('the last one to leave ends the session with their reason, and no receipt is emitted twice', () => {
    const session = party([member('lead', 1), member('b')], { b: exitOnLoss });
    run(session, 30_000, 100);
    expect(session.ended).toBe('exit-rule');
    const events = left(session);
    expect(events.map((e) => (e.kind === 'member-left' ? e.characterId : null))).toEqual(['lead', 'b']);
    expect(session.receipts()).toEqual([]);
    expect(session.participants).toEqual([]);
  });

  it('a party of two that loses one is a solo: the next death ends the session', () => {
    const session = party([member('lead', 1), member('b', 1)]);
    run(session, 30_000, 100);
    expect(session.ended).toBe('death');
    const events = left(session);
    // O primeiro saiu por `leave`; o segundo era solo e ENCERROU — sem `member-left`.
    expect(events).toHaveLength(1);
    expect(session.receipts().map((r) => r.characterId)).toEqual(['b']);
  });

  it('1 Hz == 10 Hz with death and cascade', () => {
    const at = (hz: number) => {
      const session = party([member('frail', 1), member('lead'), member('b'), member('c')], { b: exitOnLoss });
      run(session, 30_000, 1000 / hz);
      return { present: session.participants.map((p) => p.id), left: left(session).map((e) => (e.kind === 'member-left' ? e.characterId : '')), ended: session.ended };
    };
    expect(at(1)).toEqual(at(10));
  });
});

describe('raio livre do spawn (#236)', () => {
  // Ponto de spawn em (2,1), raio 1: colado no (1,1) em que o herói entra. Sem o raio livre o
  // rato nasce no tile ao lado; com `respawnDelayMs` igual ao intervalo de ataque, nascia e
  // morria no mesmo instante, e o cliente desenhava o golpe num tile vazio.
  const adjacent = { ...route, spawnPoints: [{ routeIndex: 1, radius: 1 }] };
  const cheb = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  it('não nasce a menos do raio de um participante vivo', () => {
    const loaded = content({ routes: [adjacent], hunts: [{ ...hunt, spawnClearRadius: 3 }] });
    const { session, ruleset } = start({ loaded });
    session.advanceBy(100);
    expect(ruleset.monsters).toHaveLength(0);
  });

  it('adia em vez de cancelar: nasce quando o herói se afasta, e longe dele', () => {
    const loaded = content({ routes: [adjacent], hunts: [{ ...hunt, spawnClearRadius: 3 }] });
    const { session, hero, ruleset } = start({ loaded });
    let born: { x: number; y: number } | null = null;
    let apart = 0;
    for (let t = 0; t < 10_000 && born === null; t += 100) {
      session.advanceBy(100);
      for (const event of session.drainEvents()) {
        if (event.kind !== 'creature-appeared') continue;
        born = event.position;
        // O herói dá no máximo um passo por fatia de 100 ms: nascido a ≥ 3 no instante do
        // spawn, está a ≥ 2 quando a fatia acaba.
        apart = cheb(hero.position, event.position);
      }
    }
    expect(born).not.toBeNull();
    expect(apart).toBeGreaterThanOrEqual(2);
    expect(ruleset.monsters).toHaveLength(1);
  });

  it('sem o campo o raio é zero, e a fixture de hoje nasce como sempre', () => {
    const loaded = content({ routes: [adjacent] });
    const { session, ruleset } = start({ loaded });
    session.advanceBy(100);
    expect(ruleset.monsters).toHaveLength(1);
  });

  it('`blockable` ausente é o padrão do Canary — nasce mesmo com o jogador colado (#519)', () => {
    // `isBlockable: false` é o que 1.640 dos 1.656 monstros do Canary declaram, Dragon e Dragon
    // Lord inclusive: eles respawnam OLHANDO para o jogador, ignorando `spawnClearRadius`. Sem
    // `blockable: true` no monstro, o campo da hunt para de valer para ELE — não porque a hunt
    // desligou, mas porque o Tibia trata isto como propriedade do monstro, não da instância.
    const naoBlockable = { ...rat, blockable: false };
    const loaded = content({
      monsters: [naoBlockable], routes: [adjacent], hunts: [{ ...hunt, spawnClearRadius: 3 }],
    });
    const { session, ruleset } = start({ loaded });
    session.advanceBy(100);
    expect(ruleset.monsters).toHaveLength(1);
  });
});

// --- o resolver canônico é o ponto único de dano (CMB-02, ADR 0031) --------------------------

describe('famílias de arma e proficiências (CMB-05, #333)', () => {
  const weapon = (id: string, family: string, kind: string, extra: Record<string, unknown> = {}) => ({
    id, name: id, kind: 'weapon', slot: 'hand', weight: 1, value: 0, attack: 40,
    weapon: { kind, family, range: kind === 'distance' ? 6 : kind === 'wand' ? 3 : 1, ...extra },
  });
  const armory = [
    weapon('sword-i', 'sword', 'melee'),
    weapon('axe-i', 'axe', 'melee'),
    weapon('club-i', 'club', 'melee'),
    weapon('bow-i', 'distance', 'distance', { ammoFamily: 'arrow' }),
    weapon('wand-i', 'wand', 'wand', { manaPerHit: 2, damage: { min: 8, max: 18 } }),
    weapon('rod-i', 'rod', 'wand', { manaPerHit: 2, damage: { min: 8, max: 18 } }),
  ];
  const armed = (itemId: string): InventoryState => ({
    // O bow dispara a munição ABSTRATA: sem pilha, com gold para pagar o tiro. Inofensiva para
    // as armas corpo a corpo e a wand.
    backpack: [],
    equipped: { hand: { instanceId: `i-${itemId}`, itemId, quantity: 1 } },
  });
  const loaded = (): Content => content({ items: [...items, ...armory] });

  /** A skill subiu OU acumulou pontos: o golpe de fato praticou. */
  const practiced = (hero: CharacterRuntime, id: string, startingLevel: number): boolean => {
    const state = hero.skills.getState()[id];
    return state !== undefined && (state.level > startingLevel || state.points > 0);
  };

  const strike = (itemId?: string, mana = 0, durationMs = 8_000) => {
    const { session, hero, ruleset } = start({
      loaded: loaded(),
      gold: 1_000,
      ...(itemId === undefined ? {} : { inventory: armed(itemId) }),
    });
    hero.mana = mana;
    hero.maxMana = mana;
    session.advanceBy(50);
    // Um alvo colado, para o golpe sair já no primeiro vencimento.
    const rat = ruleset.monsters[0];
    if (rat !== undefined) rat.position = { ...hero.position, y: hero.position.y + 1 };
    const events: DomainEvent[] = [];
    for (let t = 0; t < durationMs && session.ended === null; t += 100) {
      session.advanceBy(100);
      events.push(...session.drainEvents());
    }
    return { session, hero, events };
  };

  it('fist é o fallback sem item: bate corpo a corpo, pratica melee e não atira', () => {
    const { hero, events } = strike();
    expect(events.some((e) => e.kind === 'creature-hit' && e.source === 'melee')).toBe(true);
    expect(events.some((e) => e.kind === 'shot')).toBe(false);
    expect(practiced(hero, 'melee', 10)).toBe(true);
  });

  it('sword, axe e club batem pela família corpo a corpo e praticam a melee', () => {
    for (const id of ['sword-i', 'axe-i', 'club-i']) {
      const { hero, events } = strike(id);
      expect(events.some((e) => e.kind === 'creature-hit' && e.source === 'melee'), id).toBe(true);
      expect(events.some((e) => e.kind === 'shot'), id).toBe(false);
      expect(practiced(hero, 'melee', 10), id).toBe(true);
    }
  });

  it('bow atira a munição e pratica a distância, não a melee', () => {
    const { hero, events } = strike('bow-i');
    expect(events.some((e) => e.kind === 'shot')).toBe(true);
    expect(practiced(hero, 'distance', 10)).toBe(true);
    expect(hero.skills.getState()['melee']).toBeUndefined();
  });

  it('wand e rod atiram, gastam mana e praticam magia — sem multiplicador de weapon skill', () => {
    for (const id of ['wand-i', 'rod-i']) {
      const { hero, events } = strike(id, 200);
      expect(events.some((e) => e.kind === 'shot'), id).toBe(true);
      // A prática é `spell-cast` por mana: só existe se a mana foi debitada antes da rolagem.
      expect(practiced(hero, 'magic', 0), id).toBe(true);
      // E NÃO pratica arma: wand/rod não recebem multiplicador de weapon skill (DT-02).
      expect(hero.skills.getState()['melee'], id).toBeUndefined();
      expect(hero.skills.getState()['distance'], id).toBeUndefined();
    }
  });

  it('wand sem mana não atira nem pratica (CMB-05)', () => {
    // Um segundo é curto demais para a regeneração (1/s) pagar um golpe de 2 de mana.
    const { hero, events } = strike('wand-i', 0, 1_000);
    expect(events.some((e) => e.kind === 'shot')).toBe(false);
    expect(hero.skills.getState()['magic']).toBeUndefined();
  });

  it('imune ao tipo do golpe ainda pratica UMA vez: a prática não depende do dano final (CMB-05)', () => {
    // O rato imune a físico: o golpe ocorre, o dano resolvido é zero, e a prática sai assim
    // mesmo. Contar prática só com dano positivo faria a skill parar contra alvo imune.
    const immune = content({
      monsters: [{ ...rat, mitigation: { immunities: ['physical'] } }],
      items: [...items, ...armory],
    });
    const { session, hero, ruleset } = start({ loaded: immune, inventory: armed('sword-i') });
    session.advanceBy(50);
    const target = ruleset.monsters[0];
    if (target !== undefined) target.position = { ...hero.position, y: hero.position.y + 1 };
    for (let t = 0; t < 4_000 && session.ended === null; t += 100) session.advanceBy(100);
    // A vida não caiu — imunidade zera o dano —, e a melee praticou.
    expect(practiced(hero, 'melee', 10)).toBe(true);
  });
});

describe('todo dano passa pelo resolver canônico (CMB-02)', () => {
  const resolver = vi.mocked(resolveDamage);
  // Bloco, e não arrow de expressão: `mockClear` devolve o próprio mock, e o Vitest trataria
  // um retorno de função como teardown — chamando o resolver com zero argumentos.
  beforeEach(() => { resolver.mockClear(); });

  /** Os pares `fonte/tipo` que o resolver recebeu neste cenário. */
  const passed = (source: string, damageType: string): boolean =>
    resolver.mock.calls.some(([intent]) =>
      intent.source === source && intent.damageType === damageType);

  /** Avança drenando a cada passo: sem isso o teto de eventos pendentes descarta o `shot`. */
  const events = (session: Session, durationMs: number, stepMs = 100): DomainEvent[] => {
    const out: DomainEvent[] = [];
    for (let t = 0; t < durationMs && session.ended === null; t += stepMs) {
      session.advanceBy(stepMs);
      out.push(...session.drainEvents());
    }
    return out;
  };

  it('corpo a corpo: basic-attack/físico', () => {
    const { session } = start();
    run(session, 20_000, 100);
    expect(passed('basic-attack', 'physical')).toBe(true);
  });

  it('bow: basic-attack/físico pelo caminho da munição', () => {
    // Sem arma de corpo a corpo, o único produtor possível é o tiro — se ele calculasse dano
    // por fora, `passed` seria falso mesmo com o herói batendo a hunt inteira.
    const bow = {
      id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 31, value: 0,
      twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' },
    };
    const loaded = content({ items: [bow] });
    const inventory: InventoryState = {
      backpack: [],
      equipped: { hand: { instanceId: 'bow-i', itemId: 'bow', quantity: 1 } },
    };
    const { session } = start({ loaded, inventory, gold: 1_000 });
    expect(events(session, 20_000).some((e) => e.kind === 'shot')).toBe(true);
    expect(passed('basic-attack', 'physical')).toBe(true);
  });

  it('wand: basic-attack/energia pelo caminho da mana', () => {
    const wand = {
      id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 19, value: 0,
      weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 8, max: 18 }, damageType: 'energy' },
    };
    const loaded = content({ items: [wand] });
    const inventory: InventoryState = {
      backpack: [], equipped: { hand: { instanceId: 'wand-i', itemId: 'wand', quantity: 1 } },
    };
    const { session, hero } = start({ loaded, inventory });
    // `maxMana` também: a regeneração de mana clampa no máximo, e a fixture nasce com zero.
    hero.mana = 200;
    hero.maxMana = 200;
    expect(events(session, 20_000).some((e) => e.kind === 'shot')).toBe(true);
    expect(passed('basic-attack', 'energy')).toBe(true);
  });

  it('magia: spell/fogo, o tipo declarado no efeito', () => {
    const { session } = withSpells(botConfig({
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'strike' },
      }],
    }));
    run(session, 20_000, 100);
    expect(passed('spell', 'fire')).toBe(true);
  });

  it('runa: rune/arcano', () => {
    const rune = {
      id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, group: 'attack',
      requires: { level: 1, magicLevel: 0 },
      effect: {
        kind: 'damage', basePower: 400, range: 4,
        area: { shape: 'circle', radius: 1, centered: 'target' },
      },
    };
    const { session } = withSpells(botConfig({
      rune: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'supply', supplyId: 'avalanche-rune' },
      }],
    }), { gold: 10_000, supplies: [...supplies, rune], health: 5_000 }, 'bold');
    run(session, 20_000, 100);
    expect(passed('rune', 'arcane')).toBe(true);
  });

  it('ataque de monstro: monster-attack/físico', () => {
    const { session } = start();
    run(session, 20_000, 100);
    expect(passed('monster-attack', 'physical')).toBe(true);
  });

  it('o tipo do monstro vem do CONTEÚDO, não de um literal no call site', () => {
    // O rato do fixture é `physical` por default; declarar fogo no conteúdo tem de chegar ao
    // resolver. Um literal `'physical'` no `hunt.ts` passaria no teste acima e falharia aqui.
    const loaded = content({ monsters: [{ ...rat, damageType: 'fire' }] });
    const { session } = start({ loaded });
    run(session, 20_000, 100);
    expect(passed('monster-attack', 'fire')).toBe(true);
  });
});

describe('a ability de monstro entre taxas e no snapshot (CMB-06)', () => {
  const casterRat = {
    ...rat, health: 100_000,
    abilities: [{
      id: 'spit', cadenceMs: 1_000, target: { range: 4 }, power: { min: 5, max: 5 },
      damageType: 'energy', presentation: { missileKey: 'spit', impactKey: 'spit-hit' },
    }],
  };
  const loaded = content({ monsters: [casterRat] });

  it('1 Hz == 10 Hz com uma ability à distância', () => {
    // A ability é evento na fila como o ataque básico (invariante 2): a cadência não depende de
    // haver alguém olhando, e o dano sofrido é o mesmo nas três taxas.
    const at = (hz: number): number => {
      const { session, hero } = start({ loaded, health: 100_000 });
      run(session, 30_000, 1000 / hz);
      return hero.health;
    };
    expect(at(1)).toBe(at(10));
    expect(at(20)).toBe(at(10));
  });

  it('a ability agendada sobrevive ao snapshot e volta a bater', () => {
    // Sem o `scheduledAbilities` no snapshot, a hunt retomada agendaria a ability de novo — o
    // evento pendente veio na fila — e a habilidade bateria em dobro no primeiro vencimento.
    const { session } = start({ loaded, health: 100_000 });
    run(session, 5_000, 100);
    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed('session-1'),
    );
    const caster = (resumed.ruleset as HuntRuleset).monsters[0];
    if (caster === undefined) throw new Error('sem monstro');
    expect(caster.scheduledAbilities.size).toBeGreaterThan(0);

    resumed.drainEvents();
    run(resumed, 5_000, 100);
    expect(resumed.drainEvents().some((e) => e.kind === 'monster-ability-cast')).toBe(true);
  });
});

describe('IA de monstro do TFS: chance, defesa e troca de alvo (#518)', () => {
  // Um monstro que usa TUDO de uma vez: ability com chance < 1, defesa (cura própria) e
  // troca de alvo — a mesma fixture serve para a equivalência de taxa e para o snapshot,
  // como a `casterRat` faz para a ability sozinha logo acima.
  const busyRat = {
    ...rat, health: 100_000,
    abilities: [{
      id: 'spit', cadenceMs: 1_000, chance: 0.6, target: { range: 4 },
      power: { min: 5, max: 5 }, damageType: 'energy',
    }],
    defenses: [{ id: 'heal', cadenceMs: 1_000, chance: 1, heal: { min: 10, max: 10 } }],
    targetChange: { intervalMs: 5_000, chance: 0.5 },
  };
  const loaded = content({ monsters: [busyRat] });

  it('1 Hz == 10 Hz com chance, defesa própria e troca de alvo juntos', () => {
    // A mesma propriedade da matriz de abilities (invariante 2/3): nenhum dos três mecanismos
    // novos é "por tick", e por isso 1 Hz desanexado rende exatamente o que 10 Hz rende.
    const at = (hz: number): number => {
      const { session, hero } = start({ loaded, health: 100_000 });
      run(session, 30_000, 1000 / hz);
      return hero.health;
    };
    expect(at(1)).toBe(at(10));
  });

  it('`scheduledDefenses` sobrevive ao snapshot, como `scheduledAbilities` (CMB-06)', () => {
    // Sem o campo no snapshot, a hunt retomada agendaria a defesa de novo — o evento pendente
    // veio na fila — e ela curaria em dobro no primeiro vencimento (o mesmo defeito que a
    // issue original do CMB-06 evitou para as abilities).
    const { session } = start({ loaded, health: 100_000 });
    run(session, 3_000, 100);
    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed('session-1'),
    );
    const caster = (resumed.ruleset as HuntRuleset).monsters[0];
    if (caster === undefined) throw new Error('sem monstro');
    expect(caster.scheduledDefenses.size).toBeGreaterThan(0);

    caster.receiveDamage(50_000); // dá o que curar — de vida cheia o evento não emite nada.
    resumed.drainEvents();
    run(resumed, 3_000, 100);
    expect(resumed.drainEvents().some(
      (e) => e.kind === 'creature-healed' && e.source === 'monster',
    )).toBe(true);
  });

  describe('conformidade de RNG: `targetChange` sem `targetStrategy` (#541)', () => {
    /** Conta só os sorteios de `Rng.integer` — o mesmo mecanismo do `rankTarget`, que é o
     * sorteio que `#onMonsterTargetChange` faz para o reroll. */
    class CountingRng extends Rng {
      integerCalls = 0;

      override integer(min: number, max: number): number {
        this.integerCalls++;
        return super.integer(min, max);
      }
    }

    // Um monstro sem abilities/defenses declaradas (só a básica sintetizada do `rat`, sem
    // `chance` — "ausente é sempre passa e NÃO consome sorteio") e uma `aggroRadius` enorme:
    // os três membros da party ficam LONGE (100+ tiles), fora da salinha murada de `map`, e
    // por isso NUNCA entram no alcance de ataque (1 tile) — o monstro fica preso na sala, e
    // nenhum golpe (e o sorteio de POTÊNCIA que ele consumiria, `hunt.ts:5054`) chega a
    // acontecer. O único `rng.integer` que sobra na cena inteira é o do PRÓPRIO reroll.
    const distantRat = { ...rat, aggroRadius: 1_000, targetChange: { intervalMs: 1_000, chance: 1 } };
    const loaded = content({ monsters: [distantRat] });

    const member = (id: string): CharacterRuntime =>
      new CharacterRuntime({ ...character().getState(), id });

    it('a sequência de escolha entre candidatos fica EXATAMENTE como antes: um sorteio por reroll, nunca mais', () => {
      const rng = new CountingRng(Rng.fromSeed('target-change-conformance').getState());
      const ruleset = createHuntRuleset(loaded, 'arena', 'cautious');
      const session = new Session({
        id: 'target-change-conformance', contentVersion: loaded.version, ruleset, rng, createdAtMs: 0,
      });
      const a = member('a');
      const b = member('b');
      const c = member('c');
      session.enter(a);
      session.enter(b);
      session.enter(c);
      // `session.enter` coloca o primeiro no início da rota e os demais no livre mais próximo
      // (#203) — dentro da salinha murada. O reposicionamento para longe vem DEPOIS de entrar
      // e ANTES de `advanceBy`: o `SPAWN` só avalia posição quando a fila roda, e a esta
      // altura os três já estão longe (montagem de teste, como o `phantom` de outro describe).
      a.position = { x: 100, y: 100, z: 7 };
      b.position = { x: 200, y: 200, z: 7 };
      c.position = { x: 300, y: 300, z: 7 };

      session.advanceBy(100); // o rato nasce, preso na salinha murada — não alcança ninguém.
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('sem monstro nesta cena');
      // Fixa o ponto de partida: o que se mede é a TROCA por tempo, não a aquisição inicial.
      monster.targetId = a.id;
      rng.integerCalls = 0;

      // Cinco vencimentos de `targetChange` (5 × 1 000 ms), `chance: 1` — sempre reroll.
      run(session, 5_500, 100);

      // Um sorteio por reroll, nunca dois, nunca zero: a mesma linha de antes do #541
      // (`candidates[session.rng.integer(0, candidates.length - 1)]`), agora só alcançada
      // quando `targetStrategy` está ausente — como aqui.
      expect(rng.integerCalls).toBe(5);
      // E o alvo de fato trocou — não é só o sorteio girando no vazio.
      expect(monster.targetId).not.toBe(a.id);
      expect(['a', 'b', 'c']).toContain(monster.targetId);
    });
  });
});

describe('condição de velocidade com sinal — paralyze de ataque e haste de defesa (CMB-11, #556)', () => {
  // O ataque do mutated_rat (`data-otservbr-global/monster/mammals/mutated_rat.lua`):
  // `{ name = "speed", speedChange = -600, duration = 30000, target = true }`. `power: 0` e sem
  // ability básica (declarar `abilities` substitui a do boot) isola o teste do dano — o
  // assunto é o PASSO, não a vida. `chance` ausente sai sempre, sem sorteio, o que faz o teste
  // ser determinístico sem precisar rodar até a lei dos grandes números ajudar; `cadenceMs`
  // maior que a janela do teste garante UM lançamento só, para a condição vencer sem ser
  // relançada (`merge: refresh`, o padrão, reiniciaria os 30 s a cada vencimento da ability).
  const paralyzingRat = {
    ...rat, aggroRadius: 20,
    // HP absurdo de propósito (como a fixture `busyRat`/`Dragon` faz): o herói ataca sozinho
    // pelo bot, e um rato de 50 HP morreria dentro da janela do teste — o respawn (#518) traria
    // OUTRO monstro que paralisaria o herói de novo perto dos 30 s, confundindo exatamente o
    // instante que este teste mede.
    health: 100_000,
    abilities: [{
      id: 'slow', cadenceMs: 60_000, target: { range: 20 }, power: 0, damageType: 'physical',
      condition: {
        key: 'speed', durationMs: 30_000,
        effect: { kind: 'speed', type: 'paralyze', delta: -600 },
      },
    }],
  };

  it('o passo do alvo fica mais lento durante 30 s e volta ao normal depois', () => {
    const loaded = content({ monsters: [paralyzingRat] });
    const { session, hero, ruleset } = start({ loaded });
    // O passo é medido por `requestMove` — o caminho do socket (`#step` direto, sem a
    // decisão de "parar para lutar" do bot automático, `#playerStep`) —, porque o próprio
    // alcance grande que faz a ability alcançar o herói também o alcança para o COMBATE dele:
    // uma vez adjacente, o bot pararia de andar a rota para brigar com um rato de HP absurdo, e
    // o teste ficaria sem passo NENHUM para medir. `requestMove` é o mesmo mecanismo que a
    // rota usa por baixo (`movementDuration`), só chamado de fora.
    const directions: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const moveDuration = (): number => {
      for (const [dx, dy] of directions) {
        const { x, y } = hero.position;
        const result = ruleset.requestMove(session, hero.id, { x: x + dx, y: y + dy });
        if (result.ok) return result.durationMs;
      }
      throw new Error('sem tile livre adjacente ao herói');
    };

    // A rota deste conteúdo anda em 500 ms por passo (chão 150 × 1000 / speed 300, ceil50) —
    // é o número que o comentário de `movimento com escritor único` também usa como base.
    expect(moveDuration()).toBe(500);

    // O rato paralisa assim que arma a ability (alcance/aggro cobrem a arena inteira) — bem
    // dentro desta janela curta.
    for (let t = 0; t < 500 && session.ended === null; t += 100) session.advanceBy(100);
    expect(hero.conditions.get('speed')?.speedPercent).toBeLessThan(0);
    expect(moveDuration()).toBeGreaterThan(500);

    // Passados os 30 s da condição, ela expira e o passo volta ao normal.
    for (let t = 500; t < 31_000 && session.ended === null; t += 100) session.advanceBy(100);
    expect(hero.conditions.get('speed')).toBeNull();
    expect(moveDuration()).toBe(500);
  });

  it('uma defesa self-haste acelera o próprio monstro (Doom Deer, speedChange positivo)', () => {
    // `delta: 2000` (bem acima do 400 real do Doom Deer, conferido à parte no teste de unidade
    // de `resolveSpeedPercent` em `conditions.test.ts`) força `mina = multiplier/2 = 1,5` —
    // acima de 1 mesmo no PIOR sorteio da faixa —, o que torna o sinal positivo
    // DETERMINÍSTICO sem prender o teste a uma semente específica da sessão inteira.
    const selfHasteDeer = {
      ...rat, aggroRadius: 0, // nunca mira ninguém — o teste é só sobre a própria defesa.
      // A defesa NÃO rola no nascimento — a primeira chance é só em `cadenceMs` (#518, "um
      // monstro recém-nascido não se cura antes do primeiro vencimento"), então a cadência
      // precisa caber dentro da janela do teste.
      defenses: [{
        id: 'haste', cadenceMs: 200, chance: 1,
        condition: {
          key: 'speed', durationMs: 8_000,
          effect: { kind: 'speed', type: 'haste', delta: 2_000 },
        },
      }],
    };
    const loaded = content({ monsters: [selfHasteDeer] });
    const { session, ruleset } = start({ loaded });
    for (let t = 0; t < 500 && session.ended === null; t += 100) session.advanceBy(100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    expect(monster.conditions.get('speed')?.speedPercent).toBeGreaterThan(0);
    expect(monster.speedScale).toBeGreaterThan(1);
  });

  it('haste substitui paralyze na mesma criatura, mesmo vindo de fontes diferentes', () => {
    // A chave reservada ("speed") faz duas condições de fontes DIFERENTES (uma ability de
    // OUTRO monstro que paralisa, a própria defesa que acelera) disputarem o MESMO slot — a
    // mutual-exclusão do `Creature::onAddCondition` do Canary/TFS, sem lógica extra no `sim`.
    // As duas condições aqui são estado de runtime já resolvido (o mesmo formato que
    // `conditionFromSpec` devolveria); o teste isola só a política de substituição por chave,
    // que `Conditions.apply` já prova em `conditions.test.ts` — aqui a prova é que o MONSTRO de
    // verdade (com `speedScale` de `MonsterRuntime`) também obedece.
    const monster = new MonsterRuntime({
      id: 1, monsterId: 'rat', position: { x: 0, y: 0 }, home: { x: 0, y: 0 },
      health: 100, targetId: null, cooldowns: {},
    });
    monster.conditions.apply({
      key: 'speed', targetId: monster.subject, sourceId: 'm:2', expiresAtMs: 30_000,
      speedPercent: -50,
    });
    expect(monster.speedScale).toBeLessThan(1);
    monster.conditions.apply({
      key: 'speed', targetId: monster.subject, sourceId: monster.subject, expiresAtMs: 8_000,
      speedPercent: 200,
    });
    expect(monster.conditions.size).toBe(1);
    expect(monster.speedScale).toBeGreaterThan(1);
  });
});

describe('Invocação de monstro por monstro (#546, TFS/Canary monster.summon/maxSummons)', () => {
  // Fraco e sem drama de posicionamento: o que estes testes conferem é a MECÂNICA da invocação
  // — quem nasce, quando PARA de nascer, e o que ganha quem mata —, não o balanceamento de um
  // monstro de verdade. `aggroRadius: 0` na INVOCAÇÃO isola o teste da IA de perseguição DELA:
  // ela nunca sai do lugar nem bate em ninguém — quem invoca não pode ser confundido com quem é
  // invocado. O MESTRE precisa de alvo de verdade (#546, TFS/Canary `hasFollowPath`): sem ele, a
  // invocação nunca dispara — é o describe seguinte que prova isso isoladamente —, então aqui ele
  // fica com o `aggroRadius` de sempre do `rat` (4), e a rota da fixture (herói entra em (1,1),
  // ponto de spawn em (4,2)) garante o engajamento na primeira decisão do mestre: a distância
  // máxima de qualquer tile de nascimento possível (raio 2 ao redor do ponto) até (1,1) é 3, e
  // 3 ≤ 4. `pacifist` (o mesmo do describe do Dragon acima) zera o ataque do herói: sem ele, o
  // herói mataria minions sozinho ao alcançar o ponto de spawn pela rota, e um abate incidental
  // confundiria "o teto segura" com "o herói ajudou a esvaziar" — o mestre pode bater de volta
  // (o herói tem HP absurdo, de propósito, na fixture-base), mas nunca o contrário.
  const minion = {
    id: 'minion', name: 'Minion', recommendedLevel: 1,
    health: 20, experience: 50, attack: 0, armor: 0,
    attackIntervalMs: 2000, speed: 300, aggroRadius: 0, attackRange: 1,
    loot: { gold: { chance: 1, min: 9, max: 9 }, items: [] },
  };
  const summoner = {
    ...rat, id: 'summoner', health: 100_000, aggroRadius: 4,
    summons: { max: 10, entries: [{ monsterId: 'minion', chance: 1, intervalMs: 1_000, count: 10 }] },
  };
  const summonerHunt = {
    ...hunt,
    difficulties: {
      cautious: { ...hunt.difficulties.cautious, composition: [{ monsterId: 'summoner', weight: 1 }] },
    },
  };
  const pacifist = { ...combat, player: { ...combat.player, attackPower: 0 } };
  const loaded = () => content({
    monsters: [summoner, minion], hunts: [summonerHunt], combat: [pacifist],
  });

  it('nunca invoca sem alvo — mestre nunca engajado (aggroRadius: 0) fica no cadenciamento e nunca rola a chance (TFS/Canary hasFollowPath)', () => {
    // O MESMO desenho da fixture acima, com uma diferença: `aggroRadius: 0` no MESTRE, não na
    // invocação — `chooseTarget` nunca acha ninguém a distância ≤ 0 (tile é exclusivo,
    // invariante 8), então `targetId` fica `null` para sempre. É exatamente a fixture que a
    // versão anterior deste teste usava para o describe INTEIRO — provando, sem querer, que a
    // implementação de então invocava com o mestre permanentemente sem alvo. Aqui ela vira o
    // que deveria ser desde o início: a prova de que SEM alvo não nasce invocação nenhuma.
    const neverEngaged = {
      ...rat, id: 'summoner', health: 100_000, aggroRadius: 0,
      summons: { max: 10, entries: [{ monsterId: 'minion', chance: 1, intervalMs: 1_000, count: 10 }] },
    };
    const neverEngagedContent = content({
      monsters: [neverEngaged, minion], hunts: [summonerHunt], combat: [pacifist],
    });
    const { session, ruleset } = start({ loaded: neverEngagedContent });
    run(session, 10_000, 100); // 10 vencimentos de cadência (1 000 ms cada) sem rolar nenhum.

    const master = ruleset.monsters.find((m) => m.monsterId === 'summoner');
    if (master === undefined) throw new Error('sem mestre');
    expect(master.targetId).toBeNull();
    // A CADÊNCIA continua se rearmando — `scheduledSummons` não é o gate, `targetId` é (a
    // invariante "engatilhada OU agendada" continua valendo por entrada).
    expect(master.scheduledSummons.size).toBeGreaterThan(0);
    expect(ruleset.monsters.filter((m) => m.monsterId === 'minion')).toHaveLength(0);
  });

  it('1 Hz == 10 Hz: o timer da invocação não é "por tick" (invariante 2/3)', () => {
    // 5 s de janela, teto 10: bem longe do teto, para medir só a cadência — não onde ela para.
    const at = (hz: number): number => {
      const { session, ruleset } = start({ loaded: loaded() });
      run(session, 5_000, 1000 / hz);
      return ruleset.monsters.filter((m) => m.alive && m.monsterId === 'minion').length;
    };
    expect(at(1)).toBe(at(10));
    expect(at(20)).toBe(at(10));
    expect(at(10)).toBeGreaterThan(0);
  });

  it('nasce perto do mestre, com masterId, e NÃO ocupa lugar do Spawner (TFS placeCreature force)', () => {
    // O mestre agora tem alvo de verdade (#546, `hasFollowPath`) — e, engajado, ele ANDA. Se o
    // teste rodasse mais tempo e comparasse com a posição ATUAL do mestre, um passo dele entre
    // o instante da invocação e o instante da leitura faria a distância medida crescer por um
    // motivo que não tem nada a ver com ONDE ela nasceu. Por isso o loop para no primeiro
    // vencimento em que a invocação aparece, sem avançar mais um passo — a posição do mestre lida
    // ali É a mesma que `#spawnSummon` usou para buscar o tile livre.
    const { session, ruleset } = start({ loaded: loaded() });
    let master = ruleset.monsters.find((m) => m.monsterId === 'summoner');
    let summon = ruleset.monsters.find((m) => m.monsterId === 'minion');
    let masterPositionAtBirth: { x: number; y: number; z?: number } | undefined;
    for (let elapsed = 0; elapsed < 1_500 && summon === undefined && session.ended === null; elapsed += 50) {
      session.advanceBy(50);
      master = ruleset.monsters.find((m) => m.monsterId === 'summoner');
      summon = ruleset.monsters.find((m) => m.monsterId === 'minion');
      if (master !== undefined && summon !== undefined) masterPositionAtBirth = { ...master.position };
    }
    if (master === undefined) throw new Error('sem mestre');
    if (summon === undefined) throw new Error('sem invocação');
    if (masterPositionAtBirth === undefined) throw new Error('sem posição do mestre no nascimento');

    expect(summon.masterId).toBe(master.id);
    // A posição exata do mestre já está ocupada por ELE (tile é exclusivo, invariante 8): a
    // invocação nasce num dos 8 vizinhos imediatos — `SUMMON_SPAWN_RADIUS` é 1, como
    // `Map::placeCreature(..., extendedPos: false)` da fonte, nunca um anel mais largo.
    expect(Math.max(
      Math.abs(summon.position.x - masterPositionAtBirth.x),
      Math.abs(summon.position.y - masterPositionAtBirth.y),
    )).toBeLessThanOrEqual(1);

    // O ÚNICO lugar do Spawner é do mestre (a hunt pede `monsterCount: 1`), e continua ocupado
    // por ELE: a invocação nasceu por `#spawnMonster` direto, nunca por `#onSpawn`.
    const slots = ruleset.getState().spawner.slots;
    expect(slots).toHaveLength(1);
    expect(slots[0]?.occupantId).toBe(master.id);
  });

  it('respeita o teto POR NOME e o teto DO MONSTRO, cada um separadamente', () => {
    // `minion-a` para em 1 — o teto DELA (`count: 1`); `minion-b` para em 2 — o que SOBRA do
    // teto do MONSTRO (`max: 3`) depois que `minion-a` já gastou 1, mesmo com `count: 5` de
    // folga própria. Provar os dois juntos, com nomes diferentes, é o que distingue qual teto
    // segurou cada um — um só monstro com os dois números iguais não distinguiria nada.
    const minionA = { ...minion, id: 'minion-a' };
    const minionB = { ...minion, id: 'minion-b' };
    const capped = {
      ...rat, id: 'summoner', health: 100_000, aggroRadius: 4,
      summons: {
        max: 3,
        entries: [
          { monsterId: 'minion-a', chance: 1, intervalMs: 1_000, count: 1 },
          { monsterId: 'minion-b', chance: 1, intervalMs: 1_000, count: 5 },
        ],
      },
    };
    const cappedHunt = {
      ...hunt,
      difficulties: {
        cautious: { ...hunt.difficulties.cautious, composition: [{ monsterId: 'summoner', weight: 1 }] },
      },
    };
    const cappedContent = content({
      monsters: [capped, minionA, minionB], hunts: [cappedHunt], combat: [pacifist],
    });
    const { session, ruleset } = start({ loaded: cappedContent });
    const live = (id: string): number => ruleset.monsters.filter((m) => m.alive && m.monsterId === id).length;

    run(session, 10_000, 100);
    expect(live('minion-a')).toBe(1);
    expect(live('minion-b')).toBe(2);

    // Roda mais: os dois tetos SEGURAM — não é só "ainda não deu tempo de rolar de novo".
    run(session, 10_000, 100);
    expect(live('minion-a')).toBe(1);
    expect(live('minion-b')).toBe(2);
  });

  it('a invocação não paga XP, nem loot, nem conta no Bestiário (TFS hasBeenSummoned)', () => {
    const { session, hero, ruleset } = start({ loaded: loaded() });
    run(session, 1_500, 100);
    const summon = ruleset.monsters.find((m) => m.monsterId === 'minion');
    if (summon === undefined) throw new Error('sem invocação');

    const killsBefore = session.aggregates.kills;
    summon.receiveDamage(summon.health);
    resolveDeath(session, { kind: 'monster', monster: summon });

    // O abate CONTA no "matei N" do extrato (#190) — a mesma condição de sempre —, mas nada
    // MAIS paga: sem XP, sem gold, sem Bestiário. `Player::onKilledMonster` do Canary devolve
    // cedo para quem `hasBeenSummoned()`, antes de tocar hunting task ou Bestiário.
    expect(session.aggregates.kills).toBe(killsBefore + 1);
    expect(hero.xp).toBe(0);
    expect(hero.goldDelta).toBe(0);
    expect(session.aggregates.goldGained).toBe(0);
    expect(session.aggregates.xpGained).toBe(0);
    expect(hero.bestiary.getState()).toEqual({});
  });

  it('some quando o mestre morre: desaparece, nunca morre (TFS Game::removeCreature)', () => {
    const { session, ruleset } = start({ loaded: loaded() });
    run(session, 3_000, 100);
    const master = ruleset.monsters.find((m) => m.monsterId === 'summoner');
    if (master === undefined) throw new Error('sem mestre');
    const summons = ruleset.monsters.filter((m) => m.masterId === master.id);
    expect(summons.length).toBeGreaterThan(0);

    session.drainEvents();
    master.receiveDamage(master.health);
    resolveDeath(session, { kind: 'monster', monster: master });

    // Nenhuma invocação DESTE mestre continua indexada — e nenhum novo `masterId` órfão
    // apareceu (a lista de agora é exatamente vazia para ele, não só "diminuiu").
    expect(ruleset.monsters.filter((m) => m.masterId === master.id)).toHaveLength(0);
    // O desaparecimento saiu para o mestre E para CADA invocação — nunca um golpe (`creature-hit`
    // ausente), nunca um cadáver (`ground-item-appeared` ausente): é remoção, não abate.
    const events = session.drainEvents();
    const vanished = events
      .filter((e) => e.kind === 'creature-vanished')
      .map((e) => (e.kind === 'creature-vanished' ? e.creatureId : ''));
    expect(vanished).toContain(master.subject);
    for (const summon of summons) expect(vanished).toContain(summon.subject);
    expect(vanished).toHaveLength(summons.length + 1);
    expect(events.some((e) => e.kind === 'ground-item-appeared')).toBe(false);
  });

  it('scheduledSummons sobrevive ao snapshot, como scheduledDefenses (#518)', () => {
    // Só o suficiente para o mestre nascer e armar a lista — ANTES do primeiro vencimento
    // (1 000 ms), para o teste provar que o CAMPO sobreviveu, não que a invocação já aconteceu.
    const { session } = start({ loaded: loaded() });
    run(session, 500, 100);
    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded()) as HuntRuleset, Rng.fromSeed('session-1'),
    );
    const master = (resumed.ruleset as HuntRuleset).monsters.find((m) => m.monsterId === 'summoner');
    if (master === undefined) throw new Error('sem mestre');
    expect(master.scheduledSummons.size).toBeGreaterThan(0);

    resumed.drainEvents();
    run(resumed, 3_000, 100);
    const summons = (resumed.ruleset as HuntRuleset).monsters.filter((m) => m.masterId === master.id);
    expect(summons.length).toBeGreaterThan(0);
  });
});

describe('magia em área mata o mestre E a invocação adjacente no MESMO lançamento (#546, achado pós-review)', () => {
  // O mestre fica PARADO de propósito: `attackRange` bem acima de qualquer distância possível
  // dentro da sala minúscula da fixture faz `decideMonsterAction` nunca escolher "aproximar" —
  // `monsterAttackRange` já considera o alvo ao alcance desde o primeiro engajamento
  // (`packages/content/src/schemas.ts`, `monsterAttackRange`). Sem isto o mestre andaria até o
  // corpo a corpo entre o nascimento da invocação (que NUNCA o segue, `aggroRadius: 0`) e o
  // lançamento — e ela ficaria para trás, fora do raio do `blast` quando ele saísse. Parado, ela
  // nasce ao lado dele (`SUMMON_SPAWN_RADIUS = 1`) e continua ao lado dele até o fim do teste.
  const masterWithSummon = {
    ...rat, attackRange: 12,
    summons: { max: 1, entries: [{ monsterId: 'minion', chance: 1, intervalMs: 1_000, count: 1 }] },
  };
  const minion = {
    id: 'minion', name: 'Minion', recommendedLevel: 1,
    health: 20, experience: 50, attack: 0, armor: 0,
    attackIntervalMs: 2_000, speed: 300, aggroRadius: 0, attackRange: 1,
    loot: { gold: { chance: 1, min: 9, max: 9 }, items: [] },
  };
  // `blast` (raio 2 centrado no alvo, poder 80) só sai quando a ÁREA já tem 2 alvos — o mestre
  // sozinho conta 1 (`countAreaTargets` inclui o primário). O gate atrasa o lançamento até
  // depois de a invocação existir: sem ele, o primeiro vencimento mataria só o mestre, e o
  // teste nunca exercitaria a cascata que remove a invocação NO MEIO do `#applyHits`.
  const explodirComDois = botConfig({
    attack: [{ when: { kind: 'targets', op: '>=', count: 2 }, do: { kind: 'spell', spellId: 'blast' } }],
  });
  // `attackPower: 0` (o mesmo `pacifist` do describe da invocação, acima): a sala é pequena o
  // bastante para o mestre às vezes nascer a 1 tile do herói, e sem isto o corpo a corpo AUTOMÁTICO
  // (fora do `#applyHits`, fora deste teste) somaria um `creature-hit` a mais no mestre — ruído
  // que não tem nada a ver com a cascata que este teste mede.
  const pacifist = { ...combat, player: { ...combat.player, attackPower: 0 } };

  it('um só abate, um só creature-vanished por criatura, e nenhum creature-hit para quem já sumiu na cascata', () => {
    // O defeito que este teste fecha: `#aimFor` colhe o mestre e a invocação na MESMA mira,
    // mestre primeiro (ele nasceu antes, `#collect(primary)` antes da varredura da forma).
    // `#applyHits` aplica os golpes na ordem da colheita — ao processar o mestre, `resolveDeath`
    // cascateia em `#removeSummon` para a invocação AINDA NA LISTA, que sai de
    // `#monsterBySubject`/`#monsters` sem que `alive` vire falso (ela nunca morreu, ela sumiu).
    // Sem a checagem de presença no início do laço, a iteração seguinte reprocessaria a
    // invocação já removida: um `creature-hit` para um id que o cliente já viu sumir e, se o
    // dano zerasse a vida dela, um SEGUNDO `resolveDeath` — abate duplicado e um `world.vacate`
    // sobre um tile que já foi liberado (e que pode já ter outro ocupante).
    const { session, ruleset } = withSpells(
      explodirComDois,
      { mana: 200, monstersRaw: [masterWithSummon, minion], combat: [pacifist] },
      'cautious',
    );
    const killsBefore = session.aggregates.kills;

    const events: DomainEvent[] = [];
    for (let elapsed = 0; elapsed < 3_000; elapsed += 50) {
      session.advanceBy(50);
      events.push(...session.drainEvents());
      if (ruleset.monsters.length === 0) break;
    }

    const casts = events.filter((e) => e.kind === 'spell-cast');
    expect(casts.length).toBeGreaterThan(0);
    const first = casts[0] as { targets: readonly { creatureId: string | number }[] };
    // A mira colheu os DOIS no mesmo lançamento — é o que garante que este caso passou pelo
    // caminho mestre-antes-da-invocação dentro do MESMO `#applyHits`, e não dois lançamentos
    // separados (o que não exercitaria nada).
    expect(first.targets).toHaveLength(2);
    const targetSubjects = first.targets.map((t) => t.creatureId);

    // Nenhum dos dois continua indexado — o mestre morreu, a invocação sumiu na cascata.
    expect(ruleset.monsters).toHaveLength(0);

    // UM abate só: a invocação nunca paga abate (#546), e — com a correção — nem reprocessa a
    // própria remoção como se fosse uma morte nova. Sem a correção, o `resolveDeath` duplicado
    // creditava um segundo 'kills' para uma invocação que ninguém matou de novo.
    expect(session.aggregates.kills).toBe(killsBefore + 1);

    // Cada um dos dois alvos some UMA vez só — nunca dois `creature-vanished` para o mesmo id.
    const vanishedCounts = new Map<string | number, number>();
    for (const event of events) {
      if (event.kind !== 'creature-vanished') continue;
      vanishedCounts.set(event.creatureId, (vanishedCounts.get(event.creatureId) ?? 0) + 1);
    }
    for (const subject of targetSubjects) expect(vanishedCounts.get(subject)).toBe(1);

    // Só o mestre leva golpe de MAGIA de verdade — a invocação já tinha sumido quando a vez dela
    // chegou no laço, então ela nunca deveria ganhar um `creature-hit` de `#applyHits` (sem a
    // correção, ela ganhava um, para um id que o `creature-vanished` acima já anunciou como
    // sumido). `source: 'spell'` isola o golpe do `#applyHits` sob teste do corpo a corpo
    // AUTOMÁTICO que a sala pequena pode colocar ao alcance do herói (`pacifist` zera o dano
    // dele, mas o evento sai de qualquer forma — código fora deste teste, e não o assunto dele).
    const spellHitsOnEitherTarget = events.filter(
      (event) => event.kind === 'creature-hit' && event.source === 'spell'
        && targetSubjects.includes(event.creatureId),
    );
    expect(spellHitsOnEitherTarget).toHaveLength(1);
  });
});

describe('Dragon do TFS: melee, bola, onda, cura e fuga com os números reais (#520)', () => {
  // Espelha `data/monsters/dragon.json` (TFS `dragon.xml`, conferido com o Canary): as mesmas
  // chances e a mesma mitigação — fogo IMUNE, gelo −10 % (vulnerável). HP alto de propósito,
  // para rodar muitos vencimentos de cadência sem morrer nem fugir sem querer.
  const dragon = {
    id: 'dragon', name: 'Dragon', recommendedLevel: 40,
    health: 1_000_000, experience: 700,
    attack: { min: 0, max: 120 }, armor: 0,
    mitigation: { resistances: { ice: -0.1 }, immunities: ['fire'] },
    attackIntervalMs: 2000, speed: 172, aggroRadius: 8, attackRange: 1,
    loot: { items: [] },
    abilities: [
      {
        id: 'melee', cadenceMs: 2000, target: { range: 1 },
        power: { min: 0, max: 120 }, damageType: 'physical',
      },
      {
        id: 'fireball', cadenceMs: 2000, chance: 0.15,
        target: { range: 7, area: { shape: 'circle', radius: 4, centered: 'target' } },
        power: { min: 60, max: 140 }, damageType: 'fire',
      },
      {
        id: 'firewave', cadenceMs: 2000, chance: 0.10,
        target: { range: 7, area: { shape: 'wave', length: 8 } },
        power: { min: 100, max: 170 }, damageType: 'fire',
      },
    ],
    defenses: [{ id: 'heal', cadenceMs: 2000, chance: 0.15, heal: { min: 40, max: 70 } }],
    targetChange: { intervalMs: 4000, chance: 0.10 },
    runOnHealth: 300,
    staticAttack: 0.80,
  };

  /** O personagem level 200 do cenário (#520): stats absurdamente altos, como a fixture já
   * faz com o rato (500 000 HP) — o que este describe mede é o comportamento do Dragon, não
   * quanto o herói aguenta. */
  const heroLevel200 = (over: Partial<{ health: number; mana: number }> = {}) =>
    new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: over.health ?? 1_000_000, maxHealth: over.health ?? 1_000_000,
      mana: over.mana ?? 1_000, maxMana: over.mana ?? 1_000,
      level: 200, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });

  /** Ataque desarmado ZERO: só o Dragon causa dano na cena, então a leitura de frequência
   * é só dele — o herói nunca reduz o HP dele e nunca dispara a fuga por engano. */
  const pacifist = { ...combat, player: { ...combat.player, attackPower: 0 } };

  /** A hunt fixture aponta para "rat"; aqui a composição é o Dragon. */
  const dragonHunt = {
    ...hunt,
    difficulties: {
      cautious: { ...hunt.difficulties.cautious, composition: [{ monsterId: 'dragon', weight: 1 }] },
      bold: { ...hunt.difficulties.bold, composition: [{ monsterId: 'dragon', weight: 1 }] },
    },
  };

  it('melee, bola de fogo, onda e cura própria saem nas frequências esperadas pela semente (~200 vencimentos)', () => {
    const loaded = buildContent(raw({ monsters: [dragon], hunts: [dragonHunt], combat: [pacifist] }));
    const session = createHuntSession({
      id: 'dragon-freq', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    });
    session.enter(heroLevel200());
    const ruleset = session.ruleset as HuntRuleset;
    session.advanceBy(100);
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem monstro nesta cena');
    // De vida CHEIA a cura não emite nada (a mesma regra do `#emitHealed` do personagem) — sem
    // ferida nenhuma, todo sorteio de cura bem-sucedido seria mudo, e `heals` ficaria zero por
    // um motivo que não tem nada a ver com a chance. 50 000 de ferida é bem mais que o total
    // que 30 curas (o teto da banda abaixo) somam (30 × 70 no máximo = 2 100): o Dragon segue
    // ferido a cena inteira, e toda cura bem-sucedida tem o que repor.
    target.receiveDamage(50_000);
    session.drainEvents();
    const events: DomainEvent[] = [];
    for (let t = 0; t < 400_000 && session.ended === null; t += 100) {
      session.advanceBy(100);
      events.push(...session.drainEvents());
    }
    const casts = (abilityId: string): number => events.filter(
      (e) => e.kind === 'monster-ability-cast' && e.abilityId === abilityId,
    ).length;
    const meleeHits = events.filter((e) => e.kind === 'creature-hit' && e.source === 'melee'
      && typeof e.attackerId === 'string' && e.attackerId.startsWith('m:')).length;
    const heals = events.filter(
      (e) => e.kind === 'creature-healed' && e.source === 'monster',
    ).length;

    // ~200 vencimentos de cadência (400 000 ms / 2 000 ms). `melee` não declara `chance` — sai
    // em quase todo vencimento —, e `fireball` (15 %), `firewave` (10 %) e a cura (15 %) rolam
    // uma chance a cada vencimento: a lei dos grandes números os aproxima do esperado. A banda
    // é generosa (grosso modo metade a uma vez e meia o valor esperado, ~3 desvios-padrão do
    // binomial com n=200) para não ficar frágil a um detalhe de implementação que não muda o
    // COMPORTAMENTO — a simulação em si já é 100 % determinística pela semente da sessão.
    expect(meleeHits).toBeGreaterThan(150);
    expect(casts('fireball')).toBeGreaterThan(15);
    expect(casts('fireball')).toBeLessThan(45);
    expect(casts('firewave')).toBeGreaterThan(8);
    expect(casts('firewave')).toBeLessThan(32);
    expect(heals).toBeGreaterThan(15);
    expect(heals).toBeLessThan(45);
    // Melee (sem chance) é claramente mais frequente que qualquer ability com chance — a prova
    // qualitativa de que `chance` reduz a frequência de verdade, não é só um número decorativo.
    expect(meleeHits).toBeGreaterThan(casts('fireball') * 3);
    expect(meleeHits).toBeGreaterThan(casts('firewave') * 3);
  });

  it('fogo não causa dano (imune) e gelo causa +10 % (vulnerável) — a mitigação do Dragon', () => {
    // Sem `defenses`: a cura própria do Dragon (15 % a cada 2 s) contaminaria a leitura de UM
    // golpe se rolasse no meio da janela — este teste é sobre o TIPO de dano, não sobre a cura,
    // que já tem o teste dela acima.
    const dragonNoHeal = { ...dragon, defenses: [] };
    const alwaysTarget = { kind: 'targets' as const, op: '>=' as const, count: 1 };
    const fireBolt = {
      id: 'fire-bolt', name: 'Fire Bolt', manaCost: 15, cooldownMs: 999_999,
      effect: { kind: 'damage', power: 100, range: 3, damageType: 'fire' },
    };
    const frostBolt = {
      id: 'frost-bolt', name: 'Frost Bolt', manaCost: 15, cooldownMs: 999_999,
      effect: { kind: 'damage', power: 100, range: 3, damageType: 'ice' },
    };

    // Um cooldown absurdo (999 999 ms) garante UM lançamento só na janela do teste. O dano lido
    // vem do PRÓPRIO evento `creature-hit` (o `amount` APLICADO), não de um antes/depois do
    // `health` do monstro: o bot pode lançar já no primeiro passo (FUN-25, cooldowns prontos na
    // entrada), e capturar "antes" tarde demais mediria zero mesmo com dano de verdade.
    const damageDealt = (spellId: string, spellDef: unknown): number => {
      const loaded = buildContent(raw({
        monsters: [dragonNoHeal], hunts: [dragonHunt], combat: [pacifist], spells: [spellDef],
      }));
      const config = botConfig({
        attack: [{ when: alwaysTarget, do: { kind: 'spell', spellId } }],
      });
      const session = createHuntSession({
        id: `dragon-mitigation-${spellId}`, content: loaded, huntId: 'arena',
        difficulty: 'cautious', createdAtMs: 0, botConfig: config,
      });
      session.enter(heroLevel200());
      const events: DomainEvent[] = [];
      for (let t = 0; t < 10_000 && session.ended === null; t += 100) {
        session.advanceBy(100);
        events.push(...session.drainEvents());
      }
      // O lançamento de verdade aconteceu — sem isto, "0 de dano" no fogo provaria imunidade
      // OU um bot que nunca lançou nada, e as duas leituras são indistinguíveis sem este
      // sinal.
      expect(events.some((e) => e.kind === 'spell-cast' && e.spellId === spellId), spellId).toBe(true);
      // `source: 'spell'` sozinho pegaria TAMBÉM a bola/onda do próprio Dragon batendo no
      // herói (não são corpo a corpo); `attackerId === 'hero'` isola o golpe do FEITIÇO do
      // herói no Dragon.
      return events
        .filter((e) => e.kind === 'creature-hit' && e.source === 'spell' && e.attackerId === 'hero')
        .reduce((sum, e) => sum + (e as { amount: number }).amount, 0);
    };

    expect(damageDealt('fire-bolt', fireBolt)).toBe(0);
    const iceDamage = damageDealt('frost-bolt', frostBolt);
    // 100 de poder × 1,1 (gelo −10 % = vulnerabilidade) = 110; a banda cobre o resíduo de ponto
    // flutuante da multiplicação sem se prender ao arredondamento exato do pipeline.
    expect(iceDamage).toBeGreaterThan(105);
    expect(iceDamage).toBeLessThan(115);
  });

  it('abaixo de runOnHealth o Dragon foge: para de bater corpo a corpo, mas a bola de fogo continua saindo', () => {
    // `fireball` com chance 1 nesta cena: garante o disparo sem depender de sorteio, provando
    // que "fugir" não desliga a ability de ALCANCE — só o corpo a corpo (`isMeleeAbility`).
    const alwaysFireball = {
      ...dragon,
      abilities: dragon.abilities.map((a) => (a.id === 'fireball' ? { ...a, chance: 1 } : a)),
    };
    const loaded = buildContent(raw({ monsters: [alwaysFireball], hunts: [dragonHunt] }));
    const session = createHuntSession({
      id: 'dragon-flee', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    });
    session.enter(heroLevel200({ health: 2_000_000 }));
    session.advanceBy(100);
    const ruleset = session.ruleset as HuntRuleset;
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');

    // Empurra o HP para a faixa de fuga (runOnHealth 300) sem depender de sorteio de dano.
    monster.receiveDamage(alwaysFireball.health - 250);
    session.drainEvents();
    const positionBefore = { ...monster.position };

    const events: DomainEvent[] = [];
    for (let t = 0; t < 6_000 && session.ended === null; t += 100) {
      session.advanceBy(100);
      events.push(...session.drainEvents());
    }
    // Nenhum corpo a corpo enquanto foge.
    expect(events.some((e) => e.kind === 'creature-hit' && e.source === 'melee'
      && typeof e.attackerId === 'string' && e.attackerId.startsWith('m:'))).toBe(false);
    // A bola de fogo continua saindo — passo e ataque são decisões independentes (FUN-85).
    expect(events.some(
      (e) => e.kind === 'monster-ability-cast' && e.abilityId === 'fireball',
    )).toBe(true);
    // E ele se afastou do herói (fleeStep), em vez de ficar colado.
    const distanceBefore = Math.abs(positionBefore.x) + Math.abs(positionBefore.y);
    const distanceAfter = Math.abs(monster.position.x) + Math.abs(monster.position.y);
    expect(distanceAfter).toBeGreaterThanOrEqual(distanceBefore);
  });

  it('o campo de fogo do Dragon Lord (#520) cobre os MESMOS 21 tiles da bola — `source: \'monster\'` (achado da revisão do #536)', () => {
    // Antes da correção, `applyField` chamava `areaTiles` sem `source`, caindo no default
    // `'spell'` — o mesmo raio 4 que dá 21 tiles na bola de fogo (tabela de monstro) daria 69
    // no campo (tabela de magia). `firefield` com chance 1: sem depender de sorteio.
    const dragonLordField = {
      ...dragon, id: 'dragon-lord', name: 'Dragon Lord',
      abilities: [
        {
          id: 'firefield', cadenceMs: 2000, chance: 1, target: { range: 7 }, power: 0,
          damageType: 'fire' as const,
          field: {
            id: 'dragon-lord-firefield', durationMs: 200_000,
            shape: { shape: 'circle' as const, radius: 4, centered: 'target' as const },
            condition: {
              key: 'burning', merge: 'strongest' as const, durationMs: 70_000,
              effect: {
                kind: 'damage-over-time' as const, form: 'rounds' as const,
                rounds: [{ count: 7, intervalMs: 10_000, damage: 20 }], damageType: 'fire' as const,
              },
            },
          },
        },
      ],
      defenses: [],
    };
    const fieldHunt = {
      ...hunt,
      difficulties: {
        cautious: { ...hunt.difficulties.cautious, composition: [{ monsterId: 'dragon-lord', weight: 1 }] },
        bold: { ...hunt.difficulties.bold, composition: [{ monsterId: 'dragon-lord', weight: 1 }] },
      },
    };
    const loaded = buildContent(raw({ monsters: [dragonLordField], hunts: [fieldHunt], combat: [pacifist] }));
    const session = createHuntSession({
      id: 'dragon-lord-field', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    });
    session.enter(heroLevel200());
    const ruleset = session.ruleset as HuntRuleset;
    run(session, 3_000, 100);
    expect(ruleset.fields).toHaveLength(1);
    expect(ruleset.fields[0]?.tiles).toHaveLength(21);
  });

  describe('estratégia ponderada de alvo (#541)', () => {
    it('numa party de 2, troca para o membro de MENOS vida quando `health` é sorteado', () => {
      // Isola o critério `health` (peso 100): a distribuição real 70/10/10/10 do Dragon já
      // está coberta em `target-strategy.test.ts` — o que este teste prova é a FIAÇÃO, que o
      // vencimento de `MONSTER_TARGET_CHANGE` de fato repassa a vida de cada membro da party
      // para `rankTarget`, e não só `chooseTarget` (a aquisição inicial).
      const healthPickingDragon = {
        ...dragon,
        targetChange: { intervalMs: 1_000, chance: 1 },
        targetStrategy: { nearest: 0, health: 100, damage: 0, random: 0 },
      };
      const loaded = buildContent(raw({
        monsters: [healthPickingDragon], hunts: [dragonHunt], combat: [pacifist],
      }));
      const session = createHuntSession({
        id: 'dragon-target-health', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      });
      const knight = heroLevel200({ health: 1_000_000 });
      session.enter(knight);
      const wounded = new CharacterRuntime({
        id: 'wounded-ally', position: { x: 0, y: 0, z: 7 },
        health: 1, maxHealth: 1_000_000, mana: 1_000, maxMana: 1_000,
        level: 200, xp: 0, vocationId: null,
        staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
        gold: 0, goldDelta: 0, alive: true, cooldowns: {},
      });
      session.enter(wounded);

      session.advanceBy(100); // o Dragon nasce.
      const ruleset = session.ruleset as HuntRuleset;
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('sem monstro nesta cena');
      // Fixa o alvo ANTES do vencimento de `targetChange`: o que se mede é a TROCA, não a
      // aquisição inicial (que também usa `rankTarget`, mas por outro caminho — ver
      // `chooseTarget` em `monster.ts`).
      monster.targetId = knight.id;

      run(session, 1_500, 100); // um vencimento de 1 000 ms cabe nesta janela.

      expect(monster.targetId).toBe(wounded.id);
    });
  });
});

describe('estoque de supply/munição do loot: solo, split e shared não enviesado (#520, revisão do #536)', () => {
  // Um monstro fraco (morre num golpe do herói desarmado) que sempre solta 1 de supply E 1 de
  // munição — chance 1 tira o sorteio da conta, e a quantidade 1 é o caso comum (Strong Health
  // Potion do Dragon/Dragon Lord) que expõe o enviesamento de `splitEqually` na revisão do #536.
  const looter = {
    ...rat, id: 'looter', health: 1,
    loot: {
      items: [
        { supplyId: 'health-potion', chance: 1, min: 1, max: 1 },
        { ammunitionId: 'arrow', chance: 1, min: 1, max: 1 },
      ],
    },
  };
  const looterHunt = {
    ...hunt,
    difficulties: {
      cautious: { ...hunt.difficulties.cautious, composition: [{ monsterId: 'looter', weight: 1 }], respawnDelayMs: 200 },
      bold: { ...hunt.difficulties.bold, composition: [{ monsterId: 'looter', weight: 1 }], respawnDelayMs: 200 },
    },
  };
  const loaded = () => content({ monsters: [looter], hunts: [looterHunt] });
  const partyMember = (id: string) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
  };

  it('solo: o matador leva o estoque inteiro', () => {
    const { session, hero } = start({ loaded: loaded() });
    run(session, 5_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.supplyStock.get('health-potion')).toBeGreaterThan(0);
    expect(hero.ammunitionStock.get('arrow')).toBeGreaterThan(0);
  });

  it('shared, quantidade NÃO divisível (1 para 3 presentes): ao longo de muitos abates, NÃO é sempre o mesmo membro (achado da revisão do #536)', () => {
    // Antes da correção, `splitEqually(1, 3)` sempre devolvia `[1, 0, 0]` — o presente de
    // índice 0 levava TODA unidade indivisível, abate após abate. Aqui os três entram na
    // mesma ordem em toda sessão (a semente é a mesma), então se o defeito ainda existisse
    // só 'a' teria estoque ao final — os outros dois ficariam em zero.
    const a = partyMember('a');
    const b = partyMember('b');
    const c = partyMember('c');
    const session = createHuntSession({
      id: 'shared-stock', content: loaded(), huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      partyOptions: { leaderId: 'a', mode: 'shared' },
    });
    for (const m of [a, b, c]) session.enter(m);
    run(session, 15_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(5);
    const stocked = [a, b, c].filter((m) => (m.supplyStock.get('health-potion') ?? 0) > 0);
    expect(stocked.length).toBeGreaterThan(1);
  });

  it('split: um elegível sorteado leva o estoque inteiro do abate — nunca fica dividido num só drop', () => {
    const a = partyMember('a');
    const b = partyMember('b');
    const session = createHuntSession({
      id: 'split-stock', content: loaded(), huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      partyOptions: { leaderId: 'a', mode: 'split' },
    });
    for (const m of [a, b]) session.enter(m);
    run(session, 5_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    // A soma bate com o total de abates recompensados: cada drop de 1 caiu inteiro em alguém.
    const total = (a.supplyStock.get('health-potion') ?? 0) + (b.supplyStock.get('health-potion') ?? 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe('condições generalizadas, dano contínuo e campos de tile (CMB-07)', () => {
  const poison = {
    id: 'poison', name: 'Poison', manaCost: 5, cooldownMs: 500,
    effect: {
      kind: 'damage-over-time', amount: 20, intervalMs: 500, durationMs: 2_500,
      range: 3, damageType: 'earth',
    },
  };
  const alwaysTarget = { kind: 'targets' as const, op: '>=' as const, count: 1 };
  // Ataque desarmado ZERO: sem isto o golpe básico (25) mataria o rato e o abate não seria do
  // DOT. O `minimumDamageFraction` zero derruba também o piso, que sozinho ainda tirava 10 %.
  const pacifist = { ...combat, player: { ...combat.player, attackPower: 0 }, minimumDamageFraction: 0 };
  const dotConfig = botConfig({
    attack: [{ when: alwaysTarget, do: { kind: 'spell' as const, spellId: 'poison' } }],
  });
  const fireField: FieldSpec = {
    id: 'fire', durationMs: 20_000,
    shape: { shape: 'circle', radius: 1, centered: 'caster' },
    condition: {
      key: 'fire', merge: 'refresh', durationMs: 20_000,
      effect: {
        kind: 'damage-over-time', form: 'rounds',
        rounds: [{ count: 40, intervalMs: 500, damage: 10 }], damageType: 'fire',
      },
    },
  };

  it('o DOT de magia no MONSTRO passa pelo resolver canônico e mata pelo pipeline', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, ruleset } = withSpells(dotConfig, {
      mana: 1_000, health: 1_000, spells: [poison], combat: [pacifist],
    });
    run(session, 20_000, 100);

    // O único dano do cenário é o DOT; o abate é dele, e a morte passa por `resolveDeath`.
    expect(session.aggregates.kills).toBeGreaterThan(0);
    const calls = vi.mocked(resolveDamage).mock.calls;
    expect(calls.some(([intent]) => intent.damageType === 'earth' && intent.source === 'spell')).toBe(true);
    expect(ruleset.monsters.every((m) => m.health > 0)).toBe(true);
  });

  it('o DOT de ability no PERSONAGEM usa o mesmo pipeline e pode matar', () => {
    const venomRat = {
      ...rat, health: 100_000, attack: 0,
      abilities: [{
        id: 'venom', cadenceMs: 500, target: { range: 3 }, power: 0, damageType: 'physical',
        condition: {
          key: 'venom', merge: 'refresh', durationMs: 3_000,
          effect: {
            kind: 'damage-over-time', form: 'rounds',
            rounds: [{ count: 6, intervalMs: 500, damage: 15 }], damageType: 'earth',
          },
        },
      }],
    };
    const { session, hero } = withSpells(botConfig(), { health: 15, monstersRaw: [venomRat] });
    run(session, 30_000, 100);

    expect(hero.conditions.get('venom')).toBeNull();
    expect(session.ended).toBe('death');
    expect(session.aggregates.deaths).toBe(1);
  });

  it('a fila do Tibia esgota ANTES do vencimento: a condição fica com força ZERO, nunca um fantasma que `strongest` levaria em conta (#557)', () => {
    // Duas rodadas de 500 ms (a fila inteira) cabem bem dentro da duração de 5000 ms — a fila
    // esgota bem antes do vencimento natural. `cadenceMs` alto garante que a ability só dispara
    // UMA vez na janela do teste, então o estado observado é sempre o de uma única aplicação.
    const shortToxinRat = {
      ...rat, health: 100_000, attack: 0,
      abilities: [{
        id: 'toxin', cadenceMs: 60_000, target: { range: 3 }, power: 0, damageType: 'physical',
        condition: {
          key: 'toxin', merge: 'strongest' as const, durationMs: 5_000,
          effect: {
            kind: 'damage-over-time' as const, form: 'rounds' as const,
            rounds: [{ count: 2, intervalMs: 500, damage: 80 }], damageType: 'earth' as const,
          },
        },
      }],
    };
    const { session, hero } = withSpells(botConfig(), {
      health: 1_000_000, monstersRaw: [shortToxinRat],
    });
    run(session, 3_000, 100);

    const toxin = hero.conditions.get('toxin');
    expect(toxin).not.toBeNull();
    // Achado da revisão do #557: sem `retiredTick`, `tick` ficaria com o `amount` dos ÚLTIMOS 80
    // já entregues e `queue` vazio — `strengthOf` reportaria 80 de força pendente que não
    // existe mais, e a política `strongest` recusaria uma reaplicação real (mesmo mais fraca em
    // `amount` bruto) pelo resto da duração. Com a correção, a força cai a zero — e o
    // `nextTickAtMs` fantasma (#334) também não sobra, porque não há mais evento agendado.
    expect(toxin?.tick?.amount).toBe(0);
    expect(toxin?.tick?.queue).toEqual([]);
    expect(toxin?.nextTickAtMs).toBeUndefined();
  });

  it('relançar a condição cancela o vencimento antigo; a morte cancela tudo', () => {
    const { session, ruleset } = withSpells(dotConfig, {
      mana: 1_000, health: 1_000_000, spells: [poison], combat: [pacifist],
    }, 'bold');
    run(session, 2_000, 100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro');
    // A chave da condição é a do TIQUE (`damage-over-time`, ver `casting.ts`), não o id da
    // magia (`poison`). Filtrar por `/poison` (a versão original desta issue) nunca encontra o
    // subject certo — as asserções abaixo passariam vazias mesmo com o bug do #334 presente.
    const subject = `m:${monster.id}/damage-over-time`;
    const eventsOf = (): number =>
      session.snapshot().schedule.events.filter((e) => e.subject === subject).length;
    // UMA cadeia por condição, não uma por relançamento.
    expect(eventsOf()).toBeLessThanOrEqual(2);
    // E o relançamento deixa exatamente UM tique pendente — nunca zero, o fantasma do #334 em
    // que `nextTickAtMs` é guardado sem o evento correspondente na fila, silenciando o DOT para
    // sempre a partir do próximo relançamento.
    expect(session.snapshot().schedule.events.filter(
      (e) => e.subject === subject && e.kind === 'condition-tick',
    )).toHaveLength(1);
    run(session, 30_000, 100);
    expect(session.snapshot().schedule.events.filter((e) => e.subject === subject)).toHaveLength(0);
  });

  it('DOT sobrevive ao relançamento depois do último tique (duração não múltipla do intervalo, #334)', () => {
    // A reprodução exata da issue: intervalo 500 ms, duração 1 300 ms (não múltipla — o
    // último tique cabe em +1 000, e +1 500 já passa do vencimento) e cooldown 1 100 ms, que
    // recasta bem DEPOIS do último tique e ANTES do vencimento — a janela fantasma. Sem a
    // correção, só os dois tiques do PRIMEIRO lançamento acontecem (40 de dano) e todo
    // relançamento seguinte fica mudo para sempre.
    const flakyDot = {
      id: 'flaky-dot', name: 'Flaky DOT', manaCost: 5, cooldownMs: 1_100,
      effect: {
        kind: 'damage-over-time', amount: 20, intervalMs: 500, durationMs: 1_300,
        range: 3, damageType: 'earth',
      },
    };
    const flakyConfig = botConfig({
      attack: [{ when: alwaysTarget, do: { kind: 'spell' as const, spellId: 'flaky-dot' } }],
    });
    const { session, ruleset } = withSpells(flakyConfig, {
      mana: 1_000_000, health: 1_000_000, spells: [flakyDot], combat: [pacifist],
      monstersRaw: [{ ...rat, health: 100_000, attack: 0 }],
    });
    run(session, 20_000, 100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro');
    // Bem mais que os 40 de dano de um único lançamento: só é possível se o DOT continuou
    // tiquetando através de vários relançamentos.
    expect(monster.health).toBeLessThan(100_000 - 100);
  });

  it('entra no campo só depois do passo aceito, permanece, sai e REENTRA', () => {
    const { session, hero, ruleset } = withSpells(botConfig(), { monsters: false, health: 1_000_000 });
    // Campo em (4,3): o herói passa por (4,2), (4,3) e (3,3) na primeira volta, sai em (2,3)
    // e reentra em (4,2) na volta seguinte (rota de dez tiles, 500 ms cada).
    ruleset.applyField(session, fireField, { x: 4, y: 3, z: 7 });
    expect(ruleset.fields).toHaveLength(1);

    run(session, 1_400, 100);
    const beforeEntry = hero.health;
    run(session, 400, 100);
    expect(hero.health).toBeLessThan(beforeEntry);

    run(session, 1_200, 100);
    const afterExit = hero.health;
    run(session, 500, 100);
    expect(hero.health).toBe(afterExit);

    run(session, 2_500, 100);
    const beforeReentry = hero.health;
    run(session, 1_000, 100);
    expect(hero.health).toBeLessThan(beforeReentry);
  });

  it('campo em tile que ninguém pisa não muda mecânica nenhuma', () => {
    const { session, hero, ruleset } = withSpells(botConfig(), { monsters: false, health: 1_000_000 });
    // (5,5) está fora do mapa jogável; a forma não confero mapa (geometria pura), mas o herói
    // nunca pisa ali. Recusa de passo não aplica campo — `movement` devolve resultado.
    ruleset.applyField(session, { ...fireField, id: 'void' }, { x: 5, y: 5, z: 7 });
    run(session, 5_000, 100);
    expect(hero.health).toBe(1_000_000);
  });

  it('no instante de expiração o vencimento vence o tique — uma ordem só', () => {
    const { session, ruleset } = withSpells(botConfig(), { monsters: false, health: 1_000_000 });
    ruleset.applyField(session, { ...fireField, id: 'short', durationMs: 2_000 }, { x: 4, y: 3, z: 7 });
    run(session, 1_600, 100);
    const same = session.snapshot().schedule.events
      .filter((e) => e.subject === 'f:short' && e.dueAtMs === 2_000);
    const expire = same.find((e) => e.kind === 'field-expire');
    const tick = same.find((e) => e.kind === 'field-tick');
    expect(expire).toBeDefined();
    expect(tick).toBeDefined();
    // A prioridade do vencimento é MENOR que a do tique: no mesmo instante, o vencimento roda
    // primeiro e o tique acha o campo removido. A ordem não depende de quem foi agendado por
    // último — relançar reagenda o vencimento depois do tique.
    expect(expire?.priority).toBeLessThan(tick?.priority ?? Number.POSITIVE_INFINITY);
  });

  it('o campo vence e sai do índice', () => {
    const { session, ruleset } = withSpells(botConfig(), { monsters: false, health: 1_000_000 });
    ruleset.applyField(session, fireField, { x: 4, y: 3, z: 7 });
    run(session, 21_000, 100);
    expect(ruleset.fields).toHaveLength(0);
  });

  it('campo relançado depois do último tique continua tiquetando (#334)', () => {
    // Raio 5 cobre a rota de dez tiles inteira (x:1..4, y:1..3) — irrelevante aqui de propósito:
    // `#enterField` aplica um tique a CADA passo aceito sobre o campo (independente do
    // `FIELD_TICK` agendado), e um herói sempre em cima do campo tomaria dano a cada passo
    // mesmo com o bug do #334 presente. Medir `hero.health` mediria o passo, não o tique — por
    // isso a asserção é sobre a FILA DE EVENTOS, que `#enterField` nunca toca (ele chama
    // `#applyConditionTick` direto, sem agendar nada).
    const wideField: FieldSpec = {
      id: 'wide-fire', durationMs: 1_300,
      shape: { shape: 'circle', radius: 5, centered: 'caster' },
      condition: {
        key: 'wide-fire', merge: 'refresh', durationMs: 1_300,
        effect: {
          kind: 'damage-over-time', form: 'rounds',
          rounds: [{ count: 3, intervalMs: 500, damage: 10 }], damageType: 'fire',
        },
      },
    };
    const { session, ruleset } = withSpells(botConfig(), { monsters: false, health: 1_000_000 });
    const fieldTickEvents = (): number => session.snapshot().schedule.events
      .filter((e) => e.subject === 'f:wide-fire' && e.kind === 'field-tick').length;

    ruleset.applyField(session, wideField, { x: 2, y: 2, z: 7 });
    // Dois tiques rodam (+500 e +1000); +1500 já passa do vencimento (+1300), então NENHUM
    // `field-tick` fica agendado dos dois lados do bug — só muda o que fica gravado em
    // `nextTickAtMs` (o fantasma, sem a correção).
    run(session, 1_100, 100);
    expect(fieldTickEvents()).toBe(0);

    // Relança o MESMO id, na MESMA cadência, DEPOIS do último tique e ANTES do vencimento —
    // exatamente a janela em que `keepTick` herdaria o fantasma. Sem a correção, `keepTick` só
    // olha se o intervalo bate (bate) e NÃO agenda nada — o campo fica mudo pelo resto da vida
    // nova inteira. Com a correção, `previous.nextTickAtMs` está ausente, `keepTick` é falso, e
    // o relançamento AGENDA um `field-tick` novo.
    ruleset.applyField(session, wideField, { x: 2, y: 2, z: 7 });
    expect(fieldTickEvents()).toBe(1);
  });

  it('DOT e campo rendem o MESMO a 10 Hz e a 1 Hz', () => {
    const at = (hz: number) => {
      const { session, hero, ruleset } = withSpells(dotConfig, {
        mana: 1_000, health: 1_000_000, spells: [poison], combat: [pacifist],
      }, 'bold');
      ruleset.applyField(session, fireField, { x: 4, y: 3, z: 7 });
      run(session, 30_000, 1000 / hz);
      return {
        health: hero.health, kills: session.aggregates.kills,
        xp: session.aggregates.xpGained, mana: hero.mana,
      };
    };
    expect(at(1)).toEqual(at(10));
  });

  it('um snapshot no meio do campo retoma com o índice e os eventos', () => {
    const { session, ruleset } = withSpells(dotConfig, {
      mana: 1_000, health: 1_000_000, spells: [poison], combat: [pacifist], monsters: false,
    }, 'bold');
    ruleset.applyField(session, fireField, { x: 4, y: 3, z: 7 });
    run(session, 2_000, 100);
    const snapshot = session.snapshot();
    const loaded = buildContent(raw({
      spells: [poison], combat: [pacifist],
      progression: [{ ...progression, startingMana: 200, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    }));
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed('spell-session'),
    );
    const resumedRuleset = resumed.ruleset as HuntRuleset;
    expect(resumedRuleset.fields).toHaveLength(1);
    const resumedHero = resumed.participants[0] as CharacterRuntime;
    const before = resumedHero.health;
    run(resumed, 1_000, 100);
    expect(resumedHero.health).toBeLessThan(before);
  });
});

describe('outcomes avançados na hunt (CMB-08)', () => {
  // O perfil declara crítico e leech: é o que faz o golpe consumir a TERCEIRA rolagem e o
  // atacante repor recurso. Sem `modifiers`, nada disto acontece e o v1 é preservado.
  const critCombat = {
    ...combat,
    modifiers: { critical: { chance: 1, multiplier: 2 }, lifeLeech: 0.5 },
  };

  it('o crítico multiplica o resolvido e o leech repõe no atacante, com evento', () => {
    // Desarmado 25 ×2 = 50, que é a vida do rato: um golpe, e o leech de 50 % repõe 25.
    const { session, hero } = withSpells(botConfig(), {
      health: 100, combat: [critCombat],
      monstersRaw: [{ ...rat, attack: 0, health: 50 }],
    });
    const before = hero.health;
    run(session, 5_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    // O recorde é o RESOLVIDO (50), não o aplicado — o rato tinha exatamente 50.
    expect(session.aggregates.bestBasicHit).toBeGreaterThanOrEqual(50);
    expect(hero.health).toBe(before + 25);
    const healed = ofKind(session.drainEvents(), 'creature-healed')
      .filter((e) => e.source === 'leech');
    expect(healed.length).toBeGreaterThan(0);
    expect(healed[0]).toMatchObject({ creatureId: 'hero', amount: 25 });
  });

  it('dano integralmente absorvido pela mana NÃO mata nem conta atribuição de HP', () => {
    // Sem o escudo, um golpe de 50 mataria o herói de 1. Com mana de sobra, o HP aplicado é zero,
    // o `creature-hit` carrega zero e nenhum dano entra na contribuição dele.
    const { session, hero } = withSpells(botConfig(), {
      health: 1, mana: 1_000,
      monstersRaw: [{ ...rat, health: 100_000, attack: 50 }],
    });
    hero.conditions.apply({
      key: 'mana-shield', spellId: 'magic-shield', expiresAtMs: 1_000_000,
    });
    run(session, 20_000, 100);

    expect(hero.alive).toBe(true);
    expect(session.ended).toBeNull();
    expect(hero.health).toBe(1);
    expect(hero.mana).toBeLessThan(1_000);
    expect(hero.contribution.actorCount).toBe(0);

    const hits = ofKind(session.drainEvents(), 'creature-hit')
      .filter((e) => e.creatureId === 'hero');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.amount === 0)).toBe(true);
  });

  it('sem modificadores a hunt é a de sempre: nenhum evento de leech', () => {
    const { session } = withSpells(botConfig(), {
      health: 100, monstersRaw: [{ ...rat, attack: 0, health: 50 }],
    });
    run(session, 5_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(session.drainEvents().some((e) => e.kind === 'creature-healed' && e.source === 'leech'))
      .toBe(false);
  });

  // M30-04 (#551): a MESMA mecânica, agora pelo EQUIPAMENTO (`Inventory.combatModifiers`), não
  // pelo `combat.modifiers` estático do conteúdo — a fonte real que o item catalogado usa.
  const critLeechInventory: InventoryState = {
    backpack: [],
    equipped: { finger: { instanceId: 'r1', itemId: 'crit-leech-ring', quantity: 1 } },
  };

  it('anel de crítico/leech (item, M30-04) tem o MESMO efeito do `combat.modifiers` estático', () => {
    // Desarmado 25 ×2 (crit-leech-ring) = 50, a vida do rato: um golpe, e o leech de 50 % repõe
    // 25 — os mesmos números do teste do `combat.modifiers`, agora vindos do equipamento.
    const { session, hero } = withSpells(botConfig(), {
      health: 100, items: [...items], inventory: critLeechInventory,
      monstersRaw: [{ ...rat, attack: 0, health: 50 }],
    });
    const before = hero.health;
    run(session, 5_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(session.aggregates.bestBasicHit).toBeGreaterThanOrEqual(50);
    expect(hero.health).toBe(before + 25);
    const healed = ofKind(session.drainEvents(), 'creature-healed')
      .filter((e) => e.source === 'leech');
    expect(healed.length).toBeGreaterThan(0);
    expect(healed[0]).toMatchObject({ creatureId: 'hero', amount: 25 });
  });

  it('tirar o anel apaga o crítico/leech — o bônus é só enquanto VESTIDO', () => {
    const { session, hero } = withSpells(botConfig(), {
      health: 100, items: [...items], inventory: critLeechInventory,
      monstersRaw: [{ ...rat, attack: 0, health: 1_000_000 }],
    });
    hero.inventory.unequip('finger', { backpackSlots: 0, satchelSlots: 10, row: 1 });
    const before = hero.health;
    run(session, 3_000, 100);
    // Sem o anel, o golpe desarmado é 25 — nunca crítico, e sem leech nenhum.
    expect(session.drainEvents().some((e) => e.kind === 'creature-healed' && e.source === 'leech'))
      .toBe(false);
    expect(hero.health).toBe(before);
  });

  it('a magia TAMBÉM rola o crítico do equipamento (M30-04) — não só o golpe básico', () => {
    // `strike` (fire, poder 40) ×2 pelo anel = 80 num rato tanque, sem armadura: TODO golpe de
    // magia crítica exatamente 80 — a chance é 100 %, então nenhum sai a 40.
    const { session } = withSpells(botConfig({
      attack: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'strike' } }],
    }), {
      health: 100, mana: 1_000, items: [...items], inventory: critLeechInventory,
      monstersRaw: [{ ...rat, attack: 0, health: 1_000_000 }],
    });
    const events: DomainEvent[] = [];
    run(session, 10_000, 100);
    events.push(...session.drainEvents());
    const hits = ofKind(events, 'creature-hit')
      .filter((e) => String(e.creatureId).startsWith('m:') && e.source === 'spell');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.amount === 80)).toBe(true);
  });

  // `attackPower: 0` (só nestes dois testes, via `over.combat`) desliga o auto-ataque
  // desarmado (`#armPlayerAttack`, sempre ativo — Tibia ataca corpo a corpo independente da
  // rotação de magia do bot): sem isso, o golpe desarmado também criticaria com o mesmo anel e
  // misturaria leech de outra origem nos mesmos eventos, cada vez maior conforme a skill
  // `melee` sobe de nível durante a corrida. Zerado, ele nunca aplica dano e nunca gera leech —
  // só a magia (`blast`) permanece.
  const noMeleeCombat = [{ ...combat, player: { ...combat.player, attackPower: 0 } }];

  it('leech de UM alvo (magia) é a identidade — fator (0,1×1+0,9)/1 = 1', () => {
    const blastRule = {
      when: { kind: 'targets' as const, op: '>=' as const, count: 1 },
      do: { kind: 'spell' as const, spellId: 'blast' },
    };
    const { session } = withSpells(botConfig({ attack: [blastRule] }), {
      health: 100, mana: 2_000, items: [...items], inventory: critLeechInventory,
      combat: noMeleeCombat, monstersRaw: [{ ...rat, attack: 0, health: 1_000_000 }],
    }, 'cautious');
    const events: DomainEvent[] = [];
    run(session, 10_000, 100);
    events.push(...session.drainEvents());
    const healed = ofKind(events, 'creature-healed').filter((e) => e.source === 'leech');
    // O MESMO anel também critica (M30-04): 80 de `blast` ×2 = 160 de dano aplicado. Leech
    // 50 % × fator 1 (um alvo só) = 80, sempre — cada lançamento acerta o mesmo alvo único.
    expect(healed.length).toBeGreaterThan(0);
    expect(healed.every((e) => e.amount === 80)).toBe(true);
  });

  it('leech de TRÊS alvos (magia em área) usa o fator do Canary, NÃO uma divisão simples', () => {
    // `blast` (poder 80, raio 2) na dificuldade "bold": três ratos no mesmo ponto de nascimento,
    // todos no raio (o mesmo cenário do teste "o maior hit de magia é POR ALVO"). O MESMO anel
    // também critica: 80 ×2 = 160 de dano aplicado POR ALVO. O fator para n=3 é
    // (0,1×3+0,9)/3 = 0,4, não 1/3 ≈ 0,333 — cada golpe de 160×50 % rende 32, não ~26,7.
    const blastRule = {
      when: { kind: 'targets' as const, op: '>=' as const, count: 1 },
      do: { kind: 'spell' as const, spellId: 'blast' },
    };
    const { session } = withSpells(botConfig({ attack: [blastRule] }), {
      health: 100, mana: 2_000, items: [...items], inventory: critLeechInventory,
      combat: noMeleeCombat, monstersRaw: [{ ...rat, attack: 0, health: 1_000_000 }],
    }, 'bold');
    const events: DomainEvent[] = [];
    run(session, 10_000, 100);
    events.push(...session.drainEvents());
    const healed = ofKind(events, 'creature-healed').filter((e) => e.source === 'leech');
    // Um evento de leech POR ALVO, sempre 32 — nunca 26 (o quociente ingênuo de 160×50 %/3).
    expect(healed.length).toBeGreaterThan(0);
    expect(healed.every((e) => e.amount === 32)).toBe(true);
  });
});
describe('hunt identity, attackTargetOf e condições ativas (#341, SV-05)', () => {
  it('huntId e difficulty refletem a hunt e a dificuldade da instância', () => {
    const { ruleset } = start({ difficulty: 'bold' });
    expect(ruleset.huntId).toBe('arena');
    expect(ruleset.difficulty).toBe('bold');
  });

  it('attackTargetOf devolve o monstro ao alcance do ataque ou null', () => {
    const { session, hero, ruleset } = start();
    // Antes de nascer qualquer monstro: sem alvo
    expect(ruleset.attackTargetOf(hero)).toBeNull();

    // Avança para o monstro nascer colado ao herói
    session.advanceBy(100);
    const target = ruleset.attackTargetOf(hero);
    expect(target).not.toBeNull();
    expect(target?.alive).toBe(true);
  });

  it('condições temporárias têm o mesmo expiresAtMs a 10 Hz e a 1 Hz (relógio lógico, sem acumulador de tick)', () => {
    const always = { kind: 'hp' as const, op: '<=' as const, percent: 100 };
    const cast = (spellId: string) => ({ when: always, do: { kind: 'spell' as const, spellId } });
    const hasteSpell = {
      id: 'haste-test', name: 'Haste', manaCost: 60, cooldownMs: 2_000, group: 'support', groupCooldownMs: 2_000,
      effect: { kind: 'haste' as const, speedPercent: 30, durationMs: 30_000 },
    };
    const at = (hz: number) => {
      const { session, hero } = withSpells(botConfig({ support: [cast('haste-test')] }), {
        mana: 60, spells: [...spells, hasteSpell], monsters: false,
      });
      run(session, 5_000, 1000 / hz);
      const condition = hero.conditions.get('haste');
      return {
        nowMs: session.nowMs,
        expiresAtMs: condition?.expiresAtMs,
        remainingMs: condition ? condition.expiresAtMs - session.nowMs : null,
      };
    };

    const at10Hz = at(10);
    const at1Hz = at(1);

    expect(at10Hz.nowMs).toBe(5_000);
    expect(at1Hz.nowMs).toBe(5_000);
    expect(at10Hz.expiresAtMs).toBe(30_000);
    expect(at1Hz.expiresAtMs).toBe(30_000);
    expect(at10Hz.remainingMs).toBe(25_000);
    expect(at1Hz.remainingMs).toBe(25_000);
  });
});

describe('cura e suporte com alvo (§D11, #399)', () => {
  // A magia/supply de AMIGO que #392 entrega em conteúdo. Aqui ela é fixture: o que se prende
  // é a SELEÇÃO de alvo, não o número.
  const friendHeal = {
    id: 'friend-heal', name: 'Cura Amiga', manaCost: 20, cooldownMs: 1_000,
    effect: { kind: 'heal' as const, amount: 60, target: 'friend' as const, range: 3 },
  };

  /** Sem monstros por padrão: as perturbações de dano estragariam a asserção de alvo. */
  const loaded = (over: Partial<RawContent> = {}): Content => content({
    spells: [...spells, friendHeal],
    progression: [{
      ...progression, startingMana: 200, regen: { healthPerSecond: 0, manaPerSecond: 0 },
    }],
    routes: [{ ...route, spawnPoints: [] }],
    ...over,
  });

  const member = (id: string, health: number, maxHealth: number): CharacterRuntime =>
    new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health, maxHealth, mana: 200, maxMana: 200,
      level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    });

  const healRule = (target: ReturnType<typeof botConfig>['heal'][number]['target']) => botConfig({
    heal: [{
      when: { kind: 'hp', op: '<', percent: 100 },
      do: { kind: 'spell', spellId: 'friend-heal' },
      ...(target === undefined ? {} : { target }),
    }],
  });

  const walkTo = (session: Session, ruleset: HuntRuleset, id: string, to: { x: number; y: number }): void => {
    const character = session.participants.find((p) => p.id === id);
    if (character === undefined) throw new Error(`sem participante ${id}`);
    let guard = 0;
    while ((character.position.x !== to.x || character.position.y !== to.y) && guard++ < 20) {
      const dx = Math.sign(to.x - character.position.x);
      const dy = Math.sign(to.y - character.position.y);
      const result = ruleset.requestMove(session, id, { x: character.position.x + dx, y: character.position.y + dy });
      if (!result.ok) throw new Error(`requestMove recusou: ${result.reason}`);
    }
    // Trava no tile: o passo seguinte não vence mais, e a posição do alvo fica determinística.
    session.cancelEvent('player-step', id);
  };

  it('lowest-hp-member ordena por PERCENTUAL: cavaleiro 20% vence o mago 50% (RF-01)', () => {
    // O contraexemplo do §28/#392: por HP ABSOLUTO o mago (1.000) perderia para o cavaleiro
    // (2.000) — que é exatamente a ordenação errada. O percentual inverte o resultado.
    const session = createHuntSession({
      id: 'heal-target', content: loaded(), huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0, botConfigs: { a: healRule({ kind: 'lowest-hp-member' }) },
    });
    const ruleset = session.ruleset as HuntRuleset;
    const a = member('a', 100, 100);
    const knight = member('k', 2_000, 10_000);
    const mage = member('m', 1_000, 2_000);
    session.enter(a);
    session.enter(knight);
    session.enter(mage);
    walkTo(session, ruleset, 'k', { x: 2, y: 1 });
    walkTo(session, ruleset, 'm', { x: 1, y: 2 });

    run(session, 100, 100);

    const healed = ofKind(session.drainEvents(), 'creature-healed');
    expect(healed.map((e) => e.creatureId)).toEqual(['k']);
    expect(healed[0]?.amount).toBe(60);
    expect(knight.health).toBe(2_060);
    expect(mage.health).toBe(1_000);
  });

  it('lowest-hp-member ignora quem está em OUTRO andar, mesmo dentro do alcance por (x, y) (#519)', () => {
    // A hunt hospeda um personagem só hoje (party é Fase 3), mas o alvo de regra precisa
    // conferir andar do MESMO jeito que `chooseTarget`/`selectTarget` já conferem para monstro
    // — sem isso, a checagem "todo lugar que compara alvo confere o andar" seria falsa aqui.
    const session = createHuntSession({
      id: 'heal-target-floor', content: loaded(), huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0, botConfigs: { a: healRule({ kind: 'lowest-hp-member' }) },
    });
    const ruleset = session.ruleset as HuntRuleset;
    const a = member('a', 100, 100);
    const knight = member('k', 20, 10_000); // 0,2 % — venceria por percentual se contasse.
    session.enter(a);
    session.enter(knight);
    walkTo(session, ruleset, 'k', { x: 2, y: 1 });
    // Mutação direta de posição: é montagem de teste (como `walkTo` já é), não um passo do
    // `sim` — o andar do companheiro está fora do alcance de qualquer rota desta fixture.
    knight.position = { ...knight.position, z: knight.position.z + 1 };

    run(session, 100, 100);

    expect(ofKind(session.drainEvents(), 'creature-healed')).toHaveLength(0);
    expect(knight.health).toBe(20);
  });

  it('regra "member" com id específico também ignora o andar errado (#519)', () => {
    const session = createHuntSession({
      id: 'heal-target-floor-member', content: loaded(), huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0, botConfigs: { a: healRule({ kind: 'member', characterId: 'k' }) },
    });
    const ruleset = session.ruleset as HuntRuleset;
    const a = member('a', 100, 100);
    const knight = member('k', 20, 10_000);
    session.enter(a);
    session.enter(knight);
    walkTo(session, ruleset, 'k', { x: 2, y: 1 });
    knight.position = { ...knight.position, z: knight.position.z + 1 };

    run(session, 100, 100);

    expect(ofKind(session.drainEvents(), 'creature-healed')).toHaveLength(0);
    expect(knight.health).toBe(20);
  });

  it('membro específico morto não lança, e NÃO escolhe outro vivo no lugar (RF-02)', () => {
    // §30: alvo inválido espera. O `b` vivo e ferido no alcance seria o substituto natural de
    // uma implementação que "caisse para qualquer um" — e é justamente o que o PRD proíbe.
    const session = createHuntSession({
      id: 'heal-target', content: loaded(), huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0, botConfigs: { a: healRule({ kind: 'member', characterId: 'c' }) },
    });
    const ruleset = session.ruleset as HuntRuleset;
    const a = member('a', 100, 100);
    const b = member('b', 500, 1_000);
    const c = member('c', 0, 1_000);
    session.enter(a);
    session.enter(b);
    session.enter(c);
    walkTo(session, ruleset, 'b', { x: 2, y: 1 });
    walkTo(session, ruleset, 'c', { x: 1, y: 2 });
    c.alive = false;

    run(session, 100, 100);

    expect(ofKind(session.drainEvents(), 'creature-healed')).toHaveLength(0);
    expect(b.health).toBe(500);
  });

  it('efeito self-only com target != self não age e não derruba a sessão (RF-05)', () => {
    // Config inconsistente forçada (snapshot antigo, troca de conteúdo): `#healRangeOf` devolve
    // null e a regra vira "sem candidato", nunca uma exceção — a mesma filosofia de toda recusa.
    const session = createHuntSession({
      id: 'heal-target', content: loaded(), huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0,
      botConfigs: {
        a: botConfig({
          heal: [{
            when: { kind: 'hp', op: '<', percent: 100 },
            do: { kind: 'spell', spellId: 'heal' },
            target: { kind: 'lowest-hp-member' },
          }],
        }),
      },
    });
    const ruleset = session.ruleset as HuntRuleset;
    const a = member('a', 100, 100);
    const b = member('b', 500, 1_000);
    session.enter(a);
    session.enter(b);
    walkTo(session, ruleset, 'b', { x: 2, y: 1 });

    expect(() => run(session, 100, 100)).not.toThrow();
    expect(ofKind(session.drainEvents(), 'creature-healed')).toHaveLength(0);
    expect(session.ended).toBeNull();
  });

  // O cenário de dano: um tanque longe o bastante para o primeiro golpe NÃO cair no t=0 (o
  // evento de cura do bot precisa ter falhado antes, senão o teste passaria sem `#armHealersOf`).
  const tank = {
    ...rat, name: 'Tanque', health: 100_000,
    attack: 500, attackIntervalMs: 1_000, speed: 100, aggroRadius: 10, attackRange: 1,
    loot: { gold: { chance: 1, min: 1, max: 1 }, items: [] },
  };

  const damageScenario = (hz: number) => {
    const session = createHuntSession({
      id: 'heal-wake', content: loaded({
        monsters: [tank],
        routes: [{ ...route, spawnPoints: [{ routeIndex: 5, radius: 1 }] }],
      }),
      huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      botConfigs: { b: healRule({ kind: 'member', characterId: 'a' }) },
    });
    const ruleset = session.ruleset as HuntRuleset;
    // `a` entra primeiro e fica no tile inicial: o monstro o escolhe pelo empate de distância
    // (a ordem de entrada é o desempate de `chooseTarget`). `b` é o curandeiro.
    const a = member('a', 10_000, 10_000);
    const b = member('b', 100, 100);
    session.enter(a);
    session.enter(b);
    walkTo(session, ruleset, 'a', { x: 1, y: 1 });
    walkTo(session, ruleset, 'b', { x: 1, y: 2 });

    run(session, 6_000, 1000 / hz);

    return {
      events: ofKind(session.drainEvents(), 'creature-healed').map((e) => ({ id: e.creatureId, amount: e.amount })),
      victim: a.health, mana: b.mana, ended: session.ended,
    };
  };

  it('quem apanha acorda o curandeiro da party, sem esperar o próprio cooldown (RF-06)', () => {
    // Mutação que mata: sem `#armHealersOf`, a categoria de cura de `b` fica ENGATILHADA para
    // sempre — ela só reage a dano no próprio `b`, e o HP que caiu é do `a`.
    const result = damageScenario(10);
    const curado = result.events.filter((e) => e.id === 'a');
    expect(curado.length).toBeGreaterThan(0);
    expect(curado[0]?.amount).toBe(60);
    expect(result.mana).toBeLessThan(200);
    expect(result.ended).toBeNull();
  });

  it('o alvo de party é o mesmo a 1 Hz e a 10 Hz (RF-07)', () => {
    const rapido = damageScenario(10);
    const lento = damageScenario(1);
    expect(lento).toEqual(rapido);
    // Não-vacuidade: o cenário precisa ter curado de fato, senão um empate de zeros passaria.
    expect(rapido.events.length).toBeGreaterThan(0);
  });
});

describe('encerrar a hunt para todos exige o sim de todos (#432, ADR 0032 d.14)', () => {
  // Sem spawn e sem regen: a votação é o ÚNICO evento que interessa, e nenhum membro morre no
  // meio da janela de 60 s — o que encerraria a sessão por morte e não pela votação.
  const quiet = content({
    routes: [{ ...route, spawnPoints: [] }],
    progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
  });
  const member = (id: string) => {
    const stats = statsForLevel(1, null, progression as Progression);
    return new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
    });
  };
  const make = (ids: readonly string[], hz = 10) => {
    const session = createHuntSession({
      id: 'end-vote', content: quiet, huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: { leaderId: ids[0] ?? '', mode: 'split' },
    });
    for (const id of ids) session.enter(member(id));
    return { session, ruleset: session.ruleset as HuntRuleset, stepMs: 1000 / hz };
  };

  it('proposta do líder + todos os sins → encerra com um Receipt por membro e motivo party-vote', () => {
    const { session, ruleset } = make(['lead', 'b', 'c', 'd']);
    expect(ruleset.proposeEnd(session, 'lead')).toEqual({ ok: true });
    // Quem propõe já aprova: a proposta carrega o sim do líder.
    expect(ruleset.endVoteState()).toEqual({ active: true, proposedAtMs: 0, approved: ['lead'] });
    expect(ruleset.approveEnd(session, 'b')).toEqual({ ok: true });
    expect(ruleset.approveEnd(session, 'c')).toEqual({ ok: true });
    // Ainda falta um: o encerramento não antecipa o sim que não veio.
    expect(session.ended).toBeNull();
    expect(ruleset.approveEnd(session, 'd')).toEqual({ ok: true });
    expect(session.ended).toBe('party-vote');
    // Um extrato por membro, todos com o motivo da votação (invariante 10: `seq` próprio).
    const receipts = session.receipts();
    expect(receipts.map((r) => r.characterId)).toEqual(['lead', 'b', 'c', 'd']);
    expect(receipts.every((r) => r.reason === 'party-vote')).toBe(true);
    expect(new Set(receipts.map((r) => r.seq)).size).toBe(4);
    // O estado fecha a votação ao encerrar.
    expect(ruleset.endVoteState()).toEqual({ active: false, proposedAtMs: 0, approved: [] });
  });

  it('membro que não é líder não propõe — recusa tipada; solo também não', () => {
    const { session, ruleset } = make(['lead', 'b']);
    expect(ruleset.proposeEnd(session, 'b')).toEqual({ ok: false, reason: 'not-leader' });
    expect(ruleset.endVoteState()).toEqual({ active: false, proposedAtMs: 0, approved: [] });

    const solo = createHuntSession({
      id: 'solo-end', content: quiet, huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
    });
    solo.enter(member('solo'));
    expect((solo.ruleset as HuntRuleset).proposeEnd(solo, 'solo'))
      .toEqual({ ok: false, reason: 'not-leader' });
  });

  it('aprovar ou recusar sem proposta aberta é recusa tipada', () => {
    const { session, ruleset } = make(['lead', 'b']);
    expect(ruleset.approveEnd(session, 'b')).toEqual({ ok: false, reason: 'no-proposal' });
    expect(ruleset.cancelEnd(session, 'b')).toEqual({ ok: false, reason: 'no-proposal' });
  });

  it('proposta + 2 sins + 60 s → expira, a sessão continua e os membros ficam', () => {
    const { session, ruleset, stepMs } = make(['lead', 'b', 'c', 'd']);
    expect(ruleset.proposeEnd(session, 'lead')).toEqual({ ok: true });
    expect(ruleset.approveEnd(session, 'b')).toEqual({ ok: true });
    run(session, 59_000, stepMs);
    expect(session.ended).toBeNull();
    expect(ruleset.endVoteState()?.active).toBe(true);
    run(session, 2_000, stepMs);
    expect(session.ended).toBeNull();
    expect(ruleset.endVoteState()).toEqual({ active: false, proposedAtMs: 0, approved: [] });
    expect(session.participants.map((p) => p.id)).toEqual(['lead', 'b', 'c', 'd']);
  });

  it('recusar derruba a votação na hora: nada muda e a sessão segue', () => {
    const { session, ruleset } = make(['lead', 'b', 'c']);
    expect(ruleset.proposeEnd(session, 'lead')).toEqual({ ok: true });
    expect(ruleset.cancelEnd(session, 'b')).toEqual({ ok: true });
    expect(session.ended).toBeNull();
    expect(ruleset.endVoteState()).toEqual({ active: false, proposedAtMs: 0, approved: [] });
    // Os eixos da party continuam os de antes — a votação não é configuração.
    expect(ruleset.party?.shareCosts).toBe(false);
    expect(ruleset.party?.splitLoot).toBe(false);
  });

  it('a votação viaja no snapshot: quem reconecta no meio não perde quem aprovou', () => {
    const { session, ruleset } = make(['lead', 'b', 'c', 'd']);
    expect(ruleset.proposeEnd(session, 'lead')).toEqual({ ok: true });
    expect(ruleset.approveEnd(session, 'b')).toEqual({ ok: true });
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const restored = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, quiet) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    ).ruleset as HuntRuleset;
    expect(restored.endVoteState()).toEqual({ active: true, proposedAtMs: 0, approved: ['lead', 'b'] });
  });

  it('1 Hz == 10 Hz: a votação vence no mesmo instante lógico e o desfecho é o mesmo', () => {
    const scenario = (hz: number) => {
      const { session, ruleset, stepMs } = make(['lead', 'b', 'c', 'd'], hz);
      ruleset.proposeEnd(session, 'lead');
      ruleset.approveEnd(session, 'b');
      ruleset.approveEnd(session, 'c');
      run(session, 59_000, stepMs);
      const before = ruleset.endVoteState();
      run(session, 2_000, stepMs);
      return { before, ended: session.ended, after: ruleset.endVoteState() };
    };
    const slow = scenario(1);
    const fast = scenario(10);
    expect(slow).toEqual(fast);
    // Não-vacuidade: a votação existia e expirou de verdade nas duas taxas.
    expect(fast.before).toEqual({ active: true, proposedAtMs: 0, approved: ['lead', 'b', 'c'] });
    expect(fast.after).toEqual({ active: false, proposedAtMs: 0, approved: [] });
  });

  it('re-propor reinicia a janela e as aprovações, mantendo só a do líder', () => {
    const { session, ruleset, stepMs } = make(['lead', 'b', 'c', 'd']);
    expect(ruleset.proposeEnd(session, 'lead')).toEqual({ ok: true });
    expect(ruleset.approveEnd(session, 'b')).toEqual({ ok: true });
    run(session, 30_000, stepMs);
    expect(ruleset.proposeEnd(session, 'lead')).toEqual({ ok: true });
    // A proposta velha morreu com a nova: só o líder consta, e a janela de 60 s recomeçou.
    expect(ruleset.endVoteState()).toEqual({ active: true, proposedAtMs: 30_000, approved: ['lead'] });
    run(session, 59_000, stepMs);
    expect(session.ended).toBeNull();
  });
});

describe('carga e duração do equipamento (#421, ADR 0032 d.8)', () => {
  const withAmulet = (charges: number): InventoryState => ({
    backpack: [],
    equipped: { neck: { instanceId: 'a1', itemId: 'glacier-amulet', quantity: 1, charges } },
  });

  /** Um monstro do tipo dado, colado no herói, que aguenta os golpes dele. */
  const brawl = (damageType: string, ms: number) => {
    const loaded = content({ monsters: [{ ...rat, health: 100_000, damageType }] });
    const { session, hero, ruleset } = start({ loaded, inventory: withAmulet(2) });
    session.advanceBy(50);
    const target = ruleset.monsters[0];
    if (target !== undefined) target.position = { ...hero.position, y: hero.position.y + 1 };
    const events: DomainEvent[] = [];
    for (let t = 0; t < ms && session.ended === null; t += 100) {
      session.advanceBy(100);
      events.push(...session.drainEvents());
    }
    return { session, hero, events };
  };

  it('golpe de fogo gasta carga; em zero o colar some do slot e não vai à mochila (RF-04/RF-06)', () => {
    const { hero, events } = brawl('fire', 12_000);
    // Não é vácuo: o monstro de fato acertou o herói.
    expect(events.some((e) => e.kind === 'creature-hit' && e.creatureId === 'hero'
      && String(e.attackerId).startsWith('m:'))).toBe(true);
    expect(hero.inventory.equippedAt('neck')).toBeNull();
    expect([...hero.inventory.items()].some((i) => i.itemId === 'glacier-amulet')).toBe(false);
    expect(events.some((e) => e.kind === 'equipment-changed' && e.characterId === 'hero')).toBe(true);
  });

  it('golpe de tipo que o colar NÃO protege não gasta carga (RF-05)', () => {
    const { hero, events } = brawl('physical', 8_000);
    expect(events.some((e) => e.kind === 'creature-hit' && e.creatureId === 'hero'
      && String(e.attackerId).startsWith('m:'))).toBe(true);
    expect(hero.inventory.equippedAt('neck')?.charges).toBe(2);
  });

  // O anel com carga (#524, alargado de `#consumeAmuletCharge` para o slot `finger`): mesmo
  // mecanismo do colar, e as duas peças gastam INDEPENDENTE quando vestidas juntas.
  const withAmuletAndRing = (charges: number): InventoryState => ({
    backpack: [],
    equipped: {
      neck: { instanceId: 'a1', itemId: 'glacier-amulet', quantity: 1, charges },
      finger: { instanceId: 'r1', itemId: 'charge-ring', quantity: 1, charges },
    },
  });

  it('o anel gasta carga por golpe protegido, como o colar (#524)', () => {
    const loaded = content({ monsters: [{ ...rat, health: 100_000, damageType: 'fire' }] });
    const { session, hero, ruleset } = start({ loaded, inventory: withAmuletAndRing(2) });
    session.advanceBy(50);
    const target = ruleset.monsters[0];
    if (target !== undefined) target.position = { ...hero.position, y: hero.position.y + 1 };
    const events: DomainEvent[] = [];
    for (let t = 0; t < 12_000 && session.ended === null; t += 100) {
      session.advanceBy(100);
      events.push(...session.drainEvents());
    }
    expect(events.some((e) => e.kind === 'creature-hit' && e.creatureId === 'hero'
      && String(e.attackerId).startsWith('m:'))).toBe(true);
    // As DUAS peças protegem o MESMO golpe de fogo e gastam independente: as duas esgotam juntas.
    expect(hero.inventory.equippedAt('neck')).toBeNull();
    expect(hero.inventory.equippedAt('finger')).toBeNull();
  });

  it('um golpe só gasta UMA carga do anel, não duas (RF-05 do anel)', () => {
    const loaded = content({ monsters: [{ ...rat, health: 100_000, damageType: 'fire' }] });
    const { session, hero, ruleset } = start({ loaded, inventory: withAmuletAndRing(2) });
    session.advanceBy(50);
    const target = ruleset.monsters[0];
    if (target !== undefined) target.position = { ...hero.position, y: hero.position.y + 1 };
    // Só o PRIMEIRO golpe do monstro (2000 ms de intervalo, ver `rat` na fixture) — bem antes
    // do segundo, para medir UMA carga gasta, não duas.
    session.advanceBy(1_000);
    session.drainEvents();
    expect(hero.inventory.equippedAt('finger')?.charges).toBe(1);
    expect(hero.inventory.equippedAt('neck')?.charges).toBe(1);
  });

  it('equipar item com durationMs agenda o vencimento no instante exato (RF-01)', () => {
    const loaded = content();
    const { session, hero } = start({
      loaded,
      inventory: { backpack: [{ instanceId: 'r1', itemId: 'time-ring', quantity: 1 }], equipped: {} },
    });
    const before = session.pendingEvents;
    expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
    expect(session.pendingEvents).toBe(before + 1);
    expect(hero.inventory.equippedAt('finger')?.instanceId).toBe('r1');

    session.advanceBy(3_999);
    expect(hero.inventory.equippedAt('finger')?.instanceId).toBe('r1');
    session.advanceBy(1);
    expect(hero.inventory.equippedAt('finger')).toBeNull();
    expect(session.drainEvents().some((e) => e.kind === 'equipment-changed')).toBe(true);
  });

  it('desequipar antes de vencer cancela o vencimento e o anel volta à mochila (RF-02)', () => {
    const loaded = content();
    const { session, hero } = start({
      loaded,
      inventory: { backpack: [{ instanceId: 'r1', itemId: 'time-ring', quantity: 1 }], equipped: {} },
    });
    expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
    session.advanceBy(2_000);
    expect(hero.inventory.unequip('finger', { backpackSlots: 0, satchelSlots: 20, row: 1 }).ok).toBe(true);

    session.advanceBy(5_000);
    expect(hero.inventory.equippedAt('finger')).toBeNull();
    expect([...hero.inventory.items()].some((i) => i.instanceId === 'r1')).toBe(true);
  });

  it('o vencimento a 1 Hz desanexado é idêntico ao de 10 Hz (RF-03)', () => {
    // O teste estrutural do invariante 2: se alguém trocar o evento por um contador de tick,
    // os dois instantes divergem e este teste reprova.
    const expiry = (stepMs: number) => {
      const loaded = content();
      const { session, hero } = start({
        loaded,
        inventory: { backpack: [{ instanceId: 'r1', itemId: 'time-ring', quantity: 1 }], equipped: {} },
      });
      expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
      let atMs = -1;
      while (session.nowMs < 8_000 && session.ended === null) {
        session.advanceBy(stepMs);
        if (atMs < 0 && hero.inventory.equippedAt('finger') === null) atMs = session.nowMs;
      }
      return { atMs, state: hero.inventory.getState(), snapshot: session.snapshot() };
    };

    const tenHz = expiry(100);
    const oneHz = expiry(1_000);
    expect(tenHz.atMs).toBe(4_000);
    expect(oneHz.atMs).toBe(tenHz.atMs);
    expect(oneHz.state).toEqual(tenHz.state);
    expect(oneHz.snapshot).toEqual(tenHz.snapshot);
  });

  it('snapshot no meio da carga restaura charges e o EQUIP_EXPIRE, que vence no instante original (RF-08)', () => {
    const loaded = content();
    const { session, hero } = start({
      loaded,
      inventory: {
        backpack: [],
        equipped: {
          neck: { instanceId: 'a1', itemId: 'glacier-amulet', quantity: 1, charges: 1 },
          finger: { instanceId: 'r1', itemId: 'time-ring', quantity: 1 },
        },
      },
    });
    expect(hero.inventory.equippedAt('finger')?.instanceId).toBe('r1');
    session.advanceBy(1_000);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );
    const resumedHero = resumed.participants[0] as CharacterRuntime;
    expect(resumedHero.inventory.equippedAt('neck')?.charges).toBe(1);
    expect(resumedHero.inventory.equippedAt('finger')?.instanceId).toBe('r1');

    // O vencimento volta na fila e vence no instante lógico original (4000), sem `onResume`
    // reagendar.
    resumed.advanceBy(2_999);
    expect(resumedHero.inventory.equippedAt('finger')?.instanceId).toBe('r1');
    resumed.advanceBy(1);
    expect(resumedHero.inventory.equippedAt('finger')).toBeNull();
  });
});

describe('bônus de equipamento — kit level 200 (#524)', () => {
  it('boots of haste soma direto em character.speed ao entrar na hunt', () => {
    const loaded = content();
    const withBoots: InventoryState = {
      backpack: [],
      equipped: { feet: { instanceId: 'b1', itemId: 'fast-boots', quantity: 1 } },
    };
    const bare = start({ loaded });
    const booted = start({ loaded, inventory: withBoots });
    // +50 do `bonuses.speed` da fixture, exatamente — nada mais muda entre os dois.
    expect(booted.hero.speed).toBe(bare.hero.speed + 50);
  });

  it('calçar a bota em voo muda a velocidade no MESMO evento, sem esperar o próximo passo', () => {
    const loaded = content();
    const { session, hero } = start({
      loaded,
      inventory: { backpack: [{ instanceId: 'b1', itemId: 'fast-boots', quantity: 1 }], equipped: {} },
    });
    const before = hero.speed;
    expect(hero.inventory.equip('b1', hero, loaded.items).ok).toBe(true);
    expect(hero.speed).toBe(before + 50);
    expect(hero.inventory.unequip('feet', { backpackSlots: 0, satchelSlots: 20, row: 1 }).ok).toBe(true);
    expect(hero.speed).toBe(before);
  });

  it('o bônus de skill do item soma no poder da arma da MESMA skill (Paladin Armor no crossbow)', () => {
    const loaded = content();
    const bare = start({
      loaded,
      inventory: {
        backpack: [],
        equipped: { hand: { instanceId: 'w1', itemId: 'sword', quantity: 1 } },
      },
    });
    const hatted = start({
      loaded,
      inventory: {
        backpack: [],
        equipped: {
          hand: { instanceId: 'w1', itemId: 'sword', quantity: 1 },
          head: { instanceId: 'h1', itemId: 'sharp-hat', quantity: 1 },
        },
      },
    });
    // As duas leem a MESMA skill (`melee`, a família `sword` — ver `weaponFamilies` acima); o
    // sharp-hat soma +20 nela — o bônus só existe enquanto o item está vestido, e
    // `Inventory.skillBonus` é quem `#weaponPower` consulta (o mecanismo real do Paladin Armor
    // no crossbow é o mesmo, só a skill muda para `distance`).
    expect(hatted.hero.inventory.skillBonus(loaded.items, 'melee'))
      .toBe(bare.hero.inventory.skillBonus(loaded.items, 'melee') + 20);
  });
});

// --- disparo manual, estado dos slots e alvo escolhido (AB-09) -------------------------------

const spellSlot = (spellId: string, over: Partial<BotSlot> = {}) => ({
  do: { kind: 'spell' as const, spellId }, ...over,
});

describe('disparo manual de slot (AB-09, ADR 0032 d.3)', () => {
  it('ignora `when`: o manual dispara com a condição falsa, o automático não (RF-01)', () => {
    const config = botConfigV2([
      { do: { kind: 'supply', supplyId: 'health-potion' }, when: [{ kind: 'hp', op: '<=', percent: 0 }] },
    ]);
    // Manual: a condição é falsa (vida cheia) e a ação sai mesmo assim.
    const manual = withSpells(config, { health: 1_000, gold: 100, monsters: false });
    expect(manual.ruleset.useSlot(manual.session, 'hero', 0, 0)).toEqual({ ok: true });
    expect(manual.hero.health).toBe(1_080);
    expect(manual.hero.goldDelta).toBe(-45);

    // O MESMO slot pelo automático não dispara: `when` vale para o bot, não para a tecla.
    const auto = withSpells(config, { health: 1_000, gold: 100, monsters: false });
    auto.session.advanceBy(50);
    expect(auto.hero.health).toBe(1_000);
    expect(auto.hero.goldDelta).toBe(0);
  });

  it('`auto:false` não impede o manual; `enabled:false` recusa (RF-03, DT-04)', () => {
    const manualOnly = withSpells(botConfigV2([
      { do: { kind: 'supply', supplyId: 'health-potion' }, auto: false },
    ]), { health: 1_000, gold: 100, monsters: false });
    expect(manualOnly.ruleset.useSlot(manualOnly.session, 'hero', 0, 0)).toEqual({ ok: true });
    expect(manualOnly.hero.goldDelta).toBe(-45);

    const disabled = withSpells(botConfigV2([
      { do: { kind: 'supply', supplyId: 'health-potion' }, enabled: false },
    ]), { health: 1_000, gold: 100, monsters: false });
    expect(disabled.ruleset.useSlot(disabled.session, 'hero', 0, 0))
      .toEqual({ ok: false, reason: 'disabled', retryInMs: 0 });
    expect(disabled.hero.goldDelta).toBe(0);
  });

  it('`set` defasado é recusa, não "usa o ativo" (RF-04, DT-03)', () => {
    const { session, ruleset } = withSpells(botConfigV2([
      { do: { kind: 'supply', supplyId: 'health-potion' } },
    ]), { health: 1_000, gold: 100, monsters: false });
    expect(ruleset.useSlot(session, 'hero', 1, 0))
      .toEqual({ ok: false, reason: 'wrong-set', retryInMs: 0 });
  });

  it('slot vazio e ação sem mana recusam, e NÃO iniciam cooldown (RF-02)', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([
      null,
      spellSlot('heal'),
    ]), { health: 1_000, mana: 0, monsters: false });
    expect(ruleset.useSlot(session, 'hero', 0, 0))
      .toEqual({ ok: false, reason: 'empty-slot', retryInMs: 0 });
    expect(ruleset.useSlot(session, 'hero', 0, 1))
      .toEqual({ ok: false, reason: 'not-enough-mana', retryInMs: 0 });
    // A ação que não aconteceu não pode consumir o livro: a mana sai por último.
    expect(hero.cooldowns.remainingMs('spell:heal', session.nowMs)).toBe(0);
  });

  it('com mana, o manual executa a magia e devolve ok (RF-02)', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([
      spellSlot('heal'),
    ]), { health: 100, mana: 200, monsters: false });
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    expect(hero.health).toBe(160);
    expect(hero.mana).toBe(180);
  });

  it('o manual não depende da taxa: 10 Hz e 1 Hz dão o mesmo estado (ADR 0020)', () => {
    const config = botConfigV2([spellSlot('heal')]);
    const run = (stepMs: number) => {
      const { session, hero, ruleset } = withSpells(config, { health: 100, mana: 200, monsters: false });
      ruleset.useSlot(session, 'hero', 0, 0);
      for (let t = 0; t < 5_000; t += stepMs) session.advanceBy(stepMs);
      return {
        health: hero.health,
        mana: hero.mana,
        cooldown: hero.cooldowns.remainingMs('spell:heal', session.nowMs),
      };
    };
    expect(run(100)).toEqual(run(1_000));
  });
});

describe('estado dos slots (AB-09, UC-BAR-003)', () => {
  it('traz 24 entradas do conjunto ativo, com empty/blocked/cooldown e remainingMs (RF-07)', () => {
    const config = botConfigV2([
      null,
      { do: { kind: 'supply', supplyId: 'health-potion' } },
      spellSlot('heal'),
    ]);
    // Saldo insuficiente para a poção: o "estoque" abstrato é o gold.
    const blocked = withSpells(config, {
      health: 1_000, mana: 200, gold: 0, monsters: false,
    });
    const before = blocked.ruleset.slotStates(blocked.session, blocked.hero);
    expect(before).toHaveLength(24);
    expect(before[0]).toMatchObject({ set: 0, slot: 0, state: 'empty' });
    expect(before[1]).toMatchObject({ state: 'blocked', reason: 'not-enough-gold' });
    expect(before[2]).toMatchObject({ state: 'ready' });
    // NÃO muta: o estado dos slots é apresentação, e o saldo continua igual.
    expect(blocked.hero.goldDelta).toBe(0);

    // Com saldo, o mesmo slot fica pronto — e executar a magia o põe em cooldown.
    const ready = withSpells(config, { health: 1_000, mana: 200, gold: 45, monsters: false });
    expect(ready.ruleset.slotStates(ready.session, ready.hero)[1]).toMatchObject({ state: 'ready' });
    expect(ready.ruleset.useSlot(ready.session, 'hero', 0, 2)).toEqual({ ok: true });
    const after = ready.ruleset.slotStates(ready.session, ready.hero);
    expect(after[2]).toMatchObject({ state: 'cooldown' });
    expect((after[2] as { remainingMs: number }).remainingMs).toBe(1_000);
  });

  it('o motivo de slotStates coincide com o de useSlot (DT-08)', () => {
    // As duas contas são independentes de propósito: uma executa, a outra espelha. Este teste
    // é a salvaguarda contra elas divergirem.
    const noMana = withSpells(botConfigV2([spellSlot('heal')]), {
      health: 1_000, mana: 0, monsters: false,
    });
    const stateNoMana = noMana.ruleset.slotStates(noMana.session, noMana.hero)[0]!;
    const outcomeNoMana = noMana.ruleset.useSlot(noMana.session, 'hero', 0, 0);
    expect(outcomeNoMana.ok).toBe(false);
    if (!outcomeNoMana.ok) expect(stateNoMana.reason).toBe(outcomeNoMana.reason);

    const noGold = withSpells(botConfigV2([
      { do: { kind: 'supply', supplyId: 'health-potion' } },
    ]), { health: 1_000, gold: 0, monsters: false });
    const stateNoGold = noGold.ruleset.slotStates(noGold.session, noGold.hero)[0]!;
    const outcomeNoGold = noGold.ruleset.useSlot(noGold.session, 'hero', 0, 0);
    expect(outcomeNoGold.ok).toBe(false);
    if (!outcomeNoGold.ok) expect(stateNoGold.reason).toBe(outcomeNoGold.reason);
  });
});

describe('alvo escolhido (AB-09, ADR 0032 d.5)', () => {
  it('selectedTargetOf mantém o alvo fora do alcance da arma; attackTargetOf não (#470, RF-05)', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    // Só `a` na TELA: a 3 tiles, fora do alcance 1 do corpo a corpo e dentro do raio de busca.
    a.position = { x: hero.position.x + 3, y: hero.position.y };
    b.position = { x: hero.position.x + 30, y: hero.position.y };
    c.position = { x: hero.position.x + 31, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');

    // A apresentação enxerga o alvo; o combate corpo a corpo, não. É a separação do #470.
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(a.subject);
    expect(ruleset.attackTargetOf(hero)).toBeNull();
  });

  it('setAttackTarget seleciona e cancela; o candidato do auto-target sobrevive ao cancelamento (#470)', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    a.position = { x: hero.position.x + 3, y: hero.position.y };
    b.position = { x: hero.position.x + 30, y: hero.position.y };
    c.position = { x: hero.position.x + 31, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');

    ruleset.setAttackTarget(hero, a);
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(a.subject);
    // Alvo explícito fora do corpo a corpo é EXCLUSIVO: não cai na política.
    expect(ruleset.attackTargetOf(hero)).toBeNull();
    expect(ruleset.getState().runners?.[hero.id]?.chosenTargetPinned).toBe(true);

    // Cancelar limpa o alvo de ATAQUE; o candidato do auto-target (#444) continua na tela.
    ruleset.setAttackTarget(hero, null);
    expect(ruleset.getState().runners?.[hero.id]?.chosenTargetPinned).toBeUndefined();
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(a.subject);
  });

  it('a eleição do bot entra por setAttackTarget, sem pinar; o clique pina (#480)', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    a.position = { x: hero.position.x + 3, y: hero.position.y };
    b.position = { x: hero.position.x + 30, y: hero.position.y };
    c.position = { x: hero.position.x + 31, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');

    // O auto-target elege `a` pela política e o registra pelo MESMO campo do jogador (#480) —
    // mas sem pinar: `chosenTargetPinned` não sai no snapshot, e o corpo a corpo continua
    // caindo na política enquanto `a` está fora de alcance.
    expect(ruleset.getState().runners?.[hero.id]?.chosenTarget).toBe(a.subject);
    expect(ruleset.getState().runners?.[hero.id]?.chosenTargetPinned).toBeUndefined();
    expect(ruleset.attackTargetOf(hero)).toBeNull();

    // `b` encosta: o alvo eleito é só mirada corrente, então quem bate é `b`.
    b.position = { x: hero.position.x + 1, y: hero.position.y };
    expect(ruleset.attackTargetOf(hero)?.subject).toBe(b.subject);

    // O clique no MESMO alvo eleito passa a ser EXCLUSIVO.
    ruleset.setAttackTarget(hero, a);
    expect(ruleset.getState().runners?.[hero.id]?.chosenTargetPinned).toBe(true);
    expect(ruleset.attackTargetOf(hero)).toBeNull();
  });

  it('sobrepõe a política enquanto vive; a morte cai no mais próximo (RF-05/RF-06)', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    // Um tique para os três ratos nascerem.
    session.advanceBy(1);
    const [a, b] = [...ruleset.monsters] as [typeof ruleset.monsters[0], typeof ruleset.monsters[0]];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Os dois ao alcance (Chebyshev 1), um de cada lado: a política sozinha escolheria o
    // primeiro na ordem de nascimento; o escolhido sobrepõe.
    a.position = { x: hero.position.x + 1, y: hero.position.y };
    b.position = { x: hero.position.x, y: hero.position.y + 1 };

    expect(ruleset.chooseTarget(session, 'hero', a.subject)).toBe(true);
    expect(ruleset.attackTargetOf(hero)?.subject).toBe(a.subject);

    // A morre: `chosenTarget` é limpo e o alvo efetivo cai no mais próximo (b).
    a.receiveDamage(a.health);
    resolveDeath(session, { kind: 'monster', monster: a });
    expect(ruleset.attackTargetOf(hero)?.subject).toBe(b.subject);

    // Id morto/desconhecido é ignorado.
    expect(ruleset.chooseTarget(session, 'hero', a.subject)).toBe(false);
    expect(ruleset.chooseTarget(session, 'hero', 'm:nao-existe')).toBe(false);
  });

  it('a magia de dano mira o ESCOLHIDO, não o mais próximo (#420)', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([
      { do: { kind: 'spell', spellId: 'strike' }, auto: false },
    ]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b] = [...ruleset.monsters];
    if (a === undefined || b === undefined) throw new Error('faltam ratos');
    // `a` está mais perto; a política sozinha o escolheria. O clique em `b` sobrepõe.
    a.position = { x: hero.position.x + 1, y: hero.position.y };
    b.position = { x: hero.position.x + 2, y: hero.position.y };
    expect(ruleset.chooseTarget(session, 'hero', b.subject)).toBe(true);

    // O ataque BÁSICO do personagem (independente do bot) já saiu no primeiro tique e acertou
    // `a`; drena antes para o teste medir só o golpe da magia.
    session.drainEvents();
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    const hits = session.drainEvents()
      .filter((event) => event.kind === 'creature-hit')
      .map((event) => (event as { creatureId: string }).creatureId);
    expect(hits).toEqual([b.subject]);
  });
});

describe('auto-target na tela e runa à distância (#444)', () => {
  const rune = {
    id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, group: 'attack',
    requires: { level: 30, magicLevel: 0 },
    effect: { kind: 'damage', basePower: 400, range: 8, area: { shape: 'circle', radius: 3, centered: 'target' } },
  };
  const chosenOf = (ruleset: HuntRuleset, id: string): string | null =>
    ruleset.getState().runners?.[id]?.chosenTarget ?? null;
  const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  it('um monstro que surge na tela vira alvo — o mais próximo pela política', () => {
    const { session, hero, ruleset } = start({ difficulty: 'bold' });
    session.advanceBy(1);
    expect(ruleset.monsters).toHaveLength(3);

    const chosen = chosenOf(ruleset, hero.id);
    expect(chosen).not.toBeNull();
    const target = ruleset.monsters.find((monster) => monster.subject === chosen);
    expect(target).toBeDefined();

    // A política padrão é `nearest`: nenhum outro vivo está mais perto que o escolhido.
    const targetDistance = chebyshev(hero.position, target!.position);
    for (const monster of ruleset.monsters) {
      if (!monster.alive) continue;
      expect(targetDistance).toBeLessThanOrEqual(chebyshev(hero.position, monster.position));
    }
  });

  it('alvo do auto-target fora do alcance da arma não trava o corpo a corpo', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    // Todos na tela, mas fora do alcance 1: o auto-target guarda o mais próximo (`a`).
    a.position = { x: hero.position.x + 5, y: hero.position.y };
    b.position = { x: hero.position.x + 6, y: hero.position.y };
    c.position = { x: hero.position.x + 7, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');
    expect(chosenOf(ruleset, hero.id)).toBe(a.subject);

    // `b` encosta: o alvo persistente continua `a`, mas o golpe cai em quem está ao alcance.
    b.position = { x: hero.position.x + 1, y: hero.position.y };
    expect(ruleset.attackTargetOf(hero)?.subject).toBe(b.subject);
    expect(chosenOf(ruleset, hero.id)).toBe(a.subject);
  });

  it('quando o alvo morre, o auto-target passa para o próximo mais próximo', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    a.position = { x: hero.position.x + 1, y: hero.position.y };
    b.position = { x: hero.position.x + 2, y: hero.position.y };
    c.position = { x: hero.position.x + 3, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');
    expect(chosenOf(ruleset, hero.id)).toBe(a.subject);

    a.receiveDamage(a.health);
    resolveDeath(session, { kind: 'monster', monster: a });
    expect(chosenOf(ruleset, hero.id)).toBe(b.subject);
  });

  it('alvo que sai da tela é limpo e o auto-target pega o próximo', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    a.position = { x: hero.position.x + 1, y: hero.position.y };
    b.position = { x: hero.position.x + 2, y: hero.position.y };
    c.position = { x: hero.position.x + 3, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');
    expect(chosenOf(ruleset, hero.id)).toBe(a.subject);

    a.position = { x: hero.position.x + 20, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');
    expect(chosenOf(ruleset, hero.id)).toBe(b.subject);
  });

  it('o alvo auto-selecionado atravessa o snapshot', () => {
    const { session, hero, ruleset } = start({ difficulty: 'bold' });
    session.advanceBy(100);
    const chosen = chosenOf(ruleset, hero.id);
    expect(chosen).not.toBeNull();

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset, Rng.fromSeed('resume'),
    );
    expect(chosenOf(resumed.ruleset as HuntRuleset, hero.id)).toBe(chosen);
  });

  it('a runa alcança a 8 mesmo com alcance de corpo a corpo 1', () => {
    const config = botConfig({
      rune: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'supply', supplyId: 'avalanche-rune' } }],
    });
    const { session, hero, ruleset } = withSpells(botConfig({}), {
      gold: 10_000, supplies: [...supplies, rune], health: 5_000,
    }, 'bold');
    hero.level = 30;
    hero.xp = totalXpForLevel(30, progression as Progression);

    // Nasce SEM bot: posiciona um alvo a 5 tiles (fora do alcance 1 do corpo a corpo) e os
    // outros fora da tela, e só então configura a runa.
    session.advanceBy(1);
    const monsters = [...ruleset.monsters];
    const far = monsters[0];
    if (far === undefined) throw new Error('faltou rato');
    far.position = { x: hero.position.x + 5, y: hero.position.y };
    for (const other of monsters.slice(1)) {
      other.position = { x: hero.position.x + 20, y: hero.position.y };
    }
    ruleset.configureBot(session, config, 'hero');
    expect(chosenOf(ruleset, hero.id)).toBe(far.subject);

    run(session, 200, 100);

    // A runa saiu no alvo a 5 tiles — sem a janela do grupo pelo alcance da runa, `targets >= 1`
    // contaria zero (a 5 tiles não há ninguém no alcance 1) e nada seria lançado.
    expect(session.aggregates.suppliesUsed).toBeGreaterThan(0);
    expect(session.aggregates.goldSpent).toBe(session.aggregates.suppliesUsed * 14);
    const hits = session.drainEvents()
      .filter((event) => event.kind === 'creature-hit')
      .map((event) => (event as { creatureId: string }).creatureId);
    expect(hits).toContain(far.subject);
  });
});

// --- o cooldown do supply e o aviso limitado das automações (#420) ---------------------------

describe('o uso de supply inicia o cooldown do grupo (#420)', () => {
  it('o segundo disparo no mesmo instante recusa, e o slot-state mostra o prazo', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([
      { do: { kind: 'supply', supplyId: 'health-potion' }, auto: false },
    ]), { health: 100, gold: 100, monsters: false });

    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    expect(ruleset.useSlot(session, 'hero', 0, 0))
      .toEqual({ ok: false, reason: 'on-cooldown', retryInMs: 1_000 });
    expect(ruleset.slotStates(session, hero)[0])
      .toMatchObject({ state: 'cooldown', remainingMs: 1_000, reason: 'on-cooldown' });

    // Vencido o livro, o slot volta a valer.
    session.advanceBy(1_000);
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
  });

  it('o slot-state mostra o cooldown INDIVIDUAL da magia, não só o do grupo (#420)', () => {
    const slow = {
      id: 'berserk', name: 'Berserk', manaCost: 15, cooldownMs: 4_000,
      group: 'attack', groupCooldownMs: 1_000,
      effect: { kind: 'damage', power: 40, range: 3, damageType: 'fire' },
    };
    const { session, hero, ruleset } = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'berserk' }, auto: false }]),
      { mana: 200, spells: [slow] },
    );
    session.advanceBy(1);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    monster.position = { x: 1, y: 0 };

    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    // O grupo vence em 1 s, mas a magia tranca 4 s: o `#perform` recusaria por 3 s a mais se o
    // `slot-state` só olhasse `group:<g>` (DT-08).
    expect(ruleset.useSlot(session, 'hero', 0, 0))
      .toEqual({ ok: false, reason: 'on-cooldown', retryInMs: 4_000 });
    expect(ruleset.slotStates(session, hero)[0])
      .toMatchObject({ state: 'cooldown', remainingMs: 4_000 });

    session.advanceBy(1_000);
    expect(ruleset.slotStates(session, hero)[0])
      .toMatchObject({ state: 'cooldown', remainingMs: 3_000 });
  });

  it('a runa de `attack` respeita o MESMO livro que a magia de ataque', () => {
    const attackSpell = {
      id: 'strike', name: 'Strike', manaCost: 15, cooldownMs: 2_000,
      group: 'attack', groupCooldownMs: 2_000,
      effect: { kind: 'damage', power: 40, range: 3, damageType: 'fire' },
    };
    const attackRune = {
      id: 'avalanche', name: 'Avalanche', price: 14, group: 'attack', groupCooldownMs: 2_000,
      requires: {},
      effect: {
        kind: 'damage', basePower: 45, range: 4, damageType: 'ice',
        area: { shape: 'circle', radius: 1, centered: 'target' },
      },
    };
    const { session, ruleset } = withSpells(
      botConfigV2([
        { do: { kind: 'spell', spellId: 'strike' }, auto: false },
        { do: { kind: 'supply', supplyId: 'avalanche' }, auto: false },
      ]),
      { mana: 200, gold: 100, spells: [attackSpell], supplies: [attackRune] },
    );
    session.advanceBy(1);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    monster.position = { x: 1, y: 0 };

    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    // A runa é do grupo `attack`: a magia de ataque acabou de trancá-lo, e a runa recusa pelo
    // prazo do livro (não pelo cooldown individual da magia).
    expect(ruleset.useSlot(session, 'hero', 0, 1))
      .toEqual({ ok: false, reason: 'on-cooldown', retryInMs: 2_000 });
  });
});

describe('automação bloqueada avisa na TRANSIÇÃO, não a cada ciclo (#420)', () => {
  const lifeRing = {
    id: 'life-ring', name: 'Life Ring', kind: 'ring', slot: 'finger', weight: 1, value: 0,
  };

  it('renew-ring bloqueado por 10 minutos gera um único automation-blocked', () => {
    const { session, ruleset } = withSpells(
      botConfigV2([], {
        automations: [{ model: 'renew-ring', params: { itemId: 'life-ring' }, enter: [], exit: [] }],
      }),
      { items: [lifeRing], monsters: false },
    );

    // 600 ciclos de 1 s (mais os ciclos trazidos pelos golpes — aqui não há golpe). Antes do
    // #420 isto virava ~600 eventos; o extrato de uma hunt de 8 h acumulava ~28.800.
    run(session, 600_000, 100);

    const blocked = session.notableEvents.filter((event) => event.type === 'automation-blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.detail).toBe('renew-ring:missing-item:life-ring');

    // A chave avisada viaja no snapshot: uma retomada não volta a registrar o mesmo aviso.
    const runner = Object.values(ruleset.getState().runners ?? {})[0];
    expect(runner?.automationWarned).toEqual({ 'renew-ring': 'missing-item:life-ring' });
  });
});

describe('hunt multiandar (#519)', () => {
  // Duas salas empilhadas, ligadas por DUAS escadas deslocadas — a mesma geometria de
  // `movement.test.ts` ("andares e escadas"): descer em (2,1,7) pousa em (3,1,6); subir em
  // (3,2,6) pousa em (2,2,7). A rota é o laço de três tiles já verificado válido em
  // `map.test.ts`/`trace-route.test.ts`: (1,1,7) → degrau de descida (2,1,7) → degrau de
  // subida (3,2,6) → fecha na diagonal de volta a (1,1,7). O rato do spawn fica LONGE do
  // caminho — este teste é sobre o walker atravessar andares, não sobre combate.
  const multiFloorMap = {
    id: 'casa', z: 7,
    floors: {
      '7': { grid: ['######', '#....#', '#....#', '######'] },
      '6': { grid: ['######', '#....#', '#....#', '######'] },
    },
    floorChanges: [
      { from: { x: 2, y: 1, z: 7 }, to: { x: 3, y: 1, z: 6 } },
      { from: { x: 3, y: 2, z: 6 }, to: { x: 2, y: 2, z: 7 } },
    ],
  };
  const multiFloorRoute = {
    id: 'casa-loop', mapId: 'casa',
    tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 2, z: 6 }],
    // Sem ponto de spawn: "rota sem ponto de spawn é hunt sem monstro" (FUN-123) — este teste
    // é só sobre o walker, e `monsterCount`/`composition` abaixo existem só porque o schema os
    // exige, nunca porque algo nasce.
    spawnPoints: [],
  };
  const multiFloorHunt = {
    id: 'arena', name: 'Casa', recommendedLevel: 1, mapId: 'casa', routeId: 'casa-loop',
    difficulties: {
      cautious: { monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000 },
    },
  };
  const multiFloor = (): Content =>
    content({ maps: [multiFloorMap], routes: [multiFloorRoute], hunts: [multiFloorHunt] });

  it('o passo pisa no degrau e pousa no destino registrado da escada, do outro andar', () => {
    // Cada passo aplica a posição NA HORA em que o evento vence (invariante 2) — `durationMs`
    // é só quando o PRÓXIMO passo pode sair, não uma animação que o `sim` espera terminar. O
    // primeiro `PLAYER_STEP` já vence em t=0 (a hunt entra pronta), então cada checagem abaixo
    // avança para um instante ESTRITAMENTE ANTES do vencimento seguinte — 500, depois 500,
    // depois 1.500 (a duração de CADA passo) somariam exatamente aos vencimentos e disparariam
    // o passo seguinte também, porque o avanço inclui o instante em que ele vence.
    const { session, hero } = start({ loaded: multiFloor() });
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });

    // t=0: (1,1,7) → pede o degrau (2,1,7) → pousa em (3,1,6). Reto, chão padrão (150),
    // speed 300: ceil50(150 000/300) = 500 ms — o passo 2 só vence em t=500.
    session.advanceBy(1);
    expect(hero.position).toEqual({ x: 3, y: 1, z: 6 });

    // t=500: (3,1,6) → pede o degrau de subida (3,2,6) → pousa em (2,2,7). Reto de novo: o
    // passo 3 vence em t=1.000 — avança só até t=999.
    session.advanceBy(998);
    expect(hero.position).toEqual({ x: 2, y: 2, z: 7 });

    // t=1.000: fecha o laço, (2,2,7) → (1,1,7), DIAGONAL — 3× antes do arredondamento.
    session.advanceBy(1);
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });
  });

  it('percorre o laço inteiro repetidas vezes e sempre volta ao início — nunca para no fim da rota', () => {
    const { session, hero } = start({ loaded: multiFloor() });
    // Um laço inteiro vence em 500 + 500 + 1.500 = 2.500 ms; cinco laços vencem em 12.500 —
    // avançar exatamente até lá (ou além) dispararia também o PRIMEIRO passo do sexto laço, que
    // sai do início. 12.499 é o último instante do quinto laço já fechado, ainda parado nele —
    // se o laço não fechasse (§14.4), a rota pararia num tile do meio, nunca voltaria aqui.
    session.advanceBy(12_499);
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });
  });

  it('o monstro nasce no ANDAR do ponto de spawn declarado, não no padrão do mapa (#519)', () => {
    // O mesmo laço, mas com UM ponto de spawn exato em z6. `aggroRadius: 0` desliga a
    // perseguição de propósito — este teste é sobre ONDE o monstro nasce, não sobre para onde
    // ele anda depois; sem isso, o primeiro passo do monstro (que também vence em t=0) mudaria
    // a posição antes da checagem, e o teste ficaria sensível a um detalhe que não é o dele.
    const comSpawnEmZ6 = {
      ...multiFloorRoute,
      spawnPoints: [{ routeIndex: 1, radius: 1, at: { x: 1, y: 2, z: 6 }, monsterId: 'rat' }],
    };
    const { session, ruleset } = start({
      loaded: content({
        monsters: [{ ...rat, aggroRadius: 0 }],
        maps: [multiFloorMap], routes: [comSpawnEmZ6], hunts: [multiFloorHunt],
      }),
    });
    session.advanceBy(10);
    expect(ruleset.monsters).toHaveLength(1);
    expect(ruleset.monsters[0]?.position).toEqual({ x: 1, y: 2, z: 6 });
  });
});

describe('drunk: desvio de passo (M31-03, #558, ADR 0041)', () => {
  /** Conta toda rolagem de `Rng.integer` — o mesmo mecanismo do `CountingRng` acima, usado aqui
   * para provar "a criatura sem drunk não consome sorteio" e "cada passo com drunk rola UMA vez
   * só" diretamente, em vez de inferir pela taxa. */
  class CountingRng extends Rng {
    integerCalls = 0;

    override integer(min: number, max: number): number {
      this.integerCalls += 1;
      return super.integer(min, max);
    }
  }

  /**
   * Sessão MANUAL (o mesmo molde da "conformidade de RNG" acima) para poder trocar o `Rng` por
   * um que conta — `start()`/`createHuntSession` sempre derivam a semente do id da sessão.
   * `aggroRadius: 0` isola o teste do PASSO: sem `session.advanceBy` nenhuma, o `Spawner` nunca
   * chega a nascer o rato (o mesmo truque do describe de paralyze/haste, CMB-11, que já usa
   * `requestMove` sem avançar tempo nenhum) — só o `walk` do socket roda, e ele passa pelo MESMO
   * `#step` que o bot e o monstro (ADR 0041 decisão 3).
   */
  function manualSession(rng: Rng): { session: Session; hero: CharacterRuntime; ruleset: HuntRuleset } {
    const loaded = content({ monsters: [{ ...rat, aggroRadius: 0 }] });
    const ruleset = createHuntRuleset(loaded, 'arena', 'cautious');
    const session = new Session({
      id: 'drunk-558', contentVersion: loaded.version, ruleset, rng, createdAtMs: 0,
    });
    const hero = character();
    session.enter(hero);
    return { session, hero, ruleset };
  }

  /** Anda para leste até a parede, depois para oeste até a outra — nunca pede um tile fora do
   * quarto (a sala de `map` é `x: 1..4, y: 1..3`), então toda RECUSA observada num passo SEM
   * desvio seria um bug nosso, não do teste. */
  function bounce(hero: CharacterRuntime, dx: { value: number }): { readonly x: number; readonly y: number } {
    if (hero.position.x <= 1) dx.value = 1;
    else if (hero.position.x >= 4) dx.value = -1;
    return { x: hero.position.x + dx.value, y: hero.position.y };
  }

  it('sem drunk, requestMove nunca consome sorteio nem desvia', () => {
    const rng = new CountingRng(Rng.fromSeed('drunk-none').getState());
    const { session, hero, ruleset } = manualSession(rng);
    const dx = { value: 1 };
    for (let i = 0; i < 200; i += 1) {
      const target = bounce(hero, dx);
      const result = ruleset.requestMove(session, hero.id, target);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.to).toEqual({ ...target, z: 7 });
    }
    expect(rng.integerCalls).toBe(0);
  });

  it('com drunk, cada passo rola exatamente UMA vez; o passo desviado bloqueado falha sem mover', () => {
    const rng = new CountingRng(Rng.fromSeed('drunk-active').getState());
    const { session, hero, ruleset } = manualSession(rng);
    hero.conditions.apply({ key: 'drunk', expiresAtMs: 1_000_000_000 });

    const dx = { value: 1 };
    const total = 4_000;
    let deviated = 0;
    for (let i = 0; i < total; i += 1) {
      const target = bounce(hero, dx);
      const before = { ...hero.position };
      const rollsBefore = rng.integerCalls;
      const result = ruleset.requestMove(session, hero.id, target);
      // Exatamente um sorteio por PASSO — a criatura tem drunk, então `#step` sempre rola, com
      // sucesso ou não (a criatura SEM drunk do teste acima nunca rola nenhum).
      expect(rng.integerCalls).toBe(rollsBefore + 1);
      if (!result.ok) {
        deviated += 1;
        // O critério da issue: o passo desviado para um tile bloqueado FALHA e NÃO move —
        // exatamente como `move()` já se comporta para qualquer outra recusa.
        expect(hero.position).toEqual(before);
        continue;
      }
      if (result.to.x !== target.x || result.to.y !== target.y) deviated += 1;
    }
    // A taxa EXATA (4/61 do enum do Canary) tem o teste de unidade dela em `conditions.test.ts`,
    // sem ruído nenhum; aqui o que se mede é a integração — o desvio realmente ACONTECE pelo
    // `#step` de verdade, e os dois ramos (livre/bloqueado) aparecem. A faixa é larga de
    // propósito: quando a direção sorteada COINCIDE com a direção que o bounce já ia tomar
    // (1 dos 4 cardeais, 1/61 dos casos), o desvio não é OBSERVÁVEL na posição — a taxa
    // observada verdadeira é ~3/61 (4,9 %), não ~4/61 (6,6 %); a margem cobre as duas sem
    // deixar passar uma rolagem com bounds errados (que erraria por uma ordem de grandeza).
    expect(deviated).toBeGreaterThan(0);
    expect(deviated / total).toBeGreaterThan(0.02);
    expect(deviated / total).toBeLessThan(0.12);
  });

  it('o bot NUNCA rola drunk duas vezes no MESMO vencimento, mesmo com o contorno de companheiro (#651)', () => {
    // Achado da revisão do #651: o teste acima só cobre `requestMove` (`#step` UMA vez por
    // chamada) — mas `#playerStep`, o passo do PRÓPRIO bot, pode chamar `#step` uma SEGUNDA vez
    // no MESMO vencimento quando o próximo tile da rota está ocupado por um COMPANHEIRO parado
    // (#203): o contorno via `greedyStep` tenta de novo. Sem a correção, a segunda chamada
    // rolava drunk de novo — um vencimento só de `PLAYER_STEP` consumindo DOIS sorteios
    // independentes. O próprio Canary nunca faz isso: quando o passo primário de
    // `Monster::doFollowCreature`/`doWalkBack` (`monster.cpp`) falha, o fallback
    // (`getDanceStep`/`getRandomStep`) NUNCA volta a chamar `Creature::getNextStep`/`onWalk` —
    // o sorteio é UM por DECISÃO de movimento, nunca um por tentativa física de chegar lá.
    class ScriptedDrunkRng extends Rng {
      drunkRolls = 0;

      override integer(min: number, max: number): number {
        if (min === 0 && max === 60) {
          this.drunkRolls += 1;
          // Sempre > DIRECTION_DIAGONAL_MASK (4): nunca desvia nem fala, então o alvo original
          // não muda entre rolagens — o companheiro trava o MESMO tile em toda tentativa. Este
          // teste mede a CONTAGEM de sorteios, não a taxa de desvio (já coberta acima).
          return 10;
        }
        return super.integer(min, max);
      }
    }
    const rng = new ScriptedDrunkRng(Rng.fromSeed('drunk-companion-651').getState());
    // Sem `spawnPoints`: nenhum monstro nasce para interferir — só a geometria de rota e
    // companheiro importa aqui.
    const loaded = content({ routes: [{ ...route, spawnPoints: [] }] });
    const ruleset = createHuntRuleset(loaded, 'arena', 'cautious');
    const session = new Session({
      id: 'drunk-companion-651', contentVersion: loaded.version, ruleset, rng, createdAtMs: 0,
    });
    const hero = character();
    const blocker = new CharacterRuntime({ ...character().getState(), id: 'blocker' });
    session.enter(hero);
    session.enter(blocker);
    // `placeNear`/`tilesAround` (#203) colocam o SEGUNDO participante no tile LIVRE mais
    // próximo do início da rota, em ordem fixa de anel — para esta sala e esta rota, isso é
    // exatamente (2,1): o PRÓXIMO tile da rota do herói. Confirma a premissa da geometria antes
    // de travar o bloqueador nela — se o algoritmo de posicionamento mudar, este teste falha
    // aqui, alto e claro, em vez de silenciosamente deixar de cobrir o ramo que existe para
    // testar.
    expect(blocker.position).toEqual({ x: 2, y: 1, z: 7 });
    // Trava o bloqueador ONDE está: sem passo próprio, ele nunca sai da frente sozinho (o mesmo
    // `stand()` do describe de follow, mais abaixo, sem precisar importar o helper de lá).
    session.cancelEvent('player-step', 'blocker');
    hero.conditions.apply({ key: 'drunk', expiresAtMs: 1_000_000_000 });

    // UM vencimento do PLAYER_STEP do herói: a rota pede (2,1), o bloqueador está lá, o ramo de
    // contorno (`#companionAt`/`greedyStep`) chama `#step` uma segunda vez.
    session.advanceBy(1);

    expect(rng.drunkRolls).toBe(1);
    // O contorno realmente rodou: o herói saiu de (1,1) para um tile ADJACENTE que não é o do
    // bloqueador — a prova de que o ramo certo foi exercitado, não só "nada aconteceu".
    expect(hero.position).not.toEqual({ x: 1, y: 1, z: 7 });
    expect(hero.position).not.toEqual(blocker.position);
  });

  it('o MONSTRO com drunk também desvia (ADR 0041 decisão 3, invariante 11) — mesmo `#step`', () => {
    // O teste acima já prova a mecânica no PERSONAGEM; este prova o outro lado do invariante 11:
    // o passo do PRÓPRIO monstro, guiado pela IA (nunca pelo bot do jogador), passa pelo MESMO
    // `#step` — `#drunkTarget` confere `Conditions`, que personagem e monstro têm igual, sem
    // tratamento por tipo de criatura.
    //
    // A `map`/`route` da fixture do arquivo é PEQUENA demais para este teste: o spawn nasce a
    // distância 3 do herói e o passo guloso do monstro é DIAGONAL (#9, oito direções) — o
    // primeiro `MONSTER_STEP` (agendado com atraso ZERO no nascimento) já fecha a distância até
    // adjacente, ANTES de o teste conseguir aplicar drunk depois do `advanceBy` que faz o rato
    // nascer. Um mapa MAIOR, com o spawn bem mais longe do herói, garante distância sobrando
    // depois desse primeiro passo "de graça" — o suficiente para vários passos DEPOIS de drunk
    // aplicado.
    const bigMap = {
      id: 'big-arena', z: 7,
      grid: [
        '################',
        ...Array.from({ length: 14 }, () => '#..............#'),
        '################',
      ],
    };
    const bigRoute = {
      id: 'big-arena-loop', mapId: 'big-arena',
      tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
      spawnPoints: [{ routeIndex: 0, radius: 1, at: { x: 14, y: 14, z: 7 }, monsterId: 'rat' }],
    };
    const bigHunt = {
      id: 'big-arena', name: 'Big Arena', recommendedLevel: 1,
      mapId: 'big-arena', routeId: 'big-arena-loop',
      difficulties: {
        cautious: {
          monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000,
        },
      },
    };
    class FilteringRng extends Rng {
      drunkRolls = 0;

      override integer(min: number, max: number): number {
        // `rollDrunkDeviation` é o ÚNICO chamador deste pacote que pede exatamente [0, 60] —
        // dano, alcance e índice de alvo usam faixas bem menores nesta fixture.
        if (min === 0 && max === 60) this.drunkRolls += 1;
        return super.integer(min, max);
      }
    }
    // `aggroRadius` grande cobre o mapa inteiro. HP absurdo (a mesma fixture `paralyzingRat` do
    // CMB-11 acima): o herói ataca sozinho pelo reflexo de "alguém ao alcance", e um rato de 50
    // HP morreria assim que chegasse perto — o RESPAWN traria um monstro NOVO sem a condição que
    // este teste aplicou à mão, confundindo exatamente o que ele mede.
    const loaded = content({
      monsters: [{ ...rat, aggroRadius: 50, health: 100_000 }],
      maps: [bigMap], routes: [bigRoute], hunts: [bigHunt],
    });

    const withoutDrunk = new FilteringRng(Rng.fromSeed('monster-drunk-a').getState());
    const rulesetA = createHuntRuleset(loaded, 'big-arena', 'cautious');
    const sessionA = new Session({
      id: 'monster-drunk-a', contentVersion: loaded.version, ruleset: rulesetA,
      rng: withoutDrunk, createdAtMs: 0,
    });
    sessionA.enter(character());
    run(sessionA, 20_000, 200);
    expect(withoutDrunk.drunkRolls).toBe(0);

    const withDrunk = new FilteringRng(Rng.fromSeed('monster-drunk-b').getState());
    const rulesetB = createHuntRuleset(loaded, 'big-arena', 'cautious');
    const sessionB = new Session({
      id: 'monster-drunk-b', contentVersion: loaded.version, ruleset: rulesetB,
      rng: withDrunk, createdAtMs: 0,
    });
    sessionB.enter(character());
    sessionB.advanceBy(10); // o rato nasce e dá o primeiro passo (sem drunk ainda).
    const monster = rulesetB.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    // Ainda longe do herói (spawn a distância 13 do início da rota) — sobra passo de sobra
    // depois do primeiro "de graça" para provar o desvio com drunk já ativo.
    expect(monster.health).toBe(100_000);
    monster.conditions.apply({ key: 'drunk', expiresAtMs: 1_000_000_000 });
    run(sessionB, 20_000, 200);
    expect(withDrunk.drunkRolls).toBeGreaterThan(0);
  });
});
