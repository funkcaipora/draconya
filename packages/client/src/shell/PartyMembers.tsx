// Os companheiros durante a hunt (#197): nome, HP % e quem lidera. Aparece no lugar da
// formação assim que a sessão é uma party.
//
// O HP vem de dois lugares: do `party-state` (attach e mudança de composição) e, no meio, do
// `creature-health` que o mundo já recebe de cada um — a lista de criaturas tem o nome, e é
// por ele que se casa. Lido num intervalo curto, e não por assinatura: o mundo é um objeto
// mutado no lugar (ADR 0007), e o painel só existe em party.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { world } from '../state/world.js';

export const HEALTH_POLL_MS = 1_000;

function percentFromWorld(name: string): number | null {
  for (const creature of world.creatures.values()) {
    if (creature.name !== name || creature.maxHealth <= 0) continue;
    return Math.max(0, Math.min(100, Math.round((creature.health / creature.maxHealth) * 100)));
  }
  return null;
}

export function PartyMembers() {
  const partyView = useHudSlice((state) => state.party);
  const me = useHudSlice((state) => state.characterId);
  const [, tick] = useState(0);
  useEffect(() => {
    if (partyView === null) return;
    const id = setInterval(() => { tick((n) => n + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, [partyView]);
  if (partyView === null) return null;

  return (
    <section className="party-members-panel" aria-label="companheiros">
      <header className="analyzer-head"><strong>Party</strong></header>
      <ul className="party-members">
        {partyView.members.map((member) => {
          const percent = percentFromWorld(member.name) ?? member.healthPercent;
          return (
            <li key={member.characterId} className={`party-member${member.alive ? '' : ' party-member-down'}`}>
              <span>{`${member.characterId === partyView.leaderId ? '★ ' : ''}${member.characterId === me ? 'você' : member.name}`}</span>
              <span className="party-hp" aria-label={`HP de ${member.name}`}>
                <span className="party-hp-fill" style={{ width: `${String(member.alive ? percent : 0)}%` }} />
              </span>
              <span className="entry-meta">{member.alive ? `${String(percent)} %` : 'caiu'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
