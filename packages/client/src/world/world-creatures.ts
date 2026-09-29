// As criaturas do mundo para o explorador (#665): NPCs e pontos de spawn do Canary, com o outfit de
// quem nasce ali (`scripts/world-creatures.ts`). Aqui mora o contrato dos arquivos e a fonte que
// o viewport consulta a cada quadro — só as criaturas perto da câmera, buscadas por bloco.
// Puro quanto ao DOM: o `fetch` entra por parâmetro.

import type { Creature } from '../state/world.js';

/** Lado do bloco de criaturas, em tiles. */
export const CREATURE_BLOCK = 256;

export function creatureBlockPath(z: number, bx: number, by: number): string {
  return `${z}/${bx}-${by}.json`;
}

export interface CreatureType {
  readonly name: string;
  readonly kind: 'npc' | 'monster';
  /** `0` quando a criatura é desenhada como item (`lookTypeEx`) ou não tem `.lua`. */
  readonly lookType: number;
  readonly head: number;
  readonly body: number;
  readonly legs: number;
  readonly feet: number;
  readonly addons: number;
}

export interface CreatureIndex {
  readonly format: 'draconya-creatures/1';
  readonly block: number;
  readonly floors: ReadonlyArray<{ readonly z: number; readonly blocks: ReadonlyArray<readonly [number, number]> }>;
}

/** `[x, y, tipo, spawntime]`. */
export type CreatureSpawn = readonly [number, number, number, number];

/** Quanto além da tela as criaturas entram: meio bloco basta para a borda não piscar. */
const MARGIN = 20;

export interface CreatureSource {
  readonly types: readonly CreatureType[];
  /** As criaturas perto de `(x, y, z)`, como o viewport as desenha — paradas, vida cheia. */
  near(x: number, y: number, z: number, radius: number): readonly Creature[];
  /** O tipo e o spawntime de uma criatura desenhada, pelo id que `near` deu. */
  describe(id: number): { readonly type: CreatureType; readonly spawntime: number } | null;
  /** Sobe quando um bloco chega: quem desenha sabe que precisa pedir `near` de novo. */
  revision(): number;
}

export function createCreatureSource(
  index: CreatureIndex, types: readonly CreatureType[], fetchBlock: (path: string) => Promise<readonly CreatureSpawn[] | null>,
): CreatureSource {
  const known = new Set<string>();
  for (const floor of index.floors) for (const [bx, by] of floor.blocks) known.add(creatureBlockPath(floor.z, bx, by));
  const blocks = new Map<string, readonly Creature[] | 'loading'>();
  const meta = new Map<number, { type: CreatureType; spawntime: number }>();
  let nextId = 1;
  let revision = 0;
  let cacheKey = '';
  let cache: readonly Creature[] = [];

  const load = (path: string, z: number): void => {
    blocks.set(path, 'loading');
    void fetchBlock(path).then((spawns) => {
      const creatures: Creature[] = [];
      for (const [x, y, typeIndex, spawntime] of spawns ?? []) {
        const type = types[typeIndex];
        if (type === undefined) continue;
        const id = nextId;
        nextId += 1;
        meta.set(id, { type, spawntime });
        creatures.push({
          id, appearanceId: type.lookType, name: type.name, health: 100, maxHealth: 100,
          colors: { head: type.head, body: type.body, legs: type.legs, feet: type.feet },
          position: { x, y, z }, step: null,
        });
      }
      blocks.set(path, creatures);
      revision += 1;
    });
  };

  return {
    types,
    near(x, y, z, radius) {
      const key = `${Math.round(x)},${Math.round(y)},${z},${radius}:${revision}`;
      if (key === cacheKey) return cache;
      const span = radius + MARGIN;
      const out: Creature[] = [];
      for (let by = Math.floor((y - span) / CREATURE_BLOCK); by <= Math.floor((y + span) / CREATURE_BLOCK); by += 1) {
        for (let bx = Math.floor((x - span) / CREATURE_BLOCK); bx <= Math.floor((x + span) / CREATURE_BLOCK); bx += 1) {
          const path = creatureBlockPath(z, bx, by);
          if (!known.has(path)) continue;
          const block = blocks.get(path);
          if (block === undefined) { load(path, z); continue; }
          if (block === 'loading') continue;
          for (const creature of block) {
            if (Math.abs(creature.position.x - x) <= span && Math.abs(creature.position.y - y) <= span) out.push(creature);
          }
        }
      }
      cacheKey = key;
      cache = out;
      return out;
    },
    describe: (id) => meta.get(id) ?? null,
    revision: () => revision,
  };
}

export async function loadCreatureSource(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<CreatureSource | null> {
  const json = async (path: string): Promise<unknown> => {
    try {
      const response = await fetchFn(`${baseUrl}/world/creatures/${path}`);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
  const [index, types] = await Promise.all([json('index.json'), json('types.json')]);
  if (typeof index !== 'object' || index === null || (index as { format?: unknown }).format !== 'draconya-creatures/1') return null;
  if (!Array.isArray(types)) return null;
  return createCreatureSource(index as CreatureIndex, types as CreatureType[], async (path) => {
    const block = await json(path);
    return Array.isArray(block) ? block as CreatureSpawn[] : null;
  });
}
