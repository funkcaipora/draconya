// As duas pills sobre o mundo (#259, ADR 0029 D3/D6): "Escolher caçada" na Cidade, "Sair da
// caçada" na hunt. Substitui o "sair da hunt" que morava dentro do antigo menu de hunts, fixo na
// coluna esquerda. O "»" no fim do texto de saída é decorativo aqui — vira botão interativo (o
// popover "Sair sozinho quando…") só na #260 (DS-17); esta issue não adiciona nenhum `sendIntent`
// além do `leave-hunt` de sempre.

import type { C2SMessage } from '@draconya/protocol';
import { sendIntent } from '../net/current.js';

/**
 * Manda `leave-hunt` (opcode 10), exportada para teste direto — `prerender` não dispara clique
 * de verdade (mesmo limite de `HuntsModal.tsx`/`VocationChoice.test.ts`).
 */
export function leaveHunt(send: (message: C2SMessage) => boolean): boolean {
  return send({ type: 'leave-hunt' });
}

export function HuntActions({ hunting, onChoose }: { hunting: boolean; onChoose: () => void }) {
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
    <div className="hunt-actions">
      <button type="button" className="hunt-pill hunt-pill-danger"
        onClick={() => { leaveHunt(sendIntent); }}>
        <span aria-hidden="true">↩</span> Sair da caçada <span aria-hidden="true">»</span>
      </button>
    </div>
  );
}
