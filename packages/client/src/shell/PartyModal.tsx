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
// A terceira aba, "Encontrar Party" (#404, ADR 0033 D8), publica a sala do líder com faixa de
// level e lista as salas publicadas, entrando pela mesma `join` da formação (o `api` decide se a
// resposta é o formulário ou um ticket). A listagem é de OUTRAS parties: mora fora da `PartyState`
// e fora de `run`/`busy` (DT-03) — só a aba montada paga o polling de 2 s (RF-02).
//
// O "/4" do título do kit também fica de fora: `maxMembers` é uma constante de `content` que
// nenhuma mensagem manda ao cliente hoje — mostrar "4" fixo seria inventar dado (D8). O título
// fica "Party · N", o mesmo formato que o painel da esquerda já adota.

import { useEffect, useState } from 'react';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { party, partyActions, fetchRooms, PARTY_POLL_MS } from '../party/store.js';
import type { PartyView, RoomView } from '../party/api.js';
import { percentFromWorld } from './party-member-view.js';
import { PartyPanel } from './PartyPanel.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { Kicker } from './ui/Kicker.js';
import { Modal } from './ui/Modal.js';
import { Tabs } from './ui/Tabs.js';
import { VitalBar } from './ui/VitalBar.js';

/** A mesma cadência de PartyMembers.tsx: `world` não avisa ninguém (ADR 0007). */
export const HEALTH_POLL_MS = 1_000;

type PartyModalTab = 'Formação' | 'Na hunt' | 'Encontrar Party';
const TABS: readonly PartyModalTab[] = ['Formação', 'Na hunt', 'Encontrar Party'];

/**
 * O polling da lista de salas, separado do React para ser testável sem DOM (mesmo padrão de
 * `startFpsPolling` em WorldStatusOverlay.tsx): o `prerender` não roda efeitos, e um `setInterval`
 * preso dentro de um componente só seria exercitado por um DOM que o cliente não tem.
 */
export function startRoomsPolling(setRooms: (rooms: readonly RoomView[]) => void): () => void {
  let cancelled = false;
  const load = (): void => {
    void fetchRooms().then((next) => { if (!cancelled) setRooms(next); });
  };
  load();
  const id = setInterval(load, PARTY_POLL_MS);
  return () => { cancelled = true; clearInterval(id); };
}

/** O motivo pelo qual "Entrar" fica desabilitado — só APRESENTAÇÃO (invariante 4): quem decide
 *  lotação e faixa de level é o `api`; aqui só se evita mandar um clique que ele já recusaria. */
export function joinReason(room: RoomView, myLevel: number): string | null {
  if (room.members >= room.maxMembers) return 'Sala cheia';
  if (myLevel < room.minLevel || myLevel > room.maxLevel) {
    return `Fora da faixa (${String(room.minLevel)}–${String(room.maxLevel)})`;
  }
  return null;
}

/**
 * A aba "Encontrar Party" (#404): publicar/despublicar a sala do líder e entrar numa publicada.
 * Presentacional de propósito — a lista de salas entra por prop, o que a torna verificável com
 * `prerender` (o efeito que a busca fica no `PartyModal`).
 */
export function RoomsTab({ rooms, current, me, myLevel, busy }: {
  rooms: readonly RoomView[];
  current: PartyView | null;
  me: string;
  myLevel: number;
  busy: boolean;
}) {
  const [minLevel, setMinLevel] = useState(1);
  const [maxLevel, setMaxLevel] = useState(999);

  const isLeader = current !== null && current.leaderId === me;
  // Publicar exige hunt e dificuldade propostas — a MESMA régua do `/publish` (nada-proposed).
  const canPublish = isLeader && current.huntId !== null && current.difficulty !== null;
  const published = current !== null && current.published;

  return (
    <div className="party-rooms">
      {canPublish && (
        <div className="party-row">
          <Input
            type="number"
            size="sm"
            aria-label="level mínimo"
            value={minLevel}
            onChange={(event) => { setMinLevel(Number(event.target.value)); }}
          />
          <Input
            type="number"
            size="sm"
            aria-label="level máximo"
            value={maxLevel}
            onChange={(event) => { setMaxLevel(Number(event.target.value)); }}
          />
          <Button
            size="sm"
            variant={published ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={() => {
              void (published ? partyActions.unpublish() : partyActions.publish({ minLevel, maxLevel }));
            }}
          >
            {published ? 'Despublicar' : 'Publicar'}
          </Button>
        </div>
      )}
      {canPublish && published && <p className="entry-meta">Sala publicada.</p>}
      <ul className="party-rooms-list" aria-label="salas públicas">
        {rooms.map((room) => {
          const reason = joinReason(room, myLevel);
          return (
            <li key={room.partyId} className="party-room-row">
              <span className="party-room-leader">
                {`${room.leader.name} · LV ${String(room.leader.level)} · ${String(room.members)}/${String(room.maxMembers)}`}
              </span>
              <span className="entry-meta">{`${String(room.minLevel)}–${String(room.maxLevel)}`}</span>
              <Button
                size="sm"
                disabled={reason !== null}
                title={reason ?? 'Entrar nesta sala'}
                onClick={() => { void partyActions.join(room.partyId); }}
              >
                Entrar
              </Button>
              {reason !== null && <span className="entry-meta">{reason}</span>}
            </li>
          );
        })}
      </ul>
      {rooms.length === 0 && <p className="party-modal-empty">Nenhuma sala publicada agora.</p>}
    </div>
  );
}

export function PartyModal({ hunting, onClose }: { hunting: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<PartyModalTab>(hunting ? 'Na hunt' : 'Formação');
  const [rooms, setRooms] = useState<readonly RoomView[]>([]);
  const catalogue = useHudSlice((state) => state.catalogue);
  const partyView = useHudSlice((state) => state.party);
  const me = useHudSlice((state) => state.characterId);
  const myLevel = useHudSlice((state) => state.level);
  const formation = useStoreSlice(party, (s) => s.party);
  const busy = useStoreSlice(party, (s) => s.busy);
  const [, tick] = useState(0);

  // O HP dos companheiros só reage a um timer (mesmo motivo de PartyMembers.tsx: `world` não
  // assina), e só enquanto a aba "Na hunt" está montada e há party — o modal fechado, ou a aba
  // Formação, não pagam o custo.
  useEffect(() => {
    if (tab !== 'Na hunt' || partyView === null) return undefined;
    const id = setInterval(() => { tick((n) => n + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, [tab, partyView]);

  // A lista de salas só é buscada enquanto a aba está montada: trocar de aba ou fechar o modal
  // para o polling (RF-02).
  useEffect(() => {
    if (tab !== 'Encontrar Party') return undefined;
    return startRoomsPolling(setRooms);
  }, [tab]);

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
        items={TABS}
        value={tab}
        onChange={(item) => { if ((TABS as readonly string[]).includes(item)) setTab(item as PartyModalTab); }}
        className="party-modal-tabs"
      />
      {tab === 'Formação' && <PartyPanel hunts={hunts} />}
      {tab === 'Encontrar Party' && (
        <RoomsTab rooms={rooms} current={formation} me={me ?? ''} myLevel={myLevel} busy={busy} />
      )}
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
