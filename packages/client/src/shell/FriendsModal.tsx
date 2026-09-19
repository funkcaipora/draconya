// O modal "Amigos" (#404, D8 do ADR 0033): o subconjunto do kit que já é verdade do servidor
// (#403) — listar com online/onde, adicionar por nome e convidar para a party atual.
//
// As abas "Pedidos" e "Bloqueados" do kit (`docs/kit-reference/29-modal-social.png`) ficam de
// fora NÃO por corte permanente (ADR 0030 decisão 5 proíbe): o servidor desta task não tem
// pedido nem bloqueio para mostrar, e a aba nasce quando o épico social existir. Renderizar as
// duas abas vazias afirmaria um sistema que não existe (D8).
//
// A amizade é do PERSONAGEM, não da party (DT-04): a store é `friends/`, separada de `party/`.

import { useEffect, useState } from 'react';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { friends, friendsActions } from '../friends/store.js';
import { party, partyActions } from '../party/store.js';
import type { FriendView } from '../friends/api.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { Kicker } from './ui/Kicker.js';
import { Modal } from './ui/Modal.js';

const NO_PARTY_HINT = 'Crie uma party primeiro.';

/** Onde o amigo está. Sem `huntId` no diretório, "Em caçada" é o que o servidor disse — nunca o
 *  nome da hunt, que ele não mandou (D8). */
function whereLabel(where: FriendView['where']): string {
  if (where === 'city') return 'Cidade';
  if (where === 'hunt') return 'Em caçada';
  return 'offline';
}

export function FriendsModal({ onClose }: { onClose: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const friendsView = useStoreSlice(friends, (state) => state.friends);
  const busy = useStoreSlice(friends, (state) => state.busy);
  const error = useStoreSlice(friends, (state) => state.error);
  const current = useStoreSlice(party, (state) => state.party);
  const [name, setName] = useState('');

  // A lista é do servidor: busca ao abrir, uma vez.
  useEffect(() => { void friendsActions.refresh(); }, []);

  const online = friendsView.filter((friend) => friend.online).length;
  const canInvite = current !== null;

  function invite(friend: FriendView): void {
    void partyActions.invite(friend.characterId);
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
                    title={canInvite ? `Convidar ${friend.name} para a party` : NO_PARTY_HINT}
                    onClick={() => { invite(friend); }}
                  >
                    Convidar para Party
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      {error !== null && <p className="system-error">{error}</p>}
    </Modal>
  );
}
