// O overlay de área e criaturas sobre o mundo (#327, #348, RC-14, SV-12; ADR 0030 decisão 3). A
// contagem reaproveita `battleRows`, a mesma exclusão do próprio personagem e da party que o
// painel Batalha já usa: nenhum campo novo de protocolo e nenhuma segunda fonte de verdade.
//
// O nome da hunt vem de `hud.huntId` (SV-05), cruzado com `catalogue.hunts[]` pelo NOME — o id
// sozinho não é apresentável. Não há mais dificuldade a mostrar desde o #584 (ADR 0039, fim do
// pull por dificuldade). O Badge de bênção fica fora: a bênção ainda não existe como sistema, e
// o cliente não inventa um.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { battleRows } from './BattlePanel.js';
import { HEALTH_POLL_MS } from './PartyMembers.js';

export function WorldOverlay({ hunting, training = false }: {
  hunting: boolean;
  /** O personagem está numa sessão de Treino (#631): a área é a mesma da Cidade, mas o texto não. */
  training?: boolean;
}) {
  const partyView = useHudSlice((state) => state.party);
  const catalogue = useHudSlice((state) => state.catalogue);
  const huntId = useHudSlice((state) => state.huntId);
  // `world` não possui subscribe (ADR 0007). A leitura é deliberadamente amostrada, como em
  // BattlePanel e PartyMembers, e só existe enquanto a sessão estiver em hunt.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!hunting) return undefined;
    const id = setInterval(() => { tick((current) => current + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, [hunting]);

  if (training) {
    // A sessão de Treino roda no mapa da Cidade (protect zone), mas a praça "não credita nada" seria
    // mentira: cada golpe credita tries e gasta uma carga (#631, ADR 0059).
    return (
      <div className="world-overlay" aria-label="área">
        <span className="world-overlay-line">Treino · zona protegida</span>
        <span className="world-overlay-line">cada golpe gasta uma carga</span>
      </div>
    );
  }
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

  return (
    <div className="world-overlay" aria-label="área">
      {hunt !== null && (
        <span className="world-overlay-line world-overlay-area">{hunt.name}</span>
      )}
      <span className="world-overlay-line">{`${String(count)} criaturas no alcance`}</span>
    </div>
  );
}
