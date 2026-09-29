// A camada de lugares do explorador do mundo (#664): casas, zonas e as ligações entre andares,
// desenhadas num canvas 2D POR CIMA do Pixi, no andar da câmera. Ela usa a mesma projeção do
// viewport (`world/camera.ts`) e lê as flags e a casa de cada tile do que a cena já trouxe
// (`WorldScene.metaAt`) — nunca pede setor sozinha.

import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { cameraOrigin, TILE, viewFor, visibleTiles, zoomFor } from '../world/camera.js';
import type { ExplorerCamera } from '../world/explorer-camera.js';
import type { LinkIndex, LinkKind } from '../world/world-places.js';
import type { WorldScene } from '../world/world-scene.js';

export interface OverlayLayers {
  readonly houses: boolean;
  readonly zones: boolean;
  readonly links: boolean;
}

const PZ = 1;
const NO_LOGOUT = 8;

/** Uma cor estável por casa: casas vizinhas saem diferentes, a mesma casa sempre igual. */
function houseColor(houseId: number): string {
  const hue = (houseId * 137.508) % 360;
  return `hsla(${hue.toFixed(0)}, 70%, 55%, 0.35)`;
}

const LINK_COLOR: Readonly<Record<LinkKind, string>> = {
  stairs: '#f2d26b', ladder: '#6bd0f2', rope: '#6bd0f2', teleport: '#c36bf2',
};

export function WorldPlacesLayer(props: {
  readonly holder: MutableRefObject<HTMLDivElement | null>;
  readonly cameraRef: MutableRefObject<ExplorerCamera>;
  readonly sceneRef: MutableRefObject<WorldScene | null>;
  readonly links: LinkIndex | null;
  readonly layers: OverlayLayers;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { holder, cameraRef, sceneRef, links, layers } = props;

  useEffect(() => {
    let frame = 0;
    let drawn = '';
    const loop = (): void => {
      frame = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const parent = holder.current;
      const scene = sceneRef.current;
      if (canvas === null || parent === null) return;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      const camera = cameraRef.current;
      const key = `${width}x${height}:${camera.x.toFixed(2)},${camera.y.toFixed(2)},${camera.z}:${scene?.revision() ?? -1}`;
      if (key === drawn) return;
      drawn = key;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext('2d');
      if (context === null) return;
      context.clearRect(0, 0, width, height);
      if (scene === null) return;

      const zoom = zoomFor(width, height);
      const view = viewFor(width, height, zoom);
      const origin = cameraOrigin(camera, view);
      const size = TILE * zoom;
      const window = visibleTiles(camera, view);
      const screen = (x: number, y: number): [number, number] => [(x - origin.x) * size, (y - origin.y) * size];

      if (layers.houses || layers.zones) {
        for (let y = window.minY; y <= window.maxY; y += 1) {
          for (let x = window.minX; x <= window.maxX; x += 1) {
            const meta = scene.metaAt(x, y, camera.z);
            if (meta === null) continue;
            const [sx, sy] = screen(x, y);
            if (layers.houses && meta.houseId !== undefined) {
              context.fillStyle = houseColor(meta.houseId);
              context.fillRect(sx, sy, size, size);
            }
            if (layers.zones && (meta.flags & PZ) !== 0) {
              context.fillStyle = 'rgba(80, 220, 120, 0.18)';
              context.fillRect(sx, sy, size, size);
            }
            if (layers.zones && (meta.flags & NO_LOGOUT) !== 0) {
              context.strokeStyle = 'rgba(230, 80, 80, 0.55)';
              context.strokeRect(sx + 1, sy + 1, size - 2, size - 2);
            }
          }
        }
      }

      if (layers.links && links !== null) {
        context.font = `${Math.max(10, Math.round(size * 0.45))}px sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        for (const [from, to, kind] of links.within(camera.z, window)) {
          const [sx, sy] = screen(from[0], from[1]);
          context.fillStyle = 'rgba(0, 0, 0, 0.55)';
          context.fillRect(sx + size * 0.2, sy + size * 0.2, size * 0.6, size * 0.6);
          context.fillStyle = LINK_COLOR[kind];
          const glyph = kind === 'teleport' ? '◆' : to[2] < from[2] ? '▲' : '▼';
          context.fillText(glyph, sx + size / 2, sy + size / 2 + 1);
        }
      }
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); };
  }, [holder, cameraRef, sceneRef, links, layers]);

  return <canvas ref={canvasRef} className="world-places-layer" aria-hidden="true" />;
}
