// A recusa de subir do `game` com `OPEN_WORLD` e outro `game` vivo (#839, OW-18, ADR 0060 d.2c e d.13).
//
// Um mundo é uma sessão num processo só, e é isso que mantém o invariante 9: nenhum outro processo toca
// o `CharacterRuntime` em memória. Com dois nós `game` e a flag ligada nos dois, cada um criaria o SEU
// mundo — "Thais 2", que o ADR 0060 descarta — e o mesmo personagem poderia ser hospedado em duas
// sessões de mundo, uma em cada nó, sem que nada o impedisse (o diretório só serializa o registro de
// UMA sessão por personagem, e o ticket é preso a um nó).
//
// A trava de verdade — a chave `world:{id}:owner` com TTL, tomada só quando o dono não bate mais, que
// deixa o mundo viver num nó e os outros nós servirem só instâncias — é a OW-59. Até lá a flag só liga
// com UM processo `game`, e este arquivo é o que faz o "só liga com um" ser uma recusa e não uma
// instrução de operação que alguém esquece.
//
// **É uma proteção de BOOT, e é de propósito simples**: lê o batimento dos nós (`aliveNodes`, o mesmo
// que o `api` usa para escolher onde emitir um ticket) e se recusa. Duas subidas ao mesmo tempo, ambas
// sem ver a outra, passam — a janela existe e a OW-59 a fecha. O que a recusa pega é o caso real: o
// segundo `game` de um deploy em rolagem, ou o nó que alguém sobe "só para testar" ao lado do de produção.

import type { SessionDirectory } from '../directory.js';

/** Há outro processo `game` vivo, e `OPEN_WORLD` só liga com um (ADR 0060 d.2c). */
export class MultipleGameNodesError extends Error {
  constructor(readonly nodeId: string, readonly others: readonly string[]) {
    super(
      `OPEN_WORLD needs a single game process until the world lock exists (OW-59), but other game nodes `
      + `are alive: ${others.join(', ')}. Stop them, wait for their heartbeat to expire, or start this `
      + `node with OPEN_WORLD=0 (node ${nodeId}).`,
    );
    this.name = 'MultipleGameNodesError';
  }
}

/**
 * Lança `MultipleGameNodesError` se há um nó `game` vivo além de `nodeId`.
 *
 * **O próprio `nodeId` não conta**: o batimento dura um lease (30 s) além da morte, e um nó que reinicia
 * com o mesmo `NODE_ID` — o caso de um restart do contêiner — encontra o batimento da encarnação anterior
 * e não pode se recusar por causa de si mesmo. Um nó com `NODE_ID` diferente que acabou de morrer é o
 * outro lado da mesma moeda, e a recusa dura no máximo o lease: o orquestrador reinicia o contêiner, e a
 * segunda tentativa passa.
 *
 * **Falhar em saber é recusar.** Se o Redis não responde, a pergunta "há outro nó?" não tem resposta, e
 * subir sem ela é a forma de abrir dois mundos — o erro propaga e o processo não sobe, como o `ping` do
 * `main` já faz para o Redis fora do ar.
 */
export async function assertSoleGameNode(
  directory: Pick<SessionDirectory, 'aliveNodes'>,
  nodeId: string,
): Promise<void> {
  const others = (await directory.aliveNodes())
    .map((node) => node.nodeId)
    .filter((id) => id !== nodeId);
  if (others.length > 0) throw new MultipleGameNodesError(nodeId, others.sort());
}
