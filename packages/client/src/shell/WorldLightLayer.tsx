// A luz do explorador do mundo (#666): escurece o andar da câmera (`darknessFor`) e abre um
// círculo em volta de cada fonte de luz (`world/world-lights.ts`), com um véu da cor dela. É um
// canvas 2D por cima do Pixi — a mesma projeção de `world/camera.ts` que a camada de lugares usa —
// e só redesenha quando a câmera, a hora do dia ou os blocos de luz mudam.

import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { cameraOrigin, TILE, viewFor, zoomFor } from '../world/camera.js';
import type { ExplorerCamera } from '../world/explorer-camera.js';
import { darknessFor, lightCss } from '../world/world-lights.js';
import type { LightMap } from '../world/world-lights.js';

export function WorldLightLayer(props: {
  readonly holder: MutableRefObject<HTMLDivElement | null>;
  readonly cameraRef: MutableRefObject<ExplorerCamera>;
  readonly lights: LightMap | null;
  /** O escuro da superfície, 0 (meio-dia) a 1. O subsolo é sempre escuro. */
  readonly surface: number;
  readonly enabled: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { holder, cameraRef, lights, surface, enabled } = props;

  useEffect(() => {
    let frame = 0;
    let drawn = '';
    const loop = (): void => {
      frame = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const parent = holder.current;
      if (canvas === null || parent === null) return;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      const camera = cameraRef.current;
      const key = `${width}x${height}:${camera.x.toFixed(2)},${camera.y.toFixed(2)},${camera.z}:${surface}:${enabled}:${lights?.revision() ?? -1}`;
      if (key === drawn) return;
      drawn = key;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext('2d');
      if (context === null) return;
      context.clearRect(0, 0, width, height);
      const darkness = enabled ? darknessFor(camera.z, surface) : 0;
      if (darkness <= 0) return;

      const zoom = zoomFor(width, height);
      const view = viewFor(width, height, zoom);
      const origin = cameraOrigin(camera, view);
      const size = TILE * zoom;
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = `rgba(0, 0, 0, ${darkness})`;
      context.fillRect(0, 0, width, height);
      const radius = Math.ceil(Math.max(view.widthTiles, view.heightTiles) / 2) + 8;
      const sources = lights?.near(camera.x, camera.y, camera.z, radius) ?? [];

      // Primeiro abre o escuro, depois tinge: a luz de uma tocha é um buraco no breu com borda
      // suave, e a cor dela é um véu leve por cima do que o buraco mostrou.
      context.globalCompositeOperation = 'destination-out';
      for (const [x, y, intensity] of sources) {
        const cx = (x + 0.5 - origin.x) * size;
        const cy = (y + 0.5 - origin.y) * size;
        const r = Math.max(1, intensity) * size;
        const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, r);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = gradient;
        context.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      context.globalCompositeOperation = 'lighter';
      for (const [x, y, intensity, color] of sources) {
        const cx = (x + 0.5 - origin.x) * size;
        const cy = (y + 0.5 - origin.y) * size;
        const r = Math.max(1, intensity) * size;
        const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, r);
        gradient.addColorStop(0, lightCss(color, 0.12));
        gradient.addColorStop(1, lightCss(color, 0));
        context.fillStyle = gradient;
        context.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      context.globalCompositeOperation = 'source-over';
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); };
  }, [holder, cameraRef, lights, surface, enabled]);

  return <canvas ref={canvasRef} className="world-places-layer" aria-hidden="true" />;
}
