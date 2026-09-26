import { describe, expect, it } from 'vitest';
import { createCreatureSource } from './world-creatures.js';
import type { CreatureIndex, CreatureSpawn, CreatureType } from './world-creatures.js';

const TYPES: CreatureType[] = [
  { name: 'Rotworm', kind: 'monster', lookType: 26, head: 0, body: 0, legs: 0, feet: 0, addons: 0 },
  { name: 'Quentin', kind: 'npc', lookType: 57, head: 1, body: 2, legs: 3, feet: 4, addons: 0 },
];
const INDEX: CreatureIndex = { format: 'draconya-creatures/1', block: 256, floors: [{ z: 7, blocks: [[126, 125]] }] };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createCreatureSource', () => {
  it('pede o bloco perto da câmera e entrega criaturas paradas, com outfit e cores', async () => {
    const asked: string[] = [];
    const spawns: CreatureSpawn[] = [[32369, 32241, 1, 60], [32300, 32241, 0, 90]];
    const source = createCreatureSource(INDEX, TYPES, async (path) => { asked.push(path); return spawns; });
    expect(source.near(32369, 32241, 7, 10)).toEqual([]);
    expect(asked).toEqual(['7/126-125.json']);
    await tick();
    const near = source.near(32369, 32241, 7, 10);
    // Quentin entra; o Rotworm a 69 tiles fica fora do raio + margem (30).
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ appearanceId: 57, name: 'Quentin', position: { x: 32369, y: 32241, z: 7 }, step: null, colors: { head: 1, body: 2, legs: 3, feet: 4 } });
    expect(source.describe(near[0]?.id as number)).toEqual({ type: TYPES[1], spawntime: 60 });
  });

  it('não pede bloco que o índice não tem, nem o mesmo duas vezes', () => {
    const asked: string[] = [];
    const source = createCreatureSource(INDEX, TYPES, async (path) => { asked.push(path); return []; });
    source.near(1000, 1000, 7, 10);
    source.near(32369, 32241, 7, 10);
    source.near(32370, 32241, 7, 10);
    expect(asked).toEqual(['7/126-125.json']);
  });
});
