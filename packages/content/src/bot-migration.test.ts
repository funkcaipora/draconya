import { describe, expect, it } from 'vitest';
import { migrateBotConfigV1 } from './bot-migration.js';
import {
  BOT_HOTKEYS, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV1Schema,
} from './schemas.js';
import type { BotConfig } from './schemas.js';

/**
 * As baselines v1 do repositório (auditadas em 2026-09-18), reproduzidas aqui como dado — o
 * `content` não pode importar `sim`/`server`/`client`/`tools` (fronteira do AGENTS.md), então o
 * que se prende é a FORMA de cada uma, não o arquivo de origem.
 */
const v1 = (over: Partial<Record<string, unknown>> = {}): BotConfig => botConfigV1Schema.parse({
  version: 1, heal: [], potion: [], attack: [], rune: [], support: [], exit: [],
  ...over,
});

const spell = (id: string, percent = 50) => ({
  when: { kind: 'hp' as const, op: '<=' as const, percent },
  do: { kind: 'spell' as const, spellId: id },
});

const supply = (id: string) => ({
  when: { kind: 'hp' as const, op: '<=' as const, percent: 40 },
  do: { kind: 'supply' as const, supplyId: id },
});

/** As 17 baselines, cada uma nomeada pela origem. Nenhuma pode ser perdida nem reordenada. */
const baselines: ReadonlyArray<{ name: string; config: BotConfig }> = [
  {
    name: 'content/data/bot/baseline.json (defaultConfig)',
    config: v1({
      heal: [spell('heal', 70)], potion: [supply('health-potion')], attack: [spell('strike')],
    }),
  },
  { name: 'content/bot.test.ts (config vazia)', config: v1() },
  {
    name: 'content/content.test.ts (defaultConfig)',
    config: v1({ heal: [spell('heal', 70)] }),
  },
  { name: 'sim/bot.test.ts (config v1)', config: v1({ heal: [spell('heal')] }) },
  {
    name: 'sim/rulesets/hunt.test.ts (ringSwap)',
    config: v1({
      potion: [supply('health-potion')],
      ringSwap: {
        itemId: 'life-ring', equipBelow: 40, removeAbove: 70, manaFloor: 10, restorePrevious: true,
      },
    }),
  },
  { name: 'server/testing/content.ts (limites, sem config)', config: v1() },
  { name: 'server/game/sessions.test.ts (config v1)', config: v1({ attack: [spell('strike')] }) },
  {
    name: 'server/game/host.test.ts (CONFIG v1)',
    config: v1({ heal: [spell('heal', 80)], exit: [{ kind: 'out-of-gold' }] }),
  },
  {
    name: 'server/api/characters.test.ts (defaultBotConfig)',
    config: v1({ heal: [spell('heal', 70)] }),
  },
  {
    name: 'server/api/phase-two-exit.postgres.test.ts (BOT_CONFIG)',
    config: v1({ potion: [supply('mana-potion')] }),
  },
  {
    name: 'server/api/phase-two-exit.postgres.test.ts (EMPTY)',
    config: v1(),
  },
  { name: 'server/db/repository.postgres.test.ts (config v1)', config: v1() },
  { name: 'client/bot/store.ts (emptyDraft/toConfig)', config: v1() },
  { name: 'client/shell/RuleEditor.test.ts (config v1)', config: v1({ heal: [spell('heal')] }) },
  { name: 'protocol/messages.test.ts (config v1)', config: v1({ attack: [spell('strike')] }) },
  { name: 'tools/bench/city-broadcast.ts (baseline v1)', config: v1() },
  { name: 'tools/bench/combat-scenario.ts (baseline v1)', config: v1({ heal: [spell('heal')] }) },
  { name: 'tools/bench/cold-scenario.ts (baseline v1)', config: v1() },
];

describe('migrateBotConfigV1 (AB-03, ADR 0032 d.1)', () => {
  it('migra TODA baseline v1 preservando ordem, enabled e condição', () => {
    for (const { name, config } of baselines) {
      const migrated = migrateBotConfigV1(config);
      expect(migrated.version, name).toBe(BOT_VOCABULARY_VERSION);
      expect(migrated.sets, name).toHaveLength(4);
      expect(migrated.sets[0]?.slots, name).toHaveLength(BOT_SLOTS_PER_SET);

      // A ordem é cura → poções → ataque → runas → suporte, e a condição/enabled vêm da v1.
      const expected = ['heal', 'potion', 'attack', 'rune', 'support']
        .flatMap((category) => config[category as keyof BotConfig] as readonly unknown[]);
      expected.forEach((rule, index) => {
        const slot = migrated.sets[0]?.slots[index];
        expect(slot, `${name} slot ${index}`).not.toBeNull();
        const raw = rule as { when: unknown; do: unknown; enabled?: boolean };
        expect(slot?.when).toEqual([raw.when]);
        expect(slot?.enabled).toBe(raw.enabled);
        const action = raw.do as { kind: string; spellId?: string; supplyId?: string };
        expect(slot?.do.kind).toBe(action.kind === 'supply' ? 'item' : action.kind);
      });
    }
  });

  it('é idempotente: migrate(migrate(x)) é igual a migrate(x), e `sets` sobrevive', () => {
    // Mutação que mata: sem o curto-circuito de `version === 2`, o parse v1 descarta `sets` em
    // silêncio e a config volta vazia — por isso a asserção de que `sets` continua preenchido.
    for (const { name, config } of baselines) {
      const once = migrateBotConfigV1(config);
      const twice = migrateBotConfigV1(once);
      expect(twice, name).toEqual(once);
      expect(twice.sets[0]?.slots.filter((slot) => slot !== null).length, name)
        .toBe(once.sets[0]?.slots.filter((slot) => slot !== null).length);
    }
  });

  it('é pura: entrada congelada não lança e não muda', () => {
    const raw = {
      version: 1,
      heal: [spell('heal', 70)], potion: [supply('health-potion')], attack: [],
      rune: [], support: [], exit: [], targeting: { policy: 'nearest', prioritize: [], ignore: [], posture: { kind: 'stand' } },
    };
    const before = structuredClone(raw);
    Object.freeze(raw);
    expect(() => migrateBotConfigV1(raw)).not.toThrow();
    expect(raw).toEqual(before);
  });

  it('supply vira item com o mesmo id (contrato com o AB-01)', () => {
    const migrated = migrateBotConfigV1(v1({ potion: [supply('health-potion')] }));
    expect(migrated.sets[0]?.slots[0]?.do).toEqual({ kind: 'item', itemId: 'health-potion' });
  });

  it('ringSwap vira a automação swap-ring com histerese e params preservados', () => {
    const migrated = migrateBotConfigV1(v1({
      ringSwap: {
        itemId: 'life-ring', equipBelow: 35, removeAbove: 65, manaFloor: 12, restorePrevious: false,
      },
    }));
    expect(migrated.automations).toEqual([{
      model: 'swap-ring',
      params: { itemId: 'life-ring', manaFloor: 12, restorePrevious: false },
      enter: [{ kind: 'hp', op: '<', percent: 35 }],
      exit: [{ kind: 'hp', op: '>', percent: 65 }],
    }]);
  });

  it('lure, exit e targeting saem iguais aos da v1', () => {
    const config = v1({
      lure: { min: 2, max: 6 },
      exit: [{ kind: 'hp-below', percent: 25 }, { kind: 'out-of-gold' }],
      targeting: { policy: 'lowest-hp', prioritize: ['rat'], ignore: ['wolf'], posture: { kind: 'follow' } },
    });
    const migrated = migrateBotConfigV1(config);
    expect(migrated.lure).toEqual(config.lure);
    expect(migrated.exit).toEqual(config.exit);
    expect(migrated.targeting).toEqual(config.targeting);
  });

  it('overflow: 30 regras enchem o conjunto 1 e continuam no conjunto 2', () => {
    const heal = Array.from({ length: 30 }, (_, index) => spell(`heal-${String(index)}`));
    const migrated = migrateBotConfigV1(v1({ heal }));
    expect(migrated.sets[0]?.slots.every((slot) => slot !== null)).toBe(true);
    expect(migrated.sets[1]?.slots.slice(0, 6).every((slot) => slot !== null)).toBe(true);
    expect(migrated.sets[1]?.slots.slice(6).every((slot) => slot === null)).toBe(true);
    // E a ordem se mantém: o 25º da v1 é o primeiro do conjunto 2.
    expect(migrated.sets[1]?.slots[0]?.do).toEqual({ kind: 'spell', spellId: 'heal-24' });
  });

  it('teclas em sequência 1..9,0,F1..F12, sem tecla nos slots 23–24', () => {
    const heal = Array.from({ length: 24 }, (_, index) => spell(`heal-${String(index)}`));
    const migrated = migrateBotConfigV1(v1({ heal }));
    const slots = migrated.sets[0]?.slots ?? [];
    BOT_HOTKEYS.forEach((key, index) => {
      expect(slots[index]?.hotkey, `slot ${index}`).toBe(key);
    });
    expect(slots[22]?.hotkey).toBeUndefined();
    expect(slots[23]?.hotkey).toBeUndefined();
  });

  it('uma config já na v2 volta apenas parseada', () => {
    const v2 = migrateBotConfigV1(v1({ heal: [spell('heal')] }));
    expect(migrateBotConfigV1(v2)).toEqual(v2);
  });
});
