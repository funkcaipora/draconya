import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import type { RefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { ViewportHandle } from '../world/viewport.js';
import { startFpsPolling, WorldStatusOverlay } from './WorldStatusOverlay.js';

function fakeHandleRef(fps: number): RefObject<ViewportHandle | null> {
  return { current: { getFps: () => fps } as ViewportHandle };
}

async function render(handleRef = fakeHandleRef(0)): Promise<string> {
  const { prelude } = await prerender(createElement(WorldStatusOverlay, { handleRef }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD }));
});

describe('WorldStatusOverlay', () => {
  it('polls the handle once per second and stops polling after cleanup', () => {
    vi.useFakeTimers();
    try {
      const getFps = vi.fn(() => 57);
      const setFps = vi.fn();
      const handleRef: RefObject<ViewportHandle | null> = {
        current: { getFps } as unknown as ViewportHandle,
      };
      const stop = startFpsPolling(handleRef, setFps);

      vi.advanceTimersByTime(999);
      expect(getFps).not.toHaveBeenCalled();
      expect(setFps).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(getFps).toHaveBeenCalledTimes(1);
      expect(setFps).toHaveBeenCalledWith(57);

      stop();
      vi.advanceTimersByTime(2_000);
      expect(getFps).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the status markup and zero FPS before the first poll', async () => {
    const html = await render();

    expect(html).toContain('class="world-status"');
    expect(html).toContain('world-status-dot');
    expect(html).toContain('0 fps');
  });

  it('shows the connected dot, readable state and latency together', async () => {
    hud.set(() => ({ ...INITIAL_HUD, connection: 'connected', latencyMs: 42 }));

    const html = await render();
    expect(html).toContain('world-status-dot-connected');
    expect(html).toContain('conectado');
    expect(html).toContain('42 ms');
    expect(html).toContain('role="status"');
  });

  it('keeps a reconnection state readable without stale latency', async () => {
    hud.set(() => ({ ...INITIAL_HUD, connection: 'reconnecting', latencyMs: 42 }));

    const html = await render();
    expect(html).toContain('world-status-dot-reconnecting');
    expect(html).toContain('reconectando');
    expect(html).not.toContain('42 ms');
  });

  it.each([
    ['idle', 'desconectado'],
    ['connecting', 'conectando'],
    ['failed', 'falhou'],
  ] as const)('keeps %s legible with its matching dot', async (connection, label) => {
    hud.set(() => ({ ...INITIAL_HUD, connection, latencyMs: 42 }));

    const html = await render();
    expect(html).toContain('world-status-dot-' + connection);
    expect(html).toContain(label);
    expect(html).not.toContain('42 ms');
  });
});
