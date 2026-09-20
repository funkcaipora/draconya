import { describe, expect, it } from 'vitest';
import { CharacterRuntime, createHuntSession, statsForLevel } from '@draconya/sim';
import type { HuntRuleset } from '@draconya/sim';
import { scenario } from './cold-scenario.js';

// O bench (`pnpm bench:hunts`) não roda no CI — 5.000 hunts × 10 min é caro demais para PR.
// O que quebrou nele (#179) não foi o número, foi o CONTRATO: `buildContent` passou a exigir a
// tabela de aparências (FUN-94) e o cenário sintético ficou para trás por meses. Este teste
// monta o cenário e avança uma hunt: é o que reprova no PR quando o contrato mudar de novo.

describe('the cold-hunts bench scenario (#179)', () => {
  it('builds with the current buildContent contract and runs a full hunt', () => {
    const content = scenario();
    const stats = statsForLevel(1, null, content.progression);
    const session = createHuntSession({
      id: 'cold-0', content, huntId: 'cold', difficulty: 'reckless', createdAtMs: 0,
    });
    session.enter(new CharacterRuntime({
      id: 'p0', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth, mana: 0, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: 86_400_000, staminaUpdatedAtMs: 0,
      goldDelta: 0, alive: true, cooldowns: {},
    }));
    for (let t = 0; t < 10; t++) {
      session.advanceBy(1_000);
      session.drainEvents();
    }
    // A instância é CHEIA — é a razão de o cenário ser sintético e não a Rat Cellars.
    // Mutação que mata: trocar `monsterCount: 40` no cenário por algo menor.
    expect((session.ruleset as HuntRuleset).monsters.length).toBeGreaterThanOrEqual(30);
    expect(session.snapshot()).toBeDefined();
  });

  it('PARTY=8: eight characters per instance build and advance without throwing (#407)', () => {
    // O `bench:hunts PARTY=8` não roda no CI; este teste é o que reprova no PR se o cenário
    // deixar de aceitar o teto de 8 que o M20 introduz (ADR 0035 D12) — `maxMembers: 8` no
    // fixture, e oito `enter` na MESMA instância.
    const content = scenario();
    expect(content.party.maxMembers).toBe(8);
    const stats = statsForLevel(1, null, content.progression);
    const session = createHuntSession({
      id: 'cold-party', content, huntId: 'cold', difficulty: 'reckless', createdAtMs: 0,
    });
    for (let p = 0; p < 8; p++) {
      session.enter(new CharacterRuntime({
        id: `p${p}`, position: { x: 0, y: 0, z: 7 },
        health: stats.maxHealth, maxHealth: stats.maxHealth, mana: 0, maxMana: stats.maxMana,
        level: 1, xp: 0, vocationId: null, staminaMs: 86_400_000, staminaUpdatedAtMs: 0,
        goldDelta: 0, alive: true, cooldowns: {},
      }));
    }
    for (let t = 0; t < 10; t++) {
      session.advanceBy(1_000);
      session.drainEvents();
    }
    expect(session.participants).toHaveLength(8);
    expect(session.snapshot()).toBeDefined();
  });
});
