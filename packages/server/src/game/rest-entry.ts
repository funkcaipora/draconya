// A entrada de quem vem do repouso (OW-21, #842, ADR 0060 d.2b e d.6b): o mundo, com a fila do mundo
// cheio, ou uma hunt idle direta.
//
// O teto do mundo vale só na ENTRADA: o login (`'rest'`) conta para o `capacity` e o mundo cheio o
// recusa; quem volta de uma instância (`'instance'`) nunca passa por aqui. O que a OW-18 deixou foi a
// recusa crua — `WorldFullError` e um handshake que falha —, e o que a OW-21 põe no lugar é o que o Tibia
// faz: uma fila com posição e tempo para tentar de novo (`canary/src/server/network/protocol/
// protocolgame.cpp:1005-1008`), e a hunt idle ao alcance de quem não coube (ADR 0060 d.6b).
//
// Este arquivo é a costura entre as duas metades. O hospedeiro (`host.ts`) não conhece o `WorldShard`
// nem o Redis: conhece uma porta (`WorldEntryGate`) que responde "entre" ou "fique de fora, na posição
// tal". Quem monta a porta com o shard e a fila é `createSessionWiring`.

import type { WorldQueue } from '../world-queue.js';
import type { WorldShard } from './sessions.js';

/** O mundo está no teto e a entrada era do repouso (ADR 0060 d.2b). Quem volta de uma instância nunca a vê. */
export class WorldFullError extends Error {
  constructor(readonly worldId: string, readonly capacity: number) {
    super(`world "${worldId}" is full (${String(capacity)} characters)`);
    this.name = 'WorldFullError';
  }
}

/**
 * A resposta da porta: o mesmo desenho da fila (`WorldQueueVerdict`), e é de propósito — a porta não
 * decide nada que a fila já não tenha decidido, só sabe quantas vagas o mundo tem.
 */
export type WorldEntryVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly position: number; readonly retryAfterMs: number };

/**
 * A hunt que o ticket pediu como primeira sessão (`entry: { hunt }`) não pôde ser construída: saiu do
 * conteúdo entre a emissão e a chegada ao `game` (um deploy em rolagem), ou o ruleset a recusou. É a
 * recusa tipada do handshake — o personagem NÃO é posto no mundo no lugar dela: quem pediu a hunt idle e
 * recebe o mundo cheio de gente sem ter pedido é uma surpresa pior que uma recusa que se explica.
 */
export class HuntEntryUnavailableError extends Error {
  constructor(readonly huntId: string) {
    super(`hunt "${huntId}" cannot be the first session of the character`);
    this.name = 'HuntEntryUnavailableError';
  }
}

export interface WorldEntryGate {
  /**
   * O personagem do repouso bate no mundo. `admitted: true` é "entre": o chamador cria a sessão. O
   * contrário é a posição e a espera, e o chamador recusa o handshake com `world-full`.
   *
   * `premium` o põe na frente dos comuns, como a lista de prioridade do Canary.
   */
  login(characterId: string, premium: boolean): Promise<WorldEntryVerdict>;
  /** O personagem entrou no jogo por outra porta (a hunt idle direta): a vaga que ele guardava não é mais dele. */
  leave(characterId: string): Promise<void>;
}

/**
 * Por que o handshake foi recusado: o mundo está cheio e o personagem ficou na fila. É a recusa TIPADA —
 * o hospedeiro a converte em `PrepareResult` e o `game` em `world-full` —, e não um erro: acontece todo
 * dia, com o mundo cheio, e quem a vê precisa só da posição e da espera.
 */
export class WorldFullRefusal extends Error {
  constructor(readonly position: number, readonly retryAfterMs: number) {
    super(`world is full: position ${String(position)} in the queue, retry in ${String(retryAfterMs)} ms`);
    this.name = 'WorldFullRefusal';
  }
}

/**
 * A porta de UM mundo deste nó: as vagas vêm do `WorldShard` (que é quem conhece a população da sessão),
 * a ordem vem da fila em Redis.
 *
 * O `capacity` do Canary é `maxPlayers` (`canary/config.lua.dist:73`); aqui é o do mundo (`worlds/<id>.json`),
 * lido pelo shard. A conta das vagas é feita DENTRO da chamada, no instante em que ela vai ao Redis: uma
 * vaga que abre entre dois logins é vista pelo segundo.
 */
export function createWorldEntryGate(
  shard: WorldShard,
  queue: WorldQueue,
  worldId: string,
): WorldEntryGate {
  return {
    login: (characterId, premium) => queue.clientLogin(worldId, characterId, {
      vacancies: shard.vacanciesOf(worldId), premium,
    }),
    leave: (characterId) => queue.leave(worldId, characterId),
  };
}
