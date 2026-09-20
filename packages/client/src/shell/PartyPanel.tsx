// A formação da party (#197, ADR 0027 decisão 8), DENTRO da seleção de hunt.
//
// O Huntera põe a party na seleção de caçada, não numa tela à parte
// (`docs/reference/huntera-observed.md`) — e faz sentido: propor uma hunt É escolher uma hunt.
// Quatro estados, e a tela é um por vez: sem party ("criar" ou "entrar por id"); membro
// (aprovar, sair); líder sem aprovação de todos (propor, convidar); líder pronto (iniciar).
//
// Tudo é INTENÇÃO (invariante 4): a tela nunca calcula cota, XP ou valor de venda; pede ao
// `api` e mostra o que ele devolveu. Quem inicia é o servidor — e o ticket que ele manda é o
// que a conexão usa para entrar, pelo mesmo `connect` de sempre.
//
// Nome e expulsão chegaram com o SV-22 (#358): `PartyMemberView.name` substitui o `characterId`
// cru na lista, e o líder vê um `×` em cada OUTRO membro (nunca em si — para isso existe
// `leave`). SV-19 (#355) rotula a dificuldade com a contagem de monstros do catálogo.

import { useState } from 'react';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { party, partyActions } from '../party/store.js';
import type { HuntListing } from '../state/hud.js';
import { Panel } from './ui/Panel.js';

const DIFFICULTY_TEXT: Record<string, string> = {
  cautious: 'Cauteloso', bold: 'Ousado', reckless: 'Agressivo',
};
const MODE_TEXT = { split: 'Dividido', shared: 'Compartilhado' } as const;

/**
 * O rótulo do pull no seletor de dificuldade — "Ousado · 4" como o Huntera mostra (SV-19,
 * #355). Definida AQUI, e não importada de `HuntsModal.tsx`: ele importa `PartyPanel`, e
 * importar de volta criaria um ciclo entre os dois módulos. `HuntsModal.tsx` mantém a própria
 * cópia; as duas já divergiam em `DIFFICULTY_TEXT` antes desta issue.
 */
function pullLabel(hunt: HuntListing, difficulty: string): string {
  const label = DIFFICULTY_TEXT[difficulty] ?? difficulty;
  const count = hunt.difficultyDetails.find((detail) => detail.id === difficulty)?.monsterCount;
  return count === undefined ? label : `${label} · ${String(count)}`;
}

export function PartyPanel({ hunts }: { hunts: readonly HuntListing[] }) {
  const me = useHudSlice((state) => state.characterId);
  const state = useStoreSlice(party, (s) => s);
  const [joinId, setJoinId] = useState('');
  const [inviteeId, setInviteeId] = useState('');
  const [huntId, setHuntId] = useState(hunts[0]?.id ?? '');
  const [difficulty, setDifficulty] = useState(hunts[0]?.difficulties[0] ?? '');
  const [mode, setMode] = useState<'split' | 'shared'>('split');

  // O polling de `/mine` subiu para o `Shell` (#404, DT-01): o convite precisa aparecer em
  // qualquer tela (D7), e um `setInterval` por componente aberto correria vários `refresh()`
  // concorrentes a cada 2 s.

  if (me === null) return null;
  const current = state.party;
  const leader = current !== null && current.leaderId === me;
  const everyoneApproved = current !== null && current.members.length >= 2
    && current.members.every((member) => member.approved);
  const hunt = hunts.find((h) => h.id === huntId) ?? hunts[0];

  return (
    <Panel dock title={current === null ? 'Party' : `Party · ${String(current.members.length)}`} bodyClassName="party-panel">
      {state.entering && <p className="quiet">Entrando na hunt…</p>}
      {!state.entering && current === null && (
        <div className="party-form">
          <button type="button" disabled={state.busy} onClick={() => { void partyActions.create(); }}>
            Criar party
          </button>
          {/* O matchmaking (#199): a fila FORMA a party; o resto é o fluxo de sempre. */}
          {state.seeking
            ? <button type="button" disabled={state.busy} onClick={() => { void partyActions.stopSeeking(); }}>Cancelar busca…</button>
            : <button type="button" disabled={state.busy} onClick={() => { void partyActions.seek(); }}>Procurar party</button>}
          <div className="party-row">
            <input
              aria-label="id da party"
              placeholder="id da party"
              value={joinId}
              onChange={(event) => { setJoinId(event.target.value); }}
            />
            <button type="button" disabled={state.busy || joinId === ''} onClick={() => { void partyActions.join(joinId.trim()); }}>
              Entrar
            </button>
          </div>
        </div>
      )}
      {!state.entering && current !== null && (
        <div className="party-form">
          <div className="entry-meta">{`party ${current.id.slice(0, 8)} · ${MODE_TEXT[current.mode]}`}</div>
          <ul className="party-members">
            {current.members.map((member) => (
              <li key={member.characterId} className="party-member">
                <span>
                  {member.characterId === current.leaderId && <span className="party-leader-star">★</span>}
                  {member.characterId === me ? 'você' : member.name}
                </span>
                <span className={member.approved ? 'party-approved' : 'entry-meta'}>{member.approved ? '✓ aprovou' : 'aguardando'}</span>
                {leader && member.characterId !== me && (
                  <button
                    type="button"
                    className="party-kick"
                    title="Remover da party"
                    disabled={state.busy}
                    onClick={() => { void partyActions.kick(member.characterId); }}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {current.huntId !== null && (
            <div className="entry-meta">
              {`Proposta: ${hunts.find((h) => h.id === current.huntId)?.name ?? current.huntId} · ${DIFFICULTY_TEXT[current.difficulty ?? ''] ?? current.difficulty ?? ''}`}
            </div>
          )}
          {leader && (
            <>
              <div className="party-row">
                <input
                  aria-label="convidar"
                  placeholder="id do personagem"
                  value={inviteeId}
                  onChange={(event) => { setInviteeId(event.target.value); }}
                />
                <button type="button" disabled={state.busy || inviteeId === ''} onClick={() => { void partyActions.invite(inviteeId.trim()); setInviteeId(''); }}>
                  Convidar
                </button>
              </div>
              <div className="party-row">
                <select aria-label="hunt" value={hunt?.id ?? ''} onChange={(event) => { setHuntId(event.target.value); setDifficulty(hunts.find((h) => h.id === event.target.value)?.difficulties[0] ?? ''); }}>
                  {hunts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
                <select aria-label="dificuldade" value={difficulty} onChange={(event) => { setDifficulty(event.target.value); }}>
                  {hunt === undefined ? null : hunt.difficulties.map((d) => (
                    <option key={d} value={d}>{pullLabel(hunt, d)}</option>
                  ))}
                </select>
                <select aria-label="modo" value={mode} onChange={(event) => { setMode(event.target.value as 'split' | 'shared'); }}>
                  <option value="split">{MODE_TEXT.split}</option>
                  <option value="shared">{MODE_TEXT.shared}</option>
                </select>
                <button type="button" disabled={state.busy || hunt === undefined || difficulty === ''} onClick={() => { if (hunt !== undefined) void partyActions.propose({ huntId: hunt.id, difficulty, mode }); }}>
                  Propor
                </button>
              </div>
              {/* Só acende com TODOS aprovados: o servidor recusa de qualquer jeito, e deixar
                  clicar para receber "não" é um passo evitável. */}
              <button type="button" disabled={state.busy || !everyoneApproved} onClick={() => { void partyActions.start(); }}>
                Iniciar
              </button>
            </>
          )}
          {!leader && (
            <button
              type="button"
              disabled={state.busy || current.huntId === null || current.members.some((m) => m.characterId === me && m.approved)}
              onClick={() => { void partyActions.approve(); }}
            >
              Aprovar
            </button>
          )}
          <p className="party-status">{everyoneApproved ? 'Todos aprovaram' : 'Aguardando aprovação'}</p>
          <button type="button" className="entry-quiet" disabled={state.busy} onClick={() => { void partyActions.leave(); }}>
            sair da party
          </button>
        </div>
      )}
      {state.error !== null && <p className="system-error">{state.error}</p>}
    </Panel>
  );
}
