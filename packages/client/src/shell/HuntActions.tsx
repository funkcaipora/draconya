// As pills sobre o mundo (#259, #325): "Escolher caçada" na Cidade; "Detalhes da caçada" e
// "Sair da caçada" na hunt, nesta ordem. "Despachar loot" fica fora até E5: não há venda por
// item nem raridade para a ação representar. O modal é IRMÃO de `div.hunt-actions`, nunca filho:
// o contêiner deixa os cliques passarem ao mundo, e essa propriedade herdada tornaria o scrim
// inteiro inclicável.
//
// Sob a hunt, a saída e o chevron de regras (`ExitRulesPopover`, #260/DS-17) continuam um botão
// partido. `hunt-exit-actions` os mantém colados, enquanto a pill de detalhes fica separada à
// esquerda como no kit.

import { useEffect, useState } from 'react';
import type { C2SMessage } from '@draconya/protocol';
import { sendIntent } from '../net/current.js';
import { ExitRulesPopover } from './ExitRulesPopover.js';
import { HuntDetailsModal } from './HuntDetailsModal.js';

/**
 * Manda `leave-hunt` (opcode 10), exportada para teste direto — `prerender` não dispara clique
 * de verdade (mesmo limite de `HuntsModal.tsx`/`VocationChoice.test.ts`).
 */
export function leaveHunt(send: (message: C2SMessage) => boolean): boolean {
  return send({ type: 'leave-hunt' });
}

export function HuntActions({ hunting, onChoose }: { hunting: boolean; onChoose: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Sair por qualquer motivo não deve fazer o modal reaparecer na próxima hunt com estado de
  // apresentação velho — `detailsOpen` é só isto, se o painel está expandido; a identidade da
  // hunt em si (SV-05) é do servidor, em `hud.huntId`, e não precisa de limpeza daqui.
  useEffect(() => {
    if (!hunting) setDetailsOpen(false);
  }, [hunting]);

  if (!hunting) {
    return (
      <div className="hunt-actions">
        <button type="button" className="hunt-pill" onClick={onChoose}>
          <span aria-hidden="true">⚔</span> Escolher caçada
        </button>
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
          <button type="button" className="hunt-pill hunt-pill-danger"
            onClick={() => { leaveHunt(sendIntent); }}>
            <span aria-hidden="true">↩</span> Sair da caçada
          </button>
          <ExitRulesPopover />
        </div>
      </div>
      <HuntDetailsModal open={detailsOpen} onClose={() => { setDetailsOpen(false); }} />
    </>
  );
}
