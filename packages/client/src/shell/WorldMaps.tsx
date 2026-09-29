// Minimapa e mapa-múndi do explorador do mundo (#662, fase 3 do `docs/world-map-plan.md`). Os dois
// desenham os blocos PNG de `things/<versão>/world/minimap/` (`scripts/world-minimap.ts`) num
// canvas 2D — sem Pixi: são imagens prontas, e o mapa-múndi não precisa de pilha nem de ordem.
// A conta de coordenadas é pura (`world/minimap.ts`); aqui é só desenhar e ouvir o ponteiro.

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import type { ExplorerCamera } from '../world/explorer-camera.js';
import {
  atlasToTile, atlasWindow, blocksCovering, isMinimapIndex, MINIMAP_BLOCK, MINIMAP_LEVELS, minimapPath,
  tilesPerBlock, tileToAtlas,
} from '../world/minimap.js';
import type { AtlasView, MinimapIndex } from '../world/minimap.js';

/** As imagens dos blocos, e o índice que diz quais existem — para nunca pedir um 404. */
export interface MinimapSource {
  readonly index: MinimapIndex;
  /** A imagem pronta, ou `null` enquanto carrega (e pede); `onLoad` avisa quando chegar. */
  image(level: number, z: number, bx: number, by: number): HTMLImageElement | null;
  onLoad(listener: () => void): () => void;
}

export async function loadMinimapSource(baseUrl: string): Promise<MinimapSource | null> {
  try {
    const response = await fetch(`${baseUrl}/world/minimap/index.json`);
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!isMinimapIndex(data)) return null;
    const known = new Set<string>();
    data.levels.forEach((floors, level) => {
      for (const floor of floors) for (const [bx, by] of floor.blocks) known.add(minimapPath(level, floor.z, bx, by));
    });
    const images = new Map<string, HTMLImageElement>();
    const listeners = new Set<() => void>();
    return {
      index: data,
      image(level, z, bx, by) {
        const path = minimapPath(level, z, bx, by);
        if (!known.has(path)) return null;
        let image = images.get(path);
        if (image === undefined) {
          image = new Image();
          image.onload = () => { for (const listener of listeners) listener(); };
          image.src = `${baseUrl}/world/minimap/${path}`;
          images.set(path, image);
        }
        return image.complete && image.naturalWidth > 0 ? image : null;
      },
      onLoad(listener) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    };
  } catch {
    return null;
  }
}

/** Desenha os blocos da vista, e a cruz da câmera por cima. */
function paint(
  canvas: HTMLCanvasElement, source: MinimapSource, view: AtlasView, z: number, camera: ExplorerCamera | null,
): void {
  const context = canvas.getContext('2d');
  if (context === null) return;
  const { width, height } = canvas;
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  const span = tilesPerBlock(view.level);
  for (const [bx, by] of blocksCovering(view.level, atlasWindow(view, width, height))) {
    const image = source.image(view.level, z, bx, by);
    if (image === null) continue;
    const at = tileToAtlas(view, width, height, bx * span, by * span);
    const size = MINIMAP_BLOCK * view.scale;
    context.drawImage(image, Math.round(at.px), Math.round(at.py), size, size);
  }
  if (camera !== null) {
    const at = tileToAtlas(view, width, height, camera.x + 0.5, camera.y + 0.5);
    context.strokeStyle = '#fff';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(at.px - 6, at.py); context.lineTo(at.px + 6, at.py);
    context.moveTo(at.px, at.py - 6); context.lineTo(at.px, at.py + 6);
    context.stroke();
  }
}

/** O minimapa do canto: nível 0 a 2×, centrado na câmera, redesenhado quando ela anda. */
export function WorldMinimap(props: {
  readonly source: MinimapSource;
  readonly cameraRef: MutableRefObject<ExplorerCamera>;
  readonly onPick: (x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { source, cameraRef, onPick } = props;

  useEffect(() => {
    let frame = 0;
    let drawn = '';
    let dirty = true;
    const off = source.onLoad(() => { dirty = true; });
    const loop = (): void => {
      const canvas = canvasRef.current;
      const camera = cameraRef.current;
      const key = `${Math.round(camera.x)},${Math.round(camera.y)},${camera.z}`;
      if (canvas !== null && (dirty || key !== drawn)) {
        drawn = key;
        dirty = false;
        paint(canvas, source, { cx: camera.x, cy: camera.y, level: 0, scale: 2 }, camera.z, camera);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); off(); };
  }, [source, cameraRef]);

  const onClick = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const camera = cameraRef.current;
    const tile = atlasToTile({ cx: camera.x, cy: camera.y, level: 0, scale: 2 }, canvas.width, canvas.height,
      (event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height));
    onPick(tile.x, tile.y);
  };

  return <canvas ref={canvasRef} className="world-minimap" width={180} height={180} onPointerDown={onClick} aria-label="Minimapa" />;
}

/** O mapa-múndi em tela cheia: zoom por nível (roda, + e −), arrastar, clicar leva a câmera. */
export function WorldAtlas(props: {
  readonly source: MinimapSource;
  readonly camera: ExplorerCamera;
  readonly onPick: (x: number, y: number) => void;
  readonly onClose: () => void;
}) {
  const { source, camera, onPick, onClose } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<AtlasView>({ cx: camera.x, cy: camera.y, level: 3, scale: 1 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [tick, setTick] = useState(0);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => source.onLoad(() => { setTick((t) => t + 1); }), [source]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    paint(canvas, source, view, camera.z, camera);
  }, [source, view, camera, tick]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'm') { onClose(); event.preventDefault(); }
      if (event.key === '+' || event.key === '=') setView((v) => ({ ...v, level: Math.max(0, v.level - 1) }));
      if (event.key === '-') setView((v) => ({ ...v, level: Math.min(MINIMAP_LEVELS - 1, v.level + 1) }));
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const tileAt = (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (canvas === null) return null;
    const rect = canvas.getBoundingClientRect();
    return atlasToTile(view, canvas.width, canvas.height, event.clientX - rect.left, event.clientY - rect.top);
  };

  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>): void => {
    const step = event.deltaY > 0 ? 1 : -1;
    setView((v) => ({ ...v, level: Math.min(MINIMAP_LEVELS - 1, Math.max(0, v.level + step)) }));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    setHover(tileAt(event));
    const last = drag.current;
    if (last === null) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (Math.abs(dx) + Math.abs(dy) < 2 && !last.moved) return;
    drag.current = { x: event.clientX, y: event.clientY, moved: true };
    const t = 2 ** view.level / view.scale;
    setView((v) => ({ ...v, cx: v.cx - dx * t, cy: v.cy - dy * t }));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const last = drag.current;
    drag.current = null;
    if (last === null || last.moved) return;
    const tile = tileAt(event);
    if (tile !== null) onPick(tile.x, tile.y);
  };

  return (
    <div className="world-atlas" role="dialog" aria-label="Mapa-múndi">
      <canvas
        ref={canvasRef}
        className="world-atlas__canvas"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { setHover(null); }}
      />
      <div className="world-atlas__bar">
        <span>andar {camera.z} · zoom {MINIMAP_LEVELS - view.level}/{MINIMAP_LEVELS}</span>
        <span>{hover === null ? '' : `${hover.x},${hover.y}`}</span>
        <button type="button" onClick={() => { setView((v) => ({ ...v, level: Math.max(0, v.level - 1) })); }}>+</button>
        <button type="button" onClick={() => { setView((v) => ({ ...v, level: Math.min(MINIMAP_LEVELS - 1, v.level + 1) })); }}>−</button>
        <button type="button" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}
