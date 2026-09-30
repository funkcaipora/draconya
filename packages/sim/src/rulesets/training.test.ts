// O Treino do Tibia (#631, ADR 0059 d.1): a sessão de exercise weapon. Golpe é evento da fila —
// uma carga e `7 × rate` tries (ou `600 × rate` de mana gasta) no intervalo base, a arma some em
// zero e a sessão acaba —, idêntico a 10 Hz, a 1 Hz e depois de um snapshot (invariantes 2 e 3).

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Content, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import type { CharacterState } from '../character.js';
import { Rng } from '../rng.js';
import { Session } from '../session.js';
import { DEFAULT_DIFFICULTY_NAME, createHuntSession } from './hunt.js';
import {
  TRAIN_STRIKE, TrainingRuleset, TrainingUnavailableError, createTrainingSession,
  trainingRulesetFromSnapshot,
} from './training.js';

// O mapa do Treino: um corredor de dois tiles — o boneco em (1,1), o personagem em (2,1).
const gym = { id: 'gym', z: 7, entryPoint: { x: 2, y: 1, z: 7 }, grid: ['####', '#..#', '####'] };
const corridor = { id: 'corridor', z: 7, grid: ['####', '#..#', '####'] };
const route = {
  id: 'corridor', mapId: 'corridor', tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
  spawnPoints: [{ routeIndex: 0, radius: 1, monsterId: 'rat', respawnDelayMs: 60_000 }],
};
const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1, health: 20, experience: 5, attack: 0, armor: 0,
  attackIntervalMs: 2000, speed: 1, aggroRadius: 1, attackRange: 1,
  loot: { gold: { chance: 0, min: 1, max: 1 }, items: [] },
};
const hunt = { id: 'gym-hunt', name: 'Hunt', recommendedLevel: 1, mapId: 'corridor', routeId: 'corridor' };
const progression = {
  id: 'baseline', startingHealth: 150, startingMana: 55, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
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
const skills = [
  { id: 'sword', name: 'Sword', startingLevel: 10, curve: { base: 50, factor: 2 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'shielding', name: 'Shielding', startingLevel: 10, curve: { base: 100, factor: 1.5 }, gain: { on: 'shield-block', points: 1 }, damagePerLevel: 0 },
  { id: 'distance', name: 'Distance', startingLevel: 10, curve: { base: 30, factor: 2 }, gain: { on: 'distance-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'magic', name: 'Magic', startingLevel: 0, curve: { base: 1600, factor: 4 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0 },
];
const family = (id: string, kind: string, skillId: string, range: number) => ({
  id, name: id, kind, skillId, range, damageType: 'physical', resource: 'none',
  formula: { levelFactor: 0, spread: 0 },
});
const weaponFamilies = [
  family('fist', 'melee', 'sword', 1), family('sword', 'melee', 'sword', 1),
  family('axe', 'melee', 'sword', 1), family('club', 'melee', 'sword', 1),
  family('distance', 'distance', 'distance', 6),
  { id: 'wand', name: 'Wand', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
  { id: 'rod', name: 'Rod', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
];
const items = [
  {
    id: 'exercise-sword', name: 'exercise sword', kind: 'other', weight: 10, value: 0, charges: 5,
    exercise: { skillId: 'sword' }, purchasable: true, buyPrice: 100,
  },
  {
    id: 'exercise-wand', name: 'exercise wand', kind: 'other', weight: 10, value: 0, charges: 3,
    exercise: { skillId: 'magic' },
  },
  { id: 'rock', name: 'Rock', kind: 'other', weight: 1, value: 0 },
];
const training = (over: Record<string, unknown> = {}) => ({
  id: 'baseline',
  dummy: { id: 'exercise-dummy', rate: 100 },
  strike: { triesPerCharge: 7, manaSpentPerCharge: 600 },
  place: { stand: { x: 2, y: 1, z: 7 }, dummy: { x: 1, y: 1, z: 7 } },
  offline: {
    bankCapMs: 43_200_000, graceMs: 600_000, maxAwayMs: 1_814_400_000,
    spendCapMs: { free: 21_600_000, premium: 43_200_000 }, shieldingDivisor: 4,
    skills: [{ skillId: 'sword', kind: 'attacks', divisor: 2 }, { skillId: 'magic', kind: 'mana' }],
  },
  ...over,
});

const raw = (over: Partial<RawContent> = {}): RawContent => {
  const base: RawContent = {
    monsters: [rat], hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
    stamina: [{ id: 'baseline', maxMs: 43_200_000, recoveryRatio: 1 }],
    party: [{ id: 'baseline', maxMembers: 4 }], spells: [], skills, weaponFamilies, items,
    bot: [{
      id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
    }],
    maps: [corridor, gym], routes: [route], city: { mapId: 'gym', stepDurationMs: 150 },
    training: [training()],
    ...over,
  };
  return { appearances: [placeholderAppearances(base)], ...base };
};
const content = (over: Partial<RawContent> = {}): Content => buildContent(raw(over));

const WEAPON = 'w-1';
const hero = (over: Partial<CharacterState> = {}): CharacterRuntime => new CharacterRuntime({
  id: 'hero', position: { x: -1, y: -1, z: 0 }, health: 150, maxHealth: 150, mana: 55, maxMana: 55,
  level: 20, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  staminaMs: 10_000_000, staminaUpdatedAtMs: 1_000,
  inventory: { backpack: [{ instanceId: WEAPON, itemId: 'exercise-sword', quantity: 1 }], equipped: {} },
  ...over,
});

const enter = (
  character: CharacterRuntime = hero(), instanceId = WEAPON, c: Content = content(),
): { session: Session; ruleset: TrainingRuleset; character: CharacterRuntime } => {
  const session = createTrainingSession({ id: 'gym-1', content: c, itemInstanceId: instanceId, createdAtMs: 0 });
  session.enter(character);
  return { session, ruleset: session.ruleset as TrainingRuleset, character };
};

const swordPoints = (character: CharacterRuntime): number => character.skills.getState()['sword']?.points ?? 0;

describe('entrar no Treino', () => {
  it('põe o personagem ao lado do boneco e agenda o primeiro golpe para AGORA', () => {
    const { session, character } = enter();
    expect(character.position).toEqual({ x: 2, y: 1, z: 7 });
    expect(session.ruleset.type).toBe('training');
    expect((session.ruleset as TrainingRuleset).mapId).toBe('gym');
    // O `addEvent(exerciseTrainingEvent, 0, …)` do Canary: nada de esperar um intervalo inteiro.
    expect(session.dueAtOf(TRAIN_STRIKE, 'hero')).toBe(0);
    expect(session.notableEvents.map((event) => event.type)).toContain('training-started');
  });

  it('sem a exercise weapon a entrada é recusada, e a sessão fica como estava', () => {
    const session = createTrainingSession({ id: 'gym-1', content: content(), itemInstanceId: 'nao-existe', createdAtMs: 0 });
    expect(() => session.enter(hero())).toThrow(TrainingUnavailableError);
    expect(session.participants).toHaveLength(0);
  });

  it('um item que não é exercise weapon também é recusado', () => {
    const rock = hero({ inventory: { backpack: [{ instanceId: 'r', itemId: 'rock', quantity: 1 }], equipped: {} } });
    const session = createTrainingSession({ id: 'gym-1', content: content(), itemInstanceId: 'r', createdAtMs: 0 });
    expect(() => session.enter(rock)).toThrow(TrainingUnavailableError);
  });

  it('a sessão é de UM personagem só', () => {
    const { session } = enter();
    expect(() => session.enter(hero({ id: 'outro' }))).toThrow(TrainingUnavailableError);
    expect(session.participants).toHaveLength(1);
  });

  it('o conteúdo sem Treino ou sem Cidade não constrói a sessão', () => {
    expect(() => createTrainingSession({
      id: 'x', content: content({ training: [] }), itemInstanceId: WEAPON, createdAtMs: 0,
    })).toThrow(TrainingUnavailableError);
  });
});

describe('cada golpe: uma carga e 7 tries', () => {
  it('o golpe do instante 0 rende 7 tries e gasta UMA carga — a arma guarda as restantes no overlay', () => {
    const { session, character } = enter();
    session.advanceBy(1);
    expect(swordPoints(character)).toBe(7);
    expect(character.inventory.carried(WEAPON)?.overlay).toEqual({ charges: 4 });
    // O próximo é só um intervalo depois — o `attackIntervalMs` da vocação, 2 s.
    expect(session.dueAtOf(TRAIN_STRIKE, 'hero')).toBe(2_000);
  });

  it('a cada 2 s, um golpe: em 4 s são três (t = 0, 2 000, 4 000)', () => {
    const { session, character } = enter();
    session.advanceBy(4_000);
    expect(swordPoints(character)).toBe(21);
    expect(character.inventory.carried(WEAPON)?.overlay).toEqual({ charges: 2 });
  });

  it('a última carga também rende, a arma some e a sessão termina `completed`', () => {
    const { session, character } = enter();
    session.advanceBy(8_000);
    // 5 cargas × 7 tries = 35 tries; a curva do sword é 50 + 100 + …, então ainda no level 10.
    expect(swordPoints(character)).toBe(35);
    expect(character.inventory.carried(WEAPON)).toBeNull();
    expect(session.ended).toBe('completed');
    expect(session.notableEvents.map((event) => event.type)).toContain('training-weapon-exhausted');
    // O extrato leva o id ao ledger: o `jobs` apaga a `item_instance` na mesma transação.
    const [receipt] = session.receipts();
    expect(receipt?.removedInstances).toEqual([WEAPON]);
  });

  it('a skill sobe de nível quando os tries fecham o custo', () => {
    // A curva do sword: level 10 → 11 custa 50. 50 tries = 8 golpes de 7 (56); com 5 cargas não
    // chega, então o personagem já entra com 45 tries guardados.
    const near = hero({ skills: { sword: { level: 10, points: 45 } } });
    const { session } = enter(near);
    session.advanceBy(8_000);
    expect(near.skills.getState()['sword']).toEqual({ level: 11, points: 30 });
    expect(session.notableEvents.some((event) => event.type === 'skill-up' && event.detail === 'sword/11')).toBe(true);
  });

  it('wand/rod rendem 600 de mana GASTA por carga — a skill que sobe por mana (`magic`)', () => {
    const wand = hero({ inventory: { backpack: [{ instanceId: 'w-2', itemId: 'exercise-wand', quantity: 1 }], equipped: {} } });
    const { session } = enter(wand, 'w-2');
    session.advanceBy(1);
    expect(wand.skills.getState()['magic']).toEqual({ level: 0, points: 600 });
    session.advanceBy(3_999);
    // 3 cargas × 600 = 1 800 de mana gasta; o level 1 do ML custa 1 600.
    expect(wand.skills.getState()['magic']).toEqual({ level: 1, points: 200 });
    expect(session.ended).toBe('completed');
  });

  it('o rate do boneco escala o golpe (7 × rate, truncado como o `uint64_t` do Canary)', () => {
    const doubled = content({ training: [training({ dummy: { id: 'expert', rate: 200 } })] });
    const { session, character } = enter(hero(), WEAPON, doubled);
    session.advanceBy(1);
    expect(swordPoints(character)).toBe(14);

    const expert = content({ training: [training({ dummy: { id: 'expert', rate: 110 } })] });
    const other = enter(hero(), WEAPON, expert);
    other.session.advanceBy(1);
    // 7 × 110 / 100 = 7,7 → 7.
    expect(swordPoints(other.character)).toBe(7);
  });

  it('o rate de skill do conteúdo (o `onGainSkillTries` do Canary) também vale no treino', () => {
    const boosted = content({
      progression: [{ ...progression, rates: { skill: 3 } }],
    });
    const { session, character } = enter(hero(), WEAPON, boosted);
    session.advanceBy(1);
    expect(swordPoints(character)).toBe(21);
  });

  it('a arma que some do inventário no meio encerra o treino, sem golpe fantasma', () => {
    const { session, character } = enter();
    session.advanceBy(1);
    character.inventory.remove(WEAPON);
    session.advanceBy(2_000);
    expect(session.ended).toBe('completed');
    expect(swordPoints(character)).toBe(7);
    expect(session.notableEvents.map((event) => event.type)).toContain('training-weapon-lost');
  });

  it('não gasta stamina, suprimento nem gold — só a hunt drena (ADR 0059 d.1)', () => {
    const { session, character } = enter();
    session.advanceBy(8_000);
    expect(character.staminaMs).toBe(10_000_000);
    expect(character.goldDelta).toBe(0);
    expect(session.aggregates.goldSpent).toBe(0);
    expect(session.aggregates.suppliesUsed).toBe(0);
  });
});

describe('o resultado não depende de quem assiste (invariantes 2 e 3)', () => {
  const run = (stepMs: number, totalMs: number) => {
    const { session, character } = enter();
    for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) session.advanceBy(stepMs);
    return {
      skills: character.skills.getState(), overlay: character.inventory.carried(WEAPON)?.overlay ?? null,
      ended: session.ended, durationMs: session.aggregates.durationMs,
    };
  };

  it('10 Hz e 1 Hz produzem exatamente o mesmo estado em qualquer instante', () => {
    for (const total of [1_000, 3_000, 5_000, 7_000, 8_000, 10_000]) {
      expect(run(100, total)).toEqual(run(1_000, total));
    }
  });

  it('um snapshot no meio devolve a mesma sessão: mesma fila, mesma arma, mesmo fim', () => {
    const c = content();
    const { session } = enter(hero(), WEAPON, c);
    session.advanceBy(3_000);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot()));
    const ruleset = trainingRulesetFromSnapshot(snapshot, c);
    expect(ruleset).not.toBeNull();
    const restored = Session.fromSnapshot(snapshot, ruleset as TrainingRuleset, Rng.fromSeed('gym-1'));
    restored.advanceBy(5_000);
    session.advanceBy(5_000);
    expect(restored.participants[0]?.skills.getState()).toEqual(session.participants[0]?.skills.getState());
    expect(restored.ended).toBe(session.ended);
    expect(restored.participants[0]?.inventory.carried(WEAPON)).toBeNull();
  });

  it('o snapshot de um conteúdo sem Treino não retoma', () => {
    const { session } = enter();
    const snapshot = JSON.parse(JSON.stringify(session.snapshot()));
    expect(trainingRulesetFromSnapshot(snapshot, content({ training: [] }))).toBeNull();
    expect(trainingRulesetFromSnapshot({ ...snapshot, ruleset: undefined }, content())).toBeNull();
  });
});

describe('o banco de offline training cresce com o tempo de treino (ADR 0059 d.3)', () => {
  it('cresce 1:1 com o `durationMs` do participante, do estado que ele trouxe', () => {
    const { session, character } = enter(hero({ training: { offlineBankMs: 1_000, offlineSkill: null, version: 1 } }));
    session.advanceBy(8_000);
    // Encerrou por `completed` no golpe de 8 000: o banco é o que já tinha + o tempo que treinou.
    expect(character.training.bankMs).toBe(1_000 + session.aggregates.durationMs);
  });

  it('sair no meio (o `leave-hunt` do jogador) também soma o tempo treinado', () => {
    const { session, character } = enter();
    session.advanceBy(3_000);
    session.end('manual-exit');
    expect(character.training.bankMs).toBe(3_000);
  });

  it('tem teto: 12 h por padrão, o do conteúdo', () => {
    const capped = content({
      training: [training({
        offline: { ...training().offline, bankCapMs: 2_000, spendCapMs: { free: 1_000, premium: 2_000 } },
      })],
    });
    const { session, character } = enter(hero(), WEAPON, capped);
    session.advanceBy(3_000);
    session.end('manual-exit');
    expect(character.training.bankMs).toBe(2_000);
  });

  it('a Cidade e o extrato duplicado não dobram: `end` é idempotente', () => {
    const { session, character } = enter();
    session.advanceBy(3_000);
    session.end('manual-exit');
    session.end('manual-exit');
    expect(character.training.bankMs).toBe(3_000);
  });
});

describe('o tempo de HUNT também enche o banco (ADR 0059 d.3, o "online" do ADR 0052 d.6)', () => {
  const hunting = (c: Content = content()) => {
    const session = createHuntSession({
      id: 'hunt-1', content: c, huntId: 'gym-hunt', difficulty: DEFAULT_DIFFICULTY_NAME, createdAtMs: 0,
    });
    const character = hero({ training: { offlineBankMs: 500, offlineSkill: 'sword', version: 1 } });
    session.enter(character);
    return { session, character };
  };

  it('ao encerrar, soma o `durationMs` do participante, sem apagar a escolha do livro', () => {
    const { session, character } = hunting();
    session.advanceBy(5_000);
    session.end('manual-exit');
    expect(character.training.bankMs).toBe(5_500);
    expect(character.training.skill).toBe('sword');
  });

  it('quem enche o banco é o TEMPO NA HUNT, não a hunt inteira: a Cidade (que não avança) não soma nada', () => {
    const { session, character } = hunting();
    session.end('manual-exit');
    expect(character.training.bankMs).toBe(500);
  });

  it('respeita o teto do conteúdo', () => {
    const capped = content({
      training: [training({
        offline: { ...training().offline, bankCapMs: 3_000, spendCapMs: { free: 1_000, premium: 2_000 } },
      })],
    });
    const { session, character } = hunting(capped);
    session.advanceBy(8_000);
    session.end('manual-exit');
    expect(character.training.bankMs).toBe(3_000);
  });

  it('um conteúdo sem Treino não tem banco: o registro fica como entrou', () => {
    const { session, character } = hunting(content({ training: [] }));
    session.advanceBy(5_000);
    session.end('manual-exit');
    expect(character.training.bankMs).toBe(500);
  });
});
