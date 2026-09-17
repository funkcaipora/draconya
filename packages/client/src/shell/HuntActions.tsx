// As duas pills sobre o mundo (#259, ADR 0029 D3/D6): "Escolher caçada" na Cidade, "Sair da
// caçada" na hunt. Substitui o "sair da hunt" que morava dentro do antigo menu de hunts, fixo na
// coluna esquerda. O "»" no fim do texto de saída é decorativo aqui — o chevron interativo do
// popover "Sair sozinho quando…" (`ExitRulesPopover`, #260/DS-17) é um botão à parte, autocontido
// (RF-09/DT-04): esta issue só adiciona a linha que o renderiza.

import { useEffect, useState } from 'react';
import type { C2SMessage } from '@draconya/protocol';
import { sendIntent } from '../net/current.js';
import { ExitRulesPopover } from './ExitRulesPopover.js';
import { HuntDetailsModal } from './HuntDetailsModal.js';
import { setCurrentHunt } from './current-hunt.js';

/**
 * Manda `leave-hunt` (opcode 10), exportada para teste direto — `prerender` não dispara clique
 * de verdade (mesmo limite de `HuntsModal.tsx`/`VocationChoice.test.ts`).
 */
export function leaveHunt(send: (message: C2SMessage) => boolean): boolean {
  return send({ type: 'leave-hunt' });
}

export function HuntActions({ hunting, onChoose }: { hunting: boolean; onChoose: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

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
        <button type="button" className="hunt-pill hunt-pill-danger"
          onClick={() => { leaveHunt(sendIntent); setCurrentHunt(null); }}>
          <span aria-hidden="true">↩</span> Sair da caçada <span aria-hidden="true">»</span>
        </button>
        <ExitRulesPopover />
      </div>
      <HuntDetailsModal open={detailsOpen} onClose={() => { setDetailsOpen(false); }} />
    </>
  );
}
