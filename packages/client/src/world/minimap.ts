// O minimapa do mundo (#662, fase 3 do `docs/world-map-plan.md`): a cor de cada tile é a cor de
// automapa do objeto mais alto da pilha que tem uma (`AppearanceFlags.automapColor`), como o
// minimapa do Tibia faz. O importador (`scripts/world-minimap.ts`) pinta os blocos PNG; o
// cliente só os desenha. Este módulo é o contrato dos dois: a paleta, o bloco e os níveis.
//
// Níveis como num mapa de ladrilhos: no nível 0 um pixel é um tile e o bloco de 256 px cobre
// 256×256 tiles; cada nível acima junta 2×2 pixels do de baixo, e o bloco cobre o dobro. O
// nível 5 cobre 8 192 tiles por bloco — o continente inteiro em poucos arquivos.

/** Lado do bloco PNG em pixels. */
export const MINIMAP_BLOCK = 256;
/** Níveis 0 a 5. */
export const MINIMAP_LEVELS = 6;

/** Quantos tiles um bloco cobre no nível. */
export function tilesPerBlock(level: number): number {
  return MINIMAP_BLOCK * 2 ** level;
}

/** O caminho do bloco sob `world/minimap/`, igual para quem escreve e quem busca. */
export function minimapPath(level: number, z: number, bx: number, by: number): string {
  return `${level}/${z}/${bx}-${by}.png`;
}

/**
 * A paleta de 216 cores do Tibia (6 × 6 × 6): `c = r·36 + g·6 + b`, cada canal em passos de 51.
 * É a mesma do automapa e da luz. Fora de 0–215 é preto.
 */
export function tibiaRgb(color: number): readonly [number, number, number] {
  if (!Number.isInteger(color) || color < 0 || color > 215) return [0, 0, 0];
  return [Math.floor(color / 36) * 51, (Math.floor(color / 6) % 6) * 51, (color % 6) * 51];
}

/**
 * A cor de minimapa de um tile: a do objeto mais ALTO da pilha que tem cor, senão a do chão;
 * `0` é tile sem cor (transparente). `colorOf` devolve a cor de automapa de um id, ou `undefined`.
 */
export function tileAutomapColor(
  ground: number, items: ReadonlyArray<{ readonly id: number }>, colorOf: (id: number) => number | undefined,
): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const color = colorOf((items[i] as { id: number }).id);
    if (color !== undefined && color > 0) return color;
  }
  if (ground > 0) return colorOf(ground) ?? 0;
  return 0;
}

/** O índice: `world/minimap/index.json`. */
export interface MinimapIndex {
  readonly format: 'draconya-minimap/1';
  readonly block: number;
  /** Por nível, por andar: `[bx, by]` de cada bloco que existe. */
  readonly levels: ReadonlyArray<ReadonlyArray<{ readonly z: number; readonly blocks: ReadonlyArray<readonly [number, number]> }>>;
}

export function isMinimapIndex(data: unknown): data is MinimapIndex {
  if (typeof data !== 'object' || data === null) return false;
  const index = data as Record<string, unknown>;
  return index['format'] === 'draconya-minimap/1' && index['block'] === MINIMAP_BLOCK && Array.isArray(index['levels']);
}

/** Os blocos de um nível que cobrem uma janela de tiles (inclusiva). */
export function blocksCovering(
  level: number, window: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
): Array<readonly [number, number]> {
  const span = tilesPerBlock(level);
  const out: Array<readonly [number, number]> = [];
  for (let by = Math.floor(window.minY / span); by <= Math.floor(window.maxY / span); by += 1) {
    for (let bx = Math.floor(window.minX / span); bx <= Math.floor(window.maxX / span); bx += 1) out.push([bx, by]);
  }
  return out;
}

/**
 * Uma vista do mapa-múndi: o tile no centro da tela, o nível dos blocos e quantos pixels de TELA
 * um pixel do bloco ocupa. Um pixel de bloco no nível `l` é `2^l` tiles.
 */
export interface AtlasView {
  readonly cx: number;
  readonly cy: number;
  readonly level: number;
  readonly scale: number;
}

/** Tiles por pixel de tela. */
export function tilesPerPixel(view: AtlasView): number {
  return 2 ** view.level / view.scale;
}

/** O tile sob um ponto da tela (px a partir do canto da tela de `width × height`). */
export function atlasToTile(view: AtlasView, width: number, height: number, px: number, py: number): { x: number; y: number } {
  const t = tilesPerPixel(view);
  return { x: Math.floor(view.cx + (px - width / 2) * t), y: Math.floor(view.cy + (py - height / 2) * t) };
}

/** Onde um tile cai na tela. */
export function tileToAtlas(view: AtlasView, width: number, height: number, x: number, y: number): { px: number; py: number } {
  const t = tilesPerPixel(view);
  return { px: width / 2 + (x - view.cx) / t, py: height / 2 + (y - view.cy) / t };
}

/** A janela de tiles que a tela mostra, para `blocksCovering`. */
export function atlasWindow(view: AtlasView, width: number, height: number): { minX: number; minY: number; maxX: number; maxY: number } {
  const a = atlasToTile(view, width, height, 0, 0);
  const b = atlasToTile(view, width, height, width, height);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}
