// As pills sobre o mundo (#259, #325): "Escolher caçada" na Cidade; "Detalhes da caçada" e
// "Sair da caçada" na hunt, nesta ordem. "Despachar loot" fica fora até E5: não há venda por
// item nem raridade para a ação representar. O modal é IRMÃO de `div.hunt-actions`, nunca filho:
// o contêiner deixa os cliques passarem ao mundo, e essa propriedade herdada tornaria o scrim
// inteiro inclicável.
//
// Sob a hunt, a saída e o chevron de regras (`ExitRulesPopover`, #260/DS-17) continuam um botão
// partido. `hunt-exit-actions` os mantém colados, enquanto a pill de detalhes fica separada à
// esquerda como no kit.
//
// No MUNDO (#846, OW-23) a faixa é a da Cidade com um rótulo próprio — "Caçar (idle)", porque entrar numa hunt
// do mundo é sair dele para a hunt idle — e mais uma pill, "Sair do jogo": é o `logout` do Tibia, que o
// servidor pode recusar (`logout-refused`) em luta ou num tile que proíbe sair. Só o mundo a tem: na Cidade e
// na hunt sair do jogo nunca foi uma ação da tela, e a hunt tem a própria saída.
//
// Com uma saída PENDENTE (#802 — o servidor espera a contagem do `exitDelayMs` e a janela de
// combate), a pill de saída dá lugar à `HuntExitPending`: o estado e, na saída manual, o cancelar.

import { useEffect, useState } from 'react';
import type { C2SMessage } from '@draconya/protocol';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import { ExitRulesPopover } from './ExitRulesPopover.js';
import { HuntDetailsModal } from './HuntDetailsModal.js';
import { HuntExitPending } from './HuntExitPending.js';
import { TrainingStatus } from './TrainingStatus.js';

/**
 * Manda `leave-hunt` (opcode 10), exportada para teste direto — `prerender` não dispara clique
 * de verdade (mesmo limite de `HuntsModal.tsx`/`VocationChoice.test.ts`).
 */
export function leaveHunt(send: (message: C2SMessage) => boolean): boolean {
  return send({ type: 'leave-hunt' });
}

/**
 * Manda `logout` (#846, OW-23): o jogador pede para sair do jogo, e quem decide se pode é o servidor
 * (`canLogout`, ADR 0060 d.7) — aceito, ele fecha a conexão; recusado, responde `logout-refused`. Exportada
 * para teste direto, como `leaveHunt`.
 */
export function logoutOfGame(send: (message: C2SMessage) => boolean): boolean {
  return send({ type: 'logout' });
}

export function HuntActions({ hunting, training = false, world = false, onChoose, onTraining }: {
  hunting: boolean;
  /** O personagem está numa sessão de Treino (#631): mostra o estado dela, não as pills de caçada. */
  training?: boolean;
  /** O personagem está no mundo aberto (#846, OW-23): "Caçar (idle)" e "Sair do jogo". */
  world?: boolean;
  onChoose: () => void;
  /** Abre a tela de Treino (#631) — só na Cidade. Ausente: o pill "Treino" não existe. */
  onTraining?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const exitPending = useHudSlice((state) => state.exitPending);
  const hasTraining = useHudSlice((state) => state.catalogue?.training !== undefined);

  // Sair por qualquer motivo não deve fazer o modal reaparecer na próxima hunt com estado de
  // apresentação velho — `detailsOpen` é só isto, se o painel está expandido; a identidade da
  // hunt em si (SV-05) é do servidor, em `hud.huntId`, e não precisa de limpeza daqui.
  useEffect(() => {
    if (!hunting) setDetailsOpen(false);
  }, [hunting]);

  if (training) return <TrainingStatus />;
  if (!hunting) {
    return (
      <div className="hunt-actions">
        <button type="button" className="hunt-pill" onClick={onChoose}>
          <span aria-hidden="true">⚔</span> {world ? 'Caçar (idle)' : 'Escolher caçada'}
        </button>
        {/* O Treino (#631): só com o servidor que o tem (`catalogue.training`) e só na Cidade. */}
        {onTraining !== undefined && hasTraining && (
          <button type="button" className="hunt-pill training-pill" onClick={onTraining}>
            <span aria-hidden="true">⚒</span> Treino
          </button>
        )}
        {/* `.training-stop` fecha os 4 cantos do `.hunt-pill-danger` (que é a metade de um botão partido). */}
        {world && (
          <button type="button" className="hunt-pill hunt-pill-danger training-stop"
            onClick={() => { logoutOfGame(sendIntent); }}>
            <span aria-hidden="true">✕</span> Sair do jogo
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="hunt-actions">
        <button type="button" className="hunt-pill" onClick={() => { setDetailsOpen(true); }}>
          <span aria-hidden="true" className="hunt-pill-icon">i</span> Detalhes da caçada
        </button>
        <div className="hunt-exit-actions">
          {exitPending === null ? (
            <button type="button" className="hunt-pill hunt-pill-danger"
              onClick={() => { leaveHunt(sendIntent); }}>
              <span aria-hidden="true">↩</span> Sair da caçada
            </button>
          ) : <HuntExitPending pending={exitPending} />}
          <ExitRulesPopover />
        </div>
      </div>
      <HuntDetailsModal open={detailsOpen} onClose={() => { setDetailsOpen(false); }} />
    </>
  );
}
