// Execução de rota fixa (FUN-42, §14.4).
//
// Cada hunt tem UMA rota, fixa e predeterminada, formando um laço. O bot não escolhe caminhos
// alternativos — e isso não é simplificação temporária, é o que torna a hunt barata: sem
// pathfinding, percorrer é avançar um índice numa lista.
//
// O que ESTE arquivo faz é só a execução: avançar, parar, retomar, dar a volta. **Quando**
// parar e retomar é decisão do bot (F2), e misturar as duas coisas aqui faria a regra de
// combate morar no lugar onde mora a geometria.

import type { Point, Route } from '@draconya/content';
import { distance } from '../monster/step.js';

export interface RouteState {
  /** Onde na lista de tiles. Entra no snapshot: sessão retomada continua daqui. */
  readonly index: number;
  readonly stopped: boolean;
}

export const INITIAL_ROUTE_STATE: RouteState = { index: 0, stopped: false };

export class RouteWalker {
  readonly #route: Route;
  #index: number;
  #stopped: boolean;

  constructor(route: Route, state: RouteState = INITIAL_ROUTE_STATE) {
    if (route.tiles.length === 0) throw new Error(`rota ${route.id} não tem tiles`);
    this.#route = route;
    this.#index = ((state.index % route.tiles.length) + route.tiles.length) % route.tiles.length;
    this.#stopped = state.stopped;
  }

  get index(): number {
    return this.#index;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  /** Tile em que o personagem está, segundo a rota. */
  get current(): Point {
    return this.#route.tiles[this.#index] as Point;
  }

  getState(): RouteState {
    return { index: this.#index, stopped: this.#stopped };
  }

  stop(): void {
    this.#stopped = true;
  }

  /**
   * Retoma NO MESMO ÍNDICE.
   *
   * Reiniciar do começo faria o personagem refazer o trecho já limpo, e a hunt renderia menos
   * sem nenhuma razão visível para quem está olhando o extrato.
   */
  resume(): void {
    this.#stopped = false;
  }

  /**
   * Avança UM tile e devolve o destino. `null` quando está parado.
   *
   * Um por chamada, e não "quantos couberem no tempo decorrido", desde a FUN-68: quando é o
   * evento de passo que decide a hora, cada vencimento vale exatamente um tile. A versão
   * anterior pulava vários de uma vez num tick longo — o personagem atravessava o mapa em
   * saltos, e a adjacência com os monstros era conferida uma vez só, no fim. É de onde saía
   * o 1,51× de dano sofrido a mais na hunt desanexada.
   */
  step(): Point | null {
    if (this.#stopped) return null;
    // Dá a volta: a rota é um laço fechado (§14.4), validado no carregamento (FUN-9).
    this.#index = (this.#index + 1) % this.#route.tiles.length;
    return this.current;
  }

  /**
   * Desfaz o último `step`: o tile estava ocupado e o passo foi recusado (FUN-69).
   *
   * Sem isto o índice avançaria e o personagem "pularia" o tile ocupado na volta seguinte —
   * o trecho da rota que ele existia para limpar ficaria sem ser limpo. Segurar é ficar no
   * tile anterior e tentar o mesmo destino no vencimento seguinte, que é o que o passo guloso
   * já faz ao empacar (ADR 0009).
   */
  hold(): void {
    const n = this.#route.tiles.length;
    this.#index = (this.#index - 1 + n) % n;
  }

  /**
   * Volta para a rota depois de sair dela — empurrado, teleportado, o que for.
   *
   * Busca LINEAR na lista, não A*: a rota tem dezenas de tiles, e procurar o mais próximo
   * numa lista dessas é mais barato que montar a estrutura que um pathfinder precisaria.
   * Reentrar pelo tile mais próximo também é o que evita o personagem refazer meia volta.
   */
  rejoinNearest(position: Point): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.#route.tiles.forEach((tile, i) => {
      const d = distance(position, tile);
      if (d >= bestDistance) return;
      best = i;
      bestDistance = d;
    });
    this.#index = best;
    return best;
  }
}
