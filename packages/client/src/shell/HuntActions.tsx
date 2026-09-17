// As duas pills sobre o mundo (#259, ADR 0029 D3/D6): "Escolher caçada" na Cidade, "Sair da
// caçada" na hunt. Substitui o "sair da hunt" que morava dentro do antigo menu de hunts, fixo na
// coluna esquerda. Sob a hunt, a pill "Sair da caçada" e o chevron do popover "Sair sozinho
// quando…" (`ExitRulesPopover`, #260/DS-17) formam um ÚNICO botão partido, colado, como o
// `chev()` do kit desenha (#309, ADR 0030 — achado "pill+chevron como botão partido", um só
// "»") — a colagem é só CSS (`.hunt-pill-danger` + `.hunt-actions{gap:0}` em `shell.css`); o
// chevron continua um componente à parte, autocontido (RF-09/DT-04): esta issue só ajusta a
// classe da pill e remove o "»" duplicado do texto — quem desenha o "»" interativo é só o
// `ExitRulesPopover`.

import type { C2SMessage } from '@draconya/protocol';
import { sendIntent } from '../net/current.js';
import { ExitRulesPopover } from './ExitRulesPopover.js';

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
        <span aria-hidden="true">↩</span> Sair da caçada
      </button>
      <ExitRulesPopover />
    </div>
  );
}
