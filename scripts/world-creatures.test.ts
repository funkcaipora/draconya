import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCreatures, formatCreatureFiles, parseCreatureLua, parseSpawnXml } from './world-creatures.js';

describe('parseCreatureLua', () => {
  it('lê nome e outfit de NPC e de monstro', () => {
    expect(parseCreatureLua(`local internalNpcName = "A Bearded Woman"
      npcConfig.outfit = {
        lookType = 140, lookHead = 60, lookBody = 22, lookLegs = 24, lookFeet = 32, lookAddons = 1,
      }`, 'npc')).toEqual({ name: 'A Bearded Woman', lookType: 140, head: 60, body: 22, legs: 24, feet: 32, addons: 1 });
    expect(parseCreatureLua(`local mType = Game.createMonsterType("Dragon")
      monster.outfit = { lookType = 34, lookHead = 0 }`, 'monster')).toMatchObject({ name: 'Dragon', lookType: 34 });
  });

  it('lookTypeEx (criatura desenhada como item) fica com lookType 0; sem declaração é null', () => {
    expect(parseCreatureLua('local mType = Game.createMonsterType("Box")\nmonster.outfit = { lookTypeEx = 516 }', 'monster')?.lookType).toBe(0);
    expect(parseCreatureLua('-- funções', 'monster')).toBeNull();
  });
});

describe('parseSpawnXml', () => {
  it('soma centro e deslocamento, com andar e spawntime', () => {
    expect(parseSpawnXml(`<monsters>
      <monster centerx="32146" centery="31125" centerz="0" radius="2">
        <monster name="Crystal Spider" x="-1" y="-2" z="0" spawntime="90" />
        <monster name="Wyvern" x="2" y="2" z="0" spawntime="60" />
      </monster></monsters>`, 'monster')).toEqual([
      [32145, 31123, 0, 'Crystal Spider', 90], [32148, 31127, 0, 'Wyvern', 60],
    ]);
  });
});

describe('buildCreatures', () => {
  const definitions = [
    { name: 'Rotworm', kind: 'monster' as const, lookType: 26, head: 0, body: 0, legs: 0, feet: 0, addons: 0 },
    { name: 'Buddel', kind: 'npc' as const, lookType: 143, head: 1, body: 2, legs: 3, feet: 4, addons: 0 },
  ];

  it('agrupa por bloco de 256, casa o nome sem maiúsculas e pelo nome sem sufixo', () => {
    const build = buildCreatures(definitions, [
      [33135, 32441, 8, 'rotworm', 90, 'monster'],
      [33136, 32441, 8, 'Rotworm', 90, 'monster'],
      [32000, 31000, 7, 'Buddel (Helheim)', 60, 'npc'],
      [32001, 31000, 7, 'Fantasma', 60, 'npc'],
    ]);
    expect(build.types.map((t) => [t.name, t.lookType])).toEqual([['Rotworm', 26], ['Buddel', 143], ['Fantasma', 0]]);
    expect(build.blocks.get('8/129-126.json')).toEqual([[33135, 32441, 0, 90], [33136, 32441, 0, 90]]);
    expect(build.unknown).toEqual(['npc Fantasma']);
    expect(build.index.floors).toEqual([{ z: 7, blocks: [[125, 121]] }, { z: 8, blocks: [[129, 126]] }]);
    expect(formatCreatureFiles(build).has('types.json')).toBe(true);
  });
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCK = join(ROOT, 'things', '1332', 'world', 'creatures', '8', '129-126.json');

describe.skipIf(!existsSync(BLOCK))('criaturas reais (things/)', () => {
  it('a caverna de rotworms de Darashia tem os 35 pontos de Rotworm do ADR 0025 (#511)', () => {
    const types = JSON.parse(readFileSync(join(ROOT, 'things', '1332', 'world', 'creatures', 'types.json'), 'utf8')) as Array<{ name: string }>;
    const block = JSON.parse(readFileSync(BLOCK, 'utf8')) as Array<[number, number, number, number]>;
    const inBox = block.filter(([x, y, t]) => x >= 33098 && x <= 33185 && y >= 32401 && y <= 32473 && types[t]?.name === 'Rotworm');
    expect(inBox).toHaveLength(35);
  });
});
