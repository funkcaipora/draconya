// O diálogo de convite de party (#404, D7 do ADR 0035): aparece em QUALQUER tela — Cidade ou
// hunt — porque quem convida pode já estar caçando e o convite precisa chegar onde o jogador
// estiver. Montado incondicionalmente pelo `Shell`, como `VocationChoice`: é o próprio estado
// (`party.invites`) que decide se há o que desenhar.
//
// Aceitar é o MESMO `join` da formação: se a party está em curso, o `api` devolve um ticket, e a
// store oferece à conexão e reconecta (nunca troca de tela sem reconectar). Recusar é `decline`.

import { useStoreSlice } from '../state/useSlice.js';
import { party, partyActions } from '../party/store.js';
import type { PartyInviteView } from '../party/api.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

export function PartyInviteDialog() {
  // O `invites[]` do `/mine` é uma UNION desde a #501: o convite SOCIAL (#502) não tem
  // `partyId` — a party dele nasce no aceite — e este diálogo só sabe aceitar/recusar o
  // tradicional. Sem o filtro, um convite social chegava aqui com `partyId === undefined`.
  const invite = useStoreSlice(party, (state) =>
    state.invites.find((entry): entry is PartyInviteView => 'partyId' in entry) ?? null);
  if (invite === null) return null;

  return (
    <Modal
      open
      title={`Convite para Party — ${invite.leaderName} convidou você`}
      onClose={() => { void partyActions.declineInvite(invite.partyId); }}
      width={360}
    >
      <div className="party-invite-actions">
        <Button variant="primary" onClick={() => { void partyActions.acceptInvite(invite.partyId); }}>
          Aceitar
        </Button>
        <Button variant="ghost" onClick={() => { void partyActions.declineInvite(invite.partyId); }}>
          Recusar
        </Button>
      </div>
    </Modal>
  );
}
