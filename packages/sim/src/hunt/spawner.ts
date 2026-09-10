// Spawn por ponto e composição por dificuldade (FUN-41, §14.5 e §14.6).
//
// A regra que decide o desenho inteiro: **densidade é DADO, nunca sorteio**. Quantos monstros
// há em cada ponto vem da dificuldade escolhida e não varia — o §14.5 é explícito. O único
// sorteio é QUAL monstro, dentro dos pesos da composição.
//
// Posição também é determinística, e isso é escolha: o monstro aparece sempre no mesmo tile
// livre mais próximo do ponto. Uma hunt cujo spawn "anda" a cada respawn é uma hunt que o
// jogador não consegue planejar — e planejar é o que o §17.1 vende ao tornar o monstro
// previsível.

import type { HuntDifficulty, Point } from '@draconya/content';
import type { Rng } from '../rng.js';
import type { Blocked } from '../monster/step.js';
import { tilesAround } from '../movement.js';

/**
 * Um lugar onde um monstro nasce. Vazio significa esperando o respawn.
 *
 * O `respawnAtMs` que morava aqui saiu na FUN-68: quem sabe a hora é o evento de spawn na fila
 * da sessão. Guardar o instante nos dois lugares seria duas verdades sobre a mesma coisa, e a
 * que estivesse errada só apareceria numa retomada.
 */
export interface SpawnSlot {
  readonly pointIndex: number;
  /** Id numérico da criatura que ocupa o lugar, ou `null`. */
  readonly occupantId: number | null;
}

export interface SpawnerState {
  readonly slots: readonly SpawnSlot[];
}

export interface SpawnRequest {
  readonly slot: number;
  readonly monsterId: string;
  readonly position: Point;
}

/**
 * Sorteia dentro dos pesos. É o ÚNICO sorteio do spawn.
 *
 * Peso zero é permitido e significa "não sai": deixar uma variante no arquivo com peso zero é
 * como se desliga um monstro sem apagar a linha, e apagar linha é como se perde o histórico
 * de balanceamento.
 */
export function pickByWeight(
  composition: HuntDifficulty['composition'],
  rng: Rng,
): string | null {
  const total = composition.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return null;
  let roll = rng.fraction() * total;
  for (const entry of composition) {
    roll -= Math.max(0, entry.weight);
    if (roll < 0) return entry.monsterId;
  }
  return composition[composition.length - 1]?.monsterId ?? null;
}

export class Spawner {
  #slots: SpawnSlot[];

  /**
   * Um lugar por monstro previsto: `perSpawnPoint` da dificuldade, para cada ponto da rota.
   * A conta acontece UMA vez, na entrada — densidade não muda durante a hunt.
   */
  constructor(pointCount: number, difficulty: HuntDifficulty, state?: SpawnerState) {
    if (state !== undefined) {
      this.#slots = [...state.slots];
      return;
    }
    this.#slots = [];
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      for (let i = 0; i < difficulty.perSpawnPoint; i++) {
        this.#slots.push({ pointIndex, occupantId: null });
      }
    }
  }

  get slots(): readonly SpawnSlot[] {
    return this.#slots;
  }

  getState(): SpawnerState {
    return { slots: [...this.#slots] };
  }

  /**
   * O que nasce NESTE lugar, agora. `null` quando ele está ocupado ou não há tile livre.
   *
   * Um lugar por chamada desde a FUN-68, e não uma varredura de todos: quem chama é o evento
   * de spawn daquele lugar, que já sabe qual é. A varredura existia porque o tick não sabia
   * de nada e precisava perguntar a todos a cada passo — com 48 lugares, dezenas de vezes por
   * segundo, para quase sempre não haver nada a fazer.
   *
   * Quem chama ocupa o tile devolvido antes de pedir o próximo; é isso que dispensa o
   * conjunto de tiles já tomados que a varredura precisava carregar.
   */
  fill(
    slotIndex: number,
    difficulty: HuntDifficulty,
    positionOf: (pointIndex: number) => Point,
    blocked: Blocked,
    rng: Rng,
  ): SpawnRequest | null {
    const slot = this.#slots[slotIndex];
    if (slot === undefined || slot.occupantId !== null) return null;

    const monsterId = pickByWeight(difficulty.composition, rng);
    if (monsterId === null) return null;

    const position = this.#freeTile(positionOf(slot.pointIndex), blocked);
    // Sem lugar livre agora — outro monstro ocupou o ponto, ou o jogador está em cima.
    // Quem chama tenta de novo mais tarde; empilhar dois monstros no mesmo tile é pior.
    if (position === null) return null;

    return { slot: slotIndex, monsterId, position };
  }

  /** Marca o lugar como ocupado pela criatura que acabou de nascer. */
  occupy(slot: number, occupantId: number): void {
    const current = this.#slots[slot];
    if (current === undefined) return;
    this.#slots[slot] = { ...current, occupantId };
  }

  /**
   * O ocupante morreu: devolve o lugar, e diz QUAL para quem chama agendar o respawn.
   *
   * Respawn instantâneo faria a rota deixar de importar — o personagem mataria tudo parado
   * num ponto só. Longo demais faz ele dar voltas em mapa vazio. O número é da hunt, e quem
   * o aplica agora é o evento.
   */
  release(occupantId: number): number | null {
    const index = this.#slots.findIndex((slot) => slot.occupantId === occupantId);
    if (index < 0) return null;
    const slot = this.#slots[index] as SpawnSlot;
    this.#slots[index] = { ...slot, occupantId: null };
    return index;
  }

  #freeTile(center: Point, blocked: Blocked): Point | null {
    for (const tile of tilesAround(center, SPAWN_RADIUS)) {
      if (blocked(tile.x, tile.y)) continue;
      return tile;
    }
    return null;
  }
}

/**
 * Até onde procurar um tile livre em volta do ponto.
 *
 * Não é o `radius` do ponto de spawn da rota, que descreve onde os monstros PODEM estar; este
 * é só o alcance da busca por um lugar desocupado, e ficar pequeno é o certo — monstro que
 * nasce longe do ponto deixa de guardar o trecho da rota que ele existe para guardar.
 */
const SPAWN_RADIUS = 3;
