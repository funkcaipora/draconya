import { describe, expect, it } from 'vitest';
import {
  BOSSTIARY_STATE_VERSION, Bosstiary, bosstiaryKey, bosstiaryLevelOf, emptyBosstiaryState,
} from './bosstiary.js';
import type { BosstiaryConfig } from './bosstiary.js';

// A tabela REAL do Canary (`IOBosstiary::levelInfos`, `src/io/io_bosstiary.hpp`, 47dfd51): com
// números pequenos dá para contar o abate na mão, mas o que se quer prender aqui é justamente o
// conteúdo do Canary — os totais 50/100/100 e o abate exato de cada nível.
const config: BosstiaryConfig = {
  levels: {
    bane: [{ kills: 25, points: 5 }, { kills: 100, points: 15 }, { kills: 300, points: 30 }],
    archfoe: [{ kills: 5, points: 10 }, { kills: 20, points: 30 }, { kills: 60, points: 60 }],
    nemesis: [{ kills: 1, points: 10 }, { kills: 3, points: 30 }, { kills: 5, points: 60 }],
  },
};

/** Abate o boss `count` vezes e devolve o que cada abate rendeu. */
const kill = (
  bosstiary: Bosstiary, raceId: number, rarity: 'bane' | 'archfoe' | 'nemesis', count: number,
  withConfig: BosstiaryConfig | null = config,
) => Array.from({ length: count }, () => bosstiary.record(raceId, rarity, withConfig ?? undefined));

describe('contar abates de boss', () => {
  it('boss nunca abatido vale zero, e não ocupa lugar no snapshot', () => {
    const bosstiary = new Bosstiary();
    expect(bosstiary.killsOf(639)).toBe(0);
    expect(bosstiary.points).toBe(0);
    expect(bosstiary.getState()).toEqual({ kills: {}, points: 0, version: BOSSTIARY_STATE_VERSION });
    expect(bosstiary.getState()).toEqual(emptyBosstiaryState());
  });

  it('cada abate soma um, por raceId', () => {
    const bosstiary = new Bosstiary();
    expect(bosstiary.record(639, 'nemesis', config).kills).toBe(1);
    expect(bosstiary.record(639, 'nemesis', config).kills).toBe(2);
    expect(bosstiary.record(1811, 'archfoe', config).kills).toBe(1);
    expect(bosstiary.getState().kills).toEqual({ '639': 2, '1811': 1 });
    expect(bosstiaryKey(639)).toBe('639');
  });

  it('variantes de um boss compartilham o contador porque a chave é o raceId, não o id de conteúdo', () => {
    // As cinco formas de Urmahlullu declaram o MESMO `bossRaceId` (1811) no Canary: abater
    // qualquer uma soma no mesmo contador, e é ele que decide o nível de todas.
    const bosstiary = new Bosstiary();
    kill(bosstiary, 1811, 'archfoe', 3);
    kill(bosstiary, 1811, 'archfoe', 2);
    expect(bosstiary.killsOf(1811)).toBe(5);
    expect(bosstiary.getState().kills).toEqual({ '1811': 5 });
  });

  it('sem config o abate conta, mas nenhum nível fecha e nenhum ponto é ganho', () => {
    // A config é quem define nível, não quem autoriza contar: o conteúdo de teste sem
    // `bosstiary/` continua contando abate, como o Bestiário sem marcos.
    const bosstiary = new Bosstiary();
    const results = kill(bosstiary, 639, 'nemesis', 6, null);
    expect(results.map((r) => r.levelReached)).toEqual([null, null, null, null, null, null]);
    expect(results.every((r) => r.level === 0 && r.pointsGained === 0)).toBe(true);
    expect(bosstiary.killsOf(639)).toBe(6);
    expect(bosstiary.points).toBe(0);
  });
});

describe('níveis e pontos por raridade (IOBosstiary::levelInfos)', () => {
  it('Nemesis: níveis nos abates 1, 3 e 5, rendendo 10, 30 e 60 — 100 pontos no total', () => {
    const bosstiary = new Bosstiary();
    const results = kill(bosstiary, 100, 'nemesis', 6);
    expect(results.map((r) => r.levelReached)).toEqual([1, null, 2, null, 3, null]);
    expect(results.map((r) => r.pointsGained)).toEqual([10, 0, 30, 0, 60, 0]);
    expect(results.map((r) => r.level)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(bosstiary.points).toBe(100);
  });

  it('Archfoe: níveis nos abates 5, 20 e 60, rendendo 10, 30 e 60 — 100 pontos no total', () => {
    const bosstiary = new Bosstiary();
    const results = kill(bosstiary, 200, 'archfoe', 61);
    const reached = results
      .map((r, index) => ({ kill: index + 1, level: r.levelReached, points: r.pointsGained }))
      .filter((r) => r.level !== null);
    expect(reached).toEqual([
      { kill: 5, level: 1, points: 10 },
      { kill: 20, level: 2, points: 30 },
      { kill: 60, level: 3, points: 60 },
    ]);
    expect(bosstiary.points).toBe(100);
  });

  it('Bane: níveis nos abates 25, 100 e 300, rendendo 5, 15 e 30 — 50 pontos no total', () => {
    const bosstiary = new Bosstiary();
    const results = kill(bosstiary, 300, 'bane', 301);
    const reached = results
      .map((r, index) => ({ kill: index + 1, level: r.levelReached, points: r.pointsGained }))
      .filter((r) => r.level !== null);
    expect(reached).toEqual([
      { kill: 25, level: 1, points: 5 },
      { kill: 100, level: 2, points: 15 },
      { kill: 300, level: 3, points: 30 },
    ]);
    expect(bosstiary.points).toBe(50);
  });

  it('depois do nível 3 o abate continua contando, sem nível nem ponto novo', () => {
    const bosstiary = new Bosstiary();
    kill(bosstiary, 100, 'nemesis', 5);
    const after = kill(bosstiary, 100, 'nemesis', 10);
    expect(after.every((r) => r.levelReached === null && r.pointsGained === 0 && r.level === 3)).toBe(true);
    expect(bosstiary.killsOf(100)).toBe(15);
    expect(bosstiary.points).toBe(100);
  });

  it('cada boss soma os PRÓPRIOS pontos: o total é a soma sobre bosses', () => {
    const bosstiary = new Bosstiary();
    kill(bosstiary, 100, 'nemesis', 1);   // +10
    kill(bosstiary, 200, 'archfoe', 5);   // +10
    kill(bosstiary, 300, 'bane', 25);     // +5
    expect(bosstiary.points).toBe(25);
  });

  it('bosstiaryLevelOf conta os degraus atingidos, e é 0 sem tabela', () => {
    expect(bosstiaryLevelOf(0, 'nemesis', config)).toBe(0);
    expect(bosstiaryLevelOf(1, 'nemesis', config)).toBe(1);
    expect(bosstiaryLevelOf(4, 'nemesis', config)).toBe(2);
    expect(bosstiaryLevelOf(99, 'nemesis', config)).toBe(3);
    expect(bosstiaryLevelOf(24, 'bane', config)).toBe(0);
    expect(bosstiaryLevelOf(25, 'bane', config)).toBe(1);
    expect(bosstiaryLevelOf(99, 'nemesis')).toBe(0);
  });
});

describe('estado e fusão', () => {
  it('atravessa getState/fromState, e getState devolve uma CÓPIA', () => {
    const bosstiary = new Bosstiary();
    kill(bosstiary, 100, 'nemesis', 3);
    const state = bosstiary.getState();
    expect(state).toEqual({ kills: { '100': 3 }, points: 40, version: 1 });

    bosstiary.record(100, 'nemesis', config);
    expect(state.kills['100']).toBe(3);

    const restored = Bosstiary.fromState(state);
    expect(restored.killsOf(100)).toBe(3);
    expect(restored.points).toBe(40);
    // E o restaurado segue de onde parou: o abate 5 é o do nível 3.
    expect(kill(restored, 100, 'nemesis', 2).map((r) => r.levelReached)).toEqual([null, 3]);
    expect(restored.points).toBe(100);
  });

  it('fromState(undefined) é o personagem sem registro', () => {
    const bosstiary = Bosstiary.fromState(undefined);
    expect(bosstiary.getState()).toEqual(emptyBosstiaryState());
  });

  it('merge fica com o MAIOR de cada boss e dos pontos: extrato antigo fora de ordem não rebaixa', () => {
    const current = { kills: { '1': 5, '2': 1 }, points: 70, version: 1 };
    const older = { kills: { '1': 3, '3': 2 }, points: 40, version: 1 };
    const merged = Bosstiary.merge(current, older);
    expect(merged).toEqual({ kills: { '1': 5, '2': 1, '3': 2 }, points: 70, version: 1 });
    // Comutativa, pela mesma razão do Bestiário: contador monotônico.
    expect(Bosstiary.merge(older, current)).toEqual(merged);
  });

  it('merge sem estado corrente adota o extrato', () => {
    const incoming = { kills: { '9': 4 }, points: 30, version: 1 };
    expect(Bosstiary.merge(undefined, incoming)).toEqual(incoming);
  });
});
