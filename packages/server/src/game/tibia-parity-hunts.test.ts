import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession, statsForLevel } from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';

// O primeiro lote de hunts reais do Tibia por faixa de level (#587, M36-06): seis áreas novas
// recortadas do OTBM real com `pnpm map:import`, roteadas com `pnpm route:trace` e povoadas com
// os pontos de spawn reais do Canary via `pnpm catalog:spawns` — o mesmo pipeline que a Rat
// Cellars e a Rotworm Caves usam (#583/#586), documentado em `docs/product/hunt.md`. Este
// arquivo prova, para cada uma, o mesmo contrato mínimo que `rat-cellars.test.ts` prova para a
// Rat Cellars: o herói entra, anda a rota real e mata, ganhando XP.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

function enter(content: Content, huntId: string, level: number): { session: Session; ruleset: HuntRuleset } {
  const session = createHuntSession({
    id: `${huntId}-hero`, content, huntId, difficulty: 'default', createdAtMs: 0,
  });
  const stats = statsForLevel(level, null, content.progression);
  session.enter(new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 8 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
    level, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  }));
  return { session, ruleset: session.ruleset as HuntRuleset };
}

function run(session: Session, durationMs: number, stepMs: number): void {
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) session.advanceBy(stepMs);
}

// recommendedLevel de cada hunt (docs/product/hunt.md, data/hunts/*.json) — o `minSpawnPoints`
// prende o recorte real do Canary não ter encolhido para um punhado de pontos.
//
// `TEST_LEVEL` é bem acima do `recommendedLevel` de propósito, como a party de nível 200 do
// #526: as seis hunts nascem com TODOS os pontos de spawn vivos ao mesmo tempo (ADR 0039 decisão
// 3, sem pull por dificuldade), e o herói de teste é solo e DESARMADO — sem o kit/talento que um
// personagem real do `recommendedLevel` levaria para lá. No `recommendedLevel` exato, desarmado,
// o herói morre sem chegar a acertar um golpe (medido: nível 8 contra os Dwarf Guard reais da
// Dwarf Mines mata em ~2,4 s simulados). O ponto deste teste é o PIPELINE — mapa, rota e spawn
// reais, sem travar —, não balancear o combate de cada faixa (isso é o próximo passo do #587,
// hunt por hunt, quando o kit de cada level existir). `TEST_LEVEL = 3000` foi medido para
// garantir ao menos um abate nas seis antes de morrer (probe manual, 2026-09-28) — number
// arbitrário, só para o teste ter uma vitória a verificar.
const TEST_LEVEL = 3000;

const HUNTS: ReadonlyArray<{
  readonly id: string;
  readonly level: number;
  readonly minSpawnPoints: number;
  /** `false`: o herói de teste desarmado não mata nada ali — a luta é de `gnomprona-gardens.test.ts`. */
  readonly fights?: boolean;
}> = [
  { id: 'dwarf-mines', level: 8, minSpawnPoints: 80 },
  { id: 'cyclopolis', level: 34, minSpawnPoints: 5 },
  { id: 'minotaur-camp', level: 60, minSpawnPoints: 20 },
  { id: 'bone-crypt', level: 100, minSpawnPoints: 20 },
  { id: 'hydra-mountain', level: 150, minSpawnPoints: 18 },
  { id: 'hellhound-den', level: 250, minSpawnPoints: 15 },
  // A zona de Hazard (#632): o recorte cobre a componente central do jardim com os spawns que o
  // catálogo resolve hoje (Hulking Prehemoth e Stalking Stalk); as outras 13 espécies do Canary
  // esperam o #579 e o #622.
  { id: 'gnomprona-gardens', level: 400, minSpawnPoints: 60, fights: false },
];

describe.each(HUNTS)('a hunt real $id (#587, M36-06)', ({ id, level, minSpawnPoints, fights }) => {
  it('tem mapa, rota e pontos de spawn reais do Canary (não um recorte vazio)', () => {
    const content = real();
    const hunt = content.hunts.get(id);
    expect(hunt).toBeDefined();
    expect(hunt!.recommendedLevel).toBe(level);
    const map = content.maps.get(hunt!.mapId);
    expect(map).toBeDefined();
    const route = content.routes.get(hunt!.routeId);
    expect(route).toBeDefined();
    expect(route!.tiles.length).toBeGreaterThan(0);
    expect(route!.spawnPoints.length).toBeGreaterThanOrEqual(minSpawnPoints);
    // Todo ponto de spawn resolve para um monstro do catálogo real — `catalog:spawns` já
    // descarta o que não resolve (relatado, não fatal, #582), então isto prende regressão nesse
    // filtro, não a integridade do recorte em si.
    for (const point of route!.spawnPoints) {
      const ids = point.monsterId !== undefined ? [point.monsterId] : (point.monsters ?? []).map((m) => m.monsterId);
      expect(ids.length).toBeGreaterThan(0);
      for (const monsterId of ids) expect(content.monsters.has(monsterId)).toBe(true);
    }
  });

  it.runIf(fights !== false)('o herói entra, percorre a rota real e mata — kills e XP reais, não zero', () => {
    const { session, ruleset } = enter(real(), id, TEST_LEVEL);
    run(session, 60_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(session.aggregates.xpGained).toBeGreaterThan(0);
    expect(session.aggregates.goldGained).toBeGreaterThanOrEqual(0);
    // O walker avançou pela rota de verdade (índice válido do laço, não um valor de fallback).
    expect(ruleset.routeIndex).toBeGreaterThanOrEqual(0);
  });
});
