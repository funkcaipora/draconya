// "Em hunt" (RF-02): o MESMO cálculo do `Shell` (#259) — o `sessionType` do analisador é o que
// o servidor disse por último, e o cliente não adivinha onde está. Puro: quem lê a fatia do HUD
// é a casca (`FriendsModal`); daqui só sai a decisão apresentada, nunca regra de jogo.

/**
 * `true` quando o personagem está numa sessão que NÃO é a Cidade, o Treino nem o mundo — caçada ou conteúdo
 * manual. O Treino (#631) é uma sessão privada como a hunt, mas não caça: não tem analisador, nem
 * "Sair da caçada", nem party — a casca desenha o estado dele à parte (`TrainingStatus`).
 *
 * **O mundo (`'world'`, #846, OW-23, ADR 0060) também NÃO é uma hunt**: é a sessão compartilhada em que se
 * entra pela fila e da qual se sai por logout, não uma instância com "Sair da caçada", party loot e regras de
 * saída. Antes desta função o `'world'` caía no `!== 'city'` e a casca o trataria como caçada.
 */
export function isHunting(sessionType: string | null): boolean {
  return sessionType !== null
    && sessionType !== 'city'
    && sessionType !== 'training'
    && sessionType !== 'world';
}

/**
 * O personagem está no MUNDO aberto (#846, OW-23): a sessão compartilhada do Tibia sem PvP, atrás de
 * `OPEN_WORLD`. O mesmo critério de `isHunting` — o `sessionType` que o servidor mandou, nunca um palpite.
 */
export function isWorld(sessionType: string | null): boolean {
  return sessionType === 'world';
}
