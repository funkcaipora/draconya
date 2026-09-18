// "Gerenciar party" (#320, RC-07 — ADR 0030 decisão 3).
//
// Fecha a barreira estrutural R3-11/R3-12 (docs/reviews/kit-fidelity-audit-2026-09-16.md): antes
// deste modal não havia NENHUM caminho para reabrir a formação (convidar, propor, aprovar, sair)
// uma vez que a hunt começa — só HuntsModal.tsx tinha essas ações, e ele continua tendo. Este
// modal é alcançável pela engrenagem de PartyMembers.tsx, o painel que fica montado durante a hunt.
//
// A aba Formação reaproveita PartyPanel.tsx INTEIRO — mesmo componente, mesma store, mesmo
// mecanismo HTTP do ADR 0027. A aba Na hunt mostra os mesmos dados que PartyMembers.tsx já mostra
// na coluna esquerda (nome, estrela de líder, HP, "caiu"), só que dentro do modal — por isso o
// percentual de HP vem da mesma função pura (`party-member-view.ts`) extraída de PartyMembers.
//
// Vocação/level/mana chegaram ao `PartyState` (party-state, opcode 24) com o SV-11 (#347), e
// `PartyMembers.tsx` já os mostra na coluna esquerda — mas esta aba, de propósito, ainda só
// espelha o que já mostrava antes disso (nome, estrela, HP, "caiu"): ficar coerente com o painel
// é trabalho opcional desta mesma issue, não uma dívida separada. DPS/HPS continuam fora porque
// não existe campo nenhum para eles ainda (E2) — aí sim D8 (ADR 0030) se aplica.
//
// O "/4" do título do kit também fica de fora: `maxMembers` é uma constante de `content` que
// nenhuma mensagem manda ao cliente hoje — mostrar "4" fixo seria inventar dado (D8). O título
// fica "Party · N", o mesmo formato que o painel da esquerda já adota.

import { useEffect, useState } from 'react';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { party } from '../party/store.js';
import { percentFromWorld } from './party-member-view.js';
import { PartyPanel } from './PartyPanel.js';
import { Modal } from './ui/Modal.js';
import { Tabs } from './ui/Tabs.js';
import { Kicker } from './ui/Kicker.js';
import { VitalBar } from './ui/VitalBar.js';

/** A mesma cadência de PartyMembers.tsx: `world` não avisa ninguém (ADR 0007). */
export const HEALTH_POLL_MS = 1_000;

type PartyModalTab = 'Formação' | 'Na hunt';

export function PartyModal({ hunting, onClose }: { hunting: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<PartyModalTab>(hunting ? 'Na hunt' : 'Formação');
  const catalogue = useHudSlice((state) => state.catalogue);
  const partyView = useHudSlice((state) => state.party);
  const me = useHudSlice((state) => state.characterId);
  const formation = useStoreSlice(party, (s) => s.party);
  const [, tick] = useState(0);

  // O HP dos companheiros só reage a um timer (mesmo motivo de PartyMembers.tsx: `world` não
  // assina), e só enquanto a aba "Na hunt" está montada e há party — o modal fechado, ou a aba
  // Formação, não pagam o custo.
  useEffect(() => {
    if (tab !== 'Na hunt' || partyView === null) return undefined;
    const id = setInterval(() => { tick((n) => n + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, [tab, partyView]);

  const hunts = catalogue?.hunts ?? [];
  const memberCount = partyView?.members.length ?? 0;

  // Mesmo cálculo de PartyPanel.tsx, lendo a MESMA store — não o componente embutido, que não
  // expõe esse booleano para fora.
  const everyoneApproved = formation !== null && formation.members.length >= 2
    && formation.members.every((member) => member.approved);
  const footer = tab === 'Formação' && formation !== null
    ? <span className="party-modal-status">{everyoneApproved ? 'Todos aprovaram' : 'Aguardando aprovação'}</span>
    : undefined;

  return (
    <Modal
      open
      title={`Party · ${String(memberCount)}`}
      onClose={onClose}
      width={440}
      {...(footer !== undefined ? { footer } : {})}
    >
      <Tabs
        items={['Formação', 'Na hunt']}
        value={tab}
        onChange={(item) => { if (item === 'Formação' || item === 'Na hunt') setTab(item); }}
        className="party-modal-tabs"
      />
      {tab === 'Formação' && <PartyPanel hunts={hunts} />}
      {tab === 'Na hunt' && (
        partyView === null
          ? <p className="party-modal-empty">Você não está numa party.</p>
          : (
            <>
              <Kicker tone="muted">Companheiros</Kicker>
              <ul className="party-modal-companions" aria-label="companheiros na party">
                {partyView.members.map((member) => {
                  const isSelf = member.characterId === me;
                  const percent = percentFromWorld(member.name) ?? member.healthPercent;
                  const rowClass = !member.alive
                    ? 'party-modal-companion party-modal-companion-down'
                    : isSelf
                      ? 'party-modal-companion party-modal-companion-self'
                      : 'party-modal-companion';
                  return (
                    <li key={member.characterId} className={rowClass}>
                      <span className="party-modal-companion-name">
                        {member.characterId === partyView.leaderId
                          && <span className="party-modal-leader-star">★</span>}
                        {isSelf ? 'você' : member.name}
                      </span>
                      <VitalBar
                        kind="hp"
                        percent={member.alive ? percent : 0}
                        height={6}
                        showText={false}
                        className="party-modal-hp"
                      />
                      <span className="party-modal-percent">
                        {member.alive ? `${String(percent)} %` : 'caiu'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )
      )}
    </Modal>
  );
}
