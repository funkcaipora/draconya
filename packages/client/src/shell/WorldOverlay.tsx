// O overlay do canto superior esquerdo do mundo (RC-14, #327, kit v3 Hud.jsx:68-80).
// Mostra a contagem de criaturas no alcance durante a hunt, e "Cidade · zona protegida"
// com "a praça não credita nada" fora dela.
//
// A contagem reaproveita `battleRows` de `BattlePanel.tsx` (exclui o próprio personagem e
// membros da party) com amostragens periódicas a cada `HEALTH_POLL_MS`.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { HEALTH_POLL_MS } from './PartyMembers.js';
import { battleRows } from './BattlePanel.js';

export function WorldOverlay({ hunting }: { hunting: boolean }) {
  const partyView = useHudSlice((state) => state.party);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => { tick((n) => n + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, []);

  const partyNames = new Set(partyView?.members.map((m) => m.name) ?? []);
  const mobs = battleRows(partyNames);

  return (
    <div className="world-overlay" aria-label="sobreposição do mundo">
      <p className="world-overlay-line world-overlay-area">
        {hunting
          ? `${String(mobs.length)} criaturas no alcance`
          : 'Cidade · zona protegida'}
      </p>
      {!hunting && (
        <p className="world-overlay-line world-overlay-note">
          a praça não credita nada
        </p>
      )}
    </div>
  );
}
