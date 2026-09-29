// Lugares e ligações do mundo, para o explorador (#664, fase 4 do `docs/world-map-plan.md`):
// cidades com templo, waypoints e casas (`world/places.json`, `scripts/world-places.ts`), e as
// escadas, cordas e teleportes derivados (`world/links.json`, `scripts/world-links.ts`, #663).
// Puro: o `fetch` entra por parâmetro.

export type Point3 = readonly [number, number, number];
export type LinkKind = 'stairs' | 'ladder' | 'rope' | 'teleport';

export interface WorldPlaces {
  readonly format: 'draconya-places/1';
  readonly towns: ReadonlyArray<{ readonly id: number; readonly name: string; readonly temple: Point3 }>;
  readonly waypoints: ReadonlyArray<{ readonly name: string; readonly position: Point3 }>;
  readonly houses: ReadonlyArray<{
    readonly id: number; readonly name: string; readonly entry: Point3;
    readonly townId: number; readonly size: number; readonly guildhall: boolean;
  }>;
}

export interface WorldLinksFile {
  readonly format: 'draconya-links/1';
  readonly links: ReadonlyArray<readonly [Point3, Point3, LinkKind]>;
  readonly doors: ReadonlyArray<readonly [number, number, number, number]>;
}

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** O índice das ligações: por tile de origem, e por andar para desenhar os marcadores. */
export interface LinkIndex {
  from(x: number, y: number, z: number): { readonly to: Point3; readonly kind: LinkKind } | null;
  /** As ligações que saem de um andar dentro de uma janela de tiles. */
  within(z: number, window: { minX: number; minY: number; maxX: number; maxY: number }): Array<readonly [Point3, Point3, LinkKind]>;
  doorAt(x: number, y: number, z: number): boolean;
}

export function indexLinks(file: WorldLinksFile): LinkIndex {
  const byFrom = new Map<string, { to: Point3; kind: LinkKind }>();
  const byFloor = new Map<number, Array<readonly [Point3, Point3, LinkKind]>>();
  for (const link of file.links) {
    const [from, to, kind] = link;
    // O primeiro vence: escada e teleporte no mesmo tile é raro, e a escada é o que se pisa.
    if (!byFrom.has(key(from[0], from[1], from[2]))) byFrom.set(key(from[0], from[1], from[2]), { to, kind });
    let list = byFloor.get(from[2]);
    if (list === undefined) { list = []; byFloor.set(from[2], list); }
    list.push(link);
  }
  const doors = new Set(file.doors.map(([x, y, z]) => key(x, y, z)));
  return {
    from: (x, y, z) => byFrom.get(key(x, y, z)) ?? null,
    within(z, window) {
      return (byFloor.get(z) ?? []).filter(([from]) =>
        from[0] >= window.minX && from[0] <= window.maxX && from[1] >= window.minY && from[1] <= window.maxY);
    },
    doorAt: (x, y, z) => doors.has(key(x, y, z)),
  };
}

async function loadJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  try {
    const response = await fetchFn(url);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function loadWorldPlaces(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<WorldPlaces | null> {
  const data = await loadJson(`${baseUrl}/world/places.json`, fetchFn);
  return typeof data === 'object' && data !== null && (data as { format?: unknown }).format === 'draconya-places/1'
    ? data as WorldPlaces : null;
}

export async function loadWorldLinks(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<LinkIndex | null> {
  const data = await loadJson(`${baseUrl}/world/links.json`, fetchFn);
  return typeof data === 'object' && data !== null && (data as { format?: unknown }).format === 'draconya-links/1'
    ? indexLinks(data as WorldLinksFile) : null;
}
