// A fila do mundo cheio (#846, OW-23, ADR 0060 d.2b): a tela de quem chegou com o mundo no teto. É a
// `WaitingList` do Canary vista de fora — "Too many players online. You are at place N on the waiting list."
// (`canary/src/server/network/protocol/protocolgame.cpp:1005-1008`) —, e o cliente faz o que o cliente do Tibia faz:
// mostra a posição, espera o tempo que o servidor mandou e tenta de novo SOZINHO (`net/connection.ts`).
//
// Existe no lugar do `Shell`, e não por cima dele: sem sessão não há mundo para desenhar, e a tela de espera é
// a verdade — o personagem está na fila, não "reconectando". Quem decide cada tentativa é o servidor; esta tela
// só mostra a posição e a contagem, e oferece a saída que o plano promete: a hunt idle, que não tem teto.

import { useEffect, useState } from 'react';
import { account } from '../account/store.js';
import { huntInsteadOfWaiting, leaveGame, loadEntryOptions } from '../account/actions.js';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import type { WorldQueueView } from '../state/hud.js';
import { Brand, defaultHuntFor, EntryCard, EntryShell, Heading, huntOptionLabel } from './Entry.js';
import { Button } from './ui/Button.js';
import { Select } from './ui/Select.js';

/** A tela da fila, em números: a posição e quanto falta para a próxima tentativa. */
export interface QueueView {
  readonly position: number;
  readonly remainingMs: number;
  /** Segundos inteiros que a tela mostra (arredonda PARA CIMA: "0 s" só quando de fato é agora). */
  readonly secondsLeft: number;
}

/**
 * O que a fila mostra num instante. `retryAfterMs` é uma DURAÇÃO medida no servidor, e `receivedAtMs` o instante
 * local (`performance.now()`) em que ela chegou — a diferença para `nowMs` é o que ainda falta. PURA.
 */
export function worldQueueView(queue: WorldQueueView, nowMs: number): QueueView {
  const remainingMs = Math.max(0, queue.receivedAtMs + queue.retryAfterMs - nowMs);
  return { position: queue.position, remainingMs, secondsLeft: Math.ceil(remainingMs / 1_000) };
}

/** A frase de posição e espera, em português — a do Canary, com o tempo que o servidor mandou. */
export function queueStatusText(view: QueueView): string {
  return view.secondsLeft > 0
    ? `Você está na posição ${String(view.position)} da fila de espera. Tentando de novo em ${String(view.secondsLeft)} s.`
    : `Você está na posição ${String(view.position)} da fila de espera. Tentando de novo agora.`;
}

/** Relógio da contagem: o mesmo de `applyMessage` (`performance.now()`), amostrado a cada 250 ms. */
function useNowMs(): number {
  const [nowMs, setNowMs] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => { setNowMs(performance.now()); }, 250);
    return () => { clearInterval(id); };
  }, []);
  return nowMs;
}

export function WorldQueue() {
  const queue = useHudSlice((state) => state.worldQueue);
  const options = useStoreSlice(account, (state) => state.entryOptions);
  const entry = useStoreSlice(account, (state) => state.entry);
  const level = useStoreSlice(account, (state) => {
    const playing = state.characters.find((character) => character.id === state.playing);
    return playing?.level ?? 1;
  });
  const nowMs = useNowMs();
  const [huntId, setHuntId] = useState<string | null>(null);

  // A lista de hunts vem do menu de entrada; quem chegou à fila por `?character=` (o atalho de desenvolvimento)
  // nunca passou por ele.
  useEffect(() => {
    if (options === null) void loadEntryOptions();
  }, [options]);

  if (queue === null) return null;
  const view = worldQueueView(queue, nowMs);
  const hunts = options?.hunts ?? [];
  const chosen = hunts.find((hunt) => hunt.id === huntId) ?? defaultHuntFor(hunts, level);
  // Pediu a caçada: a conexão já recomeçou com `entry: { hunt }`. Enquanto a sessão não começa a tela continua
  // aqui, e o botão diz por quê não responde.
  const entering = entry !== 'world';

  return (
    <EntryShell screen="queue" readiness={{ tone: 'warn', label: 'Na fila do mundo' }}>
      <Brand emblem={false} compact />
      <EntryCard>
        <Heading
          kicker="Mundo cheio"
          title="Você está na fila"
          sub="Jogadores demais online. Quem chegou antes entra primeiro."
        />
        <p className="world-queue-status" role="status">{queueStatusText(view)}</p>
        <div className="entry-card-actions">
          {queue.huntAvailable && chosen !== null && (
            <>
              <p className="entry-select-hint">Não quer esperar? A caçada idle não tem fila nem teto.</p>
              <Select
                label="Caçada"
                ariaLabel="Caçada idle"
                size="md"
                inline
                value={chosen.id}
                disabled={entering}
                options={hunts.map((hunt) => ({ value: hunt.id, label: huntOptionLabel(hunt) }))}
                onChange={setHuntId}
              />
              <Button variant="gold" size="lg" block disabled={entering}
                onClick={() => { huntInsteadOfWaiting(chosen.id); }}>
                {entering ? 'ENTRANDO NA CAÇADA…' : 'CAÇAR AGORA'}
              </Button>
            </>
          )}
          <Button variant="text" size="md" block onClick={() => { leaveGame(); }}>
            Sair da fila
          </Button>
        </div>
      </EntryCard>
      <p className="entry-caption">Cada jornada deixa uma história.</p>
    </EntryShell>
  );
}
