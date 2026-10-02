// O `logout-refused` em palavras (#846, OW-23, ADR 0060 d.7). Puro, e em `state/` porque DOIS lugares o dizem: o
// `apply` (a linha no registro do chat) e a tela (o aviso sobre o mundo e o rodapé do `HuntsModal`).
//
// Os dois motivos são os do `canLogout` do Canary (`canary/src/server/network/protocol/protocolgame.cpp:
// 1151-1162`): o tile proíbe sair (`RETURNVALUE_YOUCANNOTLOGOUTHERE`) ou o personagem está em luta fora da PZ
// (`RETURNVALUE_YOUMAYNOTLOGOUTDURINGAFIGHT`). O mesmo veredicto vale para entrar numa hunt idle a partir do
// mundo (ADR 0060 d.6a: só onde o Tibia deixaria deslogar), e por isso há uma frase para cada contexto.

import type { LogoutRefusedReason } from '@draconya/protocol';

/** A recusa de `logout`: "Você não pode sair…" — as duas frases do Canary, em português. */
export function logoutRefusalText(reason: LogoutRefusedReason): string {
  return reason === 'in-fight'
    ? 'Você não pode sair durante uma luta.'
    : 'Você não pode sair daqui.';
}

/**
 * A mesma recusa quando quem a provocou foi o pedido de entrar numa hunt idle (a saída do mundo para uma
 * instância passa por `canLogout`, ADR 0060 d.6a): a frase diz o que o jogador tentou, não o que o servidor
 * checou — "sair" não é o que ele clicou.
 */
export function huntEntryRefusalText(reason: LogoutRefusedReason): string {
  return reason === 'in-fight'
    ? 'Você não pode entrar numa caçada durante uma luta.'
    : 'Você não pode entrar numa caçada daqui.';
}

/** Quanto o aviso de recusa fica sobre o mundo: o tempo de uma linha de status do Tibia. */
export const EXIT_REFUSAL_NOTICE_MS = 5_000;
