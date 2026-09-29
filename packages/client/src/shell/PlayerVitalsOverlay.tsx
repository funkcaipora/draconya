// O overlay circular de HP/Mana do próprio jogador (#328, RC-15). É uma segunda representação
// das mesmas vitais da coluna direita; não lê posição nem criatura do `world`, que não assina
// estado. A câmera mantém o próprio jogador no centro de `.world-stage`.

import { account } from '../account/store.js';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { ARC_DASH_OFFSET, ARC_RADIUS, ARC_TRACK_DASHARRAY, arcDasharray } from './vital-arc.js';

function Arc({ fraction, kind, flip }: { fraction: number; kind: 'hp' | 'mp'; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={`vital-arc${flip === true ? ' vital-arc-flip' : ''}`}
      aria-hidden="true"
    >
      <circle
        cx="100" cy="100" r={ARC_RADIUS} className="vital-arc-track"
        strokeDasharray={ARC_TRACK_DASHARRAY} strokeDashoffset={ARC_DASH_OFFSET}
      />
      <circle
        cx="100" cy="100" r={ARC_RADIUS} className={`vital-arc-fill vital-arc-fill-${kind}`}
        strokeDasharray={arcDasharray(fraction)} strokeDashoffset={ARC_DASH_OFFSET}
      />
    </svg>
  );
}

export function PlayerVitalsOverlay() {
  const health = useHudSlice((state) => state.health, { throttleMs: 100 });
  const maxHealth = useHudSlice((state) => state.maxHealth);
  const mana = useHudSlice((state) => state.mana, { throttleMs: 100 });
  const maxMana = useHudSlice((state) => state.maxMana);
  // Mesmo caminho de `TopBar.tsx`: a lista da conta é a fonte assinável do nome do personagem.
  const characterId = useHudSlice((state) => state.characterId);
  const characters = useStoreSlice(account, (state) => state.characters);
  const name = characters.find((character) => character.id === characterId)?.name ?? characterId ?? '—';

  const hpFraction = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
  const mpFraction = maxMana > 0 ? Math.max(0, Math.min(1, mana / maxMana)) : 0;

  return (
    <div className="player-vitals" aria-hidden="true">
      <Arc fraction={hpFraction} kind="hp" />
      <Arc fraction={mpFraction} kind="mp" flip />
      <span className="player-vitals-name">{name}</span>
    </div>
  );
}
