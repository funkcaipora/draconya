// O estado de mira do disparo manual (AB-09, ADR 0049 decisão 2, #725).
//
// `createAimTracker()` é chamado direto — sem socket, sem React — porque a decisão (armar,
// resolver, cancelar) é lógica pura. `send` entra como espião.

import type { C2SMessage } from '@draconya/protocol';
import { describe, expect, it } from 'vitest';
import { createAimTracker, type AimSender } from './aim.js';

function senderSpy(): { send: AimSender; sent: C2SMessage[] } {
  const sent: C2SMessage[] = [];
  return { send: (message) => { sent.push(message); }, sent };
}

describe('mira do disparo manual (RF-06/RF-07/RF-08)', () => {
  it('sem mira armada, `isAiming` é falso e `resolveAim` não manda nada (RF-06)', () => {
    const tracker = createAimTracker();
    const { send, sent } = senderSpy();

    expect(tracker.isAiming()).toBe(false);
    expect(tracker.resolveAim(7, send)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('`startAim` arma a mira do slot certo, e o clique seguinte resolve com `use-slot.target` (RF-06/RF-07)', () => {
    const tracker = createAimTracker();
    const { send, sent } = senderSpy();

    tracker.startAim(1, 3);
    expect(tracker.isAiming()).toBe(true);

    expect(tracker.resolveAim(42, send)).toBe(true);
    expect(sent).toEqual([{ type: 'use-slot', set: 1, slot: 3, target: { creatureId: 42 } }]);
    // A mira se desarma depois de resolver — o clique seguinte não repete o disparo.
    expect(tracker.isAiming()).toBe(false);
  });

  it('`cancelAim` desarma sem mandar nada (Esc, RF-08)', () => {
    const tracker = createAimTracker();
    const { send, sent } = senderSpy();

    tracker.startAim(0, 0);
    tracker.cancelAim();

    expect(tracker.isAiming()).toBe(false);
    expect(tracker.resolveAim(1, send)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('`reset` desarma a mira da sessão anterior (session-ended/reconexão, RF-08)', () => {
    const tracker = createAimTracker();
    tracker.startAim(2, 5);

    tracker.reset();

    expect(tracker.isAiming()).toBe(false);
  });

  it('duas miras em sequência não vazam a primeira: a segunda `startAim` substitui', () => {
    const tracker = createAimTracker();
    const { send, sent } = senderSpy();

    tracker.startAim(0, 1);
    tracker.startAim(0, 2); // o jogador clicou outro slot antes de mirar — o novo vence.
    tracker.resolveAim(9, send);

    expect(sent).toEqual([{ type: 'use-slot', set: 0, slot: 2, target: { creatureId: 9 } }]);
  });
});
