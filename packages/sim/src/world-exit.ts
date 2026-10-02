// A saída do mundo aberto: o vocabulário que o `sim` e o hospedeiro dividem (#835, OW-14, ADR 0060
// d.7).
//
// No Tibia não se foge de uma luta fechando o navegador: o logout só passa onde `canLogout` deixa, e
// o personagem sem conexão sai sozinho aos 60 s — se `canLogout` deixar. O `sim` decide ONDE e
// QUANDO a saída vale (`WorldRuleset#requestLogout`, `#presenceLost`, em `rulesets/world.ts`); o que
// ele entrega ao hospedeiro é um EVENTO DE DOMÍNIO, porque tirar o personagem da sessão com o
// checkpoint e soltá-lo para o repouso é I/O (Redis, ledger) e o `sim` não o faz.
//
// Os dois eventos são GAMEPLAY, não apresentação, e é por isso que o hospedeiro os lê mesmo sem
// nenhum visualizador (a perda de conexão é justamente o caso em que não há) — como o `member-left`.

import type { Point } from '@draconya/content';
import type { LogoutRefusal } from './zones.js';

/**
 * Por que o personagem sai do mundo (ADR 0060 d.7). Os quatro motivos existem desde já para o
 * hospedeiro tratar a união inteira; quem emite cada um:
 *
 * - `'logout'` — o jogador pediu e `canLogout` deixou (esta issue, OW-14);
 * - `'xlog'` — o personagem ficou sem conexão por 60 s e `canLogout` deixou (esta issue);
 * - `'death'` — morreu e vai ao templo e à tela de relogin (OW-32);
 * - `'idle-kick'` — a conta passou do prazo sem intenção do jogador (OW-47).
 *
 * Não é o `EndReason` da sessão (`'manual-exit'`, `'death'`, …): este é o motivo da SAÍDA DO MUNDO,
 * que o hospedeiro traduz no do checkpoint que grava.
 */
export type WorldDepartureReason = 'logout' | 'xlog' | 'death' | 'idle-kick';

/**
 * A sessão do mundo pede ao hospedeiro que tire o personagem dela: grave o checkpoint (o extrato
 * parcial, `Session.checkpoint`) e solte-o para o repouso, com a posição (ADR 0060 d.7, "Saída").
 *
 * É um PEDIDO, e o personagem continua na sessão até o hospedeiro chamar `Session.leave`: o `sim`
 * não faz I/O, e o checkpoint precisa do extrato inteiro antes de ele sair. O pedido é emitido uma
 * vez por decisão — nada o repete —, e o hospedeiro é idempotente por personagem: o `logout` do
 * jogador e a tentativa de x-log podem cair no mesmo ciclo.
 */
export interface DepartureRequested {
  readonly kind: 'departure-requested';
  readonly characterId: string;
  readonly reason: WorldDepartureReason;
  /**
   * Onde o personagem está, em coordenada ABSOLUTA do Tibia (a de `characters.world_x/y/z`, ADR
   * 0060 d.3.b), lida no instante em que a saída foi decidida. É a âncora do próximo login
   * (`player.cpp:12332-12336`). `{ x: 0, y: 0, z: 0 }` é o "sem posição" do Canary — só um mapa sem
   * `source.region` o produz, e quem lê a âncora o trata como ausente.
   */
  readonly worldPosition: Point;
}

/**
 * O `logout` do jogador foi recusado: nada mudou no personagem. `reason` é o do `canLogout` e o do
 * `logout-refused` do protocolo (`LogoutRefusedReason`) — o hospedeiro o repassa como está.
 * POR PERSONAGEM: só quem pediu precisa ler a recusa.
 */
export interface LogoutRefused {
  readonly kind: 'logout-refused';
  readonly characterId: string;
  readonly reason: LogoutRefusal;
}

/** Os eventos de domínio da saída do mundo. Entram em `DomainEvent`. */
export type WorldExitEvent = DepartureRequested | LogoutRefused;

/**
 * Quanto o personagem sem conexão espera antes de tentar sair: o `noPongTime >= 60000` de
 * `Player::sendPing` (`canary/src/creatures/players/player.cpp:2327`). Contado no relógio LÓGICO da
 * sessão, do instante em que `presence-lost` chegou — o Canary o mede por pings de 5 s, e a fila de
 * eventos dá o instante exato.
 */
export const XLOG_DELAY_MS = 60_000;

/** O `0,0,0` do Canary: "sem posição" (`iologindata_load_player.cpp:207-210`). */
export const NO_WORLD_POSITION: Point = Object.freeze({ x: 0, y: 0, z: 0 });
