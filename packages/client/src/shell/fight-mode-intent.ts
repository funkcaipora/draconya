// A intenção de trocar a postura de luta (M30-03, #550). PURA: só monta a MENSAGEM e a entrega a
// quem manda (`send`), como `promoteVocation` — o cliente diz QUAL postura, e o efeito dela
// (fator de ataque, de defesa e de mitigação) é do servidor (invariante 4). Nada aqui atualiza o
// HUD: a marca do botão só troca quando o `player-stats` do servidor confirma.

import type { C2SMessage, FightModeName } from '@draconya/protocol';

/** Devolve o que `send` devolveu: `false` é socket fechado, e a escolha não saiu. */
export function chooseFightMode(
  send: (message: C2SMessage) => boolean, mode: FightModeName,
): boolean {
  return send({ type: 'set-fight-mode', mode });
}
