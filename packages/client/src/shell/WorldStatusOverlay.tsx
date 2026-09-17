// Latência, FPS e estado da conexão sobre o canto inferior direito do mundo (RC-13, ADR 0030).
//
// O FPS nasce no ticker do Pixi, mas o DOM só o consulta uma vez por segundo. O valor nunca
// atravessa a rede: é apresentação local, como o estado visual da conexão.

import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { ViewportHandle } from '../world/viewport.js';
import { ConnectionBadge } from './ConnectionBadge.js';

const POLL_MS = 1_000;

export function WorldStatusOverlay({ handleRef }: {
  handleRef: RefObject<ViewportHandle | null>;
}) {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    // O Pixi monta de forma assíncrona; antes do handle existir, zero é mais verdadeiro que
    // inventar uma taxa ou deixar aparecer NaN.
    const id = setInterval(() => {
      setFps(handleRef.current?.getFps() ?? 0);
    }, POLL_MS);
    return () => { clearInterval(id); };
  }, [handleRef]);

  return (
    <div className="world-status">
      <ConnectionBadge />
      <span>{String(fps) + ' fps'}</span>
    </div>
  );
}
