// O overlay de área e criaturas sobre o mundo (#327, RC-14; ADR 0030 decisão 3). A contagem
// reaproveita `battleRows`, a mesma exclusão do próprio personagem e da party que o painel
// Batalha já usa: nenhum campo novo de protocolo e nenhuma segunda fonte de verdade.
//
// Nome/dificuldade da hunt e o Badge de bênção ficam fora. O protocolo não transporta os dois
// primeiros e a bênção ainda não existe como sistema; o cliente não inventa nenhum deles.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { battleRows } from './BattlePanel.js';
import { HEALTH_POLL_MS } from './PartyMembers.js';

export function WorldOverlay({ hunting }: { hunting: boolean }) {
  const partyView = useHudSlice((state) => state.party);
  // `world` não possui subscribe (ADR 0007). A leitura é deliberadamente amostrada, como em
  // BattlePanel e PartyMembers, e só existe enquanto a sessão estiver em hunt.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!hunting) return undefined;
    const id = setInterval(() => { tick((current) => current + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, [hunting]);

  if (!hunting) {
    return (
      <div className="world-overlay" aria-label="área">
        <span className="world-overlay-line">Cidade · zona protegida</span>
        <span className="world-overlay-line">a praça não credita nada</span>
      </div>
    );
  }

  const partyNames = new Set(partyView?.members.map((member) => member.name) ?? []);
  const count = battleRows(partyNames).length;

  return (
    <div className="world-overlay" aria-label="área">
      <span className="world-overlay-line">{`${String(count)} criaturas no alcance`}</span>
    </div>
  );
}
