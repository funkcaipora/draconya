// O alvo otimista e a reconciliação por `seq` (#471, M24-03).
//
// O cliente antecipa a moldura vermelha no MESMO quadro do clique (RF-01), mas o servidor
// continua sendo a autoridade (invariante 4): `select-target` é intenção, e `target-changed` /
// `target-cancel` são a confirmação e a recusa. O `seq` monotônico por cliente é o que permite
// descartar a resposta obsoleta depois de uma alternância rápida entre criaturas (RF-03) — a
// mesma propriedade que o `SessionHost` mantém do outro lado (#470).
//
// Este módulo NÃO importa `net/` (ADR 0007), pela mesma razão da `bot/store.ts`: a conexão nasce
// e morre num efeito, e a store não pode depender dela. Quem manda a intenção entra por
// parâmetro — o shell (Viewport/BattlePanel) passa `sendIntent`.

import type { C2SMessage } from '@draconya/protocol';
import { hud } from './hud.js';

/** Manda uma intenção C2S. O shell passa `sendIntent`; o teste, um espião. */
export type TargetSender = (message: C2SMessage) => void;

export interface TargetTracker {
  /**
   * O clique numa criatura, no Viewport ou na linha da Batalha. O MESMO alvo já selecionado
   * CANCELA (RF-02, DT-01): no fio vira `creatureId: 0`, como o `cancelAttack()` do OTClient.
   * A moldura muda antes do envio; o servidor decide se a intenção vale.
   */
  selectTarget(creatureId: number, sendSocket: TargetSender): void;
  /**
   * O alvo autoritativo confirmado pelo servidor (ou a troca do auto-target). `seq` ausente é
   * auto-target; presente é o ack do `select-target`, e um `seq` anterior a um já aplicado é
   * resposta atrasada e é descartado (RF-03).
   */
  handleTargetChanged(creatureId: number | null, seq?: number): void;
  /**
   * A recusa do `select-target` (criatura morta ou inválida): desfaz a seleção otimista e
   * devolve a moldura ao último alvo que o SERVIDOR confirmou — ou `null`, se não havia nenhum.
   * Só a recusa da última tentativa desfaz; uma antiga chegando tarde não apaga a seleção nova.
   */
  handleTargetCancel(seq?: number): void;
  /**
   * A criatura sumiu (morte/despawn): limpa a moldura sem esperar o servidor (RF-05). Não é
   * `target-changed { null }` porque a criatura pode sumir por interest management, e o alvo
   * some junto.
   */
  handleTargetGone(creatureId: number): void;
  /** A sessão reanexou (novo `session-state`): o alvo da anterior não pode sobreviver nem voltar. */
  reset(): void;
}

/**
 * O rastreador de uma conexão. Métodos puros sobre o `hud` — sem I/O e sem relógio —, o que o
 * torna testável sem socket.
 */
export function createTargetTracker(): TargetTracker {
  /** O maior `seq` já aplicado (ack ou recusa); menor que ele é resposta obsoleta (RF-03). */
  let lastAppliedSeq = 0;
  /** O último alvo que o SERVIDOR confirmou. É para cá que a recusa faz rollback. */
  let authoritativeTargetId: number | null = null;
  /** O último `seq` que ESTE cliente mandou. Só o cancel dessa tentativa desfaz o otimista. */
  let lastSentSeq: number | null = null;
  /** Monotônico e nunca reusado: o servidor ignora `seq < last` que já processou (#470). */
  let nextSeq = 1;

  /** Escreve o alvo no HUD. O `createStore` já não notifica quando o objeto não muda. */
  const setTarget = (creatureId: number | null): void => {
    hud.set((state) => (state.targetId === creatureId ? state : { ...state, targetId: creatureId }));
  };

  return {
    selectTarget(creatureId, sendSocket) {
      const current = hud.get().targetId;
      const cancel = current !== null && current === creatureId;
      const next = cancel ? null : creatureId;
      const seq = nextSeq;
      nextSeq += 1;
      lastSentSeq = seq;
      // Otimista ANTES do envio (RF-01): a moldura aparece no mesmo quadro do clique, sem
      // esperar a ida e volta.
      setTarget(next);
      sendSocket({ type: 'select-target', creatureId: cancel ? 0 : creatureId, seq });
    },

    handleTargetChanged(creatureId, seq) {
      if (seq !== undefined) {
        if (seq < lastAppliedSeq) return;
        lastAppliedSeq = seq;
      }
      authoritativeTargetId = creatureId;
      setTarget(creatureId);
    },

    handleTargetCancel(seq) {
      // `seq` ausente é um nó antigo; trata como a tentativa corrente pela regra de sempre.
      if (seq !== undefined && seq !== lastSentSeq) return;
      setTarget(authoritativeTargetId);
    },

    handleTargetGone(creatureId) {
      if (authoritativeTargetId === creatureId) authoritativeTargetId = null;
      if (hud.get().targetId === creatureId) setTarget(null);
    },

    reset() {
      lastAppliedSeq = 0;
      authoritativeTargetId = null;
      lastSentSeq = null;
      nextSeq = 1;
    },
  };
}

/**
 * O rastreador da conexão em curso. Único, como `net/current.ts`: o cliente tem um personagem em
 * jogo, e o `apply.ts` e a casca precisam falar do MESMO alvo.
 */
export const targetTracker = createTargetTracker();