// Qual selo o ícone "Chat" da TopBar acende (#323, RC-10, ADR 0030 §3): o chat nasce fechado,
// e uma `system-message` que chega enquanto ele está fechado precisa de sinal visível. PURA,
// sem React nem DOM: os testes de tela usam `prerender`, que não dispara clique nenhum.
//
// O kit não desenha chat na tela renderizada. A escolha de cor por severidade usa os tokens já
// existentes: `error` é a única interrupção real e vira ponto sólido; `info` e `warning` viram
// brilho dourado, sem criar uma terceira variante que o desenho não pede.

import type { SystemLine } from '../state/hud.js';

export type ChatBadgeTier = 'gold' | 'danger';

/**
 * `seenAtMs` usa o mesmo relógio de `SystemLine.atMs`: `performance.now()`, nunca `Date.now()`.
 * Não há selo quando o chat está aberto ou quando a última mensagem já foi vista.
 */
export function chatBadgeTier(
  systemMessages: readonly SystemLine[],
  chatOpen: boolean,
  seenAtMs: number,
): ChatBadgeTier | null {
  if (chatOpen) return null;
  const latest = systemMessages.at(-1);
  if (latest === undefined || latest.atMs <= seenAtMs) return null;
  return latest.level === 'error' ? 'danger' : 'gold';
}
