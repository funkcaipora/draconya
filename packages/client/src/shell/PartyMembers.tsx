// Os companheiros durante a hunt (#197, #318): nome, HP % e quem lidera. Aparece no lugar da
// formação assim que a sessão é uma party, dentro de um `Panel` dock com o rodapé do kit.
//
// O HP vem de dois lugares: do `party-state` (attach e mudança de composição) e, no meio, do
// `creature-health` que o mundo já recebe de cada um — a lista de criaturas tem o nome, e é
// por ele que se casa. Lido num intervalo curto, e não por assinatura: o mundo é um objeto
// mutado no lugar (ADR 0007), e o painel só existe em party.
//
// Só aparecem campos que a sessão realmente transmite. Vocação/nível e mana esperam SV-03,
// gasto espera SV-18, DPS/HPS esperam E2 e expulsar espera SV-22. O modo (`split`/`shared`)
// continua texto: os interruptores de rateio e loot exigem SV-23, pois o modo é FIXADO na
// proposta (ADR 0027 decisão 5).
//
// O botão usa `leave-hunt`, não `partyActions.leave()`: depois do start a party HTTP já foi
// consumida, enquanto o opcode 10 retira somente este personagem da sessão compartilhada.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { sendIntent } from '../net/current.js';
import { leaveHunt } from './HuntActions.js';
import { percentFromWorld } from './party-member-view.js';
import { Button } from './ui/Button.js';
import { IconButton } from './ui/IconButton.js';
import { Panel } from './ui/Panel.js';
import { VitalBar } from './ui/VitalBar.js';

export const HEALTH_POLL_MS = 1_000;

/**
 * Duplicado de propósito, e não importado de `PartyPanel.tsx` — a formação, que esta issue NÃO
 * toca (DS-16 é quem redesenha a formação, dentro do modal de caçada). Um módulo só para duas
 * entradas acoplaria dois arquivos que precisam poder mudar em issues diferentes sem se tocar.
 */
const MODE_TEXT: Record<'split' | 'shared', string> = { split: 'Dividido', shared: 'Compartilhado' };

export function PartyMembers({ partyLootOpen, onToggleLoot, onManage }: {
  partyLootOpen: boolean;
  onToggleLoot: () => void;
  onManage: () => void;
}) {
  const partyView = useHudSlice((state) => state.party);
  const me = useHudSlice((state) => state.characterId);
  const [, tick] = useState(0);
  useEffect(() => {
    if (partyView === null) return;
    const id = setInterval(() => { tick((n) => n + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, [partyView]);
  if (partyView === null) return null;

  const footer = (
    <div className="party-footer">
      <p className="party-footer-note">Parar no meio da caçada exige o sim de todos.</p>
      <p className="party-mode">{MODE_TEXT[partyView.mode]}</p>
      <Button
        variant="danger"
        size="sm"
        block
        className="party-footer-leave"
        onClick={() => { leaveHunt(sendIntent); }}
      >
        Sair da party
      </Button>
    </div>
  );

  return (
    <Panel
      dock
      title={`Party · ${String(partyView.members.length)}`}
      footer={footer}
      actions={(
        <>
          <IconButton size="sm" title="Party loot" active={partyLootOpen} onClick={onToggleLoot}>
            ▣
          </IconButton>
          {/* Abre o modal "Gerenciar party" (#320, R3-11/R3-12) — a formação e as ações de
              party voltam a existir DURANTE a hunt, sem duplicar PartyPanel.tsx. */}
          <IconButton size="sm" title="Gerenciar party" onClick={onManage}>⚙</IconButton>
        </>
      )}
    >
      <ul className="party-companions" aria-label="companheiros">
        {partyView.members.map((member) => {
          const percent = percentFromWorld(member.name) ?? member.healthPercent;
          const isSelf = member.characterId === me;
          const isLeader = member.characterId === partyView.leaderId;
          return (
            <li key={member.characterId} className={`party-companion${member.alive ? '' : ' party-companion-down'}`}>
              <span className="party-companion-name">
                {isLeader && <span className="party-leader-star">★</span>}
                <b className={isSelf ? 'party-companion-self' : undefined}>{isSelf ? 'você' : member.name}</b>
              </span>
              {/* Não há vocação/nível ou mana (SV-03), gasto (SV-18), DPS/HPS (E2) ou expulsão
                  (SV-22): o HUD não fabrica valores que o servidor não transmitiu. */}
              <div className="party-companion-vitals">
                <span className="party-hp-row">
                  <span className="party-hp" aria-label={`HP de ${member.name}`}>
                    <VitalBar kind="hp" percent={member.alive ? percent : 0} height={4} showText={false} />
                  </span>
                  <span className="entry-meta">{member.alive ? `${String(percent)} %` : 'caiu'}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
