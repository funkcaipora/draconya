import { compileMitigation, skillSchema } from '@draconya/content';
import type { Combat } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import type { CharacterState } from './character.js';
import { FULL_BLOCK_CHARGE, isFullBlockCharge } from './combat/block-charge.js';
import { resolveDamage } from './combat/damage.js';
import { Rng } from './rng.js';
import { Session } from './session.js';
import type { EndReason, Ruleset } from './session.js';
import { EventPriority } from './schedule.js';

/**
 * Ruleset de teste que exercita os dois padrões que aparecem em combate de verdade:
 * regeneração periódica e ação periódica com sorteio de loot.
 *
 * Se ele produzir resultados diferentes conforme a taxa em que o hospedeiro avança a sessão, é
 * porque alguma fórmula voltou a depender do tamanho da janela — e a otimização mais valiosa
 * do projeto (ADR 0003) morreu.
 */
function testRuleset(): Ruleset {
  return {
    type: 'hunt',
    hz: (attached) => (attached ? 10 : 1),
    onEnter(session, character) {
      session.scheduleIn('regen', 500, { priority: EventPriority.Upkeep, subject: character.id });
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: character.id });
    },
    onCreatureDied: () => {},
    onEnd: () => {},
    onEvent(session, event) {
      const p = session.participants.find((c) => c.id === event.subject);
      if (p === undefined) return;

      if (event.kind === 'regen') {
        // 2 por segundo é um evento a cada 500 ms. Nunca `taxa * dtMs / 1000`.
        p.mana = Math.min(p.maxMana, p.mana + 1);
        session.scheduleIn('regen', 500, { priority: EventPriority.Upkeep, subject: p.id });
        return;
      }

      const damage = session.rng.integer(10, 20);
      session.credit(p.id, 'xpGained', damage);
      session.credit(p.id, 'kills', 1);
      if (session.rng.chance(0.1)) {
        session.credit(p.id, 'goldGained', session.rng.integer(1, 50));
      }
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: p.id });
    },
  };
}

function character(id = 'p1'): CharacterRuntime {
  return new CharacterRuntime({
    id,
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
  for (let t = stepMs; t <= durationMs; t += stepMs) session.advanceBy(stepMs);

  return {
    aggregates: { ...session.aggregates },
    mana: Math.round((session.participants[0] as CharacterRuntime).mana),
    rng: session.getRngState(),
  };
}

describe('equivalence between advance rates', () => {
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
    // Trocar de taxa não move nada de lugar: os eventos vencem nos mesmos instantes lógicos,
    // e o tamanho da janela só decide quantos deles são despachados de uma vez.
    const continuous = run(10, 60_000, 'z');

    const session = new Session({
      id: 's1', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('z'), createdAtMs: 0,
    });
    session.enter(character());
    session.attach('v');
    for (let t = 100; t <= 30_000; t += 100) session.advanceBy(100);
    session.detach('v');
    for (let t = 31_000; t <= 60_000; t += 1000) session.advanceBy(1000);

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

  it('does not advance for a zero interval, and refuses a negative one', () => {
    const session = new Session({
      id: 's', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('t'), createdAtMs: 0,
    });
    session.enter(character());
    session.advanceBy(1000);
    const after = { ...session.aggregates };
    session.advanceBy(0);
    expect({ ...session.aggregates }).toEqual(after);
    // Intervalo negativo é bug de quem chama, não estado a tolerar em silêncio: o relógio
    // lógico só anda para a frente, e uma sessão que andasse para trás repetiria eventos.
    expect(() => session.advanceBy(-1)).toThrow();
  });

  it('ends idempotently and preserves the reason', () => {
    const session = new Session({
      id: 's', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('e'), createdAtMs: 0,
    });
    session.enter(character());
    const first = session.end('death');
    const second = session.end('drain' as EndReason);
    expect(first[0]?.reason).toBe('death');
    expect(second[0]?.reason).toBe('death');
    expect(second).toBe(first);
    expect(session.ended).toBe('death');
  });

  it('does not advance an ended session', () => {
    const session = new Session({
      id: 's', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('f'), createdAtMs: 0,
    });
    session.enter(character());
    session.advanceBy(1000);
    session.end('manual-exit');
    const frozen = { ...session.aggregates };
    session.advanceBy(60_000);
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

describe('relógio lógico (FUN-68)', () => {
  const sessionFor = (seed: string): Session => {
    const session = new Session({
      id: 's1', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed(seed), createdAtMs: 1_700_000_000_000,
    });
    session.enter(character());
    return session;
  };

  it('começa em zero, e não no relógio de quem a criou', () => {
    // O `createdAtMs` é do hospedeiro e serve para quem lê log. A simulação nasce em zero, e é
    // isso que faz o snapshot ser comparável entre processos.
    expect(sessionFor('clock').nowMs).toBe(0);
  });

  it('anda exatamente o intervalo pedido', () => {
    const session = sessionFor('clock');
    session.advanceBy(100);
    session.advanceBy(250);
    expect(session.nowMs).toBe(350);
  });

  it('durante o evento, o agora é o instante do vencimento', () => {
    // É o que dispensa acumulador: quem reagenda faz `nowMs + intervalo` e não herda erro.
    const seen: number[] = [];
    const session = new Session({
      id: 's', contentVersion: 'v1', rng: Rng.fromSeed('t'), createdAtMs: 0,
      ruleset: {
        type: 'hunt',
        hz: () => 1,
        onEnter: (s) => { s.scheduleIn('tick', 350); },
        onCreatureDied: () => {},
        onEnd: () => {},
        onEvent: (s) => { seen.push(s.nowMs); s.scheduleIn('tick', 350); },
      },
    });
    session.enter(character());
    session.advanceBy(1000);
    expect(seen).toEqual([350, 700]);
    // E o relógio termina no alvo, não no último evento.
    expect(session.nowMs).toBe(1000);
  });

  it('um snapshot restaurado num processo de relógio completamente outro não muda nada', () => {
    // O critério da FUN-68, e o que aposentou o `rebaseClock`. Antes, `lastTickMs` era o
    // monotônico do processo que morreu: restaurado noutro, ou a sessão nunca mais avançava
    // (dtMs negativo para sempre) ou o primeiro tick resolvia horas de combate de uma vez.
    const straight = sessionFor('gap');
    for (let i = 0; i < 60; i++) straight.advanceBy(1000);

    const interrupted = sessionFor('gap');
    for (let i = 0; i < 30; i++) interrupted.advanceBy(1000);
    const snap = JSON.parse(JSON.stringify(interrupted.snapshot())) as ReturnType<Session['snapshot']>;

    // O processo novo não compartilha origem de relógio nenhuma com o antigo.
    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));
    expect(resumed.nowMs).toBe(30_000);
    for (let i = 0; i < 30; i++) resumed.advanceBy(1000);

    expect(resumed.nowMs).toBe(straight.nowMs);
    expect({ ...resumed.aggregates }).toEqual({ ...straight.aggregates });
    expect(resumed.getRngState()).toEqual(straight.getRngState());
  });

  it('o intervalo pulado é descartado, não devido', () => {
    // ADR 0018 sem operação especial: o hospedeiro guarda o relógio de processo, então uma
    // sessão retomada é avançada a partir de agora. O buraco nunca chega a ser oferecido.
    const session = sessionFor('discard');
    for (let i = 0; i < 10; i++) session.advanceBy(1000);
    const snap = session.snapshot();

    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));
    const before = { ...resumed.aggregates };
    // Seis horas depois, no relógio do mundo — e nada aconteceu, porque nada foi avançado.
    expect({ ...resumed.aggregates }).toEqual(before);
    expect(resumed.nowMs).toBe(10_000);
  });

  it('uma engasgada longa vira UMA recuperação, e não horas de combate de uma vez', () => {
    // O sucessor do teto de catch-up dos cooldowns. Um `advanceBy` gigante — GC longo,
    // depurador, máquina suspensa — não pode resolver o backlog inteiro.
    const truncated = sessionFor('stall');
    truncated.advanceBy(8 * 60 * 60_000);

    // Bateu no teto e registrou por quê, em vez de rodar milhões de eventos em silêncio.
    expect(truncated.notableEvents.some((e) => e.type === 'advance-truncated')).toBe(true);
    // O relógio chega ao alvo do mesmo jeito: o tempo passou, o combate é que não aconteceu.
    expect(truncated.nowMs).toBe(8 * 60 * 60_000);

    // E o que sobrou na fila vence no alvo, uma vez — não uma vez por intervalo pulado.
    const before = truncated.aggregates.kills;
    truncated.advanceBy(1);
    expect(truncated.aggregates.kills - before).toBeLessThan(10);
  });

  it('nenhum tempo de processo entra no snapshot dos temporizadores', () => {
    // Um número de relógio de processo num timer de gameplay é uma bomba-relógio: hoje é
    // inofensivo porque ninguém usa o mecanismo absoluto, e poção e magia são exatamente o
    // que vai buscá-lo.
    const session = sessionFor('purity');
    session.advanceBy(5000);
    const snap = session.snapshot();
    // Tudo o que a fila guarda é relativo ao zero da sessão, então nada pode passar do
    // relógio lógico dela.
    for (const event of snap.schedule.events) {
      expect(event.dueAtMs).toBeLessThanOrEqual(snap.logicalNowMs + 60_000);
      expect(event.dueAtMs).toBeGreaterThanOrEqual(0);
    }
    expect(snap.logicalNowMs).toBe(5000);
  });
});

describe('agregados e extrato por participante (#187, ADR 0027)', () => {
  const sessionWith = (...ids: string[]): Session => {
    const session = new Session({
      id: 's-party', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('party'), createdAtMs: 0,
    });
    for (const id of ids) session.enter(character(id));
    return session;
  };

  it('credit escreve no participante E na soma; best*Hit é máximo, não soma', () => {
    // Mutação que mata: `own[key] += delta` para bestBasicHit — a soma passaria de 30 a 50.
    const session = sessionWith('a', 'b');
    session.credit('a', 'xpGained', 5);
    session.credit('b', 'xpGained', 7);
    session.credit('a', 'bestBasicHit', 30);
    session.credit('b', 'bestBasicHit', 20);
    session.credit('a', 'bestBasicHit', 10);
    expect(session.aggregatesOf('a').xpGained).toBe(5);
    expect(session.aggregatesOf('b').xpGained).toBe(7);
    expect(session.aggregates.xpGained).toBe(12);
    expect(session.aggregatesOf('a').bestBasicHit).toBe(30);
    expect(session.aggregatesOf('b').bestBasicHit).toBe(20);
    expect(session.aggregates.bestBasicHit).toBe(30);
  });

  it('durationMs é tempo de SESSÃO: igual em todo presente, e a soma não é N × dt', () => {
    const session = sessionWith('a', 'b');
    session.advanceBy(1_000);
    expect(session.aggregatesOf('a').durationMs).toBe(1_000);
    expect(session.aggregatesOf('b').durationMs).toBe(1_000);
    expect(session.aggregates.durationMs).toBe(1_000);
  });

  it('leave devolve o extrato de quem saiu com seq próprio, e end devolve só os que ficaram', () => {
    // Mutação que mata: `seq` fixo por sessão — os dois extratos colidiriam no ledger.
    const session = sessionWith('a', 'b');
    session.credit('a', 'xpGained', 5);
    session.credit('b', 'xpGained', 7);
    const departure = session.leave('a', 'manual-exit');
    expect(departure?.receipt).toMatchObject({
      sessionId: 's-party', characterId: 'a', reason: 'manual-exit', seq: 1,
    });
    expect(departure?.receipt.aggregates.xpGained).toBe(5);
    expect(session.ended).toBeNull();
    expect(session.participants.map((p) => p.id)).toEqual(['b']);

    const receipts = session.end('death');
    expect(receipts.map((r) => [r.characterId, r.seq, r.aggregates.xpGained])).toEqual([['b', 2, 7]]);
    // Duas vezes: os mesmos, sem seq novo.
    expect(session.end('drain')).toBe(receipts);
    expect(session.ledgerSeq).toBe(2);
    expect(session.leave('zz')).toBeNull();
  });

  it('o snapshot preserva os agregados por participante, e um snapshot antigo restaura o solo', () => {
    const session = sessionWith('a', 'b');
    session.credit('a', 'kills', 3);
    session.credit('b', 'kills', 4);
    const restored = Session.fromSnapshot(session.snapshot(), testRuleset(), Rng.fromSeed('x'));
    expect(restored.aggregatesOf('a').kills).toBe(3);
    expect(restored.aggregatesOf('b').kills).toBe(4);
    expect(restored.aggregates.kills).toBe(7);

    // Anterior ao #187: sem `aggregatesByCharacter`, um dono — a soma é dele.
    const solo = sessionWith('a');
    solo.credit('a', 'kills', 9);
    const { aggregatesByCharacter: _dropped, ...legacy } = solo.snapshot();
    const fromLegacy = Session.fromSnapshot(legacy, testRuleset(), Rng.fromSeed('x'));
    expect(fromLegacy.aggregatesOf('a').kills).toBe(9);
    expect(fromLegacy.aggregates.kills).toBe(9);
  });

  it('o snapshot preserva o ledgerSeq sem reemitir seq (#419)', () => {
    const session = sessionWith('a');
    // Consome um `seq` emitindo um extrato de participante que sai.
    session.leave('a', 'manual-exit');

    const snap = session.snapshot();
    const restored = Session.fromSnapshot(snap, testRuleset(), Rng.fromSeed('x'));
    // O contador volta junto: a próxima emissão pega o seq 2, e nunca reusa o 1.
    expect(restored.ledgerSeq).toBe(1);
  });
});

describe('resolver canônico: seed, snapshot e retomada (CMB-02)', () => {
  const combat: Combat = {
    id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
    armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0, manadrain: 0, arcane: 0 }, minimumDamageFraction: 0.1,
    player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0, damageType: 'physical' },
    spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
  };

  /**
   * Um ruleset que resolve dano DE VERDADE pelo ponto canônico. É o que prende que a ORDEM do
   * RNG — a faixa do ataque e a rolagem de Dodge — sobrevive ao snapshot: dois processos com a
   * mesma semente e o mesmo ponto de retomada consomem os mesmos sorteios. Se a resolução
   * omitisse um estado (ou mudasse a ordem), os números divergiriam.
   */
  const damageRuleset = (): Ruleset => ({
    type: 'hunt',
    hz: () => 1,
    onEnter(session, character) {
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: character.id });
    },
    onCreatureDied: () => {},
    onEnd: () => {},
    onEvent(session, event) {
      const p = session.participants.find((c) => c.id === event.subject);
      if (p === undefined) return;
      const outcome = resolveDamage(
        { rawDamage: session.rng.integer(10, 20), source: 'basic-attack', damageType: 'physical' },
        { armor: 5, dodgeChance: 0.5 }, 'pve', combat, session.rng,
      );
      session.credit(p.id, 'xpGained', outcome.resolvedDamage);
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: p.id });
    },
  });

  const damageSession = (seed: string): Session => {
    const session = new Session({
      id: 'damage', contentVersion: 'v1', ruleset: damageRuleset(),
      rng: Rng.fromSeed(seed), createdAtMs: 0,
    });
    session.enter(character());
    return session;
  };

  it('a mesma semente rende o mesmo dano antes e depois do snapshot', () => {
    const straight = damageSession('damage-seed');
    for (let i = 0; i < 60; i++) straight.advanceBy(1000);

    const interrupted = damageSession('damage-seed');
    for (let i = 0; i < 30; i++) interrupted.advanceBy(1000);
    const snap = JSON.parse(JSON.stringify(interrupted.snapshot())) as ReturnType<Session['snapshot']>;

    const resumed = Session.fromSnapshot(snap, damageRuleset(), new Rng(snap.rng));
    for (let i = 0; i < 30; i++) resumed.advanceBy(1000);

    expect(resumed.aggregates.xpGained).toBe(straight.aggregates.xpGained);
    expect(resumed.getRngState()).toEqual(straight.getRngState());
  });

  it('cada ataque consome DOIS sorteios: a faixa e o Dodge, na mesma ordem', () => {
    // A ordem é contrato (DT-03 do ADR 0031). Sem o estado do gerador no snapshot, o primeiro
    // golpe retomado repetiria o sorteio anterior — o dano divergiria com a MESMA semente.
    const straight = damageSession('dodge-seed');
    for (let i = 0; i < 10; i++) straight.advanceBy(1000);

    const interrupted = damageSession('dodge-seed');
    for (let i = 0; i < 5; i++) interrupted.advanceBy(1000);
    const snap = interrupted.snapshot();
    const resumed = Session.fromSnapshot(snap, damageRuleset(), new Rng(snap.rng));
    for (let i = 0; i < 5; i++) resumed.advanceBy(1000);

    expect(resumed.aggregates.xpGained).toBe(straight.aggregates.xpGained);
  });
});

describe('mitigação e conteúdo congelado (CMB-03)', () => {
  const combat: Combat = {
    id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
    armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0, manadrain: 0, arcane: 0 },
    minimumDamageFraction: 0.1,
    player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0, damageType: 'physical' },
    spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
  };

  /**
   * Resolve um golpe de FOGO contra um defensor com a resistência dada. O defensor é montado a
   * partir do CONTEÚDO — a resistência é o que distingue duas versões de conteúdo.
   */
  const resistanceRuleset = (resistance: number): Ruleset => ({
    type: 'hunt',
    hz: () => 1,
    onEnter(session, character) {
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: character.id });
    },
    onCreatureDied: () => {},
    onEnd: () => {},
    onEvent(session, event) {
      const p = session.participants.find((c) => c.id === event.subject);
      if (p === undefined) return;
      const outcome = resolveDamage(
        { rawDamage: session.rng.integer(10, 20), source: 'basic-attack', damageType: 'fire' },
        {
          armor: 0, dodgeChance: 0.5,
          mitigation: compileMitigation({ resistances: { fire: resistance }, immunities: [] }),
        },
        'pve', combat, session.rng,
      );
      session.credit(p.id, 'xpGained', outcome.resolvedDamage);
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: p.id });
    },
  });

  const mitigationSession = (seed: string, resistance: number): Session => {
    const session = new Session({
      id: 'mitigation', contentVersion: 'v1', ruleset: resistanceRuleset(resistance),
      rng: Rng.fromSeed(seed), createdAtMs: 0,
    });
    session.enter(character());
    return session;
  };

  it('a mitigação do conteúdo entra no resultado e sobrevive ao snapshot com a mesma semente', () => {
    const straight = mitigationSession('mit-seed', 0.5);
    for (let i = 0; i < 60; i++) straight.advanceBy(1000);

    const interrupted = mitigationSession('mit-seed', 0.5);
    for (let i = 0; i < 30; i++) interrupted.advanceBy(1000);
    const snap = JSON.parse(JSON.stringify(interrupted.snapshot())) as ReturnType<Session['snapshot']>;

    const resumed = Session.fromSnapshot(snap, resistanceRuleset(0.5), new Rng(snap.rng));
    for (let i = 0; i < 30; i++) resumed.advanceBy(1000);

    expect(resumed.aggregates.xpGained).toBe(straight.aggregates.xpGained);
    expect(resumed.getRngState()).toEqual(straight.getRngState());
  });

  it('trocar a resistência do conteúdo MUDA o resultado — o conteúdo é a identidade', () => {
    // Um deploy que mudasse a mitigação no meio da hunt produziria um resultado que ninguém
    // simulou (invariante 7). Aqui a prova é que a mesma semente com resistência diferente
    // rende diferente.
    const resistant = mitigationSession('mit-seed', 0.5);
    const vulnerable = mitigationSession('mit-seed', -0.5);
    for (let i = 0; i < 20; i++) {
      resistant.advanceBy(1000);
      vulnerable.advanceBy(1000);
    }
    expect(vulnerable.aggregates.xpGained).toBeGreaterThan(resistant.aggregates.xpGained);
  });
});

describe('entrada em curso: reversão e joinedAtMs (#397, ADR 0035 decisão 6)', () => {
  const joinedRuleset = (): Ruleset => ({
    type: 'hunt',
    hz: () => 1,
    onEnter: (session, character) => {
      if (character.id === 'refused') throw new Error('party cheia');
      session.scheduleIn('tick', 1000, { subject: character.id });
    },
    onCreatureDied: () => {},
    onEnd: () => {},
    onEvent: () => {},
  });

  it('reverte o push quando onEnter lança, sem deixar joinedAtMs órfão', () => {
    const session = new Session({
      id: 'join', contentVersion: 'v1', ruleset: joinedRuleset(),
      rng: Rng.fromSeed('join'), createdAtMs: 0,
    });
    session.enter(character('a'));
    session.advanceBy(500);
    expect(() => session.enter(character('refused'))).toThrow('party cheia');
    expect(session.participants.map((p) => p.id)).toEqual(['a']);
    expect(session.snapshot().joinedAtMs).toEqual({ a: 0 });
    // E a sessão segue aceitando quem couber, com o instante certo.
    session.advanceBy(500);
    session.enter(character('b'));
    expect(session.participants.map((p) => p.id)).toEqual(['a', 'b']);
    expect(session.snapshot().joinedAtMs).toEqual({ a: 0, b: 1000 });
  });

  it('entrar zera o carimbo do último golpe (relógio da sessão anterior), e o snapshot o preserva (#550)', () => {
    // O `CharacterRuntime` atravessa a transição como o MESMO objeto e o relógio da sessão nova
    // nasce em zero: um carimbo de 57 700 ms ficaria no futuro dela. Quem entra começa sem janela.
    const hero = character('a');
    hero.lastAttackAtMs = 57_700;
    const session = new Session({
      id: 'stamp', contentVersion: 'v1', ruleset: joinedRuleset(),
      rng: Rng.fromSeed('stamp'), createdAtMs: 0,
    });
    session.enter(hero);
    expect(hero.lastAttackAtMs).toBeNull();

    // O restore NÃO passa por `enter`: o relógio é o mesmo, e a janela quente continua valendo.
    hero.lastAttackAtMs = 700;
    session.advanceBy(1_000);
    const restored = Session.fromSnapshot(session.snapshot(), joinedRuleset(), Rng.fromSeed('r'));
    expect(restored.participants[0]?.lastAttackAtMs).toBe(700);

    // A entrada RECUSADA não toca o carimbo de quem continua na sessão de origem.
    const stranger = character('refused');
    stranger.lastAttackAtMs = 300;
    expect(() => session.enter(stranger)).toThrow('party cheia');
    expect(stranger.lastAttackAtMs).toBe(300);
  });

  describe('o relógio da sessão anterior não atravessa a entrada (#812)', () => {
    /**
     * Como cada grandeza de `CharacterState` que guarda um instante do relógio lógico da sessão é
     * tratada na transição. O relógio de cada sessão nasce em zero e o `CharacterRuntime` é o MESMO
     * objeto, então um instante lido no relógio errado vira "agora mesmo" ou "no futuro":
     *
     * - `stamp` é CARIMBO ("quando foi a última vez que…"): a janela é curta e já venceu na saída
     *   normal, então a entrada o zera;
     * - `duration` é PRAZO ("quanto ainda falta"): a entrada o traduz para o relógio novo e o que
     *   faltava continua faltando — o cooldown de 10 minutos não volta pronto por uma ida à Cidade,
     *   como no Canary (`CONDITIONID_DEFAULT` é persistente) e como o anel de duração (#689);
     * - `none` não é instante do relógio da sessão.
     */
    type ClockPolicy = 'stamp' | 'duration' | 'none';

    /**
     * TODO campo de `CharacterState` classificado. É um `Record<keyof CharacterState, …>`, então o
     * campo NOVO que alguém acrescentar ao estado do personagem não compila até ser classificado
     * aqui — e quem o classifica como `stamp` ou `duration` precisa dar a ele uma entrada em
     * `STAMP_FIELDS`/`DURATION_FIELDS`. É o que impede o próximo instante de vazar em silêncio,
     * como estes vazaram (#550, #812).
     */
    const SESSION_CLOCK_POLICY: Readonly<Record<keyof CharacterState, ClockPolicy>> = {
      lastAttackAtMs: 'stamp',
      lastCombatActionAtMs: 'stamp',
      attackLockedUntil: 'stamp',
      // O contador do Canary sobe uma carga por segundo até duas: qualquer passagem pela Cidade
      // dura mais que isso, então a entrada devolve o banco CHEIO.
      blockCharge: 'stamp',
      // O evento que a dispara morava na fila da sessão anterior: não há o que traduzir.
      pendingManualAction: 'stamp',
      cleanseImmunity: 'duration',
      cooldowns: 'duration',
      conditions: 'duration',
      // Identidade e progressão: atravessam a sessão, é para isso que existem.
      id: 'none', position: 'none', health: 'none', maxHealth: 'none', mana: 'none', maxMana: 'none',
      level: 'none', xp: 'none', soul: 'none', vocationId: 'none', boostedMonsterId: 'none', speed: 'none',
      gold: 'none', goldDelta: 'none', alive: 'none', skills: 'none', bestiary: 'none', charms: 'none',
      capacity: 'none', inventory: 'none', removedInstances: 'none', lootSeq: 'none',
      contribution: 'none', ammo: 'none', supplyStock: 'none', ammunitionStock: 'none', storages: 'none',
      direction: 'none', blessings: 'none', promoted: 'none', fightMode: 'none',
      // Relógio de PAREDE (epoch), materializado na fronteira da transição (`materializeStamina`).
      staminaMs: 'none', staminaUpdatedAtMs: 'none',
      // DURAÇÃO restante sem âncora num relógio: a comida que sobra, os contadores de prática
      // (golpes que ainda treinam, sem instante nenhum).
      fedMs: 'none', attackPractice: 'none',
    };

    interface StampField {
      /** Grava um carimbo de uma sessão que já andou 57,7 s. */
      readonly stale: (hero: CharacterRuntime) => void;
      readonly cleared: (hero: CharacterRuntime) => boolean;
    }
    const STAMP_FIELDS: Readonly<Record<string, StampField>> = {
      lastAttackAtMs: {
        stale: (hero) => { hero.lastAttackAtMs = 57_700; },
        cleared: (hero) => hero.lastAttackAtMs === null,
      },
      lastCombatActionAtMs: {
        stale: (hero) => { hero.lastCombatActionAtMs = 57_700; },
        cleared: (hero) => hero.lastCombatActionAtMs === null,
      },
      attackLockedUntil: {
        stale: (hero) => { hero.attackLockedUntil = 59_700; },
        cleared: (hero) => hero.attackLockedUntil === 0,
      },
      blockCharge: {
        stale: (hero) => { hero.blockCharge = { charges: 0, anchorMs: 57_700 }; },
        cleared: (hero) => isFullBlockCharge(hero.blockCharge),
      },
      pendingManualAction: {
        stale: (hero) => { hero.pendingManualAction = { kind: 'item', ref: { instanceId: 'i-1' }, seq: 7 }; },
        cleared: (hero) => hero.pendingManualAction === null,
      },
    };

    /** O prazo que cada `seed` grava: sempre um minuto por vir, lido no relógio de quem gravou. */
    const REMAINING_MS = 60_000;
    interface DurationField {
      readonly seed: (hero: CharacterRuntime, nowMs: number) => void;
      /** Quanto falta em `nowMs`, ou `null` quando o prazo não está mais lá. */
      readonly remaining: (hero: CharacterRuntime, nowMs: number) => number | null;
    }
    const DURATION_FIELDS: Readonly<Record<string, DurationField>> = {
      cleanseImmunity: {
        seed: (hero, nowMs) => { hero.cleanseImmunity.set('poison', nowMs + REMAINING_MS); },
        remaining: (hero, nowMs) => {
          const untilMs = hero.cleanseImmunity.get('poison');
          return untilMs === undefined ? null : untilMs - nowMs;
        },
      },
      cooldowns: {
        seed: (hero, nowMs) => { hero.cooldowns.start('spell:wound', nowMs, REMAINING_MS); },
        remaining: (hero, nowMs) => (Object.keys(hero.cooldowns.getState().until).length === 0
          ? null : hero.cooldowns.remainingMs('spell:wound', nowMs)),
      },
      conditions: {
        seed: (hero, nowMs) => {
          hero.conditions.apply({ key: 'haste', speedPercent: 30, expiresAtMs: nowMs + REMAINING_MS });
        },
        remaining: (hero, nowMs) => {
          const condition = hero.conditions.get('haste');
          return condition === null ? null : condition.expiresAtMs - nowMs;
        },
      },
    };

    const newSession = (id: string): Session => new Session({
      id, contentVersion: 'v1', ruleset: joinedRuleset(),
      rng: Rng.fromSeed(id), createdAtMs: 0,
    });
    /** Uma sessão que recusa toda entrada — a party cheia. */
    const refusingSession = (): Session => new Session({
      id: 'full', contentVersion: 'v1',
      ruleset: { ...joinedRuleset(), onEnter: () => { throw new Error('party cheia'); } },
      rng: Rng.fromSeed('full'), createdAtMs: 0,
    });
    /** Uma sessão que se encerra no instante 3 000, no meio de um `advanceBy` maior. */
    const endingSession = (): Session => new Session({
      id: 'ending', contentVersion: 'v1',
      ruleset: {
        ...joinedRuleset(),
        onEnter: (session) => { session.scheduleIn('end', 3_000); },
        onEvent: (session) => { session.end('manual-exit'); },
      },
      rng: Rng.fromSeed('ending'), createdAtMs: 0,
    });

    it('todo campo do estado do personagem está classificado, e todo instante tem o seu teste', () => {
      const keysOf = (policy: ClockPolicy): string[] => Object.entries(SESSION_CLOCK_POLICY)
        .filter(([, current]) => current === policy).map(([key]) => key).sort();
      expect(Object.keys(STAMP_FIELDS).sort()).toEqual(keysOf('stamp'));
      expect(Object.keys(DURATION_FIELDS).sort()).toEqual(keysOf('duration'));
    });

    describe('carimbos: a entrada os zera', () => {
      it.each(Object.entries(STAMP_FIELDS))('%s: entrar numa sessão nova esquece o carimbo da anterior', (_name, field) => {
        const hero = character('a');
        field.stale(hero);
        // A pré-condição: o valor de fato está lá, ou o teste passaria vazio.
        expect(field.cleared(hero)).toBe(false);

        const session = newSession('fresh');
        session.enter(hero);
        expect(session.nowMs).toBe(0);
        expect(field.cleared(hero)).toBe(true);
      });

      it.each(Object.entries(STAMP_FIELDS))('%s: o snapshot preserva o carimbo — o relógio é o mesmo, e restaurar não passa por enter', (_name, field) => {
        const session = newSession('hot');
        const hero = character('a');
        session.enter(hero);
        session.advanceBy(1_000);
        field.stale(hero);
        expect(field.cleared(hero)).toBe(false);

        const restored = Session.fromSnapshot(session.snapshot(), joinedRuleset(), Rng.fromSeed('r'));
        const [again] = restored.participants;
        if (again === undefined) throw new Error('o snapshot perdeu o participante');
        expect(field.cleared(again)).toBe(false);
      });

      it.each(Object.entries(STAMP_FIELDS))('%s: a entrada RECUSADA não toca quem continua na sessão de origem', (_name, field) => {
        const refused = character('refused');
        field.stale(refused);
        expect(() => newSession('full').enter(refused)).toThrow('party cheia');
        expect(field.cleared(refused)).toBe(false);
      });

      it('o banco de cargas de bloqueio volta CHEIO — o estado de quem nunca bloqueou, não o zero de quem gastou', () => {
        const hero = character('a');
        hero.blockCharge = { charges: 0, anchorMs: 57_700 };
        newSession('fresh').enter(hero);
        expect(hero.blockCharge).toBe(FULL_BLOCK_CHARGE);
      });
    });

    describe.each(Object.entries(DURATION_FIELDS))('prazos — %s: a entrada traduz, e o que faltava continua faltando', (_name, field) => {
      it('o servidor constrói o destino ANTES de encerrar a origem: o restante vale no relógio novo, e a saída da origem não o desfaz', () => {
        const hero = character('a');
        const first = newSession('first');
        first.enter(hero);
        first.advanceBy(57_700);
        field.seed(hero, first.nowMs);
        // A pré-condição: o valor de fato está lá, no relógio da primeira.
        expect(field.remaining(hero, first.nowMs)).toBe(REMAINING_MS);

        // Entrada EM CURSO (a party): o relógio novo não está em zero, e a tradução soma o `nowMs`.
        const second = newSession('second');
        second.advanceBy(5_000);
        second.enter(hero);
        expect(field.remaining(hero, second.nowMs)).toBe(REMAINING_MS);

        // O `#runTransition` do host encerra a origem DEPOIS: ela não pode traduzir de novo.
        first.end('manual-exit');
        expect(field.remaining(hero, second.nowMs)).toBe(REMAINING_MS);

        // O valor vive no relógio da nova: o tempo dela é que o gasta.
        second.advanceBy(10_000);
        expect(field.remaining(hero, second.nowMs)).toBe(REMAINING_MS - 10_000);
      });

      it('a origem JÁ saiu e continua andando (a party): vale o instante da saída, não o que o relógio dela andou depois', () => {
        // O host só constrói o destino no ciclo seguinte à saída, e a sessão de origem segue viva
        // para os outros membros. Se o restante fosse lido do relógio dela AGORA, dependeria de
        // quanto o hospedeiro a avançou nesse meio-tempo — a frequência (invariante 2).
        const hero = character('a');
        const first = newSession('first');
        first.enter(hero);
        first.enter(character('other'));
        first.advanceBy(57_700);
        field.seed(hero, first.nowMs);

        first.leave('a');
        first.advanceBy(30_000);

        const second = newSession('second');
        second.enter(hero);
        expect(field.remaining(hero, second.nowMs)).toBe(REMAINING_MS);
      });

      it('a sessão que acaba no MEIO de um advanceBy: vale o instante do fim, não o alvo que o relógio alcança depois', () => {
        const hero = character('a');
        const first = endingSession();
        first.enter(hero);
        field.seed(hero, first.nowMs);

        first.advanceBy(10_000);
        expect(first.ended).toBe('manual-exit');
        // O `advanceBy` empurra o relógio até o alvo mesmo depois do fim; o fim foi em 3 000.
        expect(first.nowMs).toBe(10_000);

        const second = newSession('second');
        second.enter(hero);
        expect(field.remaining(hero, second.nowMs)).toBe(REMAINING_MS - 3_000);
      });

      it('o que já venceu na saída não atravessa — pronto é a ausência do prazo', () => {
        const hero = character('a');
        const first = newSession('first');
        first.enter(hero);
        field.seed(hero, first.nowMs);
        first.advanceBy(REMAINING_MS);
        first.leave('a');

        const second = newSession('second');
        second.enter(hero);
        expect(field.remaining(hero, second.nowMs)).toBeNull();
      });

      it('sai e volta à MESMA sessão: o prazo fica pausado enquanto ele esteve fora', () => {
        const hero = character('a');
        const session = newSession('same');
        session.enter(hero);
        field.seed(hero, session.nowMs);
        session.advanceBy(10_000);
        session.leave('a');
        session.advanceBy(20_000);
        session.enter(hero);
        expect(field.remaining(hero, session.nowMs)).toBe(REMAINING_MS - 10_000);
      });

      it('o snapshot preserva o prazo (restaurar não traduz), e a transição seguinte parte do relógio restaurado', () => {
        const hot = newSession('hot');
        const hero = character('a');
        hot.enter(hero);
        hot.advanceBy(1_000);
        field.seed(hero, hot.nowMs);

        const restored = Session.fromSnapshot(hot.snapshot(), joinedRuleset(), Rng.fromSeed('r'));
        const [again] = restored.participants;
        if (again === undefined) throw new Error('o snapshot perdeu o participante');
        expect(field.remaining(again, restored.nowMs)).toBe(REMAINING_MS);

        // Sem `bindClock` na restauração o personagem não saberia de onde vem, e levaria o instante
        // cru para a sessão seguinte.
        restored.advanceBy(20_000);
        const next = newSession('next');
        next.enter(again);
        expect(field.remaining(again, next.nowMs)).toBe(REMAINING_MS - 20_000);
      });

      it('a entrada RECUSADA não toca quem continua na origem — e a transição seguinte ainda parte dela', () => {
        const hero = character('a');
        const first = newSession('first');
        first.enter(hero);
        first.advanceBy(57_700);
        field.seed(hero, first.nowMs);

        const full = refusingSession();
        full.advanceBy(5_000);
        expect(() => full.enter(hero)).toThrow('party cheia');
        expect(field.remaining(hero, first.nowMs)).toBe(REMAINING_MS);

        const second = newSession('second');
        second.enter(hero);
        expect(field.remaining(hero, second.nowMs)).toBe(REMAINING_MS);
      });

      it('sem sessão anterior (o personagem do ticket) o prazo entra como veio', () => {
        const hero = character('a');
        field.seed(hero, 0);
        const session = newSession('fresh');
        session.advanceBy(5_000);
        session.enter(hero);
        expect(field.remaining(hero, 0)).toBe(REMAINING_MS);
      });
    });

    it('uma condição com tique leva o vencimento E a fase do próximo tique', () => {
      const hero = character('a');
      const first = newSession('first');
      first.enter(hero);
      first.advanceBy(10_000);
      hero.conditions.apply({
        key: 'poison', expiresAtMs: 70_000, nextTickAtMs: 12_000,
        tick: { kind: 'damage', amount: 5, intervalMs: 3_000 },
      });

      const second = newSession('second');
      second.enter(hero);
      expect(hero.conditions.get('poison')).toMatchObject({ expiresAtMs: 60_000, nextTickAtMs: 2_000 });
    });

    it('hunt → hunt com o mesmo objeto: nada da primeira chega à segunda, e o que a segunda grava vale', () => {
      // Cada `enter` recomeça do zero, e o valor gravado DEPOIS de entrar (com o relógio da
      // sessão em curso) continua valendo até a próxima entrada: nenhum avanço do relógio o
      // zera, e o snapshot o leva.
      const hero = character('a');
      const first = newSession('first');
      first.enter(hero);
      first.advanceBy(57_700);
      for (const field of Object.values(STAMP_FIELDS)) field.stale(hero);
      for (const field of Object.values(DURATION_FIELDS)) field.seed(hero, first.nowMs);

      const second = newSession('second');
      second.enter(hero);
      for (const field of Object.values(STAMP_FIELDS)) expect(field.cleared(hero)).toBe(true);
      for (const field of Object.values(DURATION_FIELDS)) {
        expect(field.remaining(hero, second.nowMs)).toBe(REMAINING_MS);
      }

      // Gravados na segunda, no relógio dela.
      second.advanceBy(2_000);
      hero.lastCombatActionAtMs = second.nowMs;
      hero.attackLockedUntil = second.nowMs + 500;
      second.advanceBy(1_000);
      expect(hero.lastCombatActionAtMs).toBe(2_000);
      expect(hero.attackLockedUntil).toBe(2_500);
      const restored = Session.fromSnapshot(second.snapshot(), joinedRuleset(), Rng.fromSeed('r'));
      expect(restored.participants[0]?.lastCombatActionAtMs).toBe(2_000);
      expect(restored.participants[0]?.attackLockedUntil).toBe(2_500);

      // E a PRÓXIMA entrada zera de novo o que a segunda gravou.
      const third = newSession('third');
      third.enter(hero);
      expect(hero.lastCombatActionAtMs).toBeNull();
      expect(hero.attackLockedUntil).toBe(0);
    });
  });

  it('guarda o instante lógico da entrada e filtra o extrato por ele', () => {
    const session = new Session({
      id: 'receipt', contentVersion: 'v1', ruleset: joinedRuleset(),
      rng: Rng.fromSeed('receipt'), createdAtMs: 0,
    });
    session.enter(character('a'));
    session.advanceBy(1000);
    session.record('antes');
    session.advanceBy(1000);
    session.enter(character('b')); // entra em nowMs = 2000
    session.record('depois');
    session.advanceBy(1000);
    session.record('mais-tarde');
    expect(session.snapshot().joinedAtMs).toEqual({ a: 0, b: 2000 });

    // O instante sobrevive ao snapshot: retomado, o extrato do mesmo jeito filtra.
    const restored = Session.fromSnapshot(session.snapshot(), joinedRuleset(), Rng.fromSeed('r'));
    expect(restored.snapshot().joinedAtMs).toEqual({ a: 0, b: 2000 });
    expect(restored.leave('b', 'manual-exit')?.receipt.notableEvents.map((e) => e.type))
      .toEqual(['depois', 'mais-tarde']);

    // O extrato de quem entrou tarde não leva o que aconteceu antes dele.
    const departure = session.leave('b', 'manual-exit');
    expect(departure?.receipt.notableEvents.map((e) => e.type)).toEqual(['depois', 'mais-tarde']);

    // O de quem estava desde o zero leva tudo, como sempre.
    const end = session.end('manual-exit');
    expect(end[0]?.notableEvents.map((e) => e.type))
      .toEqual(['antes', 'depois', 'mais-tarde', 'ended']);
  });

  it('um snapshot antigo, sem joinedAtMs, restaura como zero (extrato com tudo)', () => {
    const session = new Session({
      id: 'legacy-join', contentVersion: 'v1', ruleset: joinedRuleset(),
      rng: Rng.fromSeed('legacy-join'), createdAtMs: 0,
    });
    session.enter(character('a'));
    session.record('evento');
    const { joinedAtMs: _dropped, ...legacy } = session.snapshot();
    const restored = Session.fromSnapshot(legacy, joinedRuleset(), Rng.fromSeed('x'));
    const receipt = restored.end('manual-exit')[0];
    expect(receipt?.notableEvents.map((e) => e.type)).toEqual(['evento', 'ended']);
  });
});

describe('skill é estado de personagem e sobrevive ao snapshot (CMB-05, #333)', () => {
  const melee = skillSchema.parse({
    id: 'melee', name: 'Melee', startingLevel: 10,
    curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5,
  });

  it('o nível ganho durante a sessão volta no restore, e o resultado segue idêntico', () => {
    const session = new Session({
      id: 'skills', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('skills'), createdAtMs: 0,
    });
    const hero = character();
    session.enter(hero);
    for (let i = 0; i < 5; i++) session.advanceBy(1000);
    // Uso é evento: dois golpes praticados fecham um nível (curva base 2, um ponto por golpe).
    hero.skills.gain(melee, 2);
    const levelBefore = hero.skills.levelOf(melee);
    expect(levelBefore).toBeGreaterThan(10);

    const snap = JSON.parse(JSON.stringify(session.snapshot())) as ReturnType<Session['snapshot']>;
    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));
    const restored = resumed.participants[0] as CharacterRuntime;
    // O nível e os pontos voltam, sem bump de formato: `skills` é opcional no estado.
    expect(restored.skills.getState()).toEqual(hero.skills.getState());
    expect(restored.skills.levelOf(melee)).toBe(levelBefore);

    // E o resultado segue a mesma sequência: mesma semente, mesmos agregados e mesma skill.
    for (let i = 0; i < 5; i++) {
      session.advanceBy(1000);
      resumed.advanceBy(1000);
    }
    expect(resumed.aggregates.xpGained).toBe(session.aggregates.xpGained);
    expect(resumed.getRngState()).toEqual(session.getRngState());
    expect(restored.skills.getState()).toEqual(hero.skills.getState());
  });
});

describe('DPS/HPS por evento com janela de 60 s (#431, ADR 0032 d.14)', () => {
  /**
   * Dois golpes de 100 (t=0 e t=30 s) e uma cura de 60 (t=0), agendados como EVENTOS: é o que
   * garante o carimbo lógico no instante exato, igual a 1 Hz e a 10 Hz (invariante 2).
   */
  function performanceRuleset(): Ruleset {
    return {
      type: 'hunt',
      hz: () => 10,
      onEnter(session, character) {
        session.scheduleIn('hit', 0, { priority: EventPriority.Attack, subject: character.id });
        session.scheduleIn('hit', 30_000, { priority: EventPriority.Attack, subject: character.id });
        session.scheduleIn('heal', 0, { priority: EventPriority.Upkeep, subject: character.id });
      },
      onCreatureDied: () => {},
      onEnd: () => {},
      onEvent(session, event) {
        if (event.kind === 'hit') session.creditDamage(event.subject, 100);
        if (event.kind === 'heal') session.creditHealing(event.subject, 60);
      },
    };
  }

  function sessionWithPerformance(): Session {
    const session = new Session({
      id: 'perf', contentVersion: 'v1', ruleset: performanceRuleset(),
      rng: Rng.fromSeed('perf'), createdAtMs: 0,
    });
    session.enter(character('a'));
    return session;
  }

  it('a janela é aparada na LEITURA: 200/60 em t=45 s, só o segundo golpe em t=75 s, zero em t=95 s', () => {
    const session = sessionWithPerformance();
    for (let t = 100; t <= 45_000; t += 100) session.advanceBy(100);
    // Os dois golpes estão dentro dos 60 s (0 e 30 s de idade). O total da sessão é a soma.
    expect(session.dpsOf('a', session.nowMs)).toBeCloseTo(200 / 60, 10);
    expect(session.hpsOf('a', session.nowMs)).toBeCloseTo(60 / 60, 10);
    expect(session.aggregatesOf('a').damageDealt).toBe(200);
    expect(session.aggregatesOf('a').healingDone).toBe(60);

    // t=75 s: o golpe de t=0 saiu da janela (75 s) e o de t=30 fica (45 s) — só o segundo conta.
    // O critério da #431 dizia "em t=95 s só o segundo conta"; com o segundo golpe em t=30 s
    // ele já saiu em t=95 (65 s), e é por isso que os dois pontos são prensados aqui: t=75
    // isola o segundo e t=95 zera. A janela é de 60 s, nunca recontada do total.
    session.advanceBy(30_000);
    expect(session.dpsOf('a', session.nowMs)).toBeCloseTo(100 / 60, 10);
    expect(session.hpsOf('a', session.nowMs)).toBe(0);

    // t=95 s: os dois golpes saíram da janela; o total da sessão NÃO muda (não é recontado).
    session.advanceBy(20_000);
    expect(session.dpsOf('a', session.nowMs)).toBe(0);
    expect(session.hpsOf('a', session.nowMs)).toBe(0);
    expect(session.aggregatesOf('a').damageDealt).toBe(200);
  });

  it('1 Hz e 10 Hz produzem a mesma janela e o mesmo total', () => {
    const runAt = (stepMs: number): { dps: number; hps: number; damage: number } => {
      const session = sessionWithPerformance();
      for (let t = stepMs; t <= 45_000; t += stepMs) session.advanceBy(stepMs);
      return {
        dps: session.dpsOf('a', session.nowMs),
        hps: session.hpsOf('a', session.nowMs),
        damage: session.aggregatesOf('a').damageDealt,
      };
    };
    expect(runAt(1_000)).toEqual(runAt(100));
  });
});
