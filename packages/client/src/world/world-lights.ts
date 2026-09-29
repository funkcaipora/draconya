// A luz do explorador do mundo (#666): as fontes de luz por bloco (`scripts/world-lights.ts`) e a
// conta pura do que escurece. O Tibia escurece o subsolo e deixa a superfície com a luz do dia;
// cada objeto que ilumina abre um círculo de `brilho` tiles com a cor dele, da paleta de 216.

import { tibiaRgb } from './minimap.js';

export const LIGHT_BLOCK = 256;

export function lightBlockPath(z: number, bx: number, by: number): string {
  return `${z}/${bx}-${by}.json`;
}

export interface LightIndex {
  readonly format: 'draconya-lights/1';
  readonly block: number;
  readonly floors: ReadonlyArray<{ readonly z: number; readonly blocks: ReadonlyArray<readonly [number, number]> }>;
}

/** `[x, y, brilho, cor]`. */
export type LightSource = readonly [number, number, number, number];

/**
 * Quanto do escuro cobre o andar, de 0 (claro) a 1 (breu). Subsolo (z > 7) é sempre escuro —
 * só a luz dos objetos mostra o caminho; na superfície e acima, é a hora do dia que o explorador
 * escolhe (`surface`, 0 ao meio-dia).
 */
export function darknessFor(z: number, surface: number): number {
  if (z > 7) return 0.88;
  return Math.min(1, Math.max(0, surface));
}

/** A cor CSS de uma luz, com a opacidade dada. */
export function lightCss(color: number, alpha: number): string {
  const [r, g, b] = tibiaRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface LightMap {
  /** As fontes de um andar perto de `(x, y)`, pedindo os blocos que faltam. */
  near(x: number, y: number, z: number, radius: number): readonly LightSource[];
  revision(): number;
}

export function createLightMap(index: LightIndex, fetchBlock: (path: string) => Promise<readonly LightSource[] | null>): LightMap {
  const known = new Set<string>();
  for (const floor of index.floors) for (const [bx, by] of floor.blocks) known.add(lightBlockPath(floor.z, bx, by));
  const blocks = new Map<string, readonly LightSource[] | 'loading'>();
  let revision = 0;
  return {
    near(x, y, z, radius) {
      const out: LightSource[] = [];
      for (let by = Math.floor((y - radius) / LIGHT_BLOCK); by <= Math.floor((y + radius) / LIGHT_BLOCK); by += 1) {
        for (let bx = Math.floor((x - radius) / LIGHT_BLOCK); bx <= Math.floor((x + radius) / LIGHT_BLOCK); bx += 1) {
          const path = lightBlockPath(z, bx, by);
          if (!known.has(path)) continue;
          const block = blocks.get(path);
          if (block === undefined) {
            blocks.set(path, 'loading');
            void fetchBlock(path).then((list) => { blocks.set(path, list ?? []); revision += 1; });
            continue;
          }
          if (block === 'loading') continue;
          for (const light of block) if (Math.abs(light[0] - x) <= radius && Math.abs(light[1] - y) <= radius) out.push(light);
        }
      }
      return out;
    },
    revision: () => revision,
  };
}

export async function loadLightMap(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<LightMap | null> {
  const json = async (path: string): Promise<unknown> => {
    try {
      const response = await fetchFn(`${baseUrl}/world/lights/${path}`);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
  const index = await json('index.json');
  if (typeof index !== 'object' || index === null || (index as { format?: unknown }).format !== 'draconya-lights/1') return null;
  return createLightMap(index as LightIndex, async (path) => {
    const block = await json(path);
    return Array.isArray(block) ? block as LightSource[] : null;
  });
}
