import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { migrateBotConfigV1 } from '../../../content/src/bot-migration.js';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession, statsForLevel } from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';

// A Rotworm Caves REAL (#511, recorte de Darashia #515): a caverna importada, a rota traçada
// sobre ela e o rotworm do Canary. Os testes do `sim` falam de fixtures — e o `sim` não lê
// disco, nem em teste —; este mora no servidor, que carrega o conteúdo de verdade, e prende que
// ele roda: e roda igual em qualquer taxa, que é a propriedade do projeto.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

function enter(
  content: Content, difficulty: 'cautious' | 'bold' | 'reckless', options: { gold?: number } = {},
): { session: Session; ruleset: HuntRuleset } {
  const session = createHuntSession({
    id: 'caves', content, huntId: 'rotworm-caves', difficulty, createdAtMs: 0,
  });
  const stats = statsForLevel(8, null, content.progression);
  session.enter(new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 8 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
    level: 8, xp: 0, gold: options.gold ?? 0, goldDelta: 0, alive: true, cooldowns: {},
  }));
  const ruleset = session.ruleset as HuntRuleset;
  // O personagem novo já nasce com o bot padrão do conteúdo (FUN-114), como no Huntera — onde a
  // cura automática (poção com HP ≤ 70 %, aqui a magia `heal`) é o que segura o level 8 contra o
  // rotworm (Parte VI §36, #515). Sem isto o herói de teste golpeava e nunca se curava, o que
  // não é o cenário que a paridade pede.
  const defaults = migrateBotConfigV1(content.bot.defaultConfig);
  ruleset.configureBot(session, defaults, 'hero');
  return { session, ruleset };
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

  it('o herói percorre o laço e a caverna rende: abates, gold e loot em dez minutos', () => {
    // Cautious, não bold (diferença do molde da Rat Cellars): o rotworm bate 24-30 contra
    // armor 8, muito mais forte que o rato (3-4). Antes da #521 (ADR 0037) o herói level 8
    // desarmado sobrevivia dez minutos no cautious com a regeneração provisória (1 HP/s para
    // todos); o regen REAL do Tibia (`vocations.xml` da vocação `None`, ~0,08 HP/s — mais de
    // 10× mais lento) tira a folga que sobrava, e este herói — SEM gold, sem poção — depende só
    // da cura automática (heal com HP ≤ 70%), que já não garante os dez minutos inteiros. O
    // teste passa a medir o rendimento até o fim da janela OU até a morte, o que vier primeiro.
    //
    // O invariante `xpGained === kills × 40` continua de pé QUANDO o herói sobrevive — só
    // relaxa se ele morre, porque aí a penalidade de morte desconta um valor que não é múltiplo
    // de 40. Perder os dois juntos (sobrevivência OU a fórmula fechada) escondia justamente a
    // regressão que valeria pegar: uma morte precoce por engano ainda passaria se a asserção só
    // checasse `kills > 0`.
    const { session, ruleset } = enter(real(), 'cautious');
    run(session, 600_000, 100);
    expect(['death', null]).toContain(session.ended);
    if (session.ended === null) {
      expect(session.aggregates.xpGained).toBe(session.aggregates.kills * 40);
    }
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(session.aggregates.goldGained).toBeGreaterThan(0);
    expect(session.aggregates.itemsLooted).toBeGreaterThan(0);
    // A rota é um laço de 444 tiles: o walker deu a volta ao menos uma vez.
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
    // No recorte de Darashia o herói morre no bold antes dos 600 s (§"Risco medido" da spec
    // de #515 — o mesmo já valia para o recorte da #511, medido por volta de 127 s). A morte
    // vence NO MEIO de um `advanceBy`, e `Session.advanceBy` credita o `dtMs` inteiro em
    // `aggregates.durationMs` ANTES de despachar os eventos da janela (`packages/sim/src/
    // session.ts`) — não existe um jeito de saber, de fora, quanto da última janela era "antes"
    // do fim sem olhar pra dentro da sessão encerrada. Isso é bookkeeping do agregado, não o
    // extrato do mundo: por isso o `durationMs` de cada corrida pode divergir em até o maior
    // `stepMs` usado (aqui, 1000 ms), e é comparado à parte, por limite — o resto do extrato
    // (abates, XP, gold, loot, posição de cada rotworm, itens no chão) é comparado por igualdade
    // exata, exatamente como o ADR 0003 pede.
    const { durationMs: slowDurationMs, ...slowRest } = slow.session.aggregates;
    const { durationMs: fastDurationMs, ...fastRest } = fast.session.aggregates;
    expect(slowRest).toEqual(fastRest);
    expect(Math.abs(slowDurationMs - fastDurationMs)).toBeLessThanOrEqual(1_000);
    expect(slow.ruleset.monsters.map((m) => [m.id, m.alive, m.position])).toEqual(
      fast.ruleset.monsters.map((m) => [m.id, m.alive, m.position]),
    );
    expect(slow.ruleset.groundItems).toEqual(fast.ruleset.groundItems);
  });

  it('um personagem level 8 sem arma aguenta o pull cautious com cura automática e poção', () => {
    // Bot padrão (FUN-114, #515): cura automática com HP ≤ 70 % (magia `heal`) e poção com
    // HP ≤ 40 % (`health-potion`, `packages/content/data/bot/baseline.json`) são o que segura o
    // herói, como o Druid do Huntera segurou com HP mínimo 116/170 (Parte VI §36).
    //
    // O regen passivo REAL do Tibia (#521, ADR 0037 — vocação `None` do Canary, ~0,08 HP/s) é
    // mais de 10× mais lento que o 1 HP/s provisório que este teste media antes, e a cura
    // automática SOZINHA (sem poção) já não garante os dez minutos inteiros — ver o teste
    // acima, sem gold. Um jogador de Tibia de verdade carrega poção; este herói também passa a
    // carregar (2.000 gold, o bastante para dezenas de poções de 45 — medido: a caverna real
    // gasta ~225 gold em dez minutos aqui), e com ela a sobrevivência plena volta a valer, como
    // valia antes da #521 — só que agora sustentada do jeito certo.
    const { session } = enter(real(), 'cautious', { gold: 2_000 });
    const hero = session.participants[0] as CharacterRuntime;
    let minHp = hero.health;
    for (let t = 0; t < 600_000 && session.ended === null; t += 100) {
      session.advanceBy(100);
      minHp = Math.min(minHp, hero.health);
    }
    console.log(`HP mínimo: ${minHp}/${hero.maxHealth}`);
    expect(session.ended).toBeNull();
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(session.aggregates.xpGained).toBe(session.aggregates.kills * 40);
    const hoursFraction = 600_000 / 3_600_000;
    console.log(`XP/h: ${Math.round(session.aggregates.xpGained / hoursFraction)}`);
    console.log(`gp/h: ${Math.round(session.aggregates.goldGained / hoursFraction)}`);
    // Comparar com o recorde solo do Huntera (9.346 XP/h · 2.610 gp/h, §31) — sem asserção:
    // é conteúdo de conteúdo real com bot padrão, não o recorde de um jogador otimizando.
  });
});
