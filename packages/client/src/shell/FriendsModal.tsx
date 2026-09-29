// O modal "Amigos" (#404, D8 do ADR 0035): o subconjunto do kit que já é verdade do servidor
// (#403) — listar com online/onde, adicionar por nome e convidar para a party atual.
//
// As abas "Pedidos" e "Bloqueados" do kit (`docs/kit-reference/29-modal-social.png`) ficam de
// fora NÃO por corte permanente (ADR 0030 decisão 5 proíbe): o servidor desta task não tem
// pedido nem bloqueio para mostrar, e a aba nasce quando o épico social existir. Renderizar as
// duas abas vazias afirmaria um sistema que não existe (D8).
//
// A amizade é do PERSONAGEM, não da party (DT-04): a store é `friends/`, separada de `party/`.
//
// #502: "Convidar para Party" NÃO exige party — sem party e fora de hunt o clique é o convite
// SOCIAL (RF-01); com party é o convite tradicional de sempre (RF-03). Em hunt NENHUM convite
// sai (RF-02): o botão desabilita com o motivo, lido do `hud` por `is-hunting.ts` (DT-01, a
// mesma fonte do `Shell`). O feedback (notice de sucesso, recusa tipada) é da store `party`
// (DT-03) — renderizado aqui, por ser quem disparou o envio.

import { useEffect, useState } from 'react';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { friends, friendsActions } from '../friends/store.js';
import { party, partyActions } from '../party/store.js';
import type { FriendView } from '../friends/api.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { isHunting } from './is-hunting.js';
import { Kicker } from './ui/Kicker.js';
import { Modal } from './ui/Modal.js';

/** RF-02: por que o botão está desabilitado — em hunt NINGUÉM convida, com party ou sem. */
const HUNT_HINT = 'Em caçada você não pode convidar — saia da caçada para convidar.';

/** Onde o amigo está. Sem `huntId` no diretório, "Em caçada" é o que o servidor disse — nunca o
 *  nome da hunt, que ele não mandou (D8). */
function whereLabel(where: FriendView['where']): string {
  if (where === 'city') return 'Cidade';
  if (where === 'hunt') return 'Em caçada';
  return 'offline';
}

export function FriendsModal({ onClose }: { onClose: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  // DT-01: a mesma fonte do `Shell` (`hud.analyzer.sessionType`) — nada de prop atravessando
  // o `Shell.tsx`, que é intocado.
  const sessionType = useHudSlice((state) => state.analyzer.sessionType);
  const friendsView = useStoreSlice(friends, (state) => state.friends);
  const busy = useStoreSlice(friends, (state) => state.busy);
  const error = useStoreSlice(friends, (state) => state.error);
  const current = useStoreSlice(party, (state) => state.party);
  const activePartyId = useStoreSlice(party, (state) => state.activePartyId);
  const notice = useStoreSlice(party, (state) => state.notice);
  const partyError = useStoreSlice(party, (state) => state.error);
  const [name, setName] = useState('');

  // A lista é do servidor: busca ao abrir, uma vez.
  useEffect(() => { void friendsActions.refresh(); }, []);

  const online = friendsView.filter((friend) => friend.online).length;
  // RF-02: a hunt bloqueia TODO convite — o convite social nasce na party do convidador, e quem
  // está caçando não pode ser ponto de partida de nenhuma (o servidor recusa do mesmo jeito).
  const hunting = isHunting(sessionType);
  const canInvite = !hunting;
  const hasParty = current !== null || activePartyId !== null;

  // DT-02: a escolha do caminho é conveniência de UI — sem party o convite SOCIAL cria a party
  // no aceite; com party o tradicional. O servidor recusa o caminho errado de qualquer jeito.
  function invite(friend: FriendView): void {
    if (hasParty) void partyActions.invite(friend.characterId);
    else void partyActions.socialInvite(friend.characterId);
  }

  function submit(): void {
    const trimmed = name.trim();
    void friendsActions.add(trimmed).then((ok) => { if (ok) setName(''); });
  }

  const footer = (
    <div className="friends-add">
      <Kicker tone="muted">Adicionar amigo</Kicker>
      <div className="friends-add-row">
        <Input
          size="sm"
          placeholder="Nome do personagem"
          aria-label="Nome do personagem"
          value={name}
          onChange={(event) => { setName(event.target.value); }}
          onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
        />
        <Button size="sm" disabled={busy || name.trim() === ''} onClick={submit}>
          Adicionar
        </Button>
      </div>
    </div>
  );

  return (
    <Modal open title="Amigos" meta={`${String(online)} online`} onClose={onClose} width={440} footer={footer}>
      {friendsView.length === 0
        ? <p className="friends-empty">Você ainda não tem amigos.</p>
        : (
          <ul className="friends-list" aria-label="amigos">
            {friendsView.map((friend) => {
              const vocation = friend.vocationId !== null
                ? catalogue?.vocations.find((entry) => entry.id === friend.vocationId)
                : undefined;
              const vocationLabel = friend.vocationId === null
                ? null
                : (vocation?.name ?? friend.vocationId);
              return (
                <li key={friend.characterId} className="friends-row">
                  <span
                    className={`friends-dot${friend.online ? ' friends-dot-online' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="friends-identity">
                    <b className="friends-name">{friend.name}</b>
                    <span className="friends-sub">
                      {vocationLabel === null ? `LV ${String(friend.level)}` : `${vocationLabel} · LV ${String(friend.level)}`}
                    </span>
                  </span>
                  <span className={`friends-where${friend.online ? '' : ' friends-where-offline'}`}>
                    {whereLabel(friend.where)}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canInvite}
                    title={hunting ? HUNT_HINT : `Convidar ${friend.name} para a party`}
                    onClick={() => { invite(friend); }}
                  >
                    Convidar para Party
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      {notice !== null && <p className="system-ok">{notice}</p>}
      {error !== null && <p className="system-error">{error}</p>}
      {partyError !== null && <p className="system-error">{partyError}</p>}
    </Modal>
  );
}
