// O diálogo de convite de party (#404, D7 do ADR 0035): aparece em QUALQUER tela — Cidade ou
// hunt — porque quem convida pode já estar caçando e o convite precisa chegar onde o jogador
// estiver. Montado incondicionalmente pelo `Shell`, como `VocationChoice`: é o próprio estado
// (`party.invites`) que decide se há o que desenhar.
//
// Desde a #502 o `invites[]` do `/mine` é a UNION do servidor: o convite TRADICIONAL aponta
// para uma party (`partyId`) e o SOCIAL (#502) não — a party dele nasce, se precisar, no
// aceite. Este diálogo ramifica pela forma (RF-05): o tradicional segue `acceptInvite`/
// `declineInvite` de sempre; o social segue `acceptSocialInvite` (o `enterOrForm` da store,
// DT-04) e "Ignorar" é dispensa LOCAL (`dismissedSocial`, DT-05 — sem endpoint novo). A recusa
// tipada do aceite (`invite-expired`, `inviter-in-hunt`, `invite-not-found`, …) chega em
// `party.error` e aparece no corpo (RF-06).

import { useStoreSlice } from '../state/useSlice.js';
import { party, partyActions } from '../party/store.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

export function PartyInviteDialog() {
  const invite = useStoreSlice(party, (state) => state.invites[0] ?? null);
  const error = useStoreSlice(party, (state) => state.error);
  if (invite === null) return null;

  // A union discrimina por PRESENÇA DE CAMPO (#503): `partyId` é o convite de sempre;
  // `inviteId` é o social.
  if ('partyId' in invite) {
    return (
      <Modal
        open
        title={`Convite para Party — ${invite.leaderName} convidou você`}
        onClose={() => { void partyActions.declineInvite(invite.partyId); }}
        width={360}
      >
        {error !== null && <p className="system-error">{error}</p>}
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

  return (
    <Modal
      open
      title={`Convite para Party — ${invite.leaderName} convidou você`}
      onClose={() => { partyActions.dismissSocialInvite(invite.inviteId); }}
      width={360}
    >
      {error !== null && <p className="system-error">{error}</p>}
      <div className="party-invite-actions">
        <Button variant="primary" onClick={() => { void partyActions.acceptSocialInvite(invite.inviteId); }}>
          Aceitar
        </Button>
        <Button variant="ghost" onClick={() => { partyActions.dismissSocialInvite(invite.inviteId); }}>
          Ignorar
        </Button>
      </div>
    </Modal>
  );
}
