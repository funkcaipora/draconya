import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import { Rng } from './rng.js';
import { Session, SNAPSHOT_FORMAT_VERSION } from './session.js';
import type { Ruleset } from './session.js';
import { EventPriority } from './schedule.js';
import { createCityRuleset } from './rulesets/city.js';

/** Mesmo ruleset do teste de equivalência: periódico, com sorteio. */
function testRuleset(): Ruleset {
  return {
    type: 'hunt',
    hz: (attached) => (attached ? 10 : 1),
    onEnter(session, character) {
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: character.id });
    },
    onDeath: () => {},
    onEnd: () => {},
    onEvent(session, event) {
      const p = session.participants.find((c) => c.id === event.subject);
      if (p === undefined) return;
      p.mana = Math.min(p.maxMana, p.mana + 1);
      session.aggregates.xpGained += session.rng.integer(10, 20);
      session.aggregates.kills++;
      if (session.rng.chance(0.1)) session.aggregates.goldGained += session.rng.integer(1, 50);
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: p.id });
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
    for (let t = 0; t < 60; t++) uninterrupted.advanceBy(1000);

    const interrupted = newSession();
    for (let t = 0; t < 30; t++) interrupted.advanceBy(1000);
    const snap = interrupted.snapshot();

    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));
    for (let t = 0; t < 30; t++) resumed.advanceBy(1000);

    expect({ ...resumed.aggregates }).toEqual({ ...uninterrupted.aggregates });
    expect(resumed.getRngState()).toEqual(uninterrupted.getRngState());
  });

  it('preserves cooldowns and active timers', () => {
    const session = newSession('cd');
    // Para no meio de um período de 350 ms: o próximo ataque vence em 700, e o snapshot
    // precisa levar essa data — não "quanto falta", que é o que um acumulador guardava.
    session.advanceBy(500);
    const snap = session.snapshot();
    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));

    session.advanceBy(1000);
    resumed.advanceBy(1000);
    expect({ ...resumed.aggregates }).toEqual({ ...session.aggregates });
  });

  it('preserves identity, content version, ledger sequence and notable events', () => {
    const session = newSession('metadata');
    session.ledgerSeq = 7;
    session.record('level-up', '21');
    session.advanceBy(1000);

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
    session.advanceBy(5000);
    const throughJson = JSON.parse(JSON.stringify(session.snapshot())) as ReturnType<Session['snapshot']>;
    const resumed = Session.fromSnapshot(throughJson, testRuleset(), new Rng(throughJson.rng));
    session.advanceBy(5000);
    resumed.advanceBy(5000);
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

  it('costs nothing to advance, because it schedules nothing', () => {
    // A cidade é o único espaço COMPARTILHADO do jogo, e é onde o custo por jogador precisa
    // ficar perto de zero. Com a fila, isso deixou de depender de o hospedeiro lembrar de não
    // chamar: sem evento agendado, avançar não despacha nada e não custa nada.
    const session = new Session({
      id: 'c1', contentVersion: 'v1', ruleset: createCityRuleset(),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    session.enter(character());
    expect(session.pendingEvents).toBe(0);
    expect(() => session.advanceBy(60_000)).not.toThrow();
  });

  it('refuses a scheduled event, loudly', () => {
    // Um evento na fila da cidade significa que alguém pôs simulação no espaço compartilhado.
    // Falhar alto é melhor que queimar CPU em silêncio por milhares de jogadores parados.
    const session = new Session({
      id: 'c1', contentVersion: 'v1', ruleset: createCityRuleset(),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    session.enter(character());
    session.scheduleIn('anything', 10);
    expect(() => session.advanceBy(1000)).toThrow(/event-driven/);
  });
});
