// O overlay do canto superior esquerdo do mundo (RC-14, #327, #348, SV-12; kit v3 Hud.jsx:68-80).
// Mostra a área ativa ("Rat Cellars · Cauteloso") e contagem de criaturas no alcance durante a
// hunt, e "Cidade · zona protegida" com "a praça não credita nada" fora dela.
//
// A contagem reaproveita `battleRows` de `BattlePanel.tsx` (exclui o próprio personagem e
// membros da party) com amostragens periódicas a cada `HEALTH_POLL_MS`.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { HEALTH_POLL_MS } from './PartyMembers.js';
import { battleRows } from './BattlePanel.js';

const DIFFICULTY_TEXT: Record<string, string> = {
  cautious: 'Cauteloso',
  bold: 'Ousado',
  reckless: 'Agressivo',
};

export function WorldOverlay({ hunting }: { hunting: boolean }) {
  const huntId = useHudSlice((state) => state.huntId);
  const difficulty = useHudSlice((state) => state.difficulty);
  const catalogue = useHudSlice((state) => state.catalogue);
  const partyView = useHudSlice((state) => state.party);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!hunting) return undefined;
    const id = setInterval(() => { tick((n) => n + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, [hunting]);

  if (!hunting) {
    return (
      <div className="world-overlay" aria-label="sobreposição do mundo">
        <p className="world-overlay-line world-overlay-area">Cidade · zona protegida</p>
        <p className="world-overlay-line world-overlay-note">a praça não credita nada</p>
      </div>
    );
  }

  const partyNames = new Set(partyView?.members.map((member) => member.name) ?? []);
  const count = battleRows(partyNames).length;
  const hunt = huntId === null ? null : (catalogue?.hunts.find((h) => h.id === huntId) ?? null);
  const difficultyLabel = difficulty === null ? null : (DIFFICULTY_TEXT[difficulty] ?? null);

  return (
    <div className="world-overlay" aria-label="sobreposição do mundo">
      {hunt !== null && difficultyLabel !== null && (
        <p className="world-overlay-line world-overlay-area">{`${hunt.name} · ${difficultyLabel}`}</p>
      )}
      <p className="world-overlay-line world-overlay-note">{`${String(count)} criaturas no alcance`}</p>
    </div>
  );
}
