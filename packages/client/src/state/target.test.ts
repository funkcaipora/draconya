// O alvo otimista e a reconciliação por `seq` (#471, M24-03).
//
// Os testes chamam `createTargetTracker()` direto — sem socket e sem React —, porque a decisão
// (otimista, toggle, ack obsoleto, rollback) é lógica pura sobre o `hud`. O `sendIntent` entra
// como espião, que é o que o parâmetro `sendSocket` existe para permitir.

import type { C2SMessage } from '@draconya/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_HUD, hud } from './hud.js';
import { createTargetTracker, type TargetSender } from './target.js';

/** O `seq` que o rastreador mandou, na ordem. */
function senderSpy(): { send: TargetSender; seqs: number[]; creatureIds: number[] } {
  const seqs: number[] = [];
  const creatureIds: number[] = [];
  const send: TargetSender = (message: C2SMessage) => {
    if (message.type !== 'select-target') return;
    creatureIds.push(message.creatureId);
    if (message.seq !== undefined) seqs.push(message.seq);
  };
  return { send, seqs, creatureIds };
}

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
});

describe('o alvo otimista (#471)', () => {
  it('clique numa criatura pinta a moldura ANTES do envio (RF-01)', () => {
    // O `sendSocket` lê o HUD: se o alvo não estivesse posto ainda, `seen` seria null. É o
    // critério literal — "atualizado sincronamente antes do envio do socket".
    const tracker = createTargetTracker();
    const seenInsideSend: Array<number | null> = [];
    const send: TargetSender = () => { seenInsideSend.push(hud.get().targetId); };

    tracker.selectTarget(5, send);

    expect(hud.get().targetId).toBe(5);
    expect(seenInsideSend).toEqual([5]);
  });

  it('o segundo clique no MESMO alvo cancela: limpa a moldura e manda creatureId 0 (RF-02)', () => {
    const tracker = createTargetTracker();
    const { send, seqs, creatureIds } = senderSpy();

    tracker.selectTarget(5, send);
    tracker.handleTargetChanged(5);
    tracker.selectTarget(5, send);

    expect(hud.get().targetId).toBeNull();
    expect(creatureIds).toEqual([5, 0]);
    expect(seqs[1]).toBeGreaterThan(seqs[0] ?? 0);
  });

  it('clicar em OUTRA criatura só troca o alvo, sem cancelar', () => {
    const tracker = createTargetTracker();
    const { send, creatureIds } = senderSpy();

    tracker.selectTarget(5, send);
    tracker.handleTargetChanged(5);
    tracker.selectTarget(9, send);

    expect(hud.get().targetId).toBe(9);
    expect(creatureIds).toEqual([5, 9]);
  });

  it('o `seq` é monotônico e nunca reusado', () => {
    const tracker = createTargetTracker();
    const { send, seqs } = senderSpy();

    tracker.selectTarget(1, send);
    tracker.selectTarget(2, send);
    tracker.selectTarget(3, send);

    expect(seqs).toEqual([1, 2, 3]);
  });
});

describe('a reconciliação por `seq` (#471, RF-03)', () => {
  it('ack confirma o alvo', () => {
    const tracker = createTargetTracker();
    tracker.handleTargetChanged(7, 1);
    expect(hud.get().targetId).toBe(7);
  });

  it('ack OBSOLETO (seq menor que o último aplicado) não sobrescreve o alvo novo', () => {
    // Alternância rápida A→B sob latência: o ack de A chega depois do de B e não pode voltar
    // a moldura para A. Mutação que mata: trocar `<` por `<=` no guard (deixaria A aplicar).
    const tracker = createTargetTracker();
    const { send } = senderSpy();

    tracker.selectTarget(1, send);
    tracker.selectTarget(2, send);
    tracker.handleTargetChanged(2, 2);
    expect(hud.get().targetId).toBe(2);

    tracker.handleTargetChanged(1, 1);
    expect(hud.get().targetId).toBe(2);
  });

  it('target-changed SEM seq (auto-target do bot) aplica sempre', () => {
    // A troca que o servidor fez sozinho não tem seq; ela NÃO pode ser tratada como obsoleta,
    // senão a moldura divergiria da decisão do `sim` (edge case da §7 da issue).
    const tracker = createTargetTracker();
    tracker.handleTargetChanged(2, 2);
    tracker.handleTargetChanged(9);
    expect(hud.get().targetId).toBe(9);
  });

  it('target-changed null limpa a moldura (cancelamento confirmado)', () => {
    const tracker = createTargetTracker();
    tracker.handleTargetChanged(5, 1);
    tracker.handleTargetChanged(null, 2);
    expect(hud.get().targetId).toBeNull();
  });
});

describe('a recusa (#471, RF-04)', () => {
  it('target-cancel da última tentativa devolve o alvo CONFIRMADO, não a seleção otimista', () => {
    // O servidor recusou a criatura 9 (morta/inválida). A moldura volta para o alvo 5, que era
    // a última verdade do servidor. Mutação que mata: rollback para `null` fixo.
    const tracker = createTargetTracker();
    const { send, seqs } = senderSpy();

    tracker.handleTargetChanged(5, 1);
    tracker.selectTarget(9, send);
    expect(hud.get().targetId).toBe(9);

    tracker.handleTargetCancel(seqs[0]);
    expect(hud.get().targetId).toBe(5);
  });

  it('sem alvo confirmado, a recusa volta para null', () => {
    const tracker = createTargetTracker();
    const { send, seqs } = senderSpy();

    tracker.selectTarget(9, send);
    tracker.handleTargetCancel(seqs[0]);

    expect(hud.get().targetId).toBeNull();
  });

  it('recusa OBSOLETA não apaga a seleção nova', () => {
    // Clique em 6 (seq 1) e logo em 7 (seq 2); a recusa de 6 chega tarde. O alvo otimista 7
    // fica. Mutação que mata: comparar com qualquer seq já visto em vez do ÚLTIMO mandado.
    const tracker = createTargetTracker();
    const { send, seqs } = senderSpy();

    tracker.selectTarget(6, send);
    tracker.selectTarget(7, send);
    tracker.handleTargetCancel(seqs[0]);

    expect(hud.get().targetId).toBe(7);
  });

  it('recusa sem seq é tratada como a tentativa corrente (nó antigo)', () => {
    const tracker = createTargetTracker();
    const { send } = senderSpy();

    tracker.handleTargetChanged(5);
    tracker.selectTarget(9, send);
    tracker.handleTargetCancel();

    expect(hud.get().targetId).toBe(5);
  });
});

describe('a limpeza na morte e no reanexo (#471, RF-05)', () => {
  it('handleTargetGone limpa o alvo sumido na hora', () => {
    const tracker = createTargetTracker();
    tracker.handleTargetChanged(5);
    tracker.handleTargetGone(5);
    expect(hud.get().targetId).toBeNull();
  });

  it('handleTargetGone de OUTRA criatura não mexe no alvo atual', () => {
    const tracker = createTargetTracker();
    tracker.handleTargetChanged(5);
    tracker.handleTargetGone(6);
    expect(hud.get().targetId).toBe(5);
  });

  it('reset descarta o alvo confirmado: a recusa seguinte não o ressuscita', () => {
    // A reanexação (#session-state) troca de sessão. O alvo confirmado da anterior não pode
    // voltar num rollback de `target-cancel`.
    const tracker = createTargetTracker();
    tracker.handleTargetChanged(5, 1);
    tracker.reset();
    tracker.handleTargetCancel();

    expect(hud.get().targetId).toBeNull();
  });

  it('não avisa quando o alvo não muda', () => {
    // Reafirmar o mesmo alvo não pode redesenhar a Battle List nem o Viewport.
    const tracker = createTargetTracker();
    tracker.handleTargetChanged(5, 1);
    const notified = vi.fn();
    hud.subscribe(notified);
    tracker.handleTargetChanged(5, 2);
    expect(notified).not.toHaveBeenCalled();
  });
});