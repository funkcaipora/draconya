// A câmera livre do explorador do mundo (#661): puro, sem Pixi nem DOM. A tela só traduz tecla,
// arrasto e formulário em chamadas daqui.

export interface ExplorerCamera {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** O Tibia vai do andar 0 (céu) ao 15 (o mais fundo); a superfície é o 7. */
export const MIN_FLOOR = 0;
export const MAX_FLOOR = 15;

/** Onde a câmera nasce sem `#x,y,z` na URL: o templo de Thais (cidade 8 do OTBM). */
export const DEFAULT_CAMERA: ExplorerCamera = { x: 32369, y: 32241, z: 7 };

const clampFloor = (z: number): number => Math.min(MAX_FLOOR, Math.max(MIN_FLOOR, Math.round(z)));

/** Anda `dx, dy` tiles. A câmera fica em coordenada inteira na tecla e fracionária no arrasto. */
export function pan(camera: ExplorerCamera, dx: number, dy: number): ExplorerCamera {
  return { x: Math.max(0, camera.x + dx), y: Math.max(0, camera.y + dy), z: camera.z };
}

/** Sobe (`-1`) ou desce (`+1`) um andar, preso a 0–15. */
export function changeFloor(camera: ExplorerCamera, delta: number): ExplorerCamera {
  return { ...camera, z: clampFloor(camera.z + delta) };
}

/** Arrastar `dxPx, dyPx` pixels de tela move a câmera no sentido CONTRÁRIO, em tiles. */
export function dragBy(camera: ExplorerCamera, dxPx: number, dyPx: number, tilePx: number): ExplorerCamera {
  return pan(camera, -dxPx / tilePx, -dyPx / tilePx);
}

/** `32369,32241,7` (ou com espaços, ou com `#` na frente) → câmera; `null` se não for isso. */
export function parseCamera(text: string): ExplorerCamera | null {
  const parts = text.replace(/^#/, '').split(',').map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const [x, y, z] = parts.map(Number) as [number, number, number];
  if (z < MIN_FLOOR || z > MAX_FLOOR) return null;
  return { x, y, z };
}

/** A câmera como vai para a URL e para a tela: inteiros. */
export function formatCamera(camera: ExplorerCamera): string {
  return `${Math.round(camera.x)},${Math.round(camera.y)},${camera.z}`;
}
