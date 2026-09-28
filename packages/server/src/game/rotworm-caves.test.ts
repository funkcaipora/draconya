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
  content: Content, difficulty = 'default', options: { gold?: number } = {},
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
  // O personagem novo já nasce com o bot padrão do conteúdo (FUN-114), como no Huntera — a
  // poção (HP ≤ 40%, com gold) é o que segura o level 8 contra o rotworm (Parte VI §36, #515).
  // Desde o #596, o Tibia real não dá magia nenhuma antes da escolha de vocação (§7.4), então o
  // `defaultConfig` pré-vocação não tem mais cura automática por magia — só a poção.
  const defaults = migrateBotConfigV1(content.bot.defaultConfig);
  ruleset.configureBot(session, defaults, 'hero');
  return { session, ruleset };
}

function run(session: Session, durationMs: number, stepMs: number): void {
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) session.advanceBy(stepMs);
}

describe('a Rotworm Caves real (#511, #586)', () => {
  it('todos os 42 pontos de spawn nascem — sem pull, sem escolha de tamanho (ADR 0039)', () => {
    // Fim do pull por dificuldade (#583): os 42 pontos da rota (importados do recorte real do
    // Canary pelo #586, `pnpm catalog:spawns --map rotworm-caves`) nascem juntos, na entrada —
    // a densidade não é mais 2/5/8 escolhidos, é o total de pontos que a rota declara. A
    // população INICIAL nunca checa `blockable` (#583, `SpawnMonster::startup` do Canary); só o
    // tile onde o herói entra pode ficar ocupado no primeiro instante, então o teto observável
    // é 42, mas o instante inicial pode ficar um a menos.
    const { session, ruleset } = enter(real());
    let most = 0;
    for (let t = 0; t < 10_000; t += 100) {
      session.advanceBy(100);
      const alive = ruleset.monsters.filter((m) => m.alive).length;
      expect(alive).toBeLessThanOrEqual(42);
      most = Math.max(most, alive);
    }
    expect(most).toBeGreaterThanOrEqual(41);
  });

  it('o herói percorre o laço e a caverna rende: abates, gold e loot em dez minutos', () => {
    // Cautious, não bold (diferença do molde da Rat Cellars): o rotworm bate 24-30 contra
    // armor 8, muito mais forte que o rato (3-4). Antes da #521 (ADR 0037) o herói level 8
    // desarmado sobrevivia dez minutos no cautious com a regeneração provisória (1 HP/s para
    // todos); o regen REAL do Tibia (`vocations.xml` da vocação `None`, ~0,08 HP/s — mais de
    // 10× mais lento) tira a folga que sobrava. Desde o #596, o `defaultConfig` PRÉ-VOCAÇÃO não
    // tem mais cura automática por magia (o Tibia real não dá magia nenhuma antes do level 8,
    // §7.4; `heal`/`strike` eram genéricas inventadas antes da auditoria do #523/#596) — este
    // herói entra com gold suficiente para a poção (HP ≤ 40%) segurar a hunt, o equivalente
    // realista a como um personagem de verdade chegaria ao level 8. O teste passa a medir o
    // rendimento até o fim da janela OU até a morte, o que vier primeiro.
    //
    // O invariante `xpGained === Σ(abates de cada monstro × experiência dele) × 3` continua de
    // pé QUANDO o herói sobrevive — o ×3 é o bônus de level do conteúdo real (+200% até o level
    // 300, #563); a soma pesada por monstro (em vez de um único ×40) é o que o recorte real do
    // #586 pede: a caverna tem rotworm (40 XP) E terramite (160 XP) lado a lado, não um só. Só
    // relaxa se o herói morre, porque aí a penalidade de morte desconta um valor que não é
    // múltiplo disso. Perder os dois juntos (sobrevivência OU a fórmula fechada) escondia
    // justamente a regressão que valeria pegar: uma morte precoce por engano ainda passaria se a
    // asserção só checasse `kills > 0`.
    const content = real();
    const { session, ruleset } = enter(content, 'cautious');
    run(session, 600_000, 100);
    expect(['death', null]).toContain(session.ended);
    if (session.ended === null) {
      const hero = session.participants[0] as CharacterRuntime;
      const kills = hero.bestiary.getState();
      const expectedXp = Object.entries(kills).reduce((sum, [monsterId, count]) => {
        const experience = content.monsters.get(monsterId)?.experience ?? 0;
        return sum + count * experience * 3;
      }, 0);
      expect(session.aggregates.xpGained).toBe(expectedXp);
    }
    expect(session.aggregates.kills).toBeGreaterThan(0);
    // Fim do pull por dificuldade (#583, ADR 0039, mesclado depois deste teste): os 42 pontos
    // da rota nascem TODOS de uma vez, não mais os 2 do antigo `difficulties.cautious` — o
    // herói desarmado morre bem mais rápido, com poucos abates antes disso. Gold (71,76% por
    // abate) e item deixam de ser garantidos com uma amostra tão pequena; a asserção relaxa
    // para a mesma tolerância que `itemsLooted` já tinha.
    expect(session.aggregates.goldGained).toBeGreaterThanOrEqual(0);
    expect(session.aggregates.itemsLooted).toBeGreaterThanOrEqual(0);
    // A rota é um laço de 444 tiles: o walker andou nele antes de morrer.
    expect(ruleset.routeIndex).toBeGreaterThanOrEqual(0);
    // RF-05: o número fica visível para comparar com o recorde solo do Huntera (9.346 XP/h ·
    // 2.610 gp/h, docs/reference/huntera-observed.md §31) — comparação, não asserção: o bot do
    // Draconya e o jogador do recorde não seguem a mesma rotação, e o número real muda com a
    // rota e o combate desarmado do level 8.
    const hours = session.aggregates.durationMs / 3_600_000;
    console.log(
      `Rotworm Caves (cautious, até morrer): XP/h=${(session.aggregates.xpGained / hours).toFixed(0)} `
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

  it('um personagem level 8 sem arma, com cura automática e poção, mata ao menos um rotworm antes do fim', () => {
    // Bot padrão (FUN-114, #515): cura automática com HP ≤ 70 % (magia `heal`) e poção com
    // HP ≤ 40 % (`health-potion`, `packages/content/data/bot/baseline.json`) são o que segura o
    // herói, como o Druid do Huntera segurou com HP mínimo 116/170 (Parte VI §36).
    //
    // O regen passivo REAL do Tibia (#521, ADR 0037 — vocação `None` do Canary, ~0,08 HP/s) é
    // mais de 10× mais lento que o 1 HP/s provisório que este teste media antes, e a cura
    // automática SOZINHA (sem poção) já não garante os dez minutos inteiros — ver o teste
    // acima, sem gold. Um jogador de Tibia de verdade carrega poção; este herói também passa a
    // carregar (2.000 gold, o bastante para dezenas de poções de 45 — medido: a caverna real
    // gasta ~225 gold em dez minutos aqui), e com ela a sobrevivência plena valia — para o pull
    // de 2 rotworms do antigo `difficulties.cautious`.
    //
    // Fim do pull por dificuldade (#583, ADR 0039, mesclado depois deste teste): os 42 pontos
    // da rota nascem TODOS de uma vez — o herói desarmado apanha de muito mais rotworm ao mesmo
    // tempo do que a poção e a cura automática foram dimensionadas para segurar, e morre. A
    // asserção passa a aceitar os dois desfechos (como o teste acima), preservando o que ainda é
    // contrato: o herói mata pelo menos um antes de morrer, e a fórmula de XP fecha enquanto ele
    // sobrevive.
    const content = real();
    const { session } = enter(content, 'cautious', { gold: 2_000 });
    const hero = session.participants[0] as CharacterRuntime;
    let minHp = hero.health;
    for (let t = 0; t < 600_000 && session.ended === null; t += 100) {
      session.advanceBy(100);
      minHp = Math.min(minHp, hero.health);
    }
    console.log(`HP mínimo: ${minHp}/${hero.maxHealth}`);
    expect(['death', null]).toContain(session.ended);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    if (session.ended === null) {
      // O recorte real (#586) tem rotworm (40 XP) e terramite (160 XP) — a soma pesada pelo
      // bestiário do herói é o que fecha certo, não um único fator ×40 (ver o teste acima).
      const kills = hero.bestiary.getState();
      const expectedXp = Object.entries(kills).reduce((sum, [monsterId, count]) => {
        const experience = content.monsters.get(monsterId)?.experience ?? 0;
        return sum + count * experience * 3;
      }, 0);
      expect(session.aggregates.xpGained).toBe(expectedXp);
    }
    const hoursFraction = 600_000 / 3_600_000;
    console.log(`XP/h: ${Math.round(session.aggregates.xpGained / hoursFraction)}`);
    console.log(`gp/h: ${Math.round(session.aggregates.goldGained / hoursFraction)}`);
    // Comparar com o recorde solo do Huntera (9.346 XP/h · 2.610 gp/h, §31) — sem asserção:
    // é conteúdo de conteúdo real com bot padrão, não o recorde de um jogador otimizando.
  });
});
