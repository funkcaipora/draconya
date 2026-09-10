// A conexão em curso, para quem precisa MANDAR (FUN-79).
//
// Existe porque a conexão nasce e morre num efeito (`useConnection`), e quem manda intenção é
// um botão em qualquer lugar da árvore. Passar o `send` por props atravessaria seis componentes
// que não têm nada a ver com socket; contexto do React resolveria, e traria o socket para dentro
// do ciclo de render, que é justamente o que o ADR 0007 mantém fora.
//
// **Uma conexão por vez.** O cliente tem um personagem em jogo, e é o modelo de sessão: dois
// sockets abertos seriam duas sessões do mesmo personagem, que o servidor já recusa.

import type { C2SMessage } from '@draconya/protocol';

let current: { send(message: C2SMessage): void } | null = null;

export function setConnection(connection: { send(message: C2SMessage): void } | null): void {
  current = connection;
}

/**
 * Manda uma intenção, se houver conexão.
 *
 * Silencioso quando não há: o botão pode ser clicado no instante entre uma queda e a volta, e
 * derrubar a tela por isso seria transformar um piscar de rede em erro de jogo. A reconexão
 * reanexa à MESMA sessão (ADR 0001), então o que se perde é o clique, não o estado.
 */
export function sendIntent(message: C2SMessage): boolean {
  if (current === null) return false;
  current.send(message);
  return true;
}
