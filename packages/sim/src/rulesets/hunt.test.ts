import { buildContent, isBlocked, placeholderAppearances } from '@draconya/content';
import type { Content, FieldSpec, Item, Progression, RawContent } from '@draconya/content';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { resolveDamage } from '../combat/damage.js';
import type { DamageOutcome } from '../combat/damage.js';
import { DISTANCE_BLOCK_FLAGS, MAGIC_BLOCK_FLAGS } from '../combat/blockhit.js';
import { rollCombatValue } from '../combat/combat-value.js';
import { normalRandomInt } from '../combat/weapon-power.js';
import type { BestiaryState } from '../bestiary.js';
import type { SkillsState } from '../skills.js';
import type { InventoryState } from '../inventory.js';
import { resolveDeath } from '../death.js';
import { DEFAULT_DIFFICULTY_NAME, huntListings } from '../hunt/catalogue.js';
import { FORWARD } from '../area.js';
import { CHALLENGE_CONDITION_KEY, MonsterRuntime, monsterSubject } from '../monster/monster.js';
import type { MonsterState } from '../monster/monster.js';
import { distance } from '../monster/step.js';
import type { GridPoint } from '../monster/step.js';
import { statsForLevel, totalXpForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import { MAX_PENDING_DOMAIN_EVENTS, SNAPSHOT_FORMAT_VERSION, Session } from '../session.js';
import type { DomainEvent, SessionSnapshot } from '../session.js';
import {
  HuntRuleset, PartyFullError, changeDifficulty, compileExitRules, createHuntRuleset, createHuntSession,
  huntRulesetFromSnapshot,
} from './hunt.js';
import type { HuntExitRule, HuntView, PartyOptionsInput } from './hunt.js';
import { chestStorageKeyOf } from '../tile-overrides.js';

// O resolver canônico é ENVOLVIDO, não substituído (CMB-02): o `vi.fn` delega para a
// implementação real, então todo o resto do arquivo roda idêntico — e o bloco do pipeline no
// fim consegue provar que CADA produtor passa por este ponto. Um produtor que calculasse dano
// por fora não apareceria nas chamadas gravadas.
vi.mock('../combat/damage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../combat/damage.js')>();
  return { ...actual, resolveDamage: vi.fn(actual.resolveDamage) };
});

// O sorteio de valor (#681) é ENVOLVIDO pelo mesmo motivo: delega para o real, e o bloco do
// Dragon sob `combat-v3` prova que a ability e a cura do monstro passam por ele.
vi.mock('../combat/combat-value.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../combat/combat-value.js')>();
  return { ...actual, rollCombatValue: vi.fn(actual.rollCombatValue) };
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
  // Fim do pull por dificuldade (#583, ADR 0039): o ponto declara o próprio monstro e o
  // próprio `respawnDelayMs` — não há mais `hunt.difficulties` para cair como fallback. Testes
  // que precisam de outro monstro/prazo neste ponto sobrescrevem `route.spawnPoints[0]`.
  spawnPoints: [{ routeIndex: 4, radius: 2, monsterId: 'rat', respawnDelayMs: 30_000 }],
};

/**
 * A mesma rota, com TRÊS pontos de spawn (#583) — o que `difficulty: 'bold'` costumava dar de
 * graça via `monsterCount: 3` espalhado por cima de um ponto só. Cada teste que pede "bold"
 * pedia densidade, não um nome; esta é a rota que entrega os três ratos.
 */
const threeRatsRoute = {
  ...route,
  // Os três no MESMO ponto (índice 4, radius 2) — a mesma posição nominal que o `route` de
  // sempre já usa, e a mesma vizinhança onde o antigo `Spawner` espalhava os 3 slots do
  // `monsterCount: 3` de "bold" (#583: cada slot agora é um PONTO, não mais uma fração de um só;
  // três pontos idênticos reproduzem a mesma vizinhança de spawn, só sem o rodízio antigo).
  // `respawnDelayMs: 10_000` é o valor que a antiga dificuldade `bold` usava (mais curto que o
  // `cautious` de 30 000), preservado para não travar o throughput de testes que dependem de
  // vários ciclos de respawn numa janela de tempo fixa.
  spawnPoints: [
    { routeIndex: 4, radius: 2, monsterId: 'rat', respawnDelayMs: 10_000 },
    { routeIndex: 4, radius: 2, monsterId: 'rat', respawnDelayMs: 10_000 },
    { routeIndex: 4, radius: 2, monsterId: 'rat', respawnDelayMs: 10_000 },
  ],
};

/**
 * Fartura DELIBERADA — mais pontos e respawn mais curto que `threeRatsRoute` — para os dois
 * testes de "quem mata mais rápido" (skill/equipamento), onde a disponibilidade de monstro não
 * pode ser o teto: o que se mede ali é velocidade de abate, não densidade de spawn.
 */
const manyRatsRoute = {
  ...route,
  spawnPoints: Array.from({ length: 8 }, () => (
    { routeIndex: 4, radius: 3, monsterId: 'rat', respawnDelayMs: 3_000 }
  )),
};

const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1,
  health: 50, experience: 5, attack: 10, armor: 0,
  attackIntervalMs: 2000, speed: 300, aggroRadius: 4, attackRange: 1,
  // `blockable` AUSENTE (#583) — o default do Canary, e o que preserva as centenas de testes
  // deste arquivo que matam o rato em loop e esperam respawn contínuo: a sala é pequena (4×3)
  // e o herói está sempre dentro da janela de visão do respawn (`SPAWN_VISIBILITY_RADIUS`, ±11
  // tiles); um rato `blockable: true` NUNCA respawnaria de volta aqui, porque a vista nunca
  // limpa. `blockable: true` foi tentado antes do #583 mudar o mecanismo (`spawnClearRadius`,
  // #236, vestigial neste conteúdo de teste — a hunt nunca declarou o campo, então valia 0/
  // desligado e o campo do monstro não tinha efeito nenhum) e removido nesta revisão porque
  // passou a ter efeito de verdade e travava o respawn. O describe "respawn: blockable espera a
  // vista limpar…" testa o mecanismo NOVO isoladamente, com sua própria sala grande.
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
  regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.56, promotionReduction: 0.3 },
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
  // #596: Cancel Magic Shield — remove a condição do lançador NA HORA, sem agendar nada.
  {
    id: 'cancel-magic-shield', name: 'Cancel Magic Shield', manaCost: 10, cooldownMs: 1_000,
    effect: { kind: 'remove-condition', key: 'mana-shield' },
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
    // A regeneração PRÓPRIA do Canary id 3089 (#688), somada à da vocação.
    bonuses: { regeneration: { healthGain: 2, healthTicksMs: 6000, manaGain: 8, manaTicksMs: 6000 } },
  },
  // O Dwarven Ring (#688, Canary id 3099 `suppressdrunk`): drunk não entra nem desvia.
  {
    id: 'dwarven-ring', name: 'Dwarven Ring', kind: 'ring', slot: 'finger',
    weight: 1, value: 0, bonuses: { suppress: ['drunk'] },
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
    weight: 1, value: 0, bonuses: { skills: [{ skillId: 'melee', amount: 20 }] },
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
    inventory?: InventoryState; bestiary?: BestiaryState; gold?: number;
    boostedMonsterId?: string } = {},
): Started {
  // `difficulty` não seleciona mais nada no conteúdo (#583) — é só um rótulo aceito e ignorado
  // pelo `sim`. "bold" aqui é o pedido de DENSIDADE que a dificuldade costumava dar de graça
  // (`monsterCount: 3`): sem `loaded` explícito, cai na rota de três pontos.
  const defaultContent = options.difficulty === 'bold' ? content({ routes: [threeRatsRoute] }) : content();
  const session = createHuntSession({
    id: 'session-1',
    content: options.loaded ?? defaultContent,
    huntId: 'arena',
    difficulty: options.difficulty ?? 'cautious',
    createdAtMs: 0,
    ...(options.exitRules === undefined ? {} : { exitRules: options.exitRules }),
    ...(options.boostedMonsterId === undefined ? {} : { boostedMonsterId: options.boostedMonsterId }),
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

/**
 * "Planta" o monstro num tile: a posição E o `home` (#655). Um teste que reposiciona um monstro
 * inerte (`aggroRadius: 0`) só mudando `position` deixa o `home` no spawn de verdade, e o monstro
 * — sem ninguém à vista e fora do spawn — volta para lá andando (`Monster::updateIdleStatus`).
 * Plantar diz ao motor que ESTE é o ponto de spawn dele.
 */
function plant(monster: MonsterRuntime, at: { x: number; y: number; z?: number }): void {
  monster.position = at;
  Object.assign(monster, { home: at });
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

  it('aceita QUALQUER string de dificuldade, e ignora — o conteúdo não define mais nenhuma (#583)', () => {
    // Antes do #583, uma dificuldade que a hunt não tinha declarado derrubava a construção. O
    // conteúdo deixou de ter `difficulties` de qualquer forma (ADR 0039); o campo sobrevive no
    // protocolo só por compatibilidade (`enter-hunt.difficulty`, #584) e o `sim` não o valida
    // mais — a hunt nasce igual, venha o que vier nesse campo.
    expect(() => createHuntSession({
      id: 's', content: content(), huntId: 'arena', difficulty: 'reckless', createdAtMs: 0,
    })).not.toThrow();
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
      routes: [{ ...route, spawnPoints: [{ routeIndex: 1, radius: 1, monsterId: 'rat', respawnDelayMs: 30_000 }] }],
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
    // para a caixa antes. Sem `corpseTtlMs` no monstro (#585, era da hunt), nada disto acontece.
    const loaded = content({ monsters: [{ ...rat, corpseTtlMs: 1_000 }] });
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
    const loaded = content({ monsters: [{ ...rat, corpseTtlMs: 5_000 }] });
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

  it('todo ponto de spawn nasce, sem pull (#583): 3 pontos são 3 vivos, todos ao mesmo tempo', () => {
    const tresPontos = {
      ...route,
      spawnPoints: [
        { routeIndex: 0, radius: 1, monsterId: 'rat', respawnDelayMs: 1 },
        { routeIndex: 3, radius: 1, monsterId: 'rat', respawnDelayMs: 1 },
        { routeIndex: 6, radius: 1, monsterId: 'rat', respawnDelayMs: 1 },
      ],
    };
    const loaded = content({
      monsters: [{ ...rat, health: 100_000, aggroRadius: 0 }],
      routes: [tresPontos],
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

  it('não aplica bônus nenhum sem `boostedMonsterId`, e nenhum quando a boosted é OUTRO monstro (#615)', () => {
    // A hunt não tem `boostedMonsterId` — sanidade do caminho de sempre.
    const { session: plain, hero: plainHero } = start();
    run(plain, 20_000, 100);
    expect(plainHero.xp).toBe(plain.aggregates.kills * rat.experience);
    expect(plainHero.goldDelta).toBe(plain.aggregates.kills * 3);

    // A boosted do dia é OUTRO monstro (nenhum aqui, mas a hunt só tem `rat`) — o rato que
    // morre nunca bate `monsterId === boostedMonsterId`, e o efeito nunca liga.
    const { session, hero } = start({ boostedMonsterId: 'dragon' });
    run(session, 20_000, 100);
    expect(hero.xp).toBe(session.aggregates.kills * rat.experience);
    expect(hero.goldDelta).toBe(session.aggregates.kills * 3);
  });

  it('XP ×2 para a Boosted Creature do dia (#615, ADR 0054 decisão 7)', () => {
    const { session, hero } = start({ boostedMonsterId: 'rat' });
    run(session, 20_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.xp).toBe(session.aggregates.kills * rat.experience * 2);
    expect(session.aggregates.xpGained).toBe(hero.xp);
  });

  it('um roll extra de loot para a Boosted Creature do dia (#615, ondroploot_boosted.lua)', () => {
    // `rat.loot.gold` é `{ chance: 1, min: 3, max: 3 }`: nunca falha e nunca sorteia
    // quantidade (min === max, FUN-63) — o dobro é EXATO, sem depender de semente nenhuma.
    const { session, hero } = start({ boostedMonsterId: 'rat' });
    run(session, 20_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.goldDelta).toBe(session.aggregates.kills * 3 * 2);
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

  it('monstro de tabela canary (#685): mesma semente, mesmo loot a 1 Hz e a 10 Hz', () => {
    // O modelo do Canary consome dois sorteios por linha e tira a quantidade da rolagem; nada
    // disso pode depender da cadência — o sorteio é estágio do evento de morte, não do tick.
    const canaryRat = {
      ...rat,
      loot: {
        rollModel: 'canary',
        gold: { chance: 0.6, min: 1, max: 30 },
        items: [{ itemId: 'sword', chance: 0.5, min: 1, max: 1 }],
      },
    };
    const loaded = content({ monsters: [canaryRat] });
    const at = (stepMs: number) => {
      const { session, hero } = start({ loaded, difficulty: 'bold' });
      run(session, 120_000, stepMs);
      return {
        kills: session.aggregates.kills,
        gold: session.aggregates.goldGained,
        items: [...hero.inventory.items()].map((i) => `${i.instanceId}/${i.itemId}`),
      };
    };
    const fast = at(100);
    expect(at(1_000)).toEqual(fast);
    expect(fast.kills).toBeGreaterThan(2);
    expect(fast.gold).toBeGreaterThan(0);
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

    // Ainda dentro dos 30 s do ponto: nada nasce, e portanto nada mais morre.
    session.advanceBy(29_000);
    expect(ruleset.monsters).toHaveLength(0);
    expect(session.aggregates.kills).toBe(1);

    // `respawnDelayMs` (30 s) cumprido, mas o rato não é `blockable` (#583): ele ainda está no
    // telegraph de 4200 ms, não existe no mundo ainda.
    session.advanceBy(1_000);
    expect(ruleset.monsters).toHaveLength(0);

    // Telegraph cumprido: materializa.
    session.advanceBy(4_300);
    expect(ruleset.monsters).toHaveLength(1);
  });
});

describe('regeneração (FUN-36)', () => {
  it('recupera por tempo decorrido, sem número por tick', () => {
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn, health: 100 });

    run(session, 30_000, 100);

    // 1 ponto a cada 1 000 ms no conteúdo de teste: trinta segundos são trinta pulsos. O
    // primeiro vence em `ticksMs` depois da entrada, não nela (#678): o contador do Canary
    // começa em 0, e entrar na hunt não é poção — até #678 eram 31, com um pulso imediato.
    expect(hero.health).toBe(130);
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

  it('o Life Ring SOMA a própria regeneração à da vocação (140 HP em 30 s em vez de 130)', () => {
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({
      loaded: semSpawn, health: 100,
      inventory: {
        backpack: [],
        equipped: { finger: { instanceId: 'ring', itemId: 'life-ring', quantity: 1 } },
      },
    });

    run(session, 30_000, 100);

    // A vocação continua igual (30 pulsos × 1) e o anel soma os dele (#688): +2 a cada 6 s,
    // cinco ganhos em 30 s. Até #688 o anel multiplicava o pulso por 4 e dava 220.
    expect(hero.health).toBe(140);
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
    expect(hero.health).toBe(130);
  });

  it('`amount` zero não regenera, e não agenda evento nenhum', () => {
    // `amount: 0` é "não regenera" (#678): nenhum pulso entra na fila, em vez de um evento
    // periódico que vence para não fazer nada a hunt inteira.
    const parado = content({
      routes: [{ ...route, spawnPoints: [] }],
      progression: [{ ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
    });
    const { session, hero } = start({ loaded: parado, health: 100 });
    // `cancelEvent` devolve quantos havia na fila: zero é "nenhum pulso agendado".
    expect(session.cancelEvent('health-regen', hero.id)).toBe(0);
    expect(session.cancelEvent('mana-regen', hero.id)).toBe(0);
    run(session, 30_000, 100);
    expect(hero.health).toBe(100);
  });

  // Os números do Knight no Canary `vocations.xml` (#678): `gainhpticks=6000 gainhpamount=1`,
  // `gainmanaticks=6000 gainmanaamount=2`. A mesma média da taxa antiga (1/6 e 1/3 por segundo),
  // mas em PULSOS: até #678 a mana entrava 1 ponto a cada 3 s, e não 2 a cada 6 s.
  const knightRegen = {
    id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25,
    regen: { health: { ticksMs: 6000, amount: 1 }, mana: { ticksMs: 6000, amount: 2 } },
  };
  const withKnightRegen = content({
    routes: [{ ...route, spawnPoints: [] }], vocations: [knightRegen],
  });
  const lifeRing: InventoryState = {
    backpack: [],
    equipped: { finger: { instanceId: 'ring', itemId: 'life-ring', quantity: 1 } },
  };
  /** Um Knight parado, com vida E mana longe do máximo, entrando na hunt no instante 0. */
  const knightIn = (inventory?: InventoryState): Started => {
    const session = createHuntSession({
      id: 'session-1', content: withKnightRegen, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0,
    });
    const hero = character({ health: 100, ...(inventory === undefined ? {} : { inventory }) });
    // Antes do `enter`: é na entrada que a vocação escolhe o ritmo dos pulsos.
    hero.vocationId = 'knight';
    hero.maxMana = 1_000;
    hero.mana = 0;
    session.enter(hero);
    return { session, hero, ruleset: session.ruleset as HuntRuleset };
  };

  it('Knight regenera em pulsos: +1 vida e +2 mana a cada 6 s, o primeiro só aos 6 000 ms', () => {
    const { session, hero } = knightIn();
    session.advanceBy(5_999);
    expect(hero.health).toBe(100);
    expect(hero.mana).toBe(0);
    session.advanceBy(1);
    expect(hero.health).toBe(101);
    expect(hero.mana).toBe(2);
    // Mutação que mata: mana de 1 ponto a cada 3 s — aos 9 s seria 3, e não 2.
    session.advanceBy(3_000);
    expect(hero.mana).toBe(2);
  });

  it('Knight parado 60 s: +10 vida (10 pulsos × 1) e +20 mana (10 pulsos × 2)', () => {
    const { session, hero } = knightIn();
    run(session, 60_000, 100);
    expect(hero.health).toBe(110);
    expect(hero.mana).toBe(20);
  });

  // O bloco `promotion` do Elite Knight (#566, ADR 0042 decisão 1): `vocations.xml` id 8 do
  // Canary — `gainhpticks=4000` (mais rápido que a base 6000), `gainmanaticks=6000` (igual).
  const promotedKnightRegen = {
    ...knightRegen,
    promotion: {
      name: 'Elite Knight',
      regen: { health: { ticksMs: 4000, amount: 1 }, mana: { ticksMs: 6000, amount: 2 } },
      minLevel: 20, price: 20_000,
    },
  };
  const withPromotedKnightRegen = content({
    routes: [{ ...route, spawnPoints: [] }], vocations: [promotedKnightRegen],
  });

  it('Elite Knight promovido regenera 1 vida a cada 4 000 ms, a taxa do id 8 do Canary', () => {
    const session = createHuntSession({
      id: 'session-1', content: withPromotedKnightRegen, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0,
    });
    const hero = character({ health: 100 });
    hero.vocationId = 'knight';
    hero.promoted = true;
    session.enter(hero);

    session.advanceBy(3_999);
    expect(hero.health).toBe(100);
    session.advanceBy(1);
    expect(hero.health).toBe(101);
  });

  it('sem `promoted`, a MESMA vocação com bloco `promotion` regenera pela taxa BASE', () => {
    const session = createHuntSession({
      id: 'session-1', content: withPromotedKnightRegen, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0,
    });
    const hero = character({ health: 100 });
    hero.vocationId = 'knight';
    session.enter(hero);

    // 4 000 ms bateria se a taxa promovida vazasse para quem não é promovido.
    session.advanceBy(4_000);
    expect(hero.health).toBe(100);
    session.advanceBy(2_000);
    expect(hero.health).toBe(101);
  });

  it('Knight com Life Ring: o anel SOMA +2 vida e +8 mana a cada 6 s à vocação (#688)', () => {
    const { session, hero } = knightIn(lifeRing);
    session.advanceBy(5_999);
    expect(hero.health).toBe(100);
    expect(hero.mana).toBe(0);
    session.advanceBy(1);
    // Vocação (+1/+2) e anel (+2/+8) no mesmo instante — nenhum multiplica o outro.
    expect(hero.health).toBe(103);
    expect(hero.mana).toBe(10);
    session.advanceBy(6_000);
    expect(hero.health).toBe(106);
    expect(hero.mana).toBe(20);
    run(session, 48_000, 100);
    expect(hero.health).toBe(130);
    expect(hero.mana).toBe(100);
  });

  it('tirar o Life Ring encerra a regeneração dele: tirado aos 7 000 ms, nada do anel aos 12 000', () => {
    const { session, hero } = knightIn(lifeRing);
    session.advanceBy(6_000);
    expect(hero.health).toBe(103);
    session.advanceBy(1_000);
    expect(hero.inventory.unequip('finger', { backpackSlots: 20, satchelSlots: 0, row: 1 }).ok)
      .toBe(true);
    // Nenhum evento órfão do slot sobra na fila.
    expect(session.cancelEvent('item-regen', `${hero.id}:finger:health`)).toBe(0);
    expect(session.cancelEvent('item-regen', `${hero.id}:finger:mana`)).toBe(0);
    session.advanceBy(5_000);
    // Só a vocação aos 12 s: +1 vida e +2 mana.
    expect(hero.health).toBe(104);
    expect(hero.mana).toBe(12);
  });

  it('vestir o Life Ring no meio da hunt: o primeiro ganho sai 6 s depois de vestir', () => {
    const inventory: InventoryState = {
      backpack: [{ instanceId: 'ring', itemId: 'life-ring', quantity: 1 }], equipped: {},
    };
    const { session, hero } = knightIn(inventory);
    session.advanceBy(1_000);
    expect(hero.inventory.equip('ring', hero, withKnightRegen.items).ok).toBe(true);
    session.advanceBy(5_000);
    // Aos 6 s só a vocação; o anel vence aos 7 s.
    expect(hero.health).toBe(101);
    session.advanceBy(999);
    expect(hero.health).toBe(101);
    session.advanceBy(1);
    expect(hero.health).toBe(103);
    expect(hero.mana).toBe(10);
  });

  it('Knight, com e sem Life Ring, rende exatamente o mesmo a 1 Hz e a 10 Hz', () => {
    const at = (hz: number, inventory?: InventoryState): readonly [number, number] => {
      const { session, hero } = knightIn(inventory);
      run(session, 600_000, 1000 / hz);
      return [hero.health, hero.mana];
    };
    expect(at(1)).toEqual(at(10));
    expect(at(1, lifeRing)).toEqual(at(10, lifeRing));
    expect(at(10)).toEqual([200, 200]);
    // 100 ganhos do anel em 600 s: +200 vida e +800 mana por cima da vocação.
    expect(at(10, lifeRing)).toEqual([400, 1_000]);
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

  it('quem tem bênção paga menos por morrer (#570 — substitui o antigo binário Premium)', () => {
    const cobrança = (blessings: number): number => {
      const session = createHuntSession({
        id: 's', content: content({ routes: [threeRatsRoute] }), huntId: 'arena', difficulty: 'bold',
        createdAtMs: 0,
      });
      const hero = character({ health: 12 });
      hero.level = 20;
      hero.xp = totalXpForLevel(20, progression as Progression);
      hero.blessings = blessings;
      session.enter(hero);
      run(session, 60_000, 100);
      return Number(session.notableEvents.find((e) => e.type === 'xp-penalty')?.detail);
    };
    // 0b1111111 = 127: as sete bênçãos, todos os bits ligados.
    expect(cobrança(127)).toBeLessThan(cobrança(0));
  });

  it('promovido (#566, ADR 0042 decisão 1) paga menos por morrer, através do CharacterRuntime real', () => {
    // Diferente de `progression.test.ts` (que testa `applyDeathPenalty` isolado com
    // `{ promoted: true }` passado à mão): este teste prova que `#onCharacterDied` REPASSA
    // `character.promoted` de verdade — o defeito que a #566 corrige é o comentário morto que
    // dizia "o parâmetro é o ponto de extensão, o estado ainda não existe".
    const cobrança = (promoted: boolean): number => {
      const session = createHuntSession({
        id: 's', content: content({ routes: [threeRatsRoute] }), huntId: 'arena', difficulty: 'bold',
        createdAtMs: 0,
      });
      const hero = character({ health: 12 });
      hero.level = 20;
      hero.xp = totalXpForLevel(20, progression as Progression);
      hero.promoted = promoted;
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

  it('ganha alma passivamente ao ganhar XP ≥ level, capada no soulMax da vocação (#593)', () => {
    // `soulGainTicksMs`/`soulMax` pequenos de propósito: o teste mede o MECANISMO (condição
    // aplicada pelo ganho de XP, tique periódico, teto), não o número real do Canary — esse já
    // está fixado em `content.test.ts` e nas quatro vocações reais.
    const knight = {
      id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25,
      soulMax: 3, soulGainTicksMs: 500,
    };
    // XP alta o bastante para bater o portão `experience >= levelBeforeGain` no level 8.
    const fatRat = { ...rat, experience: 100, health: 1 };
    const withKnight = content({ vocations: [knight], monsters: [fatRat] });
    const { session, hero } = start({ loaded: withKnight, difficulty: 'bold' });
    hero.level = 8;
    const chosen = hero.chooseVocation(
      withKnight.vocations.get('knight') as NonNullable<ReturnType<typeof withKnight.vocations.get>>,
      null, {
        catalog: withKnight.items, vocationLevel: 8, instanceId: 's:hero:vocation',
        rules: { backpackSlots: 0, satchelSlots: 0, row: 1 },
      },
    );
    expect(chosen.ok).toBe(true);
    // A escolha enche a alma na hora, no soulMax da vocação — antes de qualquer abate.
    expect(hero.soul).toBe(3);

    // Simula gasto: sem magia real de custo ainda (a conjuração é a #594), a alma só desce por
    // ação manual neste teste — é o que deixa espaço para o ganho aparecer.
    hero.soul = 0;
    // Um abate (100 XP ≥ level 8) aplica a condição de ganho; ticando a cada 500 ms, o teto de
    // 3 é alcançado bem dentro dos quatro minutos fixos da condição.
    run(session, 30_000, 100);
    expect(hero.soul).toBeGreaterThan(0);
    expect(hero.soul).toBeLessThanOrEqual(3);
    run(session, 30_000, 100);
    expect(hero.soul).toBe(3);
  });

  it('sem vocação escolhida, XP não gera alma nenhuma (#593)', () => {
    // O personagem nasce sem vocação (§7.4) e o Canary sempre tem uma — o portão simplesmente
    // não abre até o level 8 acontecer de verdade.
    const fatRat = { ...rat, experience: 100, health: 1 };
    const withoutVocation = content({ monsters: [fatRat] });
    const { session, hero } = start({ loaded: withoutVocation, difficulty: 'bold' });
    run(session, 30_000, 100);
    expect(hero.soul).toBe(0);
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

describe('perda de item na morte (#571, ADR 0042 decisão 4)', () => {
  // O Canary larga o item perdido no cadáver do jogador; o Draconya não tem item no chão, então
  // "perder" é DESTRUIR — a instância vai para `removedInstances` (o `jobs` a apaga na MESMA
  // transação do ledger) e cada perda vira um evento notável do extrato.
  const lossItems = [
    { id: 'backpack', name: 'Backpack', kind: 'container', slot: 'back', initialSlots: 20, weight: 18, value: 5 },
    { id: 'bag', name: 'Bag', kind: 'container', slot: 'back', initialSlots: 8, weight: 8, value: 1 },
    {
      id: 'amulet-of-loss', name: 'Amulet of Loss', kind: 'amulet', slot: 'neck',
      weight: 4.2, value: 0, charges: 1, protectsOnDeath: true,
    },
    { id: 'gem', name: 'Gem', kind: 'other', weight: 1, value: 10, stackable: true },
  ];
  const itemLoss = {
    enabled: true, lossPercentByBlessings: [100, 70, 45, 25, 10, 0, 0, 0],
    nonContainerDivisor: 10, replacementContainerId: 'bag',
  };
  // O preço das bênçãos do Canary: só o `freeBelowLevel` (o Adventurer's Blessing) importa aqui.
  const blessingPricing = {
    freeBelowLevel: 21, flatUntilLevel: 30, flatPrice: 2000, highFromLevel: 120, midOffset: 20,
    midMultiplier: 200, midEnhancedMultiplier: 260, highBase: 20_000, highEnhancedBase: 26_000,
    highMultiplier: 75, highEnhancedMultiplier: 100,
  };
  const lossContent = (
    over: {
      enabled?: boolean; nonContainerDivisor?: number; routes?: NonNullable<RawContent['routes']>;
      adventurer?: boolean;
    } = {},
  ): Content => content({
    items: [...items, ...lossItems] as unknown as NonNullable<RawContent['items']>,
    ...(over.routes === undefined ? {} : { routes: over.routes }),
    progression: [{
      ...progression,
      ...(over.adventurer === true ? { blessingPricing } : {}),
      deathPenalty: {
        ...progression.deathPenalty,
        itemLoss: { ...itemLoss, enabled: over.enabled ?? true, nonContainerDivisor: over.nonContainerDivisor ?? 10 },
      },
    }] as unknown as NonNullable<RawContent['progression']>,
  });

  const dressed = (extra: InventoryState['equipped'] = {}): InventoryState => ({
    backpack: [
      { instanceId: 'i:gems', itemId: 'gem', quantity: 12 }, null,
      { instanceId: 'i:spare', itemId: 'sword', quantity: 1 },
    ],
    equipped: {
      back: { instanceId: 'i:backpack', itemId: 'backpack', quantity: 1 },
      chest: { instanceId: 'i:plate', itemId: 'plate', quantity: 1 },
      hand: { instanceId: 'i:sword', itemId: 'sword', quantity: 1 },
      head: { instanceId: 'i:hat', itemId: 'sharp-hat', quantity: 1 },
      ...extra,
    },
  });

  /**
   * O herói morre AGORA, direto no pipeline — a perda de item não depende de como ele morreu.
   * Com vocação: sem ela o Canary e o TFS não perdem item nenhum (`droploot.lua`,
   * `drop_loot.lua`), e o fixture nasce sem uma (§7.4).
   */
  const dies = (
    loaded: Content, inventory: InventoryState, blessings = 0, vocationId: string | null = 'knight',
    level = 1,
  ): { session: Session; hero: CharacterRuntime } => {
    const { session, hero } = start({ loaded, inventory });
    hero.blessings = blessings;
    hero.vocationId = vocationId;
    hero.level = level;
    session.kill(hero);
    expect(session.ended).toBe('death');
    return { session, hero };
  };

  const eventsOf = (session: Session, type: string): string[] =>
    session.notableEvents.filter((e) => e.type === type).map((e) => e.detail ?? '');

  it('DESLIGADO (`enabled: false`, o conteúdo real hoje): a morte não toca em item nenhum', () => {
    // O "nunca perde item" provisório do dono (`docs/product/death.md` §3.8). Vale também sem o
    // bloco no conteúdo — é o que o resto da suíte usa.
    for (const loaded of [lossContent({ enabled: false }), content({
      items: [...items, ...lossItems] as unknown as NonNullable<RawContent['items']>,
    })]) {
      const inventory = dressed();
      const { session, hero } = dies(loaded, inventory);
      expect(session.receipts()[0]?.removedInstances).toEqual([]);
      expect(hero.inventory.getState().equipped).toEqual(inventory.equipped);
      expect(session.notableEvents.filter((e) => e.type.startsWith('item-loss') || e.type === 'item-lost-on-death'))
        .toEqual([]);
    }
  });

  it('sem bênção a mochila se perde (100%) COM o que carrega, e uma bag nova a substitui', () => {
    const { session, hero } = dies(lossContent(), dressed());

    const removed = session.receipts()[0]?.removedInstances ?? [];
    // A mochila cai sempre (sorteio ≤ 10 000 contra chance cheia) e leva os dois de dentro.
    expect(removed).toContain('i:backpack');
    expect(removed).toContain('i:gems');
    expect(removed).toContain('i:spare');
    // O extrato registra UMA linha por instância, na mesma ordem em que saíram do inventário —
    // `itemId/quantidade/instanceId/dono`.
    const names: Record<string, string> = {
      'i:backpack': 'backpack/1', 'i:gems': 'gem/12', 'i:spare': 'sword/1', 'i:plate': 'plate/1',
      'i:sword': 'sword/1', 'i:hat': 'sharp-hat/1',
    };
    expect(eventsOf(session, 'item-lost-on-death'))
      .toEqual(removed.map((instanceId) => `${names[instanceId] as string}/${instanceId}/hero`));
    // Quem ficou sem mochila recebe uma bag: vestida, com os lugares dela, e id `sessão:n`.
    const back = hero.inventory.equippedAt('back');
    expect(back).toMatchObject({ itemId: 'bag', quantity: 1, origin: 'death-replacement' });
    expect(back?.instanceId).toBe('session-1:0');
    expect(hero.inventory.backpack).toEqual(new Array(8).fill(null));
    expect(eventsOf(session, 'backpack-replaced')).toEqual(['bag']);
  });

  it('a perda é CONSERVADORA: o que sai + o que fica = o que estava (nada some sem registro)', () => {
    const before = dressed();
    const ids = [
      ...before.backpack.filter((c) => c !== null).map((c) => c.instanceId),
      ...Object.values(before.equipped).map((c) => c.instanceId),
    ].sort();
    const { session, hero } = dies(lossContent(), before);

    const removed = session.receipts()[0]?.removedInstances ?? [];
    const state = hero.inventory.getState();
    const kept = [
      ...state.backpack.filter((c) => c !== null).map((c) => c.instanceId),
      ...Object.values(state.equipped).map((c) => c.instanceId).filter((id) => id !== 'session-1:0'),
    ];
    expect([...removed, ...kept].sort()).toEqual(ids);
    // E o extrato do Postgres é idempotente por `(session_id, seq)`: o `seq` do extrato é o
    // mesmo com ou sem perda de item — é a chave que o `jobs` deduplica, não uma nova.
    expect(session.receipts()[0]?.seq).toBe(1);
  });

  it('com `nonContainerDivisor: 1` TUDO cai com o sorteio mínimo — o mecanismo por slot, sem sorte', () => {
    const { session, hero } = dies(lossContent({ nonContainerDivisor: 1 }), dressed());
    expect(hero.inventory.getState().equipped).toEqual({
      back: { instanceId: 'session-1:0', itemId: 'bag', quantity: 1, origin: 'death-replacement' },
    });
    expect(session.receipts()[0]?.removedInstances).toEqual([
      'i:hat', 'i:backpack', 'i:gems', 'i:spare', 'i:plate', 'i:sword',
    ]);
  });

  it('com cinco bênçãos nada se perde, mas a morte consome as bênçãos do mesmo jeito', () => {
    // 0b11111: cinco bênçãos — a tabela dá 0% e nenhum sorteio roda.
    const inventory = dressed();
    const { session, hero } = dies(lossContent({ nonContainerDivisor: 1 }), inventory, 0b11111);

    expect(session.receipts()[0]?.removedInstances).toEqual([]);
    expect(hero.inventory.getState().equipped).toEqual(inventory.equipped);
    expect(eventsOf(session, 'item-loss-protected')).toEqual(['blessings']);
    // A contagem que decidiu a chance é a de ANTES da morte consumir: `hero.blessings` já é 0.
    expect(hero.blessings).toBe(0);
    expect(eventsOf(session, 'blessings-consumed')).toEqual(['5']);
  });

  it('o Amulet of Loss protege tudo e é CONSUMIDO — o único item que sai do inventário', () => {
    const inventory = dressed({ neck: { instanceId: 'i:aol', itemId: 'amulet-of-loss', quantity: 1 } });
    const { session, hero } = dies(lossContent({ nonContainerDivisor: 1 }), inventory);

    expect(session.receipts()[0]?.removedInstances).toEqual(['i:aol']);
    expect(hero.inventory.equippedAt('neck')).toBeNull();
    expect(hero.inventory.equippedAt('back')?.instanceId).toBe('i:backpack');
    expect(hero.inventory.equippedAt('chest')?.instanceId).toBe('i:plate');
    expect(eventsOf(session, 'item-loss-protected')).toEqual(['amulet-of-loss']);
    expect(eventsOf(session, 'loss-amulet-consumed')).toEqual(['amulet-of-loss']);
    expect(eventsOf(session, 'item-lost-on-death')).toEqual([]);
  });

  it('o colar é consumido mesmo com cinco bênçãos, que já protegiam sozinhas (Player::death)', () => {
    const inventory = dressed({ neck: { instanceId: 'i:aol', itemId: 'amulet-of-loss', quantity: 1 } });
    const { session, hero } = dies(lossContent(), inventory, 0b11111);
    expect(session.receipts()[0]?.removedInstances).toEqual(['i:aol']);
    expect(hero.inventory.equippedAt('neck')).toBeNull();
  });

  it('em party só quem morre perde: o sobrevivente fica intacto e o id da bag leva o dono no meio', () => {
    const member = (id: string, inventory: InventoryState): CharacterRuntime => {
      const stats = statsForLevel(1, null, progression as Progression);
      return new CharacterRuntime({
        id, position: { x: 0, y: 0, z: 7 },
        health: stats.maxHealth, maxHealth: stats.maxHealth,
        mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: 'knight',
        staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
        gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000, inventory,
      });
    };
    const session = createHuntSession({
      id: 'party-session', content: lossContent({ nonContainerDivisor: 1, routes: [threeRatsRoute] }),
      huntId: 'arena', difficulty: 'bold', createdAtMs: 0, partyOptions: { leaderId: 'a', mode: 'split' },
    });
    const a = member('a', dressed());
    const b = member('b', dressed());
    session.enter(a);
    session.enter(b);
    session.drainEvents();

    session.kill(b);

    // `a` continua caçando, com tudo o que tinha.
    expect(session.ended).toBeNull();
    expect(a.inventory.getState().equipped).toEqual(dressed().equipped);
    expect(a.removedInstances).toEqual([]);
    // `b` saiu com o próprio extrato: as instâncias dele, e a bag com o id do dono no meio.
    const departure = session.drainEvents().find((e) => e.kind === 'member-left');
    expect(departure).toBeDefined();
    if (departure?.kind !== 'member-left') throw new Error('sem member-left');
    expect(departure.departure.receipt.removedInstances).toContain('i:backpack');
    expect(b.inventory.equippedAt('back')?.instanceId).toBe('party-session:b:0');
    // O detalhe leva o dono: as linhas dos membros compartilham a lista de eventos da sessão.
    expect(eventsOf(session, 'item-lost-on-death').every((detail) => detail.endsWith('/b'))).toBe(true);
  });

  it('sem vocação a morte não perde item nem entrega bag (Canary/TFS devolvem antes da perda)', () => {
    const inventory = dressed();
    const { session, hero } = dies(lossContent({ nonContainerDivisor: 1 }), inventory, 0, null);

    expect(session.receipts()[0]?.removedInstances).toEqual([]);
    expect(hero.inventory.getState().equipped).toEqual(inventory.equipped);
    expect(session.notableEvents.filter((e) => e.type.startsWith('item-loss') || e.type === 'item-lost-on-death'
      || e.type === 'backpack-replaced')).toEqual([]);
  });

  it('abaixo do level 21 com vocação, sem bênção nenhuma, a morte não perde item (Adventurer\'s Blessing)', () => {
    const inventory = dressed();
    const { session, hero } = dies(
      lossContent({ nonContainerDivisor: 1, adventurer: true }), inventory, 0, 'knight', 20,
    );

    expect(session.receipts()[0]?.removedInstances).toEqual([]);
    expect(hero.inventory.getState().equipped).toEqual(inventory.equipped);
    expect(eventsOf(session, 'item-loss-protected')).toEqual(['blessings']);
    expect(eventsOf(session, 'item-lost-on-death')).toEqual([]);
  });

  it('no level 21 o Adventurer acaba: a mesma morte volta a tirar a mochila', () => {
    const { session } = dies(
      lossContent({ nonContainerDivisor: 1, adventurer: true }), dressed(), 0, 'knight', 21,
    );

    expect(session.receipts()[0]?.removedInstances).toContain('i:backpack');
    expect(eventsOf(session, 'item-loss-protected')).toEqual([]);
  });

  // Sem arma nem armadura: com a espada de 200 de ataque o herói mata os ratos de um golpe e
  // nunca morre, e o teste não chegaria à perda. Mochila e anel bastam para haver o que perder.
  const barehanded = (): InventoryState => ({
    backpack: [{ instanceId: 'i:gems', itemId: 'gem', quantity: 12 }],
    equipped: {
      back: { instanceId: 'i:backpack', itemId: 'backpack', quantity: 1 },
      finger: { instanceId: 'i:ring', itemId: 'other-ring', quantity: 1 },
    },
  });

  it('1 Hz == 10 Hz: morrendo em combate, a perda é a MESMA (invariante 3, sem ninguém assistindo)', () => {
    // O herói morre de verdade, pelos golpes dos ratos, e o sorteio sai do `Rng` da sessão. Se a
    // perda dependesse da cadência (ou de haver quem assistisse), as duas taxas divergiriam.
    const scenario = (hz: number) => {
      const { session, hero } = start({
        loaded: lossContent({ routes: [threeRatsRoute] }), health: 40, inventory: barehanded(),
      });
      hero.vocationId = 'knight';
      run(session, 120_000, 1000 / hz);
      expect(session.ended).toBe('death');
      return {
        removed: session.receipts()[0]?.removedInstances,
        events: session.notableEvents
          .filter((e) => e.type.startsWith('item-loss') || e.type === 'item-lost-on-death'
            || e.type === 'backpack-replaced')
          .map((e) => `${e.type}:${e.detail ?? ''}`),
        kept: hero.inventory.getState().equipped,
        diedAtMs: session.notableEvents.find((e) => e.type === 'death')?.atMs,
      };
    };
    const rapido = scenario(10);
    expect(rapido.removed?.length).toBeGreaterThan(0);
    expect(scenario(1)).toEqual(rapido);
  });

  it('retomar de um snapshot antes da morte dá a MESMA perda (o `Rng` atravessa o snapshot)', () => {
    const loaded = lossContent({ routes: [threeRatsRoute] });
    // 40 de vida: com o herói de mãos vazias a morte vem aos ~4 s, então o snapshot dos 2 s sai
    // com ele ainda vivo e a perda acontece DEPOIS da retomada.
    const { session, hero } = start({ loaded, health: 40, inventory: barehanded() });
    hero.vocationId = 'knight';
    run(session, 2_000, 100);
    expect(session.ended).toBeNull();

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      new Rng(snapshot.rng),
    );
    run(session, 120_000, 100);
    run(retomado, 120_000, 100);

    expect(session.ended).toBe('death');
    expect(retomado.ended).toBe('death');
    expect(retomado.receipts()[0]?.removedInstances).toEqual(session.receipts()[0]?.removedInstances);
    expect(retomado.notableEvents.filter((e) => e.type === 'item-lost-on-death'))
      .toEqual(session.notableEvents.filter((e) => e.type === 'item-lost-on-death'));
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
    //
    // DOIS pontos de spawn — os dois nascem juntos na população INICIAL (#583), sem esperar
    // nenhum respawn — e respawn ENORME de propósito (#625): a trava de combate (60 s desde o
    // último ataque, dado OU recebido) só libera fora de combate, e um respawn mais cedo
    // reengajaria o herói antes dos 60 s vencerem — a saída nunca completaria, e o teste
    // deixaria de ser determinístico. Sem um terceiro rato, o herói fica parado depois do
    // segundo abate — exatamente o cenário que a trava existe para permitir.
    const rule: HuntExitRule = { id: 'two-kills', when: (view) => view.aggregates.kills >= 2 };
    const loaded = content({
      routes: [{
        ...route,
        spawnPoints: [
          { ...route.spawnPoints[0]!, respawnDelayMs: 1_000_000 },
          { ...route.spawnPoints[0]!, respawnDelayMs: 1_000_000 },
        ],
      }],
    });
    const { session } = start({ exitRules: [rule], loaded });

    run(session, 130_000, 100);

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
    // §14.7: não existe alteração dinâmica — o mecanismo continua existindo por compatibilidade
    // de protocolo (#584), mas desde o #583 `difficulty` é só um rótulo ignorado pelo `sim`: a
    // densidade da hunt nova é a MESMA de sempre (os pontos de spawn da rota), não uma
    // dificuldade "bold" que não existe mais no conteúdo.
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

    // Instância NOVA: id novo, agregados zerados, mesma densidade de sempre (1 ponto de spawn).
    expect(nova.id).toBe('session-2');
    expect(nova.aggregates.kills).toBe(0);
    expect(nova.participants[0]).toBe(hero);
    nova.advanceBy(100);
    expect((nova.ruleset as HuntRuleset).monsters).toHaveLength(1);
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

    // Prazo cumprido, mas o rato não é `blockable` (#583): ainda no telegraph de 4200 ms.
    retomado.advanceBy(2_000);
    expect(depois.monsters).toHaveLength(0);

    // Telegraph cumprido — é esta linha que falhava com `0 monstros vivos` depois de dez
    // vezes o `respawnDelayMs`, antes da FUN-70.
    retomado.advanceBy(4_300);
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
    // personagem que se cura enquanto apanha mede as duas coisas somadas. Pelo mesmo motivo,
    // sem level up: desde #678 subir de level ENCHE a vida, e um level no último abate zeraria
    // o dano medido — daí a curva de XP que não fecha nenhum level em dez minutos.
    const semRegen = content({
      progression: [{
        ...progression,
        regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
        xp: { kind: 'power', base: 1_000_000, exponent: 2 },
      }],
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
    // Sem dificuldade nenhuma desde o #583 (ADR 0039, fim do pull) — `difficulties` sobrevive
    // só por compatibilidade de protocolo (#584), sempre com o nome único `DEFAULT_DIFFICULTY_NAME`.
    const [listing] = huntListings(content());
    expect(listing).toEqual({
      id: 'arena', name: 'Arena', recommendedLevel: 1,
      difficulties: [DEFAULT_DIFFICULTY_NAME],
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

    // A parede logo ao norte: a arena tem y=0 bloqueado inteiro — sempre RECUSA, adjacente ou
    // não. Não-adjacente vira `unreachable` (#763: o BFS nem alcança um tile de parede), nunca
    // mais `not-adjacent` — essa razão SUMIU de `requestMove`, que agora tenta o caminho antes
    // de recusar (ver o describe "walk-to distante", abaixo).
    expect(ruleset.requestMove(session, hero.id, { x, y: 0 }))
      .toEqual({ ok: false, reason: y === 1 ? 'tile-blocked' : 'unreachable' });
    // Fora do mapa: nenhum caminho alcança, e o BFS nunca tenta um passo de verdade — as
    // quatro chamadas deste teste continuam livres de efeito colateral, como antes da #763.
    expect(ruleset.requestMove(session, hero.id, { x: x + 100, y }))
      .toEqual({ ok: false, reason: 'unreachable' });
    expect(ruleset.requestMove(session, hero.id, { x, y }))
      .toEqual({ ok: false, reason: 'same-tile' });
    expect(ruleset.requestMove(session, hero.id, { x: -1, y: -1 }))
      .toEqual({ ok: false, reason: 'unreachable' });
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

  it('requestMove recusa unreachable para um destino fora do raio do BFS — nunca trava esperando', () => {
    // O corredor padrão da arena não chega nem perto do raio; o ponto aqui é só a recusa
    // TIPADA (RF-03 da spec da #763) — nunca um `walk-to` sem resposta.
    const { session, ruleset, hero } = start();
    const longe = { x: hero.position.x + 1000, y: hero.position.y };
    expect(ruleset.requestMove(session, hero.id, longe)).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('walk-to distante na hunt: caminho no servidor e pausa do bot (#763)', () => {
  // A arena padrão (4×3 de interior) não cabe um cadáver a seis tiles — um corredor comprido,
  // de um tile de largura, dá ao BFS um único caminho possível e deixa o teste livre de
  // ambiguidade sobre QUAL rota o servidor escolheu.
  const corridorMap = {
    id: 'corridor', z: 7,
    grid: ['############', '#..........#', '############'],
  };
  const corridorRoute = {
    id: 'corridor-loop', mapId: 'corridor',
    tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
    // `respawnDelayMs` bem alto: só um rato morre dentro da janela do teste, então só um
    // cadáver existe — nada a desambiguar ao procurar "o" cadáver com sobra. Ponto declara o
    // próprio monstro/prazo desde o #583 — não há mais `hunt.difficulties` como fallback.
    spawnPoints: [{ routeIndex: 0, radius: 1, monsterId: 'rat', respawnDelayMs: 1_000_000 }],
  };
  const corridorHunt = {
    ...hunt, id: 'corridor', mapId: 'corridor', routeId: 'corridor-loop',
  };

  const startFar = () => {
    const loaded = buildContent(raw({
      // TTL bem folgado: o teste ainda vai andar seis tiles depois de o cadáver aparecer, e
      // não pode correr risco de apodrecer no meio do caminho.
      monsters: [{ ...ratWithDrop, corpseTtlMs: 300_000 }],
      maps: [corridorMap], routes: [corridorRoute], hunts: [corridorHunt],
      // Capacidade baixa (como `comDrop`): a espada (peso 50) nunca cabe na mochila — fica no
      // cadáver, e é o ouro (sempre coletado, sem peso) que prova que `takeLoot` de fato agiu.
      progression: [{ ...progression, startingCapacity: 10, capacityPerLevel: 0 }],
    }));
    const session = createHuntSession({
      content: loaded, id: 'walk-to-far', huntId: 'corridor', difficulty: 'cautious', createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 1, y: 1, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
      capacity: stats.capacity,
    });
    session.enter(hero);
    return { session, hero, ruleset: session.ruleset as HuntRuleset };
  };

  it('cadáver a seis tiles: walk-to chega, abre o cadáver e pega o loot', () => {
    const { session, hero, ruleset } = startFar();
    // Deixa o rato nascer perto do início e o herói matá-lo desarmado — o mesmo caminho de
    // `comDrop`, só que num corredor comprido em vez da arena pequena.
    run(session, 60_000, 100);
    const corpse = ruleset.groundItems.find((c) => (c.items?.length ?? 0) > 0);
    expect(corpse).toBeDefined();
    if (corpse === undefined) return;
    // O herói patrulha só (1,1)/(2,1) — a briga pode tê-lo deixado em qualquer um dos dois.

    // Reposiciona o cadáver seis tiles adiante no MESMO corredor (mutação de teste, como o
    // `hero.position = ...` já usado em outros testes deste arquivo) — onde o rato de fato
    // morreu já tem teste próprio (#722); aqui o que importa é só a distância do `walk-to`.
    const destino = { x: corpse.position.x + 6, y: corpse.position.y, z: corpse.position.z };
    Object.assign(corpse, { position: destino });

    const walk = ruleset.requestMove(session, hero.id, destino);
    expect(walk.ok).toBe(true);

    // Seis passos retos (o corredor tem um tile de largura, sem diagonal possível) — tempo de
    // sobra sem exagerar a ponto de o rato seguinte nascer e atrapalhar.
    run(session, 8_000, 50);
    expect(hero.position).toEqual(destino);

    const opened = ruleset.openCorpse(session, hero.id, corpse.id);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.corpse.items?.length).toBeGreaterThan(0);

    // O ouro (sem peso) já foi coletado pelo Quick Loot automático no instante do abate (#721)
    // — o que sobra no cadáver, e o que `takeLoot` reaplica o filtro em cima, é só a espada
    // (peso 50 contra capacidade 10). `ok: true` é o critério de aceite da #763 (RF-04):
    // chegar, abrir e pegar — capacidade justa já tem teste próprio no describe do #722.
    const taken = ruleset.takeLoot(session, hero.id, corpse.id, null);
    expect(taken.ok).toBe(true);
  });

  it('destino atrás de parede (fora do corredor) recusa unreachable, e o bot não trava', () => {
    const { session, hero, ruleset } = startFar();
    // (5, 0) é a parede norte do corredor — nunca adjacente livre, nunca alcançável.
    const result = ruleset.requestMove(session, hero.id, { x: 5, y: 0 });
    expect(result).toEqual({ ok: false, reason: 'unreachable' });
    // O bot segue vivo: um passo comum ainda funciona depois da recusa.
    run(session, 1_000, 50);
    expect(session.ended).toBeNull();
  });

  // Achado de QA ao vivo (Darashia Dragon Lair, Sorcerer level 200): um `walk-to` para um
  // cadáver a onze tiles parava logo no início e só retomava minutos depois — o combate-stop de
  // sempre (`#playerStep`) segurava o personagem no primeiro dragão ao alcance, e como o dragão
  // nunca morre nem sai de alcance numa masmorra cheia, o caminho manual nunca tinha chance de
  // continuar. Um corredor de TRÊS tiles de largura (em vez do de um só, acima) deixa o monstro
  // parado AO LADO da rota — no alcance, mas nunca bloqueando o passo.
  const wideMap = {
    id: 'wide-corridor', z: 7,
    grid: [
      '############',
      '#..........#',
      '#..........#',
      '#..........#',
      '############',
    ],
  };
  const wideRoute = {
    id: 'wide-corridor-loop', mapId: 'wide-corridor',
    tiles: [{ x: 1, y: 2, z: 7 }, { x: 2, y: 2, z: 7 }],
    spawnPoints: [{ routeIndex: 0, radius: 1, monsterId: 'dragon', respawnDelayMs: 1_000_000 }],
  };
  const wideHunt = {
    ...hunt, id: 'wide-corridor', mapId: 'wide-corridor', routeId: 'wide-corridor-loop',
  };
  // Vida absurda, sem ataque: este monstro nunca morre e nunca machuca o herói — o teste é sobre
  // ANDAR, não sobre combate. `blockable: true` como o `rat` de sempre.
  const dragon = { ...rat, id: 'dragon', name: 'Dragon', health: 999_999_999, attack: 0 };

  const startWide = () => {
    const loaded = buildContent(raw({
      monsters: [rat, dragon], maps: [wideMap], routes: [wideRoute], hunts: [wideHunt],
    }));
    const session = createHuntSession({
      content: loaded, id: 'walk-to-dragon', huntId: 'wide-corridor', difficulty: 'cautious', createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 1, y: 2, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
      capacity: stats.capacity,
    });
    session.enter(hero);
    return { session, hero, ruleset: session.ruleset as HuntRuleset };
  };

  it('walk-to distante com monstro ao alcance no caminho inteiro: anda sem parar (STALL)', () => {
    const { session, hero, ruleset } = startWide();
    session.advanceBy(50);
    const dragonMonster = ruleset.monsters[0];
    expect(dragonMonster).toBeDefined();
    if (dragonMonster === undefined) return;
    // O dragão nasce adjacente ao início da rota (raio 1 do spawn) — o herói entra no alcance
    // da arma já no PRIMEIRO passo, exatamente o cenário que travava antes desta correção.
    expect(distance(hero.position, dragonMonster.position)).toBeLessThanOrEqual(1);

    const destino = { x: 9, y: 2, z: 7 };
    const walk = ruleset.requestMove(session, hero.id, destino);
    expect(walk.ok).toBe(true);

    // Corre a simulação em pequenos saltos, contando quantos deles produziram passo de verdade
    // — a prova de que o personagem andou repetidamente, nunca "uma vez e travado" como no QA.
    let steps = 0;
    for (let elapsed = 0; elapsed < 6_000 && hero.position.x < destino.x; elapsed += 100) {
      session.advanceBy(100);
      if (session.drainEvents().some((e) => e.kind === 'creature-moved' && e.creatureId === hero.id)) steps += 1;
    }
    expect(hero.position).toEqual(destino);
    expect(steps).toBeGreaterThanOrEqual(8);
  });

  it('openCorpse abre a janela de pausa mesmo sem walk-to antes (HOLD, achado de QA ao vivo)', () => {
    // O QA chegou ao cadáver, abriu a janela, e dois segundos depois o `take-loot` foi recusado
    // com "você está longe demais": o bot já tinha levado o personagem embora, porque nenhuma
    // pausa nunca tinha sido armada — só um `walk-to` a armava antes desta correção. Aqui o
    // herói já nasce ADJACENTE ao cadáver (sem NUNCA chamar `requestMove`), e o teste prova que
    // `openCorpse` sozinho já seguraria o bot.
    const { session, hero, ruleset } = startFar();
    run(session, 60_000, 100);
    const corpse = ruleset.groundItems.find((c) => (c.items?.length ?? 0) > 0);
    expect(corpse).toBeDefined();
    if (corpse === undefined) return;
    // Sem NUNCA ter chamado `requestMove`: `manualWalkTo` e a janela de pausa começam do zero.
    hero.position = { ...corpse.position };

    const opened = ruleset.openCorpse(session, hero.id, corpse.id);
    expect(opened.ok).toBe(true);

    // Três segundos de bot rodando — tempo de sobra para a rota tentar retomar, se a pausa não
    // tivesse sido armada.
    run(session, 3_000, 100);
    expect(hero.position).toEqual(corpse.position);

    const taken = ruleset.takeLoot(session, hero.id, corpse.id, null);
    expect(taken.ok).toBe(true);
  });
});

// --- empurrar criatura e esmagamento (M29-08, #544) ------------------------------------------
//
// Um monstro com `canPushCreatures` empurra um monstro `pushable` que bloqueia o próprio passo,
// em vez de tratá-lo como parede; sem cardinal livre, o empurrado é esmagado sem atacante. O
// herói mora numa BOLSA à parte, ligada por uma parede — longe o bastante do corredor (nunca
// adjacente) para nunca entrar em combate com o rato: ele existe só para dar ao Dragon um alvo
// na direção certa (leste), sem contaminar o teste com o ataque automático do jogador.
describe('empurrar criatura e esmagamento (M29-08, #544)', () => {
  const pusherDragon = {
    ...rat, id: 'push-dragon', name: 'Push Dragon', health: 999_999_999, attack: 0,
    aggroRadius: 10, canPushCreatures: true,
  };
  const pushableRat = { ...rat, id: 'pushable-rat', name: 'Pushable Rat' };
  const stuckRat = { ...rat, id: 'stuck-rat', name: 'Stuck Rat', pushable: false };

  // Empurrar/esmagar só roda sob `combat-v3` (ADR 0031/0040, DT-04 do #544): o empurrão consome
  // `session.rng` e move outra criatura, e as duas coisas mudariam o que uma hunt `combat-v1`/
  // `v2` congelada rende. Os testes de MECANISMO (RF-02 a RF-06) usam este perfil de propósito,
  // para exercitar o caminho de código real — não porque `combat-v1`/`v2` sejam o alvo da issue.
  const combatV3 = {
    ...combat, compatibilityProfile: 'combat-v3',
    weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
    distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
  };

  // Corredor SEM saída: x=1 (Dragon) e x=2 (rato) são as únicas colunas do corredor — a parede
  // em x=3 fecha o beco. Norte/sul (y=0/y=2) também são parede: os quatro cardinais do rato
  // (norte, sul, oeste-Dragon, leste-parede) ficam bloqueados. Além da parede, uma bolsa (x=4..8)
  // hospeda o herói, a pelo menos duas colunas de distância de qualquer monstro do corredor.
  const narrowMap = {
    id: 'push-narrow', z: 7,
    grid: ['##########', '#..#.....#', '##########'],
  };
  const narrowRoute = {
    id: 'push-narrow-loop', mapId: 'push-narrow',
    tiles: [{ x: 4, y: 1, z: 7 }, { x: 5, y: 1, z: 7 }],
    spawnPoints: [],
  };

  // A mesma ideia, mas com y=1/y=3 livres nas duas colunas do corredor: o rato do meio tem para
  // onde ser empurrado (norte ou sul) — a parede em x=3 continua fechando o corredor a leste.
  const wideCorridorMap = {
    id: 'push-wide-corridor', z: 7,
    grid: [
      '##########', '#..#.....#', '#..#.....#', '#..#.....#', '##########',
    ],
  };
  const wideCorridorRoute = {
    id: 'push-wide-corridor-loop', mapId: 'push-wide-corridor',
    tiles: [{ x: 4, y: 2, z: 7 }, { x: 5, y: 2, z: 7 }],
    spawnPoints: [],
  };

  /**
   * Sobe uma hunt com monstros em pontos de spawn fixos (#519) e o herói na própria bolsa.
   * `combatProfile` é `combatV3` por default — os testes de mecanismo precisam do perfil que
   * liga o empurrão; o teste do GATE (RF-07, abaixo) passa `combat` (v1, o default do conteúdo)
   * de propósito, para provar que o mecanismo sai inteiro sem efeito fora de `combat-v3`.
   */
  const startCorridor = (
    map: typeof narrowMap, route: typeof narrowRoute,
    monsters: readonly { readonly id: string }[],
    positions: readonly { readonly x: number; readonly y: number; readonly z: number }[],
    combatProfile: typeof combat = combatV3,
  ) => {
    const corridorHunt = {
      ...hunt, id: map.id, mapId: map.id, routeId: route.id,
      difficulties: {
        cautious: {
          monsterCount: monsters.length,
          composition: [{ monsterId: (monsters[0] as { readonly id: string }).id, weight: 1 }],
          respawnDelayMs: 1_000_000,
        },
      },
    };
    const routeWithSpawns = {
      ...route,
      spawnPoints: monsters.map((monster, i) => ({
        routeIndex: 0, radius: 1, monsterId: monster.id, at: positions[i], respawnDelayMs: 1_000_000,
      })),
    };
    const loaded = buildContent(raw({
      monsters: [...monsters], maps: [map], routes: [routeWithSpawns], hunts: [corridorHunt],
      combat: [combatProfile],
    }));
    const session = createHuntSession({
      content: loaded, id: `push-${map.id}`, huntId: map.id, difficulty: 'cautious', createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: route.tiles[0] as { readonly x: number; readonly y: number; readonly z: number },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
      capacity: stats.capacity,
    });
    session.enter(hero);
    return { session, hero, ruleset: session.ruleset as HuntRuleset };
  };

  it('RF-02: Dragon com canPushCreatures avança sobre um rato pushable — o rato vai para um cardinal livre', () => {
    // Dragon em (1,2), rato em (2,2) — corredor largo: (2,1) e (2,3) são os cardinais livres do
    // rato (a parede em x=3 fecha a terceira saída).
    const { session, ruleset } = startCorridor(
      wideCorridorMap, wideCorridorRoute, [pusherDragon, pushableRat],
      [{ x: 1, y: 2, z: 7 }, { x: 2, y: 2, z: 7 }],
    );
    run(session, 5_000, 100);

    const dragon = ruleset.monsters.find((m) => m.monsterId === 'push-dragon');
    const ratMonster = ruleset.monsters.find((m) => m.monsterId === 'pushable-rat');
    expect(dragon).toBeDefined();
    expect(ratMonster).toBeDefined();
    if (dragon === undefined || ratMonster === undefined) return;

    // O Dragon ocupou o tile que era do rato — a prova de que o passo aconteceu.
    expect(dragon.position).toEqual({ x: 2, y: 2, z: 7 });
    // O rato foi para um dos dois cardinais livres, nunca ficou no lugar nem sumiu.
    expect(ratMonster.alive).toBe(true);
    expect([
      { x: 2, y: 1, z: 7 }, { x: 2, y: 3, z: 7 },
    ]).toContainEqual(ratMonster.position);
  });

  it('RF-03: sem cardinal livre (corredor sem saída), o rato empurrado morre sem atacante — sem XP para ninguém', () => {
    // Dragon em (1,1), rato em (2,1): os quatro cardinais do rato são parede (norte, sul, leste)
    // ou o próprio Dragon (oeste) — nenhum livre.
    const { session, hero, ruleset } = startCorridor(
      narrowMap, narrowRoute, [pusherDragon, pushableRat],
      [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
    );
    run(session, 5_000, 100);

    const ratMonster = ruleset.monsters.find((m) => m.monsterId === 'pushable-rat');
    expect(ratMonster).toBeUndefined();
    // Sem atacante: ninguém ganhou XP pelo abate (o herói nunca chegou perto do rato).
    expect(hero.xp).toBe(0);
    expect(hero.health).toBe(hero.maxHealth);
  });

  it('RF-04: Dragon SEM canPushCreatures (o default) continua bloqueado por um monstro no caminho', () => {
    const plainDragon = {
      ...rat, id: 'plain-dragon', name: 'Plain Dragon', health: 999_999_999, attack: 0, aggroRadius: 10,
    };
    const { session, ruleset } = startCorridor(
      narrowMap, narrowRoute, [plainDragon, pushableRat],
      [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
    );
    run(session, 5_000, 100);

    const dragon = ruleset.monsters.find((m) => m.monsterId === 'plain-dragon');
    const ratMonster = ruleset.monsters.find((m) => m.monsterId === 'pushable-rat');
    expect(dragon?.position).toEqual({ x: 1, y: 1, z: 7 });
    expect(ratMonster?.position).toEqual({ x: 2, y: 1, z: 7 });
    expect(ratMonster?.alive).toBe(true);
  });

  it('RF-06: rato pushable: false nunca é empurrado nem esmagado, mesmo por quem canPushCreatures', () => {
    const { session, ruleset } = startCorridor(
      narrowMap, narrowRoute, [pusherDragon, stuckRat],
      [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
    );
    run(session, 5_000, 100);

    const dragon = ruleset.monsters.find((m) => m.monsterId === 'push-dragon');
    const ratMonster = ruleset.monsters.find((m) => m.monsterId === 'stuck-rat');
    expect(dragon?.position).toEqual({ x: 1, y: 1, z: 7 });
    expect(ratMonster?.position).toEqual({ x: 2, y: 1, z: 7 });
    expect(ratMonster?.alive).toBe(true);
  });

  // Mapa dedicado, sem bolsa nem rato: o herói nasce DIRETO adjacente ao Dragon (distância 1),
  // então o combate-stop de sempre (`#playerStep`) já o segura ali antes do primeiro passo, e
  // nunca chega a andar até o segundo tile da própria rota.
  const playerBlockMap = { id: 'push-player-block', z: 7, grid: ['#####', '#...#', '#####'] };
  const playerBlockRoute = {
    id: 'push-player-block-loop', mapId: 'push-player-block',
    tiles: [{ x: 2, y: 1, z: 7 }, { x: 3, y: 1, z: 7 }],
    spawnPoints: [],
  };

  it('RF-05: jogador nunca é empurrado — bloqueia um Dragon canPushCreatures como qualquer tile ocupado', () => {
    // `#monsterAt` só varre `this.#monsters`, então o herói nunca é candidato a ocupante
    // empurrável — o Dragon nunca sequer TENTA empurrá-lo, só bate (sem dano, attack: 0).
    const { session, hero, ruleset } = startCorridor(
      playerBlockMap, playerBlockRoute, [pusherDragon], [{ x: 1, y: 1, z: 7 }],
    );
    run(session, 5_000, 100);

    const dragon = ruleset.monsters.find((m) => m.monsterId === 'push-dragon');
    // O Dragon nunca ocupa o tile do herói, nem o herói o dele — cada um no seu, como qualquer
    // bloqueio comum.
    expect(hero.position).toEqual({ x: 2, y: 1, z: 7 });
    expect(hero.health).toBe(hero.maxHealth);
    expect(dragon?.position).toEqual({ x: 1, y: 1, z: 7 });
    expect(dragon?.alive).toBe(true);
  });

  it('RF-07 (ADR 0031/0040): sob combat-v1 o tile ocupado continua parede — nenhum sorteio novo, mesmo com canPushCreatures: true', () => {
    // O MESMO cenário do RF-03 (o rato seria esmagado sob combat-v3), rodado sob `combat-v1` —
    // o default do conteúdo de teste, e o perfil de toda hunt congelada antes desta issue — com
    // a flag `canPushCreatures` LIGADA e DESLIGADA no Dragon. Sem o gate `#isV3()`, a rodada
    // "ligada" mataria o rato e divergiria da "desligada"; com o gate, `#pushablePathThrough`/
    // `#clearPushableOccupant` saem no primeiro `if` sem SEQUER ler `canPushCreatures` — as duas
    // rodadas precisam ser bit a bit a MESMA sequência de sorteio (a mesma prova que #555 fez
    // para o hit chance de distância em `weapons.test.ts`), e o rato tem que sobreviver nas duas.
    const runUnderV1 = (canPushCreatures: boolean) => {
      const dragon = { ...pusherDragon, canPushCreatures };
      const spy = vi.spyOn(Rng.prototype, 'integer');
      try {
        const { session, hero, ruleset } = startCorridor(
          narrowMap, narrowRoute, [dragon, pushableRat],
          [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
          combat,
        );
        run(session, 5_000, 100);
        return {
          rngCalls: spy.mock.calls.map((call) => [...call]),
          dragonPosition: ruleset.monsters.find((m) => m.monsterId === dragon.id)?.position,
          ratAlive: ruleset.monsters.find((m) => m.monsterId === 'pushable-rat')?.alive,
          xp: hero.xp,
        };
      } finally {
        spy.mockRestore();
      }
    };

    const withFlag = runUnderV1(true);
    const withoutFlag = runUnderV1(false);

    // Sem o gate, o rato desta rodada estaria esmagado (RF-03) — aqui ele sobrevive, intocado,
    // exatamente como no cenário sem a flag.
    expect(withFlag.ratAlive).toBe(true);
    expect(withFlag.dragonPosition).toEqual({ x: 1, y: 1, z: 7 });
    expect(withFlag.dragonPosition).toEqual(withoutFlag.dragonPosition);
    expect(withFlag.xp).toBe(withoutFlag.xp);
    // A prova mais forte: a MESMA sequência de `session.rng.integer(...)`, chamada a chamada —
    // nenhum sorteio do empurrão entrou na sequência de uma hunt combat-v1.
    expect(withFlag.rngCalls).toEqual(withoutFlag.rngCalls);
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
        ...progression, startingMana: 200, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
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

// --- alvo de party e custo escalado (#588: Heal/Protect/Enchant/Train Party) ------------------

describe('alvo de party e custo por tamanho da party (#588)', () => {
  const healParty = {
    id: 'heal-party', name: 'Heal Party', manaCost: { kind: 'party-scaled' as const, base: 120, decay: 0.9 },
    cooldownMs: 1_000, group: 'support', groupCooldownMs: 1_000, minLevel: 1,
    effect: {
      kind: 'heal-over-time' as const, amount: 20, intervalMs: 2_000, durationMs: 120_000,
      target: 'party' as const, range: 3,
    },
  };
  const castHealParty = () => ({
    heal: [{
      when: { kind: 'hp' as const, op: '<=' as const, percent: 100 },
      do: { kind: 'spell' as const, spellId: 'heal-party' },
    }],
  });
  const make = (id: string): CharacterRuntime => new CharacterRuntime({
    id, position: { x: 0, y: 0, z: 7 },
    health: 100, maxHealth: 100, mana: 500, maxMana: 500,
    level: 1, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: 0, goldDelta: 0, alive: true, cooldowns: {},
  });

  it('cobra o custo do Canary escalado por quem está no alcance, e aplica a MESMA condição a cada um', () => {
    const loaded = buildContent(raw({
      progression: [{
        ...progression, startingMana: 500, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
      }],
      routes: [{ ...route, spawnPoints: [] }],
      spells: [...spells, healParty],
    }));
    const session = createHuntSession({
      id: 'heal-party', content: loaded, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0, botConfig: botConfig(castHealParty()),
    });
    const caster = make('hero');
    session.enter(caster);
    const near = make('near');
    session.enter(near);
    const far = make('far');
    session.enter(far);
    // Posiciona à mão DEPOIS de `enter` (que coloca "perto") — a mesma ordem do teste de Mass
    // Healing acima. `range: 3`: `far` fica a 5 tiles — fora do alcance, nunca recebe e nunca
    // conta para `n`.
    near.position = { x: caster.position.x + 2, y: caster.position.y, z: caster.position.z };
    far.position = { x: caster.position.x + 5, y: caster.position.y, z: caster.position.z };

    session.advanceBy(50);

    // n = 2 (hero + near; `far` não conta): ceil((0.9^1 * 120) * 2) = 216, não os 120 do `base`.
    expect(caster.mana).toBe(500 - 216);
    // Os dois no alcance carregam a MESMA condição — regen 20/2s por 2 minutos.
    for (const member of [caster, near]) {
      const condition = member.conditions.get('heal-over-time');
      expect(condition, member.id).toMatchObject({
        spellId: 'heal-party', tick: { amount: 20, intervalMs: 2_000 },
      });
    }
    // Quem ficou fora do alcance não recebe nada.
    expect(far.conditions.get('heal-over-time')).toBeNull();
  });

  it('recusa "no-target" com o lançador sozinho no alcance, e não gasta mana', () => {
    const loaded = buildContent(raw({
      progression: [{
        ...progression, startingMana: 500, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
      }],
      routes: [{ ...route, spawnPoints: [] }],
      spells: [...spells, healParty],
    }));
    const session = createHuntSession({
      id: 'heal-party-solo', content: loaded, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0, botConfig: botConfig(castHealParty()),
    });
    const caster = make('hero');
    session.enter(caster);

    session.advanceBy(50);

    expect(caster.mana).toBe(500);
    expect(caster.conditions.get('heal-over-time')).toBeNull();
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
      id: 'targets-in-reach', content: content({ routes: [threeRatsRoute] }), huntId: 'arena', difficulty: 'bold',
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
      ...progression, startingMana: 200, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
    }],
    ...(over.monsters === false
      ? { routes: [{ ...route, spawnPoints: [] }] }
      : difficulty === 'bold' ? { routes: [threeRatsRoute] } : {}),
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

  it('Cancel Magic Shield (#596) remove a condição do lançador NA HORA, sem evento agendado', () => {
    const { session, hero } = withSpells(botConfig({
      support: [{
        when: { kind: 'hp', op: '<=', percent: 100 },
        do: { kind: 'spell', spellId: 'cancel-magic-shield' },
      }],
    }), { health: 1_000, mana: 100, monsters: false });
    // Mana Shield já ativo — como uma poção ou magia anterior teria deixado.
    hero.conditions.apply({ key: 'mana-shield', spellId: 'magic-shield', expiresAtMs: 180_000 });
    expect(hero.conditions.hasManaShield()).toBe(true);

    session.advanceBy(50);

    // A remoção é IMEDIATA — não é uma condição nova com prazo curto, é a ausência da anterior.
    expect(hero.conditions.hasManaShield()).toBe(false);
    expect(hero.mana).toBe(90);
  });
});

describe('Challenge e Chivalrous Challenge (#589): provocação que força o alvo do monstro', () => {
  // Cooldown ABSURDO (999 999 ms), como o Dragon do #520 abaixo: garante UM lançamento só na
  // janela do teste, para a asserção não competir com o bot recastando sozinho. `range: 5` e
  // `radius: 3` cobrem a sala inteira (interior 4×3, Chebyshev máximo 3) — nenhum teste aqui
  // depende de onde exatamente a rota/spawn colocou quem está sendo provocado.
  const challengeSpell = {
    id: 'challenge', name: 'Challenge', manaCost: 30, cooldownMs: 999_999,
    effect: { kind: 'challenge', durationMs: 6_000, range: 5 },
  };
  const chivalrousChallengeSpell = {
    id: 'chivalrous-challenge', name: 'Chivalrous Challenge', manaCost: 80, cooldownMs: 999_999,
    effect: {
      kind: 'challenge', durationMs: 12_000,
      area: { shape: 'circle' as const, radius: 3, centered: 'caster' as const },
    },
  };
  // O rato já nasce na faixa de fuga (`runOnHealth` igual ao próprio HP): nenhum teste aqui
  // precisa acertar um golpe primeiro para provar RF-01/03/04 — o combate `pacifist` mantém o
  // HP parado a janela inteira, porque o assunto é a CONDIÇÃO, não a sobrevivência. A suspensão
  // de `isMonsterFleeing`/`decideMonsterAction` em si já tem teste unitário determinístico em
  // `monster.test.ts` (RF-03); aqui o que se prova é a integração pelo `castSpell` do ruleset.
  const fleeingRat = { ...rat, runOnHealth: 50 };
  const pacifist = [{ ...combat, player: { ...combat.player, attackPower: 0 } }];
  const alwaysTarget = { kind: 'targets' as const, op: '>=' as const, count: 1 };

  it('RF-01/RF-04: força o alvo no alcance, e a condição vence sozinha pela fila de eventos', () => {
    const { session, hero, ruleset } = withSpells(botConfig({
      attack: [{ when: alwaysTarget, do: { kind: 'spell', spellId: 'challenge' } }],
    }), { spells: [...spells, challengeSpell], monstersRaw: [fleeingRat], combat: pacifist });

    session.advanceBy(100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');

    // RF-01: o `targetId` foi forçado para quem lançou, e a condição está armada com o prazo
    // certo — o cast aconteceu em algum instante dentro dos primeiros 100 ms.
    expect(monster.targetId).toBe(hero.id);
    const condition = monster.conditions.get('challenge');
    expect(condition).not.toBeNull();
    expect(condition?.expiresAtMs).toBeGreaterThanOrEqual(6_000);
    expect(condition?.expiresAtMs).toBeLessThanOrEqual(6_100);

    // RF-04: passado o prazo, a condição SOME sozinha — `CONDITION_EXPIRE`, sem acumulador
    // novo. `cooldownMs: 999_999` garante que nenhum recast a renove no meio do caminho.
    session.advanceBy(6_200);
    expect(monster.conditions.get('challenge')).toBeNull();
  });

  it('RF-02: Chivalrous Challenge atinge TODOS os monstros da área, num lançamento só', () => {
    const { session, hero, ruleset } = withSpells(botConfig({
      attack: [{ when: alwaysTarget, do: { kind: 'spell', spellId: 'chivalrous-challenge' } }],
    }), {
      spells: [...spells, chivalrousChallengeSpell], monstersRaw: [fleeingRat], combat: pacifist,
    }, 'bold');

    session.advanceBy(100);
    // Densidade "bold" (`threeRatsRoute`, #583): três ratos no mesmo cenário — a prova de que a
    // área pega TODOS, não só o alvo principal.
    expect(ruleset.monsters.length).toBeGreaterThanOrEqual(2);
    for (const monster of ruleset.monsters) {
      expect(monster.targetId).toBe(hero.id);
      expect(monster.conditions.get('challenge')).not.toBeNull();
    }
  });

  it('RF-05: relançar no mesmo monstro RENOVA o prazo — não empilha', () => {
    // Cooldown normal (curto): dá para o bot recastar dentro da janela do teste, ao contrário
    // do `challengeSpell` acima — aqui o recast É o assunto.
    const renewable = {
      ...challengeSpell, cooldownMs: 100,
      effect: { ...challengeSpell.effect, range: 5 },
    };
    const { session, hero, ruleset } = withSpells(botConfig({
      attack: [{ when: alwaysTarget, do: { kind: 'spell', spellId: 'challenge' } }],
    }), { spells: [...spells, renewable], monstersRaw: [fleeingRat], combat: pacifist });

    session.advanceBy(50);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    const first = monster.conditions.get('challenge');
    expect(first).not.toBeNull();
    expect(monster.targetId).toBe(hero.id);

    // Passa o cooldown da CATEGORIA do bot (1000 ms) e o da magia (100 ms): um segundo cast
    // acontece, e `#applyConditionTo` (`merge` ausente é `'refresh'`) troca o prazo em vez de
    // somar. Só uma entrada em `monster.conditions` — é um `Map` por chave, não uma lista —,
    // com o `expiresAtMs` do SEGUNDO cast.
    session.advanceBy(1_100);
    const second = monster.conditions.get('challenge');
    expect(second).not.toBeNull();
    expect(second?.expiresAtMs).toBeGreaterThan(first?.expiresAtMs ?? 0);
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

describe('conjuração no modelo de suprimento abstrato (#594, ADR 0044)', () => {
  const conjureTestRune = {
    id: 'conjure-test-rune', name: 'Test Rune', manaCost: 30, soulCost: 2, cooldownMs: 1_000, minLevel: 1,
    effect: { kind: 'conjure', supplyId: 'test-rune', charges: 5, blankPrice: 7 },
  };
  const testRune = {
    id: 'test-rune', name: 'Test Rune', price: 1, group: 'potion', groupCooldownMs: 1_000,
    requires: {}, effect: { kind: 'mana', amount: 10 },
  };

  it('credita o estoque do lançador e leva mana, alma e gold ao extrato — via o slot de magia normal', () => {
    const { session, hero } = withSpells(
      botConfig({ heal: [{
        when: { kind: 'hp', op: '<=', percent: 100 },
        do: { kind: 'spell', spellId: 'conjure-test-rune' },
      }] }),
      {
        health: 1_000, mana: 30, gold: 7, monsters: false,
        spells: [conjureTestRune], supplies: [testRune],
      },
    );
    // #593: a alma só existe depois de escolher vocação — o herói de teste nasce sem uma, e
    // `hero.soul` começa em 0. A magia recusaria por `not-enough-soul` sem isto.
    hero.soul = 2;

    session.advanceBy(50);

    expect((hero.supplyStock as Map<string, number>).get('test-rune')).toBe(5);
    expect(hero.mana).toBe(0);
    expect(hero.soul).toBe(0);
    expect(hero.goldDelta).toBe(-7);
    // O gold da runa em branco chega ao mesmo agregado que `useSupply` já alimenta — o extrato
    // não ganha campo novo, `supplyStock` já é lista de permissão em `receipts.ts` desde o #520.
    expect(session.aggregates.goldSpent).toBe(7);
  });

  it('não é aplicável em munição: a conjuração de flecha não toca `supplyStock`', () => {
    const conjureAmmo = {
      id: 'conjure-test-ammo', name: 'Test Ammo', manaCost: 10, cooldownMs: 1_000, minLevel: 1,
      effect: { kind: 'conjure', ammunitionId: 'arrow', charges: 8 },
    };
    const { session, hero } = withSpells(
      botConfig({ heal: [{
        when: { kind: 'hp', op: '<=', percent: 100 },
        do: { kind: 'spell', spellId: 'conjure-test-ammo' },
      }] }),
      { health: 1_000, mana: 10, gold: 0, monsters: false, spells: [conjureAmmo] },
    );

    session.advanceBy(50);

    expect((hero.ammunitionStock as Map<string, number>).get('arrow')).toBe(8);
    expect((hero.supplyStock as Map<string, number>).size).toBe(0);
    expect(hero.goldDelta).toBe(0);
    expect(session.aggregates.goldSpent).toBe(0);
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
      progression: [{ ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
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
      progression: [{ ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
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
    // Emitir a barra sem o `> 0` mata pela segunda metade: de vida cheia, três eventos.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn, health: 100 });
    run(session, 3_000, 100);
    const events = session.drainEvents();

    // 1 ponto a cada 1 000 ms: vence em 1 000, 2 000 e 3 000 — o primeiro pulso só depois de
    // `ticksMs` (#678) —, três barras, a última com a vida final.
    const barras = ofKind(events, 'creature-health-changed');
    expect(barras).toHaveLength(3);
    expect(barras.every((b) => b.creatureId === 'hero')).toBe(true);
    expect(barras.at(-1)?.health).toBe(hero.health);
    expect(hero.health).toBe(103);
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

describe('poção de BUFF do Tibia — Berserk, Mastermind, Bullseye, Magic Shield (#576)', () => {
  // O malus de `shielding` (#576: Berserk/Bullseye tiram 10) não entra na fixture do bot: o
  // catálogo de teste deste arquivo não declara a skill `shielding` (nenhum teste daqui escala
  // defesa sem declarar `combat.defense.skillId` explicitamente, e adicioná-la ao catálogo
  // compartilhado colidiria com os testes de CMB-04 que já a montam localmente). O malus é
  // coberto no nível de unidade — `Conditions.skillBonus`/`conditionFromSpec`
  // (`conditions.test.ts`) e `useSupply` (`casting.test.ts`).
  const berserkPotion = {
    id: 'berserk-potion', name: 'Berserk Potion', price: 0, group: 'potion',
    requires: { vocationId: 'knight' },
    effect: {
      kind: 'condition',
      condition: {
        key: 'berserk-potion', durationMs: 600_000,
        effect: { kind: 'buff', skillDeltas: { melee: 5 } },
      },
    },
  };
  const magicShieldPotion = {
    id: 'magic-shield-potion', name: 'Magic Shield Potion', price: 0, group: 'potion',
    effect: {
      kind: 'condition',
      condition: { key: 'mana-shield', durationMs: 60_000, effect: { kind: 'mana-shield' } },
    },
  };

  it('o bot bebe, e o buff soma na skill do personagem POR 600 s (Berserk: +5 melee)', () => {
    const { session, hero } = withSpells(
      botConfig({ potion: [supplyRule('berserk-potion')] }),
      { health: 1_000, supplies: [...supplies, berserkPotion] },
    );
    hero.vocationId = 'knight';

    session.advanceBy(50);
    expect(hero.conditions.skillBonus('melee')).toBe(5);
    expect(hero.conditions.get('berserk-potion')?.expiresAtMs).toBe(600_000);
    // O vencimento em si (`CONDITION_EXPIRE` na fila, sem `if` algum lendo o relógio) é o
    // mecanismo genérico do CMB-07, já coberto pelos testes de haste/buff/mana-shield de magia
    // neste mesmo arquivo — esta issue só adiciona `skillDeltas` ao efeito `buff`, sem tocar o
    // agendamento do vencimento.
  });

  it('restrição de vocação: sem ser Knight, o bot não bebe e o buff nunca aparece', () => {
    const { session, hero } = withSpells(
      botConfig({ potion: [supplyRule('berserk-potion')] }),
      { health: 1_000, supplies: [...supplies, berserkPotion] },
    );
    // `hero.vocationId` fica `null` (o de sempre) — Berserk pede `knight`.
    session.advanceBy(50);
    expect(hero.conditions.skillBonus('melee')).toBe(0);
    const events = session.drainEvents();
    expect(ofKind(events, 'supply-used')).toHaveLength(0);
  });

  it('Magic Shield Potion aplica a MESMA condição `mana-shield` da magia — auto-alvo, sem alcance', () => {
    const { session, hero } = withSpells(
      botConfig({ potion: [supplyRule('magic-shield-potion')] }),
      { health: 1_000, supplies: [...supplies, magicShieldPotion] },
    );
    session.advanceBy(50);
    expect(hero.conditions.hasManaShield()).toBe(true);
    expect(ofKind(session.drainEvents(), 'supply-used')).toHaveLength(1);
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
  // `post-tank` (posteEterno) é o alvo padrão: nunca morre, o que sustenta testes que medem
  // dano ao longo do tempo sem o alvo sumir no meio.
  spawnPoints: [{ routeIndex: 10, radius: 1, monsterId: 'post-tank', respawnDelayMs: 600_000 }],
};

/**
 * Um monstro que fica ONDE NASCEU: `aggroRadius: 0` faz `chooseTarget` nunca achar alvo, e sem
 * alvo não há passo nem golpe. É o que permite afirmar a posição do personagem sem que a
 * decisão do monstro entre na conta — aqui o assunto é a postura, não a IA dele.
 */
const poste = {
  // A população INICIAL sempre nasce na hora (#583, `#onSpawnInitial`, bypassa `blockable` e
  // o telegraph do não bloqueável) — estes testes conferem posição/postura a
  // `session.advanceBy(10)` sobre esse primeiro nascimento, nunca sobre um respawn.
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
};

/**
 * As três variantes do salão, uma por ROTA (#583: fim do pull por dificuldade — o que escolhia
 * entre elas era `difficulty`, agora ignorada; quem escolhe é o `spawnPoints` da rota).
 * `cautious`/`bold` mantêm o único ponto do `anel` (#2596) com o monstro trocado; `reckless`
 * ganha um SEGUNDO ponto, porque o cenário quer dois ratos de verdade, não um.
 */
const anelCautious = {
  ...anel, spawnPoints: [{ routeIndex: 10, radius: 1, monsterId: 'post', respawnDelayMs: 600_000 }],
};
const anelBold = {
  ...anel,
  spawnPoints: [{ routeIndex: 10, radius: 1, monsterId: 'post-tank', respawnDelayMs: 600_000 }],
};
const anelReckless = {
  ...anel,
  spawnPoints: [
    { routeIndex: 10, radius: 1, monsterId: 'rat', respawnDelayMs: 5_000 },
    { routeIndex: 4, radius: 1, monsterId: 'rat', respawnDelayMs: 5_000 },
  ],
};

const withPosture = (
  over: Record<string, unknown>,
  difficulty: 'cautious' | 'bold' | 'reckless' = 'cautious',
  heroOver: Partial<{
    health: number; staminaMs: number; skills: SkillsState; inventory: InventoryState;
    bestiary: BestiaryState; gold: number;
  }> = {},
) => {
  const anelDaVariante = difficulty === 'bold'
    ? anelBold
    : difficulty === 'reckless' ? anelReckless : anelCautious;
  const loaded = buildContent(raw({
    monsters: [rat, poste, posteEterno], hunts: [hunt, huntSalao],
    maps: [map, salaGrande], routes: [route, anelDaVariante],
  }));
  const session = createHuntSession({
    id: 'postura', content: loaded, huntId: 'salao', difficulty, createdAtMs: 0,
    botConfig: botConfig({ targeting: botTargetingSchema.parse(over) }),
  });
  const hero = character(heroOver);
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

  it('follow com arma de alcance NÃO foge quando o alvo fica adjacente — fica parado e bate', () => {
    // Wand com range 3: o monstro está a distância 1 (adjacente).
    // Antes do fix, posture.kind === 'follow' executava fleeStep porque d (1) < want (3),
    // fugindo do monstro e empacando contra paredes.
    const { session, hero, ruleset } = withPosture(
      { posture: { kind: 'follow' } },
      'bold',
      {
        inventory: {
          backpack: [],
          equipped: { hand: { instanceId: 'w1', itemId: 'wand', quantity: 1 } },
        },
      },
    );
    hero.mana = 10000;
    hero.maxMana = 10000;
    // Poste eterno nasce em (4, 5). Coloca o herói em (4, 4) adjacente (d = 1 <= 3).
    hero.position = { x: 4, y: 4, z: 7 };

    run(session, 10_000, 100);

    // Herói não fugiu para distância 3: continuou em (4, 4) batendo!
    expect(hero.position).toEqual({ x: 4, y: 4, z: 7 });
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

  it('hunt solo: passo manual ao longo da rota não trava o walker em loop de same-tile', () => {
    // Um passo manual (requestMove) move o personagem para o tile seguinte da rota.
    // Antes do fix, na hunt solo, walker.step() pedia o tile onde o personagem já estava,
    // move() devolvia same-tile, e walker.hold() desfazia o avanço, travando o bot para sempre.
    const { session, hero, ruleset } = withPosture({ posture: { kind: 'stand' } }, 'bold');

    // Rota 'anel': tiles[0] é (4, 3, 7), tiles[1] é (5, 3, 7).
    // O herói nasce em (4, 3, 7). Dá um passo manual para o tile seguinte da rota:
    const stepRes = ruleset.requestMove(session, hero.id, { x: 5, y: 3 });
    expect(stepRes.ok).toBe(true);
    expect(hero.position).toEqual({ x: 5, y: 3, z: 7 });

    // Roda a simulação por 10 segundos. O walker NÃO deve ficar travado em (5, 3, 7).
    run(session, 10_000, 100);

    expect(hero.position).not.toEqual({ x: 5, y: 3, z: 7 });
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
    progression: [{ ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
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

// --- trava de combate na saída (#625, CONDITION_INFIGHT/pzLocked do Canary) ------------------

describe('trava de combate na saída (#625)', () => {
  it('o golpe do personagem no monstro marca `lastCombatActionAtMs` — a definição única lida por `isInFight`', () => {
    // Combate DE VERDADE (`start()` traz o rato de sempre), não o carimbo manual dos testes
    // abaixo: prova que `#land`/`#strike` de fato escrevem o campo, não só a trava que o lê.
    const { session, hero } = start();
    expect(hero.lastCombatActionAtMs).toBeNull();
    run(session, 3_000, 100);
    expect(hero.lastCombatActionAtMs).not.toBeNull();
    expect(hero.lastCombatActionAtMs).toBeLessThanOrEqual(session.nowMs);
  });

  it('saída manual em combate espera os 60 s desde o último ataque, mesmo sem exitDelayMs', () => {
    const { session, hero, ruleset } = withExit([]);
    session.advanceBy(1_000);
    // Simula o último ataque dado/recebido (a hunt de `withExit` não tem monstro, de propósito
    // — o assunto aqui é a trava, não o combate em si).
    hero.lastCombatActionAtMs = session.nowMs;

    ruleset.requestExit(session, hero.id);
    // Sem `exitDelayMs`, `#beginExit` chamaria `#finishExit` na hora — mas em combate ela não
    // conclui, MESMO sem contagem visual nenhuma configurada.
    expect(session.ended).toBeNull();

    // A 59 999ms do último ataque, ainda em combate.
    session.advanceBy(59_999);
    expect(session.ended).toBeNull();

    // A 60 000ms do último ataque, a trava vence e a saída conclui.
    session.advanceBy(1);
    expect(session.ended).toBe('manual-exit');
  });

  it('fora de combate, a saída manual usa só o delay normal — a trava não atrasa quem não lutou', () => {
    const { session, hero, ruleset } = withExit([], { exitDelayMs: 5_000 });
    session.advanceBy(1_000);
    expect(hero.lastCombatActionAtMs).toBeNull();

    ruleset.requestExit(session, hero.id);
    session.advanceBy(4_999);
    expect(session.ended).toBeNull();
    session.advanceBy(1);
    expect(session.ended).toBe('manual-exit');
  });

  it('um novo ataque durante a espera empurra a trava — a saída só conclui 60 s depois do ÚLTIMO', () => {
    const { session, hero, ruleset } = withExit([]);
    session.advanceBy(1_000);
    hero.lastCombatActionAtMs = session.nowMs;
    ruleset.requestExit(session, hero.id);

    // Apanha de novo a 30 000ms do primeiro ataque — a trava reagendaria para 60 000ms do
    // primeiro, mas o ataque novo empurra para 90 000ms do início.
    session.advanceBy(30_000);
    hero.lastCombatActionAtMs = session.nowMs;

    // Nos 60 000ms do PRIMEIRO ataque (quando a trava antiga venceria), ainda em combate.
    session.advanceBy(30_000);
    expect(session.ended).toBeNull();

    // Nos 60 000ms do SEGUNDO ataque, a trava libera.
    session.advanceBy(29_999);
    expect(session.ended).toBeNull();
    session.advanceBy(1);
    expect(session.ended).toBe('manual-exit');
  });

  it('a regra do bot (automação) respeita a mesma trava', () => {
    // Hunt sem monstro (o mesmo desenho de `withExit`), mas pela porta de `start()` — é ela
    // que aceita `HuntExitRule` cru, como o teste `por regra automática de saída…` acima.
    const rule: HuntExitRule = { id: 'always', when: () => true };
    const loaded = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ exitRules: [rule], loaded });
    // ANTES de qualquer avanço: a regra "always" já dispara no primeiro `EXIT_RULES`, em
    // t = 250ms (`EXIT_RULE_INTERVAL_MS`) — o carimbo precisa existir antes disso para a
    // trava valer nesse primeiro disparo.
    hero.lastCombatActionAtMs = session.nowMs;

    session.advanceBy(1_000);
    expect(session.ended).toBeNull();
    expect(session.notableEvents.find((e) => e.type === 'exit-rule')?.detail).toBe('always');

    // 60 000ms do ataque simulado, fora de combate: a mesma trava do manual libera a regra.
    session.advanceBy(58_999);
    expect(session.ended).toBeNull();
    session.advanceBy(1);
    expect(session.ended).toBe('exit-rule');
  });
});

// --- a saída que o jogador pede e desfaz (#802) ----------------------------------------------

describe('saída pedida pelo jogador: estado pendente e cancelamento (#802)', () => {
  it('exitStatus é null sem saída pendente, para quem existe e para quem não existe', () => {
    const { session, hero, ruleset } = withExit([], { exitDelayMs: 5_000 });
    expect(ruleset.exitStatus(session, hero.id)).toBeNull();
    expect(ruleset.exitStatus(session, 'desconhecido')).toBeNull();
  });

  it('durante a contagem do exitDelayMs: fase `countdown`, com o instante em que ela vence', () => {
    const { session, hero, ruleset } = withExit([], { exitDelayMs: 5_000 });
    session.advanceBy(1_000);
    ruleset.requestExit(session, hero.id);
    expect(ruleset.exitStatus(session, hero.id))
      .toEqual({ reason: 'manual-exit', phase: 'countdown', untilMs: 6_000 });
    // O tempo corre e o instante NÃO se mexe — quem calcula "faltam N s" é quem apresenta.
    session.advanceBy(2_000);
    expect(ruleset.exitStatus(session, hero.id))
      .toEqual({ reason: 'manual-exit', phase: 'countdown', untilMs: 6_000 });
    // Concluída, a saída deixa de estar pendente.
    session.advanceBy(3_000);
    expect(session.ended).toBe('manual-exit');
    expect(ruleset.exitStatus(session, hero.id)).toBeNull();
  });

  it('em combate: fase `in-combat`, com o fim da janela de 60 s — e um golpe novo empurra o prazo', () => {
    const { session, hero, ruleset } = withExit([]);
    session.advanceBy(1_000);
    hero.lastCombatActionAtMs = session.nowMs;
    ruleset.requestExit(session, hero.id);
    expect(ruleset.exitStatus(session, hero.id))
      .toEqual({ reason: 'manual-exit', phase: 'in-combat', untilMs: 61_000 });

    // O golpe novo entra no carimbo, mas o evento agendado só o relê quando vence: o que o
    // jogador vê (o mais tardio dos dois) já reflete a janela nova.
    session.advanceBy(30_000);
    hero.lastCombatActionAtMs = session.nowMs;
    expect(ruleset.exitStatus(session, hero.id))
      .toEqual({ reason: 'manual-exit', phase: 'in-combat', untilMs: 91_000 });
    // E o número diz a verdade: a saída conclui exatamente nele.
    session.advanceBy(59_999);
    expect(session.ended).toBeNull();
    session.advanceBy(1);
    expect(session.ended).toBe('manual-exit');
  });

  it('em combate, vale o mais tardio entre o prazo agendado e o fim da janela', () => {
    const { session, hero, ruleset } = withExit([], { exitDelayMs: 5_000 });
    session.advanceBy(1_000);
    hero.lastCombatActionAtMs = session.nowMs;
    ruleset.requestExit(session, hero.id);
    // O evento agendado (6 000) é ANTES do fim da janela (61 000): vale a janela.
    expect(ruleset.exitStatus(session, hero.id))
      .toEqual({ reason: 'manual-exit', phase: 'in-combat', untilMs: 61_000 });

    // Uma contagem MAIS LONGA que a janela: vale a contagem.
    const longa = withExit([], { exitDelayMs: 90_000 });
    longa.session.advanceBy(1_000);
    longa.hero.lastCombatActionAtMs = longa.session.nowMs;
    longa.ruleset.requestExit(longa.session, longa.hero.id);
    expect(longa.ruleset.exitStatus(longa.session, longa.hero.id))
      .toEqual({ reason: 'manual-exit', phase: 'in-combat', untilMs: 91_000 });
  });

  it('cancelExit desfaz a saída manual: a hunt segue depois do prazo que ela teria', () => {
    const { session, hero, ruleset } = withExit([], { exitDelayMs: 5_000 });
    session.advanceBy(1_000);
    ruleset.requestExit(session, hero.id);
    session.advanceBy(2_000);

    expect(ruleset.cancelExit(session, hero.id)).toBe(true);
    expect(ruleset.exitStatus(session, hero.id)).toBeNull();
    // O evento agendado saiu da fila: nada vence em 6 000 ms.
    expect(session.dueAtOf('exit-countdown', hero.id)).toBeNull();
    session.advanceBy(60_000);
    expect(session.ended).toBeNull();
    // Cancelar de novo é um no-op honesto.
    expect(ruleset.cancelExit(session, hero.id)).toBe(false);
  });

  it('cancelar e pedir de novo recomeça a contagem inteira — o evento velho não conclui antes da hora', () => {
    // Mutação que mata: `cancelExit` só zerar `pendingExit`, sem cancelar o evento — o velho
    // (t = 6 000) venceria com o pedido novo já marcado e encerraria 2 000 ms cedo demais.
    const { session, hero, ruleset } = withExit([], { exitDelayMs: 5_000 });
    session.advanceBy(1_000);
    ruleset.requestExit(session, hero.id);
    session.advanceBy(1_000);
    expect(ruleset.cancelExit(session, hero.id)).toBe(true);
    session.advanceBy(1_000);
    ruleset.requestExit(session, hero.id); // t = 3 000 → conclui em 8 000

    session.advanceBy(3_000); // t = 6 000: o prazo do pedido cancelado
    expect(session.ended).toBeNull();
    session.advanceBy(1_999);
    expect(session.ended).toBeNull();
    session.advanceBy(1);
    expect(session.ended).toBe('manual-exit');
  });

  it('cancelar a saída que espera o combate tira a espera dos 60 s', () => {
    const { session, hero, ruleset } = withExit([]);
    session.advanceBy(1_000);
    hero.lastCombatActionAtMs = session.nowMs;
    ruleset.requestExit(session, hero.id);
    session.advanceBy(10_000);
    expect(ruleset.cancelExit(session, hero.id)).toBe(true);
    // Passou o fim da janela e a hunt segue: ninguém concluiu uma saída que foi desfeita.
    session.advanceBy(120_000);
    expect(session.ended).toBeNull();
  });

  it('não cancela a saída de uma REGRA do bot — é decisão da configuração, e ela dispararia de novo', () => {
    const { session, hero, ruleset } = withExit(
      [{ kind: 'hp-below', percent: 50 }],
      { health: 100, exitDelayMs: 5_000 },
    );
    session.advanceBy(250);
    expect(ruleset.exitStatus(session, hero.id))
      .toEqual({ reason: 'exit-rule', phase: 'countdown', untilMs: 5_250 });
    expect(ruleset.cancelExit(session, hero.id)).toBe(false);
    session.advanceBy(5_000);
    expect(session.ended).toBe('exit-rule');
  });

  it('a saída pendente e o cancelamento atravessam o snapshot', () => {
    const { session, hero, ruleset, loaded } = withExit([], { exitDelayMs: 5_000 });
    session.advanceBy(1_000);
    ruleset.requestExit(session, hero.id);
    session.advanceBy(1_000);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );
    const retomadoRuleset = retomado.ruleset as HuntRuleset;
    expect(retomadoRuleset.exitStatus(retomado, hero.id))
      .toEqual({ reason: 'manual-exit', phase: 'countdown', untilMs: 6_000 });

    expect(retomadoRuleset.cancelExit(retomado, hero.id)).toBe(true);
    retomado.advanceBy(60_000);
    expect(retomado.ended).toBeNull();
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
        regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
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
    // A trava de combate (#625) lê o carimbo do combate que já rolou ANTES da restauração —
    // este teste é sobre o MOTIVO da saída sobreviver ao snapshot, não sobre a trava em si (que
    // tem teste próprio); zera o carimbo para não depender de quando, na hunt original, o herói
    // levou o primeiro golpe. Mata os ratos vivos também: o `ignore: ['rat']` da `curar` só tira
    // o rato da MIRA do bot — ele continua batendo, e sem isto a trava reabriria sozinha.
    eu.lastCombatActionAtMs = null;
    for (const monster of (retomado.ruleset as HuntRuleset).monsters) monster.health = 0;
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
        ...progression, startingMana: 200, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
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

// --- rates do servidor (#691) ----------------------------------------------------------------

describe('rates do servidor (#691)', () => {
  const withRates = (rates: Record<string, unknown>, over: Partial<RawContent> = {}): Content =>
    content({ progression: [{ ...progression, rates }], ...over });

  it('experience 2 dobra a XP DEPOIS do Bestiário: rato de 5 XP rende 10', () => {
    const { session, hero } = start({ loaded: withRates({ experience: 2 }) });
    run(session, 10_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.xp).toBe(session.aggregates.kills * rat.experience * 2);
    expect(session.aggregates.xpGained).toBe(hero.xp);
  });

  it('com useStages, o stage do level decide; o rate simples é ignorado', () => {
    const { session, hero } = start({
      loaded: withRates({ experience: 2, useStages: true, experienceStages: [{ minLevel: 1, maxLevel: 1, multiplier: 3 }] }),
    });
    session.advanceBy(100);
    while (session.aggregates.kills === 0) session.advanceBy(100);
    // O primeiro abate é pago no level 1: stage × 3, não o `experience` 2.
    expect(hero.xp).toBe(rat.experience * 3);
  });

  it('monster.attack 2 dobra o rawDamage do monstro, com a mesma semente e o mesmo sorteio', () => {
    const biter = { ...rat, attack: { min: 0, max: 8 }, health: 100_000 };
    const hitsOf = (rates: Record<string, unknown>): number[] => {
      vi.mocked(resolveDamage).mockClear();
      const { session } = start({ loaded: withRates(rates, { monsters: [biter] }) });
      run(session, 20_000, 100);
      return vi.mocked(resolveDamage).mock.calls
        .filter(([intent]) => intent.source === 'monster-attack')
        .map(([intent]) => intent.rawDamage);
    };
    const neutral = hitsOf({});
    const doubled = hitsOf({ monster: { attack: 2 } });
    expect(neutral.length).toBeGreaterThan(3);
    expect(new Set(neutral).size).toBeGreaterThan(1);
    expect(doubled).toEqual(neutral.map((damage) => damage * 2));
    // O bloco `boss` não vale para monstro comum.
    expect(hitsOf({ boss: { attack: 2 } })).toEqual(neutral);
  });

  it('boss usa o bloco boss para o ataque', () => {
    const boss = { ...rat, attack: { min: 0, max: 8 }, health: 100_000, boss: true };
    const hitsOf = (rates: Record<string, unknown>): number[] => {
      vi.mocked(resolveDamage).mockClear();
      const { session } = start({ loaded: withRates(rates, { monsters: [boss] }) });
      run(session, 20_000, 100);
      return vi.mocked(resolveDamage).mock.calls
        .filter(([intent]) => intent.source === 'monster-attack')
        .map(([intent]) => intent.rawDamage);
    };
    const neutral = hitsOf({});
    expect(hitsOf({ boss: { attack: 3 } })).toEqual(neutral.map((damage) => damage * 3));
    expect(hitsOf({ monster: { attack: 3 } })).toEqual(neutral);
  });

  it('loot 0 desliga o gold do abate', () => {
    const { session, hero } = start({ loaded: withRates({ loot: 0 }) });
    run(session, 10_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(session.aggregates.goldGained).toBe(0);
    expect(hero.goldDelta).toBe(0);
  });

  it('skill 2 sobe o corpo a corpo mais rápido no mesmo tempo', () => {
    const levelOf = (rates: Record<string, unknown>): number => {
      const { session, hero } = start({ difficulty: 'bold', loaded: withRates(rates) });
      run(session, 30_000, 100);
      return hero.skills.getState()['melee']?.level ?? 0;
    };
    expect(levelOf({ skill: 2 })).toBeGreaterThan(levelOf({}));
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
    // Fartura de monstro DELIBERADA (#583: mais pontos que o "bold" comum) — o que este teste
    // mede é a velocidade de abate, não o quanto o respawn segura; com poucos pontos, os dois
    // lados empatam no TETO de disponibilidade em vez de discordar na velocidade.
    const fartura = content({ routes: [manyRatsRoute] });
    const cru = start({ difficulty: 'bold', loaded: fartura });
    run(cru.session, 120_000, 100);

    const treinado = start({
      difficulty: 'bold', loaded: fartura, skills: { melee: { level: 30, points: 0 } },
    });
    run(treinado.session, 120_000, 100);

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

  /**
   * O conteúdo do CMB-04: o escudo no catálogo, a skill de bloqueio e o perfil com defesa. Usa
   * `threeRatsRoute` por padrão — estes testes entram com `difficulty: 'bold'`, que passava por
   * `loaded` explícito (não pelo `content()` default de `start`) e por isso não pegava a
   * densidade de "bold" sozinho (#583: sem mais `monsterCount`, quem decide é a rota).
   */
  const defenseContent = (over: Partial<RawContent> = {}): Content => content({
    items: [...items, shieldItem],
    skills: [...skills, shielding],
    combat: [{ ...combat, defense }],
    routes: [threeRatsRoute],
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
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
      distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    };
    const { session, hero } = start({
      loaded: defenseContent({ monsters: [fireRat], combat: [combatV3] }), difficulty: 'bold',
      health: 5_000, inventory: comEscudo,
    });
    run(session, 30_000, 100);
    expect(shieldingOf(hero)?.level).toBeGreaterThan(10);
  });

  describe('#682: a ability física que não é corpo a corpo passa pela armadura, não pelo escudo', () => {
    // O Stone Golem/Hunter do Canary: um `combat` FÍSICO de alcance 7. Antes do #682 ia ao
    // `blockHit` como magia (`MAGIC_BLOCK_FLAGS`) e a armadura não tirava nada.
    const stoneRat = {
      ...rat,
      abilities: [{
        id: 'stone', cadenceMs: 2_000, power: { min: 40, max: 60 }, damageType: 'physical',
        target: { range: 7 },
      }],
    };
    const comEscudoEArmadura: InventoryState = {
      backpack: [],
      equipped: {
        shield: { instanceId: 's1', itemId: 'shield', quantity: 1 },
        chest: { instanceId: 'p1', itemId: 'plate', quantity: 1 },
      },
    };
    const combatV3 = {
      ...combat, compatibilityProfile: 'combat-v3', defense,
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
      distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    };
    const abilityHits = () => vi.mocked(resolveDamage).mock.calls
      .map((args, i) => ({ args, outcome: vi.mocked(resolveDamage).mock.results[i]?.value as DamageOutcome }))
      .filter(({ args: [intent] }) => intent.source === 'monster-attack');

    it('sob combat-v3: armadura em faixa, escudo não bloqueia e shielding não treina', () => {
      vi.mocked(resolveDamage).mockClear();
      const { session, hero } = start({
        loaded: defenseContent({ monsters: [stoneRat], combat: [combatV3] }), difficulty: 'bold',
        health: 5_000, inventory: comEscudoEArmadura,
      });
      run(session, 30_000, 100);

      const hits = abilityHits();
      expect(hits.length).toBeGreaterThan(0);
      for (const { args: [intent, defender], outcome } of hits) {
        expect(intent.blockable).toEqual(DISTANCE_BLOCK_FLAGS);
        // O escudo não tira nada: a defesa é a identidade.
        expect(outcome.afterDefense).toBe(intent.rawDamage);
        // Armadura > 3 é faixa `[armor/2, armor - (armor%2 + 1)]`, nunca 0.
        expect(defender.armor).toBeGreaterThan(3);
        expect(outcome.armorReduction).toBeGreaterThan(0);
      }
      // O `hunt.ts` treina shielding por `blockable.shield` sob v3 — a pedra não é bloqueio.
      expect(shieldingOf(hero)?.level ?? 10).toBe(10);
    });

    it('sob combat-v1: `blockable` é ignorado — o resultado é o mesmo com as flags de antes', () => {
      vi.mocked(resolveDamage).mockClear();
      const { session } = start({
        loaded: defenseContent({ monsters: [stoneRat] }), difficulty: 'bold',
        health: 5_000, inventory: comEscudoEArmadura,
      });
      run(session, 30_000, 100);

      const hits = abilityHits();
      expect(hits.length).toBeGreaterThan(0);
      for (const { args: [intent, defender, context, combatDef, , nowMs] } of hits) {
        // Reexecuta o golpe com as flags de ANTES do #682 e as de agora, na mesma semente.
        const before = resolveDamage(
          { ...intent, blockable: MAGIC_BLOCK_FLAGS }, defender, context, combatDef, Rng.fromSeed('v1'), nowMs,
        );
        const after = resolveDamage(
          { ...intent, blockable: DISTANCE_BLOCK_FLAGS }, defender, context, combatDef, Rng.fromSeed('v1'), nowMs,
        );
        expect({ ...after, intent: null }).toEqual({ ...before, intent: null });
      }
    });
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
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
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
      bonuses: { skills: [{ skillId: 'shielding', amount: 20 }] },
    };
    const combatV3 = {
      ...combat, compatibilityProfile: 'combat-v3', defense,
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
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
    // O rato com aggro 0 nunca chega a atacar: o tempo passa e a skill não se move. Um ponto
    // só (não os três de "bold") — o herói ainda pode matá-lo desarmado por conta própria, e
    // três respawns ao longo de 60 s multiplicam a chance de um deles nascer já adjacente e
    // ser confundido com "foi atacado" por um efeito colateral de posicionamento, o que este
    // teste não quer medir.
    const pacificRat = { ...rat, aggroRadius: 0 };
    const { session, hero } = start({
      loaded: defenseContent({ monsters: [pacificRat], routes: [route] }), difficulty: 'bold',
      health: 5_000, inventory: comEscudo,
    });
    run(session, 60_000, 100);
    expect(shieldingOf(hero)).toBeNull();
  });

  it('não é condicionada ao HP perdido: bloqueio total ainda treina', () => {
    // Piso zero e defesa acima do ataque do rato: ele não tira vida, e a skill sobe do mesmo
    // jeito — a prática é do evento elegível, não do dano aplicado. Regeneração desligada e
    // dificuldade `cautious` para a vida não subir sozinha e não haver level up.
    const semRegen = { ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } };
    const { session, hero } = start({
      loaded: defenseContent({
        progression: [semRegen], routes: [route],
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

  describe('combat-v3: de onde vem cada try (#686)', () => {
    const combatV3 = {
      ...combat, compatibilityProfile: 'combat-v3', defense,
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
      distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    };
    const combatV2 = { ...combatV3, compatibilityProfile: 'combat-v2' };
    const immuneRat = { ...rat, mitigation: { resistances: {}, immunities: ['physical'] } };
    const meleeOf = (hero: CharacterRuntime) => hero.skills.getState()['melee'] ?? null;
    const comEspada: InventoryState = {
      backpack: [], equipped: { hand: { instanceId: 'w1', itemId: 'sword', quantity: 1 } },
    };

    it('corpo a corpo contra monstro imune: a skill NÃO sobe (v2 sobe)', () => {
      const v3 = start({
        loaded: defenseContent({ monsters: [immuneRat], combat: [combatV3] }),
        difficulty: 'bold', health: 5_000,
      });
      run(v3.session, 30_000, 100);
      expect(meleeOf(v3.hero)).toBeNull();
      expect(v3.hero.attackPractice.lastBlockType).toBe('immunity');

      const v2 = start({
        loaded: defenseContent({ monsters: [immuneRat], combat: [combatV2] }),
        difficulty: 'bold', health: 5_000,
      });
      run(v2.session, 30_000, 100);
      expect(meleeOf(v2.hero)).not.toBeNull();
    });

    it('corpo a corpo contra monstro comum: o golpe limpo treina e recarrega os contadores', () => {
      const { session, hero } = start({
        loaded: defenseContent({ combat: [combatV3] }), difficulty: 'bold', health: 5_000,
      });
      run(session, 30_000, 100);
      expect(meleeOf(hero)).not.toBeNull();
      expect(hero.attackPractice.addAttackSkill).toBe(true);
    });

    it('arma de uma mão sem escudo, apanhando: shielding NÃO sobe (v2 sobe)', () => {
      const v3 = start({
        loaded: defenseContent({ combat: [combatV3] }), difficulty: 'bold', health: 5_000,
        inventory: comEspada,
      });
      run(v3.session, 30_000, 100);
      expect(shieldingOf(v3.hero)).toBeNull();

      const v2 = start({
        loaded: defenseContent({ combat: [combatV2] }), difficulty: 'bold', health: 5_000,
        inventory: comEspada,
      });
      run(v2.session, 30_000, 100);
      expect(shieldingOf(v2.hero)).not.toBeNull();
    });

    it('o estado de prática atravessa o snapshot', () => {
      const loaded = defenseContent({ combat: [combatV3] });
      const { session, hero } = start({ loaded, difficulty: 'bold', health: 5_000 });
      run(session, 10_000, 100);
      expect(hero.attackPractice.bloodHitCount).toBeGreaterThan(0);

      const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
      const retomado = Session.fromSnapshot(
        snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed(snapshot.id),
      );
      expect(retomado.participants[0]?.attackPractice).toEqual(hero.attackPractice);
    });
  });

  describe('postura de luta: o fightMode do personagem chega ao golpe e à defesa (M30-03, #550)', () => {
    const combatV3 = {
      ...combat, compatibilityProfile: 'combat-v3', defense,
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
      distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    };
    const combatV2 = { ...combatV3, compatibilityProfile: 'combat-v2' };
    // Imune a físico: o golpe NUNCA treina a skill (v3, #686), então a skill de melee fica em 10
    // a hunt inteira e o teto de cada postura é um número, não uma faixa que anda.
    const immuneRat = { ...rat, mitigation: { resistances: {}, immunities: ['physical'] } };
    const comEspada: InventoryState = {
      backpack: [], equipped: { hand: { instanceId: 'w1', itemId: 'sword', quantity: 1 } },
    };
    const modes = ['attack', 'balanced', 'defense'] as const;
    type Mode = (typeof modes)[number];

    /** Roda 30 s com o herói na postura `mode`, gravando o que o resolver viu. */
    const play = (
      mode: Mode, loaded: Content, inventory: InventoryState | undefined, ms = 30_000,
    ) => {
      vi.mocked(resolveDamage).mockClear();
      const { session, hero } = start({
        loaded, difficulty: 'bold', health: 5_000,
        ...(inventory === undefined ? {} : { inventory }),
      });
      hero.setFightMode(mode);
      run(session, ms, 100);
      const calls = vi.mocked(resolveDamage).mock.calls;
      return {
        session, hero,
        swings: calls.filter(([intent]) => intent.source === 'basic-attack')
          .map(([intent, , , , , nowMs]) => ({ rawDamage: intent.rawDamage, nowMs: nowMs ?? 0 })),
        hits: calls.filter(([intent]) => intent.source === 'monster-attack')
          .map(([, defender, , , , nowMs]) => ({
            defense: defender.defense, mitigation: defender.defenseMitigation, nowMs: nowMs ?? 0,
          })),
        trace: traceOfCalls(),
      };
    };
    /**
     * Golpes do herói e golpes do monstro NA ORDEM em que o resolver os viu — a ordem de dois
     * eventos no mesmo ms é o que os empates da janela de ataque medem.
     */
    interface TraceEntry { readonly kind: 'swing' | 'hit'; readonly nowMs: number; readonly defense?: unknown }
    const traceOfCalls = (): TraceEntry[] => vi.mocked(resolveDamage).mock.calls
      .flatMap(([intent, defender, , , , nowMs]): TraceEntry[] => {
        if (intent.source === 'basic-attack') return [{ kind: 'swing', nowMs: nowMs ?? 0 }];
        if (intent.source === 'monster-attack') {
          return [{ kind: 'hit', nowMs: nowMs ?? 0, defense: defender.defense }];
        }
        return [];
      });
    const swingsOf = (mode: Mode, combatDef: object) => play(
      mode, defenseContent({ monsters: [immuneRat], combat: [combatDef as typeof combat] }), comEspada,
    ).swings.map((swing) => swing.rawDamage);

    it('o golpe: a postura escala o MÁXIMO da arma — 170 / 127 / 85 para a espada 200, skill 10', () => {
      // Espada 200, skill 10, level 1 (`⌊1/5⌋ = 0`): round(0,085 × fator × 200 × 10) =
      //   ofensivo 170 · balanceado round(127,5) = 128 · defensivo 85.
      const attack = swingsOf('attack', combatV3);
      const balanced = swingsOf('balanced', combatV3);
      const defensive = swingsOf('defense', combatV3);
      expect(attack.length).toBeGreaterThan(8);
      expect(Math.max(...attack)).toBeLessThanOrEqual(170);
      expect(Math.max(...balanced)).toBeLessThanOrEqual(128);
      expect(Math.max(...defensive)).toBeLessThanOrEqual(85);
      // E as três amostras EXERCITAM o teto: a ofensiva passa do que a defensiva pode dar, e a
      // balanceada passa do que a defensiva pode dar — um teto que ninguém alcança não prova
      // que a postura escalou.
      expect(Math.max(...attack)).toBeGreaterThan(85);
      expect(Math.max(...balanced)).toBeGreaterThan(85);
    });

    it('o combat-v2 IGNORA a postura: perfil publicado segue no 1,0 de antes (ADR 0031)', () => {
      const defensive = swingsOf('defense', combatV2);
      const offensive = swingsOf('attack', combatV2);
      expect(defensive.length).toBeGreaterThan(8);
      // Só o v3 lê o `fightMode`: sob v2 a postura não muda NADA — a mesma cena rende a mesma
      // sequência de golpes, um a um. Um teto fixo (170, a espada com skill 10) não serve aqui: a
      // skill treina durante os 30 s (10 → 18 nesta cena), e o máximo sobe com ela em qualquer
      // postura.
      expect(defensive).toEqual(offensive);
      expect(Math.max(...defensive)).toBeGreaterThan(85);
    });

    it('lastAttackAtMs é gravado a cada golpe de arma no combat-v3, e o v2 nem o guarda', () => {
      const v3 = play('attack', defenseContent({ monsters: [immuneRat], combat: [combatV3] }), comEspada);
      expect(v3.swings.length).toBeGreaterThan(8);
      expect(v3.hero.lastAttackAtMs).toBe(v3.swings.at(-1)?.nowMs);

      const v2 = play('attack', defenseContent({ monsters: [immuneRat], combat: [combatV2] }), comEspada);
      expect(v2.swings.length).toBeGreaterThan(8);
      expect(v2.hero.lastAttackAtMs).toBeNull();
      expect(v2.hero.getState()).not.toHaveProperty('lastAttackAtMs');
    });

    it('a defesa: batendo, ofensivo 0,5 e balanceado 0,75; o defensivo é 1,0 — e a mitigação é 0,8 / 1,0 / 1,2', () => {
      // Escudo 30 e shielding 10: (10/4 + 2,23) × 30 × 0,16 = 22,704 antes do fator:
      //   0,5 → 11,35 → 11 · 0,75 → 17,03 → 17 · 1,0 → 22,7 → 22 (o `trunc` do `int32_t` do Canary).
      // Só o PRIMEIRO golpe do monstro conta — depois dele o bloqueio treina a skill.
      const loaded = defenseContent({ combat: [combatV3] });
      const first = {} as Record<Mode, { defense: unknown; mitigation: number | undefined }>;
      for (const mode of modes) {
        const run1 = play(mode, loaded, comEscudo);
        const swings = run1.swings.map((swing) => swing.nowMs);
        const hit = run1.hits[0];
        expect(hit).toBeDefined();
        // Precondição: o herói JÁ estava batendo quando o primeiro golpe chegou (janela aberta).
        expect(swings.some((at) => hit!.nowMs - at >= 0 && hit!.nowMs - at < 2_000)).toBe(true);
        first[mode] = { defense: hit!.defense, mitigation: hit!.mitigation };
      }
      expect(first.attack.defense).toEqual({ kind: 'shield', defense: 11 });
      expect(first.balanced.defense).toEqual({ kind: 'shield', defense: 17 });
      expect(first.defense.defense).toEqual({ kind: 'shield', defense: 22 });
      // A mitigação percentual usa o `fightFactor` ESTÁTICO: ofensivo < balanceado < defensivo.
      expect(first.attack.mitigation).toBeLessThan(first.balanced.mitigation ?? 0);
      expect(first.balanced.mitigation).toBeLessThan(first.defense.mitigation ?? 0);
    });

    it('a defesa: PARADO (nunca bateu) a defesa é 1,0 em toda postura — o fator dinâmico do Canary', () => {
      // A wand sem mana não sai (`useWeapon` devolve `false` no Canary, e `updateLastAttack` só
      // roda no `true`): o herói apanha dos ratos sem NUNCA bater, `lastAttackAtMs` continua nulo,
      // o `(agora − lastAttack) < attackSpeed` é falso e o fator é 1,0 — até no ofensivo.
      const comVaraSemMana: InventoryState = {
        backpack: [],
        equipped: {
          hand: { instanceId: 'w1', itemId: 'wand', quantity: 1 },
          shield: { instanceId: 's1', itemId: 'shield', quantity: 1 },
        },
      };
      const loaded = defenseContent({ combat: [combatV3] });
      for (const mode of modes) {
        const idle = play(mode, loaded, comVaraSemMana, 10_000);
        expect(idle.swings).toHaveLength(0);
        expect(idle.hero.lastAttackAtMs).toBeNull();
        expect(idle.hits.length).toBeGreaterThan(0);
        expect(idle.hits[0]!.defense).toEqual({ kind: 'shield', defense: 22 });
      }
    });

    it('a postura e a janela de ataque atravessam o snapshot e a hunt retomada segue igual', () => {
      const loaded = defenseContent({ monsters: [immuneRat], combat: [combatV3] });
      const { session, hero } = start({
        loaded, difficulty: 'bold', health: 5_000, inventory: comEspada,
      });
      hero.setFightMode('balanced');
      run(session, 10_000, 100);
      expect(hero.lastAttackAtMs).not.toBeNull();

      const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
      const retomado = Session.fromSnapshot(
        snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed(snapshot.id),
      );
      const restored = retomado.participants[0];
      expect(restored?.fightMode).toBe('balanced');
      expect(restored?.lastAttackAtMs).toBe(hero.lastAttackAtMs);

      // Restore-invariance (invariante 3): continuar a original e a retomada dá o MESMO estado.
      run(session, 20_000, 100);
      run(retomado, 20_000, 100);
      expect(retomado.participants[0]?.getState()).toEqual(hero.getState());
    });

    it('1 Hz e 10 Hz dão o MESMO resultado com a postura balanceada e o fator de defesa dinâmico', () => {
      const at = (stepMs: number) => {
        const { session, hero } = start({
          loaded: defenseContent({ combat: [combatV3] }), difficulty: 'bold', health: 5_000,
          inventory: comEscudo,
        });
        hero.setFightMode('balanced');
        run(session, 60_000, stepMs);
        return {
          kills: session.aggregates.kills, health: hero.health, xp: hero.xp,
          lastAttackAtMs: hero.lastAttackAtMs, shielding: hero.skills.getState()['shielding'],
        };
      };
      const rapido = at(100);
      expect(at(1_000)).toEqual(rapido);
      // O cenário precisa ter EXERCITADO a defesa: o herói apanhou e treinou o escudo.
      expect(rapido.kills).toBeGreaterThan(0);
      expect(rapido.lastAttackAtMs).not.toBeNull();
      expect(rapido.shielding).toBeDefined();
    });

    describe('a janela de ataque no empate com o golpe do monstro e entre sessões (#550, revisão do PR #808)', () => {
      const espadaEEscudo: InventoryState = {
        backpack: [],
        equipped: {
          hand: { instanceId: 'w1', itemId: 'sword', quantity: 1 },
          shield: { instanceId: 's1', itemId: 'shield', quantity: 1 },
        },
      };
      // A skill de escudo que NUNCA sobe (o custo do próximo nível é astronômico): a defesa de
      // cada golpe é um número fixo — 22 cheia, 11 no ofensivo, 17 no balanceado —, e o teste lê a
      // janela, não o treino do bloqueio.
      const fixedShielding = { ...shielding, curve: { base: 1_000_000_000, factor: 1 } };
      const fixedContent = (monsters: readonly object[] = [immuneRat]) => defenseContent({
        monsters: monsters as RawContent['monsters'],
        skills: [...skills, fixedShielding], combat: [combatV3],
      });

      // Um corredor de um tile de largura: o herói fica PARADO na ponta (x=1) e o rato nasce a
      // oito tiles, com aggro para andar até ele — o único jeito de o monstro CHEGAR depois de o
      // herói já estar esperando (o spawn adjacente põe o herói na frente da fila).
      const corridorMap = { id: 'arena', z: 7, grid: ['#'.repeat(12), `#${'.'.repeat(10)}#`, '#'.repeat(12)] };
      const corridorRoute = {
        id: 'arena-loop', mapId: 'arena',
        // Vai até x=9 e volta por x=2: o laço fecha (o último tile é adjacente ao primeiro).
        tiles: [...Array.from({ length: 9 }, (_, i) => 1 + i), ...Array.from({ length: 7 }, (_, i) => 8 - i)]
          .map((x) => ({ x, y: 1, z: 7 })),
        spawnPoints: [{ routeIndex: 8, radius: 1, monsterId: 'rat', respawnDelayMs: 1_000_000 }],
      };
      /** O herói parado no corredor, o rato andando até ele: devolve o rastro dos golpes. */
      const walkIn = (mode: Mode, walker: object, ms: number) => {
        vi.mocked(resolveDamage).mockClear();
        const loaded = defenseContent({
          monsters: [walker as RawContent['monsters'][number]],
          skills: [...skills, fixedShielding], combat: [combatV3],
          maps: [corridorMap], routes: [corridorRoute],
        });
        const { session, hero } = start({ loaded, health: 50_000, inventory: espadaEEscudo });
        hero.setFightMode(mode);
        session.cancelEvent('player-step', hero.id);
        run(session, ms, 100);
        return traceOfCalls();
      };
      const walkingRat = { ...immuneRat, aggroRadius: 20 };
      type Trace = readonly TraceEntry[];
      /**
       * Lê do rastro o que o Canary daria a cada golpe recebido: `lastAttack` é o último golpe do
       * herói ANTES dele na ordem do resolver; a janela é aberta se ele foi há menos de 2 s, ou se
       * foi há exatamente 2 s e o golpe seguinte do herói cai neste mesmo ms — quem bate sem parar
       * nunca a fecha. `tie` marca o segundo caso, o que a comparação estrita fechava.
       */
      const readWindows = (trace: Trace) => {
        const out: { nowMs: number; defense: unknown; open: boolean; tie: boolean }[] = [];
        let last: number | null = null;
        trace.forEach((entry, index) => {
          if (entry.kind === 'swing') { last = entry.nowMs; return; }
          const elapsed = last === null ? Infinity : entry.nowMs - last;
          const swingDueNow = trace.slice(index + 1)
            .find((next) => next.kind === 'swing')?.nowMs === entry.nowMs;
          const tie = elapsed === 2_000 && swingDueNow;
          out.push({ nowMs: entry.nowMs, defense: entry.defense, open: elapsed < 2_000 || tie, tie });
        });
        return out;
      };
      const halved = { attack: 11, balanced: 17 } as const;

      it('quem bate sem parar segue com a janela ABERTA no empate: a ordem da fila não decide a defesa', () => {
        // O rato imune sobrevive a todo golpe, e o herói bate a cada 2 s sem parar. O rato que
        // ANDOU até ele arma o golpe dele antes de o herói armar o próprio (`#onMonsterStep` arma
        // as abilities antes do `#armPlayerAttack`), e as duas cadências de 2 s nascem no mesmo
        // instante: dali em diante o golpe do monstro sai da fila ANTES do golpe do herói, no
        // MESMO ms, todo ciclo. O Canary nunca fecha a janela de quem bate sem parar (o golpe
        // seguinte corre `attackSpeed` MAIS a latência do despachante).
        for (const mode of ['attack', 'balanced'] as const) {
          const windows = readWindows(walkIn(mode, walkingRat, 30_000));
          // Precondição: o cenário EXERCITA o empate (sem ele o teste passaria vazio).
          expect(windows.filter((hit) => hit.tie).length, `${mode}: golpes no empate`).toBeGreaterThan(3);
          for (const hit of windows) {
            expect(hit.defense, `${mode} @${hit.nowMs}`).toEqual({
              kind: 'shield', defense: hit.open ? halved[mode] : 22,
            });
          }
          // O PRIMEIRO golpe do monstro chega antes de o herói bater: defesa cheia, sem carimbo.
          expect(windows[0]?.defense).toEqual({ kind: 'shield', defense: 22 });
        }
      });

      it('o carimbo de uma hunt NÃO atravessa para a seguinte: o mesmo herói, sessão nova, defesa cheia', () => {
        // O `CharacterRuntime` é o MESMO objeto na transição (`createSessionBuilder`), e o relógio
        // da sessão nova nasce em zero. Um carimbo de ~30 000 ms da primeira ficaria no futuro da
        // segunda e a defesa seria pela metade enquanto o herói não bate — que aqui nunca (sem
        // mana a vara não sai).
        const comVara: InventoryState = {
          backpack: [],
          equipped: {
            hand: { instanceId: 'w1', itemId: 'wand', quantity: 1 },
            shield: { instanceId: 's1', itemId: 'shield', quantity: 1 },
          },
        };
        const loaded = fixedContent([rat]);
        const first = start({ loaded, difficulty: 'bold', health: 50_000, inventory: comVara });
        // Mana de sobra na primeira hunt: a vara BATE, e o carimbo é gravado.
        first.hero.maxMana = 100_000;
        first.hero.mana = 100_000;
        run(first.session, 30_000, 100);
        const stamp = first.hero.lastAttackAtMs;
        expect(stamp).not.toBeNull();
        expect(stamp).toBeGreaterThan(20_000);

        // Transição: sai da primeira e entra numa sessão NOVA, com o mesmo objeto.
        first.session.leave('hero');
        const second = createHuntSession({
          id: 'session-2', content: loaded, huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
        });
        // Sem mana: a vara não bate na segunda hunt, então o carimbo só pode vir da primeira.
        first.hero.maxMana = 0;
        first.hero.mana = 0;
        vi.mocked(resolveDamage).mockClear();
        second.enter(first.hero);
        expect(second.nowMs).toBe(0);
        expect(first.hero.lastAttackAtMs).toBeNull();

        run(second, 10_000, 100);
        const hits = vi.mocked(resolveDamage).mock.calls
          .filter(([intent]) => intent.source === 'monster-attack');
        expect(hits.length).toBeGreaterThan(0);
        expect(vi.mocked(resolveDamage).mock.calls.some(([intent]) => intent.source === 'basic-attack'))
          .toBe(false);
        for (const [, defender] of hits) {
          expect(defender.defense).toEqual({ kind: 'shield', defense: 22 });
        }
        expect(first.hero.lastAttackAtMs).toBeNull();
      });

      it('a entrada recusada (party cheia) não apaga a janela de quem continua na sessão de origem', () => {
        const loaded = fixedContent([immuneRat]);
        const origin = start({ loaded, difficulty: 'bold', health: 50_000, inventory: espadaEEscudo });
        run(origin.session, 10_000, 100);
        const stamp = origin.hero.lastAttackAtMs;
        expect(stamp).not.toBeNull();

        // A party de teste é de 4: lota a sessão de destino e tenta entrar com o herói.
        const full = createHuntSession({
          id: 'session-full', content: loaded, huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
          partyOptions: { leaderId: 'member-0', mode: 'split' },
        });
        for (let i = 0; i < 4; i += 1) {
          full.enter(new CharacterRuntime({ ...character().getState(), id: `member-${i}` }));
        }
        expect(() => full.enter(origin.hero)).toThrow(PartyFullError);
        expect(origin.hero.lastAttackAtMs).toBe(stamp);
      });
    });
  });
});

describe('Bestiário: abates por monstro, marcos e bônus de XP (FUN-113)', () => {
  // Marcos curtos e bônus alto de propósito: com [3, 5] e 20 % dá para contar os abates na mão,
  // e um rato de 5 XP passa a render 6 no primeiro marco e 7 no segundo — números que se
  // conferem a olho. Com o 1 % do conteúdo real, `floor(5 × 1,01)` continua 5 e o teste não
  // distinguiria bônus de nada.
  const bestiary = { id: 'baseline', milestones: [3, 5], xpBonusPercentPerMilestone: 20 };
  // `routes: [threeRatsRoute]` — estes testes entram com `difficulty: 'bold'` via `loaded`
  // explícito, que não pega a densidade de "bold" sozinho (#583).
  const withBestiary = () => content({ bestiary: [bestiary], routes: [threeRatsRoute] });

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
    // Fartura DELIBERADA (ver o comentário em `manyRatsRoute`): o teto de disponibilidade não
    // pode empatar os dois lados no lugar da velocidade de abate.
    const fartura = content({ routes: [manyRatsRoute] });
    const desarmado = start({ difficulty: 'bold', loaded: fartura });
    run(desarmado.session, 120_000, 100);

    const armado = start({ difficulty: 'bold', loaded: fartura, inventory: comEspada });
    run(armado.session, 120_000, 100);

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
    capacity?: number; staminaMs?: number; catalog?: boolean; loot?: BotConfigV2['loot'];
  } = {}) => {
    const loaded = buildContent(raw({
      // `corpseTtlMs` (ADR 0048; #585 — o campo é do monstro, não da hunt): sem ele o cadáver
      // não persiste, e o que não coube na mochila simplesmente desaparece em vez de ficar à
      // espera — estes testes falam justamente do que sobra, então precisam de onde ele possa
      // ficar.
      monsters: [{ ...ratWithDrop, corpseTtlMs: 60_000 }],
      progression: [{
        ...progression, startingCapacity: over.capacity ?? 10_000, capacityPerLevel: 0,
      }],
    }));
    const session = createHuntSession({
      // Conteúdo com o catálogo VAZIO simula o que muda debaixo de uma sessão em voo: a
      // espada existia quando a hunt abriu e não existe mais.
      content: over.catalog === false ? { ...loaded, items: new Map() } : loaded,
      id: 'drop', huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      // O filtro de Quick Loot (#722, ADR 0048 d.4) — só quando o teste pede um diferente do
      // default (`skip` + vazio, pega tudo).
      ...(over.loot === undefined ? {} : { botConfigs: { hero: botConfigV2([], { loot: over.loot }) } }),
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

  it('o que NÃO cabe fica no CADÁVER (ADR 0048)', () => {
    // Capacidade para uma espada só (peso 50). A segunda não cabe e não se perde: fica no
    // cadáver, que é a decisão 7 do ADR 0048 em uma linha — a Caixa de Loot saiu.
    const { session, hero, ruleset } = comDrop({ capacity: 50 });
    run(session, 60_000, 100);

    expect([...hero.inventory.items()]).toHaveLength(1);
    const noCadaver = ruleset.groundItems.flatMap((corpse) => corpse.items ?? []);
    expect(noCadaver.length).toBeGreaterThan(0);
    // E os ids continuam únicos entre a mochila e os cadáveres: o contador é um só.
    const todos = [...hero.inventory.items(), ...noCadaver].map((i) => i.instanceId);
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
    // E não queimou identidade: o contador não avança por um item que não vai existir.
    expect(hero.lootSeq).toBe(0);
  });

  it('o cadáver e o contador atravessam o snapshot', () => {
    const { session, hero, ruleset } = comDrop({ capacity: 50 });
    run(session, 60_000, 100);
    const antes = {
      noCadaver: ruleset.groundItems.reduce((n, corpse) => n + (corpse.items?.length ?? 0), 0),
      seq: hero.lootSeq,
    };
    expect(antes.noCadaver).toBeGreaterThan(0);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(
        snapshot, buildContent(raw({ monsters: [{ ...ratWithDrop, corpseTtlMs: 60_000 }] })),
      ) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    const voltou = retomado.participants[0] as CharacterRuntime;
    const depois = (retomado.ruleset as HuntRuleset).groundItems
      .reduce((n, corpse) => n + (corpse.items?.length ?? 0), 0);
    expect(depois).toBe(antes.noCadaver);
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
      };
    };
    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    expect(rapido.mochila.length).toBeGreaterThan(0);
  });

  describe('abrir o cadáver e pegar o que sobrou (#722, ADR 0048 decisão 4)', () => {
    it('openCorpse devolve o que sobrou, para quem é dono e está perto', () => {
      const { session, hero, ruleset } = comDrop({ capacity: 50 });
      run(session, 60_000, 100);
      const corpse = ruleset.groundItems.find((c) => (c.items?.length ?? 0) > 0);
      expect(corpse).toBeDefined();
      // A rota anda o herói para longe de onde o rato morreu — aproxima para o teste falar só
      // da elegibilidade, não da distância (que já tem teste próprio, abaixo).
      hero.position = { ...corpse!.position };

      const result = ruleset.openCorpse(session, hero.id, corpse!.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.corpse.id).toBe(corpse!.id);
        expect(result.corpse.items?.length).toBeGreaterThan(0);
      }
    });

    it('openCorpse recusa not-found para um id que não existe (já apodreceu)', () => {
      const { session, hero, ruleset } = comDrop({ capacity: 50 });
      run(session, 60_000, 100);
      const result = ruleset.openCorpse(session, hero.id, 999_999);
      expect(result).toEqual({ ok: false, reason: 'not-found' });
    });

    it('openCorpse recusa not-yours para quem não é dono nem elegível', () => {
      const { session, hero, ruleset } = comDrop({ capacity: 50 });
      run(session, 60_000, 100);
      const corpse = ruleset.groundItems.find((c) => (c.items?.length ?? 0) > 0)!;
      const result = ruleset.openCorpse(session, 'someone-else', corpse.id);
      expect(result).toEqual({ ok: false, reason: 'not-yours' });
    });

    it('openCorpse recusa too-far-away quando o personagem está longe', () => {
      const { session, hero, ruleset } = comDrop({ capacity: 50 });
      run(session, 60_000, 100);
      const corpse = ruleset.groundItems.find((c) => (c.items?.length ?? 0) > 0)!;
      hero.position = { x: hero.position.x + 10, y: hero.position.y, z: hero.position.z };
      const result = ruleset.openCorpse(session, hero.id, corpse.id);
      expect(result).toEqual({ ok: false, reason: 'too-far-away' });
    });

    it('takeLoot(null) reaplica o filtro do personagem ao que sobrou no cadáver', () => {
      const { session, hero, ruleset } = comDrop({ capacity: 50 });
      run(session, 60_000, 100);
      const corpse = ruleset.groundItems.find((c) => (c.items?.length ?? 0) > 0)!;
      const antes = [...hero.inventory.items()].length;
      // Abre capacidade para o item que sobrou entrar desta vez, e aproxima do cadáver.
      hero.capacity = 10_000;
      hero.position = { ...corpse.position };

      const result = ruleset.takeLoot(session, hero.id, corpse.id, null);
      expect(result).toEqual({ ok: true });
      expect([...hero.inventory.items()].length).toBeGreaterThan(antes);
      expect(corpse.items ?? []).toEqual([]);
    });

    it('takeLoot(instanceId) ignora o filtro e move só aquele item', () => {
      const { session, hero, ruleset } = comDrop({
        capacity: 50, loot: { filter: 'skip', itemIds: ['sword'], autoSell: [] },
      });
      run(session, 60_000, 100);
      const corpse = ruleset.groundItems.find((c) => (c.items?.length ?? 0) > 0)!;
      const leftover = corpse.items![0]!;
      hero.capacity = 10_000;
      hero.position = { ...corpse.position };

      const result = ruleset.takeLoot(session, hero.id, corpse.id, leftover.instanceId);
      expect(result).toEqual({ ok: true });
      expect([...hero.inventory.items()].some((i) => i.instanceId === leftover.instanceId)).toBe(true);
      expect(corpse.items ?? []).not.toContainEqual(leftover);
    });

    it('takeLoot recusa not-enough-capacity sem mutar o cadáver', () => {
      const { session, hero, ruleset } = comDrop({ capacity: 50 });
      run(session, 60_000, 100);
      const corpse = ruleset.groundItems.find((c) => (c.items?.length ?? 0) > 0)!;
      const before = [...(corpse.items ?? [])];
      hero.position = { ...corpse.position };

      const result = ruleset.takeLoot(session, hero.id, corpse.id, before[0]!.instanceId);
      expect(result).toEqual({ ok: false, reason: 'not-enough-capacity' });
      expect(corpse.items ?? []).toEqual(before);
    });
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
      // `corpseTtlMs` (ADR 0048; #585 — o campo é do monstro, não da hunt): o teste de
      // excedente por peso precisa de onde o item que não coube possa ficar — sem cadáver,
      // ele desapareceria em vez de esperar.
      monsters: [{ ...ratWithDrop, corpseTtlMs: 60_000 }],
      items: [...items, backpackItem],
      routes: [threeRatsRoute],
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
    return { session, hero, ruleset: session.ruleset as HuntRuleset };
  };

  it('nasce com 20 lugares, e o 21º drop abre uma linha, enquanto o PESO cabe', () => {
    // Mutação que mata: `#deliverLoot` recusar por lugar, ou `ensureContainers` não rodar na entrada.
    const { session, hero } = withBackpack(100_000);
    expect(hero.inventory.backpack).toHaveLength(20);
    expect(hero.inventory.satchel).toHaveLength(10);
    run(session, 240_000, 100);
    const looted = [...hero.inventory.items()].length;
    expect(looted).toBeGreaterThan(20);
    expect(hero.inventory.backpack.length).toBe(20 + 5 * Math.ceil((looted - 20) / 5));
    // Tudo na mochila, nada na bolsa: o loot cai na mochila enquanto ela está nas costas.
    expect(hero.inventory.satchel.every((p) => p === null)).toBe(true);
  });

  it('com capacidade curta, o excedente fica no CADÁVER — por peso, com lugar sobrando', () => {
    const { session, hero, ruleset } = withBackpack(18 + 50 * 3);
    run(session, 120_000, 100);
    expect([...hero.inventory.items()]).toHaveLength(3);
    expect(hero.inventory.backpack).toHaveLength(20);
    const noCadaver = ruleset.groundItems.flatMap((corpse) => corpse.items ?? []);
    expect(noCadaver.length).toBeGreaterThan(0);
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

  it('o item SÓ conta no analisador quando entra na mochila (ADR 0048 decisão 5)', () => {
    // Antes deste ADR, "caiu" já contava — mochila cheia não fazia a hunt parecer ruim. Desde
    // o ADR 0048, o que fica no cadáver não é loot "levado" ainda: `itemsLooted` conta só o que
    // ENTROU na mochila ou foi vendido, e o resto — filtrado ou sem capacidade — não soma.
    const loaded = buildContent(raw({
      monsters: [{ ...ratWithDrop, corpseTtlMs: 60_000 }],
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

    const ruleset = session.ruleset as HuntRuleset;
    const noCadaver = ruleset.groundItems.flatMap((corpse) => corpse.items ?? []);
    expect(noCadaver.length).toBeGreaterThan(0);
    // Menos abates do que a mochila comporta: sobrou item no cadáver, e ele não conta.
    expect(session.aggregates.itemsLooted).toBeLessThan(session.aggregates.kills);
    expect(session.aggregates.itemsLooted).toBe([...hero.inventory.items()].length);
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
};

/** O anel com o perseguidor imortal no único ponto — o cenário `cautious` de sempre. */
const anelChaser = {
  ...anel, spawnPoints: [{ routeIndex: 10, radius: 1, monsterId: 'chaser', respawnDelayMs: 600_000 }],
};
/**
 * Três ratos que MORREM, e sem respawn dentro do teste (#583: um ponto por rato, em vez do
 * `monsterCount: 3` de uma dificuldade só): é o cenário em que a contagem cai sozinha, e é o
 * único jeito de exercitar o lado do `min` da máquina.
 */
const anelThreeRats = {
  ...anel,
  spawnPoints: [
    { routeIndex: 10, radius: 1, monsterId: 'rat', respawnDelayMs: 600_000 },
    { routeIndex: 4, radius: 1, monsterId: 'rat', respawnDelayMs: 600_000 },
    { routeIndex: 14, radius: 1, monsterId: 'rat', respawnDelayMs: 600_000 },
  ],
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
      maps: [map, salaGrande], routes: [route, difficulty === 'bold' ? anelThreeRats : anelChaser],
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
      maps: [map, salaGrande], routes: [route, anelChaser],
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
        id: 'lure-hz', content: content({ routes: [threeRatsRoute] }), huntId: 'arena', difficulty: 'bold',
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
  // `blockable: true`: o teste espera o monstro já vivo desde o primeiro segundo (#583) — sem
  // isto ele seria não bloqueável e sobraria com o telegraph de 4200 ms antes de existir.
  blockable: true,
};

describe('ring swap com histerese (FUN-87, §13.8)', () => {
  // Mil de vida e duzentos de mana: percentual vira conta de cabeça, e 390 é 39%.
  const anelProgression = {
    ...progression, startingHealth: 1_000, startingMana: 200, startingCapacity: 1_000,
    healthPerLevel: 0, manaPerLevel: 0, capacityPerLevel: 0,
    regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
  } as Progression;

  const anelContent = (): Content => buildContent(raw({
    monsters: [relogio],
    hunts: [hunt],
    // Spawn colado no começo da rota: o poste encosta no primeiro segundo e o herói para ali.
    routes: [{ ...route, spawnPoints: [{ routeIndex: 0, radius: 1, monsterId: 'clock', respawnDelayMs: 30_000 }] }],
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
    regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
  } as Progression;

  const ringCombatContent = (): Content => buildContent(raw({
    monsters: [brawler],
    hunts: [hunt],
    routes: [{ ...route, spawnPoints: [{ routeIndex: 0, radius: 1, monsterId: 'brawler', respawnDelayMs: 30_000 }] }],
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
    // (A mana não é conferida: subir de level ENCHE a mana desde #678 — `grantXp` —, e o
    // abate da onda sobe de level. Os lançamentos acima já provam que ela saiu.)
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

// --- a exaustão de ação compartilhada entre poção e runa (#690) --------------------------------

describe('poção e runa dividem UM relógio de exaustão de ação (#690, `nextPotionAction` do Canary)', () => {
  const attackRune = (exhaust: boolean) => ({
    id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, group: 'attack', groupCooldownMs: 2_000,
    ...(exhaust ? { actionExhaustMs: 1_000 } : {}),
    requires: { level: 30, magicLevel: 0 },
    effect: { kind: 'damage', basePower: 400, range: 4, area: { shape: 'circle', radius: 3, centered: 'target' } },
  });
  // O grupo da poção a 1500 ms, e não 1000, é o que deixa a runa ENTRAR: com a regra "sempre" e
  // o grupo igual à exaustão, a poção vence todo empate no vencimento (a fila é FIFO) e a runa
  // espera para sempre — o mesmo que um jogador que aperta a poção a cada segundo no Canary.
  const potion = (exhaust: boolean) => ({
    id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion', groupCooldownMs: 1_500,
    ...(exhaust ? { actionExhaustMs: 1_000 } : {}),
    effect: { kind: 'heal', amount: 80 },
  });

  /** Os instantes lógicos de cada uso, a passo de 1 ms: a espera é conferida ao milissegundo. */
  const uses = (exhaust: boolean) => {
    const { session, hero } = withSpells(botConfig({
      potion: [supplyRule('health-potion')],
      rune: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'supply', supplyId: 'avalanche-rune' } }],
    }), { gold: 100_000, supplies: [potion(exhaust), attackRune(exhaust)], health: 5_000 }, 'bold');
    hero.level = 30;
    hero.xp = totalXpForLevel(30, progression as Progression);
    const out: { at: number; supplyId: string }[] = [];
    // O que vence no instante 0 (o bot armado na entrada) sai no primeiro passo: o instante do
    // uso é o INÍCIO do passo nesse caso, e o fim dele em todos os outros.
    let first = true;
    for (let t = 0; t < 15_000 && session.ended === null; t += 1) {
      session.advanceBy(1);
      for (const event of session.drainEvents()) {
        if (event.kind === 'supply-used') out.push({ at: first ? 0 : session.nowMs, supplyId: event.supplyId });
      }
      first = false;
    }
    return out;
  };

  it('a poção depois de uma runa de ataque só sai 1000 ms depois dela, e vice-versa', () => {
    const timeline = uses(true);
    // Os dois tipos saíram — sem isso, a asserção de espaçamento passaria com um só.
    const runes = timeline.filter((use) => use.supplyId === 'avalanche-rune');
    expect(runes.length).toBeGreaterThan(0);
    expect(timeline.some((use) => use.supplyId === 'health-potion')).toBe(true);
    // Um relógio só: NENHUM par de usos consecutivos, poção ou runa, a menos de 1000 ms.
    for (let i = 1; i < timeline.length; i += 1) {
      const gap = (timeline[i]?.at ?? 0) - (timeline[i - 1]?.at ?? 0);
      expect(gap, JSON.stringify(timeline.slice(i - 1, i + 1))).toBeGreaterThanOrEqual(1_000);
    }
    // A primeira poção depois de uma runa sai EXATAMENTE no vencimento: adiada, não perdida.
    const firstRune = runes[0]?.at ?? 0;
    const next = timeline.find((use) => use.at > firstRune);
    expect(next?.at).toBe(firstRune + 1_000);
    // A runa continua com o cooldown do PRÓPRIO grupo: 2000 ms entre duas runas.
    for (let i = 1; i < runes.length; i += 1) {
      expect((runes[i]?.at ?? 0) - (runes[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(2_000);
    }
  });

  it('supply sem `actionExhaustMs` não espera: os livros continuam independentes (fixture)', () => {
    const timeline = uses(false);
    const firstRune = timeline.find((use) => use.supplyId === 'avalanche-rune')?.at;
    expect(firstRune).toBeDefined();
    // A poção bebe a cada 1000 ms desde t=0, sem desviar da runa: algum par fica a menos de 1 s.
    const close = timeline.some((use, i) => i > 0 && use.at - (timeline[i - 1]?.at ?? 0) < 1_000);
    expect(close).toBe(true);
  });
});

// --- use-item / use-item-on: o mesmo caminho do slot, sem passar pela barra (#726, ADR 0049) --

describe('useItem/useItemOn (#726, ADR 0049 decisão 3)', () => {
  const healthPotion = {
    id: 'health-potion-726', name: 'Poção de Vida', price: 45, group: 'potion', groupCooldownMs: 1_500,
    effect: { kind: 'heal' as const, amount: 80 },
  };
  const foodItem = {
    id: 'cheese-726', name: 'Cheese', kind: 'consumable' as const, weight: 4, value: 0,
    stackable: true, effect: { kind: 'food' as const, durationMs: 108_000 },
  };
  const swordItem = { id: 'sword-726', name: 'Sword', kind: 'weapon' as const, slot: 'hand' as const, weight: 10, value: 0, attack: 5 };

  it('use-item com ref.supplyId gasta o ESTOQUE antes do gold, como o slot (RF-01)', () => {
    const { session, hero, ruleset } = withSpells(
      botConfig({}), { gold: 1_000, supplies: [healthPotion], health: 500, monsters: false },
    );
    hero.health = 400;
    hero.supplyStock.set('health-potion-726', 3);
    const outcome = ruleset.useItem(session, 'hero', { supplyId: 'health-potion-726' }, 1);
    expect(outcome).toEqual({ ok: true });
    expect(hero.health).toBe(480);
    expect(hero.supplyStock.get('health-potion-726')).toBe(2);
    expect(hero.goldDelta).toBe(0); // pagou do estoque, não do gold
  });

  it('use-item com ref.instanceId de COMIDA soma fedMs e consome uma unidade da pilha (RF-02)', () => {
    const { session, hero, ruleset } = withSpells(botConfig({}), {
      items: [foodItem], monsters: false,
      inventory: {
        backpack: [{ instanceId: 'i1', itemId: 'cheese-726', quantity: 3 }],
        satchel: [], equipped: {},
      },
    });
    const outcome = ruleset.useItem(session, 'hero', { instanceId: 'i1' }, 1);
    expect(outcome).toEqual({ ok: true });
    expect(hero.fedMs).toBe(108_000);
    expect(hero.inventory.backpack.find((it) => it?.instanceId === 'i1')?.quantity).toBe(2);
  });

  it('comer no teto de fedMs recusa `you-are-full` SEM consumir o item', () => {
    const { session, hero, ruleset } = withSpells(botConfig({}), {
      items: [foodItem], monsters: false,
      inventory: {
        backpack: [{ instanceId: 'i1', itemId: 'cheese-726', quantity: 1 }],
        satchel: [], equipped: {},
      },
    });
    hero.fedMs = 1_200_000 - 1000;
    const outcome = ruleset.useItem(session, 'hero', { instanceId: 'i1' }, 1);
    expect(outcome).toEqual({ ok: false, reason: 'you-are-full', retryInMs: 0 });
    expect(hero.inventory.backpack.find((it) => it?.instanceId === 'i1')?.quantity).toBe(1);
  });

  it('instância desconhecida recusa `not-carried`; item não-consumível recusa `not-usable`', () => {
    const { session, ruleset } = withSpells(botConfig({}), { items: [swordItem], monsters: false });
    expect(ruleset.useItem(session, 'hero', { instanceId: 'nope' }, 1))
      .toEqual({ ok: false, reason: 'not-carried', retryInMs: 0 });

    const { session: s2, ruleset: r2 } = withSpells(botConfig({}), {
      items: [swordItem], monsters: false,
      inventory: { backpack: [{ instanceId: 's1', itemId: 'sword-726', quantity: 1 }], satchel: [], equipped: {} },
    });
    expect(r2.useItem(s2, 'hero', { instanceId: 's1' }, 1))
      .toEqual({ ok: false, reason: 'not-usable', retryInMs: 0 });
  });

  it('a exaustão de ação ADIA o use-item, e um segundo clique SUBSTITUI o primeiro (RF-04)', () => {
    const withExhaust = {
      ...healthPotion, actionExhaustMs: 1_000,
    };
    const { session, hero, ruleset } = withSpells(
      botConfig({}), { gold: 1_000, supplies: [withExhaust], health: 500, monsters: false },
    );
    hero.health = 100;
    // Já travado por um uso anterior (simulando o clique de uma runa/poção momentos antes).
    hero.cooldowns.start('exhaust:action', session.nowMs, 1_000);

    const first = ruleset.useItem(session, 'hero', { supplyId: 'health-potion-726' }, 1);
    expect(first).toEqual({ ok: true }); // aceito, mas ADIADO — não executou ainda.
    expect(hero.health).toBe(100);
    expect(hero.pendingManualAction).not.toBeNull();

    // Um segundo clique ANTES do vencimento substitui o primeiro (seq 2, não 1).
    const second = ruleset.useItem(session, 'hero', { supplyId: 'health-potion-726' }, 2);
    expect(second).toEqual({ ok: true });
    expect(hero.pendingManualAction?.seq).toBe(2);

    session.advanceBy(1_000);
    expect(hero.health).toBe(180); // o adiado (seq 2) executou de verdade no vencimento.
  });

  it('cooldown de GRUPO/individual da runa/poção continua recusa IMEDIATA (RF-05)', () => {
    const { session, hero, ruleset } = withSpells(
      botConfig({}), { gold: 1_000, supplies: [healthPotion], health: 500, monsters: false },
    );
    hero.cooldowns.start('group:potion', session.nowMs, 5_000);
    const outcome = ruleset.useItem(session, 'hero', { supplyId: 'health-potion-726' }, 1);
    expect(outcome).toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 5_000 });
  });

  it('use-item-on mira o alvo explícito, como o use-slot (reaproveita #resolveManualTarget)', () => {
    const attackRuneOn = {
      id: 'attack-rune-726', name: 'Rune', price: 10, group: 'attack', groupCooldownMs: 2_000,
      requires: {},
      effect: {
        kind: 'damage' as const, basePower: 100, range: 4,
        area: { shape: 'circle' as const, radius: 1, centered: 'target' as const },
      },
    };
    const { session, hero, ruleset } = withSpells(
      botConfig({}), { gold: 1_000, supplies: [attackRuneOn], mana: 200 },
    );
    session.advanceBy(1);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    const target = { kind: 'monster' as const, subject: monsterSubject(monster.id) };
    const before = monster.health;
    const outcome = ruleset.useItemOn(session, 'hero', { supplyId: 'attack-rune-726' }, 1, target);
    expect(outcome).toEqual({ ok: true });
    expect(monster.health).toBeLessThan(before);
    void hero;
  });

  it('regeneração exige `fedMs > 0` só quando `progression.regeneration.requiresFood` está ligada (RF-03)', () => {
    const loaded = buildContent(raw({
      progression: [{
        ...progression, startingMana: 0,
        regen: { health: { ticksMs: 1_000, amount: 5 }, mana: { ticksMs: 1_000, amount: 0 } },
        regeneration: { requiresFood: true },
      }],
      routes: [{ ...route, spawnPoints: [] }],
    }));
    const session = createHuntSession({
      id: 'food-regen', content: loaded, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0, botConfig: botConfig({}),
    });
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 }, health: 100, maxHealth: 1_000, mana: 0, maxMana: 0,
      level: 1, xp: 0, vocationId: null, gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);
    session.advanceBy(1_000);
    // Sem comida, o pulso não repõe nada — mesmo com `amount: 5` declarado no conteúdo.
    expect(hero.health).toBe(100);
    hero.fedMs = 60_000;
    session.advanceBy(1_000);
    expect(hero.health).toBe(105);
  });
});

describe('o ML especializado do item vestido soma na runa do MESMO elemento (#680)', () => {
  // Coeficiente enorme e sem termo de level: o sorteio da runa é `integer(1000×ML', 1000×ML')`,
  // e ML' = ML (0 no herói) + o especializado de fogo. Com fire +2 a faixa vira [2000, 2000].
  const fireRune = {
    id: 'fire-test-rune', name: 'Fire Test Rune', price: 1, group: 'attack',
    requires: { level: 1 },
    effect: {
      kind: 'damage', basePower: 1, range: 6, damageType: 'fire',
      formula: { levelFactor: 0, skillMin: 1000, skillMax: 1000, baseMin: 0, baseMax: 0 },
    },
  };
  const fireHat = {
    id: 'fire-hat', name: 'Fire Hat', kind: 'armor', slot: 'head', weight: 1, value: 0,
    bonuses: { specializedMagicLevel: { fire: 2 } },
  };
  const rolls = (equipped: boolean): number[][] => {
    const spy = vi.spyOn(Rng.prototype, 'integer');
    try {
      const { session } = withSpells(botConfig({
        rune: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'supply', supplyId: 'fire-test-rune' } }],
      }), {
        gold: 10_000, health: 5_000, supplies: [...supplies, fireRune], items: [...items, fireHat],
        ...(equipped
          ? { inventory: { backpack: [], equipped: { head: { instanceId: 'h1', itemId: 'fire-hat', quantity: 1 } } } }
          : {}),
      }, 'bold');
      run(session, 20_000, 100);
      expect(session.aggregates.suppliesUsed).toBeGreaterThan(0);
      return spy.mock.calls.map((call) => [...call]);
    } finally {
      spy.mockRestore();
    }
  };

  it('o ruleset passa o campo: a faixa da runa de fogo sai com ML + 2', () => {
    // Mutação que mata: `#runeScaling` sem `specializedMagicLevel` — a faixa ficaria [1, 1].
    const withHat = rolls(true);
    const bare = rolls(false);
    expect(withHat).toContainEqual([2_000, 2_000]);
    // Sem o item, o ML 0 do herói: `max(1, 0)` = 1 — e nunca a faixa do especializado.
    expect(bare).toContainEqual([1, 1]);
    expect(bare).not.toContainEqual([2_000, 2_000]);
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
      id: 'party-session', content: content({ routes: [threeRatsRoute] }), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
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
      snapshot,
      huntRulesetFromSnapshot(snapshot, content({ routes: [threeRatsRoute] })) as HuntRuleset,
      Rng.fromSeed('x'),
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
    progression: [{ ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
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
  const loaded = () => content({ monsters: [fat], vocations, routes: [threeRatsRoute] });
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
  // `routes: [threeRatsRoute]` — a hunt entra com `difficulty: 'bold'` via `loaded()` explícito,
  // que não pega a densidade de "bold" sozinho (#583).
  const loaded = () => content({ monsters: [lucky], routes: [threeRatsRoute] });
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
    // `routes: [threeRatsRoute]` — a hunt entra com `difficulty: 'bold'`, que não pega a
    // densidade sozinho (#583); os testes que precisam de um ponto só sobrescrevem `routes`.
    routes: [threeRatsRoute],
    progression: [{ ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
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
    // O líder NÃO recebe o excedente: "coletar com outro destinatário" é coletar (DT-01).
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
  });

  it('#settle FORÇA a entrada do item que não vende mesmo sem capacidade nenhuma (ADR 0048 d.7)', () => {
    // Sem a Caixa de Loot da Sessão, o item que não se vende (`value: 0`) e não cabe nem com a
    // reserva liberada não tem mais para onde ir: `forceAdd` o põe na mochila do líder de
    // qualquer jeito — nunca se perde, e a escolha de vender/descartar depois é do jogador.
    const relic = { id: 'relic', name: 'Relic', kind: 'other', weight: 31, value: 0 };
    const withRelic = loaded({ items: [...items, sword, cheese, relic] });
    const { session } = shared([member('lead', 0, 1), member('b', 0, 1_000)], { content: withRelic });
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    // Capacidade 1: o queijo (peso 4) já estourava sozinho, e o relic (peso 31) mais ainda.
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
      snapshot, huntRulesetFromSnapshot(snapshot, withRelic) as HuntRuleset, Rng.fromSeed('force-add'),
    );
    const leader = restored.participants.find((p) => p.id === 'lead');
    if (leader === undefined) throw new Error('sem lead');
    restored.leave('b', 'manual-exit');
    expect([...leader.inventory.items()].map((i) => i.itemId)).toContain('relic');
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
    progression: [{ ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
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
    progression: [{ ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
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
      progression: [{ ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
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

  it('a penalidade de morte lê as bênçãos (#570) do morto: perde menos XP, e a morte as consome', () => {
    const killer = { ...rat, health: 1_000_000, attack: 50, attackRange: 1, experience: 0 };
    const deadly = content({ monsters: [killer] });
    const stats = statsForLevel(10, null, progression as Progression);
    const startXp = totalXpForLevel(10, progression as Progression);
    const dying = (id: string, blessings?: number) => new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health: 1, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 10, xp: startXp, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
      ...(blessings === undefined ? {} : { blessings }),
    });
    // Uma bênção só: `blessingReduction` deste conteúdo de teste (0.56, o mesmo valor que o
    // antigo binário `premium` usava por inteiro) × 1 bênção reproduz os mesmos 56% de antes.
    const blessed = dying('blessed', 1);
    const { session } = make([blessed, dying('free'), member('survivor', { health: 100_000 })], {
      content: deadly,
      partyOptions: {
        leaderId: 'blessed',
        settings: { shareCosts: false, splitLoot: false, collect: null, autoSell: [] },
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
    // fração de `xpToCompleteLevel`). Quem tem bênção tem a redução TETADA em 50% neste ramo
    // (Canary `Player::getLostPercent`, `level < 24`) — `blessingReduction` × 1 (56%) é ≥ 40%,
    // então o teto entra, não o valor bruto.
    const { flatFraction, blessingReduction } = (progression as Progression).deathPenalty;
    expect(blessingReduction).toBeGreaterThanOrEqual(0.40);
    expect(xpOf('blessed')).toBe(-Math.round(flatFraction * startXp * (1 - 0.50)));
    expect(xpOf('free')).toBe(-Math.round(flatFraction * startXp));
    // A morte CONSOME todas as bênçãos de uma vez (#570): o personagem morreu, então o
    // bitmask que ele carregava não sobrevive.
    expect(blessed.blessings).toBe(0);
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
    const { session } = makeParty({
      content: content({ monsters: [ratWithDrop], routes: [threeRatsRoute] }), leader: 'lead',
    });
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
  // Três pontos (#583: sem mais `monsterCount` para espalhar sozinho) — o suficiente para
  // "os monstros continuam vindo para quem ficou" mesmo depois de um deles morrer.
  const loaded = () => content({ monsters: [killer], routes: [threeRatsRoute] });
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
      monsters: [killer], routes: [threeRatsRoute],
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
      monsters: [killer], routes: [threeRatsRoute],
      hunts: [{ ...hunt, exitDelayMs: 5_000 }],
    });
    const session = createHuntSession({
      id: 'leave-session-delay', content: loadedWithDelay, huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      partyOptions: { leaderId: 'lead', mode: 'split' }, botConfigs: { b: exitOnLoss },
    });
    const frail = member('frail', 1);
    session.enter(frail);
    session.enter(member('lead'));
    session.enter(member('b'));
    session.enter(member('c'));

    // Mata `frail` DIRETO (#583: com três pontos de spawn em vez de um só, qual dos quatro
    // presentes o `killer` persegue primeiro passou a depender de geometria de tile que este
    // teste não quer arbitrar) — o assunto aqui é o atraso de `party-member-lost` com
    // `exitDelayMs`, não o desempate de alvo do monstro, que tem teste próprio.
    frail.receiveDamage(frail.health);
    resolveDeath(session, { kind: 'character', character: frail });

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

describe('Boosted Creature do dia (#615, ADR 0054 decisão 7)', () => {
  // `respawnDelayMs` bem mais curto que o `route` padrão (30 s), só para os dois lados do
  // teste caberem num tempo de execução razoável: metade é 10 s, e o teste espera no máximo
  // 22 s de relógio LÓGICO (instantâneo — é `session.advanceBy`, não `setTimeout`).
  const halvedRoute = {
    ...route,
    spawnPoints: [{ routeIndex: 4, radius: 2, monsterId: 'rat', respawnDelayMs: 20_000 }],
  };

  /** Avança em passos pequenos até o primeiro rato morrer, e devolve o instante da morte. */
  function untilFirstDeath(session: Session, ruleset: HuntRuleset): number {
    for (let i = 0; i < 400; i++) {
      session.advanceBy(50);
      if (ruleset.monsters.filter((m) => m.alive).length === 0) return session.nowMs;
    }
    throw new Error('o rato não morreu dentro da janela do teste');
  }

  // Não-bloqueável (o rato desta fixture não declara `blockable`) telegrafa antes de nascer de
  // verdade (#583): `NONBLOCKABLE_SPAWN_TELEGRAPH_MS` (4 200 ms) some em cima do
  // `respawnDelayMs` — os dois lados do teste dão a margem para ele, sem depender do número
  // exato.
  it('spawntime / 2 nos pontos da boosted — ainda morto na metade do prazo normal, vivo na metade do dobrado', () => {
    const loaded = content({ routes: [halvedRoute] });
    const { session, ruleset } = start({ loaded, boostedMonsterId: 'rat' });
    untilFirstDeath(session, ruleset);
    // 9 s depois da morte: nem a metade (10 s) venceu ainda.
    session.advanceBy(9_000);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(0);
    // Mais 7 s (16 s do total): a metade (10 s) mais o telegraph (4,2 s) já passaram — o
    // dobro do prazo (20 s) ainda não teria vencido se a boosted não estivesse ligada.
    session.advanceBy(7_000);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(1);
  });

  it('sem boosted, o mesmo ponto espera o `respawnDelayMs` INTEIRO', () => {
    const loaded = content({ routes: [halvedRoute] });
    const { session, ruleset } = start({ loaded });
    untilFirstDeath(session, ruleset);
    // 16 s depois da morte (o instante em que a versão boosted já teria respawnado, telegraph
    // incluído): o prazo de 20 s inteiro ainda não venceu.
    session.advanceBy(16_000);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(0);
    // Mais 9 s (25 s do total): os 20 s inteiros mais o telegraph já passaram.
    session.advanceBy(9_000);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(1);
  });

  it('fica FIXADA no snapshot: uma hunt retomada não perde nem troca a boosted com que nasceu', () => {
    const { session, ruleset } = start({ boostedMonsterId: 'rat' });
    run(session, 1_000, 100);
    expect(ruleset.getState().boostedMonsterId).toBe('rat');

    const snapshot = session.snapshot();
    const restoredRuleset = huntRulesetFromSnapshot(snapshot, content());
    expect(restoredRuleset).not.toBeNull();
    // Reconstruído do snapshot, sem NADA do conteúdo dizer "rat" de novo — é a IDENTIDADE da
    // instância que o `HuntRulesetState.boostedMonsterId` carrega, como `huntId`/`difficulty`.
    expect(restoredRuleset?.getState().boostedMonsterId).toBe('rat');
  });

  it('ausente é hunt sem boosted (conteúdo sem `boosted/baseline.json`, ou ticket que não trouxe): nenhum efeito liga', () => {
    const { session, ruleset } = start();
    expect(ruleset.getState().boostedMonsterId).toBeUndefined();
    run(session, 20_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
  });
});

describe('respawn: blockable espera a vista limpar e reinicia o relógio; não bloqueável telegrafa (#583, ADR 0039)', () => {
  // Uma sala BEM mais larga que a janela de visão (`SPAWN_VISIBILITY_RADIUS`, ±11 tiles): o
  // herói entra colado no ponto de spawn (x=1) — perto o bastante para o `spawnClearRadius` de
  // antes bloquear —, e um canto a x=29 fica fora da janela (distância 28), para testar o lado
  // "sem ninguém à vista" sem trocar de andar.
  const bigMap = {
    id: 'arena-big', z: 7,
    grid: ['#'.repeat(32), `#${'.'.repeat(30)}#`, '#'.repeat(32)],
  };
  const bigRoute = {
    id: 'arena-big-loop', mapId: 'arena-big',
    tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
    spawnPoints: [{ routeIndex: 0, radius: 1, monsterId: 'rat', respawnDelayMs: 2_000 }],
  };
  const bigHunt = { ...hunt, mapId: 'arena-big', routeId: 'arena-big-loop' };
  // O `rat` compartilhado do arquivo é NÃO bloqueável (ausente é `false`, o default — ver o
  // comentário na definição dele): os dois testes de `blockable` abaixo precisam do próprio
  // monstro, com o campo declarado, para exercitar a janela de visão de verdade.
  const blockableRat = { ...rat, blockable: true };

  /** Cria a sessão, deixa o `SPAWN_INITIAL` vencer (nasce no mesmo instante) e trava o herói
   * na posição de entrada — sem isto o passo do bot o levaria de volta ao laço de dois tiles a
   * cada vencimento, atrapalhando o teste de distância. */
  const startPinned = (loaded: Content) => {
    const started = start({ loaded });
    started.session.cancelEvent('player-step', started.hero.id);
    started.session.advanceBy(1);
    return started;
  };

  const killFirstMonster = (session: Session, ruleset: HuntRuleset): void => {
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    monster.receiveDamage(monster.health);
    resolveDeath(session, { kind: 'monster', monster });
  };

  it('a população INICIAL nasce na hora, mesmo com o herói colado no ponto (#583, `SpawnMonster::startup`)', () => {
    // O `rat` desta fixture é `blockable: true`, e mesmo assim nasce: o boot bypassa a janela
    // de visão — só o RESPAWN depois de uma morte a aplica.
    const loaded = content({ maps: [bigMap], routes: [bigRoute], hunts: [bigHunt] });
    const { session, ruleset } = start({ loaded });
    session.advanceBy(1);
    expect(ruleset.monsters).toHaveLength(1);
  });

  it('blockable: à vista do herói, o respawn ADIA e reinicia o relógio — nunca um retry curto', () => {
    const loaded = content({ monsters: [blockableRat], maps: [bigMap], routes: [bigRoute], hunts: [bigHunt] });
    const { session, ruleset } = startPinned(loaded);
    killFirstMonster(session, ruleset);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(0);

    // Bem além do `respawnDelayMs` (2 000 ms): com o herói sempre colado no ponto, o rato
    // continua sem nascer — a vista nunca limpa, e o relógio reinicia a cada checagem.
    run(session, 20_000, 100);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(0);
  });

  it('blockable: sem ninguém à vista, nasce normalmente após o respawnDelayMs', () => {
    const loaded = content({ monsters: [blockableRat], maps: [bigMap], routes: [bigRoute], hunts: [bigHunt] });
    const { session, hero, ruleset } = startPinned(loaded);
    killFirstMonster(session, ruleset);
    hero.position = { x: 29, y: 1, z: 7 }; // distância 28 do ponto (1,1) — fora da janela de 11.

    run(session, 2_500, 100); // passa do respawnDelayMs de 2 000 ms.
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(1);
  });

  it('não bloqueável: nasce mesmo com o herói colado, só depois do telegraph de 4200 ms', () => {
    const naoBlockable = { ...rat, blockable: false };
    const loaded = content({
      monsters: [naoBlockable], maps: [bigMap], routes: [bigRoute], hunts: [bigHunt],
    });
    const { session, ruleset } = startPinned(loaded);
    killFirstMonster(session, ruleset);

    // No instante em que o `respawnDelayMs` (2 000 ms) vence, o telegraph ainda não terminou.
    run(session, 2_100, 100);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(0);

    // 2 000 + 4200 (`NONBLOCKABLE_SPAWN_MONSTER_INTERVAL` × 3) + folga: nasceu, com o herói
    // ainda colado no ponto — nunca esperou a vista limpar.
    run(session, 4_300, 100);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(1);
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

describe('munição, arremessável e aljava do Canary (#575)', () => {
  // `aggroRadius: 0` mantém o rato PARADO no lugar em que o teste o posiciona — sem alvo
  // aggroado ele não persegue —, o que permite manter a distância de Chebyshev exata durante
  // toda a janela de combate. `health` enorme e `attack: 0` tiram a morte e o contra-ataque da
  // conta: o teste mede só os tiros do herói.
  const tank = {
    ...rat, health: 1_000_000, attack: 0, aggroRadius: 0, experience: 0,
    loot: { gold: { chance: 0, min: 1, max: 1 }, items: [] },
  };

  // A arena pequena do resto do arquivo (6×5, entrada em (1,1)) não tem folga para posicionar o
  // alvo a 3 tiles de Chebyshev em toda direção sem sair do mapa (`y` negativo). Uma arena maior,
  // com os MESMOS ids (`arena`/`arena-loop`) — o `start()` deste arquivo hospeda sempre a hunt
  // `arena` —, com a entrada bem no meio, dá a folga que o teste de alcance exato precisa.
  const bigGrid = Array.from({ length: 21 }, (_, y) => (
    y === 0 || y === 20 ? '#'.repeat(21) : `#${'.'.repeat(19)}#`
  ));
  const bigMap = { id: 'arena', z: 7, grid: bigGrid };
  // O perímetro de um quadrado grande: a entrada (tile 0, (2,2)) e o ponto de spawn (tile 32,
  // (18,18)) ficam a 16 de Chebyshev — bem além do alcance de qualquer arma desta suíte (no
  // máximo 6). Sem isso, o rato nasceria A UM TILE do herói (ADR do `routeIndex: 0`) e disparava
  // o primeiro tiro "de contato" (cooldown de ataque não corre no vazio) ANTES do teste
  // conseguir reposicioná-lo na distância exata — o mesmo golpe contaminado que fez a primeira
  // versão deste teste medir a distância errada.
  const perimeterLoop = (x0: number, y0: number, x1: number, y1: number, z: number) => {
    const tiles: { x: number; y: number; z: number }[] = [];
    for (let x = x0; x < x1; x += 1) tiles.push({ x, y: y0, z });
    for (let y = y0; y < y1; y += 1) tiles.push({ x: x1, y, z });
    for (let x = x1; x > x0; x -= 1) tiles.push({ x, y: y1, z });
    for (let y = y1; y > y0; y -= 1) tiles.push({ x: x0, y, z });
    return tiles;
  };
  const loopTiles = perimeterLoop(2, 2, 18, 18, 7);
  const bigRoute = {
    id: 'arena-loop', mapId: 'arena',
    tiles: loopTiles,
    spawnPoints: [{
      routeIndex: loopTiles.findIndex((t) => t.x === 18 && t.y === 18), radius: 1,
      monsterId: 'rat', respawnDelayMs: 30_000,
    }],
  };
  const bigHunt = {
    id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
  };
  const rangeContent = (over: Partial<RawContent> = {}): Content => content({
    maps: [bigMap], routes: [bigRoute], hunts: [bigHunt], ...over,
  });

  const spear = {
    id: 'spear-i', name: 'Spear', kind: 'weapon', slot: 'hand', weight: 1, value: 0, attack: 25,
    stackable: true,
    weapon: { kind: 'distance', family: 'distance', range: 3, breakChance: 30 },
  };
  const bow = {
    id: 'bow-i', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 1, value: 0,
    twoHanded: true, weapon: { kind: 'distance', family: 'distance', range: 6, ammoFamily: 'arrow' },
  };
  const quiver = {
    id: 'quiver-i', name: 'Eldritch Quiver', kind: 'shield', slot: 'shield', weight: 1, value: 0,
    quiver: true, perfectShot: { range: 3, damage: 200 },
  };

  /** Posiciona o alvo a `tiles` de Chebyshev do herói, UMA vez, e roda o combate. */
  const shootAt = (
    itemId: string, tiles: number, inventory: InventoryState, extraItems: readonly Record<string, unknown>[],
    durationMs = 8_000,
  ) => {
    const loaded = rangeContent({ monsters: [tank], items: [...items, ...extraItems] });
    const { session, hero, ruleset } = start({ loaded, gold: 1_000, inventory });
    session.advanceBy(50);
    const target = ruleset.monsters[0];
    if (target !== undefined) target.position = { ...hero.position, y: hero.position.y - tiles };
    const events: DomainEvent[] = [];
    for (let t = 0; t < durationMs && session.ended === null; t += 100) {
      session.advanceBy(100);
      events.push(...session.drainEvents());
    }
    return { session, hero, events };
  };

  it('arremessável com pilha de 1: quebra o único que sobra destrói a arma, e o herói fica desarmado', () => {
    const inventory: InventoryState = {
      backpack: [], equipped: { hand: { instanceId: 'i-spear', itemId: 'spear-i', quantity: 1 } },
    };
    const loaded = rangeContent({ monsters: [tank], items: [...items, spear] });
    const { session, hero, ruleset } = start({ loaded, gold: 1_000, inventory });
    session.advanceBy(50);
    const target = ruleset.monsters[0];
    if (target !== undefined) target.position = { ...hero.position, y: hero.position.y - 1 };
    // Roda até a spear quebrar (breakChance 30%: cai em poucos tiros com folga de sobra).
    for (let t = 0; t < 60_000 && hero.inventory.getState().equipped['hand'] !== undefined; t += 100) {
      session.advanceBy(100);
    }
    expect(hero.inventory.getState().equipped['hand']).toBeUndefined();
    expect(hero.inventory.weapon(loaded.items, hero)).toBeNull();
  });

  it('arremessável com pilha atira, pratica distância e o tiro NÃO passa pelo `#ammoFor`', () => {
    const inventory: InventoryState = {
      backpack: [], equipped: { hand: { instanceId: 'i-spear', itemId: 'spear-i', quantity: 50 } },
    };
    const loaded = rangeContent({ monsters: [tank], items: [...items, spear] });
    const { session, hero, ruleset } = start({ loaded, gold: 1_000, inventory });
    session.advanceBy(50);
    const target = ruleset.monsters[0];
    if (target !== undefined) target.position = { ...hero.position, y: hero.position.y - 1 };
    const events: DomainEvent[] = [];
    for (let t = 0; t < 8_000 && session.ended === null; t += 100) {
      session.advanceBy(100);
      events.push(...session.drainEvents());
    }
    const shots = events.filter((e) => e.kind === 'shot');
    expect(shots.length).toBeGreaterThan(0);
    // A wand/munição por família carregam `ammoId`; o arremessável NÃO — é o próprio item.
    expect(shots.every((e) => e.kind === 'shot' && e.ammoId === undefined)).toBe(true);
    expect(hero.skills.getState()['distance']).toBeDefined();
    // Nenhum gold saiu: o arremessável não debita preço, só consome a própria pilha.
    expect(session.aggregates.goldSpent).toBe(0);
  });

  it('a spear quebra ~30% dos tiros (breakChance), e o que sobrevive não é decrementado', () => {
    const startingStock = 2_000;
    const inventory: InventoryState = {
      backpack: [], equipped: { hand: { instanceId: 'i-spear', itemId: 'spear-i', quantity: startingStock } },
    };
    const loaded = rangeContent({ monsters: [tank], items: [...items, spear] });
    const { session, hero, ruleset } = start({ loaded, gold: 0, inventory });
    session.advanceBy(50);
    const target = ruleset.monsters[0];
    if (target !== undefined) target.position = { ...hero.position, y: hero.position.y - 1 };
    let shots = 0;
    // ~1000 tiros (attackIntervalMs 2000 na fixture): desvio padrão da fração de quebra em
    // torno de 1,5 ponto percentual — a tolerância de ±5 fica a mais de 3 desvios.
    for (let t = 0; t < 2_000_000 && session.ended === null; t += 100) {
      session.advanceBy(100);
      shots += session.drainEvents().filter((e) => e.kind === 'shot').length;
    }
    const remaining = hero.inventory.getState().equipped['hand']?.quantity ?? 0;
    const broken = startingStock - remaining;
    expect(shots).toBeGreaterThan(800);
    // Tolerância generosa (±5 pontos percentuais): é uma rolagem por tiro, não uma conta exata.
    const brokenFraction = broken / shots;
    expect(brokenFraction).toBeGreaterThan(0.30 - 0.05);
    expect(brokenFraction).toBeLessThan(0.30 + 0.05);
  });

  it('perfect shot soma dano SÓ na distância EXATA do range da aljava — munição por família', () => {
    const bowInventory: InventoryState = {
      backpack: [],
      equipped: {
        hand: { instanceId: 'i-bow', itemId: 'bow-i', quantity: 1 },
        shield: { instanceId: 'i-quiver', itemId: 'quiver-i', quantity: 1 },
      },
    };
    const atExactRange = shootAt('bow-i', 3, bowInventory, [bow, quiver], 3_000);
    const atOneTileOff = shootAt('bow-i', 2, bowInventory, [bow, quiver], 3_000);
    const hitAt = (events: readonly DomainEvent[]): number => {
      const hit = events.find((e) => e.kind === 'creature-hit');
      if (hit?.kind !== 'creature-hit') throw new Error('sem creature-hit');
      return hit.amount;
    };
    // O bônus (200) é grande o bastante para nunca se confundir com a variância normal do dano
    // da munição (`arrow` attack 25, spread 0 na fixture de família de distância).
    expect(hitAt(atExactRange.events)).toBeGreaterThan(hitAt(atOneTileOff.events) + 100);
  });

  it('perfect shot também soma no arremessável, na distância exata do range da aljava', () => {
    const spearWithQuiver: InventoryState = {
      backpack: [],
      equipped: {
        hand: { instanceId: 'i-spear', itemId: 'spear-i', quantity: 1 },
        shield: { instanceId: 'i-quiver', itemId: 'quiver-i', quantity: 1 },
      },
    };
    const run3 = (): { session: Session; hero: CharacterRuntime; ruleset: HuntRuleset } => {
      const loaded = rangeContent({ monsters: [tank], items: [...items, spear, quiver] });
      const started = start({ loaded, gold: 0, inventory: spearWithQuiver });
      started.session.advanceBy(50);
      const target = started.ruleset.monsters[0];
      if (target !== undefined) {
        target.position = { ...started.hero.position, y: started.hero.position.y - 3 };
      }
      return started;
    };
    const run2 = (): { session: Session; hero: CharacterRuntime; ruleset: HuntRuleset } => {
      const loaded = rangeContent({ monsters: [tank], items: [...items, spear, quiver] });
      const started = start({ loaded, gold: 0, inventory: spearWithQuiver });
      started.session.advanceBy(50);
      const target = started.ruleset.monsters[0];
      if (target !== undefined) {
        target.position = { ...started.hero.position, y: started.hero.position.y - 2 };
      }
      return started;
    };
    const hitAmount = (started: { session: Session }): number => {
      let amount: number | undefined;
      for (let t = 0; t < 3_000 && amount === undefined; t += 100) {
        started.session.advanceBy(100);
        for (const e of started.session.drainEvents()) {
          if (e.kind === 'creature-hit' && amount === undefined) amount = e.amount;
        }
      }
      if (amount === undefined) throw new Error('sem creature-hit');
      return amount;
    };
    expect(hitAmount(run3())).toBeGreaterThan(hitAmount(run2()) + 100);
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
      // O passo aleatório (#655) também sorteia (`shuffledCardinals`, três `integer` por passo), e
      // este monstro — com alvo mas sem passo até ele, preso na salinha — o daria a cada segundo.
      // Um último passo "no futuro" o impede: o assunto aqui é o sorteio do REROLL, isolado.
      monster.lastMoveAtMs = Number.MAX_SAFE_INTEGER;
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
      // O herói tem de estar À VISTA (#655): o monstro ocioso não usa defesa, como no Canary, onde
      // ele sai da lista de `onThink`. O raio cobre a sala inteira, e o herói tem HP de sobra —
      // o teste é só sobre a própria defesa.
      ...rat, aggroRadius: 11,
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

describe('Paralyze Rune e imunidade de monstro (#559/#592, ADR 0041 d.2)', () => {
  // Requisitos simplificados (`requires: {}`, como `attack-rune-726` acima) — o assunto aqui é
  // o PORTÃO de imunidade, não o gate de level/magicLevel que `casting.test.ts` já prende.
  const paralyzeRuneTest = {
    id: 'paralyze-rune-test', name: 'Paralyze Rune', price: 10, group: 'support', groupCooldownMs: 2_000,
    cooldownMs: 6_000, requires: {},
    effect: {
      kind: 'condition' as const, target: 'enemy' as const, range: 4,
      condition: {
        key: 'speed', merge: 'replace' as const, durationMs: 6_000,
        effect: {
          kind: 'speed' as const, type: 'paralyze' as const,
          formula: { mina: -1, minb: 0, maxa: -1, maxb: 0 },
        },
      },
    },
  };

  it('paralisa um monstro SEM imunidade — o alvo mirado, não o lançador', () => {
    const { session, ruleset } = withSpells(botConfig({}), { supplies: [paralyzeRuneTest] });
    session.advanceBy(1);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    const target = { kind: 'monster' as const, subject: monsterSubject(monster.id) };
    const outcome = ruleset.useItemOn(session, 'hero', { supplyId: 'paralyze-rune-test' }, 1, target);
    expect(outcome).toEqual({ ok: true });
    expect(monster.conditions.get('speed')?.speedPercent).toBeLessThan(0);
    expect(monster.conditions.get('speed')?.targetId).toBe(monster.subject);
  });

  it('um monstro IMUNE (`conditionImmunities: ["paralyze"]`) não recebe a condição — a runa sai igual', () => {
    const immuneRat = { ...rat, conditionImmunities: ['paralyze'] };
    const { session, ruleset } = withSpells(
      botConfig({}), { supplies: [paralyzeRuneTest], monstersRaw: [immuneRat] },
    );
    session.advanceBy(1);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato imune');
    const target = { kind: 'monster' as const, subject: monsterSubject(monster.id) };
    const outcome = ruleset.useItemOn(session, 'hero', { supplyId: 'paralyze-rune-test' }, 1, target);
    // A runa SAI (gasta gold e cooldown) — só a condição não entra, como `Monster::isImmune`.
    expect(outcome).toEqual({ ok: true });
    expect(monster.conditions.get('speed')).toBeNull();
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
  const summonerHunt = hunt;
  const summonerRoute = { ...route, spawnPoints: [{ ...route.spawnPoints[0], monsterId: 'summoner' }] };
  const pacifist = { ...combat, player: { ...combat.player, attackPower: 0 } };
  const loaded = () => content({
    monsters: [summoner, minion], hunts: [summonerHunt], routes: [summonerRoute], combat: [pacifist],
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
      monsters: [neverEngaged, minion], hunts: [summonerHunt], routes: [summonerRoute], combat: [pacifist],
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

    // O ÚNICO lugar do Spawner é do mestre (a rota tem um ponto só, #583), e continua ocupado
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
    const cappedContent = content({
      monsters: [capped, minionA, minionB], hunts: [hunt], routes: [summonerRoute], combat: [pacifist],
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

describe('Invocação do PERSONAGEM (#598, M38-01, ADR 0057)', () => {
  // `summonable: true` + `manaCost` (#598): o campo NOVO do monstro. `attack: 0`/`aggroRadius: 0`
  // isola os testes de mecânica pura (nascimento, teto, mana) do combate — o describe seguinte,
  // com uma invocação que BATE, cobre o alvo do mestre e a atribuição de dano.
  const passiveMinion = {
    id: 'minion', name: 'Minion', recommendedLevel: 1,
    health: 30, experience: 0, attack: 0, armor: 0,
    attackIntervalMs: 2_000, speed: 300, aggroRadius: 0, attackRange: 1,
    loot: { items: [] },
    summonable: true, manaCost: 20,
  };
  const notSummonable = { ...passiveMinion, id: 'not-summonable', summonable: false, manaCost: undefined };
  // `manaCost: 0` no CATÁLOGO da magia é de propósito (ADR 0057 decisão 3): o custo real sai do
  // monstro, e um teste que visse a mana cair por `spell.manaCost` estaria provando o número
  // errado por coincidência (os dois são 0 seriam indistinguíveis) — por isso o valor aqui é
  // ausente (`0`, o default do schema) e o do monstro é 20, bem diferente.
  const summonSpell = {
    id: 'summon-test', name: 'Summon Creature (teste)', manaCost: 0, cooldownMs: 200,
    effect: { kind: 'summon' as const },
  };
  const summonAction = (monsterId: string) =>
    ({ kind: 'spell' as const, spellId: 'summon-test', monsterId });

  it('nasce com `masterId` do PERSONAGEM, perto dele, e debita o `manaCost` do MONSTRO — nunca o da magia', () => {
    const config = botConfigV2([{ do: summonAction('minion') }]);
    const { session, hero, ruleset } = withSpells(config, {
      monsters: false, spells: [...spells, summonSpell], monstersRaw: [rat, passiveMinion], mana: 200,
    });
    // Só UM ciclo do bot: o cooldown da magia é curto (200 ms) de propósito para o teste do
    // teto, abaixo — aqui a janela para ANTES da segunda tentativa, para medir a PRIMEIRA
    // invocação isolada.
    run(session, 100, 50);

    const summons = ruleset.monsters.filter((m) => m.masterId === hero.id);
    expect(summons).toHaveLength(1);
    const summon = summons[0];
    if (summon === undefined) throw new Error('sem invocação');
    expect(Math.max(
      Math.abs(summon.position.x - hero.position.x),
      Math.abs(summon.position.y - hero.position.y),
    )).toBeLessThanOrEqual(1);
    // 200 − 20 (o `manaCost` do MINION) = 180. Se o débito tivesse usado `spell.manaCost` (0),
    // a mana continuaria em 200 — é essa a divergência que este número prende.
    expect(hero.mana).toBe(180);
  });

  it('`pacified` recusa a invocação: Summon Creature é AGRESSIVA por padrão no Canary (#622)', () => {
    // `summon_creature.lua` não chama `isAggressive(false)` — ao contrário de toda cura, condição
    // própria e conjuração —, então `Spell::playerSpellCheck` a recusa sob `CONDITION_PACIFIED`
    // (`spells.cpp:517`): um Druid que sobe uma escada (2 s de `pacified`) não invoca nesse prazo.
    const config = botConfigV2([{ do: summonAction('minion') }]);
    const { session, hero, ruleset } = withSpells(config, {
      monsters: false, spells: [...spells, summonSpell], monstersRaw: [rat, passiveMinion], mana: 200,
    });
    hero.conditions.apply({ key: 'pacified', expiresAtMs: 1_500, merge: 'longest' });
    expect(ruleset.useSlot(session, hero.id, 0, 0)).toEqual({ ok: false, reason: 'attack-locked', retryInMs: 1_500 });
    run(session, 1_400, 100);
    expect(ruleset.monsters.filter((m) => m.masterId === hero.id)).toHaveLength(0);
    expect(hero.mana).toBe(200);
    // Vencida, a mesma invocação sai.
    run(session, 3_000, 100);
    expect(ruleset.monsters.filter((m) => m.masterId === hero.id).length).toBeGreaterThan(0);
    expect(hero.mana).toBeLessThan(200);
  });

  it('teto de 2 invocações vivas por personagem, contando qualquer nome (ADR 0057 decisão 3)', () => {
    const config = botConfigV2([{ do: summonAction('minion') }]);
    const { session, hero, ruleset } = withSpells(config, {
      monsters: false, spells: [...spells, summonSpell], monstersRaw: [rat, passiveMinion], mana: 2_000,
    });
    // Cooldown de 200 ms e ciclo de bot de 1 s (o `categoryCooldownMs` do conteúdo de teste):
    // tempo de sobra para VÁRIAS tentativas dentro de 10 s, bem além do necessário para o teto
    // segurar na terceira.
    run(session, 10_000, 100);

    const summons = ruleset.monsters.filter((m) => m.alive && m.masterId === hero.id);
    expect(summons).toHaveLength(2);
    // A mana só saiu DUAS vezes (2 000 − 40): a terceira tentativa foi recusada ANTES do débito
    // — `not-summonable` nunca chega a chamar `castSpell` genérico com sucesso.
    expect(hero.mana).toBe(1_960);
  });

  it('recusa `not-summonable` sem `monsterId`, com monstro não-invocável, e com monstro inexistente', () => {
    const withMonster = (monsterId: string | undefined) => {
      const config = botConfigV2([{
        do: monsterId === undefined
          ? { kind: 'spell' as const, spellId: 'summon-test' }
          : summonAction(monsterId),
      }]);
      const { session, hero } = withSpells(config, {
        monsters: false, spells: [...spells, summonSpell],
        monstersRaw: [rat, passiveMinion, notSummonable], mana: 200,
      });
      run(session, 300, 100);
      return hero;
    };
    // Nenhum dos três gasta mana: a recusa é ANTES do débito.
    expect(withMonster(undefined).mana).toBe(200);
    expect(withMonster('not-summonable').mana).toBe(200);
    expect(withMonster('does-not-exist').mana).toBe(200);
  });

  it('some quando o MESTRE sai da hunt (`Session.leave`, ADR 0057 decisão 3)', () => {
    // Party de dois: `a` invoca, `b` só está lá para a sessão ter mais de um dono — sem isso
    // `Session.leave` encerraria a sessão inteira (`Ruleset.shared`), e não haveria "sair"
    // para observar, só "acabou".
    const config = botConfigV2([{ do: summonAction('minion') }]);
    const loaded = buildContent(raw({
      spells: [...spells, summonSpell],
      monsters: [rat, passiveMinion],
      routes: [{ ...route, spawnPoints: [] }],
      progression: [{ ...progression, startingMana: 200 }],
    }));
    const session = createHuntSession({
      id: 'summon-leave-session', content: loaded, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0, botConfigs: { a: config },
    });
    const a = new CharacterRuntime({
      id: 'a', position: { x: 1, y: 1, z: 7 }, health: 100, maxHealth: 100,
      mana: 200, maxMana: 200, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    const b = new CharacterRuntime({
      id: 'b', position: { x: 2, y: 1, z: 7 }, health: 100, maxHealth: 100,
      mana: 0, maxMana: 0, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(a);
    session.enter(b);
    const ruleset = session.ruleset as HuntRuleset;
    run(session, 300, 100);
    expect(ruleset.monsters.filter((m) => m.masterId === 'a').length).toBeGreaterThan(0);

    session.leave('a', 'manual-exit');
    expect(session.ended).toBeNull(); // `b` continua — a sessão não acabou, só perdeu um dono.
    expect(ruleset.monsters.filter((m) => m.masterId === 'a')).toHaveLength(0);
  });
});

describe('Invocação do PERSONAGEM ataca o alvo do mestre, e o dano credita o MESTRE (#598, ADR 0057 decisões 1 e 2)', () => {
  // Ao contrário do describe acima, esta invocação BATE forte o bastante para matar o rato
  // (50 HP) num golpe — o que faz "quem matou" inequívoco: se o crédito fosse da invocação (um
  // `m:<id>` que `xpByDamage`/`session.participants` nunca reconheceriam como participante), o
  // XP e o Bestiário do herói ficariam em ZERO mesmo com o rato morto.
  const fighterMinion = {
    id: 'fighter-minion', name: 'Fighter Minion', recommendedLevel: 1,
    health: 30, experience: 0, attack: 100, armor: 0,
    attackIntervalMs: 200, speed: 300, aggroRadius: 0, attackRange: 1,
    loot: { items: [] },
    summonable: true, manaCost: 20,
  };
  const summonSpell = {
    id: 'summon-test', name: 'Summon Creature (teste)', manaCost: 0, cooldownMs: 200,
    effect: { kind: 'summon' as const },
  };
  const summonAction = { kind: 'spell' as const, spellId: 'summon-test', monsterId: 'fighter-minion' };
  // O herói NUNCA bate (attackPower 0): todo dano no rato — e todo o crédito de abate — só pode
  // ter vindo da invocação.
  const pacifist = { ...combat, player: { ...combat.player, attackPower: 0 } };

  it('a invocação segue o alvo do mestre (auto-target, #444) e o abate credita XP/Bestiário ao MESTRE', () => {
    const config = botConfigV2([{ do: summonAction }]);
    const { session, hero, ruleset } = withSpells(config, {
      spells: [...spells, summonSpell], monstersRaw: [rat, fighterMinion], mana: 200,
      combat: [pacifist],
    });
    run(session, 15_000, 100);

    // O rato nasceu, a invocação nasceu, seguiu o alvo (o rato — o único candidato de
    // `#autoSelectTarget`) e o matou: a hunt segue rodando com a invocação viva ou já uma nova,
    // mas o herói RENDEU pelo abate.
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.xp).toBeGreaterThan(0);
    expect(hero.bestiary.getState()['rat']).toBeGreaterThan(0);

    const summon = ruleset.monsters.find((m) => m.masterId === hero.id);
    if (summon === undefined) throw new Error('sem invocação viva ao fim do teste');
    // A invocação em si NUNCA ganha nada — nem XP, nem Bestiário: ela não é um `CharacterRuntime`
    // e não tem os dois campos, então a única forma de "ela ganhar" seria o abate ter ido para
    // outro lugar. `session.aggregates.xpGained` é do HERÓI (solo — um só agregado na sessão).
    expect(session.aggregates.xpGained).toBe(hero.xp);
  });

  it('o DPS da invocação soma no agregado do MESTRE (#431)', () => {
    const config = botConfigV2([{ do: summonAction }]);
    const { session, hero } = withSpells(config, {
      spells: [...spells, summonSpell], monstersRaw: [rat, fighterMinion], mana: 200,
      combat: [pacifist],
    });
    run(session, 15_000, 100);
    // `damageDealt` (#431, ADR 0032 d.14) só sobe por golpe de verdade — com o herói pacifista,
    // só a invocação bateu, e é ela quem move este número.
    expect(session.aggregates.damageDealt ?? 0).toBeGreaterThan(0);
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
    // `blockable: true` diverge do `data/monsters/dragon.json` real (que é `false`, o default do
    // Canary) — decisão só desta fixture, para o teste medir FREQUÊNCIA de ability sem entrar
    // no telegraph de 4200 ms do respawn não bloqueável (#583): o assunto aqui é a cadência de
    // ataque, não o mecanismo de spawn, que tem teste próprio em `spawner.test.ts`.
    blockable: true,
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

  /** A rota-base aponta "rat"; aqui o ponto declara o Dragon (#583). */
  const dragonHunt = hunt;
  const dragonRoute = { ...route, spawnPoints: [{ ...route.spawnPoints[0], monsterId: 'dragon' }] };

  it('melee, bola de fogo, onda e cura própria saem nas frequências esperadas pela semente (~200 vencimentos)', () => {
    const loaded = buildContent(raw({
      monsters: [dragon], hunts: [dragonHunt], routes: [dragonRoute], combat: [pacifist],
    }));
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

  it('#681: sob combat-v3, a ability e a cura do Dragon sorteiam pela normal truncada do Canary', async () => {
    // `combat.cpp:189` (`getCombatValues` → `normal_random`) e `monster.cpp:2218`: o valor da
    // ability e da cura própria do monstro saem da normal, não do `rng.integer` uniforme. Cada
    // sorteio é conferido contra `normalRandomInt` sobre um CLONE do `Rng` no estado de antes.
    const actual = await vi.importActual<typeof import('../combat/combat-value.js')>('../combat/combat-value.js');
    const v3 = {
      ...pacifist, compatibilityProfile: 'combat-v3',
      weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
      distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    };
    const loaded = buildContent(raw({ monsters: [dragon], hunts: [dragonHunt], routes: [dragonRoute], combat: [v3] }));
    const draws: { min: number; max: number; profile: string | undefined; value: number; expected: number }[] = [];
    vi.mocked(rollCombatValue).mockImplementation((rng, min, max, profile) => {
      const expected = normalRandomInt(new Rng(rng.getState()), min, max);
      const value = actual.rollCombatValue(rng, min, max, profile);
      draws.push({ min, max, profile: profile?.compatibilityProfile, value, expected });
      return value;
    });
    try {
      const session = createHuntSession({
        id: 'dragon-v3', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      });
      session.enter(heroLevel200());
      session.advanceBy(100);
      const target = (session.ruleset as HuntRuleset).monsters[0];
      if (target === undefined) throw new Error('sem monstro nesta cena');
      target.receiveDamage(50_000); // ferido: a cura tem o que repor.
      for (let t = 0; t < 400_000 && session.ended === null; t += 100) session.advanceBy(100);
    } finally {
      vi.mocked(rollCombatValue).mockImplementation(actual.rollCombatValue);
    }

    const melee = draws.filter((d) => d.min === 0 && d.max === 120);
    const heals = draws.filter((d) => d.min === 40 && d.max === 70);
    expect(melee.length).toBeGreaterThan(100);
    expect(heals.length).toBeGreaterThan(10);
    for (const draw of [...melee, ...heals]) {
      expect(draw.profile).toBe('combat-v3');
      expect(draw.value).toBe(draw.expected);
    }
    // A cauda: a uniforme poria ~10,7 % dos golpes em [0,12]; a normal truncada, ~3,4 %.
    expect(melee.filter((d) => d.value <= 12).length / melee.length).toBeLessThan(0.07);
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
        monsters: [dragonNoHeal], hunts: [dragonHunt], routes: [dragonRoute], combat: [pacifist], spells: [spellDef],
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
    const loaded = buildContent(raw({ monsters: [alwaysFireball], hunts: [dragonHunt], routes: [dragonRoute] }));
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

    const events: DomainEvent[] = [];
    const hero = session.participants[0];
    if (hero === undefined) throw new Error('sem herói nesta cena');
    let firstFlee: { heroAt: GridPoint; from: GridPoint; to: GridPoint } | null = null;
    for (let t = 0; t < 6_000 && session.ended === null; t += 100) {
      const heroAt = { x: hero.position.x, y: hero.position.y };
      session.advanceBy(100);
      const drained = session.drainEvents();
      events.push(...drained);
      if (firstFlee === null) {
        for (const e of drained) {
          if (e.kind === 'creature-moved' && e.creatureId === monster.subject) {
            firstFlee = { heroAt, from: e.from, to: e.to };
            break;
          }
        }
      }
    }
    // Nenhum corpo a corpo enquanto foge.
    expect(events.some((e) => e.kind === 'creature-hit' && e.source === 'melee'
      && typeof e.attackerId === 'string' && e.attackerId.startsWith('m:'))).toBe(false);
    // A bola de fogo continua saindo — passo e ataque são decisões independentes (FUN-85).
    expect(events.some(
      (e) => e.kind === 'monster-ability-cast' && e.abilityId === 'fireball',
    )).toBe(true);
    // E ele se afastou do herói (fleeStep), em vez de ficar colado: o PRIMEIRO passo dele não
    // aproxima. Só o primeiro — encurralado na quina da salinha, o monstro que não tem mais
    // passo de fuga anda ao acaso (#655, `doRandomStep`: `!hasFollowPath`), e onde ele está seis
    // segundos depois já não diz nada sobre a fuga.
    expect(firstFlee).not.toBeNull();
    if (firstFlee === null) return;
    expect(distance(firstFlee.to, firstFlee.heroAt))
      .toBeGreaterThanOrEqual(distance(firstFlee.from, firstFlee.heroAt));
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
    const dragonLordRoute = { ...route, spawnPoints: [{ ...route.spawnPoints[0], monsterId: 'dragon-lord' }] };
    const loaded = buildContent(raw({
      monsters: [dragonLordField], hunts: [hunt], routes: [dragonLordRoute], combat: [pacifist],
    }));
    const session = createHuntSession({
      id: 'dragon-lord-field', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    });
    session.enter(heroLevel200());
    const ruleset = session.ruleset as HuntRuleset;
    run(session, 3_000, 100);
    expect(ruleset.fields).toHaveLength(1);
    expect(ruleset.fields[0]?.tiles).toHaveLength(21);
  });

  describe('#645: `targetChange` NUNCA consulta `targetStrategy` (ADR 0037 d.6, TFS/Canary `onThinkTarget`)', () => {
    // `onThinkTarget` real nunca lê `strategiesTarget*` — só `m_monsterType->info.targetDistance`
    // (`definition.targetDistance` aqui, o campo do #542) decide entre
    // `TARGETSEARCH_RANDOM` e `TARGETSEARCH_NEAREST` (`monster.cpp:2141-2192`, idêntico no TFS
    // `monster.cpp:919-963`). A estratégia ponderada só entra no ramo estreito de `chooseTarget`
    // (fuga bloqueada) — ver `monster.test.ts`.
    const ally = (id: string, x: number, health: number): CharacterRuntime => new CharacterRuntime({
      id, position: { x, y: 0, z: 7 }, health, maxHealth: 1_000_000, mana: 1_000, maxMana: 1_000,
      level: 200, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });

    it('melee (`targetDistance: 1`, o caso do Dragon): o reroll sorteia uniforme, não sempre o de menos vida', () => {
      // Se o peso 100 % em `health` ainda fosse consultado, `wounded-ally` venceria SEMPRE.
      // Rodando muitos vencimentos com os dois candidatos à MESMA posição (nenhum critério de
      // distância os separa), `TARGETSEARCH_RANDOM` alcança os dois — a prova de que o critério
      // é o sorteio uniforme, não o peso.
      const healthPickingDragon = {
        ...dragon,
        targetChange: { intervalMs: 1_000, chance: 1 },
        targetStrategy: { nearest: 0, health: 100, damage: 0, random: 0 },
      };
      const loaded = buildContent(raw({
        monsters: [healthPickingDragon], hunts: [dragonHunt], routes: [dragonRoute], combat: [pacifist],
      }));
      const session = createHuntSession({
        id: 'dragon-target-change-random', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      });
      const knight = heroLevel200({ health: 1_000_000 });
      session.enter(knight);
      session.enter(ally('wounded-ally', 0, 1));
      session.enter(ally('healthy-ally', 0, 900_000));

      session.advanceBy(100); // o Dragon nasce.
      const ruleset = session.ruleset as HuntRuleset;
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('sem monstro nesta cena');

      const seen = new Set<string | null>();
      for (let i = 0; i < 30; i++) {
        // Fixa o alvo ANTES de cada vencimento: o que se mede é a TROCA, não a aquisição.
        monster.targetId = knight.id;
        run(session, 1_100, 100);
        seen.add(monster.targetId);
      }
      expect(seen.has('healthy-ally')).toBe(true);
      expect(seen.has('wounded-ally')).toBe(true);
    });

    it('alcance longo com `targetDistance: 1` continua RANDOM — quem decide é `targetDistance`, não `attackRange`', () => {
      // O Canary lê `info.targetDistance` (`monster.cpp:2185-2186`); o alcance de ataque não
      // entra. Com os dois campos DIFERENTES, um reroll que ainda olhasse `attackRange` cairia em
      // NEAREST e nunca alcançaria o candidato empatado em distância que o sorteio alcança.
      const longReachMelee = {
        ...dragon, attackRange: 4, targetDistance: 1,
        targetChange: { intervalMs: 1_000, chance: 1 },
      };
      const loaded = buildContent(raw({
        monsters: [longReachMelee], hunts: [dragonHunt], routes: [dragonRoute], combat: [pacifist],
      }));
      const session = createHuntSession({
        id: 'dragon-target-change-long-reach', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      });
      const knight = heroLevel200({ health: 1_000_000 });
      session.enter(knight);
      session.enter(ally('first-ally', 0, 900_000));
      session.enter(ally('second-ally', 0, 900_000));

      session.advanceBy(100); // o Dragon nasce.
      const ruleset = session.ruleset as HuntRuleset;
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('sem monstro nesta cena');

      const seen = new Set<string | null>();
      for (let i = 0; i < 30; i++) {
        monster.targetId = knight.id;
        run(session, 1_100, 100);
        seen.add(monster.targetId);
      }
      expect(seen.has('first-ally')).toBe(true);
      expect(seen.has('second-ally')).toBe(true);
    });

    it('à distância (`targetDistance > 1`): o reroll resolve NEAREST fixo, mesmo com o peso favorecendo o mais ferido e mais longe', () => {
      const rangedDragon = {
        ...dragon, attackRange: 4, targetDistance: 4,
        targetChange: { intervalMs: 1_000, chance: 1 },
        targetStrategy: { nearest: 0, health: 100, damage: 0, random: 0 }, // favoreceria `wounded-far`
      };
      const loaded = buildContent(raw({
        monsters: [rangedDragon], hunts: [dragonHunt], routes: [dragonRoute], combat: [pacifist],
      }));
      const session = createHuntSession({
        id: 'dragon-target-change-nearest', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      });
      const knight = heroLevel200({ health: 1_000_000 });
      session.enter(knight);
      const near = ally('near-ally', 0, 900_000);
      session.enter(near);
      const woundedFar = ally('wounded-far-ally', 0, 1);
      session.enter(woundedFar);

      session.advanceBy(100); // o Dragon nasce.
      const ruleset = session.ruleset as HuntRuleset;
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('sem monstro nesta cena');
      // Reposiciona os candidatos RELATIVOS ao Dragon (o spawn dele vem da rota da hunt, não é
      // fixo) — o mesmo recurso do teste de conformidade de RNG acima (`distantRat`).
      const monsterFloor = monster.position.z ?? 0;
      near.position = { x: monster.position.x + 1, y: monster.position.y, z: monsterFloor };
      woundedFar.position = { x: monster.position.x + 6, y: monster.position.y, z: monsterFloor };
      monster.targetId = knight.id;

      run(session, 1_500, 100); // um vencimento de 1 000 ms cabe nesta janela.

      expect(monster.targetId).toBe('near-ally');
    });
  });

  describe('#645: `rankTarget` só no ramo de fuga bloqueada de `chooseTarget` (ADR 0037 d.6)', () => {
    it('Dragon fugindo com o alvo fora do alcance de toda ability troca pelo critério `health`', () => {
      // `chooseTarget` unitária já cobre isto em `monster.test.ts`; aqui é a FIAÇÃO pela
      // `Session` de verdade — o mesmo caminho que `#onMonsterStep`/`#onMonsterAttack` usam.
      const healthPickingDragon = {
        ...dragon,
        targetChange: undefined, // isola do timer: só a reavaliação de `chooseTarget` importa aqui.
        targetStrategy: { nearest: 0, health: 100, damage: 0, random: 0 },
      };
      const loaded = buildContent(raw({
        monsters: [healthPickingDragon], hunts: [dragonHunt], routes: [dragonRoute], combat: [pacifist],
      }));
      const session = createHuntSession({
        id: 'dragon-flee-rerank', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      });
      const knight = heroLevel200({ health: 1_000_000 });
      session.enter(knight);
      const wounded = new CharacterRuntime({
        id: 'wounded-ally', position: { x: 0, y: 0, z: 7 }, health: 5, maxHealth: 1_000_000,
        mana: 1_000, maxMana: 1_000, level: 200, xp: 0, vocationId: null,
        staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0, gold: 0, goldDelta: 0, alive: true, cooldowns: {},
      });
      session.enter(wounded);

      session.advanceBy(100); // o Dragon nasce.
      const ruleset = session.ruleset as HuntRuleset;
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('sem monstro nesta cena');

      // Empurra para a faixa de fuga (runOnHealth 300) e coloca o alvo retido a 8 tiles — além
      // do alcance da bola de fogo (7, a maior ability do Dragon), mas ainda dentro do
      // `aggroRadius` (8, também de `dragon`), para não sair da lista de candidatos.
      monster.receiveDamage(healthPickingDragon.health - 250);
      const monsterFloor = monster.position.z ?? 0;
      knight.position = { x: monster.position.x + 8, y: monster.position.y, z: monsterFloor };
      wounded.position = { x: monster.position.x + 8, y: monster.position.y, z: monsterFloor };
      monster.targetId = knight.id;
      session.drainEvents();

      run(session, 2_500, 100); // um passo do Dragon (movementDuration) cabe nesta janela.

      expect(monster.targetId).toBe('wounded-ally');
    });
  });
});

describe('manter distância: um atirador recua quando o alvo chega perto (#542, targetDistance)', () => {
  // Alcance de ataque igual ao `targetDistance`: o atirador não cola no jogador (attackRange
  // maior não entraria em jogo aqui) nem para longe demais para atirar — o mesmo desenho que o
  // Necromancer/Water Elemental do Canary usam de verdade (attackRange == targetDistance).
  const shooter = {
    id: 'shooter', name: 'Shooter', recommendedLevel: 1,
    health: 50, experience: 5, attack: 10, armor: 0,
    attackIntervalMs: 2000, speed: 300, aggroRadius: 8, attackRange: 3,
    targetDistance: 3,
    loot: { items: [] },
    // `blockable: true`: o teste é sobre "nasce colado no jogador e recua" — precisa nascer NA
    // HORA (#583), não depois do telegraph de 4200 ms do respawn não bloqueável.
    blockable: true,
  };

  const shooterHunt = hunt;
  const shooterRoute = { ...route, spawnPoints: [{ ...route.spawnPoints[0], monsterId: 'shooter' }] };

  // O alcance DESARMADO do herói também vira o `targetDistance`: sem isto, o herói nunca
  // reconhece o atirador como alvo de ataque (ele nunca chega ao corpo a corpo DE PROPÓSITO) e
  // continua andando o LOOP inteiro da rota, empurrando o atirador contra as quatro paredes de
  // uma sala de 4×3 — o que mediria o tamanho da sala, não o recuo. Com o mesmo alcance dos
  // dois lados, `#playerStep` reconhece o alvo e PARA assim que ele entra no alcance, o
  // "jogador parado" que o #542 pede. `attackPower: 0` (o mesmo `pacifist` do describe do
  // Dragon): sem ele, o herói parado bate de verdade e mata o atirador de 50 HP em dois golpes
  // de 25 — o teste mediria a morte do monstro, não o recuo dele.
  const stationaryCombat = {
    ...combat, player: { ...combat.player, attackRange: 3, attackPower: 0 },
  };

  it('mantém pelo menos targetDistance tiles de um jogador parado, mesmo nascendo colado nele', () => {
    const loaded = buildContent(raw({
      monsters: [shooter], hunts: [shooterHunt], routes: [shooterRoute], combat: [stationaryCombat],
    }));
    const { session, hero, ruleset } = start({ loaded });
    session.advanceBy(100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');

    // Teleporta os dois para um canto controlado, com sala de sobra na direção do recuo — e
    // refaz a ocupação do mundo com um ciclo de snapshot/retomada, o MESMO que uma hunt
    // retomada do Redis já usa (`Session.fromSnapshot`/`#rebuildOccupancy`). Sem isto, o tile
    // onde o atirador nasceu de verdade continuaria "ocupado" por baixo, e um passo de recuo
    // por cima dele seria recusado à toa.
    hero.position = { x: 1, y: 2, z: 7 };
    monster.position = { x: 2, y: 2, z: 7 };
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed(snapshot.id),
    );
    const resumedRuleset = resumed.ruleset as HuntRuleset;
    const resumedHero = resumed.participants.find((p) => p.id === 'hero') as CharacterRuntime;
    const resumedMonster = resumedRuleset.monsters[0];
    if (resumedMonster === undefined) throw new Error('sem monstro após retomar');

    run(resumed, 6_000, 100);

    const tiles = Math.max(
      Math.abs(resumedMonster.position.x - resumedHero.position.x),
      Math.abs(resumedMonster.position.y - resumedHero.position.y),
    );
    expect(tiles).toBeGreaterThanOrEqual(shooter.targetDistance);
    // E o herói ficou onde estava: reconheceu o atirador como alvo dentro do alcance e parou
    // de andar a rota, em vez de rodear a sala inteira atrás dele.
    expect(resumedHero.position).toEqual({ x: 1, y: 2, z: 7 });
  });

  it('com targetDistance 1 (default), continua colando no jogador parado — comportamento de sempre', () => {
    // O mesmo cenário, só que com o rato de sempre (`targetDistance` ausente = 1): a mudança do
    // #542 não afasta quem já era corpo a corpo. `pacifist` (attackPower 0): o rato tem só 50
    // HP, e um herói parado batendo de verdade o mataria antes dos 6 s do teste — o corpo fica
    // onde morreu, mas o herói já teria voltado a andar a rota, e a distância cresceria por um
    // motivo que não tem nada a ver com `targetDistance`.
    const pacifist = { ...combat, player: { ...combat.player, attackPower: 0 } };
    const loaded = buildContent(raw({ combat: [pacifist] }));
    const { session, hero, ruleset } = start({ loaded });
    session.advanceBy(100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    monster.position = { ...hero.position, x: hero.position.x + 2 };
    session.drainEvents();

    run(session, 6_000, 100);

    const tiles = Math.max(
      Math.abs(monster.position.x - hero.position.x),
      Math.abs(monster.position.y - hero.position.y),
    );
    expect(tiles).toBeLessThanOrEqual(1);
    expect(monster.alive).toBe(true);
  });
});

describe('manter distância: a aproximação também para em targetDistance (revisão do #649)', () => {
  // `attackRange` (5) BEM maior que `targetDistance` (2) de propósito — o oposto do `shooter`
  // do describe acima, onde os dois coincidem. Antes desta revisão, `decideMonsterAction`
  // ainda usava o MAIOR alcance de ability como ponto de parada da aproximação
  // (`monsterAttackRange`, CMB-06): um atirador assim parava e atirava assim que entrava no
  // alcance de 5, sem nunca fechar até o stand-off de 2 documentado — o que a issue original
  // pedia era só a METADE do recuo (#542), e a revisão do #649 fechou a outra metade.
  const longRangeShooter = {
    id: 'long-range-shooter', name: 'Long Range Shooter', recommendedLevel: 1,
    health: 50, experience: 5, attack: 10, armor: 0,
    attackIntervalMs: 2000, speed: 300, aggroRadius: 8, attackRange: 5,
    targetDistance: 2,
    loot: { items: [] },
    // `blockable: true` (#583): o teste conta com o monstro já vivo em `advanceBy(100)`.
    blockable: true,
  };

  const shooterHunt = hunt;
  const shooterRoute = {
    ...route, spawnPoints: [{ ...route.spawnPoints[0], monsterId: 'long-range-shooter' }],
  };

  // O alcance desarmado do herói cobre a distância inicial inteira (3, os dois cantos opostos
  // da sala 4×3) — reconhece o atirador como alvo desde o primeiro vencimento e para na hora,
  // pelo mesmo motivo do describe acima: sem isto, o herói andaria a rota atrás de um alvo que
  // ainda não está "ao alcance da arma", e o teste mediria o passo do herói, não o do monstro.
  // `attackPower: 0` (pacifist): o atirador tem só 50 HP, e um herói parado batendo de verdade
  // o mataria antes do monstro terminar de se aproximar.
  const stationaryCombat = {
    ...combat, player: { ...combat.player, attackRange: 3, attackPower: 0 },
  };

  it('fecha a distância além do próprio alcance de ability, até o targetDistance preferido', () => {
    const loaded = buildContent(raw({
      monsters: [longRangeShooter], hunts: [shooterHunt], routes: [shooterRoute], combat: [stationaryCombat],
    }));
    const { session, hero, ruleset } = start({ loaded });
    session.advanceBy(100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');

    // Cantos opostos da sala (interior 1..4 × 1..3): distância Chebyshev 3 — dentro do alcance
    // de ability (5), mas mais longe que o `targetDistance` (2). O mesmo ciclo de
    // snapshot/retomada do describe acima refaz a ocupação do mundo a partir da posição nova.
    hero.position = { x: 1, y: 1, z: 7 };
    monster.position = { x: 4, y: 3, z: 7 };
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed(snapshot.id),
    );
    const resumedRuleset = resumed.ruleset as HuntRuleset;
    const resumedHero = resumed.participants.find((p) => p.id === 'hero') as CharacterRuntime;
    const resumedMonster = resumedRuleset.monsters[0];
    if (resumedMonster === undefined) throw new Error('sem monstro após retomar');

    run(resumed, 6_000, 100);

    const tiles = Math.max(
      Math.abs(resumedMonster.position.x - resumedHero.position.x),
      Math.abs(resumedMonster.position.y - resumedHero.position.y),
    );
    // Exatamente no `targetDistance`: mais longe seria a aproximação parando cedo demais (o
    // defeito revisado), mais perto disparia o ramo de recuo do #542 numa distância que já
    // deveria estar estável.
    expect(tiles).toBe(longRangeShooter.targetDistance);
    expect(resumedHero.position).toEqual({ x: 1, y: 1, z: 7 });
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
  const looterHunt = hunt;
  const looterRoute = {
    ...route, spawnPoints: [{ ...route.spawnPoints[0], monsterId: 'looter', respawnDelayMs: 200 }],
  };
  const loaded = () => content({ monsters: [looter], hunts: [looterHunt], routes: [looterRoute] });
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

  it('a tela fica sabendo: aparece ao aplicar e some ao vencer (#561, M31-06)', () => {
    const { session, ruleset } = withSpells(botConfig(), { monsters: false, health: 1_000_000 });
    const field = ruleset.applyField(session, fireField, { x: 4, y: 3, z: 7 });
    const appeared = session.drainEvents()
      .find((event) => event.kind === 'field-appeared');
    expect(appeared).toEqual({ kind: 'field-appeared', fieldId: fireField.id, tiles: field.tiles });

    run(session, 21_000, 100);
    const vanished = session.drainEvents()
      .find((event) => event.kind === 'field-vanished');
    expect(vanished).toEqual({ kind: 'field-vanished', fieldId: fireField.id });
  });

  it('relançar o MESMO id reinicia e emite `field-appeared` de novo, sem `field-vanished`', () => {
    const { session, ruleset } = withSpells(botConfig(), { monsters: false, health: 1_000_000 });
    ruleset.applyField(session, fireField, { x: 4, y: 3, z: 7 });
    session.drainEvents();
    ruleset.applyField(session, fireField, { x: 4, y: 3, z: 7 });
    const events = session.drainEvents();
    expect(events.filter((event) => event.kind === 'field-appeared')).toHaveLength(1);
    expect(events.some((event) => event.kind === 'field-vanished')).toBe(false);
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
      progression: [{ ...progression, startingMana: 200, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
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

describe('monstro evita campo que não pode atravessar (M29-05)', () => {
  // HP absurdo de propósito: o teste mede se ele SE MOVE, não se ele sobrevive à wand.
  const fieldRat = { ...rat, id: 'field-rat', name: 'Field Rat', health: 100_000, canWalkOnFire: false };
  // Rota mínima, SEM o herói passar perto do monstro: ele fica preso entre (1,1) e (2,1),
  // sempre a 2 ou 3 tiles do monstro em (4,1) — nunca ao alcance do desarmado (1). O objetivo é
  // isolar "o monstro tomou dano PRESO", sem o herói chegar perto o bastante para brigar corpo
  // a corpo por acidente ao andar a rota inteira do resto do arquivo.
  const stuckRoute = {
    id: 'stuck-route', mapId: 'arena',
    tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
    spawnPoints: [{ routeIndex: 0, monsterId: 'field-rat', respawnDelayMs: 30_000 }],
  };
  const stuckHunt = { ...hunt, routeId: 'stuck-route' };
  // Alcance 3, o bastante para bater no monstro PRESO sem o herói precisar se aproximar.
  const rangeWand = {
    id: 'range-wand', name: 'Range Wand', kind: 'weapon', slot: 'hand', weight: 1, value: 0,
    weapon: { kind: 'wand', range: 3, manaPerHit: 5, damage: { min: 30, max: 30 }, damageType: 'physical' },
  };
  const wallOfFire: FieldSpec = {
    id: 'wall', durationMs: 9_999_999,
    shape: { shape: 'beam', length: 3 },
    condition: {
      key: 'burning', merge: 'refresh', durationMs: 9_999_999,
      effect: {
        kind: 'damage-over-time', form: 'rounds',
        // Intervalo enorme: o tique do CAMPO nunca vence dentro da janela do teste — o único
        // dano que pode armar o bypass é o da wand, nunca o do próprio campo.
        rounds: [{ count: 1, intervalMs: 9_999_999, damage: 1 }], damageType: 'fire',
      },
    },
  };

  /**
   * Um monstro `canWalkOnFire: false` em (4,1), rumo ao herói a oeste: o passo guloso tenta
   * (3,1) [primário], (3,0) [vizinho horário — já é parede do MAPA] e (3,2) [anti-horário]. Um
   * `beam` de 3 tiles partindo de (3,0) para o sul cobre exatamente (3,1) e (3,2) — as DUAS
   * tentativas que a parede do mapa não cobre sozinha —, deixando o monstro sem NENHUMA rota.
   */
  const setup = (armed: boolean) => {
    const loaded = content({
      monsters: [fieldRat], routes: [stuckRoute], hunts: [stuckHunt],
      items: armed ? [...items, rangeWand] : items,
    });
    const { session, hero, ruleset } = start({
      loaded,
      ...(armed ? {
        inventory: {
          backpack: [], equipped: { hand: { instanceId: 'w1', itemId: 'range-wand', quantity: 1 } },
        },
      } : {}),
    });
    if (armed) { hero.mana = 10_000; hero.maxMana = 10_000; }
    session.advanceBy(100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    monster.position = { x: 4, y: 1, z: 7 };
    ruleset.applyField(session, wallOfFire, { x: 3, y: 0, z: 7 });
    return { session, hero, ruleset };
  };

  it('sem arma de alcance, o herói nunca alcança o monstro preso — ele anda ao acaso atrás do fogo, e nunca o cruza', () => {
    const { session, ruleset } = setup(false);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    let randomSteps = 0;
    for (let t = 0; t < 20_000; t += 100) {
      const before = monster.lastMoveAtMs;
      session.advanceBy(100);
      // Preso (alvo à vista, sem passo até ele), o monstro cai no `doRandomStep` do Canary (#655):
      // sorteia um passo cardinal a cada segundo — e o passo dele é o único jeito de `x` mudar.
      if (monster.randomStepping && monster.lastMoveAtMs !== before) randomSteps += 1;
      // O `x` é o que prova que ele não atravessou a parede (em x=3): a posição inteira oscila,
      // porque o passo aleatório o tira do tile de origem.
      expect(monster.position.x).toBeGreaterThanOrEqual(4);
    }
    expect(randomSteps).toBeGreaterThan(3);
    expect(monster.ignoresFieldDamage).toBe(false);
  });

  it('com uma wand de alcance 3, o dano à distância concede UMA passagem pelo fogo (TFS/Canary `ignoreFieldDamage`)', () => {
    const { session, ruleset } = setup(true);
    run(session, 20_000, 100);
    const monster = ruleset.monsters[0];
    // Cruzou a parede que ele não pode pisar sozinho: só o bypass explica x < 4.
    expect(monster?.position.x).toBeLessThan(4);
  });

  it('o tique de um campo que ele PODE pisar (veneno) também concede a passagem pelo fogo que o prende (achado da revisão do #650)', () => {
    // O rato só recusa FOGO (`canWalkOnFire: false`) — veneno (`earth`) continua livre, e é
    // exatamente onde ele está PARADO, preso atrás da parede de fogo. Nenhuma wand, nenhum
    // herói perto: o ÚNICO dano deste teste é o tique periódico do próprio campo de veneno, pelo
    // caminho de `HuntRuleset#applyConditionTick`/`#onFieldTick` — não `#applyHits`/`#land`.
    const puddleOfPoison: FieldSpec = {
      id: 'puddle', durationMs: 9_999_999,
      shape: { shape: 'beam', length: 1 },
      condition: {
        key: 'poisoned', merge: 'refresh', durationMs: 9_999_999,
        effect: {
          kind: 'damage-over-time', form: 'rounds',
          rounds: [{ count: 1_000, intervalMs: 500, damage: 5 }], damageType: 'earth',
        },
      },
    };
    const { session, ruleset } = setup(false);
    // `beam` de comprimento 1 partindo de (4,0) rumo ao sul cobre só (4,1) — o tile do próprio
    // monstro —, sem tocar nenhum dos dois tiles da parede de fogo na coluna x=3.
    ruleset.applyField(session, puddleOfPoison, { x: 4, y: 0, z: 7 });
    run(session, 20_000, 100);
    const monster = ruleset.monsters[0];
    // Cruzou a parede que ele não pode pisar sozinho: só o bypass explica x < 4 — o mesmo
    // mecanismo do teste da wand acima, agora armado pelo tique de campo, não por um golpe.
    expect(monster?.position.x).toBeLessThan(4);
  });
});

describe('dispel: cura de condição (#590, Cure Poison e afins)', () => {
  const curePoison = {
    id: 'cure-poison-test', name: 'Cure Poison', manaCost: 10, cooldownMs: 1_000,
    effect: { kind: 'dispel' as const, types: ['poison'] },
  };
  const fairWoundCleansingTest = {
    id: 'fair-wound-cleansing-test', name: 'Fair Wound Cleansing', manaCost: 10, cooldownMs: 1_000,
    effect: { kind: 'heal' as const, amount: 30, dispel: { types: ['poison'] } },
  };

  it('remove o poison e NÃO toca o burning, cancelando só o vencimento pendente do que saiu', () => {
    const { session, hero } = withSpells(
      botConfigV2([{
        when: [{ kind: 'condition', conditionId: 'poison', present: true }],
        do: { kind: 'spell', spellId: 'cure-poison-test' },
      }]),
      { mana: 1_000, health: 1_000, spells: [curePoison], monsters: false },
    );
    const expiresAtMs = session.nowMs + 60_000;
    // Aplicado direto no `Conditions` do personagem, como o CMB-07 documenta: `castSpell`
    // DEVOLVE a condição, quem agenda é o ruleset — aqui simulamos as duas já agendadas, como
    // se uma ability de monstro (`field.condition.key`, o mesmo vocabulário de `"burning"` no
    // Dragon Lord) as tivesse aplicado antes deste teste começar.
    hero.conditions.apply({ key: 'poison', targetId: hero.id, expiresAtMs });
    hero.conditions.apply({ key: 'burning', targetId: hero.id, expiresAtMs });
    session.scheduleIn('condition-expire', 60_000, { subject: `${hero.id}/poison` });
    session.scheduleIn('condition-expire', 60_000, { subject: `${hero.id}/burning` });

    session.advanceBy(1_500);

    expect(hero.conditions.get('poison')).toBeNull();
    expect(hero.conditions.get('burning')).not.toBeNull();
    const events = session.snapshot().schedule.events;
    expect(events.some((e) => e.subject === `${hero.id}/poison`)).toBe(false);
    expect(events.some((e) => e.subject === `${hero.id}/burning`)).toBe(true);
  });

  it('a cura composta cura E remove no MESMO lançamento — as duas coisas, não uma escolhida', () => {
    const { session, hero } = withSpells(
      botConfigV2([{
        when: [{ kind: 'hp', op: '<=', percent: 100 }],
        do: { kind: 'spell', spellId: 'fair-wound-cleansing-test' },
      }]),
      { mana: 1_000, health: 900, spells: [fairWoundCleansingTest], monsters: false },
    );
    hero.conditions.apply({
      key: 'poison', targetId: hero.id, expiresAtMs: session.nowMs + 60_000,
    });
    session.scheduleIn('condition-expire', 60_000, { subject: `${hero.id}/poison` });

    session.advanceBy(1_500);

    // Cooldown de 1 s: dois lançamentos em 1 500 ms (0 e ~1 000), 30 de cura cada — a soma prova
    // que a cura ACONTECEU nos dois, não só no primeiro em que havia condição para remover.
    expect(hero.health).toBe(960);
    expect(hero.conditions.get('poison')).toBeNull();
  });

  it('sem a condição no alvo a magia sai igual — recusar por "nada para remover" não existe', () => {
    const { session, hero } = withSpells(
      botConfigV2([{
        when: [{ kind: 'condition', conditionId: 'poison', present: false }],
        do: { kind: 'spell', spellId: 'cure-poison-test' },
      }]),
      { mana: 1_000, health: 1_000, spells: [curePoison], monsters: false },
    );
    session.advanceBy(1_500);
    // Dois lançamentos (cooldown 1 s em 1 500 ms) — a magia SAI toda vez, mesmo sem "poison"
    // nenhum para limpar: gastou a mana as duas vezes.
    expect(hero.mana).toBe(980);
  });
});

describe('Invisibility e Cancel Invisibility (#592, ADR 0041 d.2)', () => {
  const invisibilityTest = {
    id: 'invisibility-test', name: 'Invisibility', manaCost: 10, cooldownMs: 1_000,
    effect: { kind: 'invisible' as const, durationMs: 200_000 },
  };
  const cancelInvisibilityTest = {
    id: 'cancel-invisibility-test', name: 'Cancel Invisibility', manaCost: 10, cooldownMs: 1_000,
    effect: {
      kind: 'dispel' as const, types: ['invisible'],
      area: { shape: 'circle' as const, radius: 3, centered: 'caster' as const },
    },
  };

  it('lança e fica invisível — a chave reservada, no LANÇADOR', () => {
    const { session, hero } = withSpells(
      botConfigV2([{
        when: [{ kind: 'condition', conditionId: 'invisible', present: false }],
        do: { kind: 'spell', spellId: 'invisibility-test' },
      }]),
      { mana: 1_000, health: 1_000, spells: [invisibilityTest], monsters: false },
    );
    session.advanceBy(1);
    expect(hero.conditions.get('invisible')).not.toBeNull();
  });

  it('remove a invisibilidade dos MONSTROS na área — não dos aliados, fora do recorte (#12)', () => {
    const { session, hero, ruleset } = withSpells(
      botConfigV2([{
        when: [{ kind: 'condition', conditionId: 'poison', present: false }],
        do: { kind: 'spell', spellId: 'cancel-invisibility-test' },
      }]),
      { mana: 1_000, health: 1_000, spells: [cancelInvisibilityTest] },
    );
    session.advanceBy(1);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    // O spawn da rota nasce longe do herói (routeIndex 4, radius 2) — a forma desta magia sai do
    // LANÇADOR, então o teste o reposiciona adjacente, como quem mira a mesma forma que a
    // ability em área já usa em outros describes deste arquivo.
    monster.position = { ...hero.position, x: hero.position.x + 1 };
    monster.conditions.apply({ key: 'invisible', targetId: monster.subject, expiresAtMs: session.nowMs + 200_000 });
    expect(monster.invisible).toBe(true);
    session.advanceBy(1_500); // 1 lançamento (cooldown 1 s), sem depender de "poison" nenhum.
    expect(monster.invisible).toBe(false);
    void hero;
  });
});

describe('invisibilidade além do alvo: revelação por dano, alvo do jogador e DOT imune (#559)', () => {
  const pacifist = { ...combat, player: { ...combat.player, attackPower: 0 }, minimumDamageFraction: 0 };
  const seer = { ...rat, conditionImmunities: ['invisible'] };
  const invisibilityTest = {
    id: 'invisibility-test', name: 'Invisibility', manaCost: 10, cooldownMs: 1_000,
    effect: { kind: 'invisible' as const, durationMs: 200_000 },
  };
  // O rato que aguenta a hunt inteira: o herói (pacifista) nunca o mata no meio do cenário.
  const tank = { ...rat, health: 1_000_000 };
  const tankContent = (monster: Record<string, unknown> = {}) =>
    content({ monsters: [{ ...tank, ...monster }], combat: [pacifist] });
  // Um campo grande o bastante para cobrir a sala inteira (4×3) sem depender de onde o monstro
  // esteja no instante do tique.
  const roomFire: FieldSpec = {
    id: 'room-fire', durationMs: 20_000,
    shape: { shape: 'circle', radius: 5, centered: 'caster' },
    condition: {
      key: 'fire', merge: 'refresh', durationMs: 20_000,
      effect: {
        kind: 'damage-over-time', form: 'rounds',
        rounds: [{ count: 40, intervalMs: 500, damage: 10 }], damageType: 'fire',
      },
    },
  };
  /** Deixa o alvo invisível como a própria defesa faria: a condição E o vencimento na fila. */
  const makeInvisible = (
    session: Session, target: CharacterRuntime | MonsterRuntime, durationMs: number,
  ): void => {
    const subject = target instanceof CharacterRuntime ? target.id : target.subject;
    target.conditions.apply({ key: 'invisible', targetId: subject, expiresAtMs: session.nowMs + durationMs });
    session.scheduleIn('condition-expire', durationMs, { subject: `${subject}/invisible` });
  };
  const expireEventsOf = (session: Session, subject: string) =>
    session.snapshot().schedule.events.filter((e) => e.subject === `${subject}/invisible`);
  const at = (m: MonsterRuntime) => ({ x: m.position.x, y: m.position.y, z: 7 });

  describe('`Monster::drainHealth`: o monstro invisível que leva dano REAL volta a ficar visível', () => {
    it('o tique de um campo de fogo revela o monstro — e o vencimento pendente sai da fila', () => {
      const { session, ruleset } = withSpells(botConfig(), {
        monstersRaw: [{ ...rat, health: 100_000, attack: 0 }], combat: [pacifist], health: 1_000_000,
      });
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      makeInvisible(session, monster, 200_000);
      expect(monster.invisible).toBe(true);
      expect(expireEventsOf(session, monster.subject)).toHaveLength(1);

      ruleset.applyField(session, roomFire, at(monster));
      run(session, 700, 100); // o primeiro tique cai em +500

      expect(monster.health).toBeLessThan(100_000);
      expect(monster.invisible).toBe(false);
      expect(monster.conditions.get('invisible')).toBeNull();
      // O evento de vencimento da invisibilidade NÃO fica órfão na fila.
      expect(expireEventsOf(session, monster.subject)).toHaveLength(0);
    });

    it('a runa de área numa posição (manual) revela quem estava dentro dela', () => {
      const attackRune = {
        id: 'reveal-rune', name: 'Rune', price: 10, group: 'attack', groupCooldownMs: 2_000,
        requires: {},
        effect: {
          kind: 'damage' as const, basePower: 100, range: 4,
          area: { shape: 'circle' as const, radius: 1, centered: 'target' as const },
        },
      };
      const { session, ruleset } = withSpells(botConfig({}), {
        gold: 1_000, supplies: [attackRune], mana: 200, monstersRaw: [{ ...rat, health: 100_000 }],
        combat: [pacifist],
      });
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      makeInvisible(session, monster, 200_000);

      const outcome = ruleset.useItemOn(
        session, 'hero', { supplyId: 'reveal-rune' }, 1, { kind: 'position', position: at(monster) },
      );
      expect(outcome).toEqual({ ok: true });
      expect(monster.health).toBeLessThan(100_000);
      expect(monster.invisible).toBe(false);
      expect(expireEventsOf(session, monster.subject)).toHaveLength(0);
    });

    it('o golpe corpo a corpo do herói no alvo FIXADO que ficou invisível o revela (`#land`)', () => {
      const { session, hero, ruleset } = start({
        loaded: content({ monsters: [{ ...tank, attack: 0 }] }),
      });
      session.advanceBy(100);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      monster.position = { ...hero.position, x: hero.position.x + 1 };
      ruleset.setAttackTarget(hero, monster, true);
      makeInvisible(session, monster, 200_000);
      expect(monster.invisible).toBe(true);

      run(session, 6_000, 100);
      expect(monster.health).toBeLessThan(1_000_000);
      expect(monster.invisible).toBe(false);
      expect(expireEventsOf(session, monster.subject)).toHaveLength(0);
    });

    it('o reflexo do equipamento que o monstro invisível leva ao bater no herói o revela (`#reflectOntoMonster`)', () => {
      const combatV3 = {
        ...combat, compatibilityProfile: 'combat-v3',
        weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09, attackFactor: 1 },
        distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
        player: { ...combat.player, attackPower: 0 },
      };
      const thornHelmet = {
        id: 'thorn-helmet', name: 'Thorn Helmet', kind: 'armor', slot: 'head',
        weight: 1, value: 0, reflect: { physical: { flat: 42 } },
      };
      const { session, ruleset } = withSpells(botConfig(), {
        health: 10_000, items: [...items, thornHelmet],
        inventory: { backpack: [], equipped: { head: { instanceId: 'h1', itemId: 'thorn-helmet', quantity: 1 } } },
        combat: [combatV3], monstersRaw: [{ ...rat, health: 500 }],
      });
      session.advanceBy(100);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      makeInvisible(session, monster, 200_000);

      run(session, 10_000, 100);
      // O rato invisível bate no herói (visível) e o reflexo do capacete o revela.
      expect(monster.health).toBeLessThan(500);
      expect(monster.invisible).toBe(false);
    });

    it('a invisibilidade do JOGADOR não cai por dano — só por prazo, Cancel Invisibility ou equipamento', () => {
      // Um rato que VÊ invisível o ataca; o herói apanha e continua invisível.
      const { session, hero } = start({ loaded: tankContent({ conditionImmunities: ['invisible'] }) });
      makeInvisible(session, hero, 200_000);
      const before = hero.health;
      run(session, 8_000, 100);
      expect(hero.health).toBeLessThan(before);
      expect(hero.invisible).toBe(true);
    });
  });

  describe('o monstro que não "vê invisível" (`Monster::isTarget` exige `canSeeCreature`)', () => {
    it('nunca seleciona o herói invisível — ele não apanha', () => {
      const { session, hero, ruleset } = start({ loaded: tankContent() });
      makeInvisible(session, hero, 200_000);
      const before = hero.health;
      run(session, 10_000, 100);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      expect(monster.targetId).toBeNull();
      expect(hero.health).toBe(before);
    });

    it('já um monstro que VÊ invisível o alvo e bate igual', () => {
      const { session, hero, ruleset } = start({ loaded: tankContent({ conditionImmunities: ['invisible'] }) });
      makeInvisible(session, hero, 200_000);
      const before = hero.health;
      run(session, 10_000, 100);
      expect(ruleset.monsters[0]?.targetId).toBe(hero.id);
      expect(hero.health).toBeLessThan(before);
    });

    it('o herói que lança Invisibility no meio da luta é largado no think agendado ([0, 1000) ms depois) — e não apanha mais', () => {
      const { session, hero, ruleset } = withSpells(
        botConfigV2([{ do: { kind: 'spell', spellId: 'invisibility-test' }, auto: false }]),
        {
          mana: 1_000, health: 1_000_000, spells: [invisibilityTest], combat: [pacifist],
          monstersRaw: [{ ...tank, attack: 10 }],
        },
      );
      run(session, 4_000, 100); // o rato alcança, engaja e bate
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      expect(monster.targetId).toBe(hero.id);

      const castAtMs = session.nowMs;
      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
      expect(hero.invisible).toBe(true);
      // O think do monstro foi AGENDADO no instante da invisibilidade — o `Creature::onThink` do
      // Canary, numa fase sorteada dentro de um `EVENT_CREATURE_THINK_INTERVAL`.
      const thinks = session.snapshot().schedule.events
        .filter((e) => e.kind === 'visibility-think' && e.subject === monster.subject);
      expect(thinks).toHaveLength(1);
      const dueAtMs = thinks[0]?.dueAtMs ?? -1;
      expect(dueAtMs).toBeGreaterThanOrEqual(castAtMs);
      expect(dueAtMs).toBeLessThan(castAtMs + 1_000);

      // Até o think ele segue com o alvo (e pode bater); no instante dele, larga.
      if (dueAtMs > session.nowMs) session.advanceBy(dueAtMs - session.nowMs - 1);
      expect(monster.targetId).toBe(hero.id);
      session.advanceBy(1);
      expect(monster.targetId).toBeNull();

      const before = hero.health;
      run(session, 8_000, 100);
      expect(hero.health).toBe(before);
      expect(monster.targetId).toBeNull();
    });

    it('o think agendado atravessa o snapshot — o monstro restaurado larga o alvo no MESMO instante (restore-invariance)', () => {
      const { session, hero, ruleset, content: loaded } = withSpells(
        botConfigV2([{ do: { kind: 'spell', spellId: 'invisibility-test' }, auto: false }]),
        {
          mana: 1_000, health: 1_000_000, spells: [invisibilityTest], combat: [pacifist],
          monstersRaw: [{ ...tank, attack: 10 }],
        },
      );
      run(session, 4_000, 100);
      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
      const dueAtMs = session.snapshot().schedule.events
        .find((e) => e.kind === 'visibility-think')?.dueAtMs ?? -1;
      expect(dueAtMs).toBeGreaterThan(0);

      const snapshot = session.snapshot();
      const resumed = Session.fromSnapshot(
        snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed('resume'),
      );
      const monster = (resumed.ruleset as HuntRuleset).monsters[0];
      if (monster === undefined) throw new Error('faltou rato restaurado');
      expect(resumed.snapshot().schedule.events.find((e) => e.kind === 'visibility-think')?.dueAtMs)
        .toBe(dueAtMs);

      if (dueAtMs > resumed.nowMs + 1) resumed.advanceBy(dueAtMs - resumed.nowMs - 1);
      expect(monster.targetId).toBe(hero.id);
      resumed.advanceBy(1);
      expect(monster.targetId).toBeNull();
    });

    it('o desfecho não depende da cadência do avanço — 10 Hz e 1 Hz largam o alvo e cobram o mesmo dano (invariante 2)', () => {
      const outcomeAt = (stepMs: number) => {
        const { session, hero, ruleset } = withSpells(
          botConfigV2([{ do: { kind: 'spell', spellId: 'invisibility-test' }, auto: false }]),
          {
            mana: 1_000, health: 1_000_000, spells: [invisibilityTest], combat: [pacifist],
            monstersRaw: [{ ...tank, attack: 10 }],
          },
        );
        run(session, 4_000, 100);
        expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
        run(session, 10_000, stepMs);
        const monster = ruleset.monsters[0];
        return { health: hero.health, target: monster === undefined ? 'sem monstro' : monster.targetId };
      };
      expect(outcomeAt(1_000)).toEqual(outcomeAt(100));
      expect(outcomeAt(100).target).toBeNull();
    });

    it('quem "vê invisível" não agenda think nenhum — e o herói segue apanhando', () => {
      const { session, hero, ruleset } = withSpells(
        botConfigV2([{ do: { kind: 'spell', spellId: 'invisibility-test' }, auto: false }]),
        {
          mana: 1_000, health: 1_000_000, spells: [invisibilityTest], combat: [pacifist],
          monstersRaw: [{ ...tank, attack: 10, conditionImmunities: ['invisible'] }],
        },
      );
      run(session, 4_000, 100);
      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
      expect(session.snapshot().schedule.events.some((e) => e.kind === 'visibility-think')).toBe(false);
      const before = hero.health;
      run(session, 6_000, 100);
      expect(hero.health).toBeLessThan(before);
      expect(ruleset.monsters[0]?.targetId).toBe(hero.id);
    });

    it('relançar Invisibility com ela ainda ativa NÃO reagenda o think — a invisibilidade não recomeçou', () => {
      const { session, ruleset } = withSpells(
        botConfigV2([{ do: { kind: 'spell', spellId: 'invisibility-test' }, auto: false }]),
        {
          mana: 1_000, health: 1_000_000, spells: [invisibilityTest], combat: [pacifist],
          monstersRaw: [{ ...tank, attack: 10 }],
        },
      );
      run(session, 4_000, 100);
      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
      const first = session.snapshot().schedule.events.filter((e) => e.kind === 'visibility-think').length;
      run(session, 1_100, 100); // o think venceu e o cooldown de 1 s também
      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
      const second = session.snapshot().schedule.events.filter((e) => e.kind === 'visibility-think').length;
      expect(first).toBe(1);
      expect(second).toBe(0);
    });

    it('a troca de alvo por tempo (`targetChange`) nunca sorteia o herói invisível — `searchTarget` só aceita quem `isTarget` aceita', () => {
      const changer = { ...rat, aggroRadius: 1_000, targetChange: { intervalMs: 1_000, chance: 1 } };
      const pickedBy = (invisibleAlly: boolean): ReadonlySet<string | null> => {
        const loaded = content({ monsters: [changer], combat: [pacifist] });
        const session = createHuntSession({
          id: 'target-change-invisible', content: loaded, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
        });
        const first = character();
        session.enter(first);
        const other = new CharacterRuntime({ ...character().getState(), id: 'other' });
        session.enter(other);
        if (invisibleAlly) makeInvisible(session, other, 500_000);
        session.advanceBy(100);
        const monster = (session.ruleset as HuntRuleset).monsters[0];
        if (monster === undefined) throw new Error('faltou rato');
        const seen = new Set<string | null>();
        for (let i = 0; i < 40; i += 1) {
          monster.targetId = first.id; // fixa o alvo: o que se mede é a TROCA
          run(session, 1_100, 100);
          seen.add(monster.targetId);
        }
        return seen;
      };
      // Controle: com os dois visíveis o sorteio alcança o segundo — o teste MEDE alguma coisa.
      expect(pickedBy(false).has('other')).toBe(true);
      expect(pickedBy(true).has('other')).toBe(false);
    });
  });

  describe('o herói não enxerga monstro invisível (`Player::canSeeCreature`)', () => {
    it('o alvo ELEITO pelo bot cai na hora — `selectTarget` nunca escolhe um invisível — e ao reaparecer volta a ser alvo', () => {
      const { session, hero, ruleset } = start({
        loaded: content({ monsters: [{ ...rat, health: 1_000_000, attack: 0 }] }),
      });
      session.advanceBy(100);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      ruleset.setAttackTarget(hero, monster, false);
      expect(ruleset.selectedTargetOf(hero)).toBe(monster);

      makeInvisible(session, monster, 5_000);
      const untouched = monster.health;
      expect(ruleset.selectedTargetOf(hero)).toBeNull();
      run(session, 4_000, 100);
      // O herói não bate no que não vê.
      expect(monster.health).toBe(untouched);
      expect(ruleset.attackTargetOf(hero)).toBeNull();
      // Nenhum think foi agendado para o herói: a eleição do bot é do Draconya (ADR 0037 d.2).
      expect(session.snapshot().schedule.events.some((e) => e.kind === 'visibility-think')).toBe(false);

      run(session, 2_000, 100); // a invisibilidade venceu em +5 000: o bot volta a mirar
      expect(monster.invisible).toBe(false);
      expect(monster.health).toBeLessThan(untouched);
    });

    describe('o alvo FIXADO pelo jogador segue até o think agendado (`Creature::onThink`, [0, 1000) ms)', () => {
      // A defesa de invisibilidade DE VERDADE (o Killer Rabbit, `monster.defenses`): é a única porta
      // pela qual um monstro fica invisível na hunt, e é ela que agenda o think.
      const rabbit = {
        ...rat, health: 1_000_000, attack: 0,
        defenses: [{
          id: 'invisible', cadenceMs: 1_000, chance: 1,
          condition: { key: 'invisible', merge: 'refresh' as const, durationMs: 4_000, effect: { kind: 'invisible' as const } },
        }],
      };
      const untilInvisible = (session: Session, monster: MonsterRuntime): number => {
        for (let i = 0; i < 300 && !monster.invisible; i += 1) session.advanceBy(10);
        expect(monster.invisible).toBe(true);
        return session.nowMs;
      };

      it('mantém o alvo fixado até o think, e o larga nele', () => {
        const { session, hero, ruleset } = start({ loaded: content({ monsters: [rabbit], combat: [pacifist] }) });
        session.advanceBy(100);
        const monster = ruleset.monsters[0];
        if (monster === undefined) throw new Error('faltou coelho');
        ruleset.setAttackTarget(hero, monster, true);

        const seenAtMs = untilInvisible(session, monster);
        const think = session.snapshot().schedule.events
          .find((e) => e.kind === 'visibility-think' && e.subject === hero.id);
        expect(think).toBeDefined();
        const dueAtMs = think?.dueAtMs ?? -1;
        expect(dueAtMs).toBeGreaterThanOrEqual(seenAtMs - 10);
        expect(dueAtMs).toBeLessThan(seenAtMs + 1_000);

        // Até o think o jogador ainda o tem como alvo — é o alvo que o próximo golpe dele usa
        // (`#attackTarget`), e o golpe REVELA o monstro (`#revealOnDrain`, testado acima)…
        if (dueAtMs > session.nowMs + 1) session.advanceBy(dueAtMs - session.nowMs - 1);
        expect(ruleset.selectedTargetOf(hero)).toBe(monster);
        expect(ruleset.attackTargetOf(hero)).toBe(monster);
        // …e no think ele larga.
        session.advanceBy(1);
        expect(ruleset.selectedTargetOf(hero)).toBeNull();
        expect(ruleset.attackTargetOf(hero)).toBeNull();
      });
    });

    describe('a apresentação nunca muda o snapshot (invariante 3) — um monstro que PISCA invisível', () => {
      // O Killer Rabbit de mentira: fica invisível por 300 ms, a 70 % de chance, a cada segundo.
      // O herói o ataca por magia (bot), e é o `slotStates` — a apresentação, que o hospedeiro
      // chama a cada 500 ms SÓ com alguém assistindo — que lê o alvo pelos mesmos leitores que
      // limpam o campo (`#attackTargetOfRunner`/`#botCandidateOf`).
      const blinker = {
        ...rat, health: 1_000_000, attack: 0,
        defenses: [{
          id: 'invisible', cadenceMs: 1_000, chance: 0.7,
          condition: { key: 'invisible', merge: 'refresh' as const, durationMs: 300, effect: { kind: 'invisible' as const } },
        }],
      };
      const strikeTest = {
        id: 'strike-test', name: 'Strike', manaCost: 1, cooldownMs: 1_000,
        effect: { kind: 'damage' as const, power: 5, range: 4, damageType: 'fire' },
      };
      const scene = () => withSpells(
        botConfigV2([{ do: { kind: 'spell', spellId: 'strike-test' }, auto: false }]),
        {
          mana: 100_000, health: 1_000_000, spells: [strikeTest], combat: [pacifist],
          monstersRaw: [blinker],
        },
        'bold',
      );

      it('o snapshot é o mesmo com e sem `slotStates` no meio — a cada 500 ms, por 30 s', () => {
        const unwatched = scene();
        const watched = scene();
        for (let t = 500; t <= 30_000; t += 500) {
          for (const { session } of [unwatched, watched]) run(session, 500, 100);
          // O que o hospedeiro faz a cada 500 ms com um visualizador anexado.
          watched.ruleset.slotStates(watched.session, watched.hero);
          expect(watched.session.snapshot(), `divergiu em ${t} ms`).toEqual(unwatched.session.snapshot());
        }
      });

      it('o alvo ELEITO pelo bot que fica invisível sai NO EVENTO, e a leitura da apresentação não escreve nada', () => {
        const { session, hero, ruleset } = scene();
        session.advanceBy(100);
        const monster = ruleset.monsters[0];
        if (monster === undefined) throw new Error('faltou coelho');
        ruleset.setAttackTarget(hero, monster, false);
        const chosen = () => (session.snapshot().ruleset as {
          runners: Record<string, { chosenTarget?: string }>;
        }).runners.hero?.chosenTarget;
        expect(chosen()).toBe(monster.subject);

        // Invisibilidade que COMEÇA por `#applyConditionTo` (a defesa de verdade): o campo do alvo
        // eleito é limpo ali, no evento.
        for (let i = 0; i < 600 && !monster.invisible; i += 1) session.advanceBy(10);
        expect(monster.invisible).toBe(true);
        expect(chosen()).toBeUndefined();
        // Ler pela apresentação (invisível, não fixado) devolve nada e não escreve nada.
        expect(ruleset.selectedTargetOf(hero)).toBeNull();
        const before = JSON.stringify(session.snapshot());
        ruleset.slotStates(session, hero);
        expect(JSON.stringify(session.snapshot())).toBe(before);
      });
    });

    describe('a mira MANUAL num monstro invisível (o clique que o cliente do Canary nunca teria)', () => {
      // O cliente do Draconya ainda desenha o monstro invisível, então o clique chega como `kind:
      // 'monster'`. No Canary o cliente não o recebe; o que o servidor decide é o TILE
      // (`Spell::playerRuneSpellCheck`, `spells.cpp:704`): a runa `needTarget` recusa o tile sem
      // criatura visível, a que não precisa (área/campo) sai do mesmo jeito e atinge quem estiver lá.
      const singleTargetRune = {
        id: 'blind-single', name: 'Sudden', price: 10, group: 'attack', groupCooldownMs: 2_000,
        requires: {},
        effect: { kind: 'damage' as const, basePower: 100, range: 4 },
      };
      const areaRune = {
        id: 'blind-area', name: 'Great Fireball', price: 10, group: 'attack', groupCooldownMs: 2_000,
        requires: {},
        effect: {
          kind: 'damage' as const, basePower: 100, range: 4,
          area: { shape: 'circle' as const, radius: 1, centered: 'target' as const },
        },
      };
      const invisibleRat = (supply: Record<string, unknown>) => {
        const { session, ruleset } = withSpells(botConfig({}), {
          gold: 1_000, supplies: [supply], mana: 200, monstersRaw: [{ ...rat, health: 100_000 }],
          combat: [pacifist],
        });
        session.advanceBy(1);
        const monster = ruleset.monsters[0];
        if (monster === undefined) throw new Error('faltou rato');
        makeInvisible(session, monster, 200_000);
        const target = { kind: 'monster' as const, subject: monsterSubject(monster.id) };
        return { session, ruleset, monster, target };
      };

      it('a runa de ALVO ÚNICO (`needTarget`) é recusada `no-target` — o tile não tem criatura visível', () => {
        const { session, ruleset, monster, target } = invisibleRat(singleTargetRune);
        const before = monster.health;
        expect(ruleset.useItemOn(session, 'hero', { supplyId: 'blind-single' }, 1, target))
          .toMatchObject({ ok: false, reason: 'no-target' });
        expect(monster.health).toBe(before);
        expect(monster.invisible).toBe(true);
      });

      it('a runa de ÁREA sai no tile do monstro e o atinge — e o revela, como se o clique fosse no chão', () => {
        const { session, ruleset, monster, target } = invisibleRat(areaRune);
        expect(ruleset.useItemOn(session, 'hero', { supplyId: 'blind-area' }, 1, target))
          .toEqual({ ok: true });
        expect(monster.health).toBeLessThan(100_000);
        expect(monster.invisible).toBe(false);
        expect(expireEventsOf(session, monster.subject)).toHaveLength(0);
      });
    });
  });

  describe('imunidade às DOTs (`Combat::CombatConditionFunc`, `Monster::isImmune(ConditionType_t)`)', () => {
    const dotSpell = (damageType: string) => ({
      id: 'dot-test', name: 'DOT', manaCost: 5, cooldownMs: 999_999,
      effect: {
        kind: 'damage-over-time' as const, amount: 20, intervalMs: 500, durationMs: 10_000,
        range: 3, damageType,
      },
    });
    const castOn = (monster: Record<string, unknown>, damageType: string) => {
      const { session, ruleset } = withSpells(
        botConfig({ attack: [{
          when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'dot-test' },
        }] }),
        {
          mana: 1_000, health: 1_000_000, spells: [dotSpell(damageType)], combat: [pacifist],
          monstersRaw: [{ ...rat, health: 100_000, attack: 0, ...monster }],
        },
      );
      run(session, 3_000, 100);
      const victim = ruleset.monsters[0];
      if (victim === undefined) throw new Error('faltou rato');
      return victim;
    };

    it('a DOT física (sangramento — Inflict Wound) não pega em quem é imune a `bleeding`, e pega em quem não é', () => {
      const immune = castOn({ conditionImmunities: ['bleeding'] }, 'physical');
      expect(immune.conditions.get('dot-test')).toBeNull();
      expect(immune.health).toBe(100_000);
      const normal = castOn({}, 'physical');
      expect(normal.health).toBeLessThan(100_000);
    });

    it('a imunidade é POR condição: `burning` não protege de veneno, e `poison` protege da DOT de terra', () => {
      expect(castOn({ conditionImmunities: ['burning'] }, 'earth').health).toBeLessThan(100_000);
      expect(castOn({ conditionImmunities: ['poison'] }, 'earth').health).toBe(100_000);
      expect(castOn({ conditionImmunities: ['burning'] }, 'fire').health).toBe(100_000);
    });

    it('o CAMPO não consulta a imunidade de condição — o Canary só tem a imunidade de DANO ali', () => {
      const { session, ruleset } = withSpells(botConfig(), {
        monstersRaw: [{ ...rat, health: 100_000, attack: 0, conditionImmunities: ['burning'] }],
        combat: [pacifist], health: 1_000_000,
      });
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      ruleset.applyField(session, roomFire, at(monster));
      run(session, 1_200, 100);
      expect(monster.health).toBeLessThan(100_000);
    });
  });

  describe('Cancel Invisibility: o `combat` do script é AGRESSIVO por default, e `CombatFunc` exclui o lançador', () => {
    // O círculo de RAIO 3 (`AREA_CIRCLE3X3`, 37 tiles em linhas 3/5/7/7/7/5/3), como o
    // `cancel-invisibility.json` de verdade — o "3X3" do nome é o raio, não o lado.
    const cancelInvisibility = {
      id: 'cancel-invisibility-test', name: 'Cancel Invisibility', manaCost: 10, cooldownMs: 1_000,
      effect: {
        kind: 'dispel' as const, types: ['invisible'],
        area: { shape: 'circle' as const, radius: 3, centered: 'caster' as const },
      },
    };
    const cast = () => withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'cancel-invisibility-test' }, auto: false }]),
      {
        mana: 1_000, health: 1_000_000, spells: [cancelInvisibility], combat: [pacifist],
        monstersRaw: [{ ...tank, attack: 0 }],
      },
      'bold',
    );

    it('NÃO tira a invisibilidade do próprio lançador nem a dos aliados na forma — só a dos monstros', () => {
      const { session, hero, ruleset } = cast();
      session.advanceBy(1);
      const near = new CharacterRuntime({ ...hero.getState(), id: 'near' });
      session.enter(near);
      near.position = { ...hero.position, x: hero.position.x + 1 };
      for (const who of [hero, near]) makeInvisible(session, who, 200_000);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      monster.position = { ...hero.position, x: hero.position.x + 1 };
      makeInvisible(session, monster, 200_000);

      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });

      expect(monster.invisible).toBe(false);
      expect(expireEventsOf(session, monster.subject)).toHaveLength(0);
      // O Paladin que ficou invisível continua invisível depois do próprio Cancel Invisibility.
      expect(hero.invisible).toBe(true);
      expect(near.invisible).toBe(true);
      expect(expireEventsOf(session, hero.id)).toHaveLength(1);
      expect(expireEventsOf(session, near.id)).toHaveLength(1);
    });

    it('sem monstro nenhum na forma a magia sai e o lançador invisível segue invisível', () => {
      const { session, hero, ruleset } = withSpells(
        botConfigV2([{ do: { kind: 'spell', spellId: 'cancel-invisibility-test' }, auto: false }]),
        { mana: 1_000, health: 1_000_000, spells: [cancelInvisibility], monsters: false },
      );
      makeInvisible(session, hero, 200_000);
      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
      expect(hero.invisible).toBe(true);
    });

    it('alcança a 3 tiles (o círculo de raio 3) e o canto |dx|+|dy| = 4; não alcança a 4, nem o canto 3,3', () => {
      const { session, hero, ruleset } = cast();
      session.advanceBy(1);
      const [edge, past, corner] = ruleset.monsters;
      if (edge === undefined || past === undefined || corner === undefined) throw new Error('faltaram ratos');
      const place = (m: MonsterRuntime, dx: number, dy: number): void => {
        m.position = { ...hero.position, x: hero.position.x + dx, y: hero.position.y + dy };
        makeInvisible(session, m, 200_000);
      };

      place(edge, 3, 0); // dentro: a ponta da linha do meio
      place(past, 4, 0); // fora: além do raio
      place(corner, 3, 3); // fora: o canto do quadrado 7x7 é recortado
      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
      expect(edge.invisible).toBe(false);
      expect(past.invisible).toBe(true);
      expect(corner.invisible).toBe(true);

      session.advanceBy(1_100); // o cooldown de 1 s
      place(corner, 2, 2); // dentro: |dx| + |dy| = 4 é o último canto que a forma cobre
      place(edge, -3, 0); // dentro, do outro lado
      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
      expect(corner.invisible).toBe(false);
      expect(edge.invisible).toBe(false);
      expect(past.invisible).toBe(true);
    });
  });

  describe('Challenge de um lançador invisível (`Monster::challengeCreature` → `selectTarget` → `isTarget`)', () => {
    const challenge = {
      id: 'challenge-test', name: 'Challenge', manaCost: 10, cooldownMs: 999_999,
      effect: { kind: 'challenge', durationMs: 6_000, range: 5 },
    };
    const challengedBy = (monster: Record<string, unknown>) => {
      const { session, hero, ruleset } = withSpells(
        botConfigV2([{ do: { kind: 'spell', spellId: 'challenge-test' }, auto: false }]),
        {
          mana: 1_000, health: 1_000_000, spells: [challenge], combat: [pacifist],
          monstersRaw: [{ ...rat, attack: 0, runOnHealth: 50, ...monster }],
        },
      );
      session.advanceBy(100);
      makeInvisible(session, hero, 200_000);
      ruleset.useSlot(session, 'hero', 0, 0);
      const victim = ruleset.monsters[0];
      if (victim === undefined) throw new Error('faltou rato');
      return victim;
    };

    it('quem não vê invisível NÃO é provocado (sem `challenge`, a fuga continua valendo)', () => {
      expect(challengedBy({}).conditions.get('challenge')).toBeNull();
    });

    it('quem vê invisível é provocado como sempre', () => {
      const victim = challengedBy({ conditionImmunities: ['invisible'] });
      expect(victim.conditions.get('challenge')).not.toBeNull();
    });
  });
});

describe('cadeia de estágios de campo e campo bloqueante (#560, decayTo/Magic Wall/Wild Growth)', () => {
  // Cadeia sintética curta (o firefield real do Dragon Lord tem a mesma FORMA, testada em
  // `content/src/load.test.ts` contra os números reais do Canary): estágio 0 com dano, estágio
  // 1 mais fraco, estágio 2 MUDO (some sem causar nada) — a forma exata de 2118 → 2119 → 2120.
  const stagedFire: FieldSpec = {
    id: 'fire-chain', durationMs: 1_000, // ignorado: `stages` manda quando presente.
    shape: { shape: 'circle', radius: 0, centered: 'caster' },
    stages: [
      {
        durationMs: 1_000,
        condition: {
          key: 'burning', merge: 'refresh', durationMs: 1_000,
          effect: {
            kind: 'damage-over-time', form: 'rounds',
            rounds: [{ count: 1, intervalMs: 500, damage: 20 }], damageType: 'fire',
          },
        },
      },
      {
        durationMs: 800,
        condition: {
          key: 'burning', merge: 'refresh', durationMs: 800,
          effect: {
            kind: 'damage-over-time', form: 'rounds',
            rounds: [{ count: 1, intervalMs: 400, damage: 10 }], damageType: 'fire',
          },
        },
      },
      { durationMs: 600 }, // sem `condition`: o estágio mudo, só ocupa até sumir.
    ],
  };

  it('avança de estágio ao vencer cada duração, emite `field-stage-changed`, e some no fim (`field-vanished`)', () => {
    const { session, ruleset } = start({ health: 1_000_000 });
    ruleset.applyField(session, stagedFire, { x: 0, y: 0, z: 7 });
    expect(ruleset.fields).toHaveLength(1);
    expect(ruleset.fields[0]?.stageIndex ?? 0).toBe(0);
    expect(ruleset.fields[0]?.condition?.effect.kind).toBe('damage-over-time');

    session.advanceBy(999); // ainda dentro do estágio 0 (vence em 1000).
    expect(ruleset.fields[0]?.stageIndex ?? 0).toBe(0);

    session.advanceBy(2); // passou de 1000: o estágio 1 (mais fraco) entra.
    expect(ruleset.fields[0]?.stageIndex).toBe(1);
    const stage1 = ruleset.fields[0]?.condition;
    expect(stage1?.effect.kind).toBe('damage-over-time');
    if (stage1?.effect.kind === 'damage-over-time' && stage1.effect.form === 'rounds') {
      expect(stage1.effect.rounds[0]?.damage).toBe(10);
    }

    session.advanceBy(800); // vence o estágio 1 (800 ms): o estágio 2, MUDO, entra.
    expect(ruleset.fields[0]?.stageIndex).toBe(2);
    expect(ruleset.fields[0]?.condition).toBeUndefined();

    const midEvents = session.drainEvents();
    expect(ofKind(midEvents, 'field-stage-changed').map((e) => e.stageIndex)).toEqual([1, 2]);

    session.advanceBy(600); // vence o último estágio: o campo desaparece de vez.
    expect(ruleset.fields).toHaveLength(0);
    expect(ofKind(session.drainEvents(), 'field-vanished')).toHaveLength(1);
  });

  it('campo bloqueante (Magic Wall) impede o passo do JOGADOR, como parede, e libera quando some', () => {
    const { session, hero, ruleset } = start({ health: 1_000_000 });
    const ahead = { x: hero.position.x + 1, y: hero.position.y, z: hero.position.z };
    const magicWall: FieldSpec = {
      id: 'magic-wall', durationMs: 500,
      shape: { shape: 'circle', radius: 0, centered: 'caster' },
      blocksMovement: true,
    };
    ruleset.applyField(session, magicWall, ahead);

    expect(ruleset.requestMove(session, hero.id, ahead)).toEqual({ ok: false, reason: 'tile-blocked' });
    expect(hero.position).not.toEqual(ahead);

    session.advanceBy(600); // vence: o campo some, sem `decayTo` (estágio único).
    expect(ruleset.fields).toHaveLength(0);
    expect(ruleset.requestMove(session, hero.id, ahead)).toMatchObject({ ok: true, to: ahead });
  });

  it('campo bloqueante impede o passo do MONSTRO igual — sem exceção de dano (ao contrário do desvio do M29-05)', () => {
    // Rato COMUM, sem `canWalkOnFire: false`: a M29-05 só desvia de campo com dano que o
    // monstro não pode encaixar — este bloqueio vale para QUALQUER monstro, porque mora em
    // `canOccupy`/`TileOccupancy.blockedAt`, não no predicado de desvio de dano.
    const stuckRoute = {
      id: 'wall-stuck-route', mapId: 'arena',
      tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
      spawnPoints: [{ routeIndex: 0, monsterId: 'rat', respawnDelayMs: 30_000 }],
    };
    const stuckHunt = {
      ...hunt, routeId: 'wall-stuck-route',
      difficulties: {
        cautious: {
          monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000,
        },
      },
    };
    const loaded = content({ routes: [stuckRoute], hunts: [stuckHunt] });
    const { session, ruleset } = start({ loaded });
    session.advanceBy(100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    monster.position = { x: 4, y: 1, z: 7 };
    // Uma parede de 3 tiles na coluna x=3, cobrindo as únicas rotas de fuga do monstro preso em
    // (4,1) rumo ao herói a oeste — a MESMA geometria do bloco M29-05 acima, mas SEM dano algum.
    ruleset.applyField(session, {
      id: 'wild-growth', durationMs: 9_999_999,
      shape: { shape: 'beam', length: 3 },
      blocksMovement: true,
    }, { x: 3, y: 0, z: 7 });

    run(session, 20_000, 100);
    expect(monster?.position.x).toBe(4); // nunca cruzou — bloqueado como parede.
  });
});

describe('runa de campo e parede do jogador (#591: Fire/Poison/Energy Field/Wall, Magic Wall, Wild Growth, Destroy Field)', () => {
  const fireFieldRune = {
    id: 'fire-field-591', name: 'Fire Field', price: 20, group: 'attack' as const,
    effect: {
      kind: 'field' as const, range: 8,
      field: {
        id: 'player-fire-591', durationMs: 20_000,
        shape: { shape: 'point' as const },
        condition: {
          key: 'burning', merge: 'strongest' as const, durationMs: 20_000,
          effect: {
            kind: 'damage-over-time' as const, form: 'rounds' as const,
            rounds: [{ count: 2, intervalMs: 10_000, damage: 20 }], damageType: 'fire' as const,
          },
        },
      },
    },
  };
  const fireWallRune = {
    id: 'fire-wall-591', name: 'Fire Wall', price: 32, group: 'attack' as const,
    effect: {
      kind: 'field' as const, range: 8,
      field: {
        id: 'player-fire-wall-591', durationMs: 20_000,
        shape: { shape: 'wall' as const, width: 3 },
        condition: fireFieldRune.effect.field.condition,
      },
    },
  };
  const magicWallRune = {
    id: 'magic-wall-591', name: 'Magic Wall', price: 45, group: 'attack' as const,
    effect: {
      kind: 'field' as const, range: 8,
      field: {
        id: 'player-magic-wall-591', durationMs: 20_000,
        shape: { shape: 'point' as const }, blocksMovement: true,
      },
    },
  };
  const destroyFieldRune = {
    id: 'destroy-field-591', name: 'Destroy Field', price: 10, group: 'support' as const,
    effect: { kind: 'destroy-field' as const, range: 5 },
  };
  const cast = (supplyId: string) => botConfigV2([{ do: { kind: 'supply' as const, supplyId }, auto: false }]);
  const at = (x: number, y: number): { readonly kind: 'position'; readonly position: { x: number; y: number; z: number } } =>
    ({ kind: 'position', position: { x, y, z: 7 } });

  it('planta o FieldSpec no tile mirado, debita o preço e trava o cooldown do grupo', () => {
    const { session, hero, ruleset } = withSpells(cast('fire-field-591'), {
      gold: 1_000, supplies: [...supplies, fireFieldRune], monsters: false,
    });
    expect(ruleset.useSlot(session, 'hero', 0, 0, at(3, 3))).toEqual({ ok: true });
    expect(hero.goldDelta).toBe(-20);
    expect(ruleset.fields).toHaveLength(1);
    expect(ruleset.fields[0]?.tiles).toEqual([{ x: 3, y: 3, z: 7 }]);
    expect(ruleset.fields[0]?.condition?.effect.kind).toBe('damage-over-time');
  });

  it('a MESMA runa em tiles DIFERENTES abre campos independentes — o segundo não move o primeiro', () => {
    const { session, ruleset } = withSpells(cast('fire-field-591'), {
      gold: 1_000, supplies: [...supplies, fireFieldRune], monsters: false,
    });
    expect(ruleset.useSlot(session, 'hero', 0, 0, at(3, 3))).toEqual({ ok: true });
    session.advanceBy(1_100); // fora do cooldown de grupo (1000ms default de `supplySchema`).
    expect(ruleset.useSlot(session, 'hero', 0, 0, at(3, 2))).toEqual({ ok: true });
    expect(ruleset.fields).toHaveLength(2);
  });

  it('relançar a MESMA runa no MESMO tile reinicia — nunca duplica', () => {
    const { session, ruleset } = withSpells(cast('fire-field-591'), {
      gold: 1_000, supplies: [...supplies, fireFieldRune], monsters: false,
    });
    expect(ruleset.useSlot(session, 'hero', 0, 0, at(3, 3))).toEqual({ ok: true });
    session.advanceBy(1_100);
    expect(ruleset.useSlot(session, 'hero', 0, 0, at(3, 3))).toEqual({ ok: true });
    expect(ruleset.fields).toHaveLength(1);
  });

  it('sem mira recusa `no-target`, sem debitar gold nem plantar campo', () => {
    const { session, hero, ruleset } = withSpells(cast('fire-field-591'), {
      gold: 1_000, supplies: [...supplies, fireFieldRune], monsters: false,
    });
    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
    expect(hero.goldDelta).toBe(0);
    expect(ruleset.fields).toHaveLength(0);
  });

  it('fora do alcance recusa `out-of-range`, sem debitar', () => {
    const { session, hero, ruleset } = withSpells(cast('fire-field-591'), {
      gold: 1_000, supplies: [...supplies, fireFieldRune], monsters: false,
    });
    expect(ruleset.useSlot(session, 'hero', 0, 0, at(50, 50))).toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
    expect(hero.goldDelta).toBe(0);
  });

  it('a parede (#591) se orienta PERPENDICULAR ao lançador→alvo, centrada no tile mirado', () => {
    const { session, hero, ruleset } = withSpells(cast('fire-wall-591'), {
      gold: 1_000, supplies: [...supplies, fireWallRune], monsters: false,
    });
    // O herói entra em (1,1); mirar dois tiles ao SUL é uma linha norte-sul — a parede corre
    // LESTE-OESTE, centrada no alvo.
    const target = { x: hero.position.x, y: hero.position.y + 2, z: 7 };
    expect(ruleset.useSlot(
      session, 'hero', 0, 0, { kind: 'position', position: target },
    )).toEqual({ ok: true });
    const tiles = ruleset.fields[0]?.tiles ?? [];
    expect(tiles).toHaveLength(3);
    expect(tiles).toContainEqual(target);
    expect(tiles.every((t) => t.y === target.y)).toBe(true);
    expect(new Set(tiles.map((t) => t.x))).toEqual(new Set([target.x - 1, target.x, target.x + 1]));
  });

  it('Magic Wall bloqueia jogador E monstro, como parede — some ao vencer', () => {
    const { session, hero, ruleset } = withSpells(cast('magic-wall-591'), {
      gold: 1_000, supplies: [...supplies, magicWallRune], monsters: false,
    });
    const ahead = { x: hero.position.x + 1, y: hero.position.y, z: hero.position.z };
    expect(ruleset.useSlot(session, 'hero', 0, 0, at(ahead.x, ahead.y))).toEqual({ ok: true });
    expect(ruleset.requestMove(session, hero.id, ahead)).toEqual({ ok: false, reason: 'tile-blocked' });

    session.advanceBy(21_000);
    expect(ruleset.fields).toHaveLength(0);
    expect(ruleset.requestMove(session, hero.id, ahead)).toMatchObject({ ok: true, to: ahead });
  });

  it('Destroy Field remove campo destrutível; recusa `no-target` sem campo (sem gastar); recusa remover campo bloqueante', () => {
    const threeRunes = botConfigV2([
      { do: { kind: 'supply' as const, supplyId: 'fire-field-591' }, auto: false },
      { do: { kind: 'supply' as const, supplyId: 'destroy-field-591' }, auto: false },
      { do: { kind: 'supply' as const, supplyId: 'magic-wall-591' }, auto: false },
    ]);
    const { session, hero, ruleset } = withSpells(threeRunes, {
      gold: 1_000, supplies: [...supplies, fireFieldRune, destroyFieldRune, magicWallRune],
      monsters: false,
    });
    // Sem campo nenhum no tile: recusa `no-target`, e o gold não sai.
    expect(ruleset.useSlot(session, 'hero', 0, 1, at(2, 2))).toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
    expect(hero.goldDelta).toBe(0);

    // Planta o fire field, depois destrói.
    expect(ruleset.useSlot(session, 'hero', 0, 0, at(2, 2))).toEqual({ ok: true });
    expect(ruleset.fields).toHaveLength(1);
    session.advanceBy(1_100);
    expect(ruleset.useSlot(session, 'hero', 0, 1, at(2, 2))).toEqual({ ok: true });
    expect(ruleset.fields).toHaveLength(0);

    // Magic Wall é bloqueante — Destroy Field recusa remover, como o Canary também não o lista.
    session.advanceBy(1_100);
    expect(ruleset.useSlot(session, 'hero', 0, 2, at(2, 2))).toEqual({ ok: true });
    expect(ruleset.fields).toHaveLength(1);
    session.advanceBy(1_100);
    expect(ruleset.useSlot(session, 'hero', 0, 1, at(2, 2))).toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
    expect(ruleset.fields).toHaveLength(1);
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
describe('reflexo e cleave do equipamento (#552, M30-05)', () => {
  const combatV3 = {
    ...combat, compatibilityProfile: 'combat-v3',
    weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
    distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
  };
  // O golpe desarmado do herói zerado: o único dano que chega ao rato é o que o teste mede.
  const passiveHeroV3 = [{ ...combatV3, player: { ...combatV3.player, attackPower: 0 } }];
  // O `reflectdamage` do Canary (Spiritthorn Helmet, 13): reflexo FLAT de físico, aqui 42.
  const thornHelmet = {
    id: 'thorn-helmet', name: 'Thorn Helmet', kind: 'armor', slot: 'head',
    weight: 1, value: 0, reflect: { physical: { flat: 42 } },
  };
  const withHelmet: InventoryState = {
    backpack: [], equipped: { head: { instanceId: 'h1', itemId: 'thorn-helmet', quantity: 1 } },
  };

  it('o rato que bate no herói leva de volta o reflexo, com o teto de 1 % da vida dele', () => {
    const { session } = withSpells(botConfig(), {
      health: 10_000, items: [...items, thornHelmet], inventory: withHelmet,
      combat: passiveHeroV3, monstersRaw: [{ ...rat, health: 500 }],
    });
    const events: DomainEvent[] = [];
    run(session, 10_000, 100);
    events.push(...session.drainEvents());
    const ratHits = ofKind(events, 'creature-hit').filter((e) => e.creatureId === 'hero');
    const reflected = ofKind(events, 'creature-hit')
      .filter((e) => e.attackerId === 'hero' && e.amount > 0);
    expect(ratHits.length).toBeGreaterThan(0);
    // 42 flat, mas o teto é ceil(500 × 1 %) = 5 — um reflexo por golpe do rato, todos de 5.
    expect(reflected.length).toBe(ratHits.length);
    expect(reflected.every((e) => e.amount === 5)).toBe(true);
  });

  it('o reflexo que mata o rato resolve a morte (abate, sem golpe do herói)', () => {
    const { session } = withSpells(botConfig(), {
      health: 10_000, items: [...items, thornHelmet], inventory: withHelmet,
      combat: passiveHeroV3, monstersRaw: [{ ...rat, health: 1 }],
    });
    run(session, 10_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
  });

  it('sem o combat-v3, o mesmo capacete não reflete nada', () => {
    const { session } = withSpells(botConfig(), {
      health: 10_000, items: [...items, thornHelmet], inventory: withHelmet,
      combat: [{ ...combat, player: { ...combat.player, attackPower: 0 } }],
      monstersRaw: [{ ...rat, health: 500 }],
    });
    run(session, 10_000, 100);
    const reflected = ofKind(session.drainEvents(), 'creature-hit')
      .filter((e) => e.attackerId === 'hero' && e.amount > 0);
    expect(reflected).toHaveLength(0);
  });

  it('o cleave acerta o monstro no tile que flanqueia o alvo, com a fração da rolagem própria', () => {
    const cleaveSword = {
      id: 'cleave-sword', name: 'Cleave Sword', kind: 'weapon', slot: 'hand',
      weight: 1, value: 0, attack: 200, cleavePercent: 50,
    };
    const withSword: InventoryState = {
      backpack: [], equipped: { hand: { instanceId: 's1', itemId: 'cleave-sword', quantity: 1 } },
    };
    const { session, hero, ruleset } = withSpells(botConfig(), {
      health: 10_000, items: [...items, cleaveSword], inventory: withSword,
      combat: [combatV3],
      monstersRaw: [{ ...rat, attack: 0, aggroRadius: 0, health: 1_000_000 }],
    }, 'bold');
    session.advanceBy(50);
    const [a, b, c] = ruleset.monsters;
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    // Herói em (1, 1): `a` a leste é o alvo, `b` em (2, 2) é o tile ao SUL do alvo — o que o
    // cleave de um alvo na mesma linha acerta. `c` longe, fora de tudo.
    hero.position = { x: 1, y: 1, z: hero.position.z };
    plant(a, { x: 2, y: 1 });
    plant(b, { x: 2, y: 2 });
    plant(c, { x: 4, y: 3 });
    vi.mocked(resolveDamage).mockClear();
    run(session, 4_000, 100);

    const calls = vi.mocked(resolveDamage).mock.calls;
    const cleaves = calls.filter(([intent]) => intent.extension === true && intent.source === 'basic-attack');
    const mains = calls.filter(([intent]) => intent.extension !== true && intent.source === 'basic-attack');
    expect(cleaves.length).toBeGreaterThan(0);
    expect(cleaves.length).toBe(mains.length);
    // Extensão: sem crítico e sem leech (nenhum `modifiers` declarado sem aumento por tipo).
    expect(cleaves.every(([intent]) => intent.modifiers === undefined)).toBe(true);
    const hitRats = new Set(ofKind(session.drainEvents(), 'creature-hit')
      .filter((e) => e.attackerId === 'hero').map((e) => e.creatureId));
    expect(hitRats).toEqual(new Set([a.subject, b.subject]));
  });

  it('o cleave de arma com elemento (#687) leva o secundário na mesma fração (integração)', () => {
    // `internalUseWeapon` do Canary: a fração do cleave corta o físico E o elemento, e o
    // elemento vai como secundário sem escudo nem armadura, como no golpe principal.
    const fireCleaver = {
      id: 'fire-cleaver', name: 'Fire Cleaver', kind: 'weapon', slot: 'hand',
      weight: 1, value: 0, attack: 200, cleavePercent: 50,
      weapon: { kind: 'melee', element: { type: 'fire', attack: 100 } },
    };
    const withCleaver: InventoryState = {
      backpack: [], equipped: { hand: { instanceId: 's1', itemId: 'fire-cleaver', quantity: 1 } },
    };
    const { session, hero, ruleset } = withSpells(botConfig(), {
      health: 10_000, items: [...items, fireCleaver], inventory: withCleaver,
      combat: [combatV3],
      monstersRaw: [{ ...rat, attack: 0, aggroRadius: 0, health: 1_000_000 }],
    }, 'bold');
    session.advanceBy(50);
    const [a, b, c] = ruleset.monsters;
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    hero.position = { x: 1, y: 1, z: hero.position.z };
    plant(a, { x: 2, y: 1 });
    plant(b, { x: 2, y: 2 });
    plant(c, { x: 4, y: 3 });
    vi.mocked(resolveDamage).mockClear();
    run(session, 4_000, 100);

    const calls = vi.mocked(resolveDamage).mock.calls;
    const cleaves = calls.filter(([intent]) => intent.extension === true && intent.source === 'basic-attack');
    expect(cleaves.length).toBeGreaterThan(0);
    const withElement = cleaves.filter(([intent]) => intent.secondary !== undefined);
    expect(withElement.length).toBeGreaterThan(0);
    for (const [intent] of withElement) {
      expect(intent.secondary?.damageType).toBe('fire');
      expect(intent.secondary?.blockable).toEqual(MAGIC_BLOCK_FLAGS);
    }
  });
});
describe('cura por elemento e reflexo do monstro (#683, M30-G6)', () => {
  const combatV3 = {
    ...combat, compatibilityProfile: 'combat-v3',
    weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
    distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
  };
  // O herói não bate de mão: o único golpe no rato é a magia de fogo, a cada 1,5 s.
  const passiveHeroV3 = { ...combatV3, player: { ...combatV3.player, attackPower: 0 } };
  const fireBolt = {
    id: 'fire-bolt', name: 'Fire Bolt', manaCost: 15, cooldownMs: 1_500,
    effect: { kind: 'damage', power: 40, range: 3, damageType: 'fire' },
  };
  const castFireBolt = () => botConfig({
    attack: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'fire-bolt' } }],
  });
  // Rato inofensivo e parado: o que acontece com a vida dele é só a magia e a cura.
  const healingRat = (over: Record<string, unknown>) => ({
    ...rat, attack: 0, speed: 1, health: 1_000, elementHealing: { fire: 100 }, ...over,
  });

  const castOn = (combatProfile: unknown, monster: unknown, health: number) => {
    const { session, ruleset } = withSpells(castFireBolt(), {
      spells: [fireBolt], combat: [combatProfile], monstersRaw: [monster],
    });
    // O primeiro lançamento sai já na entrada; a vida é escrita depois dele, e só o que vem
    // depois conta.
    session.advanceBy(50);
    for (const spawned of ruleset.monsters) spawned.health = health;
    session.drainEvents();
    vi.mocked(resolveDamage).mockClear();
    run(session, 2_000, 100);
    return { session, ruleset, events: session.drainEvents() };
  };

  it('imune a fogo, o monstro não perde vida e CURA ceil(dano bruto) — depois do creature-hit', () => {
    const { events } = castOn(
      passiveHeroV3, healingRat({ mitigation: { immunities: ['fire'] } }), 500,
    );
    const spellHits = ofKind(events, 'creature-hit')
      .filter((e) => e.attackerId === 'hero' && e.damageType === 'fire');
    expect(spellHits.length).toBeGreaterThan(0);
    expect(spellHits.every((e) => e.amount === 0)).toBe(true);
    const outcomes = vi.mocked(resolveDamage).mock.results
      .map((r) => r.value as DamageOutcome)
      .filter((o) => o.damageType === 'fire' && o.intent.source === 'spell');
    const first = outcomes[0];
    if (first === undefined) throw new Error('a magia não foi resolvida');
    expect(first.elementHealing).toBe(Math.ceil(first.intent.rawDamage));
    const healed = ofKind(events, 'creature-healed').filter((e) => e.source === 'monster');
    expect(healed[0]?.amount).toBe(first.elementHealing);
    // A ordem: o golpe (0) sai antes da cura que ele provocou.
    const hitIndex = events.indexOf(spellHits[0] as DomainEvent);
    const healIndex = events.indexOf(healed[0] as DomainEvent);
    expect(healIndex).toBeGreaterThan(hitIndex);
  });

  it('o golpe que mata não cura: nenhum creature-healed', () => {
    const { events, session } = castOn(passiveHeroV3, healingRat({}), 1);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    const killed = new Set(ofKind(events, 'creature-hit')
      .filter((e) => e.attackerId === 'hero' && e.amount > 0).map((e) => e.creatureId));
    expect(killed.size).toBeGreaterThan(0);
    expect(ofKind(events, 'creature-healed').filter((e) => killed.has(e.creatureId))).toHaveLength(0);
  });

  it('sem o combat-v3 o mesmo monstro não cura', () => {
    const passiveV1 = { ...combat, player: { ...combat.player, attackPower: 0 } };
    const { events } = castOn(passiveV1, healingRat({}), 500);
    expect(ofKind(events, 'creature-hit').some((e) => e.attackerId === 'hero' && e.amount > 0)).toBe(true);
    expect(ofKind(events, 'creature-healed').filter((e) => e.source === 'monster')).toHaveLength(0);
    const outcomes = vi.mocked(resolveDamage).mock.results.map((r) => r.value as DamageOutcome);
    expect(outcomes.every((o) => !('elementHealing' in o) && o.reflected === undefined)).toBe(true);
  });

  it('o reflexo físico do monstro volta ao herói com o teto de 1 % da vida máxima dele', () => {
    const { session, hero } = withSpells(botConfig(), {
      health: 10_000, combat: [combatV3],
      monstersRaw: [{ ...rat, attack: 0, health: 1_000_000, reflect: { physical: 50 } }],
    });
    run(session, 10_000, 100);
    const events = session.drainEvents();
    const heroHits = ofKind(events, 'creature-hit')
      .filter((e) => e.attackerId === 'hero' && e.amount > 0);
    const reflected = ofKind(events, 'creature-hit')
      .filter((e) => e.creatureId === 'hero' && e.attackerId !== 'hero' && e.amount > 0);
    expect(heroHits.length).toBeGreaterThan(0);
    // Um reflexo por golpe do herói, cada um no máximo ceil(1 % da vida máxima) e no máximo
    // metade do golpe — o rato não bate (attack 0), então todo dano no herói é reflexo.
    const cap = Math.ceil(hero.maxHealth / 100);
    expect(reflected.length).toBe(heroHits.length);
    expect(reflected.every((e) => e.amount > 0 && e.amount <= cap && e.damageType === 'physical')).toBe(true);
    // Reflexo sobre reflexo nunca: nenhuma resolução de extensão contra o monstro.
    const extensionsOnMonster = vi.mocked(resolveDamage).mock.calls
      .filter(([intent]) => intent.extension === true && intent.source === 'reflect'
        && intent.neutral === true);
    expect(extensionsOnMonster).toHaveLength(0);
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
      ...progression, startingMana: 200, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
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
        routes: [{ ...route, spawnPoints: [{ routeIndex: 5, radius: 1, monsterId: 'rat', respawnDelayMs: 30_000 }] }],
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
    progression: [{ ...progression, regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } } }],
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

describe('duração do anel por instância: pausa fora do dedo (#689)', () => {
  // O `time-ring` da fixture dura 4000 ms VESTIDO. Os instantes abaixo são múltiplos de 1000
  // para a mesma sequência rodar a 1 Hz e a 10 Hz (tempo lógico, invariante 3).
  const rules = { backpackSlots: 0, satchelSlots: 20, row: 1 };
  const twoRings: InventoryState = {
    backpack: [
      { instanceId: 'r1', itemId: 'time-ring', quantity: 1 },
      { instanceId: 'r2', itemId: 'time-ring', quantity: 1 },
    ],
    equipped: {},
  };
  const find = (hero: CharacterRuntime, id: string) => [...hero.inventory.items()].find((i) => i.instanceId === id);

  /** Avança até `untilMs` em passos de `stepMs`, anotando quando o dedo esvaziou. */
  const advanceTo = (session: Session, hero: CharacterRuntime, untilMs: number, stepMs: number, seen: { atMs: number }) => {
    while (session.nowMs < untilMs && session.ended === null) {
      session.advanceBy(stepMs);
      if (seen.atMs < 0 && hero.inventory.equippedAt('finger') === null) seen.atMs = session.nowMs;
    }
  };

  it('tirar pausa e vestir retoma: vence no restante, não no prazo cheio (RF-02), igual a 1 Hz e a 10 Hz', () => {
    const scenario = (stepMs: number) => {
      const loaded = content();
      const { session, hero } = start({ loaded, inventory: twoRings });
      const seen = { atMs: -1 };
      expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
      advanceTo(session, hero, 1_000, stepMs, seen);
      expect(hero.inventory.unequip('finger', rules).ok).toBe(true);
      expect(find(hero, 'r1')?.overlay).toEqual({ durationRemainingMs: 3_000 });
      // Fora do dedo o tempo não corre: 2 s depois, o restante é o mesmo.
      advanceTo(session, hero, 3_000, stepMs, seen);
      expect(find(hero, 'r1')?.overlay).toEqual({ durationRemainingMs: 3_000 });
      expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
      seen.atMs = -1;
      advanceTo(session, hero, 8_000, stepMs, seen);
      const expired = session.drainEvents().filter((e) => e.kind === 'equipment-changed');
      return { atMs: seen.atMs, expired: expired.length, state: hero.inventory.getState(), snapshot: session.snapshot() };
    };
    const tenHz = scenario(100);
    const oneHz = scenario(1_000);
    // Mutação que mata: reagendar `durationMs` cheio no equip — venceria em 7000, não em 6000.
    expect(tenHz.atMs).toBe(6_000);
    expect(tenHz.expired).toBeGreaterThan(0);
    expect(oneHz.atMs).toBe(tenHz.atMs);
    expect(oneHz.state).toEqual(tenHz.state);
    expect(oneHz.snapshot).toEqual(tenHz.snapshot);
  });

  it('vence no instante exato do restante (RF-02, a 10 Hz)', () => {
    const loaded = content();
    const { session, hero } = start({ loaded, inventory: twoRings });
    expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
    session.advanceBy(1_500);
    expect(hero.inventory.unequip('finger', rules).ok).toBe(true);
    session.advanceBy(10_000);
    expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
    session.advanceBy(2_499);
    expect(hero.inventory.equippedAt('finger')?.instanceId).toBe('r1');
    session.advanceBy(1);
    expect(hero.inventory.equippedAt('finger')).toBeNull();
    expect(find(hero, 'r1')).toBeUndefined();
  });

  it('troca direta anel → anel guarda o restante do que saiu (RF-03)', () => {
    const loaded = content();
    const { session, hero } = start({ loaded, inventory: twoRings });
    expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
    session.advanceBy(1_000);
    // r2 entra no lugar de r1 sem `unequip`: é o `previous` do `onEquip`.
    expect(hero.inventory.equip('r2', hero, loaded.items).ok).toBe(true);
    expect(find(hero, 'r1')?.overlay).toEqual({ durationRemainingMs: 3_000 });
    session.advanceBy(1_000);
    expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
    expect(find(hero, 'r2')?.overlay).toEqual({ durationRemainingMs: 3_000 });
    // r1 retoma os 3000 que sobraram: vence em 2000 + 3000.
    session.advanceBy(2_999);
    expect(hero.inventory.equippedAt('finger')?.instanceId).toBe('r1');
    session.advanceBy(1);
    expect(hero.inventory.equippedAt('finger')).toBeNull();
    expect(find(hero, 'r2')?.overlay).toEqual({ durationRemainingMs: 3_000 });
  });

  it('o restante guardado atravessa o snapshot (RF-04)', () => {
    const loaded = content();
    const { session, hero } = start({ loaded, inventory: twoRings });
    expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
    session.advanceBy(1_000);
    expect(hero.inventory.unequip('finger', rules).ok).toBe(true);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed(snapshot.id),
    );
    const resumedHero = resumed.participants[0] as CharacterRuntime;
    expect(find(resumedHero, 'r1')?.overlay).toEqual({ durationRemainingMs: 3_000 });
    expect(resumedHero.inventory.equip('r1', resumedHero, loaded.items).ok).toBe(true);
    resumed.advanceBy(2_999);
    expect(resumedHero.inventory.equippedAt('finger')?.instanceId).toBe('r1');
    resumed.advanceBy(1);
    expect(resumedHero.inventory.equippedAt('finger')).toBeNull();
  });

  it('o anel vestido no fim da hunt guarda o restante, e a próxima hunt retoma dele', () => {
    // Sem isto, sair e voltar renovaria o anel de graça: o evento morre com a sessão.
    const loaded = content();
    const first = start({ loaded, inventory: twoRings });
    expect(first.hero.inventory.equip('r1', first.hero, loaded.items).ok).toBe(true);
    first.session.advanceBy(1_000);
    first.session.end('manual-exit');
    expect(first.hero.inventory.equippedAt('finger')?.overlay).toEqual({ durationRemainingMs: 3_000 });

    const second = start({ loaded, inventory: first.hero.inventory.getState() });
    second.session.advanceBy(2_999);
    expect(second.hero.inventory.equippedAt('finger')?.instanceId).toBe('r1');
    second.session.advanceBy(1);
    expect(second.hero.inventory.equippedAt('finger')).toBeNull();
  });

  it('o restante preserva os outros campos do overlay (ADR 0046)', () => {
    const loaded = content();
    const imbued = { imbuements: [{ slot: 0, typeId: 'x', remainingMs: 10 }] };
    const { session, hero } = start({
      loaded,
      inventory: { backpack: [{ instanceId: 'r1', itemId: 'time-ring', quantity: 1, overlay: imbued }], equipped: {} },
    });
    expect(hero.inventory.equip('r1', hero, loaded.items).ok).toBe(true);
    session.advanceBy(500);
    expect(hero.inventory.unequip('finger', rules).ok).toBe(true);
    expect(find(hero, 'r1')?.overlay).toEqual({ ...imbued, durationRemainingMs: 3_500 });
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

// --- a mira do disparo manual (ADR 0049 decisão 2, #725) -------------------------------------

describe('mira do disparo manual (ADR 0049 decisão 2, #725)', () => {
  // `session.enter` reposiciona quem entra (o hero na rota, o segundo por `placeNear` —
  // AGENTS.md de `sim`); a posição do construtor NUNCA é a final. As distâncias aqui são
  // relativas à posição REAL depois de entrar, como `walkTo`/mutação direta já fazem alhures
  // neste arquivo (`monster.position = {...}` depois de `session.enter`).
  const newAlly = (id: string, health: number, maxHealth: number): CharacterRuntime =>
    new CharacterRuntime({
      id, position: { x: 0, y: 0, z: 7 },
      health, maxHealth, mana: 0, maxMana: 0,
      level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });

  it('monstro mirado fora do alcance recusa `out-of-range`, não `no-target` (RF-10)', () => {
    // `strike` tem alcance 3; o rato está vivo, existe, e é a intenção do jogador — a recusa
    // certa diz POR QUE não saiu, não o genérico de "nada para acertar".
    const { session, hero, ruleset } = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'strike' }, auto: false }]),
      { mana: 200 },
    );
    session.advanceBy(1);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    monster.position = { x: hero.position.x + 10, y: hero.position.y, z: hero.position.z };

    expect(ruleset.useSlot(session, 'hero', 0, 0, { kind: 'monster', subject: monsterSubject(monster.id) }))
      .toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
    expect(hero.mana).toBe(200); // recusado ANTES da mana — não gastou, não lançou.
  });

  it('monstro mirado que não existe mais recusa `no-target` (RF-10)', () => {
    const { session, hero, ruleset } = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'strike' }, auto: false }]),
      { mana: 200, monsters: false },
    );
    expect(ruleset.useSlot(session, 'hero', 0, 0, { kind: 'monster', subject: monsterSubject(9_999) }))
      .toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
    expect(hero.mana).toBe(200);
  });

  it('cura mirada num ALIADO ao alcance cura o aliado, nunca o lançador (RF-11)', () => {
    const friendHeal = {
      id: 'friend-heal-725', name: 'Cura Amiga', manaCost: 20, cooldownMs: 1_000,
      effect: { kind: 'heal' as const, amount: 60, target: 'friend' as const, range: 3 },
    };
    const { session, hero, ruleset } = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'friend-heal-725' }, auto: false }]),
      { health: 1_000, mana: 200, spells: [...spells, friendHeal], monsters: false },
    );
    const ally = newAlly('ally', 100, 1_000);
    session.enter(ally);
    ally.position = { x: hero.position.x + 1, y: hero.position.y, z: hero.position.z };

    expect(ruleset.useSlot(session, 'hero', 0, 0, { kind: 'character', characterId: 'ally' }))
      .toEqual({ ok: true });
    expect(ally.health).toBe(160);
    expect(hero.health).toBe(1_000); // o lançador NÃO se curou — o alvo mirado é quem recebe.
  });

  it('aliado mirado fora do alcance da cura recusa `out-of-range` (RF-11)', () => {
    const friendHeal = {
      id: 'friend-heal-725', name: 'Cura Amiga', manaCost: 20, cooldownMs: 1_000,
      effect: { kind: 'heal' as const, amount: 60, target: 'friend' as const, range: 3 },
    };
    const { session, hero, ruleset } = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'friend-heal-725' }, auto: false }]),
      { health: 1_000, mana: 200, spells: [...spells, friendHeal], monsters: false },
    );
    const ally = newAlly('ally', 100, 1_000);
    session.enter(ally);
    ally.position = { x: hero.position.x + 10, y: hero.position.y, z: hero.position.z };

    expect(ruleset.useSlot(session, 'hero', 0, 0, { kind: 'character', characterId: 'ally' }))
      .toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
  });

  it('`target` numa ação sem alvo mirável (self-only) é ignorado, sem recusa nova (RF-12)', () => {
    // `heal` (fixture de topo) não tem `target: 'friend'` nem é dano: é a cura de si mesmo de
    // sempre. Mandar um `target` não muda nada — nem recusa, nem redireciona — nem quando o
    // `subject` não resolve para monstro nenhum: `#needsTarget` já descarta a ação ANTES de
    // tentar resolver. `monsters: false` evita que o rato bata primeiro e confunda a conta.
    const withTarget = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'heal' }, auto: false }]),
      { health: 100, mana: 200, monsters: false },
    );
    expect(withTarget.ruleset.useSlot(
      withTarget.session, 'hero', 0, 0, { kind: 'monster', subject: monsterSubject(9_999) },
    )).toEqual({ ok: true });
    expect(withTarget.hero.health).toBe(160); // curou A SI MESMO — o `target` foi ruído.

    const without = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'heal' }, auto: false }]),
      { health: 100, mana: 200, monsters: false },
    );
    expect(without.ruleset.useSlot(without.session, 'hero', 0, 0)).toEqual({ ok: true });
    expect(without.hero.health).toBe(160); // MESMO resultado, com ou sem `target`.
  });

  it('magia de área centrada no LANÇADOR ignora `target` (RF-13)', () => {
    const wave = {
      id: 'wave-725', name: 'Onda', manaCost: 10, cooldownMs: 500,
      effect: {
        kind: 'damage' as const, power: 40, damageType: 'fire' as const,
        area: { shape: 'wave' as const, length: 3 },
      },
    };
    const { session, hero, ruleset } = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'wave-725' }, auto: false }]),
      { mana: 200, spells: [...spells, wave] },
    );
    session.advanceBy(1);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    // À frente do herói, na direção que ele estiver olhando depois de andar 1 ms de rota —
    // dentro do comprimento 3 da onda.
    const f = FORWARD[hero.direction];
    monster.position = { x: hero.position.x + f.x, y: hero.position.y + f.y, z: hero.position.z };
    const before = monster.health;

    // O `target` mira um monstro FORA da onda (bem longe) — se fosse respeitado, a onda não
    // acertaria ninguém. Como a decisão 2 do ADR 0049 manda ignorá-lo em área self-origin, o
    // golpe sai igual ao de sempre, sobre quem está na forma.
    expect(ruleset.useSlot(
      session, 'hero', 0, 0, { kind: 'position', position: { x: -50, y: -50, z: 7 } },
    )).toEqual({ ok: true });
    expect(monster.health).toBeLessThan(before);
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

  it('seleciona monstro no alcance da arma como alvo de ataque sem clique manual', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    a.position = { x: hero.position.x + 1, y: hero.position.y };
    b.position = { x: hero.position.x + 15, y: hero.position.y };
    c.position = { x: hero.position.x + 16, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');

    expect(ruleset.attackTargetOf(hero)?.subject).toBe(a.subject);
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(a.subject);
    expect(ruleset.getState().runners?.[hero.id]?.chosenTargetPinned).toBeUndefined();
  });

  it('monstro mais próximo toma precedência sobre alvo distante quando não está pinado', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    a.position = { x: hero.position.x + 5, y: hero.position.y };
    b.position = { x: hero.position.x + 8, y: hero.position.y };
    c.position = { x: hero.position.x + 9, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');

    expect(chosenOf(ruleset, hero.id)).toBe(a.subject);
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(a.subject);

    b.position = { x: hero.position.x + 1, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');
    expect(ruleset.attackTargetOf(hero)?.subject).toBe(b.subject);
    expect(chosenOf(ruleset, hero.id)).toBe(b.subject);
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(b.subject);
  });

  it('alvo pinado manualmente é preservado mesmo se outro monstro surgir mais perto', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    a.position = { x: hero.position.x + 3, y: hero.position.y };
    b.position = { x: hero.position.x + 6, y: hero.position.y };
    c.position = { x: hero.position.x + 7, y: hero.position.y };

    ruleset.setAttackTarget(hero, a);
    expect(ruleset.getState().runners?.[hero.id]?.chosenTargetPinned).toBe(true);
    expect(chosenOf(ruleset, hero.id)).toBe(a.subject);

    b.position = { x: hero.position.x + 1, y: hero.position.y };
    ruleset.configureBot(session, botConfigV2([]), 'hero');

    expect(chosenOf(ruleset, hero.id)).toBe(a.subject);
    expect(ruleset.getState().runners?.[hero.id]?.chosenTargetPinned).toBe(true);
  });

  it('requestMove adquire o monstro próximo como alvo e arma o ataque ao dar um passo', () => {
    const { session, hero, ruleset } = withSpells(botConfigV2([]), { mana: 200 }, 'bold');
    session.advanceBy(1);
    const [a, b, c] = [...ruleset.monsters];
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltam ratos');
    expect(hero.position).toEqual({ x: 2, y: 1, z: 7 });

    // Afasta outros monstros
    b.position = { x: 30, y: 30, z: 7 };
    c.position = { x: 31, y: 31, z: 7 };

    // Coloca 'a' a 2 tiles de distância (em 2, 3)
    a.position = { x: 2, y: 3, z: 7 };
    // Hero anda um passo para o sul (2, 2), ficando adjacente a 'a' (2, 3)
    const res = ruleset.requestMove(session, hero.id, { x: 2, y: 2 });
    expect(res.ok).toBe(true);
    expect(hero.position).toEqual({ x: 2, y: 2, z: 7 });

    // Agora 'a' está no alcance da arma (Chebyshev 1)
    expect(ruleset.attackTargetOf(hero)?.subject).toBe(a.subject);
    expect(ruleset.selectedTargetOf(hero)?.subject).toBe(a.subject);
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
    // é só sobre o walker, e nada precisa nascer.
    spawnPoints: [],
  };
  const multiFloorHunt = {
    id: 'arena', name: 'Casa', recommendedLevel: 1, mapId: 'casa', routeId: 'casa-loop',
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
      spawnPoints: [{ routeIndex: 1, radius: 1, at: { x: 1, y: 2, z: 6 }, monsterId: 'rat', respawnDelayMs: 30_000 }],
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

describe('stairhop: trava de ataque ao trocar de andar (#554, M30-07, ADR 0040 decisão 1)', () => {
  // O mesmo par de andares e a mesma geometria do #519: descer em (2,1,7) pousa em (3,1,6),
  // subir em (3,2,6) pousa em (2,2,7). O rato nasce EM CIMA do degrau de subida — é o segundo
  // tile que o walker persegue depois de descer, e ele fica permanentemente ocupado, então a
  // travessia de volta nunca acontece dentro da janela deste teste (bem menor que os ~500 ms
  // que o walker levaria para sequer tentar o segundo passo).
  const stairsMap = {
    id: 'casa-554', z: 7,
    floors: {
      '7': { grid: ['######', '#....#', '#....#', '######'] },
      '6': { grid: ['######', '#....#', '#....#', '######'] },
    },
    floorChanges: [
      { from: { x: 2, y: 1, z: 7 }, to: { x: 3, y: 1, z: 6 } },
      { from: { x: 3, y: 2, z: 6 }, to: { x: 2, y: 2, z: 7 } },
    ],
  };
  const stairsRoute = {
    id: 'casa-554-loop', mapId: 'casa-554',
    tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 2, z: 6 }],
    spawnPoints: [{
      routeIndex: 2, radius: 1, at: { x: 3, y: 2, z: 6 }, monsterId: 'rat', respawnDelayMs: 300_000,
    }],
  };
  const stairsHunt = {
    // `id: 'arena'` porque `start()` (o helper deste arquivo) sempre pede `huntId: 'arena'` —
    // `content({ hunts: [...] })` SUBSTITUI a lista inteira, então não há colisão com a hunt
    // padrão do topo do arquivo.
    id: 'arena', name: 'Casa', recommendedLevel: 1, mapId: 'casa-554', routeId: 'casa-554-loop',
    difficulties: {
      cautious: { monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 300_000 },
    },
  };
  // O mesmo `combatV3` do #548 acima (`weaponDamage`/`distanceHitChance` mínimos exigidos pelo
  // perfil), com `stairhopDelayMs` — a issue declara 2000, o número real da baseline.
  const combatV3 = {
    ...combat, compatibilityProfile: 'combat-v3',
    weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
    distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    stairhopDelayMs: 2_000,
  };
  const stairsContent = (): Content => content({
    maps: [stairsMap], routes: [stairsRoute], hunts: [stairsHunt], combat: [combatV3],
  });

  it('descer a escada trava o golpe por 2 s: nada antes, e o golpe volta no PENSAMENTO seguinte ao destravamento', () => {
    const { session, hero, ruleset } = start({ loaded: stairsContent() });
    // t=0: SPAWN e o primeiro PLAYER_STEP vencem no mesmo instante (a hunt entra pronta) — o
    // rato já nasceu no degrau de subida, adjacente ao pouso da descida, e o walker já desceu.
    session.advanceBy(1);
    expect(hero.position).toEqual({ x: 3, y: 1, z: 6 });
    // A trava é a condição `pacified` de verdade (M44-04, #622), com o prazo de 2 s.
    expect(hero.conditions.get('pacified')).toMatchObject({ key: 'pacified', expiresAtMs: 2_000, merge: 'longest' });
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    const fullHealth = monster.health;

    // Ainda travado: avança quase até o destravamento e o rato continua intacto.
    session.advanceBy(1_998);
    expect(monster.health).toBe(fullHealth);

    // Destravado: o Canary NÃO re-arma o ataque quando `pacified` acaba (`Player::doAttacking`
    // volta e a cadeia morre) — o golpe sai no primeiro gatilho depois, o pensamento do
    // personagem (1 Hz, numa fase própria), até 1000 ms depois do vencimento.
    for (let waited = 0; monster.health === fullHealth && waited < 1_100; waited += 1) session.advanceBy(1);
    const phase = ruleset.getState().runners?.[hero.id]?.thinkPhaseMs;
    if (phase === undefined) throw new Error('o personagem devia ter uma fase de pensamento');
    expect(session.nowMs).toBe(2_000 + ((((phase - 2_000) % 1_000) + 1_000) % 1_000));
    expect(monster.health).toBeLessThan(fullHealth);
  });

  it('sem `stairhopDelayMs` declarado, a travessia não trava nada (ausente é identidade)', () => {
    const combatV3SemStairhop = { ...combatV3, stairhopDelayMs: undefined };
    const { session, hero, ruleset } = start({
      loaded: content({
        maps: [stairsMap], routes: [stairsRoute], hunts: [stairsHunt], combat: [combatV3SemStairhop],
      }),
    });
    // Sem trava, o golpe SAI dentro deste mesmo `advanceBy` — a asserção compara com a vida
    // CHEIA do conteúdo (`rat.health`), não com uma leitura de DEPOIS do golpe já ter saído.
    session.advanceBy(1);
    expect(hero.position).toEqual({ x: 3, y: 1, z: 6 });
    expect(hero.conditions.get('pacified')).toBeNull();
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    expect(monster.health).toBeLessThan(rat.health);
  });

  it('sob combat-v1/v2, a travessia não trava nada mesmo com `stairhopDelayMs` no conteúdo', () => {
    // Defensivo: só o `combat-v3` lê o campo. Um conteúdo v1/v2 que o declarasse por engano
    // continua bit a bit.
    const { session, hero, ruleset } = start({
      loaded: content({
        maps: [stairsMap], routes: [stairsRoute], hunts: [stairsHunt],
        combat: [{ ...combat, stairhopDelayMs: 2_000 }],
      }),
    });
    session.advanceBy(1);
    expect(hero.conditions.get('pacified')).toBeNull();
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('faltou rato');
    expect(monster.health).toBeLessThan(rat.health);
  });
});

describe('stairhop: magia agressiva recusa, cura não (#554, M30-07)', () => {
  const combatV3 = {
    ...combat, compatibilityProfile: 'combat-v3',
    weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
    distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
    stairhopDelayMs: 2_000,
  };

  it('`strike` (dano) recusa com `attack-locked` e o prazo exato — a mana não sai', () => {
    const { session, hero, ruleset } = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'strike' }, auto: false }]),
      { mana: 200, monsters: false, combat: [combatV3] },
    );
    hero.conditions.apply({ key: 'pacified', expiresAtMs: 1_500, merge: 'longest' });

    expect(ruleset.useSlot(session, 'hero', 0, 0))
      .toEqual({ ok: false, reason: 'attack-locked', retryInMs: 1_500 });
    expect(hero.mana).toBe(200);
  });

  it('`heal` continua liberada com a MESMA trava ativa — a exceção do Canary para o que não é agressivo', () => {
    const { session, hero, ruleset } = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'heal' }, auto: false }]),
      { health: 100, mana: 200, monsters: false, combat: [combatV3] },
    );
    hero.conditions.apply({ key: 'pacified', expiresAtMs: 1_500, merge: 'longest' });

    expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
    expect(hero.health).toBe(160);
    expect(hero.mana).toBe(180);
  });

  it('sob combat-v1/v2 a MESMA condição também bloqueia — a trava de escada é que só existe no v3', () => {
    // O portão é a condição, em qualquer perfil (#622): um `pacified` que o conteúdo aplica (o
    // Swift Foot) vale numa sessão v1/v2. O que continua exclusivo do `combat-v3` é a trava de
    // ESCADA (`#step` só a aplica lá) — coberto pelo teste "sob combat-v1/v2, a travessia não
    // trava nada", acima.
    const { session, hero, ruleset } = withSpells(
      botConfigV2([{ do: { kind: 'spell', spellId: 'strike' }, auto: false }]),
      { mana: 200, monsters: false },
    );
    hero.conditions.apply({ key: 'pacified', expiresAtMs: 1_500, merge: 'longest' });

    expect(ruleset.useSlot(session, 'hero', 0, 0))
      .toEqual({ ok: false, reason: 'attack-locked', retryInMs: 1_500 });
    expect(hero.mana).toBe(200);
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

  const dwarvenRing: InventoryState = {
    backpack: [],
    equipped: { finger: { instanceId: 'dwarven', itemId: 'dwarven-ring', quantity: 1 } },
  };

  it('item com `suppress: [drunk]` (#688): o drunk já ativo não desvia nem consome sorteio', () => {
    const rng = new CountingRng(Rng.fromSeed('drunk-suppressed').getState());
    const loaded = content({ monsters: [{ ...rat, aggroRadius: 0 }] });
    const ruleset = createHuntRuleset(loaded, 'arena', 'cautious');
    const session = new Session({
      id: 'drunk-688', contentVersion: loaded.version, ruleset, rng, createdAtMs: 0,
    });
    const hero = character({ inventory: dwarvenRing });
    session.enter(hero);
    hero.conditions.apply({ key: 'drunk', expiresAtMs: 1_000_000_000 });

    const dx = { value: 1 };
    for (let i = 0; i < 200; i += 1) {
      const target = bounce(hero, dx);
      const result = ruleset.requestMove(session, hero.id, target);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.to).toEqual({ ...target, z: 7 });
    }
    expect(rng.integerCalls).toBe(0);
  });

  it('item com `suppress: [drunk]` (#688): a ability de drunk não entra no personagem', () => {
    const drunkRat = {
      ...rat, aggroRadius: 20, health: 100_000,
      abilities: [{
        id: 'booze', cadenceMs: 1_000, target: { range: 20 }, power: 0, damageType: 'physical',
        condition: { key: 'drunk', durationMs: 30_000, effect: { kind: 'drunk' } },
      }],
    };
    const at = (inventory?: InventoryState): boolean => {
      const loaded = content({ monsters: [drunkRat] });
      const { session, hero } = start({ loaded, ...(inventory === undefined ? {} : { inventory }) });
      for (let t = 0; t < 3_000 && session.ended === null; t += 100) session.advanceBy(100);
      return hero.conditions.get('drunk') !== null;
    };
    // O controle: sem o anel, a mesma ability embriaga — o teste mede a supressão, não a mira.
    expect(at()).toBe(true);
    expect(at(dwarvenRing)).toBe(false);
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
      spawnPoints: [{ routeIndex: 0, radius: 1, at: { x: 14, y: 14, z: 7 }, monsterId: 'rat', respawnDelayMs: 30_000 }],
    };
    const bigHunt = {
      id: 'big-arena', name: 'Big Arena', recommendedLevel: 1,
      mapId: 'big-arena', routeId: 'big-arena-loop',
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

describe('arma vestida abaixo do level e elemento da arma no combat-v3 (#687)', () => {
  // O level caiu com a arma na mão (penalidade de morte): o personagem de level 1 segurando
  // arma de level 30 é o mesmo estado, sem precisar morrer para chegar nele.
  const spikeSword = {
    id: 'spike-sword', name: 'Spike Sword', kind: 'weapon', slot: 'hand',
    weight: 50, value: 0, attack: 24, defense: 10, requires: { level: 30 },
  };
  const fireSword = {
    id: 'fire-sword', name: 'Fire Sword', kind: 'weapon', slot: 'hand',
    weight: 23, value: 0, attack: 24, defense: 20, requires: { level: 30 },
    weapon: { kind: 'melee', element: { type: 'fire', attack: 11 }, wieldUnproperly: true },
  };
  const combatV3 = {
    ...combat, compatibilityProfile: 'combat-v3',
    weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
    distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
  };
  const combatV2 = { ...combatV3, compatibilityProfile: 'combat-v2' };
  const holding = (itemId: string): InventoryState => ({
    backpack: [], equipped: { hand: { instanceId: 'h1', itemId, quantity: 1 } },
  });
  const loaded = (combatProfile: object): Content =>
    content({ items: [...items, spikeSword, fireSword], combat: [combatProfile] });

  it('v3: sem wieldUnproperly a arma não bate — nem golpe de punho, nem prática', () => {
    const { session, hero } = start({
      loaded: loaded(combatV3), difficulty: 'bold', health: 5_000, inventory: holding('spike-sword'),
    });
    const before = hero.skills.getState()['melee'] ?? null;
    run(session, 20_000, 100);
    const events = session.drainEvents();
    expect(ofKind(events, 'creature-hit').filter((h) => h.attackerId === 'hero')).toHaveLength(0);
    expect(hero.skills.getState()['melee'] ?? null).toEqual(before);
    expect(session.notableEvents.filter((e) => e.type === 'skill-up')).toHaveLength(0);
  });

  it('v2: a mesma arma abaixo do level segue virando punho (bit a bit)', () => {
    const { session } = start({
      loaded: loaded(combatV2), difficulty: 'bold', health: 5_000, inventory: holding('spike-sword'),
    });
    run(session, 20_000, 100);
    const events = session.drainEvents();
    expect(ofKind(events, 'creature-hit').filter((h) => h.attackerId === 'hero').length)
      .toBeGreaterThan(0);
  });

  it('v3: com wieldUnproperly bate, e o elemento vai como secundário sem escudo nem armadura', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session } = start({
      loaded: loaded(combatV3), difficulty: 'bold', health: 5_000, inventory: holding('fire-sword'),
    });
    run(session, 20_000, 100);
    const events = session.drainEvents();
    expect(ofKind(events, 'creature-hit').filter((h) => h.attackerId === 'hero').length)
      .toBeGreaterThan(0);
    const swings = vi.mocked(resolveDamage).mock.calls
      .filter(([intent]) => intent.source === 'basic-attack');
    const elemental = swings.filter(([intent]) => intent.secondary !== undefined);
    expect(elemental.length).toBeGreaterThan(0);
    for (const [intent] of elemental) {
      expect(intent.secondary?.damageType).toBe('fire');
      expect(intent.secondary?.blockable).toEqual({ armor: false, shield: false });
      expect(intent.secondary?.rawDamage).toBeGreaterThan(0);
    }
  });

  it('v2: o elemento é ignorado — nenhum golpe leva secundário', () => {
    vi.mocked(resolveDamage).mockClear();
    const { session, hero } = start({
      loaded: loaded(combatV2), difficulty: 'bold', health: 5_000, inventory: holding('fire-sword'),
    });
    hero.level = 30;
    run(session, 20_000, 100);
    const swings = vi.mocked(resolveDamage).mock.calls
      .filter(([intent]) => intent.source === 'basic-attack');
    expect(swings.length).toBeGreaterThan(0);
    expect(swings.every(([intent]) => intent.secondary === undefined)).toBe(true);
  });
});

// --- linha de visão (isSightClear, #553) ------------------------------------------------------

describe('linha de visão (#553)', () => {
  // Sala 10×7: uma parede única em (5,3) separa dois lados abertos — o "atrás da quina" da
  // spec. `sight` e `grid` marcam o MESMO tile de propósito: é uma parede de verdade, que
  // bloqueia passo e vista pela mesma razão (as duas flags do pacote, `unpass` e `unsight`,
  // coincidindo na mesma peça).
  //
  //     0123456789
  //   0 ##########
  //   1 #........#
  //   2 #........#
  //   3 #....#...#   <- parede em x=5
  //   4 #........#
  //   5 #........#
  //   6 ##########
  const wallRow = '#....#...#';
  const openRow = '#........#';
  const borderRow = '##########';
  const losMap = {
    id: 'arena', z: 7,
    floors: {
      7: {
        grid: [borderRow, openRow, openRow, wallRow, openRow, openRow, borderRow],
        sight: [borderRow, openRow, openRow, wallRow, openRow, openRow, borderRow],
      },
    },
  };
  const losRoute = {
    id: 'arena-loop', mapId: 'arena',
    tiles: [{ x: 2, y: 3, z: 7 }, { x: 3, y: 3, z: 7 }],
    // `monsterId`/`respawnDelayMs` obrigatórios desde o #583 (ADR 0039, fim do pull por
    // dificuldade) — não há mais `hunt.difficulties` para cair como fallback.
    spawnPoints: [{ routeIndex: 0, radius: 2, monsterId: 'rat', respawnDelayMs: 30_000 }],
  };
  const bow = {
    id: 'los-bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 1, value: 0,
    weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' },
  };
  const armed: InventoryState = {
    backpack: [], equipped: { hand: { instanceId: 'i-los-bow', itemId: 'los-bow', quantity: 1 } },
  };
  // `aggroRadius: 0` (RF-03/RF-05/RF-07): o rato nunca adquire o herói como alvo, e por isso
  // fica PARADO onde o teste o pôs — sem isto, ele perseguiria o herói contornando a parede
  // pelo movimento (que é livre; só a VISÃO está bloqueada), e o teste deixaria de medir o
  // portão de LOS para medir o passo guloso.
  const losRat = { ...rat, aggroRadius: 0 };
  const losLoaded = () => content({
    maps: [losMap], routes: [losRoute], items: [...items, bow], monsters: [losRat],
  });

  it('RF-03: o tiro não sai sem visão livre até o alvo, mesmo dentro do alcance da arma', () => {
    const { session, hero, ruleset } = start({ loaded: losLoaded(), gold: 1_000, inventory: armed });
    session.advanceBy(50);
    session.drainEvents(); // descarta o que aconteceu enquanto o rato ainda estava perto do spawn
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem monstro nesta hunt');
    // Hero entra em (2,3) — o primeiro tile da rota. O alvo do outro lado da parede, a
    // distância 6 (o alcance do bow), com a parede de x=5 exatamente no meio da linha.
    expect(hero.position).toEqual({ x: 2, y: 3, z: 7 });
    plant(target, { x: 8, y: 3, z: 7 });
    const healthBefore = target.health;
    run(session, 10_000, 100);
    const events = session.drainEvents();
    expect(events.some((e) => e.kind === 'shot')).toBe(false);
    expect(events.some((e) => e.kind === 'creature-hit')).toBe(false);
    expect(target.health).toBe(healthBefore);
  });

  it('RF-03: o mesmo alvo, do MESMO lado da parede, é atingido normalmente', () => {
    const { session, ruleset } = start({ loaded: losLoaded(), gold: 1_000, inventory: armed });
    session.advanceBy(50);
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem monstro nesta hunt');
    plant(target, { x: 4, y: 3, z: 7 }); // mesmo lado do hero (2,3); nada entre os dois
    run(session, 10_000, 100);
    const events = session.drainEvents();
    expect(events.some((e) => e.kind === 'shot')).toBe(true);
    expect(events.some((e) => e.kind === 'creature-hit')).toBe(true);
  });

  it('RF-03: a parede sai de cena (alvo anda) e o próximo vencimento acerta', () => {
    const { session, ruleset } = start({ loaded: losLoaded(), gold: 1_000, inventory: armed });
    session.advanceBy(50);
    session.drainEvents();
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem monstro nesta hunt');
    plant(target, { x: 8, y: 3, z: 7 });
    run(session, 2_000, 100);
    expect(session.drainEvents().some((e) => e.kind === 'shot')).toBe(false);
    // Sai da sombra da parede: mesma distância, sem obstáculo na linha.
    plant(target, { x: 8, y: 1, z: 7 });
    run(session, 10_000, 100);
    expect(session.drainEvents().some((e) => e.kind === 'shot')).toBe(true);
  });

  it('RF-05: magia em área não atinge quem está atrás da parede, mesmo dentro da forma', () => {
    // `blast`: alcance 3, área círculo raio 2 centrada no alvo (spell fixture do topo do
    // arquivo). Os dois monstros nascem LONGE do hero (fora do alcance da magia, #553 §7):
    // sem isso, o bot lançaria a magia sozinho ainda durante o aquecimento, antes de o teste
    // poder posicionar os dois lados da parede. O alvo principal fica do MESMO lado do hero
    // (visão livre, distância 2); o segundo cai dentro da forma (raio 2 alcança ±2 na linha do
    // alvo) mas do OUTRO lado da parede, visto do hero.
    // Dois pontos de spawn no MESMO lugar nominal (#583: um ponto por monstro, não mais
    // `monsterCount` sorteado por dificuldade) — o teste reposiciona os dois logo abaixo.
    const distantSpawn = {
      id: 'arena-loop', mapId: 'arena',
      tiles: losRoute.tiles,
      spawnPoints: [
        { routeIndex: 0, radius: 1, at: { x: 8, y: 4, z: 7 }, monsterId: 'rat', respawnDelayMs: 30_000 },
        { routeIndex: 0, radius: 1, at: { x: 8, y: 4, z: 7 }, monsterId: 'rat', respawnDelayMs: 30_000 },
      ],
    };
    const loaded = buildContent(raw({
      maps: [losMap], routes: [distantSpawn], hunts: [hunt], monsters: [losRat],
      progression: [{ ...progression, startingMana: 200 }],
    }));
    const session = createHuntSession({
      id: 'los-area-session', content: loaded, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0,
      botConfig: botConfig({
        attack: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'blast' } }],
      }),
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);
    const ruleset = session.ruleset as HuntRuleset;
    session.advanceBy(50);
    session.drainEvents();
    const [primary, splash] = ruleset.monsters;
    if (primary === undefined || splash === undefined) throw new Error('faltou monstro nesta hunt');
    plant(primary, { x: 4, y: 3, z: 7 }); // mesmo lado do hero (2,3): visão livre
    plant(splash, { x: 6, y: 3, z: 7 }); // outro lado da parede (x=5): dentro da forma (±2)
    const primaryHealthBefore = primary.health;
    const splashHealthBefore = splash.health;
    run(session, 5_000, 100);
    const events = session.drainEvents();
    expect(ofKind(events, 'spell-cast').length).toBeGreaterThan(0);
    expect(primary.health).toBeLessThan(primaryHealthBefore);
    expect(splash.health).toBe(splashHealthBefore);
  });

  it('RF-07: a postura keep-distance só recua com visão livre até o alvo', () => {
    const kept: BotConfig = botConfig({
      targeting: { policy: 'nearest', prioritize: [], ignore: [], posture: { kind: 'keep-distance', tiles: 4 } },
    });
    const loaded = losLoaded();
    const session = createHuntSession({
      id: 'los-posture-session', content: loaded, huntId: 'arena', difficulty: 'cautious',
      createdAtMs: 0, botConfig: kept,
    });
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: 1_000, maxHealth: 1_000, mana: 0, maxMana: 0, level: 1, xp: 0, vocationId: null,
      staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);
    const ruleset = session.ruleset as HuntRuleset;
    session.advanceBy(50);
    const target = ruleset.monsters[0];
    if (target === undefined) throw new Error('sem monstro nesta hunt');
    // Hero encostado na parede (4,3); alvo bem mais perto do que os 4 tiles configurados, do
    // OUTRO lado dela (6,3) — a linha (4,3)→(6,3) cruza a parede em x=5. Sem visão, a postura
    // não deve recuar (posição não muda).
    hero.position = { x: 4, y: 3, z: 7 };
    plant(target, { x: 6, y: 3, z: 7 });
    const before = { ...hero.position };
    run(session, 3_000, 100);
    expect(hero.position).toEqual(before);
  });
});

describe('cenário usável — TileOverrides (#728, ADR 0050 d.2-d.5, d.8)', () => {
  // A MESMA geometria e a MESMA rota de dez tiles de sempre (`map`/`route`, acima) — só o que
  // está EM CIMA de dois dos tiles do laço muda: uma porta comum no lugar de `(4,2)` (o lado
  // direito do laço) e um capim, que exige machete, no lugar de `(2,3)` (o lado de baixo). A
  // adjacência do laço continua igual: o importador NUNCA marca o tile de um interativo como
  // `#` (ADR 0050 d.1), então nada aqui muda a validação da rota (FUN-9).
  const doorMap = {
    ...map,
    id: 'door-arena',
    interactables: [
      { at: { x: 4, y: 2, z: 7 }, kind: 'door', initialState: 'closed', appearanceKey: 'door-1' },
      {
        at: { x: 2, y: 3, z: 7 }, kind: 'grass', initialState: 'uncut', appearanceKey: 'grass-1',
        requires: { tool: 'machete' }, revertMs: 2_000,
      },
    ],
  };
  const doorRoute = { ...route, id: 'door-loop', mapId: 'door-arena' };
  const doorHunt = { ...hunt, mapId: 'door-arena', routeId: 'door-loop' };
  // `use.tool` nasce sem NENHUM item do catálogo real declarando (#727/#744): a machete de
  // verdade ganhar `use.tool: 'machete'` é a #573, fora do escopo desta issue. Este item de
  // teste é o que permite exercitar o requisito de ferramenta SEM esperar por ela.
  const testMachete = {
    id: 'test-machete', name: 'Test Machete', kind: 'other' as const, weight: 1, value: 0,
    use: { tool: 'machete' as const },
  };
  const loaded = () => content({
    maps: [doorMap], routes: [doorRoute], hunts: [doorHunt], items: [...items, testMachete],
  });
  const withMachete = {
    backpack: [{ instanceId: 'machete-1', itemId: 'test-machete', quantity: 1 }],
    satchel: [], equipped: {},
  };

  /**
   * Roda até `predicate()` valer, ou desiste em `maxMs`. Mais robusto que apostar num instante
   * fixo: o hero enfrenta o rato que nasce perto do início ANTES de conseguir andar (a duração
   * da luta não é o assunto deste teste, e travar nela contaria como falha de outro sistema).
   */
  const runUntil = (session: Session, predicate: () => boolean, maxMs: number): boolean => {
    for (let elapsed = 0; elapsed < maxMs; elapsed += 100) {
      if (predicate()) return true;
      session.advanceBy(100);
    }
    return predicate();
  };

  it('o walker abre a porta fechada no caminho antes de pisar, e ela fecha sozinha ao esvaziar (d.3, d.4)', () => {
    const { session, ruleset } = start({ loaded: loaded(), inventory: withMachete });
    const door = () => ruleset.tileOverrides.find((o) => o.kind === 'door');
    expect(door()).toMatchObject({ state: 'closed', blocked: true });

    // Abriu: só é possível se o walker a usou sozinho no caminho (nenhum outro código deste
    // teste toca em `tileOverrides`) — é a automação legítima do invariante 11.
    expect(runUntil(session, () => door()?.state === 'open', 15_000)).toBe(true);
    expect(door()?.blocked).toBe(false);

    // E fechou de novo: a prova de que o hero SAIU do tile (`vacate`), não que ficou parado
    // em cima dela para sempre — o mesmo `move()` que o levou embora é quem a fecha (d.3).
    expect(runUntil(session, () => door()?.state === 'closed', 5_000)).toBe(true);
    expect(door()?.blocked).toBe(true);
  });

  it('sem ferramenta nenhuma, o walker segura no capim como faria numa parede, e registra UMA vez (d.4)', () => {
    // A porta comum não exige nada (ADR 0050 d.6, T1): sem a machete o hero ainda abre a porta
    // sozinho e SÓ trava no capim, dois tiles depois no laço — a prova de que o requisito de
    // ferramenta é POR interativo, não um bloqueio geral de "sem inventário".
    const { session, ruleset } = start({ loaded: loaded() });
    const grass = () => ruleset.tileOverrides.find((o) => o.kind === 'grass');
    run(session, 15_000, 100);
    expect(grass()).toMatchObject({ state: 'uncut', blocked: true }); // nunca cortou
    const blocked = session.notableEvents.filter((e) => e.type === 'route-blocked');
    expect(blocked.length).toBe(1); // UMA linha, não uma por vencimento parado
  });

  it('capim cortado com machete volta a crescer sozinho — evento na fila, nada por tique (d.3)', () => {
    const { session, ruleset } = start({ loaded: loaded(), inventory: withMachete });
    const grass = () => ruleset.tileOverrides.find((o) => o.kind === 'grass');
    expect(grass()).toMatchObject({ state: 'uncut', blocked: true });

    expect(runUntil(session, () => grass()?.state === 'cut', 20_000)).toBe(true);
    expect(grass()?.blocked).toBe(false);
    expect(grass()?.revertAtMs).toBeDefined();

    // Cresce de volta SOZINHO, sem ninguém usar de novo — o `TILE_REVERT` da fila (invariante 2).
    expect(runUntil(session, () => grass()?.state === 'uncut', 5_000)).toBe(true);
    expect(grass()?.blocked).toBe(true);
  });

  it('stone pile virada buraco desce um andar, e enche de volta sozinha (d.2-d.3)', () => {
    const pileMap = {
      id: 'pile-arena', z: 7,
      // `grid`+`floors` são exatamente um dos dois (schema): o segundo andar existe só para o
      // `floorChange` da stone pile ter para onde descer — não para o walker visitar.
      floors: { 7: { grid: map.grid }, 8: { grid: map.grid } },
      interactables: [{
        at: { x: 4, y: 2, z: 7 }, kind: 'stone-pile', initialState: 'pile', appearanceKey: 'pile-1',
        requires: { tool: 'shovel' }, revertMs: 2_000,
      }],
    };
    const pileMachete = {
      id: 'test-shovel', name: 'Test Shovel', kind: 'other' as const, weight: 1, value: 0,
      use: { tool: 'shovel' as const },
    };
    const loadedPile = content({
      maps: [pileMap], routes: [{ ...doorRoute, mapId: 'pile-arena' }],
      hunts: [{ ...hunt, mapId: 'pile-arena', routeId: 'door-loop' }],
      items: [...items, pileMachete],
    });
    const { session, ruleset } = start({
      loaded: loadedPile,
      inventory: { backpack: [{ instanceId: 's1', itemId: 'test-shovel', quantity: 1 }], satchel: [], equipped: {} },
    });
    const pile = () => ruleset.tileOverrides.find((o) => o.kind === 'stone-pile');
    expect(pile()).toMatchObject({ state: 'pile', blocked: true, floorChange: null });

    expect(runUntil(session, () => pile()?.state === 'hole', 15_000)).toBe(true);
    expect(pile()?.floorChange).toEqual({ x: 4, y: 2, z: 8 });

    expect(runUntil(session, () => pile()?.state === 'pile', 5_000)).toBe(true);
    expect(pile()?.floorChange).toBeNull();
  });

  it('a alavanca NUNCA bloqueia — o walker passa por cima sem puxar sozinho (d.1, fora do escopo do #729)', () => {
    // A alavanca não é um obstáculo (`BLOCKING_STATES` não a lista, `tile-overrides.ts`), então
    // `#useInteractable` — o gatilho do walker (d.4) — nunca é chamado para ela: ele só usa o
    // que está NO CAMINHO e bloqueando. Puxar a alavanca DE PROPÓSITO é `#useOnMap` (#729, fora
    // do escopo desta issue); o mecanismo de alternar/`links` já está pronto e testado
    // isoladamente em `tile-overrides.test.ts` — este teste prende a FRONTEIRA: o walker não
    // aciona sozinho o que não impede ele de andar, e é isso que evita puxar alavanca por
    // engano em toda passagem por cima dela.
    const leverMap = {
      ...map,
      id: 'lever-arena',
      interactables: [
        {
          at: { x: 4, y: 2, z: 7 }, kind: 'lever', initialState: 'down', appearanceKey: 'lever',
          aid: 2772, links: ['9001'],
        },
        {
          at: { x: 1, y: 2, z: 7 }, kind: 'door', initialState: 'closed', appearanceKey: 'door-1',
          aid: 9001,
        },
      ],
    };
    const loadedLever = content({
      maps: [leverMap], routes: [{ ...doorRoute, mapId: 'lever-arena' }],
      hunts: [{ ...hunt, mapId: 'lever-arena', routeId: 'door-loop' }],
    });
    const { session, ruleset } = start({ loaded: loadedLever });
    const lever = () => ruleset.tileOverrides.find((o) => o.kind === 'lever');
    const linkedDoor = () => ruleset.tileOverrides.find((o) => o.kind === 'door');
    expect(lever()?.state).toBe('down');

    // Duas voltas completas do laço passando por cima da alavanca: ela continua `down`, e a
    // porta ligada por `aid` continua fechada — nada a acionou.
    run(session, 15_000, 100);
    expect(lever()?.state).toBe('down');
    expect(linkedDoor()).toMatchObject({ state: 'closed', blocked: true });
  });

  it('o overlay atravessa o snapshot: porta aberta continua aberta ao retomar (invariante 7, sem bump)', () => {
    const loadedContent = loaded();
    const { session, ruleset } = start({ loaded: loadedContent, inventory: withMachete });
    const door = () => ruleset.tileOverrides.find((o) => o.kind === 'door');
    expect(runUntil(session, () => door()?.state === 'open', 15_000)).toBe(true);
    session.drainEvents();

    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loadedContent) as HuntRuleset, Rng.fromSeed('resume'),
    );
    const restored = resumed.ruleset as HuntRuleset;
    // O `TileOccupancy.overrides` do ruleset RECÉM-CONSTRUÍDO já é a instância que `restore()`
    // muta (nunca substitui) — é essa mutação que este teste prova: sem ela, o mundo restaurado
    // ainda enxergaria a porta fechada, e o `move` de quem retomou em cima dela falharia.
    expect(restored.tileOverrides.find((o) => o.kind === 'door')).toMatchObject({
      state: 'open', blocked: false,
    });
  });
});

describe('useOnMap, look e tileAppearanceChanges — o jogador usa e olha o cenário (#729, ADR 0050 d.7)', () => {
  // A MESMA geometria do bloco acima, com a porta em (4,2,7) e o capim em (2,3,7) — mas aqui
  // o hero é posicionado À MÃO, adjacente ao interativo, para exercitar `useOnMap`/`look`
  // diretamente, sem esperar o walker percorrer o laço inteiro (esse caminho já tem teste
  // próprio, acima).
  const doorMap = {
    ...map,
    id: 'door-arena-729',
    interactables: [
      { at: { x: 4, y: 2, z: 7 }, kind: 'door', initialState: 'closed', appearanceKey: 'door-1' },
      {
        at: { x: 2, y: 3, z: 7 }, kind: 'grass', initialState: 'uncut', appearanceKey: 'grass-1',
        requires: { tool: 'machete' }, revertMs: 2_000,
      },
      { at: { x: 1, y: 3, z: 7 }, kind: 'sign', initialState: 'default', appearanceKey: 'sign-1', text: 'Beware of the rats.' },
    ],
  };
  const doorRoute = { ...route, id: 'door-loop-729', mapId: 'door-arena-729' };
  const doorHunt = { ...hunt, mapId: 'door-arena-729', routeId: 'door-loop-729' };
  const testMachete = {
    id: 'test-machete-729', name: 'Test Machete', kind: 'other' as const, weight: 1, value: 0,
    use: { tool: 'machete' as const },
  };
  const loaded = () => content({
    maps: [doorMap], routes: [doorRoute], hunts: [doorHunt], items: [...items, testMachete],
  });
  const withMachete = {
    backpack: [{ instanceId: 'machete-729', itemId: 'test-machete-729', quantity: 1 }],
    satchel: [], equipped: {},
  };

  it('abre a porta adjacente e devolve a mudança de aparência (RF-01)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 }; // adjacente à porta em (4,2,7)
    const result = ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 });
    expect(result).toEqual({
      ok: true,
      changes: [{
        position: { x: 4, y: 2, z: 7 }, appearanceKey: 'door-1', fromState: 'closed', toState: 'open',
      }],
    });
    expect(ruleset.tileOverrides.find((o) => o.kind === 'door')).toMatchObject({ state: 'open' });
  });

  it('aciona a alavanca e devolve TAMBÉM a mudança do linkado (RF-01)', () => {
    const leverMap = {
      ...map,
      id: 'lever-arena-729',
      interactables: [
        {
          at: { x: 4, y: 1, z: 7 }, kind: 'lever', initialState: 'down', appearanceKey: 'lever',
          aid: 2772, links: ['9001'],
        },
        {
          at: { x: 1, y: 3, z: 7 }, kind: 'door', initialState: 'closed', appearanceKey: 'door-2',
          aid: 9001,
        },
      ],
    };
    const loadedLever = content({
      maps: [leverMap], routes: [{ ...doorRoute, mapId: 'lever-arena-729' }],
      hunts: [{ ...doorHunt, mapId: 'lever-arena-729', routeId: doorRoute.id }],
    });
    const { session, ruleset, hero } = start({ loaded: loadedLever });
    hero.position = { x: 4, y: 2, z: 7 }; // adjacente à alavanca em (4,1,7)
    const result = ruleset.useOnMap(session, hero.id, { x: 4, y: 1, z: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.changes).toEqual([
      { position: { x: 4, y: 1, z: 7 }, appearanceKey: 'lever', fromState: 'down', toState: 'up' },
      { position: { x: 1, y: 3, z: 7 }, appearanceKey: 'door-2', fromState: 'closed', toState: 'open' },
    ]);
  });

  it('recusa out-of-range a mais de um tile de distância (RF-02)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 1, y: 1, z: 7 }; // longe da porta em (4,2,7)
    expect(ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'out-of-range' });
  });

  it('recusa nothing-there num tile sem interativo (RF-02)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 2, y: 2, z: 7 };
    expect(ruleset.useOnMap(session, hero.id, { x: 2, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'nothing-there' });
  });

  it('recusa missing-tool no capim sem machete no catálogo — nunca corta sem ferramenta (RF-02)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() }); // sem withMachete
    hero.position = { x: 2, y: 2, z: 7 }; // adjacente ao capim em (2,3,7)
    expect(ruleset.useOnMap(session, hero.id, { x: 2, y: 3, z: 7 }))
      .toEqual({ ok: false, reason: 'missing-tool' });
    expect(ruleset.tileOverrides.find((o) => o.kind === 'grass')).toMatchObject({ state: 'uncut' });
  });

  it('corta o capim com a machete no inventário (RF-01)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded(), inventory: withMachete });
    hero.position = { x: 2, y: 2, z: 7 };
    const result = ruleset.useOnMap(session, hero.id, { x: 2, y: 3, z: 7 });
    expect(result.ok).toBe(true);
    expect(ruleset.tileOverrides.find((o) => o.kind === 'grass')).toMatchObject({ state: 'cut' });
  });

  it('recusa not-usable numa placa (kind sem par de estados) (RF-02)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 1, y: 2, z: 7 }; // adjacente à placa em (1,3,7)
    expect(ruleset.useOnMap(session, hero.id, { x: 1, y: 3, z: 7 }))
      .toEqual({ ok: false, reason: 'not-usable' });
  });

  it('look devolve o text da placa (RF-03)', () => {
    const { ruleset } = start({ loaded: loaded() });
    expect(ruleset.look({ x: 1, y: 3, z: 7 })).toEqual({ text: 'Beware of the rats.' });
  });

  it('look devolve uma descrição padrão do kind sem text próprio (RF-03)', () => {
    const { ruleset } = start({ loaded: loaded() });
    expect(ruleset.look({ x: 4, y: 2, z: 7 }).text).toMatch(/porta/i);
  });

  it('look devolve o texto genérico sem interativo nenhum ali (RF-03)', () => {
    const { ruleset } = start({ loaded: loaded() });
    expect(ruleset.look({ x: 2, y: 2, z: 7 }).text).toBe('Você não vê nada de especial.');
  });

  it('tileAppearanceChanges está vazio sem ninguém ter usado nada, e ganha uma entrada por uso (RF-05)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    expect(ruleset.tileAppearanceChanges).toEqual([]);
    hero.position = { x: 4, y: 1, z: 7 };
    ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 });
    expect(ruleset.tileAppearanceChanges).toEqual([{
      position: { x: 4, y: 2, z: 7 }, appearanceKey: 'door-1', fromState: 'closed', toState: 'open',
    }]);
  });
});

describe('useOnMap — porta de level e porta de chave (T2, #732, ADR 0050 d.6)', () => {
  // A porta de level exige `player:getLevel() >= item.actionid - 1000` (`level_door.lua` do
  // Canary) — `aid: 1010` pede level 10. A porta de chave nasce TRANCADA e só abre com a chave
  // cujo `use.keyId` bate com `requires.keyId` (`key_door.lua`: `item.actionid == target.actionid`).
  const doorMap = {
    ...map,
    id: 'door-arena-732',
    interactables: [
      {
        at: { x: 4, y: 2, z: 7 }, kind: 'level-door', initialState: 'closed', appearanceKey: 'level-door-1',
        aid: 1010, requires: { level: 10 },
      },
      {
        at: { x: 6, y: 2, z: 7 }, kind: 'locked-door', initialState: 'locked', appearanceKey: 'key-door-1',
        aid: 42, requires: { tool: 'key', keyId: 42 },
      },
    ],
  };
  const doorRoute = { ...route, id: 'door-loop-732', mapId: 'door-arena-732' };
  const doorHunt = { ...hunt, mapId: 'door-arena-732', routeId: 'door-loop-732' };
  const testKey = {
    id: 'test-key-732', name: 'Test Key', kind: 'other' as const, weight: 1, value: 0,
    use: { tool: 'key' as const, keyId: 42 },
  };
  const wrongKey = {
    id: 'test-wrong-key-732', name: 'Test Wrong Key', kind: 'other' as const, weight: 1, value: 0,
    use: { tool: 'key' as const, keyId: 99 },
  };
  const loaded = () => content({
    maps: [doorMap], routes: [doorRoute], hunts: [doorHunt], items: [...items, testKey, wrongKey],
  });
  const withKey = {
    backpack: [{ instanceId: 'key-732', itemId: 'test-key-732', quantity: 1 }],
    satchel: [], equipped: {},
  };
  const withWrongKey = {
    backpack: [{ instanceId: 'wrong-key-732', itemId: 'test-wrong-key-732', quantity: 1 }],
    satchel: [], equipped: {},
  };

  it('recusa level-too-low sem o level exigido, e não abre a porta', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 }; // adjacente à porta de level em (4,2,7)
    expect(hero.level).toBe(1);
    expect(ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'level-too-low' });
    expect(ruleset.tileOverrides.find((o) => o.kind === 'level-door')).toMatchObject({ state: 'closed' });
  });

  it('abre a porta de level com o level exigido (RF-01)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 };
    hero.level = 10;
    const result = ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 });
    expect(result).toEqual({
      ok: true,
      changes: [{
        position: { x: 4, y: 2, z: 7 }, appearanceKey: 'level-door-1', fromState: 'closed', toState: 'open',
      }],
    });
  });

  it('abre a porta de level e o estado passa a `open` no overlay (RF-01)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 };
    hero.level = 10;
    ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 });
    expect(ruleset.tileOverrides.find((o) => o.kind === 'level-door')).toMatchObject({ state: 'open' });
  });

  it('recusa missing-tool na porta de chave sem NENHUMA chave no catálogo carregado', () => {
    // O catálogo desta hunt NÃO carrega `testKey` — o cenário da issue #732: sem item de chave
    // nenhum importado ainda (a #754, paralela), a porta de chave nunca abre, com razão tipada.
    const bareLoaded = content({ maps: [doorMap], routes: [doorRoute], hunts: [doorHunt] });
    const { session, ruleset, hero } = start({ loaded: bareLoaded });
    hero.position = { x: 6, y: 1, z: 7 }; // adjacente à porta de chave em (6,2,7)
    expect(ruleset.useOnMap(session, hero.id, { x: 6, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'missing-tool' });
    expect(ruleset.tileOverrides.find((o) => o.kind === 'locked-door')).toMatchObject({ state: 'locked' });
  });

  it('recusa missing-tool com uma chave ERRADA — o `keyId` não bate (key_door.lua: "The key does not match.")', () => {
    const { session, ruleset, hero } = start({ loaded: loaded(), inventory: withWrongKey });
    hero.position = { x: 6, y: 1, z: 7 };
    expect(ruleset.useOnMap(session, hero.id, { x: 6, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'missing-tool' });
  });

  it('abre a porta de chave DIRETO para `open` com a chave certa (RF-01)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded(), inventory: withKey });
    hero.position = { x: 6, y: 1, z: 7 };
    const result = ruleset.useOnMap(session, hero.id, { x: 6, y: 2, z: 7 });
    expect(result).toEqual({
      ok: true,
      changes: [{
        position: { x: 6, y: 2, z: 7 }, appearanceKey: 'key-door-1', fromState: 'locked', toState: 'open',
      }],
    });
  });

  it('destrancada, a porta de chave alterna aberta/fechada sem precisar da chave de novo', () => {
    const { session, ruleset, hero } = start({ loaded: loaded(), inventory: withKey });
    hero.position = { x: 6, y: 1, z: 7 };
    ruleset.useOnMap(session, hero.id, { x: 6, y: 2, z: 7 }); // locked → open, com a chave
    // Já aberta: usar de novo SEM chave alterna para `closed` — nunca recusa por ferramenta,
    // porque `toolRequiredNow` só exige a chave no estado `locked` (key_door.lua do Canary só
    // confere `item.actionid` contra a porta trancada, nunca contra `closed`/`open`).
    const closedResult = ruleset.useOnMap(session, hero.id, { x: 6, y: 2, z: 7 });
    expect(closedResult).toEqual({
      ok: true,
      changes: [{
        position: { x: 6, y: 2, z: 7 }, appearanceKey: 'key-door-1', fromState: 'open', toState: 'closed',
      }],
    });
  });
});

describe('placa de pressão — step-in/step-out (#734, ADR 0050 d.6 T3)', () => {
  // A mesma geometria/laço de sempre: a placa fica no lugar da porta em (4,2,7), no CAMINHO do
  // walker — reage sozinha ao passo, nunca a `useOnMap`. Liga uma porta em (1,3,7) por `links`,
  // igual ao par lever→door já testado acima, para provar que o MESMO cascade vale para a placa.
  const plateMap = {
    ...map,
    id: 'plate-arena',
    interactables: [
      {
        at: { x: 4, y: 2, z: 7 }, kind: 'pressure-plate', initialState: 'up', appearanceKey: 'plate-1',
        links: ['9001'],
      },
      { at: { x: 1, y: 3, z: 7 }, kind: 'door', initialState: 'closed', appearanceKey: 'door-2', aid: 9001 },
    ],
  };
  const plateRoute = { ...route, id: 'plate-loop', mapId: 'plate-arena' };
  const plateHunt = { ...hunt, mapId: 'plate-arena', routeId: 'plate-loop' };
  const loaded = () => content({ maps: [plateMap], routes: [plateRoute], hunts: [plateHunt] });

  const runUntil = (session: Session, predicate: () => boolean, maxMs: number): boolean => {
    for (let elapsed = 0; elapsed < maxMs; elapsed += 100) {
      if (predicate()) return true;
      session.advanceBy(100);
    }
    return predicate();
  };

  it('pisar pressiona sozinho (up→down) e liga o link — automação legítima, invariante 11', () => {
    const { session, ruleset } = start({ loaded: loaded() });
    const plate = () => ruleset.tileOverrides.find((o) => o.kind === 'pressure-plate');
    const door = () => ruleset.tileOverrides.find((o) => o.kind === 'door');
    expect(plate()).toMatchObject({ state: 'up', blocked: false });
    expect(door()).toMatchObject({ state: 'closed' });
    expect(runUntil(session, () => plate()?.state === 'down', 15_000)).toBe(true);
    expect(door()).toMatchObject({ state: 'open' });
  });

  it('sair solta sozinho (down→up) e desliga o link de novo', () => {
    const { session, ruleset } = start({ loaded: loaded() });
    const plate = () => ruleset.tileOverrides.find((o) => o.kind === 'pressure-plate');
    const door = () => ruleset.tileOverrides.find((o) => o.kind === 'door');
    expect(runUntil(session, () => plate()?.state === 'down', 15_000)).toBe(true);
    expect(runUntil(session, () => plate()?.state === 'up', 5_000)).toBe(true);
    expect(door()).toMatchObject({ state: 'closed' });
  });

  it('useOnMap recusa not-usable — a placa reage só a PISAR, nunca a clique', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 }; // adjacente à placa em (4,2,7)
    expect(ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'not-usable' });
  });
});

describe('teleporte por pisar, e gated por alavanca (#734, ADR 0050 d.6 T3)', () => {
  const teleportMap = {
    ...map,
    id: 'teleport-arena',
    interactables: [{
      at: { x: 4, y: 2, z: 7 }, kind: 'teleport', initialState: 'default', appearanceKey: 'tp-1',
      target: { x: 1, y: 2, z: 7 },
    }],
  };
  const teleportRoute = { ...route, id: 'teleport-loop', mapId: 'teleport-arena' };
  const teleportHunt = { ...hunt, mapId: 'teleport-arena', routeId: 'teleport-loop' };
  const loaded = () => content({ maps: [teleportMap], routes: [teleportRoute], hunts: [teleportHunt] });

  it('o walker pisa no teleporte "sempre ligado" e é redirecionado no mesmo passo', () => {
    const { session, hero } = start({ loaded: loaded() });
    // O laço passa por (4,2,7): em algum vencimento o hero chega lá e sai direto em (1,2,7) —
    // sem NUNCA ficar de pé em (4,2,7), o mesmo teste que provaria uma escada. Depois do
    // redirecionamento o walker continua do PRÓXIMO índice do laço (como uma escada também
    // desvia — o destino de um teleporte não é, em geral, um tile do laço autorado), então o
    // que se prende aqui é só a chegada, não o resto do passeio.
    let sawTeleportTile = false;
    let sawTarget = false;
    for (let elapsed = 0; elapsed < 15_000 && !sawTarget; elapsed += 100) {
      session.advanceBy(100);
      if (hero.position.x === 4 && hero.position.y === 2) sawTeleportTile = true;
      if (hero.position.x === 1 && hero.position.y === 2) sawTarget = true;
    }
    expect(sawTarget).toBe(true);
    expect(sawTeleportTile).toBe(false);
  });

  it('useOnMap recusa not-usable no tile do teleporte — reage só a pisar', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 };
    expect(ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'not-usable' });
  });

  it('gated por alavanca: fechado não é `isToggleable`-ativo, e a alavanca o abre por revertMs (T3, "abrir teleporte por N s")', () => {
    // A prova em nível de `movement.ts`/`tile-overrides.ts` (que a alavanca liga o teleporte, e
    // que `move()` redireciona só quando ele está ativo) já está isolada e completa em
    // `movement.test.ts`/`tile-overrides.test.ts`. Este teste prende a fronteira que só o
    // `HuntRuleset` conhece: o MESMO `useOnMap`/`#useInteractable` que liga uma porta linkada
    // (teste acima, "aciona a alavanca") também liga um TELEPORTE linkado — sem código novo por
    // `kind` no cascade.
    const gatedMap = {
      ...map,
      id: 'gated-teleport-arena',
      interactables: [
        {
          at: { x: 4, y: 1, z: 7 }, kind: 'lever', initialState: 'down', appearanceKey: 'lever',
          aid: 2772, links: ['9002'],
        },
        {
          at: { x: 4, y: 2, z: 7 }, kind: 'teleport', initialState: 'closed', appearanceKey: 'tp-2',
          target: { x: 1, y: 2, z: 7 }, aid: 9002, revertMs: 2_000,
        },
      ],
    };
    const loadedGated = content({
      maps: [gatedMap], routes: [{ ...teleportRoute, mapId: 'gated-teleport-arena' }],
      hunts: [{ ...teleportHunt, mapId: 'gated-teleport-arena', routeId: teleportRoute.id }],
    });
    const { session, ruleset, hero } = start({ loaded: loadedGated });
    const teleport = () => ruleset.tileOverrides.find((o) => o.kind === 'teleport');
    expect(teleport()).toMatchObject({ state: 'closed' });

    hero.position = { x: 4, y: 2, z: 7 }; // adjacente à alavanca em (4,1,7)
    const result = ruleset.useOnMap(session, hero.id, { x: 4, y: 1, z: 7 });
    expect(result.ok).toBe(true);
    expect(teleport()).toMatchObject({ state: 'open' });

    // Reverte sozinho ao vencer — a mesma fila (`TILE_REVERT`) do capim/stone pile.
    session.advanceBy(2_000);
    expect(teleport()).toMatchObject({ state: 'closed' });
  });
});

describe('useOnMap — porta de quest (T2 completo, #733, ADR 0050 d.6)', () => {
  // `appearanceKey`/`initialState` são os valores REAIS de uma das 3 quest-doors de
  // `packages/content/data/maps/thais.json` (#727) — só a POSIÇÃO foi trazida para esta arena
  // pequena (o teste precisa de um mapa pequeno o bastante para conferir a olho, spec da #733
  // seção 10). `requires.storageKey` não existe no arquivo real (DT-04 da spec — sem OTBM de
  // origem nem quest desenhada, o wiring real fica de fora); aqui ele é acrescentado só para
  // exercitar o MECANISMO contra a classificação real do mapa.
  const doorMap = {
    ...map,
    id: 'quest-door-arena-733',
    interactables: [
      {
        at: { x: 4, y: 2, z: 7 }, kind: 'quest-door', initialState: 'closed',
        appearanceKey: 'quest-door-6258', requires: { storageKey: 'thais:quest-door-1' },
      },
    ],
  };
  const doorRoute = { ...route, id: 'door-loop-733', mapId: 'quest-door-arena-733' };
  const doorHunt = { ...hunt, mapId: 'quest-door-arena-733', routeId: 'door-loop-733' };
  const loaded = () => content({ maps: [doorMap], routes: [doorRoute], hunts: [doorHunt] });

  it('recusa quest-incomplete sem o storage, e não abre a porta', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 }; // adjacente à porta de quest em (4,2,7)
    expect(hero.getStorageValue('thais:quest-door-1')).toBe(-1); // UNSET_STORAGE_VALUE
    expect(ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'quest-incomplete' });
    expect(ruleset.tileOverrides.find((o) => o.kind === 'quest-door')).toMatchObject({ state: 'closed' });
  });

  it('recusa quest-incomplete com o storage em 0 — "aceitou mas não concluiu" não abre (DT-01)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 };
    hero.setStorageValue('thais:quest-door-1', 0);
    expect(ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'quest-incomplete' });
  });

  it('abre a porta de quest com o storage em 1 (RF-01)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 };
    hero.setStorageValue('thais:quest-door-1', 1);
    const result = ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 });
    expect(result).toEqual({
      ok: true,
      changes: [{
        position: { x: 4, y: 2, z: 7 }, appearanceKey: 'quest-door-6258', fromState: 'closed', toState: 'open',
      }],
    });
  });

  // O fechamento sozinho ao esvaziar (RF-02) é o MESMO `TileOverrides.closeDoorIfVacant` de
  // porta comum/level/chave — coberto isoladamente em `tile-overrides.test.ts` ("porta de quest
  // fechada bloqueia, alterna para `open`, e fecha sozinha ao esvaziar"). Repetir aqui via
  // `session.advanceBy` exigiria a porta no CAMINHO da rota (como o teste do walker do #728
  // faz para a porta comum); o mecanismo em si já está provado, e o gate de storage — o que
  // esta issue acrescenta — está nos quatro testes acima.
});

describe('useOnMap — baú de quest com uid (T2 completo, #733, ADR 0050 d.6)', () => {
  // `appearanceKey`/`uid` são os valores REAIS de um dos 3 chests com `uid` de
  // `packages/content/data/maps/thais.json` (#727) — a mesma ressalva de posição do bloco
  // acima. `reward` não existe no arquivo real (DT-04): aqui só para exercitar o mecanismo.
  const chestMap = {
    ...map,
    id: 'chest-arena-733',
    interactables: [
      {
        at: { x: 4, y: 2, z: 7 }, kind: 'chest', initialState: 'default', appearanceKey: 'chest-2433',
        uid: 9274, reward: { itemId: 'test-reward-733', quantity: 2 },
      },
    ],
  };
  const chestRoute = { ...route, id: 'chest-loop-733', mapId: 'chest-arena-733' };
  const chestHunt = { ...hunt, mapId: 'chest-arena-733', routeId: 'chest-loop-733' };
  const testReward = {
    id: 'test-reward-733', name: 'Test Reward', kind: 'other' as const, weight: 1, value: 0,
  };
  // Peso maior que a capacidade inteira do herói de teste (1000, `character()` acima) — cabe
  // em NENHUM inventário, sem precisar encher a mochila primeiro (RF-04).
  const heavyReward = {
    id: 'test-heavy-reward-733', name: 'Heavy Reward', kind: 'other' as const, weight: 2_000, value: 0,
  };
  const loaded = (extraItems: readonly (typeof testReward)[] = [testReward]) => content({
    maps: [chestMap], routes: [chestRoute], hunts: [chestHunt], items: [...items, ...extraItems],
  });

  it('entrega o item, marca o storage e credita itemsLooted (RF-03)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 }; // adjacente ao baú em (4,2,7)
    const result = ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 });
    expect(result).toEqual({ ok: true, changes: [] });
    const carried = [...hero.inventory.items()].find((item) => item.itemId === 'test-reward-733');
    expect(carried?.quantity).toBe(2);
    expect(hero.getStorageValue(chestStorageKeyOf(9274))).toBe(1);
    expect(session.aggregates.itemsLooted).toBe(2);
  });

  it('recusa already-looted na segunda tentativa do MESMO personagem, sem duplicar o item (RF-03)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 };
    ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 });
    const second = ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 });
    expect(second).toEqual({ ok: false, reason: 'already-looted' });
    const carried = [...hero.inventory.items()].filter((item) => item.itemId === 'test-reward-733');
    expect(carried).toHaveLength(1);
  });

  it('recusa no-capacity sem mochila para o prêmio, e NÃO marca o storage (RF-04)', () => {
    const heavyMap = { ...chestMap, interactables: [{ ...chestMap.interactables[0], reward: { itemId: 'test-heavy-reward-733', quantity: 1 } }] };
    const heavyLoaded = content({
      maps: [heavyMap], routes: [{ ...chestRoute, mapId: 'chest-arena-733' }],
      hunts: [chestHunt], items: [...items, heavyReward],
    });
    const { session, ruleset, hero } = start({ loaded: heavyLoaded });
    hero.position = { x: 4, y: 1, z: 7 };
    expect(ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'no-capacity' });
    expect(hero.getStorageValue(chestStorageKeyOf(9274))).toBe(-1); // UNSET_STORAGE_VALUE
    expect([...hero.inventory.items()]).toHaveLength(0);
  });

  it('recusa unknown-item quando o catálogo carregado não tem o item do baú, e registra (RF-05)', () => {
    const bareLoaded = content({ maps: [chestMap], routes: [chestRoute], hunts: [chestHunt] }); // sem testReward
    const { session, ruleset, hero } = start({ loaded: bareLoaded });
    hero.position = { x: 4, y: 1, z: 7 };
    expect(ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 }))
      .toEqual({ ok: false, reason: 'unknown-item' });
    expect(hero.getStorageValue(chestStorageKeyOf(9274))).toBe(-1);
  });

  it('dois personagens diferentes coletam o MESMO baú, cada um uma vez (RF-06)', () => {
    const { session, ruleset, hero } = start({ loaded: loaded() });
    hero.position = { x: 4, y: 1, z: 7 };
    const other = new CharacterRuntime({ ...character().getState(), id: 'other' });
    session.enter(other);
    // `session.enter` coloca o segundo no tile livre mais próximo do início da rota (#203) —
    // reposicionado À MÃO depois, como `hero.position` acima, para ficar adjacente ao baú.
    other.position = { x: 4, y: 3, z: 7 };

    expect(ruleset.useOnMap(session, hero.id, { x: 4, y: 2, z: 7 })).toEqual({ ok: true, changes: [] });
    expect(ruleset.useOnMap(session, other.id, { x: 4, y: 2, z: 7 })).toEqual({ ok: true, changes: [] });

    expect(hero.getStorageValue(chestStorageKeyOf(9274))).toBe(1);
    expect(other.getStorageValue(chestStorageKeyOf(9274))).toBe(1);
    expect([...other.inventory.items()].find((item) => item.itemId === 'test-reward-733')?.quantity).toBe(2);
  });
});

describe('dança de alvo (#543, staticAttack sem tick, `Monster::getDanceStep`)', () => {
  // O herói fica PARADO (nenhum `PLAYER_STEP` sobrevive ao `cancelEvents` logo abaixo), então
  // toda mudança de posição do monstro DEPOIS de chegar colado só pode vir da dança — a rota do
  // personagem, que embaralharia a leitura, sai da equação.
  const dancer = { ...rat, staticAttack: 0.8 };
  const loaded = content({ monsters: [dancer] });

  /** Deixa o monstro chegar e ficar colado, com o herói parado. */
  function settle(loadedContent: Content = loaded) {
    const { session, hero, ruleset } = start({ loaded: loadedContent, health: 100_000 });
    session.cancelEvents(hero.id); // sem passo do herói: só a dança move alguém daqui pra frente
    run(session, 20_000, 100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta instância');
    return { session, hero, monster };
  }

  it('chega e fica colado, adjacente ao alvo parado', () => {
    const { hero, monster } = settle();
    expect(distance(monster.position, hero.position)).toBe(1);
  });

  it('com staticAttack 0,8 e seed fixa, a taxa de dança fica perto de 20% em 1000 vencimentos, '
    + 'e o monstro NUNCA perde a adjacência dançando', () => {
    const { session, hero, monster } = settle();
    const samples = 1_000;
    let danced = 0;
    for (let i = 0; i < samples; i++) {
      const before = { ...monster.position };
      run(session, 1_000, 100);
      if (monster.position.x !== before.x || monster.position.y !== before.y) danced++;
      // A dança preserva a distância EXATA ao alvo — nunca aproxima, nunca afasta (o mesmo
      // filtro que `danceStep` aplica em `monster/step.test.ts`).
      expect(distance(monster.position, hero.position)).toBe(1);
    }
    const rate = danced / samples;
    // `1 - staticAttack` = 0,2. A amostra é de 1.000 vencimentos de Bernoulli(0,2): o desvio
    // padrão é ~0,0126, então a banda abaixo é generosa (~8 desvios) sem deixar de pegar um
    // sorteio que passou a rodar em outra sequência de RNG.
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.3);
  });

  it('monstro SEM staticAttack nunca dança — nenhum passo enquanto está só colado', () => {
    const { session, hero, ruleset } = start({ loaded: content({ monsters: [rat] }), health: 100_000 });
    session.cancelEvents(hero.id);
    run(session, 20_000, 100);
    const monster = ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta instância');
    expect(distance(monster.position, hero.position)).toBe(1);
    const before = { ...monster.position };
    run(session, 10_000, 100);
    expect(monster.position).toEqual(before);
  });

  it('`danceArmed` sobrevive ao snapshot — sem ele, a hunt retomada dobraria o evento', () => {
    const { session, monster } = settle();
    expect(monster.danceArmed).toBe(true);
    const snapshot = session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, Rng.fromSeed('session-1'),
    );
    const resumedMonster = (resumed.ruleset as HuntRuleset).monsters[0];
    if (resumedMonster === undefined) throw new Error('sem monstro');
    expect(resumedMonster.danceArmed).toBe(true);
  });
});

describe('volta ao spawn, ocioso e passo aleatório (#655, Canary `Monster::getNextStep`)', () => {
  // Um rato de HP absurdo e sem ataque: o assunto aqui é ONDE ele está, não quem vence — e o
  // herói fica CONGELADO (`cancelEvents`) e é movido à mão, para o teste dizer exatamente quando
  // ele entra e sai da área de visão (`aggroRadius` 8) do monstro.
  const wanderer = {
    ...rat, id: 'wanderer', name: 'Wanderer', health: 1_000_000, attack: 0, aggroRadius: 8,
  };

  // --- corredor largo: o monstro nasce longe do herói ---------------------------------------
  const wall = '#'.repeat(30);
  const row = `#${'.'.repeat(28)}#`;
  const corridorMap = { id: 'arena', z: 7, grid: [wall, row, row, row, wall] };
  const corridorRoute = {
    id: 'arena-loop', mapId: 'arena',
    tiles: [{ x: 1, y: 2, z: 7 }, { x: 2, y: 2, z: 7 }],
    spawnPoints: [{
      routeIndex: 0, radius: 1, at: { x: 20, y: 2, z: 7 }, monsterId: 'wanderer', respawnDelayMs: 30_000,
    }],
  };
  const corridorContent = () => content({
    maps: [corridorMap], routes: [corridorRoute], monsters: [wanderer],
  });

  const corridor = () => {
    const started = start({ loaded: corridorContent() });
    started.session.advanceBy(50); // o monstro nasce, no spawn (20, 2)
    started.session.cancelEvents(started.hero.id);
    const monster = started.ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    return { ...started, monster };
  };

  /** Eventos `creature-moved` do monstro, datados pelo instante lógico do `advanceBy` que os trouxe. */
  const movesOf = (session: Session, subject: string, durationMs: number, stepMs: number) => {
    const moves: Array<{ atMs: number; from: GridPoint; to: GridPoint }> = [];
    for (let t = 0; t < durationMs && session.ended === null; t += stepMs) {
      session.advanceBy(stepMs);
      for (const e of session.drainEvents()) {
        if (e.kind === 'creature-moved' && e.creatureId === subject) {
          moves.push({ atMs: session.nowMs, from: e.from, to: e.to });
        }
      }
    }
    return moves;
  };

  it('ocioso: no spawn, sem ninguém à vista e sem condição, o monstro não dá um passo — por minutos', () => {
    const { session, monster } = corridor();
    expect(monster.position).toEqual({ x: 20, y: 2, z: 7 });
    session.drainEvents();
    expect(movesOf(session, monster.subject, 180_000, 1_000)).toHaveLength(0);
    expect(monster.position).toEqual({ x: 20, y: 2, z: 7 });
    expect(monster.lastMoveAtMs).toBeNull();
    expect(monster.walkingBack).toBe(false);
    expect(monster.randomStepping).toBe(false);
  });

  it('o alvo sai da área de visão: o monstro larga o alvo, VOLTA ao spawn e fica ocioso lá', () => {
    const { session, hero, monster } = corridor();
    // O herói entra na visão (6 tiles): o monstro acorda, escolhe o alvo e vem.
    hero.position = { x: 14, y: 2, z: 7 };
    monster.contribution.record(hero.id, 10);
    run(session, 4_000, 100);
    expect(monster.targetId).toBe(hero.id);
    expect(monster.position.x).toBeLessThan(20);
    expect(monster.walkingBack).toBe(false);

    // O herói some da visão (14 tiles): a lista de alvos esvazia, ele larga o alvo e volta.
    hero.position = { x: 1, y: 2, z: 7 };
    run(session, 1_000, 100);
    expect(monster.targetId).toBeNull();
    expect(monster.walkingBack).toBe(true);
    run(session, 30_000, 100);
    // Chegou EXATAMENTE ao home — e ocioso: `Creature::onIdleStatus` esquece quem bateu nele.
    expect(monster.position).toEqual({ x: 20, y: 2, z: 7 });
    expect(monster.contribution.actorCount).toBe(0);
    expect(monster.targetId).toBeNull();
    // Ocioso de novo: nenhum passo mais.
    const lastMove = monster.lastMoveAtMs;
    session.drainEvents();
    expect(movesOf(session, monster.subject, 20_000, 1_000)).toHaveLength(0);
    expect(monster.lastMoveAtMs).toBe(lastMove);
  });

  it('a volta é UM tile por vencimento, sempre em direção ao home — nunca ao acaso', () => {
    const { session, hero, monster } = corridor();
    hero.position = { x: 14, y: 2, z: 7 };
    run(session, 4_000, 100);
    hero.position = { x: 1, y: 2, z: 7 };
    session.drainEvents();
    const rngBefore = session.rng.getState();
    const moves = movesOf(session, monster.subject, 30_000, 100);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(distance(move.to, { x: 20, y: 2 })).toBeLessThan(distance(move.from, { x: 20, y: 2 }));
    }
    // A volta não sorteia nada: a semente da sessão fica intocada.
    expect(session.rng.getState()).toEqual(rngBefore);
  });

  it('a volta e o ocioso valem IGUAL a 1 Hz e a 20 Hz (invariante 2) — o snapshot inteiro coincide', () => {
    const scenario = (stepMs: number) => {
      const { session, hero, monster } = corridor();
      hero.position = { x: 14, y: 2, z: 7 };
      monster.contribution.record(hero.id, 10);
      run(session, 4_000, stepMs);
      hero.position = { x: 1, y: 2, z: 7 };
      run(session, 31_000, stepMs);
      return { snapshot: session.snapshot(), monster: monster.getState() };
    };
    const twentyHz = scenario(50);
    const oneHz = scenario(1_000);
    expect(oneHz.monster.position).toEqual({ x: 20, y: 2, z: 7 });
    expect(oneHz.monster).toEqual(twentyHz.monster);
    expect(oneHz.snapshot).toEqual(twentyHz.snapshot);
  });

  it('um snapshot NO MEIO da volta retoma e chega ao mesmo lugar, com o mesmo estado (restauração)', () => {
    const loaded = corridorContent();
    const build = () => {
      const started = start({ loaded });
      started.session.advanceBy(50);
      started.session.cancelEvents(started.hero.id);
      const monster = started.ruleset.monsters[0];
      if (monster === undefined) throw new Error('sem monstro nesta cena');
      started.hero.position = { x: 14, y: 2, z: 7 };
      monster.contribution.record(started.hero.id, 10);
      run(started.session, 4_000, 100);
      started.hero.position = { x: 1, y: 2, z: 7 };
      run(started.session, 1_500, 100);
      return { ...started, monster };
    };
    const straight = build();
    const interrupted = build();
    expect(interrupted.monster.walkingBack).toBe(true);
    expect(interrupted.monster.position.x).toBeLessThan(20);

    const snapshot = JSON.parse(JSON.stringify(interrupted.session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, new Rng(snapshot.rng),
    );
    const resumedMonster = (resumed.ruleset as HuntRuleset).monsters[0];
    if (resumedMonster === undefined) throw new Error('sem monstro na retomada');
    expect(resumedMonster.walkingBack).toBe(true);
    // O herói da retomada continua fora da visão: o cenário é sobre o monstro.
    const resumedHero = resumed.participants[0];
    if (resumedHero === undefined) throw new Error('sem herói na retomada');
    resumedHero.position = { x: 1, y: 2, z: 7 };
    resumed.cancelEvents(resumedHero.id);

    run(straight.session, 30_000, 100);
    run(resumed, 30_000, 100);
    expect(resumedMonster.position).toEqual({ x: 20, y: 2, z: 7 });
    expect(resumedMonster.getState()).toEqual(straight.monster.getState());
  });

  it('com uma condição ativa o monstro NÃO fica ocioso: anda ao acaso no spawn, e volta e sossega quando ela some', () => {
    const { session, monster } = corridor();
    // Dura mais que a janela de observação; o teste a remove à mão, sem o evento de vencimento.
    monster.conditions.apply({ key: 'burning', expiresAtMs: session.nowMs + 600_000 });
    session.drainEvents();
    const moves = movesOf(session, monster.subject, 30_000, 100);
    expect(moves.length).toBeGreaterThan(2);
    // Cada passo é cardinal e o intervalo entre eles respeita o segundo mínimo.
    for (const move of moves) expect(Math.abs(move.to.x - move.from.x) + Math.abs(move.to.y - move.from.y)).toBe(1);
    for (let i = 1; i < moves.length; i++) {
      expect((moves[i]?.atMs ?? 0) - (moves[i - 1]?.atMs ?? 0)).toBeGreaterThanOrEqual(1_000);
    }
    expect(monster.randomStepping).toBe(true);

    // A condição some: sem ninguém à vista e fora do spawn, ele volta — e fica ocioso no home.
    monster.conditions.remove('burning');
    run(session, 60_000, 100);
    expect(monster.position).toEqual({ x: 20, y: 2, z: 7 });
    expect(monster.walkingBack).toBe(false);
    const lastMove = monster.lastMoveAtMs;
    session.drainEvents();
    expect(movesOf(session, monster.subject, 20_000, 1_000)).toHaveLength(0);
    expect(monster.lastMoveAtMs).toBe(lastMove);
  });

  // --- monstro com alvo à vista mas sem passo até ele: o corredor selado ----------------------
  // O herói está em cima (y=1); o monstro num corredor selado embaixo (y=3), com uma parede
  // inteira entre os dois. O passo guloso o põe sob o herói (x=4) e ali ele empaca: N, NE e NO são
  // parede. É o `!hasFollowPath && getFollowCreature()` do Canary — e é onde `doRandomStep` roda.
  const sealedRow = `#${'.'.repeat(7)}#`;
  const sealedWall = '#'.repeat(9);
  const sealedMap = {
    id: 'arena', z: 7, grid: [sealedWall, sealedRow, sealedWall, sealedRow, sealedWall],
  };
  const sealedRoute = {
    id: 'arena-loop', mapId: 'arena',
    tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
    spawnPoints: [{
      routeIndex: 0, radius: 1, at: { x: 4, y: 3, z: 7 }, monsterId: 'wanderer', respawnDelayMs: 30_000,
    }],
  };
  const sealedContent = () => content({
    maps: [sealedMap], routes: [sealedRoute], monsters: [wanderer],
  });
  const sealed = () => {
    const started = start({ loaded: sealedContent() });
    started.session.advanceBy(50);
    started.session.cancelEvents(started.hero.id);
    started.hero.position = { x: 4, y: 1, z: 7 };
    const monster = started.ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    return { ...started, monster };
  };

  it('com alvo à vista e sem passo até ele, anda ao acaso — um passo cardinal, no máximo um por segundo', () => {
    const { session, monster } = sealed();
    session.drainEvents();
    const moves = movesOf(session, monster.subject, 40_000, 100);
    // O guloso só empurra rumo a x=4; qualquer passo que SE AFASTA de x=4 é sorteio.
    const random = moves.filter((m) => Math.abs(m.to.x - 4) > Math.abs(m.from.x - 4));
    expect(random.length).toBeGreaterThan(5);
    for (const move of random) {
      expect(Math.abs(move.to.x - move.from.x) + Math.abs(move.to.y - move.from.y)).toBe(1);
    }
    // O intervalo é medido desde o ÚLTIMO PASSO, qualquer que ele seja (o guloso de volta ao x=4
    // também conta) — então entre dois sorteios há sempre pelo menos um segundo.
    for (let i = 1; i < random.length; i++) {
      expect((random[i]?.atMs ?? 0) - (random[i - 1]?.atMs ?? 0)).toBeGreaterThanOrEqual(1_000);
    }
    // E o passo que sortearam é o primeiro depois de 1000 ms do passo anterior — nunca antes.
    const all = moves.map((m) => m.atMs);
    for (const move of random) {
      const previous = all.filter((t) => t < move.atMs).at(-1);
      if (previous !== undefined) expect(move.atMs - previous).toBeGreaterThanOrEqual(1_000);
    }
    expect(monster.lastStepBlocked).toBe(true);
  });

  it('sortear é SEMPRE de três em três: cada passo aleatório consome exatamente 3 `rng.integer`', () => {
    // `shuffledCardinals` = Fisher-Yates completo dos 4 cardeais (`std::ranges::shuffle` no
    // Canary): 3 sorteios por tentativa, com tile livre ou não. Nada mais no cenário sorteia.
    class CountingRng extends Rng {
      integerCalls = 0;

      override integer(min: number, max: number): number {
        this.integerCalls++;
        return super.integer(min, max);
      }
    }
    const rng = new CountingRng(Rng.fromSeed('random-step-draws').getState());
    const ruleset = createHuntRuleset(sealedContent(), 'arena', 'cautious');
    const session = new Session({
      id: 'random-step-draws', contentVersion: sealedContent().version, ruleset, rng, createdAtMs: 0,
    });
    const hero = new CharacterRuntime({ ...character().getState(), id: 'hero' });
    session.enter(hero);
    session.advanceBy(50);
    session.cancelEvents(hero.id);
    hero.position = { x: 4, y: 1, z: 7 };
    rng.integerCalls = 0;
    run(session, 30_000, 100);
    expect(rng.integerCalls).toBeGreaterThan(0);
    expect(rng.integerCalls % 3).toBe(0);
  });

  it('o passo aleatório vale IGUAL a 1 Hz e a 20 Hz, e a semente é a mesma', () => {
    const scenario = (stepMs: number) => {
      const { session, monster } = sealed();
      run(session, 40_000, stepMs);
      return { snapshot: session.snapshot(), monster: monster.getState() };
    };
    const twentyHz = scenario(50);
    const oneHz = scenario(1_000);
    expect(oneHz.monster.lastMoveAtMs).not.toBeUndefined();
    expect(oneHz.monster).toEqual(twentyHz.monster);
    expect(oneHz.snapshot).toEqual(twentyHz.snapshot);
  });

  it('um snapshot no meio do passo aleatório retoma com a MESMA sequência de passos (restauração)', () => {
    const loaded = sealedContent();
    // Até o instante em que o passo aleatório acabou de ligar a flag: o guloso a desliga no passo
    // seguinte (`doFollowCreature`), então o snapshot precisa ser tirado NESSE vencimento.
    const build = () => {
      const started = sealed();
      for (let t = 0; t < 30_000 && !started.monster.randomStepping; t += 100) started.session.advanceBy(100);
      return started;
    };
    const straight = build();
    const interrupted = build();
    expect(interrupted.monster.randomStepping).toBe(true);

    const snapshot = JSON.parse(JSON.stringify(interrupted.session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, new Rng(snapshot.rng),
    );
    const resumedMonster = (resumed.ruleset as HuntRuleset).monsters[0];
    if (resumedMonster === undefined) throw new Error('sem monstro na retomada');
    expect(resumedMonster.lastMoveAtMs).toBe(interrupted.monster.lastMoveAtMs);
    expect(resumedMonster.randomStepping).toBe(true);
    const resumedHero = resumed.participants[0];
    if (resumedHero === undefined) throw new Error('sem herói na retomada');
    resumedHero.position = { x: 4, y: 1, z: 7 };
    resumed.cancelEvents(resumedHero.id);

    run(straight.session, 20_000, 100);
    run(resumed, 20_000, 100);
    expect(resumedMonster.getState()).toEqual(straight.monster.getState());
    expect(resumed.rng.getState()).toEqual(straight.session.rng.getState());
  });

  it('apanhar ENQUANTO anda ao acaso arma o bypass de campo — mesmo sem `lastStepBlocked` (Canary `drainHealth`)', () => {
    const { session, monster } = sealed();
    for (let t = 0; t < 30_000 && !monster.randomStepping; t += 100) session.advanceBy(100);
    expect(monster.randomStepping).toBe(true);
    // Com `lastStepBlocked` desligado, só o `randomStepping` explica o bypass.
    monster.lastStepBlocked = false;
    monster.noteDamageTaken(3);
    expect(monster.ignoresFieldDamage).toBe(true);
    // E quando a perseguição volta (o guloso o recoloca sob o herói), a flag desliga.
    session.advanceBy(600);
    expect(monster.randomStepping).toBe(false);
  });

  // --- a concavidade: o guloso empaca dentro da bolsa e a busca de caminho tira o monstro ------
  // A geometria que a revisão achou na Darashia Dragon Lair (o `(75,116)` do Dragon Lord m:31):
  // `M` (9,3) é uma bolsa sem saída — oeste, noroeste e sudoeste são parede — e o home é `H`
  // (3,3). O guloso de `(11,1)` desce em diagonal até a bolsa e empaca; a saída é pelo norte.
  //
  //   x: 0123456789012
  //   0  #############
  //   1  #...........#
  //   2  #...#...#...#
  //   3  #..H...##M###
  //   4  #......######
  //   5  #############
  const pocketGrid = [
    '#############',
    '#...........#',
    '#...#...#...#',
    '#......##.###',
    '#......######',
    '#############',
  ];
  const pocketContent = () => content({
    maps: [{ id: 'arena', z: 7, grid: pocketGrid }],
    routes: [{
      id: 'arena-loop', mapId: 'arena',
      tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
      spawnPoints: [{
        routeIndex: 0, radius: 1, at: { x: 3, y: 3, z: 7 }, monsterId: 'wanderer', respawnDelayMs: 30_000,
      }],
    }],
    monsters: [wanderer],
  });
  const FAR = { x: 100, y: 100, z: 7 };

  /**
   * O monstro que nasceu no home, levado para `to` por um snapshot editado e retomado — e não por
   * `monster.position = …`, que deixaria a ocupação do tile de origem fantasma (o home) e
   * impediria o último passo. O herói fica congelado e longe, fora da visão de todo o mapa.
   */
  const relocated = (to: GridPoint) => {
    const loaded = pocketContent();
    const started = start({ loaded });
    started.session.advanceBy(50);
    const snapshot = JSON.parse(JSON.stringify(started.session.snapshot())) as SessionSnapshot;
    const state = snapshot.ruleset as { monsters: MonsterState[] };
    const original = state.monsters[0];
    if (original === undefined) throw new Error('sem monstro no snapshot');
    state.monsters[0] = { ...original, position: { ...original.position, ...to } };
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, new Rng(snapshot.rng),
    );
    const hero = resumed.participants[0];
    if (hero === undefined) throw new Error('sem herói na retomada');
    resumed.cancelEvents(hero.id);
    hero.position = FAR;
    const monster = (resumed.ruleset as HuntRuleset).monsters[0];
    if (monster === undefined) throw new Error('sem monstro na retomada');
    return { session: resumed, monster, loaded };
  };

  it('a concavidade não prende quem volta: o guloso a pisa, a busca a tira — chega EXATAMENTE ao home e fica ocioso', () => {
    const { session, monster } = relocated({ x: 11, y: 1 });
    expect(monster.position).toEqual({ x: 11, y: 1, z: 7 });
    session.drainEvents();
    const tiles = movesOf(session, monster.subject, 90_000, 100).map((m) => `${String(m.to.x)},${String(m.to.y)}`);
    expect(monster.position).toEqual({ x: 3, y: 3, z: 7 });
    // Pisou na bolsa e saiu dela, sem nunca repetir um tile: nada de vaivém na boca.
    expect(tiles).toContain('9,3');
    expect(new Set(tiles).size).toBe(tiles.length);
    expect(tiles.at(-1)).toBe('3,3');
    // A busca acabou junto com a chegada, e o monstro fica ocioso: nenhum passo mais.
    session.drainEvents();
    expect(movesOf(session, monster.subject, 20_000, 1_000)).toHaveLength(0);
    expect(monster.walkBackByPath).toBe(false);
    expect(monster.idle).toBe(true);
  });

  it('a volta por busca de caminho vale IGUAL a 1 Hz e a 20 Hz (invariante 2) — o snapshot inteiro coincide', () => {
    const scenario = (stepMs: number) => {
      const { session, monster } = relocated({ x: 11, y: 1 });
      run(session, 90_000, stepMs);
      return { snapshot: session.snapshot(), monster: monster.getState() };
    };
    const twentyHz = scenario(50);
    const oneHz = scenario(1_000);
    expect(oneHz.monster.position).toEqual({ x: 3, y: 3, z: 7 });
    expect(oneHz.monster).toEqual(twentyHz.monster);
    expect(oneHz.snapshot).toEqual(twentyHz.snapshot);
  });

  it('um snapshot com a busca de caminho LIGADA retoma no mesmo passo e chega ao mesmo lugar (restauração)', () => {
    const build = () => {
      const started = relocated({ x: 11, y: 1 });
      // Até o instante em que o guloso empacou na bolsa e o flag ligou.
      for (let t = 0; t < 60_000 && !started.monster.walkBackByPath; t += 100) started.session.advanceBy(100);
      return started;
    };
    const straight = build();
    const interrupted = build();
    expect(interrupted.monster.walkBackByPath).toBe(true);
    expect(interrupted.monster.walkingBack).toBe(true);

    const snapshot = JSON.parse(JSON.stringify(interrupted.session.snapshot())) as SessionSnapshot;
    const resumed = Session.fromSnapshot(
      snapshot, huntRulesetFromSnapshot(snapshot, interrupted.loaded) as HuntRuleset, new Rng(snapshot.rng),
    );
    const resumedMonster = (resumed.ruleset as HuntRuleset).monsters[0];
    if (resumedMonster === undefined) throw new Error('sem monstro na retomada');
    expect(resumedMonster.walkBackByPath).toBe(true);
    const resumedHero = resumed.participants[0];
    if (resumedHero === undefined) throw new Error('sem herói na retomada');
    resumedHero.position = FAR;
    resumed.cancelEvents(resumedHero.id);

    run(straight.session, 60_000, 100);
    run(resumed, 60_000, 100);
    expect(resumedMonster.position).toEqual({ x: 3, y: 3, z: 7 });
    expect(resumedMonster.getState()).toEqual(straight.monster.getState());
    expect(resumed.rng.getState()).toEqual(straight.session.rng.getState());
  });

  // --- ocioso não usa defesa, não troca de alvo e não invoca (`onThink` não roda) ---------------
  // O Doom Deer (`doom_deer.lua`): defesa de haste em si mesmo. Aqui a cadência e o prazo são
  // curtos de propósito, para o teste caber em minutos lógicos; o que importa é a ORDEM — sem
  // ninguém à vista o monstro nasce ocioso e nunca chega a rolar a defesa.
  const sentinel = {
    ...wanderer, id: 'sentinel', name: 'Sentinel',
    defenses: [{
      id: 'haste', cadenceMs: 500, chance: 1,
      condition: { key: 'speed', durationMs: 4_000, effect: { kind: 'speed', type: 'haste', delta: 2_000 } },
    }],
    targetChange: { intervalMs: 500, chance: 1 },
  };
  const sentinelCorridor = () => {
    const started = start({
      loaded: content({
        maps: [corridorMap],
        routes: [{
          ...corridorRoute,
          spawnPoints: [{ ...corridorRoute.spawnPoints[0], monsterId: 'sentinel' }],
        }],
        monsters: [sentinel],
      }),
    });
    started.session.advanceBy(50); // o monstro nasce e decide (ninguém à vista: ocioso) no mesmo instante
    started.session.cancelEvents(started.hero.id);
    const monster = started.ruleset.monsters[0];
    if (monster === undefined) throw new Error('sem monstro nesta cena');
    return { ...started, monster };
  };

  it('ocioso NÃO rola defesa nem troca de alvo: sem haste, sem passo, sem tocar a semente — por minutos', () => {
    const { session, monster } = sentinelCorridor();
    run(session, 5_000, 100);
    expect(monster.idle).toBe(true);
    expect(monster.getState().idle).toBe(true);
    const rngBefore = session.rng.getState();
    session.drainEvents();
    expect(movesOf(session, monster.subject, 180_000, 1_000)).toHaveLength(0);
    // A haste do Doom Deer ocioso era o defeito: a condição impedia o ocioso e ele passeava.
    expect(monster.conditions.size).toBe(0);
    expect(monster.position).toEqual({ x: 20, y: 2, z: 7 });
    expect(monster.lastMoveAtMs).toBeNull();
    // Nada sorteado: `chance: 1` de defesa e de troca de alvo vencem a cada 500 ms, e nenhuma rolou.
    expect(session.rng.getState()).toEqual(rngBefore);
    // O flag sobrevive ao snapshot, ou uma hunt retomada rolaria a defesa de quem o Canary cala.
    expect(new MonsterRuntime(monster.getState()).idle).toBe(true);
  });

  it('alguém entra na visão: o monstro acorda, o flag desliga e a defesa volta a rolar', () => {
    const { session, hero, monster } = sentinelCorridor();
    run(session, 5_000, 100);
    expect(monster.idle).toBe(true);
    const rngBefore = session.rng.getState();
    hero.position = { x: 14, y: 2, z: 7 };
    run(session, 3_000, 100);
    expect(monster.idle).toBe(false);
    expect(monster.targetId).toBe(hero.id);
    expect(monster.conditions.get('speed')).not.toBeNull();
    expect(session.rng.getState()).not.toEqual(rngBefore);
  });

  it('o silêncio do ocioso vale IGUAL a 1 Hz e a 20 Hz (invariante 2): acorda, é hasteado, volta e sossega', () => {
    // Os números REAIS do Doom Deer (`doom_deer.lua`): a cada 3 s, 30 % de chance, haste de 8 s.
    // Com a cadência curta do `sentinel` acima a haste se renovaria sem parar e o monstro, com
    // condição, nunca sossegaria — o que é fiel ao Canary e inútil para este teste.
    const doomDeer = {
      ...sentinel, id: 'doom-deer',
      defenses: [{
        id: 'haste', cadenceMs: 3_000, chance: 0.3,
        condition: { key: 'speed', durationMs: 8_000, effect: { kind: 'speed', type: 'haste', delta: 2_000 } },
      }],
    };
    const scenario = (stepMs: number) => {
      const started = start({
        loaded: content({
          maps: [corridorMap],
          routes: [{
            ...corridorRoute,
            spawnPoints: [{ ...corridorRoute.spawnPoints[0], monsterId: 'doom-deer' }],
          }],
          monsters: [doomDeer],
        }),
      });
      const { session, hero } = started;
      session.advanceBy(50);
      session.cancelEvents(hero.id);
      const monster = started.ruleset.monsters[0];
      if (monster === undefined) throw new Error('sem monstro nesta cena');
      run(session, 30_000, stepMs);
      hero.position = { x: 14, y: 2, z: 7 };
      run(session, 10_000, stepMs);
      hero.position = { x: 1, y: 2, z: 7 };
      run(session, 600_000, stepMs);
      return { snapshot: session.snapshot(), monster: monster.getState() };
    };
    const twentyHz = scenario(50);
    const oneHz = scenario(1_000);
    // Sem ninguém à vista, o monstro que acordou voltou ao spawn e ficou ocioso de novo.
    expect(oneHz.monster.idle).toBe(true);
    expect(oneHz.monster.position).toEqual({ x: 20, y: 2, z: 7 });
    expect(oneHz.monster).toEqual(twentyHz.monster);
    expect(oneHz.snapshot).toEqual(twentyHz.snapshot);
  });

  // --- a provocação (Challenge) não é condição do Canary --------------------------------------
  it('provocado, o monstro que perde o alvo VOLTA ao spawn e sossega — a provocação não impede o ocioso', () => {
    const { session, hero, monster } = corridor();
    hero.position = { x: 14, y: 2, z: 7 };
    run(session, 4_000, 100);
    expect(monster.targetId).toBe(hero.id);
    // A condição da provocação, como `#applyChallenge` a deixa (sem o evento de vencimento: dura
    // mais que a janela do teste).
    monster.conditions.apply({
      key: CHALLENGE_CONDITION_KEY, targetId: monster.subject, sourceId: hero.id,
      expiresAtMs: session.nowMs + 600_000,
    });
    hero.position = { x: 1, y: 2, z: 7 };
    run(session, 1_000, 100);
    expect(monster.walkingBack).toBe(true);
    run(session, 30_000, 100);
    expect(monster.position).toEqual({ x: 20, y: 2, z: 7 });
    expect(monster.idle).toBe(true);
    expect(monster.conditions.get(CHALLENGE_CONDITION_KEY)).not.toBeNull();
    session.drainEvents();
    expect(movesOf(session, monster.subject, 20_000, 1_000)).toHaveLength(0);
  });
});

describe('condições de controle: rooted, feared e pacified (M44-04, #622, ADR 0041)', () => {
  // Uma arena ABERTA de 40x40: a fuga do medo precisa de chão (a sala de `map` tem 4x3) e a
  // caixa de busca dela é de sete tiles em volta de quem foge.
  const openMap = {
    id: 'open-622', z: 7,
    grid: [
      '#'.repeat(40),
      ...Array.from({ length: 38 }, () => `#${'.'.repeat(38)}#`),
      '#'.repeat(40),
    ],
  };
  const openRoute = (spawn: { x: number; y: number }, tiles: readonly { x: number; y: number }[] = [
    { x: 20, y: 20 }, { x: 21, y: 20 },
  ]) => ({
    id: 'open-622-route', mapId: 'open-622',
    tiles: tiles.map((tile) => ({ ...tile, z: 7 })),
    spawnPoints: [{
      routeIndex: 0, radius: 1, at: { ...spawn, z: 7 }, monsterId: 'caster', respawnDelayMs: 300_000,
    }],
  });
  const openHunt = {
    id: 'arena', name: 'Aberta', recommendedLevel: 1, mapId: 'open-622', routeId: 'open-622-route',
  };
  /** `fear`/`root` do Canary (`data-otservbr-global/scripts/spells/monster/`): alvo único, 3000 ms. */
  const controlAbility = (kind: 'rooted' | 'feared' | 'pacified', over: Record<string, unknown> = {}) => ({
    id: kind, cadenceMs: 1_000, chance: 1, target: { range: 20 }, power: 0, damageType: 'physical',
    condition: { key: kind, merge: 'longest', durationMs: 3_000, effect: { kind } },
    ...over,
  });
  /**
   * O lançador fica PARADO (`attackRange: 20`: já está ao alcance do herói e não persegue), sem
   * dano nenhum (`attack: 0`) e sem morrer — o que se mede é a condição, nunca o combate.
   */
  const casterOf = (abilities: readonly unknown[], over: Record<string, unknown> = {}) => ({
    ...rat, id: 'caster', name: 'Caster', health: 1_000_000, attack: 0, aggroRadius: 20,
    attackRange: 20, abilities, ...over,
  });
  const arena = (
    monsters: readonly unknown[], spawn = { x: 16, y: 20 },
    tiles?: readonly { x: number; y: number }[],
  ): Content => content({
    monsters, maps: [openMap], routes: [openRoute(spawn, tiles)], hunts: [openHunt],
  });
  /** Um herói só, parado no início da rota, e o tempo avançado em passos de 100 ms. */
  const advance = (session: Session, ms: number): void => {
    for (let elapsed = 0; elapsed < ms && session.ended === null; elapsed += 100) session.advanceBy(100);
  };

  describe('rooted', () => {
    it('recusa o `walk` do jogador com `rooted`, sem mover, e solta no instante exato do vencimento', () => {
      const { session, hero, ruleset } = start({ loaded: arena([casterOf([])]) });
      hero.conditions.apply({ key: 'rooted', expiresAtMs: 3_000, merge: 'longest' });
      const from = { ...hero.position };
      expect(ruleset.requestMove(session, hero.id, { x: from.x + 1, y: from.y }))
        .toEqual({ ok: false, reason: 'rooted' });
      // O `walk-to` distante também: nenhum caminho fica guardado para andar sozinho depois.
      expect(ruleset.requestMove(session, hero.id, { x: from.x + 6, y: from.y }))
        .toEqual({ ok: false, reason: 'rooted' });
      expect(hero.position).toEqual(from);
      session.advanceBy(2_999);
      expect(ruleset.requestMove(session, hero.id, { x: from.x + 1, y: from.y }))
        .toEqual({ ok: false, reason: 'rooted' });
      session.advanceBy(1);
      // O bot também solta no instante exato — o pedido é relativo ao tile ONDE O HERÓI ESTÁ.
      const now = hero.position;
      const freed = ruleset.requestMove(session, hero.id, { x: now.x, y: now.y + 1 });
      expect(freed.ok).toBe(true);
    });

    it('um `walk-to` distante guardado ANTES da raiz cai quando ela prende: nada anda sozinho depois', () => {
      // `Creature::onCreatureMove` zera a lista de passos de quem está enraizado
      // (`resetMovementState`, `creature.cpp:503`), e cada passo recusado por
      // `internalMoveCreature` sai dela de qualquer jeito: o caminho NÃO resiste à condição. Sem
      // isto o herói retomava, ao fim da raiz, o clique que ninguém repetiu.
      const { session, hero, ruleset } = start({ loaded: arena([casterOf([])]) });
      const from = { ...hero.position };
      const destination = { x: from.x, y: from.y - 8 };
      expect(ruleset.requestMove(session, hero.id, destination).ok).toBe(true);
      expect(ruleset.getState().runners?.[hero.id]?.manualWalkTo?.path.length).toBeGreaterThan(2);
      hero.conditions.apply({ key: 'rooted', expiresAtMs: session.nowMs + 3_000, merge: 'longest' });
      // O primeiro passo que a raiz recusa derruba o caminho guardado.
      advance(session, 1_500);
      expect(ruleset.getState().runners?.[hero.id]?.manualWalkTo).toBeUndefined();
      // E ao fim da raiz o herói NÃO retoma o caminho: o bot volta pela rota dele.
      advance(session, 12_000);
      expect(hero.position.y).toBeGreaterThan(destination.y + 3);
    });

    it('o bot fica parado enquanto dura, e a rota retoma quando vence', () => {
      const { session, hero } = start({ loaded: arena([casterOf([])]) });
      hero.conditions.apply({ key: 'rooted', expiresAtMs: 2_000, merge: 'longest' });
      advance(session, 1_900);
      expect(hero.position).toEqual({ x: 20, y: 20, z: 7 });
      // A rota é de dois tiles e o herói vai e volta: o que importa é que ANDOU, não onde está.
      let moved = false;
      for (let elapsed = 0; elapsed < 2_000; elapsed += 50) {
        session.advanceBy(50);
        if (hero.position.x !== 20 || hero.position.y !== 20) moved = true;
      }
      expect(moved).toBe(true);
    });

    it('prende o MONSTRO também: ele não persegue enquanto dura', () => {
      // `Game::internalMoveCreature` recusa o passo de QUALQUER criatura sob rooted. Um monstro
      // que persegue de longe (o `chase` abaixo) não sai do tile.
      const chaser = casterOf([], { attackRange: 1, speed: 300 });
      const { session, hero, ruleset } = start({ loaded: arena([chaser], { x: 30, y: 20 }) });
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou o monstro');
      hero.conditions.apply({ key: 'pacified', expiresAtMs: 60_000, merge: 'longest' });
      const at = { x: 30, y: 20, z: 7 };
      plant(monster, at);
      monster.conditions.apply({ key: 'rooted', expiresAtMs: 2_000, merge: 'longest' });
      advance(session, 1_900);
      expect(monster.position).toEqual(at);
      advance(session, 2_000);
      expect(distance(monster.position, hero.position)).toBeLessThan(distance(at, hero.position));
    });

    it('a ability de um monstro prende o herói por 3 s, e o vencimento é um evento da fila', () => {
      const { session, hero } = start({ loaded: arena([casterOf([controlAbility('rooted')])]) });
      advance(session, 1_100);
      const rooted = hero.conditions.get('rooted');
      expect(rooted).toMatchObject({ key: 'rooted', merge: 'longest' });
      expect(rooted?.expiresAtMs).toBeGreaterThan(3_000);
      // Enquanto dura, o bot não anda. Fica ancorado no tile: a ability relança a cada 1 s com
      // `longest` — o prazo só cresce, nunca encurta.
      const anchored = { ...hero.position };
      advance(session, 1_500);
      expect(hero.position).toEqual(anchored);
      expect(hero.conditions.get('rooted')?.expiresAtMs ?? 0).toBeGreaterThanOrEqual(rooted?.expiresAtMs ?? 0);
    });

    it('um monstro IMUNE (`conditionImmunities: ["rooted"]`) não é preso pela runa; o outro é', () => {
      const rootRune = {
        id: 'root-rune-test', name: 'Root', price: 10, group: 'support', groupCooldownMs: 2_000,
        requires: {},
        effect: {
          kind: 'condition' as const, target: 'enemy' as const, range: 4,
          condition: { key: 'rooted', merge: 'longest' as const, durationMs: 6_000, effect: { kind: 'rooted' as const } },
        },
      };
      const cast = (conditionImmunities: readonly string[]) => {
        const { session, ruleset } = withSpells(botConfig({}), {
          supplies: [rootRune], monstersRaw: [{ ...rat, conditionImmunities }],
        });
        session.advanceBy(1);
        const monster = ruleset.monsters[0];
        if (monster === undefined) throw new Error('faltou rato');
        const target = { kind: 'monster' as const, subject: monsterSubject(monster.id) };
        expect(ruleset.useItemOn(session, 'hero', { supplyId: 'root-rune-test' }, 1, target)).toEqual({ ok: true });
        return monster.conditions.get('rooted');
      };
      expect(cast([])).toMatchObject({ key: 'rooted', expiresAtMs: 6_001 });
      expect(cast(['rooted'])).toBeNull();
    });
  });

  describe('pacified', () => {
    /**
     * Um herói colado num alvo PARADO (o rato de dano zero), `pacified` até `expiresAtMs`: o
     * instante em que o primeiro golpe sai e a fase de pensamento do herói. Nada anda — o único
     * gatilho que sobra é o pensamento.
     */
    const swingAfter = (expiresAtMs: number): { at: number; phase: number } => {
      const dummy = casterOf([], { attackRange: 1 });
      const { session, hero, ruleset } = start({ loaded: arena([dummy], { x: 22, y: 20 }) });
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou o monstro');
      plant(monster, { x: hero.position.x + 1, y: hero.position.y, z: 7 });
      const full = monster.health;
      hero.conditions.apply({ key: 'pacified', expiresAtMs, merge: 'longest' });
      while (monster.health === full && session.nowMs < expiresAtMs + 2_000) session.advanceBy(1);
      const phase = ruleset.getState().runners?.[hero.id]?.thinkPhaseMs;
      if (phase === undefined) throw new Error('o personagem devia ter uma fase de pensamento');
      return { at: session.nowMs, phase };
    };
    const thinkAfter = (instantMs: number, phase: number): number =>
      instantMs + ((((phase - instantMs) % 1_000) + 1_000) % 1_000);

    it('sem golpe enquanto vale, e o golpe volta no PENSAMENTO seguinte ao vencimento — não no instante exato', () => {
      // `Player::doAttacking` volta sob `pacified` (`player.cpp:3982`) e NINGUÉM re-arma o ataque
      // quando ela acaba: o próximo golpe é o primeiro gatilho depois do prazo — o pensamento do
      // personagem (`Game::checkCreatures`, 1 Hz, fase própria sorteada UMA vez). Duas
      // pacificações 500 ms distantes não podem as duas cair na grade: ao menos uma volta DEPOIS.
      const first = swingAfter(6_000);
      const second = swingAfter(6_500);
      expect(second.phase).toBe(first.phase);
      expect(first.at).toBe(thinkAfter(6_000, first.phase));
      expect(second.at).toBe(thinkAfter(6_500, second.phase));
      expect(first.at >= 6_000 && first.at < 7_000).toBe(true);
      expect(second.at >= 6_500 && second.at < 7_500).toBe(true);
      expect(first.at > 6_000 || second.at > 6_500).toBe(true);
    });

    it('um passo do personagem DEPOIS do vencimento e antes do pensamento solta o golpe (`onCreatureMove`); antes do vencimento, não', () => {
      // O `extra swing` do Canary (`creature.cpp:569`): quem anda — ou o alvo dele — e já passou
      // um intervalo de ataque, bate na hora. Escolhe o vencimento para o pensamento cair 700 ms
      // depois dele, e dá um passo (que mantém o rato ao alcance) 99 ms depois do vencimento.
      const { phase } = swingAfter(6_000);
      const expiresAtMs = 6_000 + ((((phase - 700 - 6_000) % 1_000) + 1_000) % 1_000);
      const dummy = casterOf([], { attackRange: 1 });
      const { session, hero, ruleset } = start({ loaded: arena([dummy], { x: 22, y: 20 }) });
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou o monstro');
      plant(monster, { x: hero.position.x + 1, y: hero.position.y, z: 7 });
      const full = monster.health;
      const home = { x: hero.position.x, y: hero.position.y };
      hero.conditions.apply({ key: 'pacified', expiresAtMs, merge: 'longest' });
      session.advanceBy(expiresAtMs - 300 - session.nowMs);
      // Sob a condição o passo não solta nada: `doAttacking` volta.
      expect(ruleset.requestMove(session, hero.id, { x: home.x, y: home.y + 1 }).ok).toBe(true);
      session.advanceBy(299);
      expect(session.nowMs).toBe(expiresAtMs - 1);
      expect(monster.health).toBe(full);
      session.advanceBy(100);
      expect(session.nowMs).toBe(expiresAtMs + 99);
      expect(monster.health).toBe(full);
      // Vencida, e 600 ms antes do pensamento: o passo traz o golpe de volta NA HORA.
      expect(ruleset.requestMove(session, hero.id, home).ok).toBe(true);
      session.advanceBy(1);
      expect(monster.health).toBeLessThan(full);
      expect(session.nowMs).toBeLessThan(expiresAtMs + 700);
    });

    it('a retomada do golpe vale IGUAL a 1 Hz, 4 Hz e 20 Hz e depois de um snapshot (invariantes 2 e 3)', () => {
      // O estacionamento (`attackParked`), a fase de pensamento e o `ATTACK_THINK` na fila são
      // estado como qualquer outro: o rastro inteiro — vida do alvo, condições, Rng, runner,
      // monstros — não pode depender de quem avança nem de um corte no meio.
      const scene = () => {
        const dummy = casterOf([], { attackRange: 1 });
        const { session, hero, ruleset } = start({ loaded: arena([dummy], { x: 22, y: 20 }) });
        session.advanceBy(1);
        const monster = ruleset.monsters[0];
        if (monster === undefined) throw new Error('faltou o monstro');
        plant(monster, { x: hero.position.x + 1, y: hero.position.y, z: 7 });
        hero.conditions.apply({ key: 'pacified', expiresAtMs: 6_300, merge: 'longest' });
        return session;
      };
      const print = (session: Session): unknown => {
        const hero = session.participants[0] as CharacterRuntime;
        const ruleset = session.ruleset as HuntRuleset;
        return {
          at: session.nowMs,
          position: { ...hero.position },
          conditions: hero.conditions.getState(),
          rng: session.snapshot().rng,
          runner: ruleset.getState().runners?.[hero.id],
          monsters: ruleset.monsters.map((monster) => monster.getState()),
        };
      };
      const trace = (stepMs: number): unknown[] => {
        const session = scene();
        const out: unknown[] = [];
        for (let elapsed = 0; elapsed < 10_000; elapsed += stepMs) {
          session.advanceBy(stepMs);
          if ((session.nowMs - 1) % 1_000 === 0) out.push(print(session));
        }
        return out;
      };
      const oneHz = trace(1_000);
      expect(trace(250)).toEqual(oneHz);
      expect(trace(50)).toEqual(oneHz);

      // Corte NO MEIO do estacionamento: pacificado, golpe parado, `ATTACK_THINK` na fila.
      const session = scene();
      session.advanceBy(5_000);
      const parked = (session.ruleset as HuntRuleset).getState().runners?.hero;
      expect(parked?.attackParked).toBe(true);
      const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
      const restored = Session.fromSnapshot(
        snapshot, huntRulesetFromSnapshot(snapshot, arena([casterOf([], { attackRange: 1 })], { x: 22, y: 20 })) as HuntRuleset,
        new Rng(snapshot.rng),
      );
      for (let elapsed = 0; elapsed < 5_000; elapsed += 100) {
        session.advanceBy(100);
        restored.advanceBy(100);
        expect(print(restored)).toEqual(print(session));
      }
      expect((session.ruleset as HuntRuleset).getState().runners?.hero?.attackParked).toBeUndefined();
    });

    it('a trava de escada NÃO encurta uma pacificação mais longa que já corre (`Condition::updateCondition`)', () => {
      // O mesmo mapa e a mesma escada do describe "stairhop", acima.
      const stairsMap = {
        id: 'casa-622', z: 7,
        floors: {
          '7': { grid: ['######', '#....#', '#....#', '######'] },
          '6': { grid: ['######', '#....#', '#....#', '######'] },
        },
        floorChanges: [
          { from: { x: 2, y: 1, z: 7 }, to: { x: 3, y: 1, z: 6 } },
          { from: { x: 3, y: 2, z: 6 }, to: { x: 2, y: 2, z: 7 } },
        ],
      };
      const stairsRoute = {
        id: 'casa-622-loop', mapId: 'casa-622',
        tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 2, z: 6 }],
        spawnPoints: [{
          routeIndex: 2, radius: 1, at: { x: 3, y: 2, z: 6 }, monsterId: 'rat', respawnDelayMs: 300_000,
        }],
      };
      const stairsHunt = {
        id: 'arena', name: 'Casa', recommendedLevel: 1, mapId: 'casa-622', routeId: 'casa-622-loop',
      };
      const combatV3 = {
        ...combat, compatibilityProfile: 'combat-v3',
        weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09 },
        distanceHitChance: { defaultMaxHitChance: 90, buckets: [] },
        stairhopDelayMs: 2_000,
      };
      const loaded = content({
        maps: [stairsMap], routes: [stairsRoute], hunts: [stairsHunt], combat: [combatV3],
      });
      const { session, hero } = start({ loaded });
      // Uma pacificação de 10 s já correndo quando a escada é descida (2 s).
      hero.conditions.apply({ key: 'pacified', expiresAtMs: 10_000, merge: 'longest' });
      session.advanceBy(1);
      expect(hero.position).toEqual({ x: 3, y: 1, z: 6 });
      expect(hero.conditions.get('pacified')?.expiresAtMs).toBe(10_000);
    });

    it('Swift Foot (#622, `swift_foot.lua`): acelera e pacifica por 10 s — sem golpe e sem magia agressiva', () => {
      const swiftFoot = {
        id: 'swift-foot', name: 'Swift Foot', manaCost: 20, cooldownMs: 10_000,
        effect: { kind: 'haste' as const, speedPercent: 80, durationMs: 10_000, pacifies: true },
      };
      const { session, hero, ruleset } = withSpells(
        botConfigV2([
          { do: { kind: 'spell', spellId: 'swift-foot' }, auto: false },
          { do: { kind: 'spell', spellId: 'strike' }, auto: false },
        ]),
        { mana: 200, spells: [...spells, swiftFoot] },
      );
      session.advanceBy(1);
      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: true });
      expect(hero.conditions.get('haste')?.speedPercent).toBe(80);
      const pacified = hero.conditions.get('pacified');
      expect(pacified).toMatchObject({ key: 'pacified', merge: 'longest', expiresAtMs: session.nowMs + 10_000 });
      // A magia agressiva recusa enquanto a haste dura, com o prazo exato...
      expect(ruleset.useSlot(session, 'hero', 0, 1)).toMatchObject({ ok: false, reason: 'attack-locked' });
      // ...e o herói não bate no rato: a vida dele não cai em 9,9 s.
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou rato');
      const full = monster.health;
      run(session, 9_900, 100);
      expect(monster.health).toBe(full);
      // Vencida a pacificação, o herói volta a atacar.
      run(session, 1_100, 100);
      expect(hero.conditions.get('pacified')).toBeNull();
      run(session, 5_000, 100);
      expect(monster.health).toBeLessThan(full);
    });

    it('nunca para o MONSTRO: a condição só existe para o jogador (o monstro não conhece `doAttacking`)', () => {
      const biter = casterOf([], { attackRange: 1, attack: 10, attackIntervalMs: 500 });
      const { session, hero, ruleset } = start({ loaded: arena([biter], { x: 21, y: 21 }) });
      advance(session, 200);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou o monstro');
      monster.conditions.apply({ key: 'pacified', expiresAtMs: 60_000, merge: 'longest' });
      const before = hero.health;
      advance(session, 3_000);
      expect(hero.health).toBeLessThan(before);
    });

    it('um monstro IMUNE (`conditionImmunities: ["pacified"]`) recusa a condição da runa', () => {
      const calmRune = {
        id: 'calm-rune-test', name: 'Calm', price: 10, group: 'support', groupCooldownMs: 2_000,
        requires: {},
        effect: {
          kind: 'condition' as const, target: 'enemy' as const, range: 4,
          condition: { key: 'pacified', merge: 'longest' as const, durationMs: 6_000, effect: { kind: 'pacified' as const } },
        },
      };
      const cast = (conditionImmunities: readonly string[]) => {
        const { session, ruleset } = withSpells(botConfig({}), {
          supplies: [calmRune], monstersRaw: [{ ...rat, conditionImmunities }],
        });
        session.advanceBy(1);
        const monster = ruleset.monsters[0];
        if (monster === undefined) throw new Error('faltou rato');
        const target = { kind: 'monster' as const, subject: monsterSubject(monster.id) };
        ruleset.useItemOn(session, 'hero', { supplyId: 'calm-rune-test' }, 1, target);
        return monster.conditions.get('pacified');
      };
      expect(cast([])).not.toBeNull();
      expect(cast(['pacified'])).toBeNull();
    });
  });

  describe('feared', () => {
    // A cadência de 4 s (e não 1 s) é para o medo poder ACABAR entre duas ofertas: o Canary deixa
    // relançar o medo no intervalo entre o prazo e o pensamento final (a condição ainda existe, e
    // `hasCondition` já é falso) — com uma oferta por segundo ele se renovaria para sempre.
    const fearedContent = () => arena([casterOf([controlAbility('feared', { cadenceMs: 4_000 })])]);

    /** O herói foge do lançador: os tiles por onde ele passou, um por passo. */
    function trace(session: Session, hero: CharacterRuntime, ms: number): { x: number; y: number }[] {
      const path: { x: number; y: number }[] = [];
      for (let elapsed = 0; elapsed < ms && session.ended === null; elapsed += 50) {
        session.advanceBy(50);
        const last = path[path.length - 1];
        if (last === undefined || last.x !== hero.position.x || last.y !== hero.position.y) {
          path.push({ x: hero.position.x, y: hero.position.y });
        }
      }
      return path;
    }

    it('a ability de medo faz o herói FUGIR do lançador: a condição guarda de onde e para onde', () => {
      const { session, hero, ruleset } = start({ loaded: fearedContent() });
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou o lançador');
      plant(monster, { x: 16, y: 20, z: 7 });
      advance(session, 1_200);
      const feared = hero.conditions.get('feared');
      expect(feared).toMatchObject({ key: 'feared', merge: 'longest' });
      // O lançador a oeste (offset do herói: x ≥ 1, y = 0): a região do Canary manda fugir para
      // o LESTE — `fleeIndx` 2.
      expect(feared?.flee).toEqual({ from: { x: 16, y: 20, z: 7 }, index: 2 });
      expect(feared?.expiresAtMs).toBe(3_000);
    });

    it('foge por ~3 s para o lado oposto ao lançador, para ao acabar, e ganha 10 s de imunidade', () => {
      const { session, hero, ruleset } = start({ loaded: fearedContent() });
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou o lançador');
      plant(monster, { x: 16, y: 20, z: 7 });
      const startX = hero.position.x;
      const path = trace(session, hero, 9_000);
      // Fugiu para o leste (longe do lançador a oeste) — vários tiles, nunca voltando para ele.
      expect(Math.max(...path.map((tile) => tile.x))).toBeGreaterThanOrEqual(startX + 5);
      // Acabou (a condição saiu) e a imunidade foi gravada.
      expect(hero.conditions.get('feared')).toBeNull();
      expect(hero.cleanseImmunity.get('feared')).toBeGreaterThan(0);
    });

    it('não anda pelo próprio caminho enquanto foge: o `walk` do jogador é recusado com `feared`', () => {
      const { session, hero, ruleset } = start({ loaded: fearedContent() });
      hero.conditions.apply({ key: 'feared', expiresAtMs: 3_000, merge: 'longest' });
      expect(ruleset.requestMove(session, hero.id, { x: hero.position.x + 1, y: hero.position.y }))
        .toEqual({ ok: false, reason: 'feared' });
    });

    it('nenhuma magia nem runa sai sob medo — a poção sai', () => {
      const { session, hero, ruleset } = withSpells(
        botConfigV2([
          { do: { kind: 'spell', spellId: 'heal' }, auto: false },
          { do: { kind: 'supply', supplyId: 'health-potion' }, auto: false },
        ]),
        { health: 100, mana: 200, monsters: false },
      );
      hero.conditions.apply({ key: 'feared', expiresAtMs: 5_000, merge: 'longest' });
      expect(ruleset.useSlot(session, 'hero', 0, 0)).toEqual({ ok: false, reason: 'feared', retryInMs: 5_000 });
      expect(hero.mana).toBe(200);
      expect(ruleset.useSlot(session, 'hero', 0, 1)).toEqual({ ok: true });
    });

    it('a fuga forçada recusa o campo de dano ANTES de rolar o drunk (`Player::onWalk`): sem sorteio e sem desvio', () => {
      // `Player::onWalk` (`player.cpp:2942-2955`) olha o campo de dano do tile PEDIDO antes do
      // `Creature::onWalk`, que é onde o drunk sorteia: o passo volta ali, e o desvio nunca tem
      // chance de carregar o fugitivo para outro tile. Mede o sorteio por diferença — a MESMA
      // cena com e sem o campo no tile do passo: o campo tira exatamente UM sorteio.
      class CountingRng extends Rng {
        integerCalls = 0;

        override integer(min: number, max: number): number {
          this.integerCalls += 1;
          return super.integer(min, max);
        }
      }
      const fire: FieldSpec = {
        id: 'fire-622', durationMs: 60_000,
        shape: { shape: 'circle', radius: 1, centered: 'caster' },
        condition: {
          key: 'fire', merge: 'refresh', durationMs: 60_000,
          effect: {
            kind: 'damage-over-time', form: 'rounds',
            rounds: [{ count: 100, intervalMs: 500, damage: 1 }], damageType: 'fire',
          },
        },
      };
      const firstStep = (withField: boolean): { rolls: number; position: { x: number; y: number } } => {
        const loaded = arena([casterOf([], { aggroRadius: 0 })]);
        const ruleset = createHuntRuleset(loaded, 'arena', 'cautious');
        const first = new Session({
          id: 'fear-622-field', contentVersion: loaded.version, ruleset,
          rng: Rng.fromSeed('fear-622-field'), createdAtMs: 0,
        });
        const hero = character();
        first.enter(hero);
        hero.conditions.apply({ key: 'drunk', expiresAtMs: 1_000_000_000 });
        hero.conditions.apply({
          key: 'feared', expiresAtMs: 60_000, merge: 'longest',
          flee: { from: { x: 16, y: 20, z: 7 }, index: 2 },
        });
        // O campo cobre (21,20) — o tile do passo — e NÃO o tile do herói, em (20,20).
        if (withField) ruleset.applyField(first, fire, { x: 22, y: 20, z: 7 });
        // Uma caminhada forçada de um passo para o leste (valor 1 do enum `Direction`).
        const snapshot = JSON.parse(JSON.stringify(first.snapshot())) as SessionSnapshot;
        const runners = (snapshot.ruleset as { runners: Record<string, { fearWalk?: number[] }> }).runners;
        (runners[hero.id] as { fearWalk?: number[] }).fearWalk = [1];
        const rng = new CountingRng(snapshot.rng);
        const restored = Session.fromSnapshot(snapshot, huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset, rng);
        const restoredHero = restored.participants[0] as CharacterRuntime;
        const before = rng.integerCalls;
        restored.advanceBy(1);
        return {
          rolls: rng.integerCalls - before,
          position: { x: restoredHero.position.x, y: restoredHero.position.y },
        };
      };
      const open = firstStep(false);
      const blocked = firstStep(true);
      // Sem o campo o passo rola o drunk; com ele, nenhum sorteio sai e o fugitivo não anda.
      expect(open.rolls).toBeGreaterThan(0);
      expect(blocked.rolls).toBe(open.rolls - 1);
      expect(blocked.position).toEqual({ x: 20, y: 20 });
    });

    it('um `walk-to` distante guardado ANTES do medo continua: a fuga só começa com menos de dois passos por dar (`getWalkSize() < 2`)', () => {
      // `ConditionFeared::executeCondition` só procura fuga com `getWalkSize() < 2`, e a lista de
      // passos do jogador é a MESMA da fuga: o `walk-to` em curso segue (nenhuma condição o
      // interrompe, e o passo dele não é o "começar a andar" que `startAutoWalk` recusa). Pedido
      // antes de qualquer tempo, o lançador ainda nem nasceu: o medo cai com o herói a meio caminho.
      const { session, hero, ruleset } = start({ loaded: fearedContent() });
      const from = { ...hero.position };
      const destination = { x: from.x, y: from.y - 7 };
      expect(ruleset.requestMove(session, hero.id, destination).ok).toBe(true);
      let fleeingAtY: number | null = null;
      let feared = false;
      for (let elapsed = 0; elapsed < 6_000 && fleeingAtY === null; elapsed += 50) {
        session.advanceBy(50);
        feared ||= hero.conditions.get('feared') !== null;
        if (feared && ruleset.getState().runners?.[hero.id]?.fearWalk !== undefined) fleeingAtY = hero.position.y;
      }
      expect(feared).toBe(true);
      // A fuga começou quando o caminho do jogador já estava quase no fim: o destino é 7 tiles
      // ao norte e restavam menos de dois passos (o herói perto de y = 14).
      expect(fleeingAtY).not.toBeNull();
      expect(fleeingAtY ?? 99).toBeLessThanOrEqual(destination.y + 1);
    });

    /**
     * Tudo que a fuga decide, num instante: posição, condições, imunidade, estado do Rng, o
     * runner (a fase de pensamento e a caminhada forçada) e os monstros. Se um evento novo
     * dependesse de quem assiste, de quando se pergunta ou de ter passado por um snapshot,
     * ALGUM destes campos divergiria — a posição final sozinha esconderia a divergência.
     */
    const fingerprint = (session: Session): unknown => {
      const hero = session.participants[0] as CharacterRuntime;
      const ruleset = session.ruleset as HuntRuleset;
      return {
        at: session.nowMs,
        position: { ...hero.position },
        conditions: hero.conditions.getState(),
        immunity: [...hero.cleanseImmunity],
        rng: session.snapshot().rng,
        runner: ruleset.getState().runners?.[hero.id],
        monsters: ruleset.monsters.map((monster) => monster.getState()),
      };
    };

    it('retomar de um snapshot no meio da fuga dá a MESMA fuga (invariante 3) — o rastro inteiro coincide', () => {
      const { session, ruleset } = start({ loaded: fearedContent() });
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou o lançador');
      plant(monster, { x: 16, y: 20, z: 7 });
      // O corte cai no meio da fuga, com o medo corrente, a lista de passos por dar e o
      // pensamento seguinte na fila.
      advance(session, 2_500);
      const hero = session.participants[0] as CharacterRuntime;
      expect(hero.conditions.get('feared')).not.toBeNull();
      expect(ruleset.getState().runners?.[hero.id]?.thinkPhaseMs).toBeDefined();

      const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
      const restored = Session.fromSnapshot(
        snapshot,
        huntRulesetFromSnapshot(snapshot, fearedContent()) as HuntRuleset,
        new Rng(snapshot.rng),
      );
      // A impressão de cada segundo DEPOIS do corte — e a dos 100 ms entre eles —, até a fuga
      // acabar, a imunidade correr e um segundo medo entrar.
      for (let elapsed = 0; elapsed < 14_000; elapsed += 100) {
        session.advanceBy(100);
        restored.advanceBy(100);
        expect(fingerprint(restored)).toEqual(fingerprint(session));
      }
      expect((restored.participants[0] as CharacterRuntime).cleanseImmunity.get('feared')).toBeGreaterThan(0);
    });

    it('a mesma semente dá a MESMA fuga, e a frequência de avanço não muda NADA (invariante 2) — posição, condições, Rng e runner', () => {
      // O rastro de cada segundo (posição, condições, estado do Rng, runner, monstros) a 1 Hz,
      // 4 Hz e 20 Hz: a fuga e a retomada de pensamento são eventos da fila, não acumuladores.
      const run = (stepMs: number): unknown[] => {
        const { session, ruleset } = start({ loaded: fearedContent() });
        session.advanceBy(1);
        const monster = ruleset.monsters[0];
        if (monster === undefined) throw new Error('faltou o lançador');
        plant(monster, { x: 16, y: 20, z: 7 });
        const trace: unknown[] = [];
        for (let elapsed = 0; elapsed < 14_000 && session.ended === null; elapsed += stepMs) {
          session.advanceBy(stepMs);
          if ((session.nowMs - 1) % 1_000 === 0) trace.push(fingerprint(session));
        }
        return trace;
      };
      const oneHz = run(1_000);
      expect(oneHz).toHaveLength(14);
      expect(run(250)).toEqual(oneHz);
      expect(run(50)).toEqual(oneHz);
      // E o rastro tem fuga de verdade: o herói saiu do tile de partida e o medo acabou.
      const positions = oneHz.map((print) => (print as { position: { x: number } }).position.x);
      expect(Math.max(...positions)).toBeGreaterThanOrEqual(25);
    });

    it('um segundo medo DENTRO dos 10 s de imunidade não entra; depois deles, entra', () => {
      const { session, hero, ruleset } = start({ loaded: fearedContent() });
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou o lançador');
      plant(monster, { x: 16, y: 20, z: 7 });
      let firstEnd = -1;
      let secondStart = -1;
      let hadFear = false;
      for (let t = 0; t < 30_000 && session.ended === null; t += 100) {
        session.advanceBy(100);
        const active = hero.conditions.get('feared') !== null;
        if (hadFear && !active && firstEnd < 0) firstEnd = session.nowMs;
        if (firstEnd >= 0 && active && secondStart < 0) secondStart = session.nowMs;
        if (active) hadFear = true;
      }
      expect(firstEnd).toBeGreaterThan(0);
      // O segundo medo só começa DEPOIS da janela de 10 s do primeiro (a ability o oferece a
      // cada 1 s e `checkFearConditionAffected` recusa dentro da janela).
      expect(secondStart).toBeGreaterThanOrEqual(firstEnd + 10_000);
    });

    it('a party aceita `(membros + 5) / 5` de medos ao mesmo tempo, sem contar o líder', () => {
      // Uma área que pega os três: o líder (o primeiro a entrar) e dois membros. O Canary:
      // `memberList` sem o líder → 2 membros → `(2 + 5) / 5 = 1` medo por vez entre os MEMBROS. O
      // líder entra primeiro e é atingido; o primeiro membro entra (o orçamento é 1, nenhum
      // membro com medo ainda); o segundo membro é recusado.
      const areaFear = controlAbility('feared', {
        target: { range: 20, area: { shape: 'circle', radius: 8, centered: 'caster' } },
      });
      const loaded = arena([casterOf([areaFear])]);
      const { session, hero, ruleset } = start({ loaded });
      const second = new CharacterRuntime({ ...character().getState(), id: 'second' });
      const third = new CharacterRuntime({ ...character().getState(), id: 'third' });
      session.enter(second);
      session.enter(third);
      session.advanceBy(1);
      const monster = ruleset.monsters[0];
      if (monster === undefined) throw new Error('faltou o lançador');
      plant(monster, { x: 20, y: 22, z: 7 });
      advance(session, 1_500);
      const feared = [hero, second, third].filter((member) => member.conditions.get('feared') !== null);
      expect(feared.map((member) => member.id)).toEqual(['hero', 'second']);
    });
  });
});
