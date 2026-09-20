// O palco dos golden traces de combate (M24-01, #469).
//
// Uma cena é montada como o `conformance.test.ts` monta a matriz: um ruleset SINTÉTICO que
// resolve TUDO pelo ponto canônico — `resolveDamage` (CMB-02), `applyDamageOutcome` (CMB-08),
// `castSpell`/`useSupply` (FUN-74/#165) e `areaTiles` (#155) — e emite os mesmos eventos de
// domínio que a `HuntRuleset` emite, na mesma ordem (FUN-109). O ruleset sintético existe
// porque o trace mede a MATEMÁTICA e a ORDEM, não o bot: um alvo, um lançamento, nada de
// pathfinding nem de cadência de hunt.
//
// Nada aqui toca I/O nem relógio de processo (invariante 1): a cena avança só por
// `Session.advanceBy(dtMs)` e o RNG é semeado (invariante 2).

import type { Combat, DamageType, Spell, Supply } from '@draconya/content';
import { compileMitigation } from '@draconya/content';
import { areaTiles, isSelfOrigin, tileKey } from '../../area.js';
import { castSpell, ownPurse, useSupply } from '../../casting.js';
import type { SpellAim, SpellScaling, SpellTarget } from '../../casting.js';
import { CharacterRuntime } from '../../character.js';
import type { CharacterState } from '../../character.js';
import { resolveDamage } from '../damage.js';
import type { Defender, DamageIntent } from '../damage.js';
import { applyDamageOutcome } from '../outcome.js';
import { MonsterRuntime } from '../../monster/monster.js';
import type { MonsterState } from '../../monster/monster.js';
import { distance } from '../../monster/step.js';
import type { GridPoint } from '../../monster/step.js';
import { Rng } from '../../rng.js';
import { EventPriority } from '../../schedule.js';
import type { ScheduledEvent } from '../../schedule.js';
import { DEFAULT_TARGETING, selectTarget } from '../../targeting.js';
import { Session } from '../../session.js';
import type { Ruleset } from '../../session.js';
import type { CombatEvent } from '../../combat-events.js';
import type { CreatureHealthChanged } from '../../presence.js';
import { combatTraceEventOf } from './types.js';
import type { CombatTraceEvent } from './types.js';

/**
 * O perfil `combat-v1` das fixtures: armadura inteira no físico e zero em todo o resto, piso
 * de 10 % e os coeficientes de `spellPower` do `baseline`. É o MESMO perfil dos oráculos do
 * CMB-10 — mudá-lo aqui sem mudar lá é o sinal de que dois oráculos começaram a divergir.
 */
export const TRACE_COMBAT: Combat = {
  id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
  armorEffectiveness: {
    physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0,
  },
  minimumDamageFraction: 0.1,
  player: {
    attackPower: 25, attackIntervalMs: 2_000, attackRange: 1,
    armor: 0, dodgeChance: 0, damageType: 'physical',
  },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
};

/** Um monstro da cena. `maxHealth` existe só para o `creature-health` sair como a hunt o emite. */
export interface TraceMonsterSpec {
  readonly id: number;
  readonly monsterId: string;
  readonly position: GridPoint;
  readonly health: number;
  readonly armor?: number;
  readonly dodgeChance?: number;
  /** Resistência/vulnerabilidade por tipo (CMB-03). Ausente é o alvo neutro. */
  readonly resistances?: Readonly<Record<string, number>>;
  /** Imunidade explícita por tipo (CMB-03). */
  readonly immunities?: readonly string[];
}

/** Uma ação da cena, no instante em que o passo a coloca. */
export type TraceAction =
  | { readonly kind: 'attack'; readonly rawDamage: number; readonly targetId?: number }
  | {
    readonly kind: 'monster-attack'; readonly rawDamage: number;
    readonly damageType: DamageType; readonly monsterId?: number;
  }
  | { readonly kind: 'spell'; readonly spell: Spell; readonly skillLevel?: number }
  | { readonly kind: 'supply'; readonly supply: Supply; readonly skillLevel?: number };

/** Um passo da cena: avança `dtMs` e, antes de avançar, dispara `action` se houver. */
export interface TraceStep {
  readonly dtMs: number;
  readonly action?: TraceAction;
}

export interface TraceScenario {
  /** Semente fixa: o trace só é golden porque o RNG não muda (contrato do CMB-10). */
  readonly seed: string;
  readonly hero: Partial<CharacterState>;
  /** O defensor do herói nos ataques de monstro. Ausente é o neutro. */
  readonly heroDefender?: Defender;
  readonly monsters: readonly TraceMonsterSpec[];
  readonly steps: readonly TraceStep[];
}

export interface TraceRun {
  readonly session: Session;
  readonly hero: CharacterRuntime;
  readonly ruleset: TraceRuleset;
  readonly events: readonly CombatTraceEvent[];
}

const heroState = (over: Partial<CharacterState>): CharacterState => ({
  id: 'hero', position: { x: 0, y: 0, z: 7 },
  health: 100, maxHealth: 100, mana: 0, maxMana: 1_000,
  level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  ...over,
});

const ACTION = 'trace-action';

/**
 * O ruleset da cena. Resolve cada ação pelo caminho canônico e registra o evento no instante
 * LÓGICO em que ele nasceu — `session.nowMs` durante o despacho É o vencimento (ADR 0020).
 */
export class TraceRuleset implements Ruleset {
  readonly type = 'hunt' as const;
  readonly monsters: readonly MonsterRuntime[];
  readonly observed: CombatTraceEvent[] = [];
  readonly #scenario: TraceScenario;
  readonly #maxHealth = new Map<number, number>();
  readonly #spellTargets: SpellTarget[] = [];
  readonly #spellHits: MonsterRuntime[] = [];
  #aimTiles: readonly { readonly x: number; readonly y: number; readonly z: number }[] = [];
  readonly #aim: { distance: number; targets: readonly SpellTarget[] } = {
    distance: 0, targets: [],
  };

  constructor(scenario: TraceScenario) {
    this.#scenario = scenario;
    this.monsters = scenario.monsters.map((spec) => {
      this.#maxHealth.set(spec.id, spec.health);
      return new MonsterRuntime({
        id: spec.id, monsterId: spec.monsterId, position: spec.position,
        home: spec.position, health: spec.health, targetId: null, cooldowns: {},
      } as MonsterState);
    });
  }

  hz(): number {
    return 1;
  }

  onEnter(session: Session): void {
    let atMs = 0;
    for (const [index, step] of this.#scenario.steps.entries()) {
      if (step.action !== undefined) {
        session.scheduleIn(ACTION, atMs, {
          priority: EventPriority.Attack, subject: String(index),
        });
      }
      atMs += step.dtMs;
    }
  }

  onCreatureDied(): void {}

  onEnd(): void {}

  onEvent(session: Session, event: ScheduledEvent): void {
    if (event.kind !== ACTION) return;
    const step = this.#scenario.steps[Number(event.subject)];
    const hero = session.participants[0];
    if (step?.action === undefined || hero === undefined) return;
    this.#perform(session, hero, step.action);
  }

  #perform(session: Session, hero: CharacterRuntime, action: TraceAction): void {
    switch (action.kind) {
      case 'attack': this.#attack(session, hero, action); return;
      case 'monster-attack': this.#monsterAttack(session, hero, action); return;
      case 'spell': this.#spell(session, hero, action); return;
      case 'supply': this.#supply(session, hero, action); return;
    }
  }

  #attack(
    session: Session, hero: CharacterRuntime,
    action: Extract<TraceAction, { readonly kind: 'attack' }>,
  ): void {
    const target = this.#find(action.targetId);
    if (target === null || !target.alive) return;
    const outcome = resolveDamage(
      { rawDamage: action.rawDamage, source: 'basic-attack', damageType: 'physical' },
      this.#defenderOf(target), 'pve', TRACE_COMBAT, session.rng,
    );
    const applied = applyDamageOutcome(target, outcome, hero);
    this.#emit(session, {
      kind: 'creature-hit', creatureId: target.subject, attackerId: hero.id,
      amount: applied.healthDamage, source: 'melee', position: this.#pointOf(target),
    });
    this.#emitMonsterHealth(session, target);
  }

  #monsterAttack(
    session: Session, hero: CharacterRuntime,
    action: Extract<TraceAction, { readonly kind: 'monster-attack' }>,
  ): void {
    const source = this.#find(action.monsterId);
    const intent: DamageIntent = {
      rawDamage: action.rawDamage, source: 'monster-attack', damageType: action.damageType,
    };
    const outcome = resolveDamage(
      intent, this.#scenario.heroDefender ?? { armor: 0, dodgeChance: 0 },
      'pve', TRACE_COMBAT, session.rng,
    );
    const applied = applyDamageOutcome(hero, outcome, null, hero.conditions.damageTakenScale());
    this.#emit(session, {
      kind: 'creature-hit', creatureId: hero.id, attackerId: source?.subject ?? 'monster',
      amount: applied.healthDamage, source: 'melee', position: this.#pointOf(hero),
    });
    this.#emitCharacterHealth(session, hero);
  }

  #spell(
    session: Session, hero: CharacterRuntime,
    action: Extract<TraceAction, { readonly kind: 'spell' }>,
  ): void {
    const effect = action.spell.effect;
    if (effect.kind !== 'damage' && effect.kind !== 'heal') return;
    const aim = effect.kind === 'damage'
      ? this.#aimFor(hero, effect.range, effect.area)
      : null;
    const result = castSpell(
      hero, action.spell, aim, session.nowMs, TRACE_COMBAT, session.rng,
      this.#scaling(action.skillLevel),
    );
    if (!result.ok) return;
    if (effect.kind === 'heal') {
      this.#emitHealed(session, hero, result.healed, 'spell');
      return;
    }
    this.#emit(session, {
      kind: 'spell-cast', casterId: hero.id, spellId: action.spell.id,
      casterPosition: this.#pointOf(hero),
      targets: this.#spellHits.map((monster) => ({ creatureId: monster.subject, position: this.#pointOf(monster) })),
      tiles: [...this.#aimTiles],
    });
    this.#applyHits(session, hero, result.hits);
  }

  #supply(
    session: Session, hero: CharacterRuntime,
    action: Extract<TraceAction, { readonly kind: 'supply' }>,
  ): void {
    const supply = action.supply;
    const aim = supply.effect.kind === 'damage'
      ? this.#aimFor(hero, supply.effect.range, supply.effect.area)
      : null;
    const result = useSupply(
      hero, supply, aim, TRACE_COMBAT, session.rng, this.#scaling(action.skillLevel),
      ownPurse(hero), session.nowMs,
    );
    if (!result.ok) return;
    this.#emit(session, {
      kind: 'supply-used', characterId: hero.id, supplyId: supply.id,
      position: this.#pointOf(hero),
      targets: this.#spellHits.map((monster) => ({ creatureId: monster.subject, position: this.#pointOf(monster) })),
      tiles: [...this.#aimTiles],
    });
    if (aim === null) this.#emitHealed(session, hero, result.healed, 'supply');
    else this.#applyHits(session, hero, result.hits);
  }

  /**
   * Colhe a mira como a `HuntRuleset` a colhe (FUN-92): o alvo principal primeiro, depois quem
   * cai na forma, na ordem de nascimento. A ordem é contrato — cada alvo consome uma rolagem.
   */
  #aimFor(
    hero: CharacterRuntime, range: number | undefined,
    area: SpellAreaLike,
  ): SpellAim | null {
    this.#spellHits.length = 0;
    this.#spellTargets.length = 0;
    this.#aimTiles = [];

    if (area !== undefined && isSelfOrigin(area)) {
      this.#aimTiles = areaTiles(area, hero.position, hero.direction ?? 'south');
      const keys = new Set(this.#aimTiles.map(tileKey));
      for (const monster of this.monsters) {
        if (!monster.alive || !keys.has(tileKey(this.#pointOf(monster)))) continue;
        this.#collect(monster);
      }
      if (this.#spellHits.length === 0) return null;
      this.#aim.distance = 0;
      this.#aim.targets = this.#spellTargets;
      return this.#aim;
    }

    const primary = selectTarget(
      DEFAULT_TARGETING, this.monsters, hero.position, range ?? 1,
    );
    if (primary === null) return null;
    this.#collect(primary);
    if (area !== undefined) {
      this.#aimTiles = areaTiles(
        area, hero.position, hero.direction ?? 'south', this.#pointOf(primary),
      );
      const keys = new Set(this.#aimTiles.map(tileKey));
      for (const monster of this.monsters) {
        if (monster === primary || !monster.alive) continue;
        if (!keys.has(tileKey(this.#pointOf(monster)))) continue;
        this.#collect(monster);
      }
    }
    this.#aim.distance = distance(hero.position, primary.position);
    this.#aim.targets = this.#spellTargets;
    return this.#aim;
  }

  #collect(monster: MonsterRuntime): void {
    this.#spellHits.push(monster);
    this.#spellTargets.push(this.#defenderOf(monster));
  }

  #applyHits(session: Session, hero: CharacterRuntime, hits: readonly number[]): void {
    for (let i = 0; i < this.#spellHits.length; i += 1) {
      const monster = this.#spellHits[i] as MonsterRuntime;
      const applied = monster.receiveDamage(hits[i] ?? 0);
      this.#emit(session, {
        kind: 'creature-hit', creatureId: monster.subject, attackerId: hero.id,
        amount: applied, source: 'spell', position: this.#pointOf(monster),
      });
      this.#emitMonsterHealth(session, monster);
    }
  }

  #emitHealed(
    session: Session, hero: CharacterRuntime, amount: number,
    source: 'spell' | 'supply' | 'leech',
  ): void {
    if (amount <= 0) return;
    this.#emit(session, {
      kind: 'creature-healed', creatureId: hero.id, amount, source,
      position: this.#pointOf(hero),
    });
    this.#emitCharacterHealth(session, hero);
  }

  #emitMonsterHealth(session: Session, monster: MonsterRuntime): void {
    this.#emit(session, {
      kind: 'creature-health-changed', creatureId: monster.subject,
      health: monster.health, maxHealth: this.#maxHealth.get(monster.id) ?? monster.health,
    });
  }

  #emitCharacterHealth(session: Session, hero: CharacterRuntime): void {
    this.#emit(session, {
      kind: 'creature-health-changed', creatureId: hero.id,
      health: hero.health, maxHealth: hero.maxHealth,
    });
  }

  /** Emite pela sessão E registra no trace, carimbando o instante lógico do despacho. */
  #emit(session: Session, event: CombatEvent | CreatureHealthChanged): void {
    session.emit(event);
    const traced = combatTraceEventOf(session.nowMs, event);
    if (traced !== null) this.observed.push(traced);
  }

  #defenderOf(monster: MonsterRuntime): SpellTarget & Defender {
    const spec = this.#scenario.monsters.find((candidate) => candidate.id === monster.id);
    const profile = spec?.resistances === undefined && spec?.immunities === undefined
      ? undefined
      : {
        resistances: spec.resistances ?? {},
        immunities: spec.immunities ?? [],
      };
    return {
      armor: spec?.armor ?? 0,
      dodgeChance: spec?.dodgeChance ?? 0,
      ...(profile === undefined ? {} : { mitigation: compileMitigation(profile as never) }),
    };
  }

  #find(id: number | undefined): MonsterRuntime | null {
    if (id === undefined) return this.monsters.find((monster) => monster.alive) ?? null;
    return this.monsters.find((monster) => monster.id === id) ?? null;
  }

  #pointOf(creature: { readonly position: GridPoint }): { x: number; y: number; z: number } {
    return { x: creature.position.x, y: creature.position.y, z: 7 };
  }

  #scaling(skillLevel: number | undefined): SpellScaling {
    return { skillLevel: skillLevel ?? 0, powerScale: 1 };
  }
}

/** O mínimo que `#aimFor` precisa de uma área; `SpellArea` satisfaz. */
type SpellAreaLike = Parameters<typeof areaTiles>[0] | undefined;

/** Roda a cena: monta, entra e avança passo a passo. Devolve o que foi emitido, na ordem. */
export function runTrace(scenario: TraceScenario): TraceRun {
  const ruleset = new TraceRuleset(scenario);
  const session = new Session({
    id: `trace:${scenario.seed}`, contentVersion: 'trace-v1',
    ruleset, rng: Rng.fromSeed(scenario.seed), createdAtMs: 0,
  });
  const hero = new CharacterRuntime(heroState(scenario.hero));
  session.enter(hero);
  for (const step of scenario.steps) session.advanceBy(step.dtMs);
  return { session, hero, ruleset, events: ruleset.observed };
}