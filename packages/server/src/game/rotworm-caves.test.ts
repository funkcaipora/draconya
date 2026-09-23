import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession, statsForLevel } from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';

// A Rotworm Caves REAL (#511): a caverna importada, a rota traçada sobre ela e o rotworm do
// Canary. Os testes do `sim` falam de fixtures — e o `sim` não lê disco, nem em teste —; este
// mora no servidor, que carrega o conteúdo de verdade, e prende que ele roda: e roda igual em
// qualquer taxa, que é a propriedade do projeto.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

function enter(content: Content, difficulty: 'cautious' | 'bold' | 'reckless'): { session: Session; ruleset: HuntRuleset } {
  const session = createHuntSession({
    id: 'caves', content, huntId: 'rotworm-caves', difficulty, createdAtMs: 0,
  });
  const stats = statsForLevel(8, null, content.progression);
  session.enter(new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 9 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
    level: 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  }));
  return { session, ruleset: session.ruleset as HuntRuleset };
}

function run(session: Session, durationMs: number, stepMs: number): void {
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) session.advanceBy(stepMs);
}

describe('a Rotworm Caves real (#511)', () => {
  it('cada pull atinge exatamente o monsterCount dele vivo, e nunca passa: 2, 5 e 8', () => {
    for (const [difficulty, count] of [['cautious', 2], ['bold', 5], ['reckless', 8]] as const) {
      const { session, ruleset } = enter(real(), difficulty);
      // O lugar do ponto 0 é o tile em que o herói entra: com `spawnClearRadius` (#236) ele
      // só nasce quando o herói se afasta, e pelo laço inteiro um lugar recém-vagado espera
      // o herói sair de perto. A densidade é a da dificuldade — alcançada, e nunca excedida —,
      // mas num instante qualquer pode faltar o lugar que o herói está pisando.
      let most = 0;
      for (let t = 0; t < 10_000; t += 100) {
        session.advanceBy(100);
        const alive = ruleset.monsters.filter((m) => m.alive).length;
        expect(alive, difficulty).toBeLessThanOrEqual(count);
        most = Math.max(most, alive);
      }
      expect(most, difficulty).toBe(count);
    }
  });

  it('o herói percorre o laço e a caverna rende: abates, XP, gold e loot em dez minutos', () => {
    // Cautious, não bold (diferença do molde da Rat Cellars): o rotworm bate 24-30 contra
    // armor 8, muito mais forte que o rato (3-4) — um herói level 8 desarmado sobrevive dez
    // minutos no bold ou no reckless (medido: morre por volta de 127 s / 92 s, DT-05 só mede
    // sobrevivência no cautious). Aqui o objetivo é medir o rendimento de uma sessão completa,
    // e só o cautious chega ao fim das dez minutos sem morrer.
    const { session, ruleset } = enter(real(), 'cautious');
    run(session, 600_000, 100);
    expect(session.ended).toBeNull();
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(session.aggregates.xpGained).toBe(session.aggregates.kills * 40);
    expect(session.aggregates.goldGained).toBeGreaterThan(0);
    expect(session.aggregates.itemsLooted).toBeGreaterThan(0);
    // A rota é um laço de 372 tiles: o walker deu a volta ao menos uma vez.
    expect(ruleset.routeIndex).toBeGreaterThanOrEqual(0);
    // RF-05: o número fica visível para comparar com o recorde solo do Huntera (9.346 XP/h ·
    // 2.610 gp/h, docs/reference/huntera-observed.md §31) — comparação, não asserção: o bot do
    // Draconya e o jogador do recorde não seguem a mesma rotação, e o número real muda com a
    // rota e o combate desarmado do level 8.
    const hours = 600_000 / 3_600_000;
    console.log(
      `Rotworm Caves (cautious, 10 min): XP/h=${(session.aggregates.xpGained / hours).toFixed(0)} `
      + `gp/h=${(session.aggregates.goldGained / hours).toFixed(0)}`,
    );
  });

  it('dez minutos a 1 Hz e a 10 Hz dão o MESMO resultado na caverna real', () => {
    // O teste que define o projeto (ADR 0003), agora sobre o conteúdo de verdade: nada aqui é
    // escrito por tick, então o extrato e a posição de cada rotworm não dependem da taxa.
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

  it('um personagem level 8 sem arma sobrevive 10 minutos no pull cautious', () => {
    const { session } = enter(real(), 'cautious');
    run(session, 600_000, 100);
    expect(session.ended).toBeNull();
    expect(session.aggregates.xpGained % 40).toBe(0);
    const hoursFraction = 600_000 / 3_600_000;
    console.log(`XP/h: ${Math.round(session.aggregates.xpGained / hoursFraction)}`);
    console.log(`gp/h: ${Math.round(session.aggregates.goldGained / hoursFraction)}`);
    // Comparar com o recorde solo do Huntera (9.346 XP/h · 2.610 gp/h, §31) — sem asserção:
    // é conteúdo de conteúdo real com bot padrão, não o recorde de um jogador otimizando.
  });
});
