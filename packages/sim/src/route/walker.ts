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
import { Cooldowns } from '../cooldown.js';
import type { CooldownState } from '../cooldown.js';
import { distance } from '../monster/step.js';

export interface RouteState {
  /** Onde na lista de tiles. Entra no snapshot: sessão retomada continua daqui. */
  readonly index: number;
  readonly stopped: boolean;
  readonly cooldowns: Partial<CooldownState>;
}

export const INITIAL_ROUTE_STATE: RouteState = { index: 0, stopped: false, cooldowns: {} };

export class RouteWalker {
  readonly #route: Route;
  #index: number;
  #stopped: boolean;
  readonly cooldowns: Cooldowns;

  constructor(route: Route, state: RouteState = INITIAL_ROUTE_STATE) {
    if (route.tiles.length === 0) throw new Error(`rota ${route.id} não tem tiles`);
    this.#route = route;
    this.#index = ((state.index % route.tiles.length) + route.tiles.length) % route.tiles.length;
    this.#stopped = state.stopped;
    this.cooldowns = Cooldowns.fromState(state.cooldowns);
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
    return { index: this.#index, stopped: this.#stopped, cooldowns: this.cooldowns.getState() };
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
   * Avança quantos tiles couberem no tempo decorrido, e devolve o destino.
   *
   * `null` quando está parado ou quando ainda não passou tempo suficiente. Por tempo
   * decorrido, nunca por contagem de tick (invariante 2): é o que faz a hunt desanexada a
   * 1 Hz andar o mesmo tanto que a anexada a 10 Hz.
   */
  advance(dtMs: number, stepDurationMs: number): Point | null {
    // Nota sobre a PRIMEIRA chamada: os cooldowns começam prontos (FUN-25), então ela já
    // anda, mesmo com `dtMs` zero. É deliberado — entrar numa hunt e ficar meio segundo
    // parado antes do primeiro passo seria um atraso sem explicação na tela.

    if (this.#stopped) return null;
    const steps = this.cooldowns.timesThatFit('route-step', dtMs, stepDurationMs);
    if (steps === 0) return null;
    // Dá a volta: a rota é um laço fechado (§14.4), validado no carregamento (FUN-9).
    this.#index = (this.#index + steps) % this.#route.tiles.length;
    return this.current;
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
