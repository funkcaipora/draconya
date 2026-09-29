// "Em hunt" (RF-02): o MESMO cálculo do `Shell` (#259) — o `sessionType` do analisador é o que
// o servidor disse por último, e o cliente não adivinha onde está. Puro: quem lê a fatia do HUD
// é a casca (`FriendsModal`); daqui só sai a decisão apresentada, nunca regra de jogo.

/** `true` quando o personagem está numa sessão que NÃO é a Cidade — caçada ou conteúdo manual. */
export function isHunting(sessionType: string | null): boolean {
  return sessionType !== null && sessionType !== 'city';
}
