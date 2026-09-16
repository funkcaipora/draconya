// Os companheiros durante a hunt (#197): nome, HP % e quem lidera. Aparece no lugar da
// formação assim que a sessão é uma party.
//
// O HP vem de dois lugares: do `party-state` (attach e mudança de composição) e, no meio, do
// `creature-health` que o mundo já recebe de cada um — a lista de criaturas tem o nome, e é
// por ele que se casa. Lido num intervalo curto, e não por assinatura: o mundo é um objeto
// mutado no lugar (ADR 0007), e o painel só existe em party.
//
// O modo (`split`/`shared`) aparece como TEXTO (DS-14, `docs/design-system-plan.md` §4): os
// interruptores "Rateio de custos" e "Dividir loot" do handoff não entram — o modo é FIXADO na
// proposta (ADR 0027 decisão 5), e não há nada para o jogador trocar aqui.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { world } from '../state/world.js';
import { VitalBar } from './ui/VitalBar.js';

export const HEALTH_POLL_MS = 1_000;

/**
 * Duplicado de propósito, e não importado de `PartyPanel.tsx` — a formação, que esta issue NÃO
 * toca (DS-16 é quem redesenha a formação, dentro do modal de caçada). Um módulo só para duas
 * entradas acoplaria dois arquivos que precisam poder mudar em issues diferentes sem se tocar.
 */
const MODE_TEXT: Record<'split' | 'shared', string> = { split: 'Dividido', shared: 'Compartilhado' };

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
      <p className="party-mode">{MODE_TEXT[partyView.mode]}</p>
      <ul className="party-companions">
        {partyView.members.map((member) => {
          const percent = percentFromWorld(member.name) ?? member.healthPercent;
          const isSelf = member.characterId === me;
          return (
            <li key={member.characterId} className={`party-companion${member.alive ? '' : ' party-companion-down'}`}>
              <span className={isSelf ? 'party-companion-self' : undefined}>
                {`${member.characterId === partyView.leaderId ? '★ ' : ''}${isSelf ? 'você' : member.name}`}
              </span>
              <span className="party-hp-row">
                <span className="party-hp" aria-label={`HP de ${member.name}`}>
                  <VitalBar kind="hp" percent={member.alive ? percent : 0} height={4} showText={false} />
                </span>
                <span className="entry-meta">{member.alive ? `${String(percent)} %` : 'caiu'}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
