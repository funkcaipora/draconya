// O overlay de área e criaturas sobre o mundo (#327, #348, RC-14, SV-12; ADR 0030 decisão 3). A
// contagem reaproveita `battleRows`, a mesma exclusão do próprio personagem e da party que o
// painel Batalha já usa: nenhum campo novo de protocolo e nenhuma segunda fonte de verdade.
//
// O nome da hunt vem de `hud.huntId` (SV-05), cruzado com `catalogue.hunts[]` pelo NOME — o id
// sozinho não é apresentável. Não há mais dificuldade a mostrar desde o #584 (ADR 0039, fim do
// pull por dificuldade). O Badge de bênção fica fora: a bênção ainda não existe como sistema, e
// o cliente não inventa um.

import { useEffect, useState } from 'react';
import type { ZoneKind } from '@draconya/protocol';
import { useHudSlice } from '../state/useSlice.js';
import { battleRows } from './BattlePanel.js';
import { HEALTH_POLL_MS } from './PartyMembers.js';

/**
 * A linha de zona do mundo aberto (#846, OW-23), do `player-stats.zone`. `null` — "este servidor não diz" — e as
 * zonas sem nada a dizer (`'normal'`, `'no-pvp'`, que é a regra do mundo inteiro, e `'pvp'`) não escrevem linha:
 * só se diz o que o jogador precisa saber para agir, que é onde ele está protegido e onde não pode sair.
 */
export function worldZoneLine(zone: ZoneKind | null): string | null {
  if (zone === 'protection') return 'zona de proteção';
  if (zone === 'no-logout') return 'não se pode sair daqui';
  return null;
}

export function WorldOverlay({ hunting, training = false, world: inWorld = false }: {
  hunting: boolean;
  /** O personagem está numa sessão de Treino (#631): a área é a mesma da Cidade, mas o texto não. */
  training?: boolean;
  /** O personagem está no mundo aberto (#846, OW-23): a área, a zona do tile e quem está ao alcance. */
  world?: boolean;
}) {
  const partyView = useHudSlice((state) => state.party);
  const catalogue = useHudSlice((state) => state.catalogue);
  const huntId = useHudSlice((state) => state.huntId);
  const zone = useHudSlice((state) => state.zone);
  // `world` não possui subscribe (ADR 0007). A leitura é deliberadamente amostrada, como em
  // BattlePanel e PartyMembers, e só existe enquanto a sessão estiver em hunt ou no mundo aberto.
  const [, tick] = useState(0);
  const sampling = hunting || inWorld;
  useEffect(() => {
    if (!sampling) return undefined;
    const id = setInterval(() => { tick((current) => current + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, [sampling]);

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
  if (inWorld) {
    // O mundo aberto (#846, OW-23): não é a praça ("não credita nada" seria mentira — o personagem ganha XP e
    // loot ali) nem uma hunt (não há `huntId`). A contagem é a mesma do painel Batalha: quem está à vista.
    const partyNames = new Set(partyView?.members.map((member) => member.name) ?? []);
    const zoneLine = worldZoneLine(zone);
    return (
      <div className="world-overlay" aria-label="área">
        <span className="world-overlay-line world-overlay-area">Mundo aberto</span>
        {zoneLine !== null && <span className="world-overlay-line">{zoneLine}</span>}
        <span className="world-overlay-line">{`${String(battleRows(partyNames).length)} criaturas no alcance`}</span>
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
