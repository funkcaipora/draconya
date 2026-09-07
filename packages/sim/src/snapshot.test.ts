import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import { Rng } from './rng.js';
import { Session, SNAPSHOT_FORMAT_VERSION } from './session.js';
import type { Ruleset } from './session.js';
import { createCityRuleset } from './rulesets/city.js';

/** Mesmo ruleset do teste de equivalência: contínuo, periódico e sorteio. */
function testRuleset(): Ruleset {
  return {
    type: 'hunt',
    hz: (attached) => (attached ? 10 : 1),
    onEnter: () => {},
    onDeath: () => {},
    onEnd: () => {},
    onTick(session, dtMs) {
      for (const p of session.participants) {
        p.mana = Math.min(p.maxMana, p.mana + (2 * dtMs) / 1000);
        const attacks = p.cooldowns.timesThatFit('attack', dtMs, 350);
        for (let i = 0; i < attacks; i++) {
          session.aggregates.xpGained += session.rng.integer(10, 20);
          session.aggregates.kills++;
          if (session.rng.chance(0.1)) session.aggregates.goldGained += session.rng.integer(1, 50);
        }
      }
    },
  };
}

function character(): CharacterRuntime {
  return new CharacterRuntime({
    id: 'p1', position: { x: 0, y: 0, z: 7 },
    health: 500, maxHealth: 500, mana: 0, maxMana: 1000,
    level: 20, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  });
}

function newSession(seed = 's'): Session {
  const session = new Session({
    id: 'session-1', contentVersion: 'content-v3',
    ruleset: testRuleset(), rng: Rng.fromSeed(seed), createdAtMs: 0,
  });
  session.enter(character());
  return session;
}

describe('snapshot fidelity', () => {
  it('restoring a snapshot matches uninterrupted execution', () => {
    // O SEGUNDO PILAR DA FASE 1. Se este teste quebrar, a retomada de sessão (FUN-28) e a
    // drenagem em deploy (FUN-29) passam a perder estado sem ninguém perceber — e o que
    // se perde aparece como XP e loot faltando no extrato de quem não estava olhando.
    const uninterrupted = newSession();
    for (let t = 1000; t <= 60_000; t += 1000) uninterrupted.tick(t);

    const interrupted = newSession();
    for (let t = 1000; t <= 30_000; t += 1000) interrupted.tick(t);
    const snap = interrupted.snapshot();

    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));
    for (let t = 31_000; t <= 60_000; t += 1000) resumed.tick(t);

    expect({ ...resumed.aggregates }).toEqual({ ...uninterrupted.aggregates });
    expect(resumed.getRngState()).toEqual(uninterrupted.getRngState());
  });

  it('preserves cooldowns and active timers', () => {
    const session = newSession('cd');
    // Para no meio de um período de 350 ms, com acumulado parcial.
    session.tick(500);
    const snap = session.snapshot();
    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));

    session.tick(1000);
    resumed.tick(1000);
    expect({ ...resumed.aggregates }).toEqual({ ...session.aggregates });
  });

  it('preserves identity, content version, ledger sequence and notable events', () => {
    const session = newSession('metadata');
    session.ledgerSeq = 7;
    session.record('level-up', '21');
    session.tick(1000);

    const snap = session.snapshot();
    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));

    expect(resumed.id).toBe('session-1');
    expect(resumed.contentVersion).toBe('content-v3');
    expect(resumed.ledgerSeq).toBe(7);
    expect(resumed.notableEvents).toEqual(session.notableEvents);
  });

  it('retains the original content version on restoration', () => {
    // Invariante 7: a hunt termina na versão em que começou, mesmo com deploy no meio.
    const snap = newSession().snapshot();
    expect(Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng)).contentVersion)
      .toBe('content-v3');
  });

  it('restores without viewers after a node failure', () => {
    const session = newSession();
    session.attach('viewer-1');
    const snap = session.snapshot();
    expect(Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng)).attached).toBe(false);
  });

  it('round trips through JSON for Redis storage', () => {
    const session = newSession('json');
    session.tick(5000);
    const throughJson = JSON.parse(JSON.stringify(session.snapshot())) as ReturnType<Session['snapshot']>;
    const resumed = Session.fromSnapshot(throughJson, testRuleset(), new Rng(throughJson.rng));
    session.tick(10_000);
    resumed.tick(10_000);
    expect({ ...resumed.aggregates }).toEqual({ ...session.aggregates });
  });
});

describe('snapshot format guards', () => {
  it('rejects the legacy format without attempting to restore it', () => {
    // Snapshot persistido antigo: os nomes em português são a fixture da migração.
    const legacySnapshot = JSON.parse('{"versaoDoFormato":1,"id":"legacy-session"}') as ReturnType<Session['snapshot']>;
    expect(() => Session.fromSnapshot(legacySnapshot, testRuleset(), Rng.fromSeed('legacy')))
      .toThrow(/snapshot format version/);
  });

  it('rejects unsupported snapshot format versions', () => {
    const snap = { ...newSession().snapshot(), formatVersion: 999 };
    expect(() => Session.fromSnapshot(snap, testRuleset(), Rng.fromSeed('x')))
      .toThrow(/version 999/);
  });

  it('rejects rulesets of a different type', () => {
    const snap = newSession().snapshot();
    expect(() => Session.fromSnapshot(snap, createCityRuleset(), Rng.fromSeed('x')))
      .toThrow(/does not match/);
  });

  it('declares the current snapshot format version', () => {
    expect(newSession().snapshot().formatVersion).toBe(SNAPSHOT_FORMAT_VERSION);
  });
});

describe('city ruleset uses the generic session interface', () => {
  it('is event-driven', () => {
    const city = createCityRuleset();
    expect(city.hz(true)).toBe(0);
    expect(city.hz(false)).toBe(0);
  });

  it('heals on city entry after death', () => {
    const session = new Session({
      id: 'c1', contentVersion: 'v1', ruleset: createCityRuleset(),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    const p = character();
    p.health = 1;
    p.alive = false;
    session.enter(p);
    expect(p.health).toBe(p.maxHealth);
    expect(p.alive).toBe(true);
  });

  it('rejects death in a protect zone', () => {
    const session = new Session({
      id: 'c1', contentVersion: 'v1', ruleset: createCityRuleset(),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    const p = character();
    session.enter(p);
    expect(() => session.kill(p)).toThrow(/protect zone/);
  });

  it('rejects simulation ticks', () => {
    const session = new Session({
      id: 'c1', contentVersion: 'v1', ruleset: createCityRuleset(),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    expect(() => session.tick(1000)).toThrow(/event-driven/);
  });
});
