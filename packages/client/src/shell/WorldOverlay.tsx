// O overlay de área e criaturas sobre o mundo (#327, #348, RC-14, SV-12; ADR 0030 decisão 3). A
// contagem reaproveita `battleRows`, a mesma exclusão do próprio personagem e da party que o
// painel Batalha já usa: nenhum campo novo de protocolo e nenhuma segunda fonte de verdade.
//
// O nome da hunt e a dificuldade vêm de `hud.huntId`/`hud.difficulty` (SV-05), cruzados com
// `catalogue.hunts[]` pelo NOME — o id sozinho não é apresentável. O Badge de bênção fica fora:
// a bênção ainda não existe como sistema, e o cliente não inventa um.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { battleRows } from './BattlePanel.js';
import { HEALTH_POLL_MS } from './PartyMembers.js';

/** Os três tamanhos de pull (FUN-123), em palavras iguais às do seletor de hunts. */
const DIFFICULTY_TEXT: Record<string, string> = {
  cautious: 'Cauteloso',
  bold: 'Ousado',
  reckless: 'Agressivo',
};

export function WorldOverlay({ hunting }: { hunting: boolean }) {
  const partyView = useHudSlice((state) => state.party);
  const catalogue = useHudSlice((state) => state.catalogue);
  const huntId = useHudSlice((state) => state.huntId);
  const difficulty = useHudSlice((state) => state.difficulty);
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
  // Ausente é sessão sem hunt conhecida — nó `game` anterior à SV-05, ou catálogo que ainda não
  // trouxe este id (§7 da spec de reconexão). A linha some; a contagem continua de pé sozinha.
  const hunt = huntId === null ? null : (catalogue?.hunts.find((entry) => entry.id === huntId) ?? null);
  const difficultyLabel = difficulty === null ? null : (DIFFICULTY_TEXT[difficulty] ?? difficulty);

  return (
    <div className="world-overlay" aria-label="área">
      {hunt !== null && difficultyLabel !== null && (
        <span className="world-overlay-line world-overlay-area">{`${hunt.name} · ${difficultyLabel}`}</span>
      )}
      <span className="world-overlay-line">{`${String(count)} criaturas no alcance`}</span>
    </div>
  );
}
