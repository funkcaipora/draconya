// A decisão de qual intenção o menu de contexto "Usar"/"Usar com…" manda (#726, ADR 0049
// decisão 3), no mesmo molde PURO de `drag-intent.ts`: sem React, sem socket, testável com
// `prerender`/chamada direta. "Usar com…" não produz mensagem aqui — arma a MIRA
// (`state/aim.ts`, `startAimForItem`) e o clique seguinte no mundo/Batalha é quem manda
// `use-item-on`; só "Usar" (sem alvo) é uma decisão de mensagem imediata.

import type { C2SMessage } from '@draconya/protocol';

export type UseItemRef = { readonly instanceId: string } | { readonly supplyId: string };

/** A intenção de "Usar" — direto, sem mira (#726). */
export function useIntent(ref: UseItemRef, seq: number): C2SMessage {
  return { type: 'use-item', ref, seq };
}

/**
 * Só um item `kind: 'consumable'` pode ser usado pelo menu — arma, armadura, anel… não têm
 * `use.effect` nenhum, e oferecer "Usar" para eles seria um botão que o servidor sempre recusa
 * `not-usable`. `kind` chega como `string | undefined` porque o catálogo do cliente não repete
 * o vocabulário fechado de `content` (fronteira do pacote, como o resto do protocolo).
 */
export function isUsable(kind: string | undefined): boolean {
  return kind === 'consumable';
}
