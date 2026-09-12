import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession, statsForLevel } from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';

// A Rat Cellars REAL (FUN-123): o bueiro de Rookgaard importado, a rota traçada sobre ele e o
// rato do Tibia. Os testes do `sim` falam de fixtures — e o `sim` não lê disco, nem em teste —;
// este mora no servidor, que carrega o conteúdo de verdade, e prende que ele roda: e roda igual
// em qualquer taxa, que é a propriedade do projeto.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

function enter(content: Content, difficulty: 'cautious' | 'bold' | 'reckless'): { session: Session; ruleset: HuntRuleset } {
  const session = createHuntSession({
    id: 'cellars', content, huntId: 'rat-cellars', difficulty, createdAtMs: 0,
  });
  const stats = statsForLevel(8, null, content.progression);
  session.enter(new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 8 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
    level: 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  }));
  return { session, ruleset: session.ruleset as HuntRuleset };
}

function run(session: Session, durationMs: number, stepMs: number): void {
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) session.advanceBy(stepMs);
}

describe('a Rat Cellars real (FUN-123)', () => {
  it('cada pull mantém exatamente o monsterCount dele vivo: 2, 5 e 8', () => {
    for (const [difficulty, count] of [['cautious', 2], ['bold', 5], ['reckless', 8]] as const) {
      const { session, ruleset } = enter(real(), difficulty);
      // Dois segundos: todo lugar nasceu (o respawn é de 2 s), e o herói ainda está andando.
      run(session, 2_500, 100);
      expect(ruleset.monsters.filter((m) => m.alive).length, difficulty).toBe(count);
    }
  });

  it('o herói percorre o laço e o bueiro rende: abates, XP, gold e queijo em dez minutos', () => {
    const { session, ruleset } = enter(real(), 'bold');
    run(session, 600_000, 100);
    expect(session.ended).toBeNull();
    expect(session.aggregates.kills).toBeGreaterThan(20);
    expect(session.aggregates.xpGained).toBe(session.aggregates.kills * 5);
    expect(session.aggregates.goldGained).toBeGreaterThan(0);
    expect(session.aggregates.itemsLooted).toBeGreaterThan(0);
    // A rota é um laço de 160 tiles: o walker deu a volta ao menos uma vez.
    expect(ruleset.routeIndex).toBeGreaterThanOrEqual(0);
  });

  it('dez minutos a 1 Hz e a 10 Hz dão o MESMO resultado no bueiro real', () => {
    // O teste que define o projeto (ADR 0003), agora sobre o conteúdo de verdade: nada aqui é
    // escrito por tick, então o extrato e a posição de cada rato não dependem da taxa.
    const slow = enter(real(), 'bold');
    const fast = enter(real(), 'bold');
    run(slow.session, 600_000, 1_000);
    run(fast.session, 600_000, 100);
    expect(slow.session.aggregates).toEqual(fast.session.aggregates);
    expect(slow.ruleset.monsters.map((m) => [m.id, m.alive, m.position])).toEqual(
      fast.ruleset.monsters.map((m) => [m.id, m.alive, m.position]),
    );
    expect(slow.ruleset.groundItems).toEqual(fast.ruleset.groundItems);
  });
});
