// O explorador do mundo (#661, fase 2 do `docs/world-map-plan.md`): o mapa inteiro do Tibia no
// navegador, com câmera livre, sem sessão e sem WebSocket — só `/things/`. Reaproveita o
// viewport do jogo inteiro (M23, ADR 0034): a cena é a do mundo em setores (`world-scene.ts`,
// ADR 0047), e a câmera vem daqui em vez do personagem (`ViewportOptions.camera`).
//
// Nada aqui manda intenção (invariante 4): o explorador não conhece `net/`.

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import { TextureBook } from '../world/textures.js';
import { TILE, zoomFor } from '../world/camera.js';
import {
  changeFloor, DEFAULT_CAMERA, dragBy, formatCamera, pan, parseCamera,
} from '../world/explorer-camera.js';
import type { ExplorerCamera } from '../world/explorer-camera.js';
import { mountViewport } from '../world/viewport.js';
import type { ViewportHandle } from '../world/viewport.js';
import { createWorldScene, loadWorldIndex, sectorFetcher } from '../world/world-scene.js';
import type { WorldScene } from '../world/world-scene.js';
import { useBrowserPack } from './useBrowserPack.js';
import { loadMinimapSource, WorldAtlas, WorldMinimap } from './WorldMaps.js';
import type { MinimapSource } from './WorldMaps.js';

/** O explorador existe em desenvolvimento, ou onde o deploy o liga. */
export function worldExplorerEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_WORLD_EXPLORER === 'true';
}

/** Tecla → passo da câmera. Shift anda oito tiles por vez. */
const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
};

type Status = 'loading' | 'ready' | 'missing';

export function WorldExplorer() {
  const holder = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ViewportHandle | null>(null);
  const bookRef = useRef<TextureBook | null>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const initial = parseCamera(window.location.hash) ?? DEFAULT_CAMERA;
  /** A câmera de verdade vive numa ref: o laço do Pixi a lê a cada quadro, sem render de React. */
  const cameraRef = useRef<ExplorerCamera>(initial);
  const [camera, setCameraState] = useState<ExplorerCamera>(initial);
  const [status, setStatus] = useState<Status>('loading');
  const [stats, setStats] = useState({ loaded: 0, pending: 0, fps: 0 });
  const [goto, setGoto] = useState(formatCamera(initial));
  const [minimap, setMinimap] = useState<MinimapSource | null>(null);
  const [atlasOpen, setAtlasOpen] = useState(false);
  /** O teclado do explorador para quando o mapa-múndi está aberto — ele tem o dele. */
  const atlasOpenRef = useRef(false);
  atlasOpenRef.current = atlasOpen;
  const loaded = useBrowserPack();

  const setCamera = (next: ExplorerCamera): void => {
    cameraRef.current = next;
    setCameraState(next);
  };

  // A URL guarda onde se está: recarregar ou mandar o link volta ao mesmo ponto.
  useEffect(() => {
    const text = formatCamera(camera);
    if (window.location.hash !== `#${text}`) window.history.replaceState(null, '', `#${text}`);
  }, [camera]);

  // E colar outro `#x,y,z` com a página aberta leva até lá — trocar só o hash não recarrega.
  useEffect(() => {
    const onHash = (): void => {
      const next = parseCamera(window.location.hash);
      if (next === null) return;
      setCamera(next);
      setGoto(formatCamera(next));
    };
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('hashchange', onHash); };
  }, []);

  useEffect(() => {
    const parent = holder.current;
    if (parent === null) return undefined;
    let cancelled = false;
    const book = new TextureBook();
    bookRef.current = book;
    const baseUrl = import.meta.env.VITE_THINGS_URL;

    void (async () => {
      const mounted = await mountViewport(parent, { pack: null, book, camera: () => cameraRef.current });
      if (cancelled) { mounted.destroy(); return; }
      handleRef.current = mounted;
      if (loaded !== null) mounted.setPack(loaded.pack);
      const index = baseUrl === undefined || baseUrl === '' ? null : await loadWorldIndex(baseUrl);
      if (cancelled) return;
      if (index === null || baseUrl === undefined) { setStatus('missing'); return; }
      const scene = createWorldScene(index, { fetchSector: sectorFetcher(baseUrl) });
      sceneRef.current = scene;
      mounted.setScene(scene);
      setStatus('ready');
      const source = await loadMinimapSource(baseUrl);
      if (!cancelled) setMinimap(source);
    })();

    const timer = setInterval(() => {
      const scene = sceneRef.current;
      setStats({
        loaded: scene?.loadedSectors() ?? 0,
        pending: scene?.pendingSectors() ?? 0,
        fps: handleRef.current?.getFps() ?? 0,
      });
    }, 500);

    return () => {
      cancelled = true;
      clearInterval(timer);
      handleRef.current?.destroy();
      handleRef.current = null;
      bookRef.current = null;
      sceneRef.current = null;
    };
    // O pacote entra pelo efeito de baixo; montar de novo quando ele chega recriaria o canvas.
  }, []);

  useEffect(() => {
    if (loaded === null) return undefined;
    const book = bookRef.current;
    const unsubscribe = book === null ? null : loaded.subscribeEvictions((bitmap) => { book.forget(bitmap); });
    handleRef.current?.setPack(loaded.pack);
    return () => {
      unsubscribe?.();
      handleRef.current?.setPack(null);
    };
  }, [loaded]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.isContentEditable)) return;
      if (atlasOpenRef.current) return;
      if (event.key === 'm') { setAtlasOpen(true); event.preventDefault(); return; }
      const step = PAN_KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (step !== undefined) {
        const scale = event.shiftKey ? 8 : 1;
        setCamera(pan(roundCamera(cameraRef.current), step[0] * scale, step[1] * scale));
        event.preventDefault();
        return;
      }
      if (event.key === 'PageUp' || event.key === 'q') { setCamera(changeFloor(cameraRef.current, -1)); event.preventDefault(); }
      if (event.key === 'PageDown' || event.key === 'e') { setCamera(changeFloor(cameraRef.current, 1)); event.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, []);

  /** O arrasto: a última posição do ponteiro enquanto o botão está apertado. */
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof HTMLCanvasElement)) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const last = dragRef.current;
    if (last === null) return;
    const parent = holder.current;
    const tilePx = TILE * (parent === null ? 1 : zoomFor(parent.clientWidth, parent.clientHeight));
    dragRef.current = { x: event.clientX, y: event.clientY };
    // O arrasto escreve só na ref: é o laço do Pixi que lê. O estado de React acompanha no soltar.
    cameraRef.current = dragBy(cameraRef.current, event.clientX - last.x, event.clientY - last.y, tilePx);
  };
  const onPointerUp = (): void => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    setCamera(roundCamera(cameraRef.current));
  };

  const pick = (x: number, y: number): void => {
    const next = { x, y, z: cameraRef.current.z };
    setCamera(next);
    setGoto(formatCamera(next));
  };

  const onGoto = (event: FormEvent): void => {
    event.preventDefault();
    const next = parseCamera(goto);
    if (next !== null) setCamera(next);
  };

  return (
    <div className="world-explorer">
      <div
        className="viewport"
        ref={holder}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <aside className="world-explorer__panel">
        <h1 className="world-explorer__title">Mapa do mundo</h1>
        <p className="world-explorer__coords" data-testid="explorer-coords">{formatCamera(camera)}</p>
        <div className="world-explorer__floors">
          <button type="button" onClick={() => { setCamera(changeFloor(cameraRef.current, -1)); }}>Subir</button>
          <span>andar {camera.z}</span>
          <button type="button" onClick={() => { setCamera(changeFloor(cameraRef.current, 1)); }}>Descer</button>
        </div>
        <form className="world-explorer__goto" onSubmit={onGoto}>
          <input aria-label="Ir para x,y,z" value={goto} onChange={(event) => { setGoto(event.target.value); }} />
          <button type="submit">Ir</button>
        </form>
        <p className="world-explorer__stats">
          {status === 'missing'
            ? 'Mundo não gerado: rode pnpm map:world'
            : `${stats.loaded} setores · ${stats.pending} a caminho · ${stats.fps} fps`}
        </p>
        {minimap !== null && (
          <>
            <WorldMinimap source={minimap} cameraRef={cameraRef} onPick={pick} />
            <button type="button" onClick={() => { setAtlasOpen(true); }}>Mapa-múndi (M)</button>
          </>
        )}
        <p className="world-explorer__help">Setas/WASD andam (Shift ×8) · arraste · Q/E ou PgUp/PgDn trocam de andar</p>
      </aside>
      {atlasOpen && minimap !== null && (
        <WorldAtlas
          source={minimap}
          camera={camera}
          onPick={(x, y) => { pick(x, y); setAtlasOpen(false); }}
          onClose={() => { setAtlasOpen(false); }}
        />
      )}
    </div>
  );
}

function roundCamera(camera: ExplorerCamera): ExplorerCamera {
  return { x: Math.round(camera.x), y: Math.round(camera.y), z: camera.z };
}
