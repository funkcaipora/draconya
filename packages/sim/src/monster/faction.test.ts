// Facções (#619): a tabela por monstro, o alcance de cada hunt e o desempate por facção — os
// números vêm do Canary 47dfd51 (`game_definitions.hpp:44-53`, `Monster::searchTargetImmediate`,
// `MonsterTargetRanker::rank`), e o teste os confere um a um.

import { MONSTER_FACTIONS, factionValue } from '@draconya/content';
import type { Monster } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import {
  FACTION_DEFAULT, FACTION_PLAYER, NEAREST_FACTION_WEIGHT, RANK_FACTION_WEIGHT, buildFactionTable,
  reachableMonsterIds,
} from './faction.js';
import { MonsterRuntime, chooseTarget, decideUnengagedMove, nearestPrey } from './monster.js';
import type { Prey } from './monster.js';
import { rankTarget } from './target-strategy.js';

/** Só o que estas funções leem do monstro do conteúdo — o resto do `Monster` é ruído aqui. */
const monster = (over: Record<string, unknown>): Monster => ({
  id: 'x', name: 'X', health: 100, experience: 0, aggroRadius: 11, leashRadius: 0,
  targetDistance: 1, abilities: [], defenses: [], ...over,
}) as unknown as Monster;

const catalog = (...monsters: Monster[]): ReadonlyMap<string, Monster> =>
  new Map(monsters.map((m) => [m.id, m]));

const deepling = monster({ id: 'deepling', faction: 'deepling', enemyFactions: ['player', 'deathling'] });
const deathling = monster({ id: 'deathling', faction: 'deathling', enemyFactions: ['player', 'deepling'] });
const rat = monster({ id: 'rat' });

describe('os valores do enum `Faction_t` (game_definitions.hpp:44-53)', () => {
  it('o valor é o índice do nome, e o default e o jogador são 0 e 1', () => {
    expect(FACTION_DEFAULT).toBe(0);
    expect(FACTION_PLAYER).toBe(1);
    expect(MONSTER_FACTIONS.map(factionValue)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('os pesos do Canary: `faction × 100` na distância, `faction × 100 000` na vida e no dano', () => {
    expect(NEAREST_FACTION_WEIGHT).toBe(100);
    expect(RANK_FACTION_WEIGHT).toBe(100_000);
  });
});

describe('reachableMonsterIds: o que pode nascer numa hunt', () => {
  it('junta os monstros dos pontos — o `monsterId` e a lista com peso (#582)', () => {
    const reached = reachableMonsterIds(
      [{ monsterId: 'rat' }, { monsters: [{ monsterId: 'deepling' }, { monsterId: 'deathling' }] }],
      catalog(rat, deepling, deathling),
    );
    expect([...reached].sort()).toEqual(['deathling', 'deepling', 'rat']);
  });

  it('segue as invocações, transitivamente e sem laço', () => {
    const efreet = monster({
      id: 'efreet', faction: 'efreet',
      summons: { max: 2, entries: [{ monsterId: 'green-djinn', chance: 0.1, intervalMs: 2000, count: 2 }] },
    });
    // O djinn invoca o Efreet de volta: um ciclo que a busca não pode seguir para sempre.
    const djinn = monster({
      id: 'green-djinn',
      summons: { max: 1, entries: [{ monsterId: 'efreet', chance: 0.1, intervalMs: 2000, count: 1 }] },
    });
    const reached = reachableMonsterIds([{ monsterId: 'efreet' }], catalog(efreet, djinn, rat));
    expect([...reached].sort()).toEqual(['efreet', 'green-djinn']);
  });

  it('o catálogo inteiro NÃO entra: só o que os pontos alcançam', () => {
    const reached = reachableMonsterIds([{ monsterId: 'rat' }], catalog(rat, deepling, deathling));
    expect([...reached]).toEqual(['rat']);
  });
});

describe('buildFactionTable', () => {
  it('só entram os alcançáveis COM facção, com os valores numéricos', () => {
    const table = buildFactionTable(catalog(rat, deepling, deathling), new Set(['rat', 'deepling']));
    expect([...table.keys()]).toEqual(['deepling']);
    expect(table.get('deepling')).toEqual({ faction: 6, enemies: new Set([1, 7]) });
  });

  it('vazia para uma hunt sem facção — a condição do caminho rápido do ruleset', () => {
    expect(buildFactionTable(catalog(rat, deepling), new Set(['rat'])).size).toBe(0);
  });

  it('`faction: default` explícito, ou `enemyFactions` sem facção, não entram (o Canary só lê a lista com facção)', () => {
    const explicit = monster({ id: 'explicit', faction: 'default', enemyFactions: ['player'] });
    const orphan = monster({ id: 'orphan', enemyFactions: ['player', 'deepling'] });
    const table = buildFactionTable(catalog(explicit, orphan), new Set(['explicit', 'orphan']));
    expect(table.size).toBe(0);
  });

  it('facção sem inimiga entra com o conjunto vazio: ela existe, e não ataca ninguém', () => {
    const peaceful = monster({ id: 'peaceful', faction: 'lion' });
    expect(buildFactionTable(catalog(peaceful), new Set(['peaceful'])).get('peaceful'))
      .toEqual({ faction: 2, enemies: new Set() });
  });
});

/** Um candidato — `position.x` é a distância ao monstro plantado na origem. */
const prey = (id: string, x: number, over: Partial<Prey> = {}): Prey => ({
  id, position: { x, y: 0, z: 7 }, alive: true, health: 100, ...over,
});
const at = (): MonsterRuntime => new MonsterRuntime({
  id: 1, monsterId: 'x', position: { x: 0, y: 0, z: 7 }, home: { x: 0, y: 0, z: 7 },
  health: 100, targetId: null, cooldowns: {},
});
const rng = (): Rng => Rng.fromSeed('faction');

describe('o desempate por facção na aquisição (`TARGETSEARCH_NEAREST`, `faction × 100` na distância)', () => {
  it('o jogador (facção 1) ganha do monstro inimigo mais perto: 8 + 100 < 1 + 700', () => {
    const chosen = chooseTarget(
      at(), [prey('hero', 8), prey('deathling', 1, { faction: 7 })], deepling, rng(), 0,
    );
    expect(chosen).toBe('hero');
  });

  it('entre facções: a de número MENOR ganha (Deepling 6 antes de Deathling 7), qualquer que seja a distância', () => {
    const chosen = chooseTarget(
      at(), [prey('deathling', 1, { faction: 7 }), prey('deepling', 10, { faction: 6 })],
      monster({ id: 'anuma', aggroRadius: 11 }), rng(), 0,
    );
    expect(chosen).toBe('deepling');
  });

  it('na MESMA facção vale a distância, e empate fica com o primeiro da lista (comparação estrita)', () => {
    const list = [prey('far', 5, { faction: 7 }), prey('near', 2, { faction: 7 }), prey('tie', 2, { faction: 7 })];
    expect(chooseTarget(at(), list, deepling, rng(), 0)).toBe('near');
  });

  it('sem `faction` o candidato vale PLAYER: a lista de sempre (só personagens) não muda', () => {
    const list = [prey('a', 4), prey('b', 2), prey('c', 3)];
    expect(chooseTarget(at(), list, deepling, rng(), 0)).toBe('b');
    // E o valor explícito de PLAYER é o mesmo que ausente.
    const explicit = list.map((p) => ({ ...p, faction: FACTION_PLAYER }));
    expect(chooseTarget(at(), explicit, deepling, rng(), 0)).toBe('b');
  });

  it('o `nearestPrey` do `targetChange` usa o mesmo critério', () => {
    const origin = { x: 0, y: 0 };
    expect(nearestPrey(origin, [prey('deathling', 1, { faction: 7 }), prey('hero', 9)])?.id).toBe('hero');
    expect(nearestPrey(origin, [prey('x', 3), prey('y', 2)])?.id).toBe('y');
  });
});

describe('o desempate por facção no ranking ponderado (`MonsterTargetRanker::rank`)', () => {
  // Uma estratégia com UM peso só: o critério sorteado é sempre o mesmo, e o teste mede o critério.
  const only = (criterion: 'nearest' | 'health' | 'damage') => ({
    nearest: 0, health: 0, damage: 0, random: 0, [criterion]: 1,
  });
  const candidate = (id: string, over: Record<string, number>) => ({
    id, distance: 1, health: 100, damage: 0, ...over,
  });

  it('mais perto: `distance + faction × 100`', () => {
    const chosen = rankTarget(
      only('nearest'), [candidate('deathling', { distance: 1, faction: 7 }), candidate('hero', { distance: 9 })], rng(),
    );
    expect(chosen).toBe('hero');
  });

  it('menos vida: `health + faction × 100 000` — a facção MENOR ganha mesmo com mais vida', () => {
    const chosen = rankTarget(
      only('health'), [candidate('deathling', { health: 1, faction: 7 }), candidate('hero', { health: 5_000 })], rng(),
    );
    expect(chosen).toBe('hero');
  });

  it('mais dano: a facção MAIOR ganha (o Canary soma o offset e escolhe o máximo)', () => {
    const chosen = rankTarget(
      only('damage'),
      [candidate('hero', { damage: 900 }), candidate('deathling', { damage: 10, faction: 7 })], rng(),
    );
    expect(chosen).toBe('deathling');
  });

  it('quem nunca bateu só ganha se ninguém tiver batido: o primeiro da lista fica', () => {
    expect(rankTarget(only('damage'), [candidate('a', {}), candidate('b', {})], rng())).toBe('a');
    expect(rankTarget(only('damage'), [candidate('a', {}), candidate('b', { damage: 1 })], rng())).toBe('b');
  });

  it('sem `faction` nos candidatos o critério é o de antes do #619', () => {
    const list = [candidate('a', { distance: 3, health: 50 }), candidate('b', { distance: 2, health: 80 })];
    expect(rankTarget(only('nearest'), list, rng())).toBe('b');
    expect(rankTarget(only('health'), list, rng())).toBe('a');
  });
});

describe('a volta ao spawn do monstro de facção com jogador à vista (`Monster::doWalkBack`)', () => {
  const home = { x: 0, y: 0, z: 7 };
  const away = (): MonsterRuntime => {
    const walker = new MonsterRuntime({
      id: 1, monsterId: 'x', position: { x: 5, y: 0, z: 7 }, home, health: 100, targetId: null,
      cooldowns: {}, walkingBack: true,
    });
    return walker;
  };
  const free = () => false;
  const decide = (definition: Monster, participants: Prey[], walker = away()) => ({
    walker,
    move: decideUnengagedMove(
      walker, definition, null, participants, [], free, free, free, 0, { integer: () => 0 },
    ),
  });

  it('com um jogador vivo à vista: desliga a volta e não dá passo (`totalPlayersOnScreen > 0`)', () => {
    const { walker, move } = decide(deepling, [prey('hero', 7)]);
    expect(move).toEqual({ kind: 'walk-back', to: null });
    expect(walker.walkingBack).toBe(false);
  });

  it('sem ninguém à vista: a volta segue, um tile por vez', () => {
    const { walker, move } = decide(deepling, [prey('hero', 40)]);
    expect(move).toMatchObject({ kind: 'walk-back' });
    expect((move as { to: unknown }).to).not.toBeNull();
    expect(walker.walkingBack).toBe(true);
  });

  it('o jogador MORTO não conta — `updateTargetList` o tira da lista', () => {
    const { walker } = decide(deepling, [prey('hero', 7, { alive: false })]);
    expect(walker.walkingBack).toBe(true);
  });

  it('o monstro SEM facção não tem esse corte: o contador é só de quem tem facção', () => {
    const { walker, move } = decide(rat, [prey('hero', 7)]);
    expect(move).toMatchObject({ kind: 'walk-back' });
    expect((move as { to: unknown }).to).not.toBeNull();
    expect(walker.walkingBack).toBe(true);
  });
});
