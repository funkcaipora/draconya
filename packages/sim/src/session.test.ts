import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import { Rng } from './rng.js';
import { Session } from './session.js';
import type { EndReason, Ruleset } from './session.js';

/**
 * Ruleset de teste que exercita os três padrões que aparecem em combate de verdade:
 * regeneração contínua, ação periódica com cooldown, e sorteio de loot.
 *
 * Se ele produzir resultados diferentes conforme a taxa de tick, é porque alguma fórmula
 * conta ticks em vez de tempo — e a otimização mais valiosa do projeto (ADR 0003) morreu.
 */
function testRuleset(): Ruleset {
  return {
    type: 'hunt',
    hz: (attached) => (attached ? 10 : 1),
    onEnter: () => {},
    onDeath: () => {},
    onEnd: () => {},
    onTick(session, dtMs) {
      for (const p of session.participants) {
        // Contínuo: função do tempo decorrido, nunca "por tick".
        p.mana = Math.min(p.maxMana, p.mana + (2 * dtMs) / 1000);

        // Periódico: quantas vezes coube, não "uma se estiver pronto".
        const attacks = p.cooldowns.timesThatFit('attack', dtMs, 350);
        for (let i = 0; i < attacks; i++) {
          const damage = session.rng.integer(10, 20);
          session.aggregates.xpGained += damage;
          session.aggregates.kills++;
          if (session.rng.chance(0.1)) {
            session.aggregates.goldGained += session.rng.integer(1, 50);
          }
        }
      }
    },
  };
}

function character(): CharacterRuntime {
  return new CharacterRuntime({
    id: 'p1',
    position: { x: 0, y: 0, z: 7 },
    health: 500, maxHealth: 500,
    mana: 0, maxMana: 1000,
    level: 20, xp: 0,
    goldDelta: 0, alive: true,
    cooldowns: {},
  });
}

function run(hz: number, durationMs: number, seed: string) {
  const session = new Session({
    id: 's1',
    contentVersion: 'v1',
    ruleset: testRuleset(),
    rng: Rng.fromSeed(seed),
    createdAtMs: 0,
  });
  session.enter(character());

  const stepMs = 1000 / hz;
  for (let t = stepMs; t <= durationMs; t += stepMs) session.tick(t);

  return {
    aggregates: { ...session.aggregates },
    mana: Math.round((session.participants[0] as CharacterRuntime).mana),
    rng: session.getRngState(),
  };
}

describe('equivalence between tick rates', () => {
  it('10 Hz and 1 Hz produce the same result', () => {
    // O TESTE QUE DEFINE O PROJETO. Se ele quebrar, alguma fórmula passou a contar ticks,
    // e a hunt desanexada deixou de valer o mesmo que a anexada (invariante 2 e 3).
    expect(run(1, 60_000, 'seed-42')).toEqual(run(10, 60_000, 'seed-42'));
  });

  it('also supports 2 Hz and 20 Hz', () => {
    expect(run(2, 60_000, 'x')).toEqual(run(20, 60_000, 'x'));
  });

  it('finishes with the same random generator state', () => {
    // Mesmo número de saques nas duas taxas — é o que mantém o loot idêntico.
    expect(run(1, 30_000, 'y').rng).toEqual(run(10, 30_000, 'y').rng);
  });

  it('different seeds diverge', () => {
    expect(run(10, 30_000, 'a')).not.toEqual(run(10, 30_000, 'b'));
  });
});

describe('changing tick rate during a session', () => {
  it('detaching does not lose or gain time', () => {
    // O `tick` recebe o INSTANTE, não o intervalo: o dtMs cobre o intervalo real, então
    // trocar de taxa não faz a sessão derivar.
    const continuous = run(10, 60_000, 'z');

    const session = new Session({
      id: 's1', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('z'), createdAtMs: 0,
    });
    session.enter(character());
    session.attach('v');
    for (let t = 100; t <= 30_000; t += 100) session.tick(t);
    session.detach('v');
    for (let t = 31_000; t <= 60_000; t += 1000) session.tick(t);

    expect({ ...session.aggregates }).toEqual(continuous.aggregates);
  });

  it('adapts the rate to viewer presence', () => {
    const session = new Session({
      id: 's1', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('w'), createdAtMs: 0,
    });
    expect(session.attached).toBe(false);
    expect(session.currentHz()).toBe(1);
    session.attach('v1');
    session.attach('v2');
    expect(session.currentHz()).toBe(10);
    session.detach('v1');
    expect(session.currentHz()).toBe(10); // ainda há um olhando
    session.detach('v2');
    expect(session.currentHz()).toBe(1);
  });
});

describe('lifecycle', () => {
  it('runs without viewers', () => {
    // O modo padrão do jogo. Se algum caminho presumir que existe um, quebra na primeira AFK.
    const r = run(1, 10_000, 'afk');
    expect(r.aggregates.kills).toBeGreaterThan(0);
  });

  it('does not advance for repeated or past timestamps', () => {
    const session = new Session({
      id: 's', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('t'), createdAtMs: 0,
    });
    session.enter(character());
    session.tick(1000);
    const after = { ...session.aggregates };
    session.tick(1000);
    session.tick(500);
    expect({ ...session.aggregates }).toEqual(after);
  });

  it('ends idempotently and preserves the reason', () => {
    const session = new Session({
      id: 's', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('e'), createdAtMs: 0,
    });
    session.enter(character());
    const first = session.end('death');
    const second = session.end('drain' as EndReason);
    expect(first.reason).toBe('death');
    expect(second.reason).toBe('death');
    expect(session.ended).toBe('death');
  });

  it('does not advance an ended session', () => {
    const session = new Session({
      id: 's', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('f'), createdAtMs: 0,
    });
    session.enter(character());
    session.tick(1000);
    session.end('manual-exit');
    const frozen = { ...session.aggregates };
    session.tick(60_000);
    expect({ ...session.aggregates }).toEqual(frozen);
  });

  it('pins the content version on creation', () => {
    const session = new Session({
      id: 's', contentVersion: 'content-v7', ruleset: testRuleset(),
      rng: Rng.fromSeed('g'), createdAtMs: 0,
    });
    expect(session.contentVersion).toBe('content-v7');
  });
});
