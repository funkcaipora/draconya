// Os Charms em combate (#603, M39-03, ADR 0053 d.5): as rolagens, os números e as condições do
// `bestiary_charms.lua`/`IOBestiary::parseCharmCombat`/`Game::applyCharmRune` do Canary
// (`47dfd51`). PURO: sem sessão, sem relógio, sem escrita — quem aplica o efeito (dano no
// monstro, haste no personagem, paralisia, morte) é o ruleset da hunt, com o `session.rng` e a
// fila. Só a MATEMÁTICA e a ORDEM das rolagens moram aqui, porque são elas o contrato do perfil
// `combat-v4` (`docs/product/combat-conformance.md`).
//
// Só o mecanismo é transcrito (ADR 0019 limite 1): os números saem de `iobestiary.cpp`,
// `game.cpp`, `combat.cpp`, `player.cpp` e `monster.cpp` do Canary, e cada um carrega o caminho
// na função que o usa. Onde o `47dfd51` tem um defeito que impede o charm de fazer o que o
// próprio Lua descreve, a função diz qual e o que este motor faz no lugar — são as decisões que
// a PR do #603 lista para revisão.

import type { Charm, ConditionSpec, DamageModifiers, DamageType } from '@draconya/content';
import type { AssignedCharm, AssignedCharms } from '../charms.js';
import type { ConditionState } from '../conditions.js';
import type { DamageOutcome } from './damage.js';
import type { Rng } from '../rng.js';
import { rollSharedCriticalOutcome } from './modifiers.js';
import { normalRandomInt } from './weapon-power.js';

/** A duração de Adrenaline Burst, Numb e Cripple: `createCondition(..., 10000, 0)` — 10 s. */
export const CHARM_CONDITION_MS = 10_000;

/**
 * Quanto Fatal Hold impede a fuga (`preventFleeDuration`, `iobestiary.cpp:parsePassiveCharmCombat`):
 * 30 s. O Canary só DRENA esse prazo em `Monster::onThinkTarget`, dentro de `changeTargetSpeed !=
 * 0 && runAwayHealth > 0` — por isso o monstro que foge e não troca de alvo nunca o esgota; ver
 * `HuntRuleset#rollFatalHold`.
 */
export const FATAL_HOLD_MS = 30_000;

/** A imunidade temporária que o Cleanse dá ao tipo removido: `setImmuneCleanse` (`player.cpp`), 11 s. */
export const CLEANSE_IMMUNITY_MS = 11_000;

/** Adrenaline Burst: `ConditionSpeed(HASTE)` com `setFormulaVars(2.5, 40, 2.5, 40)`. */
export const ADRENALINE_BURST_CONDITION: ConditionSpec = {
  key: 'speed',
  merge: 'refresh',
  durationMs: CHARM_CONDITION_MS,
  effect: { kind: 'speed', type: 'haste', formula: { mina: 2.5, minb: 40, maxa: 2.5, maxb: 40 } },
};

/** Numb e Cripple: `ConditionSpeed(PARALYZE)` com `setFormulaVars(-1, 0, -1, 0)` — a da Paralyze Rune. */
export const CHARM_PARALYZE_CONDITION: ConditionSpec = {
  key: 'speed',
  merge: 'refresh',
  durationMs: CHARM_CONDITION_MS,
  effect: { kind: 'speed', type: 'paralyze', formula: { mina: -1, minb: 0, maxa: -1, maxb: 0 } },
};

/**
 * Os ids do catálogo (`content/data/charms/generated/charms.json`) que este motor trata em combate
 * (#603): os 24 do Canary, todos menos o Scavenge (a esfola do #626). O `ruleset` despacha por id —
 * o teste de conformance do servidor confere cada um contra o catálogo REAL, para um id renomeado
 * na importação não virar um charm mudo sem ninguém ver.
 */
export const COMBAT_CHARM_IDS: readonly string[] = [
  'wound', 'enflame', 'poison', 'freeze', 'zap', 'curse', 'divine-wrath', 'carnage', 'overpower',
  'overflux', 'cripple', 'parry', 'dodge', 'adrenaline-burst', 'numb', 'cleanse', 'bless', 'gut',
  'low-blow', 'savage-blow', 'vampiric-embrace', 'voids-call', 'fatal-hold', 'void-inversion',
];

/** O charm com o id dado, se for o atribuído (ou `undefined`). */
export function findAssigned(assigned: AssignedCharms, charmId: string): AssignedCharm | undefined {
  if (assigned.major?.charm.id === charmId) return assigned.major;
  if (assigned.minor?.charm.id === charmId) return assigned.minor;
  return undefined;
}

/**
 * A chance do charm no tier atual, em percentual (`charm->chance[tier]`). O vetor do Canary tem
 * um `0` na frente, então o tier 1 lê o PRIMEIRO valor do Lua: aqui o índice é `tier − 1`.
 */
export function charmChance(assigned: AssignedCharm): number {
  // `tier` é 1/2/3 e a tupla tem três posições — o índice de tupla por aritmética não se estreita.
  return (assigned.charm.chance as readonly number[])[assigned.tier - 1] as number;
}

// --- as rolagens -------------------------------------------------------------------------------
//
// Cada família de charm rola por uma função DIFERENTE no Canary, e o resultado não é o mesmo
// número com nomes diferentes: a normal truncada põe a probabilidade real abaixo da nominal
// (`normal_random(1, 10000) / 100` num charm de 5 % acerta ~3,6 % das vezes), e a uniforme acerta
// exatamente a chance. Reproduzir a função certa em cada ponto É o mecanismo.

/**
 * `chance >= normal_random(1, 10000) / 100.0` — os charms DEFENSIVOS no golpe recebido
 * (`game.cpp:8572`/`:8580`, e `:7951` do Parry) e o Carnage na morte (`monster.cpp:3287`). A
 * normal centra em 0,5: o charm de 5 % dispara com probabilidade ~3,6 %, o de 10 % ~5,5 %, o de
 * 11 % ~5,9 % (e os de 6/9/12 % dos minor, ~3,9/5,0/6,5 %).
 */
export function rollDefensiveCharm(rng: Rng, chance: number): boolean {
  return chance >= normalRandomInt(rng, 1, 10_000) / 100;
}

/**
 * `chance >= uniform_random(1, 100)` — os charms OFENSIVOS (`Game::applyCharmRune`,
 * `game.cpp:8988-8991`): aqui a probabilidade é exatamente a nominal. O `chance` do Canary é um
 * `int8_t` (`charm->chance[tier] + modifier`), então a parte fracionária é truncada — nenhum
 * charm ofensivo do catálogo a tem. O `getCharmChanceModifier()` (Concoctions, M42) é sempre 0
 * enquanto a fonte dele não existir.
 */
export function rollOffensiveCharm(rng: Rng, chance: number): boolean {
  return Math.trunc(chance) >= rng.integer(1, 100);
}

/** `chance >= normal_random(0, 10000) / 100.0` — o Cleanse (`combat.cpp:1048`), intervalo diferente do defensivo. */
export function rollCleanseCharm(rng: Rng, chance: number): boolean {
  return chance >= normalRandomInt(rng, 0, 10_000) / 100;
}

/**
 * `chance > normal_random(0, 100)` — Void Inversion (`game.cpp:9086`) e, com o sentido trocado,
 * Fatal Hold (`combat.cpp:934` sai quando `chance <= normal_random(0, 100)`): a normal roda em
 * 0..100, e o charm dispara quando fica ESTRITAMENTE abaixo da chance.
 */
export function rollNormalPercentCharm(rng: Rng, chance: number): boolean {
  return chance > normalRandomInt(rng, 0, 100);
}

// --- o dano dos charms ofensivos ---------------------------------------------------------------

/** O teto de dano pelos pontos de vida do ALVO nos charms de vida do jogador: 8 % (`maxHealthLimit`). */
const TARGET_HEALTH_LIMIT = 0.08;
/** O teto de dano pelo level nos charms elementais: 2× o level (`maxLevelsLimit`). */
const ELEMENTAL_LEVEL_LIMIT = 2;
/** O teto de dano pelo level do Carnage: 6× o level. */
const CARNAGE_LEVEL_LIMIT = 6;

/**
 * O dano dos sete charms elementais — Wound, Enflame, Poison, Freeze, Zap, Curse e Divine Wrath
 * (`iobestiary.cpp:parseOffensiveCharmCombat`): `min(ceil(level × 2), ceil(vidaMáximaDoAlvo ×
 * percent / 100))`. **O teto de 2× o level NÃO está na descrição do Lua** ("5 % da vida inicial")
 * mas está no código, e é ele que vale: contra um monstro de 5.000 de vida, o charm de um level
 * 100 bate no máximo 200, não 250.
 *
 * (Defeito do `47dfd51` NÃO reproduzido: `maxLevelsLimit` é um `static` da função e o ramo do
 * Carnage o reatribui a 6 — depois da primeira morte por Carnage do servidor inteiro, o teto de
 * TODO charm elemental vira 6× o level, para todos os jogadores. Estado global de processo não
 * cabe numa sessão determinística; aqui o teto do elemental é sempre 2× e o do Carnage sempre 6×.)
 */
export function elementalCharmDamage(level: number, targetMaxHealth: number, percent: number): number {
  return Math.min(Math.ceil(level * ELEMENTAL_LEVEL_LIMIT), Math.ceil(targetMaxHealth * (percent / 100)));
}

/** Overpower (`iobestiary.cpp`): `min(ceil(vidaDoAlvo × 8 %), ceil(vidaMáximaDoJOGADOR × percent / 100))`. */
export function overpowerCharmDamage(targetMaxHealth: number, playerMaxHealth: number, percent: number): number {
  return Math.min(
    Math.ceil(targetMaxHealth * TARGET_HEALTH_LIMIT), Math.ceil(playerMaxHealth * (percent / 100)),
  );
}

/** Overflux (`iobestiary.cpp`): igual ao Overpower, pela MANA máxima do jogador. */
export function overfluxCharmDamage(targetMaxHealth: number, playerMaxMana: number, percent: number): number {
  return Math.min(
    Math.ceil(targetMaxHealth * TARGET_HEALTH_LIMIT), Math.ceil(playerMaxMana * (percent / 100)),
  );
}

/**
 * O dano do Carnage em CADA vizinho do monstro morto (`iobestiary.cpp`, ramo `CHARM_CARNAGE`):
 * `min(ceil(vidaMáximaDoMorto × percent / 100), level × 6)`.
 */
export function carnageCharmDamage(deadMaxHealth: number, level: number, percent: number): number {
  return Math.min(Math.ceil(deadMaxHealth * (percent / 100)), level * CARNAGE_LEVEL_LIMIT);
}

/** O que um charm ofensivo faz no golpe dado, decidido só pelo id e pelos números do jogador/alvo. */
export type OffensiveCharmEffect =
  | {
    readonly kind: 'damage';
    readonly amount: number;
    /** O tipo que o resolver conhece; o `neutral` (Overpower/Overflux) chega como `physical` + `neutral`. */
    readonly damageType: DamageType;
    readonly neutral: boolean;
  }
  | { readonly kind: 'paralyze' }
  | { readonly kind: 'none' };

const NO_EFFECT: OffensiveCharmEffect = { kind: 'none' };
const PARALYZE_EFFECT: OffensiveCharmEffect = { kind: 'paralyze' };

/** Quem bate: o que os números dos charms leem do JOGADOR. */
export interface CharmWielder {
  readonly level: number;
  readonly maxHealth: number;
  readonly maxMana: number;
}

const ELEMENTAL_CHARMS = new Set([
  'wound', 'enflame', 'poison', 'freeze', 'zap', 'curse', 'divine-wrath',
]);

/**
 * O efeito de um charm ofensivo que JÁ passou na rolagem. O Carnage não age aqui — o ramo dele
 * exige o monstro MORTO (`!monster->isDead()` devolve falso), e ele dispara na morte
 * (`Monster::death`, `monster.cpp:3283`), com a própria rolagem. Charm sem tratador no Canary
 * (id desconhecido) não faz nada, como o `default:` de lá.
 */
export function offensiveCharmEffect(
  charm: Charm, wielder: CharmWielder, targetMaxHealth: number,
): OffensiveCharmEffect {
  const percent = charm.percent ?? 0;
  if (ELEMENTAL_CHARMS.has(charm.id)) {
    // O tipo vem do catálogo importado — só os sete têm um tipo real (não `neutral`).
    const damageType = (charm.damageType ?? 'physical') as DamageType;
    return {
      kind: 'damage', damageType, neutral: false,
      amount: elementalCharmDamage(wielder.level, targetMaxHealth, percent),
    };
  }
  switch (charm.id) {
    case 'overpower':
      return {
        kind: 'damage', damageType: 'physical', neutral: true,
        amount: overpowerCharmDamage(targetMaxHealth, wielder.maxHealth, percent),
      };
    case 'overflux':
      return {
        kind: 'damage', damageType: 'physical', neutral: true,
        amount: overfluxCharmDamage(targetMaxHealth, wielder.maxMana, percent),
      };
    case 'cripple':
      return PARALYZE_EFFECT;
    default:
      return NO_EFFECT;
  }
}

/**
 * O outcome de um golpe que o Dodge negou: o mesmo, com o dano resolvido em zero. O golpe já
 * passou pelo `blockHit` (gastou carga de bloqueio, treina escudo, gasta a carga do colar), e
 * `applyDamageOutcome` só lê o `resolvedDamage` e o `blockCharge` — o resto do caminho de um golpe
 * recebido segue igual, com nada a tirar da vida.
 */
export function negatedOutcome(outcome: DamageOutcome): DamageOutcome {
  return {
    ...outcome,
    resolvedDamage: 0,
    ...(outcome.secondaryOutcome === undefined
      ? {} : { secondaryOutcome: { ...outcome.secondaryOutcome, resolvedDamage: 0 } }),
  };
}

// --- as condições que o Cleanse enxerga ---------------------------------------------------------

/**
 * O tipo de condição do Canary que o Cleanse remove: as dez de `Creature::getCleansableConditions`
 * que existem neste motor — os sete tipos de dano ao longo do tempo (veneno, fogo, energia,
 * sangramento, congelamento, deslumbramento, maldição) e a paralisia. `rooted` e `feared` chegam
 * com o M44-04 (#622).
 */
export type CleanseType =
  | 'poison' | 'fire' | 'energy' | 'bleeding' | 'freezing' | 'dazzled' | 'cursed' | 'paralyze';

/**
 * Do tipo de dano do DOT para a condição do Canary (a tabela de `docs/product/combat.md`):
 * poison→earth, fire→fire, energy→energy, bleeding→physical, cursed→death, freezing→ice,
 * dazzled→holy. `drown` (afogamento) e os de dreno não são limpáveis.
 */
const CLEANSE_BY_DAMAGE_TYPE: Readonly<Partial<Record<DamageType, CleanseType>>> = {
  earth: 'poison', fire: 'fire', energy: 'energy', physical: 'bleeding',
  ice: 'freezing', holy: 'dazzled', death: 'cursed',
};

/**
 * Que tipo do Canary é esta condição ATIVA, ou `null` se o Cleanse não a enxerga. Um DOT cuja
 * fila já esgotou (`amount` zero, `retiredTick`) não conta: no Canary a condição some quando a
 * `damageList` acaba, e aqui ela só espera o vencimento.
 */
export function cleanseTypeOfCondition(condition: ConditionState): CleanseType | null {
  const tick = condition.tick;
  if (tick?.kind === 'damage') {
    if (tick.amount <= 0 || tick.damageType === undefined) return null;
    return CLEANSE_BY_DAMAGE_TYPE[tick.damageType] ?? null;
  }
  if (condition.speedPercent !== undefined && condition.speedPercent < 0) return 'paralyze';
  return null;
}

/** O tipo do Canary que uma condição AINDA NÃO APLICADA (a da ability) teria — para a imunidade do Cleanse. */
export function cleanseTypeOfSpec(spec: ConditionSpec): CleanseType | null {
  const effect = spec.effect;
  if (effect.kind === 'damage-over-time') return CLEANSE_BY_DAMAGE_TYPE[effect.damageType] ?? null;
  if (effect.kind === 'speed' && effect.type === 'paralyze') return 'paralyze';
  return null;
}

// --- o que os charms passivos somam ao golpe dado -----------------------------------------------

/**
 * O que os charms do atacante somam a um golpe CONTRA um monstro específico (#603): Low Blow
 * (chance de crítico), Savage Blow (dano de crítico), Vampiric Embrace (life leech) e Void's Call
 * (mana leech). Tudo em FRAÇÃO, a mesma unidade de `DamageModifiers` — o Canary soma
 * `chance × 100` em pontos-base (`× 10000`), e `chance / 100` é o mesmo número.
 *
 * `undefined` numa parcela é "o atacante não tem esse charm neste monstro".
 */
export interface CharmAttackBonus {
  /** O `monsterId` do alvo — a chave do cache do Low Blow (um sorteio por monstro DIFERENTE). */
  readonly monsterId: string;
  readonly lowBlow?: number;
  readonly savageBlow?: number;
  readonly lifeLeech?: number;
  readonly manaLeech?: number;
}

/** `Math.trunc(chance × 100)` pontos-base → fração: o `chance * 100` do Canary vira `int` ao somar. */
const toFraction = (chance: number): number => Math.trunc(chance * 100) / 10_000;

/**
 * Os charms passivos do atacante contra `monsterId`, prontos para somar. `undefined` sem nenhum —
 * o intent segue idêntico e nenhuma rolagem nova entra.
 *
 * Nota de fidelidade: a descrição do Lua diz "se estiver usando equipamento com leech" (Vampiric
 * Embrace/Void's Call) e "em armas com crítico" (Low Blow/Savage Blow), mas o CÓDIGO
 * (`game.cpp:9036`, `combat.cpp:2683-2716`) soma o bônus sem conferir o equipamento — o número do
 * charm vale sozinho. O código é a fonte (ADR 0037 d.4).
 */
export function charmAttackBonus(assigned: AssignedCharms, monsterId: string): CharmAttackBonus | undefined {
  const lowBlow = findAssigned(assigned, 'low-blow');
  const savage = findAssigned(assigned, 'savage-blow');
  const vampiric = findAssigned(assigned, 'vampiric-embrace');
  const voids = findAssigned(assigned, 'voids-call');
  if (lowBlow === undefined && savage === undefined && vampiric === undefined && voids === undefined) {
    return undefined;
  }
  return {
    monsterId,
    ...(lowBlow === undefined ? {} : { lowBlow: toFraction(charmChance(lowBlow)) }),
    ...(savage === undefined ? {} : { savageBlow: toFraction(charmChance(savage)) }),
    ...(vampiric === undefined ? {} : { lifeLeech: toFraction(charmChance(vampiric)) }),
    ...(voids === undefined ? {} : { manaLeech: toFraction(charmChance(voids)) }),
  };
}

/**
 * O crítico de UMA AÇÃO do jogador com os charms passivos por cima (`Combat::applyExtensions`,
 * `combat.cpp:2647-2750`). O Canary rola o crítico BASE uma vez por ação inteira — todo alvo da
 * mesma magia em área compartilha o resultado — e, SÓ se ele falhou, rola o Low Blow uma vez por
 * monstro-alvo do charm (`lowBlowCrits`, um `unordered_map` por race), com a chance `base + charm`
 * — a base entra DE NOVO no segundo sorteio. O Savage Blow soma ao multiplicador do crítico do
 * alvo do charm, e só dele.
 *
 * `modifiers` é o do atacante SEM os charms (equipamento + `combat.modifiers`). `forTarget` devolve
 * o do alvo: o mesmo objeto do crítico compartilhado (`rollSharedCriticalOutcome`) quando o alvo
 * não tem charm passivo do atacante — bit a bit o caminho de antes do #603 — e um objeto novo
 * quando tem. Vampiric Embrace e Void's Call somam ao leech do alvo.
 */
export class ActionCritical {
  /** Os modificadores da ação com o crítico BASE já decidido (`chance` 1 ou 0), para todo alvo. */
  readonly modifiers: DamageModifiers | undefined;
  readonly #baseChance: number;
  readonly #baseCritical: boolean;
  #lowBlowByMonster: Map<string, boolean> | undefined;

  constructor(modifiers: DamageModifiers | undefined, rng: Rng) {
    this.#baseChance = modifiers?.critical?.chance ?? 0;
    this.modifiers = rollSharedCriticalOutcome(modifiers, rng);
    // `rollSharedCriticalOutcome` fixa `chance` em 1 ou 0: 1 é "o crítico base ativou".
    this.#baseCritical = this.modifiers?.critical?.chance === 1;
  }

  forTarget(bonus: CharmAttackBonus | undefined, rng: Rng): DamageModifiers | undefined {
    if (bonus === undefined) return this.modifiers;
    let critical = this.modifiers?.critical;
    if (bonus.lowBlow !== undefined && !this.#baseCritical) {
      // O segundo sorteio é POR MONSTRO-ALVO DO CHARM, não por alvo: dois ratos na mesma magia em
      // área dividem UMA rolagem, como o `lowBlowCrits` do Canary.
      let rolled = this.#lowBlowByMonster?.get(bonus.monsterId);
      if (rolled === undefined) {
        rolled = rng.chance(Math.min(1, this.#baseChance + bonus.lowBlow));
        (this.#lowBlowByMonster ??= new Map()).set(bonus.monsterId, rolled);
      }
      critical = { chance: rolled ? 1 : 0, multiplier: critical?.multiplier ?? 1 };
    }
    if (bonus.savageBlow !== undefined && critical !== undefined) {
      critical = { chance: critical.chance, multiplier: critical.multiplier + bonus.savageBlow };
    }
    const lifeLeech = (this.modifiers?.lifeLeech ?? 0) + (bonus.lifeLeech ?? 0);
    const manaLeech = (this.modifiers?.manaLeech ?? 0) + (bonus.manaLeech ?? 0);
    const increase = this.modifiers?.increase;
    if (increase === undefined && critical === undefined && lifeLeech === 0 && manaLeech === 0) {
      return undefined;
    }
    return {
      ...(increase === undefined ? {} : { increase }),
      ...(critical === undefined ? {} : { critical }),
      ...(lifeLeech === 0 ? {} : { lifeLeech }),
      ...(manaLeech === 0 ? {} : { manaLeech }),
    };
  }
}
