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

  /** O tile `n` à frente na rota, SEM andar (#203): é para onde se contorna um companheiro. */
  ahead(n = 1): Point {
    const len = this.#route.tiles.length;
    return this.#route.tiles[(((this.#index + n) % len) + len) % len] as Point;
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
   *
   * **O ANDAR entra no desempate primeiro, nunca só a distância em (x, y)** (#527). Na Darashia
   * Dragon Lair os três andares compartilham a MESMA caixa — um tile em (36, 93) pode ser chão
   * livre em z11 e parede em z10 —, e a distância antiga (só x/y) podia escolher um tile do
   * andar ERRADO por estar geometricamente mais perto: o personagem continua fisicamente no
   * andar de onde saiu, mas o walker passa a apontar para um índice de OUTRO andar. Dali em
   * diante `canOccupy` confere o tile pelo andar de PARTIDA (o personagem, não a rota) — e um
   * tile que é chão num andar e parede no outro rejeita o passo para sempre, sem nenhum dos
   * outros desvios (`not-adjacent`, companheiro) reconhecer o problema: bug achado reproduzindo
   * a QA do M28 com conteúdo real (o Paladin ficou preso 20+ minutos lógicos tentando um passo
   * que a validação de conteúdo nunca aprovaria como rota, porque não era ELE quem tinha
   * escolhido o índice — foi este método). Tile do MESMO andar sempre vence um de outro andar,
   * não importa a distância; só cai para "qualquer andar" se a rota não tiver NENHUM tile no
   * andar de `position` — o que não acontece numa hunt de verdade, mas evita devolver `null`
   * onde o contrato promete um índice.
   */
  rejoinNearest(position: Point): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestOnFloor = false;
    this.#route.tiles.forEach((tile, i) => {
      const onFloor = tile.z === position.z;
      // Um tile do andar CERTO sempre bate um de outro andar, mesmo mais perto em (x, y) — o
      // desempate dentro do mesmo grupo continua sendo a distância.
      if (bestOnFloor && !onFloor) return;
      const d = distance(position, tile);
      if (onFloor === bestOnFloor && d >= bestDistance) return;
      best = i;
      bestDistance = d;
      bestOnFloor = onFloor;
    });
    this.#index = best;
    return best;
  }
}
