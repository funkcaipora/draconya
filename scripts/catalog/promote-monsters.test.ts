import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readGeneratedSlice } from './generated-writer.js';
import {
  checkPromotion, computePromotion, HAND_AUTHORED_MONSTER_IDS, readItemCatalog, writePromotion,
} from './promote-monsters.js';

const SOURCE = { engine: 'canary' as const, commit: 'a'.repeat(40), path: 'data-otservbr-global/monster/mammals/badger.lua' };

let workdir: string | undefined;

afterEach(() => {
  if (workdir !== undefined) { rmSync(workdir, { recursive: true, force: true }); workdir = undefined; }
});

/** Monta um checkout sintético mínimo: staging de monstros + catálogo de itens + os dois
 *  `baseline.json` que a promoção mescla. */
function setupFixture(root: string, monsters: Record<string, unknown[]>): void {
  const stagingDir = join(root, 'packages/content/staging/monsters/generated');
  mkdirSync(stagingDir, { recursive: true });
  for (const [slice, entities] of Object.entries(monsters)) {
    writeFileSync(join(stagingDir, `${slice}.json`), JSON.stringify(entities, null, 2));
  }
  const itemsDir = join(root, 'packages/content/data/items');
  mkdirSync(itemsDir, { recursive: true });
  writeFileSync(join(itemsDir, 'cheese.json'), JSON.stringify({ id: 'cheese', name: 'Cheese', stackable: true }));
  writeFileSync(join(itemsDir, 'sword.json'), JSON.stringify({ id: 'sword', name: 'Sword', stackable: false }));

  const appearancesDir = join(root, 'packages/content/data/appearances');
  mkdirSync(appearancesDir, { recursive: true });
  writeFileSync(join(appearancesDir, 'baseline.json'), JSON.stringify({
    id: 'baseline', pack: 'tibia-1332', monsters: { rat: 21, rotworm: 26, dragon: 34, 'dragon-lord': 39 }, items: {},
  }, null, 2));

  const bestiaryDir = join(root, 'packages/content/data/bestiary');
  mkdirSync(bestiaryDir, { recursive: true });
  writeFileSync(join(bestiaryDir, 'baseline.json'), JSON.stringify({
    id: 'baseline',
    milestones: [10000],
    xpBonusPercentPerMilestone: 1,
    entries: {
      dragon: {
        class: 'dragon', race: 'dragon', toKill: 1000, firstUnlock: 50, secondUnlock: 500, charmsPoints: 25, stars: 3, occurrence: 0,
      },
    },
  }, null, 2));
}

function badger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'badger',
    name: 'Badger',
    class: 'mammal',
    health: 23,
    experience: 5,
    attack: { min: 0, max: 12 },
    armor: 1,
    attackIntervalMs: 2000,
    speed: 140,
    aggroRadius: 11,
    blockable: false,
    loot: {
      rollModel: 'canary',
      items: [
        { itemId: 'cheese', chance: 0.4 },
        { itemId: 'beetroot', chance: 0.1 },
      ],
    },
    source: SOURCE,
    bestiary: {
      class: 'mammal', race: 'mammal', raceId: 105, toKill: 250, firstUnlock: 10, secondUnlock: 100, charmsPoints: 5, stars: 1, occurrence: 0,
    },
    outfitId: 105,
    ...overrides,
  };
}

describe('HAND_AUTHORED_MONSTER_IDS', () => {
  it('é exatamente rat, rotworm, dragon, dragon-lord e dragon-lord-hatchling (#581, #560/#785)', () => {
    // dragon-lord-hatchling entrou no #560 (a mesma cadeia hand-authored de estágios de campo
    // que dragon-lord já tinha) — sem ele aqui, a primeira promoção depois do merge reescrevia
    // a fatia com a staging fresca, sem `stages`, apagando o trabalho do #560 em silêncio (#785).
    expect([...HAND_AUTHORED_MONSTER_IDS].sort()).toEqual([
      'dragon', 'dragon-lord', 'dragon-lord-hatchling', 'rat', 'rotworm',
    ]);
  });
});

describe('readItemCatalog', () => {
  it('lê autoral, generated/ e overrides/ como o load.ts faz para qualquer data/<tipo>', () => {
    workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
    const itemsDir = join(workdir, 'items');
    mkdirSync(join(itemsDir, 'generated'), { recursive: true });
    mkdirSync(join(itemsDir, 'overrides'), { recursive: true });
    writeFileSync(join(itemsDir, 'cheese.json'), JSON.stringify({ id: 'cheese', stackable: true }));
    writeFileSync(join(itemsDir, 'generated', 'slice.json'), JSON.stringify([{ id: 'beetroot', stackable: true }]));
    writeFileSync(join(itemsDir, 'overrides', 'beetroot.json'), JSON.stringify({
      id: 'beetroot', reason: 'teste', patch: { stackable: false },
    }));

    const catalog = readItemCatalog(itemsDir);

    expect(catalog.get('cheese')).toEqual({ stackable: true });
    // O override derruba `stackable` para false — a mesma prevalência que load.ts dá à correção.
    expect(catalog.get('beetroot')).toEqual({ stackable: false });
    expect(catalog.has('acorn')).toBe(false);
  });
});

describe('computePromotion', () => {
  it('separa bestiary/outfitId da entidade e os move para os dois destinos certos', () => {
    workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
    setupFixture(workdir, { mammals: [badger()] });

    const result = computePromotion(workdir);

    const promoted = result.slices.get('mammals');
    expect(promoted).toHaveLength(1);
    expect(promoted?.[0]).not.toHaveProperty('bestiary');
    expect(promoted?.[0]).not.toHaveProperty('outfitId');
    expect(promoted?.[0]?.['id']).toBe('badger');
    expect(result.appearanceEntries.get('badger')).toBe(105);
    expect(result.bestiaryEntries.get('badger')).toMatchObject({ class: 'mammal', toKill: 250 });
  });

  describe('outfit (#621, M44-03)', () => {
    const outfitAbility = (look: Record<string, string>) => ({
      id: 'outfit', cadenceMs: 2000, chance: 0.1, target: { range: 11 }, power: 0, damageType: 'physical',
      condition: { key: 'outfit', merge: 'strongest', durationMs: 4000, effect: { kind: 'outfit', look } },
    });

    it('`objectLooks` (staging-only) sai da entidade e vira as linhas de `appearances.looks`', () => {
      workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
      setupFixture(workdir, {
        mammals: [
          badger({ abilities: [outfitAbility({ objectKey: 'fallen-tree' })], objectLooks: { 'fallen-tree': 3976 } }),
          badger({ id: 'stoat', name: 'Stoat', outfitId: 106, objectLooks: { 'fallen-tree': 3976, snowman: 7172 } }),
        ],
      });
      const result = computePromotion(workdir);
      expect(result.slices.get('mammals')?.every((entity) => !('objectLooks' in entity))).toBe(true);
      expect([...result.lookEntries.entries()].sort()).toEqual([['fallen-tree', 3976], ['snowman', 7172]]);
    });

    it('dois monstros que pedem ids DIFERENTES para a mesma chave de objeto são um erro, não uma escolha calada', () => {
      workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
      setupFixture(workdir, {
        mammals: [
          badger({ objectLooks: { table: 2324 } }),
          badger({ id: 'stoat', name: 'Stoat', outfitId: 106, objectLooks: { table: 9999 } }),
        ],
      });
      expect(() => computePromotion(workdir as string)).toThrow(/appearances\.looks "table"/);
    });

    it('tira o `outfit` cujo monstro imitado NÃO foi promovido — e mantém o dos que foram (inclusive os autorais)', () => {
      workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
      setupFixture(workdir, {
        mammals: [
          badger({
            abilities: [
              outfitAbility({ monsterId: 'stoat' }), outfitAbility({ monsterId: 'rat' }),
              outfitAbility({ monsterId: 'never-generated' }),
            ],
          }),
          badger({ id: 'stoat', name: 'Stoat', outfitId: 106 }),
        ],
      });
      const result = computePromotion(workdir);
      const kept = result.slices.get('mammals')?.find((entity) => entity.id === 'badger')?.['abilities'] as
        { condition: { effect: { look: { monsterId: string } } } }[];
      expect(kept.map((ability) => ability.condition.effect.look.monsterId)).toEqual(['stoat', 'rat']);
      expect([...result.strippedOutfits.entries()]).toEqual([['badger', 1]]);
    });
  });

  it('nunca promove rat/rotworm/dragon/dragon-lord — mesmo se o Canary os gerar (#581)', () => {
    workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
    setupFixture(workdir, {
      mammals: [badger({ id: 'rat', name: 'Rat' })],
    });

    const result = computePromotion(workdir);

    expect(result.slices.get('mammals')).toEqual([]);
    expect(result.skipped).toContainEqual({ id: 'rat', reason: expect.stringContaining('#581') });
  });

  it('remove linha de loot cujo itemId não existe no catálogo, e conta', () => {
    workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
    setupFixture(workdir, { mammals: [badger()] });

    const result = computePromotion(workdir);

    const promoted = result.slices.get('mammals')?.[0] as unknown as { loot: { items: readonly { itemId: string }[] } };
    expect(promoted.loot.items.map((line) => line.itemId)).toEqual(['cheese']);
    expect(result.droppedLootLines).toContainEqual({
      monsterId: 'badger', itemId: 'beetroot', reason: expect.stringContaining('ausente'),
    });
  });

  it('remove linha "canary" com max > 1 de item que não empilha, e conta', () => {
    workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
    setupFixture(workdir, {
      mammals: [badger({
        loot: { rollModel: 'canary', items: [{ itemId: 'sword', chance: 0.5, max: 2 }] },
      })],
    });

    const result = computePromotion(workdir);

    const promoted = result.slices.get('mammals')?.[0] as unknown as { loot: { items: readonly unknown[] } };
    expect(promoted.loot.items).toEqual([]);
    expect(result.droppedLootLines).toContainEqual({
      monsterId: 'badger', itemId: 'sword', reason: expect.stringContaining('não empilha'),
    });
  });

  it('não promove monstro cujo summons.entries repete o mesmo monsterId (chances diferentes)', () => {
    workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
    setupFixture(workdir, {
      quests: [badger({
        id: 'conjurer',
        summons: {
          max: 5,
          entries: [
            { monsterId: 'minion', intervalMs: 2000, chance: 0.2, count: 1 },
            { monsterId: 'minion', intervalMs: 2000, chance: 0.3, count: 1 },
          ],
        },
      })],
    });

    const result = computePromotion(workdir);

    expect(result.slices.get('quests')).toEqual([]);
    expect(result.skipped).toContainEqual({ id: 'conjurer', reason: expect.stringContaining('summons.entries') });
  });
});

describe('writePromotion / checkPromotion', () => {
  it('escreve generated/, mescla os dois baseline.json e o relatório — idempotente', () => {
    workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
    setupFixture(workdir, { mammals: [badger()] });

    writePromotion(workdir);

    const generated = readGeneratedSlice(join(workdir, 'packages/content/data/monsters/generated/mammals.json'));
    expect(generated).toHaveLength(1);

    const appearances = JSON.parse(readFileSync(join(workdir, 'packages/content/data/appearances/baseline.json'), 'utf8'));
    expect(appearances.monsters).toMatchObject({ rat: 21, dragon: 34, badger: 105 });

    const bestiary = JSON.parse(readFileSync(join(workdir, 'packages/content/data/bestiary/baseline.json'), 'utf8'));
    expect(bestiary.entries).toHaveProperty('badger');
    expect(bestiary.entries).toHaveProperty('dragon'); // hand-authored, preservado

    const outcomes = checkPromotion(workdir);
    expect(outcomes.every((o) => o.status === 'fresh')).toBe(true);
  });

  it('rodar de novo depois de um monstro deixar de ser promovido REMOVE a linha órfã (não acumula)', () => {
    workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
    setupFixture(workdir, { mammals: [badger()] });
    writePromotion(workdir);

    // Na rodada seguinte, badger não é mais gerado (por ex.: o Canary o removeu do corte).
    setupFixture(workdir, { mammals: [] });
    writePromotion(workdir);

    const appearances = JSON.parse(readFileSync(join(workdir, 'packages/content/data/appearances/baseline.json'), 'utf8'));
    expect(appearances.monsters).not.toHaveProperty('badger');
    expect(appearances.monsters).toMatchObject({ rat: 21, dragon: 34 });

    const bestiary = JSON.parse(readFileSync(join(workdir, 'packages/content/data/bestiary/baseline.json'), 'utf8'));
    expect(bestiary.entries).not.toHaveProperty('badger');
  });

  it('preserva Rat já commitado em generated/mammals.json entre duas rodadas (#581)', () => {
    workdir = mkdtempSync(join(tmpdir(), 'promote-monsters-'));
    setupFixture(workdir, { mammals: [badger()] });
    // Simula o estado pós-#581: Rat já vive em generated/mammals.json, colocado por aquela
    // issue — nunca pela promoção. `rat` também está em HAND_AUTHORED_MONSTER_IDS, então
    // `computePromotion` nunca o devolve em `slices`, mesmo que a fixture do Canary abaixo o
    // reintroduza em staging (o que aconteceria numa reimportação futura de verdade).
    setupFixture(workdir, {
      mammals: [badger(), badger({ id: 'rat', name: 'Rat' })],
    });
    const monstersGeneratedDir = join(workdir, 'packages/content/data/monsters/generated');
    mkdirSync(monstersGeneratedDir, { recursive: true });
    const { bestiary: _bestiary, outfitId: _outfitId, ...ratOnDisk } = badger({ id: 'rat', name: 'Rat' });
    writeFileSync(
      join(monstersGeneratedDir, 'mammals.json'),
      JSON.stringify([{ ...ratOnDisk, blockable: false }], null, 2),
    );

    writePromotion(workdir);

    const generated = readGeneratedSlice(join(monstersGeneratedDir, 'mammals.json'));
    expect(generated.map((e) => e.id).sort()).toEqual(['badger', 'rat']);
    // Rat continua vindo do que já estava em disco (#581), não da reimportação do Canary —
    // `computePromotion` nunca promove um id de `HAND_AUTHORED_MONSTER_IDS`.
    expect(generated.find((e) => e.id === 'rat')).not.toHaveProperty('bestiary');

    const outcomes = checkPromotion(workdir);
    expect(outcomes.find((o) => o.slice === 'mammals')).toEqual({ slice: 'mammals', status: 'fresh' });

    // Rodar de novo, sem nada mudar, não apaga nem duplica o Rat preservado.
    writePromotion(workdir);
    const generatedAgain = readGeneratedSlice(join(monstersGeneratedDir, 'mammals.json'));
    expect(generatedAgain.map((e) => e.id).sort()).toEqual(['badger', 'rat']);
  });
});
