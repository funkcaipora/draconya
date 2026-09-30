// A pill de saída pendente (#802): no lugar de "Sair da caçada" enquanto o servidor espera para
// concluir a saída — a contagem do `exitDelayMs`, e depois a janela de combate de 60 s (a do
// `CONDITION_INFIGHT` do Canary, #625). A tela só ESPELHA o `exit-pending` (invariante 4): quem
// conclui a saída, e quando, é o servidor; o cliente manda `leave-hunt` para pedir e
// `cancel-exit` para desistir.
//
// Só a saída MANUAL se desfaz. A que uma regra do bot disparou aparece igual, mas sem o
// "Cancelar": a regra dispararia de novo enquanto a condição valesse, e desfazê-la na tela seria
// prometer o que o servidor não cumpre.

import type { C2SMessage } from '@draconya/protocol';
import { sendIntent } from '../net/current.js';
import type { ExitPendingView } from '../state/hud.js';
import { useElapsedMs } from './Analyzer.js';

/**
 * Manda `cancel-exit` (opcode 34), exportada para teste direto — `prerender` não dispara clique
 * de verdade (mesmo limite de `leaveHunt` em `HuntActions.tsx`).
 */
export function cancelExit(send: (message: C2SMessage) => boolean): boolean {
  return send({ type: 'cancel-exit' });
}

/** "47 s" até um minuto, "1:05" a partir dele. O teto é a janela de combate: 60 s. */
function clockOf(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  if (totalSeconds < 60) return `${String(totalSeconds)} s`;
  const seconds = totalSeconds % 60;
  return `${String(Math.floor(totalSeconds / 60))}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * O texto da pill. `elapsedMs` é o tempo LOCAL desde que a mensagem chegou: o servidor manda uma
 * DURAÇÃO (`remainingMs`), e a contagem entre duas mensagens é do cliente. Em combate o número é
 * uma previsão — cada golpe novo o empurra, e o servidor reenvia a mensagem quando isso acontece.
 */
export function exitPendingLabel(pending: ExitPendingView, elapsedMs: number): string {
  const clock = clockOf(pending.remainingMs - elapsedMs);
  return pending.phase === 'in-combat'
    ? `Em combate · saindo em ${clock}`
    : `Saindo em ${clock}`;
}

export function HuntExitPending({ pending }: { pending: ExitPendingView }) {
  const elapsedMs = useElapsedMs(0, pending.receivedAtMs, true);
  const label = exitPendingLabel(pending, elapsedMs);
  if (pending.reason !== 'manual-exit') {
    return (
      <div className="hunt-pill hunt-pill-danger hunt-pill-pending" role="status">
        <span aria-hidden="true">↩</span> {label}
      </div>
    );
  }
  return (
    <button type="button" className="hunt-pill hunt-pill-danger hunt-pill-pending"
      title="Cancelar a saída" onClick={() => { cancelExit(sendIntent); }}>
      <span aria-hidden="true">↩</span> {label} · Cancelar
    </button>
  );
}
